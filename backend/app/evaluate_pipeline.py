"""On-demand retrieval and rule-screen benchmark; no model-generated regimens."""
from __future__ import annotations

import json
from typing import Any

from .services.knowledge_base import ClinicalChromaRetriever, PatientClinicalProfile
from .services.safety_guardrails import audit_patient_case

BENCHMARK_CASES: tuple[dict[str, Any], ...] = (
    {
        "id": "CASE_HER2_BREAST",
        "site": "breast",
        "stage": "IIA",
        "biomarkers": ["HER2+"],
        "notes": "HER2 3+ IHC positive, ER negative, early breast cancer",
        "expected_drugs": ["Trastuzumab", "Paclitaxel"],
        "candidate_regimen": "Trastuzumab and paclitaxel",
        "patient_labs": {"lvef": 45.0},
        "expect_guardrail_trip": True,
    },
    {
        "id": "CASE_EGFR_LUNG",
        "site": "lung_nsclc",
        "stage": "IV",
        "biomarkers": ["EGFR_ex19del"],
        "notes": "EGFR exon 19 deletion, metastatic lung adenocarcinoma",
        "expected_drugs": ["Osimertinib"],
        "candidate_regimen": "Osimertinib",
        "patient_labs": {"lvef": 60.0, "crcl": 80.0},
        "expect_guardrail_trip": False,
    },
)


def run_evaluation(retriever: ClinicalChromaRetriever | None = None) -> dict[str, Any]:
    """Measure evidence retrieval and deterministic guardrail behavior on supplied cases.

    Regimen accuracy and hallucination rate are intentionally reported as not
    measured because this system does not synthesize regimens.
    """
    store = retriever or ClinicalChromaRetriever()
    retrieval_hits = 0
    guardrail_passes = 0
    breakdown: list[dict[str, Any]] = []

    for case in BENCHMARK_CASES:
        profile = PatientClinicalProfile(
            cancer_site=case["site"],
            stage=case["stage"],
            biomarkers=case["biomarkers"],
            clinical_keywords=case["notes"],
        )
        retrieval = store.retrieve_with_filters(profile, top_k=1)
        content = " ".join(item["content"] for item in retrieval["documents"])
        retrieval_hit = any(
            drug.casefold() in content.casefold() for drug in case["expected_drugs"]
        )
        retrieval_hits += int(retrieval_hit)

        alerts = audit_patient_case(case["patient_labs"], case["candidate_regimen"])
        blocked = any(alert.severity == "CRITICAL" for alert in alerts)
        guardrail_match = blocked == case["expect_guardrail_trip"]
        guardrail_passes += int(guardrail_match)
        breakdown.append({
            "case_id": case["id"],
            "retrieval_hit": retrieval_hit,
            "verified_sources": len(retrieval["documents"]),
            "guardrail_triggered": blocked,
            "guardrail_expectation_met": guardrail_match,
        })

    count = len(BENCHMARK_CASES)
    return {
        "cases_evaluated": count,
        "retrieval_recall_at_1_percent": round(100 * retrieval_hits / count, 1) if count else None,
        "guardrail_test_accuracy_percent": round(100 * guardrail_passes / count, 1) if count else None,
        "regimen_accuracy_percent": None,
        "hallucination_rate_percent": None,
        "not_measured_reason": "No regimen-generation step is enabled; accuracy and hallucination claims require a separately reviewed reference set.",
        "case_results": breakdown,
    }


def main() -> None:
    try:
        result = run_evaluation()
    except Exception as exc:
        result = {"status": "unavailable", "reason": str(exc)}
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
