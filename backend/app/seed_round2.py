from .timeutil import utcnow
"""Idempotent Round 2 setup. Demo fixtures are always identified as fabricated."""
import os
from datetime import datetime, timedelta
from sqlalchemy import select
from .db import SessionLocal
from .models import Patient
from .round2_models import AccessGrant, Approval, CareRecord, LibraryItem, User, TreatingClinician
from .security import DEMO_MODE, cipher, password_hash

LIBRARY = [
    ("food_safety", "food", "Food safety during treatment", "https://www.cancer.gov/about-cancer/treatment/side-effects/infection", {
        "en": "Ask your team about food safety when your infection risk is high. Wash hands, use safe drinking water and handle food carefully. Seek prompt care for fever.",
        "hi": "संक्रमण का जोखिम अधिक होने पर भोजन की सुरक्षा के बारे में टीम से पूछें। हाथ धोएँ, सुरक्षित पानी पिएँ। बुखार होने पर तुरंत चिकित्सा सहायता लें।",
        "mr": "संसर्गाचा धोका जास्त असल्यास अन्नसुरक्षेबद्दल पथकाला विचारा. हात स्वच्छ धुवा आणि सुरक्षित पाणी प्या. ताप आल्यास त्वरित वैद्यकीय मदत घ्या."}),
    ("meals", "food", "Indian meal ideas for dietitian review", "https://www.cancer.gov/publications/patient-education/eating-hints", {
        "en": "Choose foods you tolerate and discuss protein and fluid needs with your dietitian. These meal ideas need adjustment for your own dietary restrictions.",
        "vegetarian": "Meal idea: freshly cooked dal, rice, cooked vegetables and curd if permitted by your team. Adjust portions with your dietitian.",
        "Jain": "Meal idea: freshly cooked moong dal, rice and permitted cooked vegetables without roots. Ask the dietitian to adjust for your restrictions.",
        "non-vegetarian": "Meal idea: thoroughly cooked egg or chicken, rice and cooked vegetables, if your treating team permits."}),
    ("soft_food", "food", "Soft foods for a sore mouth", "https://www.cancer.gov/about-cancer/treatment/side-effects/mouth-throat", {
        "en": "Discuss mouth pain with your team. Soft, moist, mild foods may be easier to eat; avoid foods that sting. Ask your dietitian to adapt the texture.",
        "vegetarian": "Soft-food idea: mild moong dal khichdi or well-cooked porridge, adjusted by your dietitian.",
        "Jain": "Soft-food idea: mild rice and moong dal without root vegetables, if tolerated.",
        "non-vegetarian": "Soft-food idea: mild porridge with a thoroughly cooked protein your team permits."}),
    ("activity", "activity", "Movement with your care team's agreement", "https://www.cancer.gov/about-cancer/treatment/side-effects/fatigue", {
        "en": "Ask your care team which movement is safe today. Try a short, comfortable activity with rest breaks. Stop and contact the team if symptoms occur.",
        "hi": "आज कौन सा व्यायाम सुरक्षित है, टीम से पूछें। छोटी, आरामदायक गतिविधि और विश्राम चुनें। लक्षण होने पर रुकें और टीम से संपर्क करें।",
        "mr": "आज कोणती हालचाल सुरक्षित आहे ते पथकाला विचारा. आरामदायक लहान कृती आणि विश्रांती निवडा. लक्षणे आल्यास थांबा आणि पथकाशी संपर्क साधा."}),
    ("rest", "activity", "Low-energy day ideas", "https://www.cancer.gov/about-cancer/treatment/side-effects/fatigue", {
        "en": "Let your team know about changing fatigue. A seated puzzle, music, a family conversation or a rest break can be part of the day. Ask for help with tiring tasks."}),
    ("mood", "support", "Listening and asking for support", "https://www.cancer.gov/about-cancer/coping/feelings", {
        "en": "You can tell your care team how cancer is affecting your mood and daily life. Ask about counselling, a support group or practical support for your family.",
        "hi": "अपनी भावनाओं और रोज़मर्रा की कठिनाइयों के बारे में टीम को बताएँ। परामर्श, सहायता समूह या परिवार के लिए सहायता माँग सकते हैं।",
        "mr": "भावना आणि रोजच्या अडचणींबद्दल पथकाशी बोला. समुपदेशन, आधार गट किंवा कुटुंबासाठी मदत मागू शकता."}),
    ("seasonal", "education", "Festival and weather planning", "https://www.cancer.gov/about-cancer/treatment/side-effects/infection", {
        "en": "Discuss travel, crowds, smoke exposure and drinking-water safety with your treating team. Live weather and air-quality data require a configured feed; no live AQI is inferred here."}),
    ("family", "education", "Explain cancer to my family", "https://www.cancer.gov/about-cancer/coping/feelings", {
        "en": "Cancer is an illness that doctors treat in different ways. The person having treatment may need help and rest. Children did not cause the illness. Ask the care team questions together.",
        "hi": "कैंसर एक बीमारी है जिसका डॉक्टर अलग-अलग तरीकों से इलाज करते हैं। इलाज ले रहे व्यक्ति को आराम और मदद की ज़रूरत हो सकती है। बच्चों ने यह बीमारी पैदा नहीं की। साथ मिलकर टीम से प्रश्न पूछें।",
        "mr": "कर्करोग हा एक आजार आहे ज्यावर डॉक्टर वेगवेगळे उपचार करतात. उपचार घेणाऱ्या व्यक्तीला विश्रांती आणि मदत लागू शकते. मुलांमुळे हा आजार झालेला नाही. एकत्र पथकाला प्रश्न विचारा."}),
]


def initialise():
    cipher()  # validate encryption configuration before serving requests
    from .models import Document
    from .config import STORAGE_DIR
    from .security import encrypt_file
    from sqlalchemy.orm.attributes import flag_modified
    with SessionLocal() as db:
        if not DEMO_MODE:
            from .models import Meta
            from .security import COOKIE_SECURE
            if db.get(Meta, "seed_date"):
                raise RuntimeError("Production must use a separate empty database, not the public demo accounts")
            if not COOKIE_SECURE:
                raise RuntimeError("Production requires COOKIE_SECURE=true and HTTPS")
        # Upgrade existing plaintext identifiers and files without dropping any tables.
        from sqlalchemy import text
        for p in db.scalars(select(Patient)):
            raw = db.execute(text("SELECT phone, abha_id FROM patients WHERE id=:id"), {"id": p.id}).first()
            if p.phone and raw[0] and not raw[0].startswith("OBFIELD1:"):
                flag_modified(p, "phone")
            if p.abha_id and raw[1] and not raw[1].startswith("OBFIELD1:"):
                flag_modified(p, "abha_id")
        db.commit()
        for doc in db.scalars(select(Document)):
            path = (STORAGE_DIR.parent / doc.file_path).resolve()
            if path.is_relative_to(STORAGE_DIR.resolve()) and path.exists():
                encrypt_file(path)
        if DEMO_MODE and not db.scalar(select(User.id).limit(1)):
            specs = [("doctor", "Dr. R. Menon", "doctor"), ("nurse", "Nurse Asha", "nurse"),
                     ("lab", "Lab technician Ravi", "lab"), ("frontdesk", "Reception Neha", "frontdesk"),
                     ("navigator", "Navigator Priya", "navigator"), ("dietitian", "Dietitian Anjali", "dietitian"),
                     ("privacy", "Privacy officer", "privacy"), ("admin", "Demo administrator", "admin"),
                     ("meera", "Meera Kulkarni", "patient"), ("rajesh", "Rajesh Iyer", "patient"),
                     ("caregiver", "Ananya (Meera's daughter)", "caregiver")]
            pats = list(db.scalars(select(Patient)))
            for username, name, role in specs:
                u = User(username=username, name=name, role=role, password_hash=password_hash("OncoDemo!2026"),
                         department="Biochemistry & Haematology Lab" if role == "lab" else "", ward="Day care" if role == "nurse" else "")
                db.add(u)
                db.flush()
                for p in pats:
                    if role == "privacy" or (role == "patient" and p.id != ("OB-2026-0001" if username == "meera" else "OB-2026-0002")) or (role == "caregiver" and p.id != "OB-2026-0001"):
                        continue
                    scopes = {"frontdesk": ["profile", "appointments"], "lab": ["profile", "documents"],
                              "navigator": ["profile", "appointments", "finance", "notes", "chat", "alerts"],
                              "dietitian": ["profile", "nutrition", "documents"]}.get(role, ["all"])
                    db.add(AccessGrant(user_id=u.id, patient_id=p.id, scopes=scopes, consent_by="Fabricated demo relationship"))
            db.commit()
        if DEMO_MODE:
            for username, pid in [("meera", "OB-2026-0001"), ("rajesh", "OB-2026-0002")]:
                u, p = db.scalar(select(User).where(User.username == username)), db.get(Patient, pid)
                if u and p and not u.phone:
                    import re
                    u.phone = re.sub(r"[^+0-9]", "", p.phone or "")
            db.commit()
        if not DEMO_MODE and not db.scalar(select(User.id).limit(1)):
            password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
            secret = os.getenv("BOOTSTRAP_ADMIN_TOTP_SECRET", "")
            if len(password) < 12 or not secret:
                raise RuntimeError("Set BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_ADMIN_TOTP_SECRET for the initial administrator")
            db.add(User(username=os.getenv("BOOTSTRAP_ADMIN_USERNAME", "admin"), name="Hospital administrator", role="admin", password_hash=password_hash(password), totp_secret=secret))
            db.commit()
        for key, category, title, url, content in LIBRARY:
            if not db.scalar(select(LibraryItem.id).where(LibraryItem.key == key)):
                db.add(LibraryItem(key=key, category=category, title=title, source_url=url, content=content,
                                   approved_by="DEMO approval only; replace with clinical review" if DEMO_MODE else None,
                                   approved_at=utcnow() if DEMO_MODE else None))
        if DEMO_MODE:
            for p in db.scalars(select(Patient)):
                doctor=db.scalar(select(User).where(User.role=="doctor",User.name==p.treating_oncologist))
                if doctor and not db.get(TreatingClinician,p.id):
                    db.add(TreatingClinician(patient_id=p.id,user_id=doctor.id))
            db.commit()
        # Never add clinical data to production accounts.
        if DEMO_MODE and not db.scalar(select(CareRecord.id).limit(1)):
            doctor = db.scalar(select(User).where(User.username == "doctor"))
            p = db.get(Patient, "OB-2026-0001")
            if p and doctor:
                for kind, data in [
                    ("preferences", {"goals": "Stay involved in family life and return to work", "worries": "Nausea, travel costs and missing a dose", "diet": "vegetarian", "travel_km": 180}),
                    ("clinical_profile", {"allergies": "None recorded in this fabricated fixture; verify clinically", "height_cm": 158, "weight_kg": 58, "egfr": 82, "blood_group": "O+", "ward": "Day care", "biomarkers": "HER2 negative"}),
                    ("roadmap", {"text": "Fabricated demo roadmap: review blood tests before the next cycle.", "regimen": p.current_regimen, "cycle": 4, "total_cycles": 6, "cycle_start": datetime.now().date().isoformat(), "cycle_days": 21, "side_effect_days": "Ask the treating team for the regimen-specific symptom calendar."}),
                    ("measurement", {"site": "left_breast", "size_mm": 31, "date": (datetime.now() - timedelta(days=60)).date().isoformat(), "finding": "tumour", "text": "Fabricated demonstration measurement"}),
                    ("measurement", {"site": "left_breast", "size_mm": 19, "date": datetime.now().date().isoformat(), "finding": "tumour", "text": "Fabricated demonstration measurement"}),
                ]:
                    db.add(CareRecord(patient_id=p.id, kind=kind, author_id=doctor.id, author_name=doctor.name, author_role="doctor", data=data,
                                       status="approved" if kind == "roadmap" else "recorded", approved_by="Demo clinician" if kind == "roadmap" else None))
                db.add(Approval(patient_id=p.id, kind="medicine", request="Please review nausea support", requested_by="Meera (demo)",
                                draft={"text": "Review recorded nausea and current supportive medicines. No new drug selected automatically."}))
        db.commit()
