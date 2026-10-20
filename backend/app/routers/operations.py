from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from ..db import get_db
from ..models import Appointment
from ..security import append_audit, identity, roles, visible_ids
from ..services.scheduling import serial_schedule

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
        now=datetime.now()
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
        if start.date()!=row.start.date() or end-start!=row.end-row.start or start<datetime.now() or start.hour<8 or end>start.replace(hour=17,minute=0,second=0,microsecond=0):
            raise HTTPException(422,"Preserve the booking date, duration and operating window")
        proposed.append({**item(row),"start":start,"end":end})
        loaded.append(row)
    selected={x["id"] for x in proposed}
    other=[item(r) for r in db.scalars(select(Appointment).where(Appointment.id.not_in(selected),Appointment.status!="cancelled"))]
    if any(overlaps(a,b) for i,a in enumerate(proposed) for b in proposed[i+1:]+other):
        raise HTTPException(409,"A slot is no longer free. Generate another preview.")
    for row,move in zip(loaded,proposed):
        row.start,row.end=move["start"],move["end"]
    db.commit()
    append_audit(db,user,"approve_packed_schedule",detail=f"{len(loaded)} bookings moved")
    return {"moved":len(loaded)}
