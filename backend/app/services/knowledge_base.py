"""Stage- and disease-filtered retrieval of source-verified NCG excerpts.

Metadata constraints are passed to Chroma as part of the vector query. A query
without an explicit, supported cancer site and stage returns no guidelines;
it never falls back to an unfiltered vector search.
"""
from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

try:
    import chromadb
    from chromadb.utils import embedding_functions
except ImportError as exc:  # pragma: no cover - depends on deployment extras
    raise RuntimeError(
        "ChromaDB is required for guideline retrieval. Install the backend "
        "requirements, including the chromadb package."
    ) from exc


COLLECTION_NAME = "oncology_guidelines"
DEFAULT_PERSIST_PATH = "./chroma_oncology_db"
CancerSite = Literal[
    "breast", "lung_nsclc", "lung_sclc", "colorectal", "head_neck", "prostate"
]
TreatmentIntent = Literal[
    "curative", "neoadjuvant", "adjuvant", "palliative_metastatic"
]


class PatientClinicalProfile(BaseModel):
    """Only explicitly recorded clinical facts may constrain retrieval."""

    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)

    cancer_site: CancerSite | None = None
    stage: str | None = Field(default=None, max_length=80)
    biomarkers: list[str] = Field(default_factory=list, max_length=30)
    intent: TreatmentIntent | None = None
    clinical_keywords: str = Field(default="", max_length=2000)

    @field_validator("biomarkers")
    @classmethod
    def clean_biomarkers(cls, values: list[str]) -> list[str]:
        clean = []
        for value in values:
            marker = value.strip()
            if not marker or len(marker) > 80:
                raise ValueError("Each biomarker must contain 1 to 80 characters")
            clean.append(marker)
        return list(dict.fromkeys(clean))


# Official NCG index/source pages were checked; these starter excerpts are from
# the NCG Breast Cancer Management Guidelines 2019. No unsupported 2024 text or
# page numbers are presented as official. Add sources only after verification.
_REFERENCE_GUIDELINES: tuple[dict[str, Any], ...] = (
    {
        "id": "ncg_breast_2019_adjuvant_p12",
        "text": "4 cycles AC/EC q 3 wk - 4 cycles Taxanes q 3 wk",
        "metadata": {
            "cancer_site": "breast",
            "stage": "stage_ii_iii",
            "cancer_type": "breast",
            "stage_category": "stage_ii_iii",
            "doc": "NCG Breast Cancer Management Guidelines 2019",
            "source": "NCG Breast Cancer Management Guidelines 2019",
            "page": 12,
            "section": "Systemic therapy (Adjuvant/ Neo adjuvant)",
            "source_url": "https://www.ncgindia.org/assets/ncg-guidelines-2019/ncg-guidelines-for-breast-cancer-2019.pdf",
            "verification_status": "verified_excerpt",
        },
    },
    {
        "id": "ncg_breast_2019_metastatic_p23",
        "text": "AI /Tamoxifen with CDK4/6 inhibitors (c)",
        "metadata": {
            "cancer_site": "breast",
            "stage": "stage_iv",
            "cancer_type": "breast",
            "stage_category": "stage_iv",
            "doc": "NCG Breast Cancer Management Guidelines 2019",
            "source": "NCG Breast Cancer Management Guidelines 2019",
            "page": 23,
            "section": "Hormone receptor positive and HER 2 negative MBC",
            "source_url": "https://www.ncgindia.org/assets/ncg-guidelines-2019/ncg-guidelines-for-breast-cancer-2019.pdf",
            "verification_status": "verified_excerpt",
        },
    },
    {
        "id": "ncg_breast_2019_her2_adjuvant_p14",
        "text": "Adjuvant Trastuzumab for 1 year is the standard practice",
        "metadata": {
            "cancer_site": "breast",
            "stage": "stage_ii_iii",
            "cancer_type": "breast",
            "stage_category": "stage_ii_iii",
            "doc": "NCG Breast Cancer Management Guidelines 2019",
            "source": "NCG Breast Cancer Management Guidelines 2019",
            "page": 14,
            "section": "Targeted therapy — HER2-positive invasive cancer",
            "source_url": "https://www.ncgindia.org/assets/ncg-guidelines-2019/ncg-guidelines-for-breast-cancer-2019.pdf",
            "verification_status": "verified_excerpt",
        },
    },
    {
        "id": "ncg_thoracic_2019_adjuvant_p4",
        "text": "Stage II and III A, T > 4 cm; node positive",
        "metadata": {
            "cancer_site": "lung_nsclc",
            "stage": "stage_ii_iii",
            "cancer_type": "lung",
            "stage_category": "stage_ii_iii",
            "doc": "NCG Thoracic Malignancies Management Guidelines 2019",
            "source": "NCG Thoracic Malignancies Management Guidelines 2019",
            "page": 4,
            "section": "Management of Non-Small Cell Lung Cancer — Adjuvant chemotherapy",
            "source_url": "https://www.ncgindia.org/assets/ncg-guidelines-2019/ncg-guidelines-for-thoracic-cancer-2019.pdf",
            "verification_status": "verified_excerpt",
        },
    },
    {
        "id": "ncg_thoracic_2019_cisplatin_alternative_p9",
        "text": "Patients Not Able to Tolerate Cisplatin: Carboplatin AUC 5-6 day 1 + Paclitaxel",
        "metadata": {
            "cancer_site": "lung_nsclc",
            "stage": "stage_ii_iii",
            "cancer_type": "lung",
            "stage_category": "stage_ii_iii",
            "doc": "NCG Thoracic Malignancies Management Guidelines 2019",
            "source": "NCG Thoracic Malignancies Management Guidelines 2019",
            "page": 9,
            "section": "Chemotherapy regimens for patients unable to tolerate cisplatin",
            "source_url": "https://www.ncgindia.org/assets/ncg-guidelines-2019/ncg-guidelines-for-thoracic-cancer-2019.pdf",
            "verification_status": "verified_excerpt",
        },
    }
)

_SITE_ALIASES = {
    "breast": "breast",
    "breast cancer": "breast",
    "lung_nsclc": "lung_nsclc",
    "nsclc": "lung_nsclc",
    "non-small cell lung cancer": "lung_nsclc",
    "lung_sclc": "lung_sclc",
    "sclc": "lung_sclc",
    "small cell lung cancer": "lung_sclc",
    "colorectal": "colorectal",
    "colorectal cancer": "colorectal",
    "head_neck": "head_neck",
    "head and neck": "head_neck",
    "head and neck cancer": "head_neck",
    "prostate": "prostate",
    "prostate cancer": "prostate",
}


def _normalize_cancer_site(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("cancer_site must be explicitly provided")
    key = re.sub(r"\s+", " ", value.strip().lower())
    try:
        return _SITE_ALIASES[key]
    except KeyError as exc:
        # Patient records sometimes store histology and biomarkers together with
        # the primary site. Extract only a site named explicitly in that field.
        detected: set[str] = set()
        if re.search(r"\b(?:breast|mammary)\b", key):
            detected.add("breast")
        if re.search(r"\b(?:nsclc|non[- ]small[ -]cell)\b", key):
            detected.add("lung_nsclc")
        elif re.search(r"\b(?:sclc|small[ -]cell)\b", key):
            detected.add("lung_sclc")
        elif re.search(r"\blung\b", key):
            detected.add("lung")
        if re.search(r"\b(?:colorectal|colon|rectal|rectum|sigmoid)\b", key):
            detected.add("colorectal")
        if re.search(r"\bhead[ -]*(?:and|&)\s*neck\b", key):
            detected.add("head_neck")
        if re.search(r"\bprostate\b", key):
            detected.add("prostate")
        if len(detected) == 1 and "lung" not in detected:
            return next(iter(detected))
        raise ValueError(
            "Unsupported or ambiguous cancer site. Use a specific supported site; "
            "generic 'lung' is ambiguous between NSCLC and SCLC."
        ) from exc


def _normalize_stage_group(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("stage must be explicitly provided")
    raw = value.strip().lower()
    if raw in {"stage_ii_iii", "ii_iii", "stage ii-iii", "ii-iii"}:
        return "stage_ii_iii"
    stage = re.sub(r"[\s_-]+", "", raw).removeprefix("stage")
    if stage in {"iv", "4", "iva", "ivb", "ivc", "m1", "m1a", "m1b", "m1c"}:
        return "stage_iv"
    if stage in {
        "ii", "2", "iia", "iib", "iii", "3", "iiia", "iiib", "iiic",
        "2a", "2b", "3a", "3b", "3c",
    }:
        return "stage_ii_iii"
    if stage in {"i", "1", "ia", "ib", "ic", "1a", "1b", "1c"}:
        return "stage_i"
    raise ValueError(
        "Stage is not a supported group. TNM-only data is not converted into a "
        "stage group by semantic search."
    )


def _biomarker_key(value: str) -> str:
    marker = value.strip().casefold().replace("+", "_pos").replace("-", "_")
    key = re.sub(r"[^a-z0-9]+", "_", marker).strip("_")
    if not key or len(key) > 80:
        raise ValueError(f"Unsupported biomarker token: {value!r}")
    return f"biomarker__{key}"


class ClinicalChromaRetriever:
    """Persistent Chroma vector store with hard metadata pre-filtering."""

    def __init__(self, persist_dir: str | Path = DEFAULT_PERSIST_PATH) -> None:
        path = Path(persist_dir).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(path))
        self.embedding_fn = embedding_functions.DefaultEmbeddingFunction()
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=self.embedding_fn,
            metadata={"hnsw:space": "cosine", "description": "NCG guideline excerpts"},
        )
        self._seed_reference_guidelines()

    def _seed_reference_guidelines(self) -> None:
        if not _REFERENCE_GUIDELINES:
            return
        self.collection.upsert(
            ids=[item["id"] for item in _REFERENCE_GUIDELINES],
            documents=[item["text"] for item in _REFERENCE_GUIDELINES],
            metadatas=[item["metadata"] for item in _REFERENCE_GUIDELINES],
        )

    def index_guideline_chunk(
        self,
        doc_id: str,
        text_content: str,
        cancer_site: str,
        stage: str,
        section: str,
        guideline_source: str = "user-provided source",
        *,
        page: int | None = None,
        source_url: str | None = None,
        biomarkers: list[str] | None = None,
        intent: str | None = None,
        verified: bool = False,
    ) -> None:
        """Index one chunk; unverified material is never returned as a cite."""
        if not doc_id.strip() or not text_content.strip() or not section.strip():
            raise ValueError("doc_id, text_content, and section are required")
        site = _normalize_cancer_site(cancer_site)
        stage_group = _normalize_stage_group(stage)
        if isinstance(page, bool) or (page is not None and page < 1):
            raise ValueError("page must be a positive integer when provided")
        if verified and (page is None or not source_url or not guideline_source.strip()):
            raise ValueError("Verified citations require source title, page, and source URL")
        if intent is not None and intent not in {
            "curative", "neoadjuvant", "adjuvant", "palliative_metastatic"
        }:
            raise ValueError("Unsupported treatment intent")

        metadata: dict[str, Any] = {
            "cancer_site": site,
            "stage": stage_group,
            "cancer_type": "breast" if site == "breast" else site,
            "stage_category": stage_group,
            "section": section.strip(),
            "source": guideline_source.strip(),
            "doc": guideline_source.strip(),
            "verification_status": "verified_excerpt" if verified else "unverified",
        }
        if page is not None:
            metadata["page"] = page
        if source_url:
            metadata["source_url"] = source_url
        if intent:
            metadata["intent"] = intent
        for biomarker in dict.fromkeys(biomarkers or []):
            metadata[_biomarker_key(biomarker)] = True

        self.collection.upsert(
            ids=[doc_id], documents=[text_content.strip()], metadatas=[metadata]
        )

    @staticmethod
    def _build_filter(profile: PatientClinicalProfile) -> dict[str, Any]:
        if not profile.cancer_site or not profile.stage:
            raise ValueError("Both an explicit cancer_site and stage are required")
        site = _normalize_cancer_site(profile.cancer_site)
        stage = _normalize_stage_group(profile.stage)
        conditions: list[dict[str, Any]] = [
            {"cancer_site": {"$eq": site}},
            {"stage": {"$eq": stage}},
        ]
        if profile.intent:
            conditions.append({"intent": {"$eq": profile.intent}})
        for biomarker in profile.biomarkers:
            conditions.append({_biomarker_key(biomarker): {"$eq": True}})
        return {"$and": conditions}

    def retrieve_with_filters(
        self,
        profile: PatientClinicalProfile,
        top_k: int = 3,
        distance_threshold: float = 0.45,
    ) -> dict[str, Any]:
        """Retrieve only same-site, same-stage chunks and report match quality."""
        if isinstance(top_k, bool) or not isinstance(top_k, int) or not 1 <= top_k <= 20:
            raise ValueError("top_k must be an integer from 1 to 20")
        if (isinstance(distance_threshold, bool)
                or not isinstance(distance_threshold, (int, float))
                or not math.isfinite(distance_threshold)
                or not 0 <= distance_threshold <= 2):
            raise ValueError("distance_threshold must be finite and between 0 and 2")

        try:
            where_clause = self._build_filter(profile)
        except ValueError as exc:
            return {
                "documents": [],
                "is_high_confidence": False,
                "confidence_reason": str(exc),
            }

        query_text = " ".join(
            part.strip()
            for part in (profile.clinical_keywords, " ".join(profile.biomarkers))
            if part and part.strip()
        )
        if not query_text:
            return {
                "documents": [],
                "is_high_confidence": False,
                "confidence_reason": "No clinical keywords or biomarkers were provided.",
            }

        results = self.collection.query(
            query_texts=[query_text],
            n_results=top_k,
            where=where_clause,
            include=["documents", "metadatas", "distances"],
        )
        documents = (results.get("documents") or [[]])[0] or []
        metadatas = (results.get("metadatas") or [[]])[0] or []
        distances = (results.get("distances") or [[]])[0] or []

        retrieved: list[dict[str, Any]] = []
        for doc, meta, distance in zip(documents, metadatas, distances):
            if not isinstance(meta, dict):
                continue
            required = ("doc", "page", "section", "cancer_site", "stage")
            if not all(key in meta for key in required):
                continue
            if meta.get("verification_status") != "verified_excerpt":
                continue
            if isinstance(distance, bool) or not isinstance(distance, (int, float)):
                continue
            retrieved.append({
                "content": doc,
                "metadata": meta,
                "similarity": round(1.0 - float(distance), 3),
                "raw_distance": float(distance),
            })

        high_confidence = bool(retrieved) and all(
            item["raw_distance"] <= distance_threshold for item in retrieved
        )
        if not retrieved:
            reason = "No verified guideline chunks matched the explicit cancer site and stage."
        elif high_confidence:
            reason = "All retrieved verified excerpts met the distance threshold."
        else:
            reason = "At least one retrieved excerpt exceeded the distance threshold."
        return {
            "documents": retrieved,
            "is_high_confidence": high_confidence,
            "confidence_reason": reason,
        }

    def query_guideline_with_provenance(
        self,
        query: str,
        cancer_type: str,
        stage_group: str,
        *,
        n_results: int = 3,
        biomarkers: list[str] | None = None,
        intent: str | None = None,
    ) -> list[dict[str, Any]]:
        """Compatibility adapter for the clinician brief endpoint."""
        if not isinstance(query, str) or not query.strip():
            raise ValueError("query must be a non-empty string")
        site = _normalize_cancer_site(cancer_type)
        profile = PatientClinicalProfile(
            cancer_site=site,
            stage=stage_group,
            biomarkers=biomarkers or [],
            intent=intent,  # only pass this when explicitly recorded
            clinical_keywords=query.strip(),
        )
        result = self.retrieve_with_filters(profile, top_k=n_results)
        formatted = []
        for match in result["documents"]:
            metadata = match["metadata"]
            formatted.append({
                "text": match["content"],
                "verbatim_text": match["content"],
                "doc": metadata["doc"],
                "page": metadata["page"],
                "section": metadata["section"],
                "source_url": metadata.get("source_url"),
                "verification_status": metadata["verification_status"],
                "metadata": metadata,
                "distance": match["raw_distance"],
                "similarity": match["similarity"],
                "is_high_confidence": result["is_high_confidence"],
            })
        return formatted

