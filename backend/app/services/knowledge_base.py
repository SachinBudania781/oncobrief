"""Local Chroma retrieval for source-verified NCG guideline excerpts.

The metadata predicate is passed to Chroma as part of ``Collection.query`` so
records from other cancers or stage groups cannot enter the vector ranking.
Only source-verified excerpts should be added to ``_REFERENCE_GUIDELINES``.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    import chromadb
    from chromadb.utils import embedding_functions
except ImportError as exc:  # pragma: no cover - depends on deployment extras
    raise RuntimeError(
        "ChromaDB is required for guideline retrieval. Install the backend "
        "requirements, including the chromadb package."
    ) from exc


COLLECTION_NAME = "ncg_cancer_guidelines"
DEFAULT_PERSIST_PATH = "./ncg_chroma_db"

# The official NCG guidelines index currently links to 2019 breast/thoracic
# guidelines (and 2021 palliative care), not a 2024 edition. These short,
# verified excerpts are from the NCG Breast Cancer Management Guidelines 2019.
# Do not relabel them as a newer edition or expand them from memory. Add further
# snippets only after verifying the text and printed page in the actual source.
_REFERENCE_GUIDELINES: tuple[dict[str, Any], ...] = (
    {
        "id": "ncg_breast_2019_adjuvant_p12",
        "text": "4 cycles AC/EC q 3 wk - 4 cycles Taxanes q 3 wk",
        "metadata": {
            "cancer_type": "breast",
            "stage_category": "stage_ii_iii",
            "doc": "NCG Breast Cancer Management Guidelines 2019",
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
            "cancer_type": "breast",
            "stage_category": "stage_iv",
            "doc": "NCG Breast Cancer Management Guidelines 2019",
            "page": 23,
            "section": "Hormone receptor positive and HER 2 negative MBC",
            "source_url": "https://www.ncgindia.org/assets/ncg-guidelines-2019/ncg-guidelines-for-breast-cancer-2019.pdf",
            "verification_status": "verified_excerpt",
        },
    },
)

_CANCER_ALIASES = {
    "breast": "breast",
    "breast cancer": "breast",
    "lung": "lung",
    "lung cancer": "lung",
    "nsclc": "lung",
    "non-small cell lung cancer": "lung",
    "general": "general",
}


def _normalize_cancer_type(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("cancer_type must be a non-empty string")
    key = re.sub(r"\s+", " ", value.strip().lower())
    try:
        return _CANCER_ALIASES[key]
    except KeyError as exc:
        raise ValueError(
            "Unsupported cancer_type. Use breast, lung, or general; "
            "unknown types are not broadened to another cancer."
        ) from exc


def _normalize_stage(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("stage_group must be a non-empty string")
    raw = value.strip().lower()
    if raw in {"stage_ii_iii", "ii_iii", "stage ii-iii", "ii-iii"}:
        return "stage_ii_iii"
    stage = re.sub(r"[\s_-]+", "", raw)
    stage = stage.removeprefix("stage")
    if stage in {"iv", "4", "iva", "ivb", "ivc", "m1", "m1a", "m1b", "m1c"}:
        return "stage_iv"
    if stage in {
        "ii", "2", "iia", "iib", "iii", "3", "iiia", "iiib", "iiic",
        "2a", "2b", "3a", "3b", "3c",
    }:
        return "stage_ii_iii"
    if stage in {"i", "1", "ia", "ib", "ic", "1a", "1b", "1c"}:
        return "stage_i"
    if stage in {"all", "unknown", "notrecorded", "unspecified"}:
        # Disease-specific matches are deliberately excluded when stage is not
        # known. The `all` branch in the filter remains for general guidance.
        return "stage_unknown"
    raise ValueError(f"Unsupported stage_group: {value!r}")


class NCGGuidelineStore:
    """Persistent Chroma collection with hard metadata pre-filtering."""

    def __init__(self, persist_path: str | Path = DEFAULT_PERSIST_PATH) -> None:
        path = Path(persist_path).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(path))
        self.embedding_fn = embedding_functions.DefaultEmbeddingFunction()
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=self.embedding_fn,
            metadata={"description": "Source-verified NCG guideline excerpts"},
        )
        self._seed_reference_guidelines()

    def _seed_reference_guidelines(self) -> None:
        """Idempotently add the bundled, source-verified starter excerpts."""
        if not _REFERENCE_GUIDELINES:
            return
        # Upsert avoids a startup race if multiple API workers initialize the
        # same persistent collection at once.
        self.collection.upsert(
            ids=[item["id"] for item in _REFERENCE_GUIDELINES],
            documents=[item["text"] for item in _REFERENCE_GUIDELINES],
            metadatas=[item["metadata"] for item in _REFERENCE_GUIDELINES],
        )

    @staticmethod
    def _build_filter(cancer_type: str, stage_group: str) -> dict[str, Any]:
        """Build a restrictive Chroma ``where`` filter before vector ranking."""
        cancer = _normalize_cancer_type(cancer_type)
        stage = _normalize_stage(stage_group)

        if cancer == "general":
            cancer_filter: dict[str, Any] = {"cancer_type": "general"}
        else:
            cancer_filter = {
                "$or": [
                    {"cancer_type": cancer},
                    {"cancer_type": "general"},
                ]
            }

        if stage == "stage_unknown":
            stage_filter: dict[str, Any] = {"stage_category": "all"}
        else:
            stage_filter = {
                "$or": [
                    {"stage_category": stage},
                    {"stage_category": "all"},
                ]
            }
        return {"$and": [cancer_filter, stage_filter]}

    def query_guideline_with_provenance(
        self,
        query: str,
        cancer_type: str,
        stage_group: str,
        *,
        n_results: int = 3,
    ) -> list[dict[str, Any]]:
        """Return stage/cancer-filtered text with display-ready provenance.

        Results omit any record lacking required source metadata. This prevents
        an incomplete or hand-added vector from being shown as a verified cite.
        """
        if not isinstance(query, str) or not query.strip():
            raise ValueError("query must be a non-empty string")
        if isinstance(n_results, bool) or not isinstance(n_results, int) or n_results < 1:
            raise ValueError("n_results must be a positive integer")

        where_filter = self._build_filter(cancer_type, stage_group)
        results = self.collection.query(
            query_texts=[query.strip()],
            n_results=n_results,
            where=where_filter,
            include=["documents", "metadatas", "distances"],
        )
        documents = (results.get("documents") or [[]])[0] or []
        metadatas = (results.get("metadatas") or [[]])[0] or []
        distances = (results.get("distances") or [[]])[0] or []

        formatted: list[dict[str, Any]] = []
        for index, (document, metadata) in enumerate(zip(documents, metadatas)):
            if not isinstance(metadata, dict):
                continue
            required = ("doc", "page", "section", "cancer_type", "stage_category")
            if not all(key in metadata for key in required):
                continue
            if metadata.get("verification_status") != "verified_excerpt":
                continue
            result = {
                "text": document,
                "verbatim_text": document,
                "doc": metadata["doc"],
                "page": metadata["page"],
                "section": metadata["section"],
                "source_url": metadata.get("source_url"),
                "verification_status": metadata["verification_status"],
                "metadata": metadata,
            }
            if index < len(distances):
                result["distance"] = distances[index]
            formatted.append(result)
        return formatted

