from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Brief, Patient
from ..schemas import AlertSeverity, SafetyAlert, TumorBoardSynopticBrief
from ..services import llm
from ..services.brief import generate_brief
from .common import Actor, audit, get_actor, load_patient
from .patients import patient_dict

router = APIRouter(prefix="/api", tags=["brief"])


class BriefIn(BaseModel):
    patient_id: str
    visit_type: str = "follow_up"     # follow_up | new | transfer


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

