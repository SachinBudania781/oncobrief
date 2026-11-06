"""Request adapter for deterministic regimen screening; no regimen is generated."""
from __future__ import annotations

from typing import Any

from .clinical_engine import SafetyAlert, run_organ_safety_screening


def _alert(severity: str, parameter: str, observation: str, action: str) -> SafetyAlert:
    return SafetyAlert(
        severity=severity,
        parameter=parameter,
        observation=observation,
        guideline_action=action,
    )


def mandatory_pre_checks(regimen_text: str) -> list[str]:
    """Return baseline workup prompts from explicitly named drug classes."""
    regimen = (regimen_text or "").casefold()
    checks: list[str] = []
    cytotoxic = any(
        drug in regimen
        for drug in (
            "doxorubicin", "epirubicin", "cyclophosphamide", "paclitaxel",
            "docetaxel", "cisplatin", "carboplatin", "fluorouracil",
            "5-fu", "capecitabine",
        )
    )
    if cytotoxic:
        checks.append("Baseline CBC with differential and platelet count; confirm regimen-specific count thresholds.")
    if any(drug in regimen for drug in ("doxorubicin", "epirubicin", "trastuzumab")) or any(
        token in regimen for token in ("ac-th", "ac-t", "anthracycline")
    ):
        checks.append("Baseline echocardiogram with LVEF before anthracycline or trastuzumab exposure.")
    if "cisplatin" in regimen:
        checks.append("Baseline renal function/CrCl and electrolytes; confirm the regimen-specific hydration protocol.")
    if any(drug in regimen for drug in ("fluorouracil", "5-fu", "capecitabine")):
        checks.append("Verify required DPD/DPYD assessment and the institution's fluoropyrimidine protocol.")
    return checks


def audit_patient_case(patient_data: dict[str, Any], regimen_text: str) -> list[SafetyAlert]:
    """Apply the shared clinical engine plus missing-data and HER2 cardiac checks."""
    regimen = (regimen_text or "").casefold()
    alerts = run_organ_safety_screening(
        regimen_text,
        crcl_ml_min=patient_data.get("crcl"),
        anc_per_ul=patient_data.get("anc"),
        lvef_percent=patient_data.get("lvef"),
        platelets_per_ul=patient_data.get("platelets"),
        bilirubin_mg_dl=patient_data.get("bilirubin"),
    )
    observed = {item.parameter.casefold() for item in alerts}

    cardiac_regimen = any(
        drug in regimen for drug in ("trastuzumab", "doxorubicin", "epirubicin", "anthracycline")
    ) or any(token in regimen for token in ("ac-th", "ac-t"))
    lvef = patient_data.get("lvef")
    if cardiac_regimen and lvef is None and "left ventricular ejection fraction" not in observed:
        alerts.append(_alert(
            "CRITICAL",
            "Left ventricular ejection fraction",
            "Baseline LVEF is not recorded for the proposed cardiac-risk regimen.",
            "Obtain and review a baseline echocardiogram/LVEF before treatment; this screen does not authorize administration.",
        ))
    elif cardiac_regimen and lvef is not None and float(lvef) < 50 and "left ventricular ejection fraction" not in observed:
        alerts.append(_alert(
            "CRITICAL",
            "Left ventricular ejection fraction",
            f"Baseline LVEF {float(lvef):.1f}% is below the configured 50% screening threshold.",
            "Hold the proposed regimen for oncology/cardiology review against the current regimen-specific protocol.",
        ))

    if "cisplatin" in regimen and patient_data.get("crcl") is None and "creatinine clearance" not in observed:
        alerts.append(_alert(
            "CRITICAL",
            "Creatinine clearance",
            "Baseline CrCl is not recorded for the proposed cisplatin regimen.",
            "Verify renal function and the approved cisplatin protocol before treatment.",
        ))

    if any(drug in regimen for drug in ("fluorouracil", "5-fu", "capecitabine")):
        dpd_status = str(patient_data.get("dpd_status") or "").strip().casefold()
        if dpd_status in {"", "unknown", "not tested", "not_tested"}:
            alerts.append(_alert(
                "CRITICAL",
                "DPD/DPYD status",
                "DPD/DPYD status is not recorded for the proposed fluoropyrimidine regimen.",
                "Verify required pretreatment assessment and the institution's protocol before treatment.",
            ))
    return alerts
