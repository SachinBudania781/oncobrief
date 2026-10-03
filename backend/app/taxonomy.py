"""The one shared document taxonomy. Uploaders pick from this BEFORE choosing a file,
so every document is filed structurally — no AI sorting."""

CATEGORIES = {
    "Lab report": {
        "subtypes": ["CBC", "LFT", "KFT / RFT", "Electrolytes", "Tumour marker", "Coagulation", "Other lab"],
        "department": "Biochemistry & Haematology Lab",
    },
    "Pathology": {
        "subtypes": ["Biopsy histopathology", "IHC / receptor status", "FNAC", "Cytology",
                     "Molecular / genomics"],
        "department": "Pathology",
    },
    "Imaging": {
        "subtypes": ["CT", "MRI", "PET-CT", "X-ray", "Ultrasound", "Mammogram", "Bone scan",
                     "Echocardiogram / ECG"],
        "department": "Radiology",
    },
    "Treatment": {
        "subtypes": ["Chemotherapy cycle note", "Radiotherapy plan / summary", "Surgery / operative note",
                     "Targeted / immunotherapy note", "Function test (PFT etc.)"],
        "department": "Medical Oncology",
    },
    "Clinical note": {
        "subtypes": ["Consultation transcript", "Discharge summary", "Referral letter", "Tumour board note"],
        "department": "Medical Oncology OPD",
    },
    "Prescription": {
        "subtypes": ["Prescription"],
        "department": "Medical Oncology OPD",
    },
    "Patient-reported": {
        "subtypes": ["Outside report photo", "Symptom diary", "Other"],
        "department": "Patient",
    },
}

DEPARTMENTS = [
    {"name": "Medical Oncology OPD", "default_category": "Clinical note", "rooms": ["OPD-3", "OPD-4"]},
    {"name": "Day-care Chemotherapy", "default_category": "Treatment", "rooms": ["Chair 1-6", "Chair 7-12"]},
    {"name": "Radiology", "default_category": "Imaging", "rooms": ["CT-1", "MRI-1", "Echo Room", "USG-2"]},
    {"name": "Pathology", "default_category": "Pathology", "rooms": ["Path Lab"]},
    {"name": "Biochemistry & Haematology Lab", "default_category": "Lab report", "rooms": ["Sample Collection"]},
    {"name": "Radiation Oncology", "default_category": "Treatment", "rooms": ["LINAC-1", "LINAC-2"]},
    {"name": "Psycho-oncology", "default_category": "Clinical note", "rooms": ["Counselling-1"]},
    {"name": "Front desk / Records", "default_category": "Clinical note", "rooms": ["Records"]},
]

# Reference ranges used for rule-based flagging (no AI). Sex-specific where needed.
LAB_REFERENCE = {
    "Haemoglobin": {"unit": "g/dL", "F": (12.0, 15.5), "M": (13.5, 17.5)},
    "WBC": {"unit": "x10^3/uL", "any": (4.0, 11.0)},
    "ANC": {"unit": "x10^3/uL", "any": (2.0, 7.5)},
    "Platelets": {"unit": "x10^3/uL", "any": (150, 410)},
    "Creatinine": {"unit": "mg/dL", "any": (0.6, 1.2)},
    "ALT": {"unit": "U/L", "any": (7, 40)},
    "AST": {"unit": "U/L", "any": (8, 40)},
    "Bilirubin": {"unit": "mg/dL", "any": (0.2, 1.2)},
    "Albumin": {"unit": "g/dL", "any": (3.5, 5.0)},
    "CEA": {"unit": "ng/mL", "any": (0, 5.0)},
    "CA 15-3": {"unit": "U/mL", "any": (0, 30)},
    "Sodium": {"unit": "mmol/L", "any": (135, 145)},
    "Potassium": {"unit": "mmol/L", "any": (3.5, 5.1)},
}

# Aliases the rule-based parser looks for in OCR text of lab reports.
LAB_ALIASES = {
    "Haemoglobin": ["haemoglobin", "hemoglobin", "hb"],
    "WBC": ["total wbc", "wbc", "total leucocyte count", "tlc"],
    "ANC": ["absolute neutrophil count", "anc"],
    "Platelets": ["platelet count", "platelets"],
    "Creatinine": ["serum creatinine", "creatinine"],
    "ALT": ["alt", "sgpt"],
    "AST": ["ast", "sgot"],
    "Bilirubin": ["total bilirubin", "bilirubin"],
    "Albumin": ["albumin"],
    "CEA": ["cea", "carcinoembryonic antigen"],
    "CA 15-3": ["ca 15-3", "ca15-3"],
    "Sodium": ["sodium"],
    "Potassium": ["potassium"],
}

SYMPTOMS = [
    {"key": "fever", "en": "Fever", "hi": "बुखार", "mr": "ताप"},
    {"key": "nausea", "en": "Nausea / vomiting", "hi": "मतली / उल्टी", "mr": "मळमळ / उलटी"},
    {"key": "fatigue", "en": "Tiredness", "hi": "थकान", "mr": "थकवा"},
    {"key": "mouth_sores", "en": "Mouth sores", "hi": "मुँह के छाले", "mr": "तोंडात फोड"},
    {"key": "diarrhoea", "en": "Loose motions", "hi": "दस्त", "mr": "जुलाब"},
    {"key": "pain", "en": "Pain", "hi": "दर्द", "mr": "वेदना"},
    {"key": "breathlessness", "en": "Breathlessness", "hi": "साँस फूलना", "mr": "दम लागणे"},
    {"key": "tingling", "en": "Tingling / numbness", "hi": "झुनझुनी / सुन्नपन", "mr": "मुंग्या / बधिरपणा"},
    {"key": "bleeding", "en": "Bleeding", "hi": "रक्तस्राव", "mr": "रक्तस्राव"},
    {"key": "rash", "en": "Skin rash", "hi": "त्वचा पर दाने", "mr": "त्वचेवर पुरळ"},
    {"key": "headache", "en": "Headache", "hi": "सिरदर्द", "mr": "डोकेदुखी"},
    {"key": "cough", "en": "Cough", "hi": "खाँसी", "mr": "खोकला"},
    {"key": "low_mood", "en": "Low mood / worry", "hi": "उदासी / चिंता", "mr": "उदासी / काळजी"},
]

# Department-defined checklist of documents expected for a NEW patient, by cancer site.
# Plain configuration — the brief lists what is not yet in the folder; it never advises.
NEW_PATIENT_CHECKLIST = {
    "default": [("Pathology", "Biopsy histopathology"), ("Lab report", "CBC"), ("Lab report", "KFT / RFT"),
                ("Lab report", "LFT")],
    "cervix": [("Pathology", "Biopsy histopathology"), ("Imaging", "MRI"), ("Imaging", "CT"),
               ("Lab report", "CBC"), ("Lab report", "KFT / RFT"), ("Lab report", "LFT")],
    "breast": [("Pathology", "Biopsy histopathology"), ("Pathology", "IHC / receptor status"),
               ("Imaging", "Mammogram"), ("Lab report", "CBC"), ("Lab report", "LFT")],
}

VISIT_TYPES = {
    "follow_up": "Follow-up",
    "new": "New patient",
    "transfer": "Hospital transfer",
}


def flag_for(test: str, value: float, sex: str = "F"):
    ref = LAB_REFERENCE.get(test)
    if not ref:
        return None, None, ""
    low, high = ref.get(sex) or ref.get("any") or ref.get("F")
    flag = "L" if value < low else "H" if value > high else ""
    return low, high, flag
