"""Parse the NASA JSC 28913 MRID PDFs in dataset/ into shared/nasa_mrid.json.

Every MRID uses the same form: a "Medical Requirements Overview" table (number and title, purpose, measurement
parameters, deliverables, flight duration, crew), then preflight, in-flight and postflight activity tables. This
reads those fields straight from each document's text, finds the numeric limits it states (dose, ppm, dB, mmHg,
percent, temperatures...), and maps each document to the Sentinel indicators, body zones and features it informs.
Nothing is paraphrased by hand: every field is the document's own wording, trimmed.

    python -I tools/mrid_extract.py          (run from the repository root; needs pypdf)
"""
import json, os, re, sys
from pypdf import PdfReader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "dataset")
OUT = os.path.join(ROOT, "shared", "nasa_mrid.json")

# which Sentinel indicators, zones and features a document informs, by the words it uses
MAP = [
    (r"radiation|dosimet|TEPC|RAD\b|IV-TEPC|REM\b", {"indicators": ["radiation.dose_msv", "radiation.storm_level"], "zones": ["whole_body"], "feature": "radiation"}),
    (r"ECG|electrocardiog|cardio|heart rate|blood pressure|treadmill", {"indicators": ["vitals.heart_rate", "manual.bp_systolic"], "zones": ["heart"], "feature": "vitals"}),
    (r"pulmonary|spirometr|lung", {"indicators": ["vitals.spo2", "vitals.breathing_rate"], "zones": ["lungs"], "feature": "vitals"}),
    (r"ophthalm|vision|visual acuity|eye|optic", {"indicators": ["manual.sleep_hours"], "zones": ["eyes"], "feature": "body"}),
    (r"audiom|hearing|acoustic|noise", {"indicators": ["environment.noise_dba"], "zones": ["head"], "feature": "body"}),
    (r"neurolog|cognit|vestibul|sensorimotor", {"indicators": ["cognitive.reaction_ms"], "zones": ["head"], "feature": "face_voice"}),
    (r"bone|DXA|densitometr|musculoskeletal|osteo", {"indicators": ["manual.exercise_minutes"], "zones": ["bones"], "feature": "body"}),
    (r"laborator|hematolog|urinalysis|blood|chemistry", {"indicators": ["manual.glucose_mgdl"], "zones": ["gut", "whole_body"], "feature": "vitals"}),
    (r"dental|teeth|oral", {"indicators": [], "zones": ["head"], "feature": "body"}),
    (r"skin|derm|allerg", {"indicators": ["manual.temp_c"], "zones": ["whole_body"], "feature": "body"}),
    (r"ultrasound|sonograph|MRI|imaging", {"indicators": [], "zones": ["whole_body"], "feature": "body"}),
    (r"fitness|handgrip|dynamomet|exercise|reconditioning|aerobic", {"indicators": ["manual.exercise_minutes", "vitals.heart_rate"], "zones": ["heart", "bones"], "feature": "vitals"}),
    (r"prebreathe|EVA|decompression", {"indicators": ["vitals.spo2", "vitals.heart_rate"], "zones": ["lungs", "whole_body"], "feature": "integration"}),
    (r"air quality|toxicolog|carbon dioxide|CO2|combustion|grab sample|contaminant", {"indicators": ["cabin.co2_ppm", "cabin.oxygen_pct"], "zones": ["lungs"], "feature": "integration"}),
    (r"water quality|potable|microbiolog|microbial|surface sampl", {"indicators": ["manual.hydration_ml"], "zones": ["gut"], "feature": "integration"}),
    (r"family conference|private medical conference|psycholog|behavioral|conference", {"indicators": ["state.mood", "state.stress"], "zones": ["head"], "feature": "wellbeing"}),
    (r"body mass|anthropometr|weight", {"indicators": [], "zones": ["whole_body"], "feature": "body"}),
    (r"physical exam|medical exam|medical status", {"indicators": ["vitals.heart_rate", "manual.bp_systolic", "manual.temp_c"], "zones": ["whole_body"], "feature": "vitals"}),
]

UNIT = r"(?:mSv|mGy|µGy|uGy|Gy|Sv|rem|mrem|cSv|ppm|mg/m3|mg/m³|mmHg|torr|kPa|psi[a]?|dBA|dB\(A\)|dB|%|°C|°F|deg ?C|bpm|beats per minute|mL|ml|liters?|L/min|kg|lbs?|min(?:utes)?|hours?|days?|cfu|CFU)"
NUM = re.compile(rf"(?:<|>|≤|≥|less than|greater than|not (?:to )?exceed|exceed(?:s|ing)?|above|below|maximum|minimum|limit(?:ed)? (?:of|to)|up to)?\s*\d+(?:[.,]\d+)?\s*(?:-|–|to)?\s*\d*(?:\.\d+)?\s*{UNIT}", re.I)


def undouble(w):
    """Bold table headers come out of the PDF with every letter twice ("MMRR003322LL"): halve those words."""
    if len(w) >= 4 and len(w) % 2 == 0 and all(w[i] == w[i + 1] for i in range(0, len(w), 2)):
        return w[::2]
    return w


def clean(t):
    t = re.sub(r"\S+", lambda m: undouble(m.group(0)), t)
    t = re.sub(r"[ \t]+", " ", t)
    return t


def field(text, names, stop):
    for n in names:
        m = re.search(rf"{n}\s*:?\s*(.+?)(?=\n\s*(?:{stop})\s*:?|\Z)", text, re.S | re.I)
        if m:
            v = re.sub(r"\s+", " ", m.group(1)).strip(" :")
            if v and v.upper() != "N/A":
                return v[:900]
    return ""


STOPS = "Sponsor|IPT|Discipline|Category|References|Purpose/Objectives|Measurement Parameters|Deliverables|Flight Duration|Number of Flights|Number and Type|Other (?:Flight )?Characteristics|3\\.3"


def section(text, head, nxt):
    m = re.search(rf"{head}(.+?)(?={nxt}|\Z)", text, re.S | re.I)
    if not m:
        return ""
    s = m.group(1)
    s = re.sub(r"(?im)^.*(Page \d+ of \d+|Medical Requirements Integration|Documents \(MRIDs\)|Approved \d|Revised \d|TABLE \d|TTAABBLLEE).*$", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:1200]


def main():
    cat = json.load(open(os.path.join(DATASET, "_catalog.json"), encoding="utf-8"))
    items = cat if isinstance(cat, list) else next(v for v in cat.values() if isinstance(v, list))
    docs = []
    for it in items:
        path = os.path.join(DATASET, it["file"])
        try:
            r = PdfReader(path)
            raw = "\n".join((p.extract_text() or "") for p in r.pages)
            pages = len(r.pages)
        except Exception as e:  # a damaged file is reported, not skipped silently
            raw, pages = "", 0
            print(f"could not read {it['file']}: {e}", file=sys.stderr)
        text = clean(raw)
        IDP = r"(MR\d{3}[LS]|MEDB\s*N?\d+(?:\.\d+)*|\bN\d\.\d+)"
        head = re.search(IDP + r"\s*([^\n]{0,140})", text)
        title_field = field(text, [r"MRID# and Title", r"MEDB\s*# and Title", r"MRID # and Title", r"MRID and Title"], STOPS)
        mrid = (re.search(IDP, title_field or "") or head)
        mrid = re.sub(r"\s+", " ", mrid.group(1)) if mrid else ""
        if re.fullmatch(r"N\d\.\d+", mrid):
            mrid = "MEDB " + mrid
        title = title_field or (head.group(0).strip() if head else it.get("title", ""))
        title = re.sub(r"\s+", " ", re.sub(IDP, "", title, count=1)).strip(" -:_") or it.get("title", "")
        title = re.sub(r"^_?\d+(?:\.\d+)+\s*", "", title).strip()
        d = {
            "id": mrid or it.get("title", "")[:12], "title": title[:160], "file": it["file"], "pages": pages,
            "owner": it.get("primaryOwner"), "also": it.get("secondaryOwners") or [],
            "purpose": field(text, [r"Purpose/Objectives"], STOPS),
            "parameters": field(text, [r"Measurement Parameters"], STOPS),
            "deliverables": field(text, [r"Deliverables"], STOPS),
            "flight_duration": field(text, [r"Flight Duration"], STOPS)[:120],
            "crew": field(text, [r"Number and Type of Crew\s*(?:members|Members)? Required"], STOPS)[:200],
            "preflight": section(text, r"Preflight Activit(?:y|ies)", r"3\.5|In-?[Ff]light Activit|Postflight Activit"),
            "inflight": section(text, r"In-?[Ff]light Activit(?:y|ies)", r"3\.6|Postflight Activit|Post-?[Ff]light Activit"),
            "postflight": section(text, r"Post-?[Ff]light Activit(?:y|ies)", r"3\.7|3\.8|Appendix|\Z"),
            "limits": [],
        }
        seen = set()
        for m in NUM.finditer(text):
            s = text[max(0, m.start() - 110): m.end() + 60]
            s = re.sub(r"\s+", " ", s).strip()
            key = m.group(0).strip().lower()
            if key in seen or re.search(r"page \d+ of|\bL-\d|R\+\d|FD\d", s, re.I):
                continue
            seen.add(key)
            d["limits"].append({"value": m.group(0).strip(), "context": s})
            if len(d["limits"]) >= 14:
                break
        blob = " ".join([d["title"], d["purpose"], d["parameters"]])
        ind, zones, feats = [], [], []
        for pat, m in MAP:
            if re.search(pat, blob, re.I):
                ind += m["indicators"]; zones += m["zones"]; feats.append(m["feature"])
        d["indicators"] = sorted(set(ind)); d["zones"] = sorted(set(zones)); d["features"] = sorted(set(feats)) or ["integration"]
        docs.append(d)
    docs.sort(key=lambda d: (d["owner"] or "", d["id"]))
    json.dump({"_doc": "Every NASA JSC 28913 Medical Requirements Integration Document in dataset/, parsed by tools/mrid_extract.py: "
                       "each field is the document's own wording. 'limits' are numeric statements found in the text with their context; "
                       "a limit is only used as a Sentinel threshold after a person checks it (see shared/thresholds.json).",
               "source": "NASA JSC 28913, Medical Requirements Integration Documents (MRIDs)", "count": len(docs), "documents": docs},
              open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote {OUT}: {len(docs)} documents")
    for d in docs:
        print(f"{d['owner']} {d['id']:<11} {d['title'][:52]:<52} p:{bool(d['purpose'])} m:{bool(d['parameters'])} lim:{len(d['limits'])} {','.join(d['features'])}")


if __name__ == "__main__":
    main()
