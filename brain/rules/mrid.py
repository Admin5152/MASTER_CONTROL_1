"""The NASA JSC 28913 MRIDs (shared/nasa_mrid.json) as evidence for the brain.

For a health or body question, pick the two or three documents that match it best and hand the model a short,
quoted summary of each (what NASA measures, how, and when), so an answer can say how NASA monitors something and
name the document. Selection is plain keyword scoring: fast, deterministic, no extra model call.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

PATH = Path(__file__).resolve().parents[2] / "shared" / "nasa_mrid.json"

# words people say -> words the documents use
TOPICS = {
    "heart": "ecg electrocardiogram cardiovascular heart rate blood pressure cardiac",
    "pulse": "heart rate ecg cardiovascular", "blood pressure": "blood pressure cardiovascular",
    "eye": "eye ophthalmology vision visual acuity optic retina", "vision": "eye ophthalmology vision visual acuity",
    "sight": "eye vision ophthalmology", "hear": "hearing audiometry acoustic noise", "ear": "hearing audiometry acoustic",
    "noise": "acoustic noise hearing dba", "loud": "acoustic noise hearing",
    "bone": "bone densitometry dxa musculoskeletal", "muscle": "strength fitness musculoskeletal handgrip conditioning",
    "fit": "fitness aerobic treadmill ergometer exercise", "exercise": "exercise fitness treadmill ergometer conditioning",
    "lung": "pulmonary spirometry lung", "breath": "pulmonary respiration lung", "oxygen": "pulmonary oxygen prebreathe",
    "radiation": "radiation dosimetry dosimeter tepc biodosimetry", "dose": "radiation dosimetry biodosimetry",
    "air": "air quality toxicological carbon dioxide combustion", "co2": "carbon dioxide toxicological air",
    "carbon": "carbon dioxide toxicological", "water": "potable water quality microbial",
    "blood": "laboratory hematology chemistry blood", "lab": "laboratory hematology chemistry urinalysis",
    "skin": "skin photodocumentation allergic", "rash": "skin allergic photodocumentation",
    "teeth": "dental", "tooth": "dental", "brain": "neurological mri brain neurovestibular",
    "dizzy": "neurovestibular neurological vestibular", "balance": "neurovestibular vestibular",
    "mood": "psychological psychiatric behavioral conference", "stress": "psychological behavioral conference",
    "lonely": "family conference psychological", "family": "family conference", "sleep": "psychological behavioral",
    "eva": "eva prebreathe extravehicular", "spacewalk": "eva prebreathe extravehicular", "weight": "body mass",
    "germ": "microbiology microbial", "infection": "microbiology tuberculosis mrsa", "stomach": "laboratory h. pylori nutritional",
    "food": "nutritional", "nutrition": "nutritional", "ultrasound": "ultrasound sonography",
}


@lru_cache(maxsize=1)
def documents() -> list[dict]:
    try:
        return json.loads(PATH.read_text(encoding="utf-8"))["documents"]
    except (OSError, ValueError, KeyError):
        return []


def relevant(question: str, limit: int = 3) -> list[dict]:
    """The documents that best match a question, best first; empty when nothing matches well."""
    q = question.lower()
    terms = set(re.findall(r"[a-z0-9]+", q))
    for w in terms.copy():   # each word picks its longest topic ("heart" is not "hear")
        keys = [k for k in TOPICS if " " not in k and w.startswith(k)]
        if keys:
            terms.update(TOPICS[max(keys, key=len)].split())
    for k in (k for k in TOPICS if " " in k and k in q):
        terms.update(TOPICS[k].split())
    terms -= {"the", "a", "and", "of", "my", "is", "i", "in", "to", "how", "what", "do", "does", "for", "with", "you", "me", "it", "are"}
    scored = []
    for d in documents():
        title = d["title"].lower()
        body = f"{d['purpose']} {d['parameters']}".lower()
        s = sum(3 for t in terms if len(t) > 2 and t in title) + sum(1 for t in terms if len(t) > 3 and t in body)
        if s >= 3:
            scored.append((s, d))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:limit]]


def _short(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n].rsplit(" ", 1)[0] + "…"


def context(question: str) -> str:
    """A compact evidence block for the prompt (about 150 tokens per document), or '' when nothing matches."""
    docs = relevant(question)
    if not docs:
        return ""
    lines = []
    for d in docs:
        when = "; ".join(x for x in (
            f"preflight: {_short(d['preflight'], 110)}" if d.get("preflight") else "",
            f"in flight: {_short(d['inflight'], 130)}" if d.get("inflight") else "",
        ) if x)
        lines.append(f"- {d['id']} \"{d['title']}\": why: {_short(d['purpose'], 170)} | measured: {_short(d['parameters'], 170)}"
                     + (f" | {when}" if when else ""))
    return "\n".join(lines)
