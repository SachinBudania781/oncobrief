import io
import re
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta
from sqlalchemy import select

P='OB-2026-0001'


def test_otp_is_single_use(client):
    from app.db import SessionLocal
    from app.round2_models import User
    phone='+919000001234'
    with SessionLocal() as db:
        user=db.scalar(select(User).where(User.username=='meera'));user.phone=phone;db.commit()
    client.cookies.clear()
    c=client.post('/api/auth/otp',json={'phone':phone})
    assert c.status_code==200,c.text
    c=c.json();body={'challenge_id':c['challenge_id'],'code':c['demo_code']}
    assert client.post('/api/auth/verify-otp',json=body).status_code==200
    assert client.post('/api/auth/verify-otp',json=body).status_code==401


def test_consultation_draft_requires_consent_and_signature(client,login):
    assert client.post(f'/api/v2/patients/{P}/scribe-draft',json={'text':'doctor: Plan review next week','consent':False}).status_code==422
    result=client.post(f'/api/v2/patients/{P}/scribe-draft',json={'text':'doctor: Plan review next week','consent':True,'language':'mr'})
    assert result.status_code==200,result.text
    assert 'review next week' in result.json()['plan']
    result=client.post(f'/api/v2/patients/{P}/care-review-draft')
    assert result.status_code==200,result.text
    aid=result.json()['id']
    assert result.json()['status']=='sent'
    login('meera')
    own=next(r for r in client.get(f'/api/v2/patients/{P}/approvals').json() if r['id']==aid)
    assert 'draft' not in own


def test_same_display_name_is_not_treating_doctor(client,login):
    login('admin')
    name='consult_'+secrets.token_hex(4)
    r=client.post('/api/auth/users',json={'username':name,'name':'Dr. R. Menon','role':'doctor','password':'ConsultantTest!2026','patient_ids':[P]})
    assert r.status_code==200,r.text
    login('meera')
    aid=client.post(f'/api/v2/patients/{P}/approvals',json={'request':'Please review supportive care'}).json()['id']
    client.cookies.clear()
    assert client.post('/api/auth/login',json={'username':name,'password':'ConsultantTest!2026'}).status_code==200
    assert client.post(f'/api/v2/approvals/{aid}/review',json={'action':'reject','reason':'Consultant review'}).status_code==403


def test_lab_ownership_uses_account_id(client,login):
    login('lab')
    form={'patient_id':P,'category':'Lab report','subtype':'CBC','record_date':'2026-10-18T08:00'}
    r=client.post('/api/documents',data=form,files={'file':('own.txt',f'Patient ID: {P}\nName: Meera Kulkarni\nHaemoglobin 10.4 g/dL','text/plain')})
    assert r.status_code==200,r.text
    did=r.json()['id']
    assert client.get(f'/api/documents/{did}').status_code==200
    login('admin');name='lab_'+secrets.token_hex(4)
    r=client.post('/api/auth/users',json={'username':name,'name':'Lab technician Ravi','role':'lab','password':'OtherLabTest!2026','patient_ids':[P]})
    assert r.status_code==200,r.text
    client.cookies.clear();assert client.post('/api/auth/login',json={'username':name,'password':'OtherLabTest!2026'}).status_code==200
    assert client.get(f'/api/documents/{did}').status_code==403
    assert not client.get('/api/documents/recent').json()
    for endpoint in ['summary','clinical','records']:
        assert client.get(f'/api/v2/patients/{P}/{endpoint}').status_code==403


def test_concurrent_prescription_approval_creates_one_medicine(client):
    from app.db import SessionLocal
    from app.models import Medication
    aid=client.post(f'/api/v2/patients/{P}/approvals',json={'request':'Concurrency approval check'}).json()['id']
    medicine='Unique test '+secrets.token_hex(4)
    body={'action':'approve','medicine':medicine,'dose':'1 mg','frequency':'Daily','times':['08:00'],'safety_confirmed':True,'reason':'Verified by the treating clinician for isolated test'}
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses=list(pool.map(lambda _:client.post(f'/api/v2/approvals/{aid}/review',json=body).status_code,range(2)))
    assert sorted(statuses)==[200,409],statuses
    with SessionLocal() as db:
        assert len(db.scalars(select(Medication).where(Medication.name==medicine)).all())==1


def test_atomic_schedule_packing_and_stale_preview(client,login):
    day=(datetime.now()+timedelta(days=8)).date().isoformat()
    for dept,time in [('Radiology','09:00'),('Medical Oncology OPD','11:00')]:
        r=client.post('/api/appointments',json={'patient_id':P,'department':dept,'start':f'{day}T{time}'})
        assert r.status_code==200,r.text
    plan=client.get(f'/api/v2/schedule/packing?day={day}')
    assert plan.status_code==200,plan.text
    plan=plan.json()
    assert plan['waiting_after']<=plan['waiting_before']
    changes=[{k:c[k] for k in ['id','expected_start','start','end']} for c in plan['changes']]
    login('frontdesk')
    r=client.post('/api/v2/schedule/packing',json={'changes':changes,'approved':True})
    assert r.status_code==200,r.text
    assert not client.get(f'/api/schedule?day={day}').json()['clashes']
    assert client.post('/api/v2/schedule/packing',json={'changes':changes,'approved':True}).status_code==409


def test_phone_callback_requires_verification_and_is_single_use(client):
    from app.db import SessionLocal
    from app.round2_models import User,ShareLink
    from app.security import digest
    token=secrets.token_urlsafe(40)
    with SessionLocal() as db:
        user=db.scalar(select(User).where(User.username=='doctor'))
        db.add(ShareLink(patient_id=P,token_hash=digest(token),kind='phone_callback',fields=[],expires_at=datetime.now()+timedelta(hours=1),created_by=user.id));db.commit()
    client.cookies.clear();headers={'Authorization':'Bearer '+token}
    body={'identity_verified':False,'answers':{'temperature':38.5,'language':'mr'}}
    assert client.post('/api/webhooks/telephony',headers=headers,json=body).status_code==403
    body['identity_verified']=True
    r=client.post('/api/webhooks/telephony',headers=headers,json=body)
    assert r.status_code==200 and r.json()['level']==3,r.text
    assert client.post('/api/webhooks/telephony',headers=headers,json=body).status_code==403


def test_privacy_review_and_staff_handover_do_not_leak(client,login):
    login('nurse')
    r=client.post(f'/api/v2/patients/{P}/records',json={'kind':'nurse_handover','data':{'text':'Private ward list including another case','acknowledged':True}})
    assert r.status_code==200,r.text
    rid=r.json()['id']
    login('meera')
    assert rid not in [r['id'] for r in client.get(f'/api/v2/patients/{P}/records').json()]
    r=client.post(f'/api/v2/patients/{P}/records',json={'kind':'privacy_request','data':{'request_type':'access','text':'Please provide my data access export'}})
    assert r.status_code==200,r.text
    rid=r.json()['id']
    login('privacy')
    assert any(r['id']==rid for r in client.get('/api/v2/privacy-requests').json())
    assert client.post(f'/api/v2/records/{rid}/action',json={'action':'complete','text':'Identity verified; provided access response through the hospital process'}).status_code==200


def test_signed_notes_ground_companion_and_living_summary(client,login):
    r=client.post(f'/api/v2/patients/{P}/records',json={'kind':'takeaway','data':{'text':'The cobaltblue followup is booked for the next visit'}})
    assert r.status_code==200,r.text
    rid=r.json()['id']
    assert client.post(f'/api/v2/records/{rid}/action',json={'action':'approve'}).status_code==200
    login('meera')
    answer=client.post(f'/api/v2/patients/{P}/companion',json={'text':'Show cobaltblue followup'})
    assert answer.status_code==200,answer.text
    assert any(s.get('record_id')==rid for s in answer.json()['sources'])
    assert 'cobaltblue' in client.get(f'/api/v2/patients/{P}/summary').json()['text']


def test_medicine_strength_check_does_not_log_a_dose(client,monkeypatch):
    from PIL import Image
    from app.routers import document_tools
    med=next(m for m in client.get(f'/api/patients/{P}/medications').json() if m['name']=='Ondansetron')
    b=io.BytesIO();Image.new('RGB',(300,200),'white').save(b,'PNG')
    monkeypatch.setattr(document_tools,'extract_text',lambda *a:(f"{med['name']} 99 mg\nEXP 12/2030",'tesseract',99))
    r=client.post(f'/api/v2/patients/{P}/medicine-scan',data={'medication_id':med['id']},files={'file':('strip.png',b.getvalue(),'image/png')})
    assert r.status_code==200,r.text
    assert any('strength' in w for w in r.json()['data']['warnings'])
    assert r.json()['auto_taken'] is False


def test_gate_and_teachback(client,login):
    login('meera')
    assert client.get(f'/api/v2/patients/{P}/gate-qr').content.startswith(b'\x89PNG')
    assert client.post(f'/api/v2/patients/{P}/gate').status_code==200
    r=client.post(f'/api/v2/patients/{P}/teach-back',json={'answers':['contact','doctor','original']})
    assert r.status_code==200 and r.json()['score']==3


def test_staff_totp_is_enforced_outside_demo(client,monkeypatch):
    import pyotp
    from app.routers import auth
    from app.db import SessionLocal
    from app.round2_models import User
    secret=pyotp.random_base32()
    with SessionLocal() as db:
        row=db.scalar(select(User).where(User.username=='nurse'));row.totp_secret=secret;db.commit()
    monkeypatch.setattr(auth,'DEMO_MODE',False)
    client.cookies.clear()
    body={'username':'nurse','password':'OncoDemo!2026'}
    assert client.post('/api/auth/login',json=body).status_code==401
    assert client.post('/api/auth/login',json=body|{'totp':pyotp.TOTP(secret).now()}).status_code==200


def test_document_links_expire(client,monkeypatch):
    from app.services import protected_files
    did=client.get(f'/api/patients/{P}/documents').json()[0]['id']
    url=client.get(f'/api/documents/{did}').json()['file_url']
    now=protected_files.time.time()
    monkeypatch.setattr(protected_files.time,'time',lambda:now+240)
    assert client.get(url).status_code==403
