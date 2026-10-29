"""Explicit adapter contracts: no fabricated calls, translations, prices or registry matches."""
import os
import json
from urllib.parse import urlparse
import httpx
from fastapi import HTTPException

ADAPTERS = {
    "audit_anchor": ("AUDIT_ANCHOR_ADAPTER_URL", "AUDIT_ANCHOR_ADAPTER_KEY"),
    "evidence": ("EVIDENCE_ADAPTER_URL", "EVIDENCE_ADAPTER_KEY"),
    "formulary": ("FORMULARY_ADAPTER_URL", "FORMULARY_ADAPTER_KEY"),
    "er": ("ER_ALERT_ADAPTER_URL", "ER_ALERT_ADAPTER_KEY"),
    "sms": ("SMS_ADAPTER_URL", "SMS_ADAPTER_KEY"),
    "email": ("EMAIL_ADAPTER_URL", "EMAIL_ADAPTER_KEY"),
    "whatsapp": ("WHATSAPP_ADAPTER_URL", "WHATSAPP_ADAPTER_KEY"),
    "phone": ("TELEPHONY_ADAPTER_URL", "TELEPHONY_ADAPTER_KEY"),
    "speech": ("BHASHINI_ADAPTER_URL", "BHASHINI_API_KEY"),
    "translation": ("TRANSLATION_ADAPTER_URL", "TRANSLATION_API_KEY"),
    "trials": ("CTRI_ADAPTER_URL", "CTRI_API_KEY"),
    "prices": ("JAN_AUSHADHI_ADAPTER_URL", "JAN_AUSHADHI_API_KEY"),
    "weather": ("ENVIRONMENT_ADAPTER_URL", "ENVIRONMENT_API_KEY"),
    "vision": ("VISION_ADAPTER_URL", "VISION_API_KEY"),
    "wearables": ("WEARABLE_ADAPTER_URL", "WEARABLE_API_KEY"),
    "telemedicine": ("TELEMEDICINE_ADAPTER_URL", "TELEMEDICINE_API_KEY"),
}


def status():
    return [{"service": k, "configured": all(os.getenv(x) for x in pair), "settings": pair}
            for k, pair in ADAPTERS.items()]


def deliver(service, payload):
    if service not in ADAPTERS:
        raise HTTPException(422, "Unknown integration")
    url_key, key_key = ADAPTERS[service]
    url, key = os.getenv(url_key, ""), os.getenv(key_key, "")
    if not url or not key:
        raise HTTPException(503, f"Service not configured: set {url_key} and {key_key}")
    if urlparse(url).scheme != "https":
        raise HTTPException(503, "Integration adapters must use HTTPS")
    try:
        response = httpx.post(url, json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=25)
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("Invalid adapter response")
        if len(json.dumps(result,allow_nan=False))>2_000_000:
            raise ValueError("Adapter response too large")
        return result
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "The configured service did not return a valid response. Please retry or contact staff.")

