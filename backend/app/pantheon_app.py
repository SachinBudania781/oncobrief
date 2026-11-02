"""Combined Pantheon entry point with explicit compatibility adapters.

Core files remain unchanged. Reuse the authenticated application and its original
endpoint-level role, department and patient-consent checks.
"""
from fastapi import APIRouter, Depends, Request

from .db import get_db
from .memory_up_app import app
from .routers import care

router = APIRouter(tags=["Pantheon integration"])


@router.get("/api/pantheon/slots")
def available_slots(request: Request, department: str, day: str, patient_id: str = "", db=Depends(get_db)):
    # The handler explicitly supports patients/caregivers and enforces their
    # appointment consent. The legacy global /api/slots staff-only guard predates
    # that feature. This authenticated alias retains the handler's actual rules.
    return care.slots(request=request, department=department, day=day, patient_id=patient_id, db=db)


class SlotCompatibility:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] == "GET" and scope["path"] == "/api/slots":
            scope = dict(scope, path="/api/pantheon/slots", raw_path=b"/api/pantheon/slots")
        await self.app(scope, receive, send)


app.router.routes[0:0] = router.routes
app.add_middleware(SlotCompatibility)
