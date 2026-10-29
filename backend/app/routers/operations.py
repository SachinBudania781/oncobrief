from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from ..db import get_db
from ..models import Appointment
from ..round2_models import VirtualAppointment
from ..security import append_audit, identity, roles, visible_ids
from ..services.scheduling import serial_schedule
from ..timeutil import hospital_now

router=APIRouter(prefix="/api/v2/schedule",tags=["schedule optimisation"])


def overlaps(a,b):
    return a["start"]<b["end"] and b["start"]<a["end"] and (a["patient_id"]==b["patient_id"] or (a["room"]==b["room"] and a["department"]==b["department"]))


def item(row):
    return {k:getattr(row,k) for k in ("id","patient_id","department","room","start","end")}


def waiting(rows):
    total=0
    for pid in {r["patient_id"] for r in rows}:
        visits=sorted([r for r in rows if r["patient_id"]==pid],key=lambda r:r["start"])
        total+=sum(max(0,(b["start"]-a["end"]).total_seconds()/60) for a,b in zip(visits,visits[1:]))
    return int(total)


@router.get("/packing")
def packing(request:Request,day:date,db=Depends(get_db)):
    user=identity(request)
    roles(user,"frontdesk","nurse","doctor","admin")
    if day<date.today():
        raise HTTPException(422,"Choose today or a future date")
    start=datetime.combine(day,datetime.min.time())
    rows=db.scalars(select(Appointment).where(Appointment.start>=start,Appointment.start<start+timedelta(days=1),Appointment.status!="cancelled")).all()
    allowed=set(visible_ids(db,user,"appointments"))
    selected=[r for r in rows if r.patient_id in allowed and r.status=="booked"]
    if not selected:
        return {"changes":[],"waiting_before":0,"waiting_after":0}
    fixed=[item(r) for r in rows if r not in selected]
    planned=[]
    window=start.replace(hour=8)
    if day==date.today():
        now=hospital_now()
        window=max(window,now.replace(minute=(now.minute//10)*10,second=0,microsecond=0)+timedelta(minutes=10))
    for row in sorted(selected,key=lambda r:(r.patient_id,r.start)):
        duration=row.end-row.start
        t=window
        while t+duration<=start.replace(hour=17):
            proposed={**item(row),"start":t,"end":t+duration,"expected_start":row.start}
            if not any(overlaps(proposed,x) for x in fixed+planned):
                planned.append(proposed)
                break
            t+=timedelta(minutes=10)
        else:
            raise HTTPException(409,"No packed plan fits within 08:00–17:00 without a recorded clash")
    return {"changes":planned,"waiting_before":waiting([item(r) for r in selected]),"waiting_after":waiting(planned),
            "review":"Review staffing, preparation, transport and regimen constraints before applying. Existing room assignments and durations are preserved."}


class Move(BaseModel):
    id:int
    expected_start:datetime
    start:datetime
    end:datetime


class ApplyPlan(BaseModel):
    changes:list[Move]=Field(min_length=1,max_length=200)
    approved:bool


@router.post("/packing")
@serial_schedule
def apply_packing(body:ApplyPlan,request:Request,db=Depends(get_db)):
    user=identity(request)
    roles(user,"frontdesk","nurse","admin")
    if not body.approved:
        raise HTTPException(422,"Staff approval is required")
    allowed=set(visible_ids(db,user,"appointments"))
    if len({m.id for m in body.changes})!=len(body.changes):
        raise HTTPException(422,"A booking can occur only once in a plan")
    proposed=[]
    loaded=[]
    for move in body.changes:
        row=db.get(Appointment,move.id)
        if not row or row.patient_id not in allowed or row.status!="booked":
            raise HTTPException(403,"A booking is unavailable or not assigned to your account")
        expected,start,end=(d.replace(tzinfo=None) for d in (move.expected_start,move.start,move.end))
        if row.start!=expected:
            raise HTTPException(409,"A booking changed; generate a new preview")
        if start.date()!=row.start.date() or end-start!=row.end-row.start or start<hospital_now() or start.hour<8 or end>start.replace(hour=17,minute=0,second=0,microsecond=0):
            raise HTTPException(422,"Preserve the booking date, duration and operating window")
        proposed.append({**item(row),"start":start,"end":end})
        loaded.append(row)
    selected={x["id"] for x in proposed}
    other=[item(r) for r in db.scalars(select(Appointment).where(Appointment.id.not_in(selected),Appointment.status!="cancelled"))]
    if any(overlaps(a,b) for i,a in enumerate(proposed) for b in proposed[i+1:]+other):
        raise HTTPException(409,"A slot is no longer free. Generate another preview.")
    from ..services.google_meet import GoogleMeetError, notify_appointment_participants, reschedule_event
    updated_events=[]
    visits_by_appointment={}
    try:
        for row,move in zip(loaded,proposed):
            visit=db.scalar(select(VirtualAppointment).where(VirtualAppointment.appointment_id==row.id))
            if visit and visit.status!="cancelled":
                visits_by_appointment[row.id]=visit
                if visit.google_event_id:
                    reschedule_event(visit.google_event_id,row,start=move["start"],end=move["end"])
                    updated_events.append((visit.google_event_id,row,row.start,row.end))
    except GoogleMeetError:
        for event_id,appointment,old_start,old_end in reversed(updated_events):
            try:
                reschedule_event(event_id,appointment,start=old_start,end=old_end)
            except GoogleMeetError:
                pass
        raise HTTPException(502,"Google Calendar could not update a video invitation. No appointment times were changed.") from None
    for row,move in zip(loaded,proposed):
        row.start,row.end=move["start"],move["end"]
    db.commit()
    append_audit(db,user,"approve_packed_schedule",detail=f"{len(loaded)} bookings moved")
    for row in loaded:
        if row.id in visits_by_appointment:
            notify_appointment_participants(db,row.patient_id,"Appointment time updated","Your video consultation time changed. Check the updated time on the OncoBrief appointment day pass.")
    return {"moved":len(loaded)}
