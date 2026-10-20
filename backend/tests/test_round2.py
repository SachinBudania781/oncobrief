import io
import secrets
from datetime import datetime, timedelta
import pytest
from sqlalchemy import select, text

P1, P2 = "OB-2026-0001", "OB-2026-0002"


def test_headers_cannot_spoof_identity(client):
    client.cookies.clear()
    assert client.get(f"/api/patients/{P1}", headers={"X-Actor-Role": "doctor"}).status_code == 401


def test_patient_isolation_in_all_core_paths(client, login):
    login("meera")
    assert {p["id"] for p in client.get('/api/patients').json()} == {P1}
    for suffix in ["", "/documents", "/labs", "/medications", "/symptoms", "/activity", "/briefs", "/qr"]:
        assert client.get(f"/api/patients/{P2}{suffix}").status_code == 403
    assert client.get(f"/api/appointments?patient_id={P2}").status_code == 403
    assert client.post('/api/brief',json={"patient_id": P1}).status_code == 403
    assert client.get('/api/schedule').status_code == 403
    assert client.get('/api/documents/recent').status_code == 200


def test_emergency_checkin_to_nurse_and_doctor(client, login):
    login('meera')
    result = client.post(f'/api/v2/patients/{P1}/checkin',json={"temperature":38.5,"language":"hi","text":"बुखार है"})
    assert result.status_code == 200, result.text
    assert result.json()['level'] == 3
    aid = result.json()['alert_id']
    login('nurse')
    assert any(a['id']==aid and a['severity']=='emergency' for a in client.get('/api/v2/alerts').json())
    for action in ['acknowledge','call','arrived','escalate','resolve']:
        r=client.post(f'/api/v2/alerts/{aid}/action',json={"action":action,"outcome":"Contacted patient and treating team"})
        assert r.status_code == 200, r.text
    assert r.json()['arrival_at']
    login('doctor')
    board=client.get('/api/v2/command-centre').json()
    assert any(p['patient_id']==P1 for p in board['patients'])


def test_prescription_gate_and_reminders(client, login):
    login('meera')
    r=client.post(f'/api/v2/patients/{P1}/approvals',json={"kind":"medicine","request":"Please review nausea support"})
    assert r.status_code==200,r.text
    aid=r.json()['id']
    assert 'draft' not in r.json()
    assert client.post(f'/api/v2/approvals/{aid}/review',json={"action":"approve"}).status_code==403
    login('doctor')
    bad=client.post(f'/api/v2/approvals/{aid}/review',json={"action":"approve"})
    assert bad.status_code==422
    body={"action":"approve","medicine":"Test supportive medicine","dose":"1 mg","frequency":"Daily","times":["08:00"],"safety_confirmed":True,"reason":"Clinician verified against the local protocol"}
    r=client.post(f'/api/v2/approvals/{aid}/review',json=body)
    assert r.status_code==200,r.text
    assert r.json()['medication_id']
    assert client.post(f'/api/v2/approvals/{aid}/review',json=body).status_code==409
    login('meera')
    assert any(m['id']==r.json()['medication_id'] and m['today'][0]['time']=='08:00' for m in client.get(f'/api/patients/{P1}/medications').json())


def test_cross_patient_medication_log_refused(client, login):
    mid=client.get(f'/api/patients/{P2}/medications').json()[0]['id']
    login('meera')
    assert client.post('/api/med-logs',json={"medication_id":mid,"time":"08:00","status":"taken"}).status_code==403


def test_consent_scopes_and_revocation(client, login):
    login('meera')
    name='carer_'+secrets.token_hex(4)
    r=client.post(f'/api/v2/patients/{P1}/circle',json={"username":name,"name":"Family member","password":"FamilyTest!2026","scopes":["appointments"],"consent":True})
    assert r.status_code==200,r.text
    gid=r.json()['id']
    client.cookies.clear()
    assert client.post('/api/auth/login',json={"username":name,"password":"FamilyTest!2026"}).status_code==200
    assert client.get(f'/api/v2/patients/{P1}/day-pass').status_code==200
    assert client.get(f'/api/patients/{P1}/documents').status_code==403
    assert client.get(f'/api/patients/{P1}/medications').status_code==403
    assert client.get(f'/api/v2/patients/{P1}/summary').status_code==403
    old_cookie=client.cookies.get('ob_session')
    login('meera')
    assert client.delete(f'/api/v2/circle/{gid}').status_code==200
    client.cookies.clear();client.cookies.set('ob_session',old_cookie)
    assert client.get(f'/api/v2/patients/{P1}/day-pass').status_code==403


def test_takeaway_needs_signature_and_creates_reminder(client, login):
    login('meera')
    r=client.post(f'/api/v2/patients/{P1}/records',json={"kind":"takeaway","data":{"text":"Review at the next appointment","reminder":"Call clinic","reminder_at":datetime.now().isoformat()}})
    assert r.status_code==200,r.text
    rid=r.json()['id']
    assert r.json()['status']=='draft'
    assert client.post(f'/api/v2/records/{rid}/action',json={"action":"approve"}).status_code==403
    login('doctor')
    assert client.post(f'/api/v2/records/{rid}/action',json={"action":"approve","text":"Verified review plan"}).status_code==200
    rows=client.get(f'/api/v2/patients/{P1}/records').json()
    assert any(r['kind']=='reminder' and r['data'].get('source')==f'R{rid}' for r in rows)


def test_wrong_patient_guard_and_identity_override(client):
    form={"patient_id":P1,"category":"Lab report","subtype":"CBC","record_date":"2026-10-18T08:00"}
    r=client.post('/api/documents',data=form,files={"file":('report.txt',f'Name: Rajesh Iyer\nPatient ID: {P2}\nHaemoglobin 9.4 g/dL','text/plain')})
    assert r.status_code==409,r.text
    form.update(identity_confirmed='true',identity_reason='Verified original with patient')
    assert client.post('/api/documents',data=form,files={"file":('report.txt',f'Patient ID: {P2}','text/plain')}).status_code==409
    r=client.post('/api/documents',data=form,files={"file":('report.txt',f'Name: Meera Kulkarni\nPatient ID: {P1}\nHaemoglobin 9.4 g/dL','text/plain')})
    assert r.status_code==200,r.text
    assert r.json()['lab_values'][0]['value']==9.4


def test_protected_file_session_token_watermark_and_encryption(client, login):
    docs=client.get(f'/api/patients/{P1}/documents').json()
    doc=next(d for d in docs if d['mime']=='application/pdf')
    meta=client.get(f"/api/documents/{doc['id']}").json()
    url=meta['file_url']
    assert client.get(f"/api/documents/{doc['id']}/file").status_code==403
    result=client.get(url)
    assert result.status_code==200,result.text[:100]
    from pypdf import PdfReader
    assert 'Dr. R. Menon' in '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(result.content)).pages)
    from app.config import DATA_DIR
    assert (DATA_DIR/doc['folder_path']).read_bytes().startswith(b'OBENC1:')
    login('meera')
    assert client.get(url).status_code==403
    login('rajesh')
    assert client.get(url).status_code==403


def test_upload_validation(client):
    form={"patient_id":P1,"category":"Lab report","subtype":"CBC","record_date":"not a date"}
    assert client.post('/api/documents',data=form,files={"file":('fake.pdf',b'not pdf','application/pdf')}).status_code==422
    assert client.post('/api/documents',data=form,files={"file":('fake.txt',b'valid text','text/plain')}).status_code==422
    assert client.post('/api/documents',data=form,files={"file":('fake.html',b'<script>','text/html')}).status_code==422


def test_chat_has_real_author_and_emergency_flag(client, login):
    login('caregiver')
    r=client.post(f'/api/v2/patients/{P1}/chat',json={"text":"She cannot breathe"})
    assert r.status_code==200,r.text
    assert r.json()['author_role']=='caregiver' and r.json()['data']['urgency']==3
    assert client.get(f'/api/v2/patients/{P2}/chat').status_code==403


def test_draft_trial_never_reaches_patient(client, login):
    r=client.post(f'/api/v2/patients/{P1}/records',json={"kind":"trial","data":{"registry_id":"CTRI-TEST","title":"Review only","evidence_url":"https://ctri.nic.in/","text":"Eligibility not confirmed"}})
    assert r.status_code==200,r.text
    rid=r.json()['id']
    login('meera')
    assert rid not in [r['id'] for r in client.get(f'/api/v2/patients/{P1}/records').json()]


def test_expiring_consent_links_and_revocation(client, login):
    login('meera')
    r=client.post(f'/api/v2/patients/{P1}/shares',json={"kind":"emergency","fields":["allergies"],"hours":1,"consent":True})
    assert r.status_code==200,r.text
    data=r.json()
    client.cookies.clear()
    shared=client.get(data['api_url'])
    assert shared.status_code==200
    assert 'regimen' not in shared.json() and 'summary' not in shared.json()
    login('meera')
    assert client.delete(f"/api/v2/shares/{data['id']}").status_code==200
    client.cookies.clear()
    assert client.get(data['api_url']).status_code==404


def test_sessions_can_be_revoked(client):
    dev=client.get('/api/auth/devices').json()
    current=next(x for x in dev if x['current'])
    assert client.delete(f"/api/auth/devices/{current['id']}").status_code==200
    assert client.get('/api/auth/me').status_code==401


def test_frontdesk_and_lab_do_not_see_clinical_data(client, login):
    private_doc=next(d['id'] for d in client.get(f'/api/patients/{P1}/documents').json() if d['source']!='lab')
    login('frontdesk')
    assert client.get('/api/schedule').status_code==200
    assert 'current_regimen' not in client.get('/api/patients').json()[0]
    assert client.get(f'/api/patients/{P1}/labs').status_code==403
    login('lab')
    assert private_doc not in [d['id'] for d in client.get('/api/documents/recent').json()]
    assert private_doc not in [d['id'] for d in client.get(f'/api/patients/{P1}/documents').json()]
    assert client.get(f'/api/documents/{private_doc}').status_code==403
    assert client.get(f'/api/patients/{P1}/medications').status_code==403


def test_audit_detects_tampering(client):
    assert client.get('/api/v2/audit/verify').json()['valid']
    from app.db import SessionLocal
    from app.round2_models import AuditChain
    with SessionLocal() as db:
        row=db.scalar(select(AuditChain).order_by(AuditChain.id).limit(1)); original=row.detail
        row.detail='tampered';db.commit()
        assert not client.get('/api/v2/audit/verify').json()['valid']
        row.detail=original;db.commit()
    assert client.get('/api/v2/audit/verify').json()['valid']


def test_no_midnight_data_reset(client):
    from app.db import SessionLocal
    from app.models import Meta
    from seed.loader import ensure_seeded
    before=client.get('/api/stats').json()['documents']
    with SessionLocal() as db:
        stamp=db.get(Meta,'seed_date');stamp.value='2000-01-01';db.commit()
    ensure_seeded()
    assert client.get('/api/stats').json()['documents']==before


def test_id_fields_are_encrypted_in_database(client):
    from app.db import SessionLocal
    with SessionLocal() as db:
        raw=db.execute(text('SELECT abha_id FROM patients WHERE id=:p'),{'p':P1}).scalar()
        assert raw.startswith('OBFIELD1:')


def test_unconfigured_services_return_actionable_placeholder(client, monkeypatch):
    monkeypatch.delenv('TRANSLATION_ADAPTER_URL',raising=False)
    r=client.post(f'/api/v2/patients/{P1}/integration',json={"service":"translation","payload":{"text":"Hello"},"consent":True})
    assert r.status_code==503 and 'TRANSLATION_ADAPTER_URL' in r.text


def test_library_production_approval_gate(client):
    from app.db import SessionLocal
    from app.round2_models import LibraryItem
    with SessionLocal() as db:
        item=db.scalar(select(LibraryItem).where(LibraryItem.key=='meals'));original=item.approved_by
        item.approved_by=None;db.commit()
        # A published item becomes invisible to patient guidance when approval is removed.
        assert not any(g['key']=='meals' for g in client.get(f'/api/v2/patients/{P1}/wellness').json()['guidance'])
        item.approved_by=original;db.commit()


def test_forecast_does_not_invent_missing_history(client):
    r=client.get(f'/api/v2/patients/{P1}/clinical')
    assert r.status_code==200,r.text
    assert all(x['expected'] is None for x in r.json()['forecast'] if not x['samples'])


def test_input_schema_does_not_allow_forged_approval(client, login):
    login('meera')
    r=client.post(f'/api/v2/patients/{P1}/records',json={"kind":"takeaway","data":{"text":"fake","approved_by":"doctor"}})
    assert r.status_code==422
    assert client.post(f'/api/v2/patients/{P1}/records',json={"kind":"roadmap","data":{"text":"fake","regimen":"fake"}}).status_code==403


def test_malformed_dates_and_cross_site_request(client):
    assert client.get('/api/schedule?day=bad').status_code==422
    assert client.post(f'/api/v2/patients/{P1}/chat',headers={'Origin':'https://untrusted.example'},json={'text':'hello'}).status_code==403


def test_pdf_pack_and_bulk_filing(client):
    pdf=client.get(f'/api/v2/patients/{P1}/pack.pdf')
    assert pdf.status_code==200 and pdf.content.startswith(b'%PDF')
    from app.config import DATA_DIR
    (DATA_DIR/'case-pack.pdf').write_bytes(pdf.content)
    from reportlab.pdfgen.canvas import Canvas
    b=io.BytesIO(); c=Canvas(b); c.drawString(40,700,f'Patient ID: {P1}');c.drawString(40,680,'Name: Meera Kulkarni');c.drawString(40,660,'Haemoglobin 9.4 g/dL');c.save()
    r=client.post(f'/api/v2/patients/{P1}/bulk-import',files={'file':('bundle.pdf',b.getvalue(),'application/pdf')})
    assert r.status_code==200,r.text
    row=r.json()
    body={'pages':[{'page':0,'group':1,'category':'Lab report','subtype':'CBC','date':'2026-10-18','title':'Verified imported CBC','confirmed':True}]}
    result=client.post(f"/api/v2/bulk-import/{row['id']}/confirm",json=body)
    assert result.status_code==200,result.text
    assert len(result.json()['documents'])==1
    assert client.post(f"/api/v2/bulk-import/{row['id']}/confirm",json=body).status_code==409


def test_reminder_jobs_idempotent(client):
    from app.services.jobs import tick
    from app.db import SessionLocal
    from app.round2_models import JobReceipt
    now=datetime.now().replace(hour=8,minute=0,second=0,microsecond=0)
    tick(now)
    with SessionLocal() as db:
        before=len(db.scalars(select(JobReceipt)).all())
    tick(now)
    with SessionLocal() as db:
        assert len(db.scalars(select(JobReceipt)).all())==before
