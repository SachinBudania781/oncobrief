from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Brief, Patient
from ..schemas import AlertSeverity, SafetyAlert, TumorBoardSynopticBrief
from ..services import llm
from ..services import clinical_engine
from ..services.brief import generate_brief
from .common import Actor, audit, get_actor, load_patient
from .patients import patient_dict

router = APIRouter(prefix="/api", tags=["brief"])


class BriefIn(BaseModel):
    patient_id: str
    visit_type: str = "follow_up"     # follow_up | new | transfer


class ClinicalStageIn(BaseModel):
    site: str = Field(min_length=1, max_length=100)
    t: str = Field(min_length=1, max_length=20)
    n: str = Field(min_length=1, max_length=20)
    m: str = Field(min_length=1, max_length=20)


class ClinicalDosingIn(BaseModel):
    age_years: int = Field(ge=18, le=120)
    weight_kg: float = Field(gt=0, le=400)
    height_cm: float = Field(gt=0, le=250)
    serum_creatinine_mg_dl: float = Field(gt=0, le=50)
    is_female: bool
    regimen: str = Field(default="", max_length=200)
    anc_per_ul: float | None = Field(default=None, ge=0)
    lvef_percent: float | None = Field(default=None, ge=0, le=100)
    platelets_per_ul: float | None = Field(default=None, ge=0)
    bilirubin_mg_dl: float | None = Field(default=None, ge=0)


class ClinicalTriageIn(BaseModel):
    temperature_c: float | None = Field(default=None, ge=25, le=45)
    symptom_tags: list[str] = Field(default_factory=list, max_length=20)
    days_post_chemo: int | None = Field(default=None, ge=0, le=90)


def _require_role(actor: Actor, *allowed: str) -> None:
    if actor.role not in allowed:
        raise HTTPException(403, "This clinical tool is not available to your role")


@router.post("/clinical/stage")
def deterministic_stage(body: ClinicalStageIn, actor: Actor = Depends(get_actor)):
    _require_role(actor, "doctor", "admin")
    return {"stage": clinical_engine.compute_tnm_stage(body.site, body.t, body.n, body.m),
            "basis": "AJCC 8 anatomical stage group; confirm edition, staging context, and source TNM with the oncology team."}


@router.post("/clinical/dosing")
def deterministic_dosing(body: ClinicalDosingIn, actor: Actor = Depends(get_actor)):
    _require_role(actor, "doctor", "admin")
    try:
        metrics = clinical_engine.calculate_patient_dosing_metrics(
            body.age_years, body.weight_kg, body.height_cm,
            body.serum_creatinine_mg_dl, body.is_female,
        )
        alerts = clinical_engine.run_organ_safety_screening(
            body.regimen, metrics.crcl_ml_min, body.anc_per_ul,
            body.lvef_percent, body.platelets_per_ul, body.bilirubin_mg_dl,
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "metrics": metrics.model_dump(),
        "alerts": [alert.model_dump() for alert in alerts],
        "notice": ("Calculated estimates for clinician review. Confirm the dosing weight, renal metric, "
                   "and current regimen-specific protocol before any treatment decision."),
    }


@router.post("/clinical/triage")
def deterministic_triage(body: ClinicalTriageIn, actor: Actor = Depends(get_actor)):
    _require_role(actor, "patient", "caregiver", "doctor", "nurse", "admin")
    try:
        return clinical_engine.triage_patient_symptom(
            body.temperature_c, body.symptom_tags, body.days_post_chemo
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


class BriefResponse(BaseModel):
    id: int
    patient: dict
    visit_type: str
    created_at: str
    model: str
    latency_ms: int
    content: dict
    sources: list[dict]
    synoptic: TumorBoardSynopticBrief


def brief_dict(b: Brief, p: Patient, db: Session) -> dict:
    content = b.content or {}
    existing_summary = content.get("summary") or []
    summary_text = [str(item.get("text", "")).strip() for item in existing_summary if item.get("text", "").strip()]
    clinical_summary = [
        f"{p.cancer_type or 'Cancer type not recorded'}; stage {p.stage or 'not recorded'}.",
        f"Visit: {content.get('visit_label', b.visit_type)}. Active regimen: {p.current_regimen or 'not recorded'}.",
        summary_text[0] if summary_text else "No source-supported visit summary is available in the record.",
    ]
    severity_map = {"critical": AlertSeverity.CRITICAL, "warning": AlertSeverity.WARNING,
                    "info": AlertSeverity.INFO}
    safety_alerts = []
    for alert in content.get("alerts", [])[:100]:
        level = severity_map.get(alert.get("level"), AlertSeverity.INFO)
        kind = alert.get("kind", "clinical")
        text = str(alert.get("text", "Clinical item requires review."))
        parameter = text.split(" ", 1)[0] if kind == "lab" else kind.replace("_", " ").title()
        safety_alerts.append(SafetyAlert(
            severity=level,
            parameter=parameter or "Clinical finding",
            observation=text,
            guideline_action="Review against the current institutional protocol. This brief does not recommend a dose or treatment change.",
        ).model_dump(mode="json"))
    synoptic = TumorBoardSynopticBrief.model_validate({
        "patient_id": p.id,
        "clinical_summary": clinical_summary,
        "guideline_concordance": "Not assessed: no authoritative NCG guideline text is configured for this deployment. Verify against the current NCG guideline before clinical use.",
        "guideline_source_status": "not_loaded",
        "safety_alerts": safety_alerts,
        "citations": [],
    }).model_dump(mode="json")
    return {"id": b.id, "patient": patient_dict(p, db), "visit_type": b.visit_type,
            "created_at": b.created_at.isoformat(), "model": b.model, "latency_ms": b.latency_ms,
            "content": b.content, "sources": b.sources, "synoptic": synoptic}


@router.post("/brief", response_model=BriefResponse)
def make_brief(body: BriefIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    p = db.get(Patient, body.patient_id.strip().upper())
    if not p:
        raise HTTPException(404, f"No patient with ID {body.patient_id}")
    b = generate_brief(db, p, body.visit_type)
    audit(db, actor, "generate_brief", p.id, f"{body.visit_type} · {b.latency_ms} ms · {b.model}")
    return brief_dict(b, p, db)


@router.get("/patients/{patient_id}/briefs")
def past_briefs(patient: Patient = Depends(load_patient), db: Session = Depends(get_db)):
    rows = db.scalars(select(Brief).where(Brief.patient_id == patient.id).order_by(Brief.created_at.desc())
                      .limit(10)).all()
    return [{"id": b.id, "visit_type": b.visit_type, "created_at": b.created_at.isoformat(), "model": b.model,
             "latency_ms": b.latency_ms} for b in rows]


@router.get("/ai-status")
def ai_status():
    return {"llm_enabled": llm.enabled(), "provider": llm.config.LLM_PROVIDER if llm.enabled() else None,
            "model": llm.model_name() if llm.enabled() else "deterministic writer"}


