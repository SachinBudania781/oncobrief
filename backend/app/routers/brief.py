from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Brief, Patient
from ..services import llm
from ..services.brief import generate_brief
from .common import Actor, audit, get_actor, load_patient
from .patients import patient_dict

router = APIRouter(prefix="/api", tags=["brief"])


class BriefIn(BaseModel):
    patient_id: str
    visit_type: str = "follow_up"     # follow_up | new | transfer


def brief_dict(b: Brief, p: Patient, db: Session) -> dict:
    return {"id": b.id, "patient": patient_dict(p, db), "visit_type": b.visit_type,
            "created_at": b.created_at.isoformat(), "model": b.model, "latency_ms": b.latency_ms,
            "content": b.content, "sources": b.sources}


@router.post("/brief")
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
