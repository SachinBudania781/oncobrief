"""Deterministic clinical calculations and safety screening for the demo.

This module contains no LLM calls.  It implements arithmetic and TNM lookups
only.  The AJCC stage groups are anatomical groups (not prognostic groups).

Safety policy note
------------------
The threshold values and suggested actions for regimen-related screening below
are the values explicitly supplied for this demo.  They have not been
independently verified against a licensed NCG 2024 regimen table.  They must be
reviewed and approved by the treating institution before clinical use.  An
alert is a review prompt; it is not a prescription, medication order, or
replacement for the regimen-specific protocol.
"""

from __future__ import annotations

import math
import re
from typing import Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat


RULE_PROVENANCE = {
    "breast_ajcc8_anatomic_stage": "https://www.cancer.gov/types/breast/hp/breast-treatment-pdq",
    "nsclc_ajcc8_stage": "https://www.facs.org/media/nb2pkvpj/lung-cancer-8th-ed.pdf",
    "calvert_formula_and_gfr_cap": "https://dctd.cancer.gov/research/ctep-trials/memos/carboplatin-dosing.pdf",
    "febrile_neutropenia_antibiotic_timing": "https://www.idsociety.org/practice-guideline/fever-and-neutropenia-in-adults-with-cancer/",
    "ctcae_v5": "https://ctep.cancer.gov/protocolDevelopment/electronic_applications/ctc.htm",
    "organ_safety_thresholds": "Values supplied in the task; verify against the institution's current regimen-specific NCG protocol before clinical use.",
}


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class DosingCalculationResult(_StrictModel):
    """Calculated metrics; values are estimates and require clinician review."""

    bsa_m2: StrictFloat = Field(gt=0)
    crcl_ml_min: StrictFloat = Field(ge=0)
    carboplatin_auc5_mg: StrictFloat = Field(gt=0)
    carboplatin_auc6_mg: StrictFloat = Field(gt=0)
    gfr_capped: StrictBool


class SafetyAlert(_StrictModel):
    """UI-compatible, deterministic alert (severity uses uppercase labels)."""

    severity: Literal["CRITICAL", "WARNING", "INFO"]
    parameter: str = Field(min_length=1, max_length=160)
    observation: str = Field(min_length=1, max_length=1000)
    guideline_action: str = Field(min_length=1, max_length=1600)


def _finite_number(name: str, value: float, *, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{name} must be finite")
    if minimum is not None and number < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return number


def calculate_cockcroft_gault_crcl(
    serum_creatinine_mg_dl: float,
    age_years: int,
    weight_kg: float,
    is_female: bool,
) -> float:
    """Return Cockcroft–Gault CrCl in mL/min using the caller-selected weight.

    For adults: ((140 - age) * weight_kg) / (72 * SCr), multiplied by 0.85
    when ``is_female`` is true.  This function does not choose actual, ideal,
    or adjusted body weight; the clinician/protocol must choose and supply it.
    """
    if isinstance(age_years, bool) or not isinstance(age_years, int):
        raise TypeError("age_years must be an integer")
    if not 18 <= age_years <= 120:
        raise ValueError("age_years must be between 18 and 120 for this adult formula")
    if not isinstance(is_female, bool):
        raise TypeError("is_female must be a bool")
    scr = _finite_number("serum_creatinine_mg_dl", serum_creatinine_mg_dl, minimum=0.1)
    weight = _finite_number("weight_kg", weight_kg, minimum=1)
    crcl = ((140.0 - age_years) * weight) / (72.0 * scr)
    if is_female:
        crcl *= 0.85
    return round(crcl, 2)


def calculate_mosteller_bsa(height_cm: float, weight_kg: float) -> float:
    """Return Mosteller body surface area in m²: sqrt(height_cm*weight_kg/3600)."""
    height = _finite_number("height_cm", height_cm, minimum=1)
    weight = _finite_number("weight_kg", weight_kg, minimum=1)
    return round(math.sqrt((height * weight) / 3600.0), 2)


def calculate_calvert_carboplatin_dose(
    target_auc: float, gfr_ml_min: float
) -> tuple[float, bool]:
    """Return (dose_mg, gfr_was_capped) using Calvert: AUC × (GFR + 25).

    GFR is capped at 125 mL/min, matching the cap stated in the US NCI CTEP
    carboplatin dosing memo. The supplied GFR should be a protocol-approved
    value; Cockcroft–Gault CrCl is not automatically interchangeable with GFR.
    """
    auc = _finite_number("target_auc", target_auc, minimum=0)
    gfr = _finite_number("gfr_ml_min", gfr_ml_min, minimum=0)
    if auc == 0:
        raise ValueError("target_auc must be greater than zero")
    capped = gfr > 125.0
    dose = auc * (min(gfr, 125.0) + 25.0)
    return round(dose, 1), capped


def calculate_patient_dosing_metrics(
    age_years: int,
    weight_kg: float,
    height_cm: float,
    serum_creatinine_mg_dl: float,
    is_female: bool,
) -> DosingCalculationResult:
    """Compute BSA, Cockcroft–Gault CrCl, and capped AUC 5/6 carboplatin doses.

    CrCl is used as the GFR input solely to satisfy this demo's requested
    metric set. A clinician must use the renal-function value and weight method
    required by the actual protocol before dosing.
    """
    crcl = calculate_cockcroft_gault_crcl(
        serum_creatinine_mg_dl, age_years, weight_kg, is_female
    )
    bsa = calculate_mosteller_bsa(height_cm, weight_kg)
    dose5, capped = calculate_calvert_carboplatin_dose(5.0, crcl)
    dose6, capped6 = calculate_calvert_carboplatin_dose(6.0, crcl)
    return DosingCalculationResult(
        bsa_m2=float(bsa),
        crcl_ml_min=float(crcl),
        carboplatin_auc5_mg=float(dose5),
        carboplatin_auc6_mg=float(dose6),
        gfr_capped=capped or capped6,
    )


def _category(value: str, name: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string TNM category")
    value = re.sub(r"\s+", "", value.upper())
    # Anatomic groups accept categories, not clinical/pathological prefixes.
    if value.startswith(("C", "P", "YC", "YP")):
        raise ValueError(f"{name} must not include a clinical/pathological prefix")
    return value


def compute_breast_cancer_stage(t: str, n: str, m: str) -> str:
    """AJCC 8 anatomical stage group for invasive breast carcinoma.

    Returns ``Stage Undetermined`` for missing, invalid, or unsupported TNM
    descriptors.  Biomarker/grade-dependent prognostic groups are not inferred.
    """
    t, n, m = _category(t, "t"), _category(n, "n"), _category(m, "m")
    if m == "M1":
        return "Stage IV"
    if m not in {"M0", "M0(I+)"}:
        return "Stage Undetermined"

    t0 = {"T0", "TIS"}
    t1 = {"T1", "T1MI", "T1A", "T1B", "T1C"}
    t12 = t0 | t1 | {"T2"}
    t3 = {"T3"}
    t4 = {"T4", "T4A", "T4B", "T4C", "T4D"}
    valid_t = t12 | t3 | t4
    valid_n = {"N0", "N0(I+)", "N1MI", "N1", "N1A", "N1B", "N1C",
               "N2", "N2A", "N2B", "N3", "N3A", "N3B", "N3C"}
    if t not in valid_t or n not in valid_n:
        return "Stage Undetermined"

    # Anatomical stage table: N3 supersedes every nonmetastatic T category.
    if n in {"N3", "N3A", "N3B", "N3C"}:
        return "Stage IIIC"
    n0 = n in {"N0", "N0(I+)"}
    if t == "TIS" and n0:
        return "Stage 0"
    if t in {"T0", "T1", "T1MI", "T1A", "T1B", "T1C"} and n0:
        return "Stage IA"
    if t in {"T0", "T1", "T1MI", "T1A", "T1B", "T1C"} and n == "N1MI":
        return "Stage IB"

    # N1mi on T2-T4 is staged using the N1 category per the AJCC 8 note.
    n1 = n in {"N1", "N1A", "N1B", "N1C", "N1MI"}
    n2 = n in {"N2", "N2A", "N2B"}
    if (t in {"T0", "T1", "T1MI", "T1A", "T1B", "T1C"} and n1) or (t == "T2" and n0):
        return "Stage IIA"
    if (t == "T2" and n1) or (t == "T3" and n0):
        return "Stage IIB"
    if (t in t12 and n2) or (t == "T3" and (n1 or n2)):
        return "Stage IIIA"
    if t in t4 and n in {"N0", "N0(I+)", "N1MI", "N1", "N1A", "N1B", "N1C", "N2", "N2A", "N2B"}:
        return "Stage IIIB"
    return "Stage Undetermined"


def compute_nsclc_stage(t: str, n: str, m: str) -> str:
    """AJCC 8 anatomical stage group for non-small-cell lung cancer."""
    t, n, m = _category(t, "t"), _category(n, "n"), _category(m, "m")
    if m == "M1C":
        return "Stage IVB"
    if m in {"M1A", "M1B"}:
        return "Stage IVA"
    if m == "M1":
        return "Stage IV (M subclass not specified)"
    if m != "M0":
        return "Stage Undetermined"
    if t == "TIS" and n == "N0":
        return "Stage 0"

    t1 = {"T1", "T1MI", "T1A", "T1B", "T1C"}
    t2 = {"T2", "T2A", "T2B"}
    valid_t = t1 | t2 | {"T3", "T4"}
    valid_n = {"N0", "N1", "N2", "N3"}
    if t not in valid_t or n not in valid_n:
        return "Stage Undetermined"

    # AJCC 8 groupings. T2 without a/b subtype cannot distinguish IB from IIA.
    if n == "N0":
        if t in {"T1MI", "T1A"}:
            return "Stage IA1"
        if t == "T1B":
            return "Stage IA2"
        if t == "T1C":
            return "Stage IA3"
        if t == "T2":
            return "Stage Undetermined (T2 subclass required)"
        if t == "T2A":
            return "Stage IB"
        if t == "T2B":
            return "Stage IIA"
        if t == "T3":
            return "Stage IIB"
        if t == "T4":
            return "Stage IIIA"
    if n == "N1":
        if t in t1 | t2:
            return "Stage IIB"
        if t in {"T3", "T4"}:
            return "Stage IIIA"
    if n == "N2":
        if t in t1 | t2:
            return "Stage IIIA"
        if t in {"T3", "T4"}:
            return "Stage IIIB"
    if n == "N3":
        if t in t1 | t2:
            return "Stage IIIB"
        if t in {"T3", "T4"}:
            return "Stage IIIC"
    return "Stage Undetermined"


def compute_tnm_stage(site: str, t: str, n: str, m: str) -> str:
    """Dispatch to breast or NSCLC anatomical stage grouping; never guess site."""
    if not isinstance(site, str) or not site.strip():
        return "Stage Undetermined"
    normalized = re.sub(r"[^a-z0-9]+", " ", site.casefold()).strip()
    if "breast" in normalized:
        return compute_breast_cancer_stage(t, n, m)
    if any(token in normalized.split() for token in ("lung", "nsclc")) or "non small cell lung" in normalized:
        return compute_nsclc_stage(t, n, m)
    return "Stage Undetermined (unsupported primary site)"


def _optional_lab(name: str, value: float | None) -> float | None:
    if value is None:
        return None
    return _finite_number(name, value, minimum=0)


def run_organ_safety_screening(
    regimen: str,
    crcl_ml_min: float | None = None,
    anc_per_ul: float | None = None,
    lvef_percent: float | None = None,
    platelets_per_ul: float | None = None,
    bilirubin_mg_dl: float | None = None,
) -> list[SafetyAlert]:
    """Apply the requested screening thresholds to supplied, measured values.

    Missing values are skipped.  The caller must not substitute 0 for unknown.
    Alert action wording is intentionally conditional on regimen-specific review.
    """
    if not isinstance(regimen, str):
        raise TypeError("regimen must be a string")
    r = regimen.casefold()
    crcl = _optional_lab("crcl_ml_min", crcl_ml_min)
    anc = _optional_lab("anc_per_ul", anc_per_ul)
    lvef = _optional_lab("lvef_percent", lvef_percent)
    platelets = _optional_lab("platelets_per_ul", platelets_per_ul)
    bilirubin = _optional_lab("bilirubin_mg_dl", bilirubin_mg_dl)
    if lvef is not None and lvef > 100:
        raise ValueError("lvef_percent cannot exceed 100")
    alerts: list[SafetyAlert] = []

    if "cisplatin" in r and crcl is not None:
        if crcl < 50:
            alerts.append(SafetyAlert(
                severity="CRITICAL", parameter="Creatinine clearance",
                observation=f"CrCl {crcl:.1f} mL/min is below the configured 50 mL/min threshold.",
                guideline_action=("Do not use this screen as authorization to administer cisplatin. "
                                  "Prompt immediate regimen-specific review; the supplied rule calls for "
                                  "considering carboplatin AUC 5–6 substitution."),
            ))
        elif crcl < 60:
            alerts.append(SafetyAlert(
                severity="WARNING", parameter="Creatinine clearance",
                observation=f"CrCl {crcl:.1f} mL/min is within the configured 50–60 mL/min caution range.",
                guideline_action=("Verify the cisplatin protocol and hydration orders. The supplied demo "
                                  "rule specifies 1 L saline before and after treatment; confirm fluid "
                                  "suitability and exact orders with the treating team."),
            ))

    anthracycline = any(drug in r for drug in ("doxorubicin", "epirubicin")) or bool(
        re.search(r"\b(?:ac|fac|caf)\b", r)
    )
    if anthracycline and lvef is not None:
        if lvef < 50:
            alerts.append(SafetyAlert(
                severity="CRITICAL", parameter="Left ventricular ejection fraction",
                observation=f"Baseline LVEF {lvef:.1f}% is below the configured 50% threshold.",
                guideline_action=("Pause for oncology/cardiology review before anthracycline treatment. "
                                  "The supplied demo rule asks the team to consider a non-anthracycline "
                                  "option (for example, TC) under the applicable protocol."),
            ))

    if anc is not None:
        if anc < 1000:
            alerts.append(SafetyAlert(
                severity="CRITICAL", parameter="Absolute neutrophil count",
                observation=f"ANC {anc:.0f}/µL is below the configured 1,000/µL threshold.",
                guideline_action=("Hold pending regimen-specific oncology review. Assess infection and "
                                  "follow the approved growth-factor protocol if indicated; do not initiate "
                                  "or dose filgrastim from this screen alone."),
            ))
        elif anc < 1500:
            alerts.append(SafetyAlert(
                severity="WARNING", parameter="Absolute neutrophil count",
                observation=f"ANC {anc:.0f}/µL is within the configured 1,000–1,500/µL caution range.",
                guideline_action="Review treatment timing and supportive care against the specific regimen protocol.",
            ))

    if platelets is not None and platelets < 75000:
        alerts.append(SafetyAlert(
            severity="CRITICAL", parameter="Platelet count",
            observation=f"Platelets {platelets:.0f}/µL are below the configured 75,000/µL threshold.",
            guideline_action="Pause for regimen-specific oncology review and assess bleeding risk before treatment.",
        ))

    taxane_or_anthracycline = anthracycline or any(
        drug in r for drug in ("paclitaxel", "docetaxel", "nab-paclitaxel")
    )
    if taxane_or_anthracycline and bilirubin is not None and bilirubin > 1.5:
        alerts.append(SafetyAlert(
            severity="CRITICAL", parameter="Total bilirubin",
            observation=f"Total bilirubin {bilirubin:.2f} mg/dL is above the configured 1.5 mg/dL threshold.",
            guideline_action=("Check the exact drug label and regimen-specific hepatic dose table before "
                              "treatment. The supplied demo rule specifies a 50% reduction; this screen "
                              "does not calculate or authorize a dose change."),
        ))
    return alerts


def triage_patient_symptom(
    temperature_c: float | None,
    symptom_tags: Sequence[str],
    days_post_chemo: int | None = None,
) -> dict[str, str]:
    """Deterministic symptom routing using conservative, explicit trigger rules.

    A temperature >=38.0°C or reported chills/rigors during cancer treatment
    triggers emergency assessment for *possible* febrile neutropenia.  This is
    not a diagnosis: neutrophil count and clinician assessment are required.
    CTCAE grading is not inferred from vague symptom text.
    """
    if not isinstance(symptom_tags, Sequence) or isinstance(symptom_tags, (str, bytes)):
        raise TypeError("symptom_tags must be a sequence of symptom strings")
    tags = set()
    for item in symptom_tags:
        if not isinstance(item, str):
            raise TypeError("each symptom tag must be a string")
        tags.add(re.sub(r"[^a-z0-9]+", "_", item.casefold()).strip("_"))

    temp: float | None = None
    if temperature_c is not None:
        temp = _finite_number("temperature_c", temperature_c)
        if not 25 <= temp <= 45:
            raise ValueError("temperature_c must be between 25 and 45°C")
    if days_post_chemo is not None and (isinstance(days_post_chemo, bool)
            or not isinstance(days_post_chemo, int) or days_post_chemo < 0):
        raise ValueError("days_post_chemo must be a nonnegative integer or None")

    chills = bool(tags & {"chills", "chill", "shivering", "rigors", "rigor"})
    fever = temp is not None and temp >= 38.0
    if fever or chills:
        timing = ""
        if days_post_chemo is not None and 7 <= days_post_chemo <= 14:
            timing = f" Reported on day {days_post_chemo} after chemotherapy (a possible nadir window)."
        observed = f"Measured temperature: {temp:.1f}°C." if temp is not None else "Chills/rigors reported."
        if fever and chills:
            observed = f"Measured temperature: {temp:.1f}°C; chills/rigors reported."
        return {
            "status": "EMERGENCY_RED_FLAG",
            "tier": "LEVEL_1_URGENT",
            "title": "Suspected febrile neutropenia — urgent assessment",
            "action": (f"Seek emergency hospital assessment now.{timing} {observed} "
                       "Possible febrile neutropenia requires prompt clinical evaluation; when suspected, "
                       "the treating team should follow its emergency pathway, including timely IV "
                       "broad-spectrum antibiotics (the supplied protocol target is within 60 minutes)."),
        }

    cardiopulmonary = tags & {
        "severe_breathlessness", "difficulty_breathing", "shortness_of_breath_at_rest",
        "chest_pain", "blue_lips", "cyanosis", "fainting", "syncope", "hemoptysis",
    }
    if cardiopulmonary:
        return {
            "status": "EMERGENCY_RED_FLAG",
            "tier": "LEVEL_1_URGENT",
            "title": "Severe breathing or chest symptom",
            "action": "Call local emergency services or go to the nearest emergency department now.",
        }

    gi_priority = tags & {
        "severe_vomiting", "intractable_vomiting", "intractable_diarrhea", "severe_diarrhea",
        "dehydration", "unable_to_keep_fluids", "very_little_urine",
    }
    if gi_priority:
        return {
            "status": "URGENT_EVALUATION",
            "tier": "LEVEL_2_PRIORITY",
            "title": "Severe gastrointestinal symptoms or possible dehydration",
            "action": ("Contact the oncology team or urgent cancer-care service now for assessment. "
                       "If fainting, confusion, inability to drink, or worsening symptoms occur, seek "
                       "emergency care. CTCAE grade must be assigned by a qualified clinician."),
        }

    return {
        "status": "AMBULATORY_MONITOR",
        "tier": "LEVEL_3_ROUTINE",
        "title": "Routine symptom follow-up",
        "action": ("Record symptoms and follow the care team's instructions. Use the patient's "
                   "individual fluid plan and contact the oncology team if symptoms worsen."),
    }

