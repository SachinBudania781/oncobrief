from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuditLog, Patient


class Actor:
    def __init__(self, role: str, name: str):
        self.role, self.name = role, name


def get_actor(x_actor_role: str = Header(default="anonymous"), x_actor_name: str = Header(default="Demo user")):
    return Actor(x_actor_role, x_actor_name)


def audit(db: Session, actor: Actor, action: str, patient_id: str | None = None, detail: str = ""):
    db.add(AuditLog(actor_role=actor.role, actor_name=actor.name, action=action,
                    patient_id=patient_id, detail=detail[:300]))
    db.commit()


def load_patient(patient_id: str, db: Session = Depends(get_db)) -> Patient:
    p = db.get(Patient, patient_id.strip().upper())
    if not p:
        raise HTTPException(404, f"No patient with ID {patient_id}")
    return p
