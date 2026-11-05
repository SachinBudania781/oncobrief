import json
from types import SimpleNamespace

from app.services import llm
from app.services.record_ai import companion_reply


def patient():
    return SimpleNamespace(name="Example Patient", phone="", abha_id="")


def test_companion_reply_sends_current_question_and_validates_citations(monkeypatch):
    calls = []

    def complete(system, user, **kwargs):
        calls.append((system, json.loads(user)))
        return {"language": "en", "answer": "Your report records haemoglobin 9.4 g/dL.", "sources": ["D1"]}

    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(llm.config, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(llm.config, "LLM_MODEL", "test-model")
    monkeypatch.setattr(llm, "complete_json", complete)

    result = companion_reply(
        patient(),
        "What does my haemoglobin result mean?",
        [{"tag": "D1", "title": "CBC", "text": "Haemoglobin 9.4 g/dL"}],
        [{"patient": "What is my CBC?", "assistant": "It is a blood test."}],
        "en",
    )

    assert result["generation"] == "ai"
    assert result["sources"] == ["D1"]
    assert result["answer"].startswith("Your report records")
    assert calls[0][1]["CURRENT_QUESTION"] == "What does my haemoglobin result mean?"
    assert calls[0][1]["CONTEXT"][0]["tag"] == "D1"
    assert calls[0][1]["RECENT_CONVERSATION"][0]["patient"] == "What is my CBC?"


def test_companion_reply_rejects_unknown_citation(monkeypatch):
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(llm, "complete_json", lambda *args, **kwargs: {
        "language": "en", "answer": "Your report says something.", "sources": ["D999"]
    })

    assert companion_reply(
        patient(), "What does my report say?",
        [{"tag": "D1", "title": "CBC", "text": "Haemoglobin result recorded."}],
        language="en",
    ) is None


def test_companion_reply_returns_none_when_provider_disabled(monkeypatch):
    monkeypatch.setattr(llm, "enabled", lambda: False)
    assert companion_reply(patient(), "What should I ask my doctor?", [], language="en") is None
