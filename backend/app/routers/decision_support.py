"""Authenticated deterministic retrieval and safety-review endpoints."""
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


class ClinicalCaseReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    cancer_site: Literal["breast", "lung_nsclc", "lung_sclc", "colorectal", "head_neck", "prostate"]
    stage: str = Field(min_length=1, max_length=80)
    biomarkers: list[str] = Field(default_factory=list, max_length=30)
    intent: Literal["curative", "neoadjuvant", "adjuvant", "palliative_metastatic"] | None = None
    clinical_notes: str = Field(min_length=1, max_length=4000)
    proposed_regimen: str = Field(default="", max_length=300)
    lvef: float | None = Field(default=None, ge=0, le=100)
    crcl: float | None = Field(default=None, ge=0, le=500)
    anc: float | None = Field(default=None, ge=0, le=1000000)
    platelets: float | None = Field(default=None, ge=0, le=10000000)
    bilirubin: float | None = Field(default=None, ge=0, le=100)
    dpd_status: str | None = Field(default=None, max_length=40)


class ClinicalCaseReviewOut(BaseModel):
    protocol_title: str | None
    category_tier: str | None
    regimen_details: list[dict[str, str]]
    cycle_schedule: str | None
    key_toxicity_warnings: list[str]
    mandatory_pre_checks: list[str]
    guideline_citation: str | None
    retrieval_confidence: Literal["HIGH", "MODERATE_OR_LOW"]
    retrieved_sources: list[dict[str, Any]]
    safety_alerts: list[dict[str, str]]
    recommendation_status: str
    notice: str


@lru_cache(maxsize=1)
def _retriever() -> ClinicalChromaRetriever:
    return ClinicalChromaRetriever()


def _clinician(actor: Actor) -> None:
    if actor.role not in {"doctor", "admin"}:
        raise HTTPException(403, "Clinical decision support is limited to doctors and administrators.")


@router.post("/decision-brief", response_model=ClinicalCaseReviewOut)
def decision_brief(
    body: ClinicalCaseReviewIn,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    _clinician(actor)
    profile = PatientClinicalProfile(
        cancer_site=body.cancer_site,
        stage=body.stage,
        biomarkers=body.biomarkers,
        intent=body.intent,
        clinical_keywords=body.clinical_notes,
    )
    try:
        retrieval = _retriever().retrieve_with_filters(profile, top_k=3)
    except Exception as exc:
        logger.exception("Clinical guideline retrieval failed")
        raise HTTPException(503, "Guideline retrieval is unavailable; no recommendation was generated.") from exc

    patient_labs = {
        "lvef": body.lvef,
        "crcl": body.crcl,
        "anc": body.anc,
        "platelets": body.platelets,
        "bilirubin": body.bilirubin,
        "dpd_status": body.dpd_status,
    }
    alerts = audit_patient_case(patient_labs, body.proposed_regimen)
    sources = []
    for item in retrieval["documents"]:
        meta = item["metadata"]
        sources.append({
            "content": item["content"],
            "metadata": meta,
            "similarity": item["similarity"],
        })
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
        status = "no_matching_verified_evidence"
    audit(db, actor, "clinical_decision_support_review", detail=f"{body.cancer_site} · {body.stage}")
    return ClinicalCaseReviewOut(
        protocol_title=title,
        category_tier=tier,
        regimen_details=[],
        cycle_schedule=None,
        key_toxicity_warnings=[alert.observation for alert in alerts],
        mandatory_pre_checks=checks,
        guideline_citation=citation,
        retrieval_confidence="HIGH" if retrieval["is_high_confidence"] else "MODERATE_OR_LOW",
        retrieved_sources=sources,
        safety_alerts=[alert.model_dump(mode="python") for alert in alerts],
        recommendation_status=status,
        notice=("Evidence retrieval and safety checks are deterministic. This route does not select a regimen, "
                "generate drug details or doses, or determine guideline concordance."),
    )


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
