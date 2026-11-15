# Datasets: what we used and how

Every dataset Sentinel uses, where it came from, the file it lives in, how it was processed, and what the app does with
it. Each number's source is listed in [shared/SOURCES.md](../shared/SOURCES.md); licences are in
[CREDITS.md](../CREDITS.md).

**Nothing here trains a model.** Sentinel's assessment is rules and statistics over each person's own readings. The
datasets supply the **limits** those rules use, the **evidence** shown to the crew, and the **context** for the 3D
views and the demo.

**In the app:** tap the **i** next to any reading in the health log. Under how to measure it and why it matters,
**Data used** links to the reading's reference ranges and to the NASA documents (MRIDs) it is grounded in. The PDFs
are served by Sentinel itself (`/dataset/...`), so the links work offline on the tablet. The same data is available
from `GET /api/dataset/sources?paths=vitals.heart_rate,manual.temp_c`.

## At a glance

| # | Dataset | Owner | Type | In the repo | Used for |
| --- | --- | --- | --- | --- | --- |
| 1 | JSC 28913 Medical Requirements Integration Documents (68) | NASA | Documents (PDF) | `dataset/`, `shared/nasa_mrid.json` | What to track, how to measure, why it matters, some limits, the Evidence screen |
| 2 | NASA-STD-3001 and OCHMO technical briefs | NASA | Standard | `shared/thresholds.json` | Cabin CO2 and oxygen limits, radiation career and event limits |
| 3 | GOES proton flux and NOAA space weather scales | NOAA SWPC | Live feed + snapshot | `brain/mission/radiation.py`, `shared/radiation_snapshot.json`, `shared/swpc_*.json` | Radiation Watch: live storm level and shelter alert |
| 4 | DONKI solar energetic particle events | NASA CCMC | API extract | `shared/donki_sep_events.json` | The solar-storm demo replays a real event's onset |
| 5 | Mission dose rates | NASA JPL, SwRI, NTRS | Published figures | `shared/thresholds.json` | The dose passport by environment |
| 6 | NASA Life Sciences Portal catalogue (691 datasets) | NASA | Catalogue | `shared/nlsp_catalog.json` | Context and citations per indicator group |
| 7 | NASA crew-monitoring research | NASA (NTRS), PMC | Papers | `shared/facts.json`, `design/NASA_MONITORING_RESEARCH.md` | Reaction test, weekly measures, sleep link, eye check, the pitch |
| 8 | ISS Medical Kit Checklist | NASA | Document | `shared/med_kit.json` | The onboard kit list (illustrative) |
| 9 | Clinical reference ranges | MedlinePlus, CDC, AHA, ADA, OSHA | Published ranges | `shared/thresholds.json` | Normal ranges for vitals, marked *clinical reference* |
| 10 | Wellbeing research | Peer-reviewed studies | Papers | `shared/wellbeing_science.json` | Why each wellbeing activity is offered |
| 11 | BodyParts3D | DBCLS (Japan) | 3D anatomy | `app/assets/body3d/anatomy_*.glb` | The X-ray and organ views (18 body systems) |
| 12 | MakeHuman / MPFB bodies | MakeHuman | 3D models | `app/assets/body3d/human*.glb` | The male and female bodies |
| 13 | Planet textures | Solar System Scope (from NASA imagery) | Images | `app/assets/space/` | The intro, space scene and race |
| 14 | Mock crew and profiles | COSMOcare (invented) | Demo data | `shared/mock_data.json`, `shared/mock_profiles.json` | Six crew members with 14 days of readings, for the demo (SIM) |

## 1. NASA JSC 28913 Medical Requirements Integration Documents (MRIDs)

**What:** the documents that set how NASA crews (ISS long-duration, `L`; Shuttle short-duration, `S`; Medical
Operations Volume B, `MEDB`) are examined and monitored: purpose, measurements, equipment, and pre-, in- and post-flight
schedules.

**In the repo:** 68 unique documents (94 PDF files including duplicates) in `dataset/`, catalogued in
`dataset/_catalog.json` and `dataset/README.md`.

**Processing:** `tools/mrid_extract.py` parses every PDF into `shared/nasa_mrid.json`. For each document it records the
id, title, purpose, measured parameters, deliverables, flight duration, crew, the pre-, in- and post-flight
activities, and every numeric statement. The fields use each document's own wording.

**How Sentinel uses them:**

| Use | Example | Where |
| --- | --- | --- |
| **What is tracked** | Each tracked indicator is grounded in at least one MRID; `GET /api/dataset/verify` checks this | `brain/rules/indicators.py` |
| **How to measure, why it matters** | The text on every body zone paraphrases the MRIDs (the heart zone cites MEDB 1.6 Resting ECG and MEDB 1.7 Ambulatory ECG) | `shared/facts.json` → body screen |
| **Limits** | 85 dBA hazardous noise (MR084L, MEDB 1.8); biodosimetry above 100 mSv (MEDB 3.2); 90% of predicted maximum heart rate in a treadmill test (MR006L); CO above 50 ppm (MR008L); CO2 against the 7-day limit (MR039L) | `shared/thresholds.json` |
| **The eye check** | Cites MEDB 1.10 and MR014S (eye examinations) | `brain/clinical/eyes.py` |
| **Evidence in answers** | When a crew member asks how NASA monitors something, the brain is given the matching MRIDs and names one | `brain/rules/mrid.py` → `brain/ai/llm.py` |
| **Evidence screen and API** | Browse all 68 | Evidence screen; `GET /api/dataset/mrid`, `/api/dataset/mrid/{id}` |

The full list, with what each document is used for, is the last table in
[shared/SOURCES.md](../shared/SOURCES.md#nasa-jsc-28913-mrids-all-68-documents) (and the appendix of the team briefing PDF).

## 2. NASA-STD-3001 and OCHMO technical briefs

**What:** NASA's Space Flight Human-System Standard, and the Office of the Chief Health and Medical Officer's technical
briefs that explain it: TB-003 (habitable atmosphere), TB-004 (carbon dioxide), TB-020 (radiation protection).

**How Sentinel uses them:** as limits in `shared/thresholds.json`, each with `kind: "nasa"` and its source:

| Limit | Value | Source |
| --- | --- | --- |
| Cabin CO2 alert | 3,947 ppm (3 mmHg, 1-hour average, at 760 mmHg cabin pressure) | V2 6004, OCHMO-TB-004 |
| Cabin CO2 watch | 3,289 ppm (2.5 mmHg, 7-day; keeps headache risk under 1%) | OCHMO-TB-004 |
| Minimum inspired oxygen | 17.1% (122 mmHg) | V2 6003, OCHMO-TB-003 |
| Career radiation limit | 600 mSv | V1 4030, OCHMO-TB-020 |
| One solar particle event | 250 mSv | OCHMO-TB-020 |

The cabin alarm itself fires at 19.5% oxygen, the OSHA definition of oxygen-deficient air, marked
`clinical_reference`.

## 3. NOAA space weather (live)

**What:** the Space Weather Prediction Center's live feeds:

- `integral-protons-1-day.json`: GOES satellite proton flux at energies of 10 MeV and above, every 5 minutes.
- `noaa-scales.json`: the official solar radiation storm scale, S1 (10 pfu) to S5 (100,000 pfu).

**How Sentinel uses it:** `brain/mission/radiation.py` reads both feeds and turns the flux into a storm level, a shelter
alert at S2 (a demo placeholder level) and dose estimates on the Radiation Watch screen, labelled LIVE · NOAA.
Offline, it uses the last reading (`data/spaceweather_cache.json`) or the saved snapshot
(`shared/radiation_snapshot.json`, `shared/swpc_protons_1day.json`, `shared/swpc_noaa_scales.json`), labelled
SNAPSHOT.

## 4. NASA DONKI solar energetic particle events

**What:** NASA's Space Weather Database Of Notifications, Knowledge, Information. It lists solar flares, coronal mass
ejections and solar energetic particle events with their onset times.

**In the repo:** `shared/donki_sep_events.json`, two 60-day windows (May–June and September–October 2024). DONKI
refuses ranges over 60 days.

**How Sentinel uses it:** the `solar_storm` demo scenario (`brain/demo/scenarios.py`) replays the real onset of the
**10 May 2024** GOES >10 MeV event. DONKI gives onset times, not peak flux, so the flux curve is scripted, and the
screen says so: "SIM · replay of the 2024-05-10 event (NASA DONKI); flux curve scripted".

## 5. Mission dose rates

| Environment | Dose rate | Source |
| --- | --- | --- |
| Mars cruise | 1.8 mSv/day | NASA JPL, Curiosity RAD (2013) |
| Mars surface | 0.67 mSv/day | SwRI, Hassler et al. 2014 (NTRS 20180007641) |
| ISS | 0.2–0.5 mSv/day (0.35 used) | NTRS 20250006168 |
| Lunar surface | 1.37 mSv/day | Chang'e-4 (Zhang et al. 2020); not NASA, marked demo placeholder |

**How Sentinel uses them:** the **dose passport** shows how fast each environment uses up the 600 mSv career limit.

## 6. NASA Life Sciences Portal catalogue

**What:** the index of NASA's Life Sciences Data Archive. Of 2,593 datasets, `tools/nlsp_fetch.py` kept the **691**
that are human studies, available online, and match a Sentinel indicator group (sleep, cardiovascular, cognitive, mood,
vision, musculoskeletal, nutrition, radiation, respiratory, activity, …). Fetched 15 November 2026.

**How Sentinel uses it:** context and citations for ranges and protocols, grouped by indicator. Only the catalogue was
fetched, not the data files, and it is read-only. It is not training data.

## 7. NASA research on how crews are monitored

| Source | Finding | Sentinel feature |
| --- | --- | --- |
| EIMO Concept of Operations (NTRS 20240001402) | On Mars transit there is no evacuation; care must move on board | The problem Sentinel is built for |
| Reaction Self Test (NTRS 20090029851) | A 3-minute reaction test flags fatigue on the ISS | Reaction test: mean, median, lapses over 500 ms, false starts |
| Sleep and performance in 24 astronauts (PMC8919197) | Under 6 hours of sleep, reactions slow | The reaction test is linked to the sleep log |
| Spaceflight Standard Measures (NTRS 20180002943) | A core set of measures for every ISS crew member | Weekly measures: sit-to-stand, tandem walk |
| SANS clinical update (NTRS 20220000516) | About 69% of long-duration astronauts show early signs of eye changes | The daily eye check |
| CSA Astroskin / Bio-Monitor | A smart shirt measuring heart, breathing, SpO2, temperature on the ISS | The design basis of the Sentinel Skin wearable (DESIGNED) |

Quoted or closely paraphrased in `shared/facts.json`, with notes in `design/NASA_MONITORING_RESEARCH.md`.

## 8. NASA ISS Medical Kit Checklist

**What:** NASA's published checklist of the ISS medical kit (2015 release).

**How Sentinel uses it:** `shared/med_kit.json` lists kit items in its categories. When a symptom is logged,
`brain/clinical/medicine.py` suggests only an item that is on the list, filtered by the crew member's allergies, always
with "consult mission medical protocol before use". The kit in the app is **illustrative** (SIM), not a real manifest.

## 9. Clinical reference ranges (not NASA)

MedlinePlus (pulse 60–100, breathing 12–18, temperature 36.5–37.3 °C, SpO2 95–100%), CDC (fever at 38 °C, 7+ hours of
sleep), AHA (blood pressure categories), ADA (glucose), OSHA (19.5% oxygen). Stored in `shared/thresholds.json` with
`kind: "clinical_reference"`.

The thresholds file holds **16 NASA**, **14 clinical reference** and **24 demo placeholder** limits. Every drift
percentage (how far from your normal counts as a change) is a demo placeholder, marked as one.

## 10. Wellbeing research

`shared/wellbeing_science.json`: for each wellbeing activity (Orb Calm breathing, the space race, the greenhouse, …),
what the research found (paraphrased conservatively), how the activity uses that mechanism, and the source with its DOI.
These studies were done on Earth; the file says so.

## 11–13. 3D anatomy, bodies and planets

| Dataset | Processing | Used for |
| --- | --- | --- |
| **BodyParts3D** (DBCLS, CC BY 4.0): bones, organs, vessels of a reference adult | `tools/anatomy/build_anatomy.py` (Blender) groups parts into 18 systems, reduces detail for the tablet, fits them inside each body, and writes Draco-compressed glTF. The dataset has no lung tissue, so the lungs are generated to fit the ribcage | X-ray, organ views, pointing at the changed system |
| **MakeHuman / MPFB** (CC0) | Exported from Blender | The male and female bodies |
| **Solar System Scope** textures (CC BY 4.0, from NASA imagery) | Resized; relief maps for Mars and the Moon derived in the project | The intro, the space scene, the race |

The X-ray is always a **reference anatomy**, never the crew member's scan, and the app says so.

## 14. Mock crew and profiles (invented)

`shared/mock_data.json` holds six invented crew members with 14 days of readings. `shared/mock_profiles.json` holds
their preloaded profiles. They are **not real people's health data**. They exist so every screen has something to show.
The app labels them SIM.

## Honesty rules for data

- **Every limit has a kind and a source.** If a number cannot be sourced, it is marked `demo_placeholder`.
- **Figures that could not be verified are not used.** The often-quoted "81% of astronauts" eye figure was not found on
  any NASA page, so the app uses NASA's 69%. The Mars surface rate is 0.67 from the primary release, not the 0.64
  seen in press coverage.
- **Labels follow the data:** LIVE, MANUAL, SIM, SNAPSHOT or DESIGNED, on every screen and in every digest to ground.
