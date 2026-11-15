"""Fetch the NASA Life Sciences Portal (NLSP) dataset index and keep what is relevant to Sentinel.

Usage: .venv/Scripts/python tools/nlsp_fetch.py [--download N]
Reads the portal's public JSON index (https://nlsp.nasa.gov/api/v1/data/lsda_dataset), keeps the HUMAN datasets
that are "Available online" and touch something Sentinel tracks (sleep, heart rate and blood pressure, reaction
time and cognition, mood and behaviour, vision, bone and muscle, nutrition, radiation, exercise, cabin air),
and writes shared/nlsp_catalog.json: one entry per dataset with its title, experiment, mission, measured
parameters, the Sentinel indicator group it informs, and the portal link.

These are published research datasets (summaries, tables, documents). They are context and citations for the
ranges and protocols, as section 26 of the Product Document says ("Spaceflight context ... read-only"). They
are NOT training data for the anomaly engine, which is rules and statistics over each person's own readings.
--download N also saves up to N of the open files per topic into dataset/nlsp/ (untrusted data: never executed).
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://nlsp.nasa.gov/api/v1"
OUT = ROOT / "shared" / "nlsp_catalog.json"
FILES = ROOT / "dataset" / "nlsp"
UA = {"User-Agent": "Mozilla/5.0 (research client)", "Accept": "application/json"}

# Sentinel indicator group -> words that mark a dataset as informing it (matched on title, parameters, description)
TOPICS = {
    "sleep": ["sleep", "circadian", "actigraph", "melatonin", "fatigue"],
    "cardio": ["heart rate", "blood pressure", "cardiovascular", "orthostatic", "cardiac", "electrocardiogram", "ecg", "arterial"],
    "cognitive": ["reaction time", "cognit", "psychomotor", "vigilance", "neurocognit", "performance test"],
    "mood": ["mood", "behavio", "stress", "psycholog", "isolation", "confinement", "team", "cohesion"],
    "vision": ["ocular", "vision", "visual acuity", "intraocular", "optic", "sans", "eye"],
    "musculoskeletal": ["bone mineral", "bone density", "muscle strength", "muscle mass", "dexa", "dxa", "exercise countermeasure"],
    "nutrition": ["nutrition", "dietary", "vitamin d", "caloric", "body mass", "hydration", "glucose"],
    "radiation": ["radiation", "dosimet", "dose"],
    "respiratory": ["pulmonary", "respirat", "oxygen saturation", "carbon dioxide", "co2", "ventilat"],
    "activity": ["exercise", "aerobic", "vo2", "treadmill", "ergometer"],
}


def get(path: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(f"{API}/{path}", headers=UA), timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def first(v) -> str:
    return str(v[0] if isinstance(v, list) and v else v or "").strip()


def topics_of(doc: dict) -> list[str]:
    text = " ".join([first(doc.get("__title")), " ".join(doc.get("parms") or []), first(doc.get("DatasetDescription"))[:600],
                     first(doc.get("experiment_title"))]).lower()
    return [t for t, words in TOPICS.items() if any(re.search(rf"\b{re.escape(w)}", text) for w in words)]


def main() -> int:
    want = int(sys.argv[sys.argv.index("--download") + 1]) if "--download" in sys.argv else 0
    kept, total, page = [], None, 1
    while True:
        d = get(f"data/lsda_dataset?page={page}&limit=100")
        total = d.get("total", total)
        for doc in d.get("documents", []):
            species = " ".join(doc.get("species") or []).lower()
            if "human" not in species or "online" not in str(doc.get("availability", "")).lower():
                continue
            ts = topics_of(doc)
            if not ts:
                continue
            kept.append({
                "id": doc["id"], "catalog": doc.get("dataset_catalog"), "title": first(doc.get("__title")) or doc.get("element_name"),
                "experiment": first(doc.get("experiment_title")), "experiment_id": first(doc.get("experiment_id")),
                "mission": [str(m) for m in (doc.get("mission_id") if isinstance(doc.get("mission_id"), list) else [doc.get("mission_id")]) if m], "program": first(doc.get("Program")), "type": first(doc.get("experiment_type")),
                "parameters": (doc.get("parms") or [])[:14], "description": re.sub(r"\s+", " ", first(doc.get("DatasetDescription")))[:420],
                "processing": first(doc.get("ProcessingLevel")), "files": doc.get("file_name") or [], "file_size": doc.get("file_size") or [],
                "released": doc.get("release_date"), "groups": ts,
                "url": f"https://nlsp.nasa.gov/search/data/details/{urllib.parse.quote(doc['id'])}?dataType=DATASETS",
            })
        print(f"page {page} of {d.get('totalPages')}: kept {len(kept)}", flush=True)
        if page >= int(d.get("totalPages") or 1):
            break
        page += 1
        time.sleep(0.4)   # be gentle with a public service
    by_group = {t: sum(1 for k in kept if t in k["groups"]) for t in TOPICS}
    OUT.write_text(json.dumps({
        "source": "NASA Life Sciences Portal (NLSP), Life Sciences Data Archive dataset index", "source_url": "https://nlsp.nasa.gov/search/data?dataTypes=DATASETS",
        "fetched": time.strftime("%Y-%m-%d"), "index_total": total, "kept": len(kept), "by_group": by_group,
        "filter": "species includes human; availability 'Available online'; title, parameters or description match a Sentinel indicator group",
        "use": "Context and citations for ranges and protocols. Read-only. Not training data: the anomaly engine is rules and statistics over each person's own readings.",
        "datasets": kept}, indent=1), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(kept)} of {total} datasets; {by_group}")
    if want:
        FILES.mkdir(parents=True, exist_ok=True)
        got = {}
        for k in kept:
            g = k["groups"][0]
            if got.get(g, 0) >= want or not k["files"]:
                continue
            name = re.sub(r"[^A-Za-z0-9._-]", "_", k["files"][0])[:120]
            for key in (k["id"], k["catalog"], k["files"][0]):
                try:
                    req = urllib.request.Request(f"{API}/files/{urllib.parse.quote(str(key))}/download", headers={"User-Agent": UA["User-Agent"]})
                    with urllib.request.urlopen(req, timeout=60) as r:
                        data = r.read(20 * 1024 * 1024)
                    if data and not data.lstrip().startswith(b'{"success":false'):
                        (FILES / name).write_bytes(data)
                        k["local_file"] = f"dataset/nlsp/{name}"
                        got[g] = got.get(g, 0) + 1
                        print(f"saved {name} ({len(data)} bytes) [{g}]", flush=True)
                        break
                except Exception as e:   # the portal asks for a sign-in or a data request for many files
                    last = str(e)[:80]
            else:
                print(f"not downloadable without a request: {k['catalog']} ({last})", flush=True)
            time.sleep(0.4)
        d = json.loads(OUT.read_text(encoding="utf-8"))
        d["datasets"] = kept
        d["downloaded"] = sum(got.values())
        OUT.write_text(json.dumps(d, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
