from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuditLog, Patient


class Actor:
    def __init__(self, role: str, name: str, id: int = 0):
        self.role, self.name, self.id = role, name, id


def get_actor(request: Request):
    from ..security import identity
    user = identity(request)
    return Actor(user.role, user.name, user.id)


def audit(db: Session, actor: Actor, action: str, patient_id: str | None = None, detail: str = ""):
    db.add(AuditLog(actor_role=actor.role, actor_name=actor.name, action=action,
                    patient_id=patient_id, detail=detail[:300]))
    db.commit()
    from ..security import append_audit
    append_audit(db, actor, action, patient_id, detail)


def load_patient(patient_id: str, db: Session = Depends(get_db)) -> Patient:
    p = db.get(Patient, patient_id.strip().upper())
    if not p:
        raise HTTPException(404, f"No patient with ID {patient_id}")
    return p
