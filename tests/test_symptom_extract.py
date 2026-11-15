"""Test voice symptom intake: LLM extracts fields; deterministic rules pick protocol.
NASA Medical Autonomy Principle: The language model only extracts fields (zone, symptom, onset, severity);
rules pick the medical protocol, so the model never decides care.
"""
import os
os.environ["SENTINEL_NO_NETWORK"] = "1"
os.environ["SENTINEL_NO_WARM"] = "1"

import pytest
import server
import brain.ai.llm as llm
import brain.clinical.protocols as protocols
from fastapi import HTTPException


def test_symptom_extract_headache_and_dizziness():
    """The astronaut says: 'I've had a headache since morning and feel dizzy.'"""
    data = server.symptom_extract({
        "text": "I've had a headache since morning and feel dizzy.",
        "crew_id": "james"
    })
    
    # 1. Extracted fields contract (LLM / NLP extractor extracts structured fields only)
    assert data["zone"] == "head"
    assert "headache" in data["symptom"]
    assert "dizzy" in data["symptom"] or "dizziness" in data["symptom"]
    assert "morning" in data["onset"].lower()
    assert data["severity"] in (1, 2, 3)
    assert "confirm" in data["confirmation"].lower()
    assert "twi_confirmation" in data
    
    # 2. Protocol must be chosen deterministically by rules (not arbitrary LLM advice)
    assert data["protocol"] is not None
    assert data["protocol"]["id"] == "headache_tx"
    assert "Headache" in data["protocol"]["title"]
    assert data["protocol"]["source"]["mrid"] == "MEDB 1.2"
    assert len(data["protocol"]["steps"]) >= 3


def test_symptom_extract_chest_tightness():
    """Astronaut reports chest tightness after exercise."""
    data = server.symptom_extract({
        "text": "I have chest tightness and my heart is racing",
        "crew_id": "james"
    })
    assert data["zone"] == "chest"
    assert "chest" in data["symptom"]
    assert data["protocol"] is not None
    assert data["protocol"]["id"] == "high_resting_hr_tx"


def test_symptom_extract_requires_text():
    with pytest.raises(HTTPException) as exc:
        server.symptom_extract({"text": ""})
    assert exc.value.status_code == 400
