"""Strict Pydantic v2 contracts for clinician and patient AI outputs."""
from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


Text = Annotated[str, Field(strict=True, min_length=1, max_length=4000)]
ShortText = Annotated[str, Field(strict=True, min_length=1, max_length=1000)]
PatientId = Annotated[str, Field(strict=True, min_length=1, max_length=80)]
PageNumber = Annotated[int, Field(strict=True, ge=1)]
Percentage = Annotated[float, Field(strict=True, ge=0, le=100)]


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class ReceptorStatus(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    EQUIVOCAL = "equivocal"
    NOT_TESTED = "not_tested"


class Her2IhcScore(str, Enum):
    ZERO = "0"
    ONE_PLUS = "1+"
    TWO_PLUS = "2+"
    THREE_PLUS = "3+"


class MolecularFinding(StrictModel):
    marker: ShortText = Field(description="Biomarker, gene, or assay name")
    result: ShortText = Field(description="Reported result, including units or percentage where applicable")
    method: ShortText | None = None


class BiomarkerProfile(StrictModel):
    er_status: ReceptorStatus | None = None
    pr_status: ReceptorStatus | None = None
    her2_ihc_score: Her2IhcScore | None = None
    her2_ish_result: ReceptorStatus | None = None
    ki67_percent: Percentage | None = None
    molecular_findings: list[MolecularFinding] = Field(default_factory=list, max_length=100)


class PatientClinicalProfile(StrictModel):
    patient_id: PatientId = Field(description="Pseudonymized ID; do not place a name or phone number here")
    age_years: Annotated[int, Field(strict=True, ge=0, le=110)]
    ecog_performance: Annotated[int, Field(strict=True, ge=0, le=4)]
    organ_site: ShortText
    histology_type: ShortText
    tnm_t: ShortText
    tnm_n: ShortText
    tnm_m: ShortText
    calculated_stage: ShortText
    biomarkers: BiomarkerProfile = Field(default_factory=BiomarkerProfile)


class AlertSeverity(str, Enum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class GuidelineCitation(StrictModel):
    guideline_source: ShortText = Field(description="Exact guideline title and issuing organization")
    guideline_version: ShortText = Field(description="Edition or publication date shown in the source")
    section_name: ShortText
    page_number: PageNumber
    verbatim_text: Text = Field(description="Exact quotation copied from the cited guideline")
    evidence_category: ShortText | None = None


class SafetyAlert(StrictModel):
    severity: AlertSeverity
    parameter: ShortText = Field(description="Lab or clinical measure, for example ANC or creatinine clearance")
    observation: Text = Field(description="Measured value and units, or the documented reason a check is needed")
    guideline_action: Text = Field(description="Source-backed protocol note for clinician review")


class TumorBoardSynopticBrief(StrictModel):
    patient_id: PatientId
    clinical_summary: Annotated[list[ShortText], Field(min_length=3, max_length=3)] = Field(
        description="Exactly three concise clinician-facing synoptic lines"
    )
    guideline_concordance: Text
    guideline_source_status: Literal["verified", "not_loaded"] = Field(
        description="Whether an authoritative NCG source was available to verify concordance"
    )
    safety_alerts: list[SafetyAlert] = Field(default_factory=list, max_length=100)
    citations: list[GuidelineCitation] = Field(default_factory=list, max_length=100)


class UrgentAction(str, Enum):
    EMERGENCY_DEPARTMENT_NOW = "go to the nearest emergency department now"
    EMERGENCY_SERVICES_NOW = "call local emergency services now"
    ONCOLOGY_TEAM_NOW = "contact the oncology team now"


class PatientRedFlag(StrictModel):
    symptom: ShortText = Field(description="Plain-language warning symptom")
    action: UrgentAction


class RedFlagAssessment(StrictModel):
    level: Literal[0, 1, 2, 3]
    reason: str = Field(strict=True, max_length=300)
    crisis: bool


class PatientGuidanceNote(StrictModel):
    audience: Literal["patient", "caregiver", "patient_and_caregiver"]
    language: Literal["en", "hi", "mr"]
    simplified_diagnosis: Text = Field(description="Plain-language explanation without adding unsupported findings")
    what_this_means: Text = Field(description="Plain-language explanation of the documented stage or result")
    what_to_ask_your_doctor: Annotated[list[ShortText], Field(min_length=3, max_length=5)]
    emergency_red_flags: list[PatientRedFlag] = Field(default_factory=list, max_length=30)


class PatientDocumentExplanationItem(StrictModel):
    text: Text = Field(max_length=1400)
    source: ShortText
    sources: list[ShortText] = Field(default_factory=list, max_length=20)


class PatientDocumentExplanation(StrictModel):
    document_id: Annotated[int, Field(strict=True, ge=1)]
    title: ShortText
    language: Literal["en", "hi", "mr"]
    requested_language: Literal["en", "hi", "mr"]
    explanation: list[PatientDocumentExplanationItem] = Field(max_length=6)
    original_excerpt: str = Field(strict=True, max_length=4000)
    questions: Annotated[list[ShortText], Field(min_length=3, max_length=5)]
    translation_required: bool
    source: ShortText
    model: ShortText
    generation: ShortText
    notice: Text = Field(max_length=1000)
    patient_guidance: PatientGuidanceNote


class CitedParagraph(StrictModel):
    text: Text
    sources: Annotated[list[ShortText], Field(min_length=1, max_length=20)]


class ClinicianFinding(CitedParagraph):
    date: Annotated[str, Field(strict=True, pattern=r"^\d{4}-\d{2}-\d{2}$")]


class ClinicianBriefNarrative(StrictModel):
    summary: list[CitedParagraph] = Field(max_length=20)
    key_findings: list[ClinicianFinding] = Field(max_length=20)


class PatientExplanationParagraph(StrictModel):
    text: Text = Field(max_length=1400)
    sources: Annotated[list[ShortText], Field(min_length=1, max_length=20)]


class PatientExplanationResponse(StrictModel):
    language: Literal["en", "hi", "mr"]
    items: Annotated[list[PatientExplanationParagraph], Field(min_length=1, max_length=6)]


class PatientCompanionResponse(StrictModel):
    language: Literal["en", "hi", "mr"]
    answer: Text = Field(max_length=1800)
    sources: list[ShortText] = Field(max_length=20)


class PatientChatSource(StrictModel):
    """A source reference returned by the chat API for the interface to open."""

    tag: ShortText | None = None
    title: ShortText
    id: Annotated[int, Field(strict=True, ge=1)] | None = None
    record_id: Annotated[int, Field(strict=True, ge=1)] | None = None
    url: Annotated[str, Field(strict=True, max_length=2048)] | None = None


class PatientChatResult(StrictModel):
    """Stable, validated transport shape for every patient/caregiver chat answer."""

    language: Literal["en", "hi", "mr"]
    level: Literal[0, 1, 2, 3]
    answer: Text = Field(max_length=1800)
    sources: list[PatientChatSource] = Field(default_factory=list, max_length=20)
    citations: list[PatientExplanationParagraph] = Field(default_factory=list, max_length=6)
    generation: ShortText = "records"
    model: ShortText | None = None
    instruction: Text | None = None
    alert_id: Annotated[int, Field(strict=True, ge=1)] | None = None
    request_id: Annotated[int, Field(strict=True, ge=1)] | None = None
    translation: ShortText | None = None


