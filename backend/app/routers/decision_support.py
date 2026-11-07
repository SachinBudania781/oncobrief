"""Authenticated deterministic staging, evidence retrieval, and safety review endpoints.

This router deliberately reports verified evidence and screening prompts only.
It does not select treatment regimens or expose unsupported guideline tiers.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..services import clinical_engine
from ..services.knowledge_base import ClinicalChromaRetriever, PatientClinicalProfile
from ..services.safety_guardrails import audit_patient_case, mandatory_pre_checks
from .common import Actor, audit, get_actor

router = APIRouter(prefix="/api/clinical", tags=["clinical decision support"])
logger = logging.getLogger(__name__)
CancerSite = Literal["breast", "lung_nsclc", "lung_sclc", "colorectal", "head_neck", "prostate"]
Intent = Literal["curative", "neoadjuvant", "adjuvant", "palliative_metastatic"]
Status = Literal["HIGH", "MODERATE_OR_LOW"]


class ClinicalCaseReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    patient_id: str | None = Field(default=None, min_length=1, max_length=64)
    cancer_site: CancerSite
    stage: str | None = Field(default=None, max_length=80)
    t_stage: str | None = Field(default=None, max_length=16)
    n_stage: str | None = Field(default=None, max_length=16)
    m_stage: str | None = Field(default=None, max_length=16)
    age: int | None = Field(default=None, ge=18, le=120)
    ecog_ps: float | None = Field(default=None, ge=0, le=5)
    biomarkers: list[str] = Field(default_factory=list, max_length=30)
    er_status: Literal["Positive", "Negative", "Unknown"] | None = None
    pr_status: Literal["Positive", "Negative", "Unknown"] | None = None
    her2_ihc: int | None = Field(default=None, ge=0, le=3)
    her2_fish: Literal["Positive", "Negative", "Not Tested"] | None = None
    ki67_index: float | None = Field(default=None, ge=0, le=100)
    intent: Intent | None = None
    clinical_notes: str = Field(min_length=1, max_length=4000)
    proposed_regimen: str = Field(default="", max_length=300)
    lvef: float | None = Field(default=None, ge=0, le=100)
    crcl: float | None = Field(default=None, ge=0, le=500)
    anc: float | None = Field(default=None, ge=0, le=1000000)
    platelets: float | None = Field(default=None, ge=0, le=10000000)
    bilirubin: float | None = Field(default=None, ge=0, le=100)
    dpd_status: str | None = Field(default=None, max_length=40)


class ClinicalCaseReviewOut(BaseModel):
    patient_id: str | None = None
    calculated_stage: dict[str, Any] | None = None
    molecular_subtype: str
    protocol_title: str | None
    category_tier: str | None
    regimen_details: list[dict[str, str]]
    recommended_regimens: dict[str, Any]
    cycle_schedule: str | None
    key_toxicity_warnings: list[str]
    mandatory_pre_checks: list[str]
    guideline_citation: str | None
    retrieval_confidence: Status
    retrieved_sources: list[dict[str, Any]]
    safety_alerts: list[dict[str, str]]
    recommendation_status: str
    notice: str
    audit_telemetry: dict[str, Any]


@lru_cache(maxsize=1)
def _retriever() -> ClinicalChromaRetriever:
    return ClinicalChromaRetriever()


def _clinician(actor: Actor) -> None:
    if actor.role not in {"doctor", "admin"}:
        raise HTTPException(403, "Clinical decision support is limited to doctors and administrators.")


def _effective_stage(body: ClinicalCaseReviewIn) -> tuple[str | None, dict[str, Any] | None]:
    tnm = (body.t_stage, body.n_stage, body.m_stage)
    if not any(tnm):
        if not body.stage:
            raise HTTPException(422, "Provide an explicit stage or all three TNM categories.")
        return body.stage, {
            "stage": body.stage,
            "basis": "Clinician-entered stage; not calculated from TNM",
            "ruleset": None,
        }
    if not all(tnm):
        return None, {
            "stage": "Stage Undetermined",
            "basis": "Incomplete TNM; provide T, N, and M to calculate an anatomical stage",
            "ruleset": "AJCC 8 anatomical mapping for supported sites",
        }
    try:
        stage = clinical_engine.compute_tnm_stage(body.cancer_site, *tnm)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, f"Invalid TNM categories: {exc}") from exc
    supported = stage != "Stage Undetermined (unsupported primary site)"
    # Collapse the NSCLC AJCC-8 M1-unspecified label to the stage-IV group
    # used by the verified guideline metadata, while keeping the basis explicit.
    retrieval_stage = "Stage IV" if stage == "Stage IV (M subclass not specified)" else stage
    return (retrieval_stage if supported and "Undetermined" not in stage else None), {
        "stage": stage,
        "basis": "Anatomical TNM calculation" if supported else "Unsupported primary site for built-in TNM mapping",
        "ruleset": "AJCC 8 anatomical mapping" if supported else None,
        "t": body.t_stage,
        "n": body.n_stage,
        "m": body.m_stage,
    }


def _recorded_receptor_pattern(body: ClinicalCaseReviewIn) -> str:
    if body.cancer_site != "breast":
        return "Not applicable; receptor pattern is not inferred for this site."
    recorded: list[str] = []
    if body.er_status and body.er_status != "Unknown":
        recorded.append(f"ER {body.er_status.lower()}")
    if body.pr_status and body.pr_status != "Unknown":
        recorded.append(f"PR {body.pr_status.lower()}")
    her2 = None
    if body.her2_fish == "Positive" or body.her2_ihc == 3:
        her2 = "HER2 positive"
    elif body.her2_fish == "Negative" or body.her2_ihc in {0, 1}:
        her2 = "HER2 negative"
    elif body.her2_ihc == 2:
        her2 = "HER2 IHC 2+; equivocal without an interpreted ISH/FISH result"
    if her2:
        recorded.append(her2)
    if body.ki67_index is not None:
        recorded.append(f"Ki-67 {body.ki67_index:g}%")
    if not recorded:
        return "Not classified; no explicit receptor results were entered."
    return "Recorded results: " + " · ".join(recorded) + ". This is not an intrinsic molecular-subtype assignment."


def _biomarkers(body: ClinicalCaseReviewIn) -> list[str]:
    values = list(body.biomarkers)
    if body.er_status in {"Positive", "Negative"}:
        values.append("ER+" if body.er_status == "Positive" else "ER-")
    if body.pr_status in {"Positive", "Negative"}:
        values.append("PR+" if body.pr_status == "Positive" else "PR-")
    if body.her2_fish == "Positive" or body.her2_ihc == 3:
        values.append("HER2+")
    elif body.her2_fish == "Negative" or body.her2_ihc in {0, 1}:
        values.append("HER2-")
    return list(dict.fromkeys(values))


def _review(body: ClinicalCaseReviewIn, actor: Actor, db: Session) -> ClinicalCaseReviewOut:
    _clinician(actor)
    stage, stage_details = _effective_stage(body)
    profile = PatientClinicalProfile(
        cancer_site=body.cancer_site,
        stage=stage,
        biomarkers=_biomarkers(body),
        intent=body.intent,
        clinical_keywords=body.clinical_notes,
    )
    retrieval = {"documents": [], "is_high_confidence": False}
    if stage:
        try:
            retrieval = _retriever().retrieve_with_filters(profile, top_k=3)
        except ValueError as exc:
            raise HTTPException(422, f"Unable to apply the requested metadata filters: {exc}") from exc
        except Exception as exc:
            logger.exception("Clinical guideline retrieval failed")
            raise HTTPException(503, "Guideline retrieval is unavailable; no regimen was generated.") from exc

    labs = {
        "lvef": body.lvef, "crcl": body.crcl, "anc": body.anc,
        "platelets": body.platelets, "bilirubin": body.bilirubin,
        "dpd_status": body.dpd_status,
    }
    alerts = audit_patient_case(labs, body.proposed_regimen)
    sources = [
        {"content": item["content"], "metadata": item["metadata"], "similarity": item["similarity"]}
        for item in retrieval["documents"]
    ]
    sections = [
        f"{item['metadata']['doc']} · {item['metadata']['section']} · p. {item['metadata']['page']}"
        for item in sources
    ]
    tier = next(
        (str(item["metadata"]["category_tier"]) for item in sources if item["metadata"].get("category_tier")),
        None,
    )
    checks = mandatory_pre_checks(body.proposed_regimen)
    if sources:
        title = "Retrieved guideline evidence"
        citation = "; ".join(sections)
        status = "evidence_retrieved_requires_clinician_review"
    else:
        title = None
        citation = None
        status = "no_matching_verified_evidence" if stage else "stage_required_before_guideline_search"

    audit(db, actor, "clinical_decision_support_review",
          detail=f"{body.cancer_site} · {stage or 'stage undetermined'}")
    return ClinicalCaseReviewOut(
        patient_id=body.patient_id,
        calculated_stage=stage_details,
        molecular_subtype=_recorded_receptor_pattern(body),
        protocol_title=title,
        category_tier=tier,
        regimen_details=[],
        recommended_regimens={
            "status": "not_generated",
            "items": [],
            "reason": "This endpoint does not select regimens or doses; review the retrieved source with the current institutional protocol.",
        },
        cycle_schedule=None,
        key_toxicity_warnings=[alert.observation for alert in alerts],
        mandatory_pre_checks=checks,
        guideline_citation=citation,
        retrieval_confidence="HIGH" if retrieval["is_high_confidence"] else "MODERATE_OR_LOW",
        retrieved_sources=sources,
        safety_alerts=[alert.model_dump(mode="python") for alert in alerts],
        recommendation_status=status,
        notice=("Staging, retrieval, and safety checks are deterministic review aids. Retrieved excerpts may be incomplete; "
                "they do not establish treatment concordance or authorize treatment."),
        audit_telemetry={
            "engine_mode": "deterministic staging, metadata-filtered evidence retrieval, and rule screening",
            "staging_ruleset": (stage_details or {}).get("ruleset"),
            "retrieval_filter": {"cancer_site": body.cancer_site, "stage": stage},
            "verified_source_count": len(sources),
            "regimen_generation_enabled": False,
            "hallucination_probability": None,
        },
    )


@router.post("/decision-brief", response_model=ClinicalCaseReviewOut)
def decision_brief(
    body: ClinicalCaseReviewIn,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    return _review(body, actor, db)


@router.post("/v1/evaluate", response_model=ClinicalCaseReviewOut)
def evaluate_case(
    body: ClinicalCaseReviewIn,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    """Compatible endpoint for the Doctor tumor-board evaluation panel."""
    if not body.patient_id:
        raise HTTPException(422, "patient_id is required for a patient case evaluation.")
    return _review(body, actor, db)


@router.get("/evaluation")
def clinical_evaluation(
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    _clinician(actor)
    try:
        from ..evaluate_pipeline import run_evaluation
        result = run_evaluation(_retriever())
    except Exception as exc:
        logger.exception("Clinical evaluation unavailable")
        raise HTTPException(503, "The evaluation benchmark is unavailable.") from exc
    audit(db, actor, "clinical_benchmark_run", detail=f"{result['cases_evaluated']} supplied cases")
    return result
