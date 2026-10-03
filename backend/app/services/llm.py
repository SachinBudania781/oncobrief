"""Provider-agnostic LLM call. Only used to write the narrative part of the doctor's brief.
Returns None on any failure so the caller falls back to the deterministic writer."""
from __future__ import annotations

import json
import re

import httpx

from .. import config

DEFAULT_MODELS = {
    "gemini": "gemini-2.5-flash",
    "anthropic": "claude-haiku-4-5-20251001",
    "openai": "gpt-4o-mini",
}


def enabled() -> bool:
    return config.LLM_PROVIDER in DEFAULT_MODELS and bool(config.LLM_API_KEY)


def model_name() -> str:
    return config.LLM_MODEL or DEFAULT_MODELS.get(config.LLM_PROVIDER, "")


def _extract_json(text: str):
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


def complete_json(system: str, user: str, timeout: float = 25.0):
    if not enabled():
        return None
    p, key, model = config.LLM_PROVIDER, config.LLM_API_KEY, model_name()
    try:
        if p == "anthropic":
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": model, "max_tokens": 1500, "temperature": 0.1, "system": system,
                      "messages": [{"role": "user", "content": user}]},
                timeout=timeout,
            )
            r.raise_for_status()
            text = "".join(b.get("text", "") for b in r.json().get("content", []))
        elif p == "gemini":
            r = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": key},
                json={"systemInstruction": {"parts": [{"text": system}]},
                      "contents": [{"role": "user", "parts": [{"text": user}]}],
                      "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}},
                timeout=timeout,
            )
            r.raise_for_status()
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        else:  # openai or any OpenAI-compatible endpoint (Groq, Together, local vLLM…)
            base = config.LLM_BASE_URL or "https://api.openai.com/v1"
            r = httpx.post(
                f"{base.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "temperature": 0.1,
                      "response_format": {"type": "json_object"},
                      "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
                timeout=timeout,
            )
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
        return _extract_json(text)
    except Exception as exc:  # network, quota, parsing — never break the demo
        print(f"[llm] falling back: {exc!r}")
        return None
