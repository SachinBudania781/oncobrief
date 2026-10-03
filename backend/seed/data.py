"""Demo world. EVERY person, hospital, doctor and value below is fabricated for the prototype.

Dates are offsets in days from "today" (the day the demo is seeded), written {d-84} inside text.
Formats: "pdf" = digital report with a text layer, "scan" = scanned page (OCR needed),
"photo" = phone photo uploaded by a patient (lower quality, OCR needed)."""

HOME = "OncoBrief Demo Cancer Centre, Mumbai"
RIVERSIDE = "Riverside Demo Hospital, Nashik"
WOMENS = "Demo Women's Clinic, Thane"
CITYLAB = "CityCare Demo Diagnostics, Thane"
ONCOLOGIST = "Dr. R. Menon"

PATIENTS = [
    dict(id="OB-2026-0001", name="Meera Kulkarni", sex="F", age=52, abha_id="91-4821-7730-5512",
         phone="+91 90000 00001", preferred_language="mr",
         cancer_type="Carcinoma left breast (IDC), ER+/PR+/HER2-", stage="cT2N1M0, Stage IIB",
         diagnosis_day=-118, treating_oncologist=ONCOLOGIST,
         current_regimen="Neoadjuvant AC x4 (q21d) completed {d-21}; weekly paclitaxel x12 planned",
         referred_from=None),
    dict(id="OB-2026-0002", name="Rajesh Iyer", sex="M", age=61, abha_id="91-7702-3318-4409",
         phone="+91 90000 00002", preferred_language="en",
         cancer_type="Adenocarcinoma right lung, EGFR exon 19 deletion", stage="Stage IVA (malignant pleural effusion)",
         diagnosis_day=-296, treating_oncologist=ONCOLOGIST,
         current_regimen="Osimertinib 80 mg once daily since {d-278}", referred_from=f"{RIVERSIDE} (Dr. K. Rao)"),
    dict(id="OB-2026-0003", name="Fatima Shaikh", sex="F", age=45, abha_id=None,
         phone="+91 90000 00003", preferred_language="hi",
         cancer_type="Carcinoma cervix (outside biopsy: squamous cell carcinoma)", stage="Staging pending",
         diagnosis_day=-16, treating_oncologist=ONCOLOGIST, current_regimen=None,
         referred_from=f"Dr. F. Siddiqui, {WOMENS}"),
    dict(id="OB-2026-0004", name="Arjun Patil", sex="M", age=34, abha_id="91-2290-6611-0083",
         phone="+91 90000 00004", preferred_language="mr",
         cancer_type="Classical Hodgkin lymphoma, nodular sclerosis", stage="Stage IIA",
         diagnosis_day=-115, treating_oncologist=ONCOLOGIST,
         current_regimen="ABVD, cycle 3 of 6 (day 1 given {d-14}; day 15 due today)", referred_from=None),
    dict(id="OB-2026-0005", name="Lakshmi Narayanan", sex="F", age=67, abha_id="91-5512-0094-7781",
         phone="+91 90000 00005", preferred_language="en",
         cancer_type="Adenocarcinoma sigmoid colon", stage="pT3N1aM0, Stage IIIB",
         diagnosis_day=-170, treating_oncologist=ONCOLOGIST,
         current_regimen="Adjuvant FOLFOX x12 completed {d-55}; on surveillance", referred_from=None),
    # schedule-only patients (no records needed for the demo)
    dict(id="OB-2026-0006", name="Suresh Gaikwad", sex="M", age=58, abha_id=None, phone="+91 90000 00006",
         preferred_language="mr", cancer_type="Carcinoma oral cavity (buccal mucosa)", stage="Stage III",
         diagnosis_day=-200, treating_oncologist=ONCOLOGIST, current_regimen="Post-op chemoradiation completed",
         referred_from=None),
    dict(id="OB-2026-0007", name="Anita Desai", sex="F", age=49, abha_id=None, phone="+91 90000 00007",
         preferred_language="en", cancer_type="High-grade serous carcinoma ovary", stage="Stage IIIC",
         diagnosis_day=-90, treating_oncologist=ONCOLOGIST, current_regimen="Carboplatin-paclitaxel, cycle 4",
         referred_from=None),
    dict(id="OB-2026-0008", name="Mohammed Rafiq", sex="M", age=63, abha_id=None, phone="+91 90000 00008",
         preferred_language="hi", cancer_type="Adenocarcinoma prostate", stage="Stage IVB",
         diagnosis_day=-400, treating_oncologist=ONCOLOGIST, current_regimen="ADT + abiraterone",
         referred_from=None),
    dict(id="OB-2026-0009", name="Priya Nair", sex="F", age=38, abha_id=None, phone="+91 90000 00009",
         preferred_language="en", cancer_type="Carcinoma right breast, triple negative", stage="Stage IIA",
         diagnosis_day=-60, treating_oncologist=ONCOLOGIST, current_regimen="Neoadjuvant chemotherapy",
         referred_from=None),
    dict(id="OB-2026-0010", name="Kavita Joshi", sex="F", age=55, abha_id=None, phone="+91 90000 00010",
         preferred_language="mr", cancer_type="Carcinoma cervix", stage="Stage IIB",
         diagnosis_day=-45, treating_oncologist=ONCOLOGIST, current_regimen="Chemoradiation, week 4",
         referred_from=None),
]


def doc(pid, day, time, category, subtype, title, fmt="pdf", dept=None, source="staff", hospital=None,
        signer=None, sections=None, labs=None, quality="good"):
    return dict(pid=pid, day=day, time=time, category=category, subtype=subtype, title=title, fmt=fmt, dept=dept,
                source=source, hospital=hospital, signer=signer, sections=sections or [], labs=labs or [],
                quality=quality)


P1, P2, P3, P4, P5 = (p["id"] for p in PATIENTS[:5])
RAD = "Dr. A. Joshi, MD (Radiodiagnosis)"
PATH = "Dr. P. Deshmukh, MD (Pathology)"
LAB = "Dr. M. Pillai, MD (Pathology) - Lab Director"

DOCUMENTS = [
    # ------------------------------------------------------------------ Meera — breast, follow-up
    doc(P1, -125, "11:20", "Imaging", "Mammogram", "Bilateral mammogram", "scan", signer=RAD, sections=[
        ("CLINICAL HISTORY", "Palpable lump in the left breast for 2 months."),
        ("FINDINGS", "Irregular high-density mass with spiculated margins in the upper outer quadrant of the "
                     "left breast measuring 3.2 x 2.8 cm, with associated pleomorphic microcalcifications. "
                     "Right breast is unremarkable."),
        ("IMPRESSION", "Left breast upper outer quadrant spiculated mass, BI-RADS 5. Tissue sampling advised.")]),
    doc(P1, -122, "10:05", "Imaging", "Ultrasound", "USG left breast and axilla", signer=RAD, sections=[
        ("FINDINGS", "Irregular hypoechoic mass 3.1 x 2.6 cm at 2 o'clock in the left breast, 4 cm from the nipple. "
                     "Two enlarged left axillary lymph nodes with loss of fatty hilum, largest 1.8 cm."),
        ("IMPRESSION", "Left breast mass, BI-RADS 5, with suspicious left axillary nodes. USG-guided core biopsy "
                       "of the breast lesion and FNAC of the axillary node performed on {d-122}.")]),
    doc(P1, -118, "16:40", "Pathology", "Biopsy histopathology", "Core biopsy - left breast mass", signer=PATH,
        sections=[
        ("SPECIMEN", "Core biopsy, left breast mass, 4 cores."),
        ("MICROSCOPY", "Sheets and nests of malignant ductal epithelial cells with moderate nuclear pleomorphism; "
                       "mitoses 8/10 hpf. No lymphovascular invasion seen in the cores."),
        ("FINAL DIAGNOSIS", "Invasive ductal carcinoma, left breast, Nottingham grade 2 (3+2+2).")]),
    doc(P1, -118, "17:10", "Pathology", "FNAC", "FNAC - left axillary lymph node", "scan", signer=PATH, sections=[
        ("MICROSCOPY", "Smears show clusters of atypical epithelial cells in a background of lymphocytes."),
        ("DIAGNOSIS", "Metastatic carcinoma in left axillary lymph node, consistent with breast primary.")]),
    doc(P1, -115, "15:00", "Pathology", "IHC / receptor status", "IHC panel - breast core biopsy", signer=PATH,
        sections=[
        ("RESULTS", "ER: Positive (Allred 8/8, 90% strong). PR: Positive (Allred 6/8, 60%). "
                    "HER2/neu: 1+ (Negative). Ki-67: 30%."),
        ("INTERPRETATION", "Hormone receptor positive, HER2-negative invasive ductal carcinoma (luminal B-like).")]),
    doc(P1, -110, "13:30", "Imaging", "PET-CT", "Whole-body PET-CT (staging)", signer=RAD, sections=[
        ("FINDINGS", "FDG-avid irregular mass in the left breast upper outer quadrant, 3.3 cm, SUVmax 8.4. "
                     "FDG-avid left level I axillary nodes, largest 1.9 cm, SUVmax 4.1. No FDG-avid lesion in the "
                     "liver, lungs, bones or brain parenchyma."),
        ("IMPRESSION", "Left breast primary with left axillary nodal disease. No evidence of distant metastasis.")]),
    doc(P1, -110, "09:15", "Lab report", "Tumour marker", "CA 15-3", "scan", signer=LAB, labs=[("CA 15-3", 48)]),
    doc(P1, -108, "12:00", "Imaging", "Echocardiogram / ECG", "2D Echocardiogram (baseline)",
        signer="Dr. V. Shetty, DM (Cardiology)", sections=[
        ("FINDINGS", "Normal chamber dimensions. No regional wall motion abnormality. Valves normal."),
        ("IMPRESSION", "Normal LV systolic function, LVEF 62%.")]),
    doc(P1, -107, "17:30", "Clinical note", "Tumour board note", "Breast DMG tumour board", signer=ONCOLOGIST,
        sections=[
        ("CASE", "52F, left breast IDC grade 2, ER+/PR+/HER2-, Ki-67 30%, cT2N1M0 (PET-CT {d-110})."),
        ("DECISION", "Neoadjuvant chemotherapy AC x4 followed by weekly paclitaxel x12, then surgery. "
                     "Endocrine therapy after surgery.")]),
    doc(P1, -105, "11:00", "Clinical note", "Consultation transcript", "New patient consultation", signer=ONCOLOGIST,
        sections=[
        ("HISTORY", "Seen with husband. Left breast lump for 2 months, no bone pain, no breathlessness. "
                    "No comorbidities. Post-menopausal."),
        ("ASSESSMENT", "Left breast IDC, HR+/HER2-, Stage IIB. Discussed tumour board decision; patient counselled on "
                       "hair loss, nausea and infection risk; consent taken."),
        ("PLAN", "Start AC cycle 1 on {d-84}. CBC, LFT and KFT before each cycle. Echo baseline done (LVEF 62%).")]),
    doc(P1, -85, "08:40", "Lab report", "CBC", "Complete blood count", "scan", signer=LAB,
        labs=[("Haemoglobin", 12.6), ("WBC", 7.2), ("ANC", 4.6), ("Platelets", 285)]),
    doc(P1, -85, "08:40", "Lab report", "LFT", "Liver function test", signer=LAB,
        labs=[("Bilirubin", 0.6), ("ALT", 22), ("AST", 25), ("Albumin", 4.2)]),
    doc(P1, -85, "08:40", "Lab report", "KFT / RFT", "Kidney function test", signer=LAB,
        labs=[("Creatinine", 0.8), ("Sodium", 139), ("Potassium", 4.1)]),
    doc(P1, -84, "10:30", "Treatment", "Chemotherapy cycle note", "AC cycle 1 of 4", dept="Day-care Chemotherapy",
        signer=ONCOLOGIST, sections=[
        ("REGIMEN", "AC cycle 1 of 4. Height 158 cm, weight 62 kg, BSA 1.65 m2. Doxorubicin 60 mg/m2 = 99 mg IV; "
                    "cyclophosphamide 600 mg/m2 = 990 mg IV."),
        ("PREMEDICATION", "Ondansetron 8 mg IV, dexamethasone 8 mg IV, aprepitant 125 mg oral."),
        ("SUMMARY", "Tolerated well. Next cycle due {d-63}.")]),
    doc(P1, -64, "08:35", "Lab report", "CBC", "Complete blood count", signer=LAB,
        labs=[("Haemoglobin", 11.8), ("WBC", 5.1), ("ANC", 3.0), ("Platelets", 240)]),
    doc(P1, -63, "10:30", "Treatment", "Chemotherapy cycle note", "AC cycle 2 of 4", dept="Day-care Chemotherapy",
        signer=ONCOLOGIST, sections=[
        ("INTERVAL HISTORY", "Grade 1 nausea days 2-4 after cycle 1, managed with oral ondansetron. Weight 61 kg."),
        ("SUMMARY", "AC cycle 2 given, doses unchanged. Cumulative doxorubicin 120 mg/m2. Next cycle {d-42}.")]),
    doc(P1, -43, "08:50", "Lab report", "CBC", "Complete blood count", "scan", signer=LAB,
        labs=[("Haemoglobin", 10.9), ("WBC", 4.0), ("ANC", 2.1), ("Platelets", 210)]),
    doc(P1, -42, "10:00", "Clinical note", "Consultation transcript", "Follow-up consultation (pre cycle 3)",
        signer=ONCOLOGIST, sections=[
        ("HISTORY", "Reports tiredness and mild mouth soreness. Hair loss complete. Eating well."),
        ("EXAMINATION", "Left breast lump clinically smaller, about 2.2 cm. Axilla: small mobile node."),
        ("PLAN", "Continue AC. Cycle 4 on {d-21}. CBC before cycle. Response USG after AC.")]),
    doc(P1, -42, "11:30", "Treatment", "Chemotherapy cycle note", "AC cycle 3 of 4", dept="Day-care Chemotherapy",
        signer=ONCOLOGIST, sections=[
        ("INTERVAL HISTORY", "Grade 2 fatigue, grade 1 mucositis. Weight 60 kg."),
        ("SUMMARY", "AC cycle 3 given, doses unchanged. Cumulative doxorubicin 180 mg/m2.")]),
    doc(P1, -22, "08:45", "Lab report", "CBC", "Complete blood count", "scan", signer=LAB,
        labs=[("Haemoglobin", 10.1), ("WBC", 3.6), ("ANC", 1.6), ("Platelets", 180)]),
    doc(P1, -22, "08:45", "Lab report", "LFT", "Liver function test", signer=LAB,
        labs=[("Bilirubin", 0.8), ("ALT", 46), ("AST", 39), ("Albumin", 3.8)]),
    doc(P1, -21, "10:45", "Treatment", "Chemotherapy cycle note", "AC cycle 4 of 4 (final AC)",
        dept="Day-care Chemotherapy", signer=ONCOLOGIST, sections=[
        ("INTERVAL HISTORY", "Grade 2 fatigue. ANC 1.6 on {d-22}, above the unit threshold of 1.5 - proceeded."),
        ("SUMMARY", "AC cycle 4 given. AC completed. Cumulative doxorubicin 240 mg/m2."),
        ("PLAN", "Weekly paclitaxel x12 to start after review. Repeat echo and response USG before taxane.")]),
    doc(P1, -10, "12:10", "Imaging", "Ultrasound", "USG left breast and axilla (response)", "scan", signer=RAD,
        sections=[
        ("FINDINGS", "Left breast mass now 1.9 x 1.5 cm (was 3.1 x 2.6 cm on {d-122}). Left axillary node 0.9 cm "
                     "with partially restored fatty hilum."),
        ("IMPRESSION", "Partial response in the left breast mass and axillary node after 4 cycles of AC.")]),
    doc(P1, -6, "19:20", "Patient-reported", "Outside report photo", "Blood sugar report (local lab)", "photo",
        dept="Patient", source="patient", hospital=CITYLAB, signer="CityCare Demo Diagnostics", sections=[
        ("TEST", "Random blood sugar: 168 mg/dL (reference 70-140)."),
        ("REMARK", "Sample collected at home on {d-6}.")]),

    # ------------------------------------------------------------------ Rajesh — lung, hospital transfer
    doc(P2, -302, "14:00", "Imaging", "CT", "CECT thorax", source="external", hospital=RIVERSIDE,
        signer="Dr. S. Kale, MD (Radiology)", sections=[
        ("FINDINGS", "4.2 x 3.6 cm spiculated mass in the right upper lobe. Enlarged right paratracheal (1.6 cm) and "
                     "subcarinal (1.4 cm) nodes. Moderate right pleural effusion. No bone lesion in the scanned field."),
        ("IMPRESSION", "Right upper lobe mass with mediastinal adenopathy and right pleural effusion, likely primary "
                       "lung malignancy.")]),
    doc(P2, -298, "16:00", "Pathology", "Cytology", "Pleural fluid cytology", "scan", source="external",
        hospital=RIVERSIDE, signer="Dr. N. Gokhale, MD (Pathology)", sections=[
        ("DIAGNOSIS", "Positive for malignant cells - metastatic adenocarcinoma. Cell block: TTF-1 positive, "
                      "Napsin-A positive.")]),
    doc(P2, -296, "15:30", "Pathology", "Biopsy histopathology", "CT-guided biopsy - right upper lobe",
        source="external", hospital=RIVERSIDE, signer="Dr. N. Gokhale, MD (Pathology)", sections=[
        ("FINAL DIAGNOSIS", "Adenocarcinoma, acinar predominant, right upper lobe of lung. TTF-1 positive.")]),
    doc(P2, -290, "11:00", "Pathology", "Molecular / genomics", "Lung cancer molecular panel", source="external",
        hospital=RIVERSIDE, signer="Dr. N. Gokhale, MD (Pathology)", sections=[
        ("RESULT", "EGFR exon 19 deletion (p.E746_A750del) DETECTED. EGFR T790M not detected. ALK (D5F3) IHC "
                   "negative. ROS1 negative. PD-L1 (22C3) TPS 20%.")]),
    doc(P2, -278, "12:00", "Clinical note", "Discharge summary", "Discharge summary", "scan", source="external",
        hospital=RIVERSIDE, signer="Dr. K. Rao, DM (Medical Oncology)", sections=[
        ("SUMMARY", "Admitted {d-284} with breathlessness. Therapeutic pleural tap (1.2 L) and pleurodesis done. "
                    "Diagnosis: adenocarcinoma lung, EGFR exon 19 deletion, Stage IVA. Started osimertinib 80 mg "
                    "once daily on {d-278}. Discharged stable."),
        ("ADVICE", "Review in 4 weeks with CBC, LFT, ECG.")]),
    doc(P2, -278, "10:00", "Imaging", "Echocardiogram / ECG", "Baseline ECG", source="external", hospital=RIVERSIDE,
        signer="Dr. K. Rao, DM (Medical Oncology)", sections=[
        ("INTERPRETATION", "Sinus rhythm, rate 78/min. QTc 428 ms.")]),
    doc(P2, -190, "13:00", "Imaging", "CT", "CECT thorax (response assessment)", source="external",
        hospital=RIVERSIDE, signer="Dr. S. Kale, MD (Radiology)", sections=[
        ("IMPRESSION", "Partial response: right upper lobe mass reduced to 2.1 x 1.7 cm (from 4.2 x 3.6 cm). "
                       "Mediastinal nodes subcentimetric. Pleural effusion resolved.")]),
    doc(P2, -100, "13:00", "Imaging", "CT", "CECT thorax and abdomen", "scan", source="external", hospital=RIVERSIDE,
        signer="Dr. S. Kale, MD (Radiology)", sections=[
        ("IMPRESSION", "Stable disease compared with the study of {d-190}. No new lesion in thorax or abdomen.")]),
    doc(P2, -60, "09:00", "Lab report", "LFT", "Liver function test", "scan", source="external", hospital=RIVERSIDE,
        signer="Riverside Demo Hospital Laboratory", labs=[("Bilirubin", 0.7), ("ALT", 48), ("AST", 41),
                                                            ("Albumin", 4.0)]),
    doc(P2, -60, "10:00", "Imaging", "Echocardiogram / ECG", "ECG", source="external", hospital=RIVERSIDE,
        signer="Dr. K. Rao, DM (Medical Oncology)", sections=[
        ("INTERPRETATION", "Sinus rhythm, rate 74/min. QTc 452 ms (baseline 428 ms on {d-278}).")]),
    doc(P2, -14, "18:00", "Imaging", "MRI", "MRI brain with contrast", source="external", hospital=RIVERSIDE,
        signer="Dr. S. Kale, MD (Radiology)", sections=[
        ("CLINICAL HISTORY", "Morning headache for 2 weeks."),
        ("IMPRESSION", "Two new small enhancing lesions - right frontal 6 mm and left cerebellar 4 mm - with minimal "
                       "perilesional oedema, suspicious for metastases. No midline shift.")]),
    doc(P2, -10, "12:00", "Clinical note", "Referral letter", "Referral letter - transfer of care",
        source="external", hospital=RIVERSIDE, signer="Dr. K. Rao, DM (Medical Oncology)", sections=[
        ("REASON FOR REFERRAL", "Family relocating to Mumbai - transfer of care for continuation of osimertinib "
                                "and opinion on new brain lesions on MRI dated {d-14}."),
        ("TREATMENT SUMMARY", "Osimertinib 80 mg OD since {d-278}; partial response on CT {d-190}, stable on "
                              "{d-100}. Pleurodesis {d-283}. No prior chemotherapy or radiotherapy."),
        ("CURRENT MEDICATIONS", "Osimertinib 80 mg once daily.")]),
    doc(P2, -2, "08:30", "Lab report", "CBC", "Complete blood count", signer=LAB,
        labs=[("Haemoglobin", 12.9), ("WBC", 6.8), ("ANC", 4.1), ("Platelets", 220)]),
    doc(P2, -2, "08:30", "Lab report", "KFT / RFT", "Kidney function test", signer=LAB,
        labs=[("Creatinine", 1.1), ("Sodium", 138), ("Potassium", 4.2)]),

    # ------------------------------------------------------------------ Fatima — cervix, new patient
    doc(P3, -24, "11:00", "Pathology", "Cytology", "Pap smear (liquid based cytology)", source="external",
        hospital=WOMENS, signer="CityCare Demo Diagnostics - Cytopathology", sections=[
        ("INTERPRETATION", "High-grade squamous intraepithelial lesion (HSIL); cannot exclude invasion.")]),
    doc(P3, -21, "16:30", "Clinical note", "Referral letter", "Referral letter from gynaecologist", "scan",
        dept="Front desk / Records", source="external", hospital=WOMENS, signer="Dr. F. Siddiqui, MS (OBGY)",
        sections=[
        ("REASON FOR REFERRAL", "45-year-old with post-coital bleeding for 3 months. Pap smear HSIL. Colposcopy: "
                                "exophytic growth on the anterior lip of the cervix; punch biopsy taken. Kindly "
                                "evaluate and manage."),
        ("HISTORY", "P2L2, both normal deliveries. No known comorbidities.")]),
    doc(P3, -16, "20:15", "Pathology", "Biopsy histopathology", "Cervical punch biopsy (photo of outside report)",
        "photo", dept="Patient", source="patient", hospital=CITYLAB, signer="CityCare Demo Diagnostics",
        quality="poor", sections=[
        ("FINAL DIAGNOSIS", "Invasive squamous cell carcinoma, keratinizing, moderately differentiated, cervix.")]),
    doc(P3, -12, "10:00", "Imaging", "Ultrasound", "USG abdomen and pelvis", source="external", hospital=CITYLAB,
        signer="Dr. T. Shah, DMRD", sections=[
        ("FINDINGS", "Bulky cervix with a heterogeneous lesion 4.1 x 3.5 cm. Both kidneys normal, no "
                     "hydronephrosis. No ascites. Uterus and ovaries normal."),
        ("IMPRESSION", "Cervical mass 4.1 cm. No hydronephrosis.")]),
    doc(P3, -5, "09:10", "Lab report", "CBC", "Complete blood count", "scan", signer=LAB,
        labs=[("Haemoglobin", 10.2), ("WBC", 7.9), ("ANC", 5.0), ("Platelets", 312)]),
    doc(P3, -5, "09:10", "Lab report", "KFT / RFT", "Kidney function test", signer=LAB,
        labs=[("Creatinine", 0.8), ("Sodium", 140), ("Potassium", 4.4)]),

    # ------------------------------------------------------------------ Arjun — Hodgkin, follow-up
    doc(P4, -115, "15:00", "Pathology", "Biopsy histopathology", "Excision biopsy - left cervical lymph node",
        signer=PATH, sections=[
        ("FINAL DIAGNOSIS", "Classical Hodgkin lymphoma, nodular sclerosis type. Reed-Sternberg cells CD30+, CD15+, "
                            "PAX5 weak, CD20 negative.")]),
    doc(P4, -110, "12:00", "Imaging", "PET-CT", "Whole-body PET-CT (baseline)", signer=RAD, sections=[
        ("IMPRESSION", "FDG-avid left cervical and mediastinal nodes, largest 3.4 cm, SUVmax 11.2. No extranodal "
                       "disease. Stage IIA.")]),
    doc(P4, -108, "11:00", "Treatment", "Function test (PFT etc.)", "Pulmonary function test (baseline)",
        signer="Dr. H. Kapoor, MD (Pulmonary Medicine)", sections=[
        ("RESULT", "FEV1/FVC normal. DLCO 92% predicted.")]),
    doc(P4, -105, "10:30", "Treatment", "Chemotherapy cycle note", "ABVD cycle 1 day 1", dept="Day-care Chemotherapy",
        signer=ONCOLOGIST, sections=[("SUMMARY", "ABVD cycle 1 day 1 given. Tolerated well.")]),
    doc(P4, -14, "10:30", "Treatment", "Chemotherapy cycle note", "ABVD cycle 3 day 1", dept="Day-care Chemotherapy",
        signer=ONCOLOGIST, sections=[("SUMMARY", "ABVD cycle 3 day 1 given after interim PET. Grade 1 nausea.")]),
    doc(P4, -20, "12:00", "Imaging", "PET-CT", "Interim PET-CT (after 2 cycles)", signer=RAD, sections=[
        ("IMPRESSION", "Deauville score 2 - complete metabolic response after 2 cycles of ABVD.")]),
    doc(P4, -8, "11:00", "Treatment", "Function test (PFT etc.)", "Pulmonary function test (repeat)",
        signer="Dr. H. Kapoor, MD (Pulmonary Medicine)", sections=[
        ("RESULT", "FEV1/FVC normal. DLCO 81% predicted (baseline 92% on {d-108}).")]),
    doc(P4, -3, "08:30", "Lab report", "CBC", "Complete blood count", signer=LAB,
        labs=[("Haemoglobin", 12.8), ("WBC", 4.4), ("ANC", 2.4), ("Platelets", 230)]),

    # ------------------------------------------------------------------ Lakshmi — colon, surveillance
    doc(P5, -172, "14:00", "Pathology", "Biopsy histopathology", "Colonoscopic biopsy - sigmoid colon", signer=PATH,
        sections=[("FINAL DIAGNOSIS", "Moderately differentiated adenocarcinoma, sigmoid colon.")]),
    doc(P5, -170, "09:00", "Lab report", "Tumour marker", "CEA", signer=LAB, labs=[("CEA", 8.2)]),
    doc(P5, -150, "13:00", "Treatment", "Surgery / operative note", "Laparoscopic sigmoid colectomy",
        dept="Surgical Oncology", signer="Dr. G. Iqbal, MCh (Surgical Oncology)", sections=[
        ("PROCEDURE", "Laparoscopic sigmoid colectomy with primary anastomosis. No liver or peritoneal deposits.")]),
    doc(P5, -144, "16:00", "Pathology", "Biopsy histopathology", "Resection specimen - sigmoid colon",
        signer=PATH, sections=[
        ("FINAL DIAGNOSIS", "Adenocarcinoma, moderately differentiated, pT3N1a (1/16 nodes). Margins clear. "
                            "Lymphovascular invasion present. MMR proficient.")]),
    doc(P5, -120, "09:00", "Lab report", "Tumour marker", "CEA", "scan", signer=LAB, labs=[("CEA", 3.1)]),
    doc(P5, -80, "09:00", "Lab report", "Tumour marker", "CEA", signer=LAB, labs=[("CEA", 2.6)]),
    doc(P5, -42, "10:00", "Imaging", "CT", "CECT abdomen and pelvis (post-treatment)", signer=RAD, sections=[
        ("IMPRESSION", "Post sigmoid colectomy status. No evidence of local recurrence or distant metastasis.")]),
    doc(P5, -40, "11:00", "Clinical note", "Consultation transcript", "Follow-up consultation", signer=ONCOLOGIST,
        sections=[
        ("HISTORY", "Completed adjuvant FOLFOX cycle 12 on {d-55}. Persistent tingling in fingers and toes, "
                    "grade 2, not affecting buttoning."),
        ("PLAN", "Surveillance. CEA every 3 months, CT at 6 months.")]),
    doc(P5, -40, "09:00", "Lab report", "Tumour marker", "CEA", signer=LAB, labs=[("CEA", 3.4)]),
    doc(P5, -6, "09:00", "Lab report", "Tumour marker", "CEA", "scan", signer=LAB, labs=[("CEA", 5.9)]),
]

# today's scanner page (demo: staff "scans" this for Meera and the brief picks it up)
SCANNER_SAMPLES = [
    doc(P1, 0, "08:40", "Lab report", "CBC", "Complete blood count", "scan", signer=LAB,
        labs=[("Haemoglobin", 9.4), ("WBC", 3.1), ("ANC", 1.2), ("Platelets", 162)], quality="clean"),
]

MEDICATIONS = [
    (P1, "Ondansetron", "8 mg", "Twice daily for 3 days after chemo, then if needed", ["08:00", "20:00"]),
    (P1, "Pantoprazole", "40 mg", "Once daily before breakfast", ["07:30"]),
    (P1, "Calcium + Vitamin D3", "500 mg", "Once daily at night", ["21:00"]),
    (P2, "Osimertinib", "80 mg", "Once daily", ["09:00"]),
    (P3, "Ferrous ascorbate", "100 mg", "Once daily after lunch", ["14:00"]),
    (P4, "Ondansetron", "4 mg", "Twice daily for 2 days after chemo", ["08:00", "20:00"]),
    (P5, "Vitamin B12 + folic acid", "1 tab", "Once daily", ["09:00"]),
]

# (patient, day, time, medicine name, status)
MED_LOGS = [
    (P1, -16, "20:00", "Ondansetron", "missed"), (P1, -15, "20:00", "Ondansetron", "missed"),
    (P1, -16, "08:00", "Ondansetron", "taken"), (P1, -15, "08:00", "Ondansetron", "taken"),
    (P1, -1, "07:30", "Pantoprazole", "taken"), (P1, 0, "07:30", "Pantoprazole", "taken"),
    (P2, -1, "09:00", "Osimertinib", "taken"), (P2, -3, "09:00", "Osimertinib", "missed"),
]

# (patient, day, time, language, [(symptom key, grade)], missed meds, free text)
SYMPTOM_REPORTS = [
    (P1, -16, "21:10", "mr", [("nausea", 2), ("fatigue", 2), ("mouth_sores", 1)], ["Ondansetron 8 mg (evening)"],
     "Vomited on day 3 after chemo, could not keep the evening tablets down."),
    (P1, -8, "07:45", "mr", [("fever", 1), ("fatigue", 2)], [],
     "Fever 38.1 C one night, settled with paracetamol. Can I attend my niece's wedding next month?"),
    (P2, -5, "09:30", "en", [("headache", 1), ("diarrhoea", 1), ("rash", 1)], [],
     "Mild headache most mornings, better by noon."),
    (P3, -3, "18:00", "hi", [("bleeding", 2), ("pain", 1), ("fatigue", 1)], [],
     "Spotting almost every day. Is this treatable?"),
    (P4, -6, "20:00", "mr", [("cough", 1), ("fatigue", 1), ("tingling", 1)], [], "Dry cough at night for a week."),
    (P5, -9, "10:00", "en", [("tingling", 2), ("fatigue", 1)], [], "Tingling in fingers still there."),
]

# (patient, department, room, clinician, start "HH:MM", minutes, visit_type, notes)
APPOINTMENTS_TODAY = [
    ("OB-2026-0006", "Medical Oncology OPD", "OPD-3", ONCOLOGIST, "09:30", 20, "follow_up", None),
    ("OB-2026-0007", "Medical Oncology OPD", "OPD-3", ONCOLOGIST, "10:00", 20, "follow_up", None),
    (P1, "Medical Oncology OPD", "OPD-3", ONCOLOGIST, "10:30", 20, "follow_up", "Post AC review, plan taxane"),
    (P2, "Medical Oncology OPD", "OPD-3", ONCOLOGIST, "11:00", 30, "transfer", "Transfer from Nashik"),
    (P3, "Medical Oncology OPD", "OPD-4", ONCOLOGIST, "11:30", 30, "new", "New referral, cervix"),
    (P4, "Medical Oncology OPD", "OPD-3", ONCOLOGIST, "12:00", 20, "follow_up", "Pre C3D15 review"),
    (P5, "Medical Oncology OPD", "OPD-3", ONCOLOGIST, "12:30", 20, "follow_up", "CEA review"),
    ("OB-2026-0008", "Medical Oncology OPD", "OPD-3", ONCOLOGIST, "14:00", 20, "follow_up", None),
    ("OB-2026-0009", "Medical Oncology OPD", "OPD-4", ONCOLOGIST, "14:30", 20, "follow_up", None),
    (P1, "Biochemistry & Haematology Lab", "Sample Collection", "Phlebotomy", "08:30", 15, "procedure", "CBC"),
    (P1, "Radiology", "Echo Room", "Dr. V. Shetty", "10:15", 30, "procedure", "Echo before taxane"),
    ("OB-2026-0008", "Radiology", "CT-1", RAD, "09:00", 30, "procedure", "CT abdomen"),
    ("OB-2026-0010", "Radiology", "CT-1", RAD, "14:00", 30, "procedure", "CT planning"),
    ("OB-2026-0006", "Radiology", "CT-1", RAD, "14:15", 30, "procedure", "CT neck"),
    (P3, "Radiology", "MRI-1", RAD, "15:00", 45, "procedure", "MRI pelvis"),
    ("OB-2026-0007", "Day-care Chemotherapy", "Chair 2", "Day-care nurse", "10:30", 240, "procedure", "Carbo-pacli C4"),
    (P4, "Day-care Chemotherapy", "Chair 5", "Day-care nurse", "12:30", 240, "procedure", "ABVD C3D15"),
    ("OB-2026-0009", "Day-care Chemotherapy", "Chair 9", "Day-care nurse", "15:00", 150, "procedure", "AC C2"),
    ("OB-2026-0010", "Radiation Oncology", "LINAC-1", "Dr. N. Bhat", "09:00", 20, "procedure", "EBRT fraction 19"),
    ("OB-2026-0008", "Radiation Oncology", "LINAC-2", "Dr. N. Bhat", "10:00", 20, "procedure", "SBRT bone"),
    (P3, "Psycho-oncology", "Counselling-1", "Ms. R. D'Souza", "13:00", 45, "procedure", "New patient counselling"),
    (P2, "Pathology", "Path Lab", PATH, "12:00", 15, "procedure", "Outside slide review"),
]

# daily steps baseline per patient for the simulated phone-health sync
ACTIVITY = {P1: (5400, -170), P2: (6500, 0), P4: (7200, -60), P5: (4300, 0)}
