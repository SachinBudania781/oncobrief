"""Retrieval for the RAG brief: chunk every document in ONE patient's folder, score chunks with
BM25 against a visit-type query plan, boost by category weight and recency. No vector DB needed —
a single patient folder holds tens of documents, not millions."""
from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime

from ..models import Document

QUERY_PLANS = {
    "follow_up": {
        "terms": "cycle chemotherapy toxicity response cbc haemoglobin neutrophil platelet fever nausea "
                 "impression plan review symptoms dose delay marker cea ca trend stable progression",
        "weights": {"Lab report": 1.3, "Treatment": 1.4, "Clinical note": 1.3, "Imaging": 1.1,
                    "Pathology": 0.8, "Prescription": 1.0, "Patient-reported": 1.2},
        "recency_half_life_days": 45,
    },
    "new": {
        "terms": "referral complaint history biopsy diagnosis carcinoma histopathology impression "
                 "grade stage mass lesion cytology findings presenting",
        "weights": {"Clinical note": 1.5, "Pathology": 1.6, "Imaging": 1.3, "Lab report": 1.0,
                    "Treatment": 0.8, "Prescription": 0.8, "Patient-reported": 1.1},
        "recency_half_life_days": 365,
    },
    "transfer": {
        "terms": "discharge summary treatment history started regimen response assessment molecular egfr "
                 "alk pd-l1 mutation impression referral transfer cumulative dose surgery radiotherapy",
        "weights": {"Clinical note": 1.5, "Treatment": 1.5, "Pathology": 1.4, "Imaging": 1.3,
                    "Lab report": 0.9, "Prescription": 1.0, "Patient-reported": 0.9},
        "recency_half_life_days": 180,
    },
}

_TOKEN = re.compile(r"[a-z0-9][a-z0-9\-\.]*")


def tokenize(text: str) -> list[str]:
    return [t.strip(".") for t in _TOKEN.findall(text.lower()) if len(t) > 1]


def chunk(doc: Document, size: int = 600, overlap: int = 120) -> list[dict]:
    text = re.sub(r"[ \t]+", " ", doc.ocr_text or "").strip()
    if not text:
        text = f"{doc.title}. {doc.category} - {doc.subtype}."
    out, i = [], 0
    while i < len(text):
        out.append({"doc_id": doc.id, "text": text[i:i + size], "category": doc.category,
                    "subtype": doc.subtype, "date": doc.record_date, "title": doc.title})
        if i + size >= len(text):
            break
        i += size - overlap
    return out


def retrieve(docs: list[Document], visit_type: str, top_k: int = 16, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now()
    plan = QUERY_PLANS.get(visit_type, QUERY_PLANS["follow_up"])
    chunks = [c for d in docs for c in chunk(d)]
    if not chunks:
        return []
    toks = [tokenize(c["text"]) for c in chunks]
    n = len(chunks)
    avgdl = sum(len(t) for t in toks) / n
    df = Counter(w for t in toks for w in set(t))
    q = tokenize(plan["terms"])
    k1, b = 1.5, 0.75
    for c, t in zip(chunks, toks):
        tf = Counter(t)
        score = 0.0
        for w in q:
            if w not in tf:
                continue
            idf = math.log(1 + (n - df[w] + 0.5) / (df[w] + 0.5))
            score += idf * tf[w] * (k1 + 1) / (tf[w] + k1 * (1 - b + b * len(t) / avgdl))
        age = max((now - c["date"]).days, 0)
        recency = 0.5 + 0.5 * math.exp(-age / plan["recency_half_life_days"])
        c["score"] = round((score + 0.5) * plan["weights"].get(c["category"], 1.0) * recency, 3)
    chunks.sort(key=lambda c: c["score"], reverse=True)
    # keep at most 2 chunks per document so one long report can't crowd out the rest
    seen, picked = Counter(), []
    for c in chunks:
        if seen[c["doc_id"]] < 2:
            picked.append(c)
            seen[c["doc_id"]] += 1
        if len(picked) >= top_k:
            break
    return picked


def search_documents(docs: list[Document], query: str) -> list[tuple[Document, str]]:
    """Plain full-text search over OCR text + title for the records-search screen."""
    q = query.lower().strip()
    if not q:
        return [(d, "") for d in docs]
    out = []
    for d in docs:
        hay = f"{d.title}\n{d.subtype}\n{d.ocr_text or ''}"
        idx = hay.lower().find(q)
        if idx >= 0:
            s = max(idx - 60, 0)
            out.append((d, hay[s: idx + len(q) + 80].replace("\n", " ")))
    return out
