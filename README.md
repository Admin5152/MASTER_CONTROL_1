# Sentinel

An onboard crew-health companion for long missions (NASA Space Apps 2026). A crew member talks to a glowing orb; Sentinel reads their pulse from the camera, compares every reading with **their own baseline**, points at the body system that changed, explains what it means, and offers something to do about it, with no doctor on the line. On Mars a message to Earth takes about 4 to 24 minutes each way.

Sentinel describes change from baseline. It never diagnoses. Every value on screen carries a badge: **LIVE** (measured or entered now), **SIM** (simulated or prepared on purpose) or **DESIGNED** (a design, not running).

---

## Start it

**Laptop (Windows):**

```powershell
cd C:\Users\USER\Desktop\sentinel
powershell -ExecutionPolicy Bypass -File run.ps1
```

`run.ps1` checks the venv (creating it and installing `requirements.txt` on a clean clone), installs the optional speaker-ID stack in the order that works on Windows, regenerates the HTTPS certificate if the LAN address changed, prints the laptop and tablet URLs in large text, opens Chrome at `https://localhost:8443/app/`, and runs one uvicorn process on `0.0.0.0:8443`. Options: `-Http` (plain HTTP on `http://localhost:8000/app/`, laptop only), `-NoBrowser`, `-SkipSpeaker`.

The first time Chrome shows a certificate warning for localhost: click **Advanced → Proceed**.

**Samsung Galaxy Tab (Chrome for Android, not Samsung Internet):**

1. Put the laptop and the tablet on the same network. A phone hotspot is safer than venue WiFi, which often blocks device-to-device traffic.
2. The first time `run.ps1` starts, Windows asks whether Python may use the network: allow **Private networks** (on a hotspot, mark the network as Private).
3. On the tablet open the **TABLET** URL that `run.ps1` prints (for example `https://192.168.100.8:8443/app/`; it is also shown in the demo panel).
4. Chrome warns about the certificate: tap **Advanced → Proceed to … (unsafe)**. (iPad Safari: **Show details → visit this website**.)
5. Tap **Start Sentinel**. Allow the camera and microphone.

**Demo panel:** press `D`, tap the sliders button at the top right, or tap with three fingers. **Hardware slide:** `H` or the wearable button at the top right.

---

## The 90-second demo

Opening hook (every fact from `shared/facts.json`):

> "On Mars, a message to a doctor on Earth takes up to 24 minutes each way. NASA counts radiation, isolation and distance among the five hazards of spaceflight, and about 69% of long-duration astronauts show the earliest signs of eye changes. Sentinel lets the crew check themselves."

| # | Who | Says / does | What the screen does | Badge |
|---|---|---|---|---|
| 1 | Presenter | "Hey Sentinel." | Orb wakes (listening ripples), "Yes, James?" | LIVE voice |
| 2 | Presenter | "Let me see you." | Camera draws face and pose lines; pulse reads "about N bpm" after ~10 s; full scan sweeps the body model and lists each zone in green | pulse LIVE, others SIM |
| 3 | Teammate | speaks (tired, quiet) | Speaker ID names them (if enrolled); talk time and pitch drop vs. their baseline; beam from orb to the eye zone, zoom, callout: "fatigue raised, heart rate 25% above your usual" | voice LIVE, fatigue SIM |
| 4 | Sentinel | "Would you like a short Orb Calm session?" | Orb Calm: red turbulent orb settles to calm blue as heart rate falls; level cleared | HR LIVE (camera) or SIM |
| 5 | Demo panel | Cabin O2 slider down (or scenario "Cabin O2 dip") | Full-width red banner, alarm tone, spoken warning, "flagged to ground, one-way delay 12.7 min (SIM)" | SIM |
| 6 | Presenter | "Show me the hardware." | Exploded wearable diagram | DESIGNED |

No internet, no camera or no microphone? Run **Full demo** from the demo panel: it drives all six steps from the server with the eight offline lines in `app/assets/demo_lines.json` (spoken by the browser, logged as "SIM line"). `POST /api/scenario/full_demo` does the same.

During questions: **Radiation Watch** (tile "Dose (model)" or "NOAA storm level", or "open radiation"), the **solar storm** scenario, **Aurora Run** and the **Greenhouse**.

---

## Feature status

Status key: **test** = verified by an automated test; **run** = verified by running it in headless Chrome (Playwright) or through the API; **human** = needs a person to check; **not built**.

| Feature | Label on screen | Status |
|---|---|---|
| State store, contract validation (422 on unknown fields), history | — | test |
| Baseline + drift engine (notes worded as change from baseline) | LIVE when inputs are LIVE, else SIM | test |
| Absolute thresholds with kind + source carried to the UI | shown with kind and link | test + run |
| Decision layer (8 action types, 5 distinct interventions) | — | test |
| Medicine suggestion (only stocked items, caveat text) | kit list is SIM | test |
| `/api/chat` rules fallback (no key) | reply tagged "rules" | test + run |
| `/api/chat` LLM path (Groq / any OpenAI-compatible) | reply tagged "LLM" | **not verified: no key** (invalid-JSON and command validation tested with a mocked LLM) |
| LLM numbers guard (reply citing a number not in the state falls back to rules) | — | test (mocked) |
| Wake phrase matcher, pitch estimator, talk time, WAV encoder | — | test |
| Speech recognition, speech synthesis, mic capture | — | **human** |
| Typed input + quick-command buttons | — | run |
| rPPG pulse (POS + green fallback, quality gate) | LIVE | pure logic: test; live camera: **human** |
| MediaPipe face + pose landmarks drawn on video | LIVE | models load and run in headless Chrome on the fake camera (no face); real face: **human** |
| No-face / no-camera fallback to SIM heart rate | SIM | run (fake camera) |
| Live-video ring on the zone Sentinel points at | — | **human** (needs a face) |
| Orb (idle / listening / speaking / warning, drive()) | — | run (visual) |
| Body model zones, panels, radiation layer, scan line | per reading | run |
| Director: command bus, pointing sequence, full scan, intents | — | test (intents, validator, scan order) + run |
| Vitals tiles with status word, badge, sparkline; trend charts with baseline + threshold bands | per reading | run |
| Manual health log with microgravity hints and range validation | LIVE | run (opens); save path covered by API tests |
| Routine prompts + mission-clock time skip | — | run (card shows "Due now") |
| Alert banner + Web Audio tone + spoken warning, persists until acknowledged | SIM (cabin) | run |
| Cabin monitor (sliders, scenario) | SIM | test + run |
| Cognitive check (25 s reaction game, first 3 runs set baseline, false starts excluded) | LIVE | logic: test; tapping: **human** |
| Speaker ID (Resemblyzer, 0.75 cut-off) + enrolment in demo panel | LIVE on match, "manual" otherwise | test with two synthetic Windows TTS voices + noise; real voices: **human** |
| Orb Calm (red → amber → blue, 10 s hold, logs to history) | HR badge LIVE or SIM | test + run (simulated HR) |
| Intervention menu: breathing, Aurora Run, Earth window, music, connection nudge | Earth window SIM, connection DESIGNED | run (menu); audio: **human** |
| Hardware slide | DESIGNED | run |
| Radiation Watch: NOAA GOES live feed, S-level, 24 h log chart with bands | LIVE · NOAA GOES / SNAPSHOT | test (parser, fallback) + run (live fetch worked on 13 Nov) |
| Dose passport (profile selector, career limit, margin days) | SIM · modelled | test + run |
| Storm response: banner, checklist, shelter toggle + timer, dose received vs avoided | SIM in scenario | test + run |
| Real storm replay (DONKI 2024-05-10 onset; flux curve scripted) | SIM | run |
| Reaction time beside cumulative dose | SIM / LIVE | run |
| Aurora Run (drag / arrows / tilt, pacer, no-fail, mood before/after) | mood LIVE, HR own badge | logic: test; play and tilt: **human** |
| Greenhouse (grows, wilts, never dies; Veggie sources) | — | logic: test; run (screen) |
| Scenarios: tired_crew, calm_down, cabin_dip, solar_storm, full_demo, reset | SIM | test + run |
| HTTPS with LAN certificate, tablet URL | — | run (`curl -k` on the LAN IP) |
| Tablet layouts 1366×768, 1024×768, 768×1024 | — | run (headless); real tablet: **human** |
| Wake lock, iPad motion permission | — | **human** |

---

## LIVE / SIM / DESIGNED

| On screen | Label | Why |
|---|---|---|
| Camera pulse ("about N bpm") | LIVE | measured from the webcam now (rPPG); falls back to SIM with no face |
| Breathing rate, SpO2 | SIM | webcam SpO2 is not credible and is never shown as measured |
| Fatigue and stress indices | SIM | no sensor; set by scenarios |
| Talk time, pitch | LIVE when computed from the mic, SIM when a scenario set them | |
| Health-log entries (BP, glucose, temperature, sleep, mood, symptoms) | LIVE once you save them; SIM for the prepared mock values | provenance comes from the history source |
| Reaction time | LIVE after a run; SIM for the prepared baseline | |
| Cabin O2 / CO2 | SIM always | there is no cabin sensor |
| Dose passport | SIM · modelled from measured rates | rate × days + storm dose, never a dosimeter |
| NOAA storm level and flux chart | LIVE · NOAA GOES, or SNAPSHOT with its data time, or SIM during the storm scenario | |
| Identity | LIVE "voice NN%" on a voice match; "manual" otherwise | |
| Medicine kit list | SIM | illustrative list |
| Ground-link delay (12.7 min) | SIM | a value inside NASA's 4-24 min range |
| Hardware slide, exercise log, crew messaging, onboard dosimeter | DESIGNED | |

A scenario or the demo panel can never produce LIVE: scenario patches carry `source: "sim"`, the heart-rate override sets `vitals.sources.heart_rate: "sim"`, and the camera stops writing while a scenario runs or the override is on.

---

## Architecture

```
run.ps1            starts uvicorn over HTTPS (or -Http), regenerates the cert, prints the tablet URL
server.py          FastAPI: /app (static), /shared (data files), /api/*
brain/             contract.py (template + validation), store.py (state, history, persistence),
                   thresholds.py, drift.py, decision.py, medicine.py, radiation.py, llm.py
systems/           speaker.py (Resemblyzer), scenarios.py (scripted demo, cabin dip, storm replay)
shared/            contract.json, mock_data.json, thresholds.json, med_kit.json, facts.json, SOURCES.md,
                   swpc_*.json (NOAA snapshot), donki_sep_events.json
app/               index.html, css/tokens.css + app.css, js/{core,interface,voice,vision,systems,experience}
                   vendor/ (MediaPipe bundle + wasm + models, Chart.js, GSAP), assets/ (body.svg, demo_lines.json)
tests/             pytest (brain, systems, radiation), node --test (tests/js), browser_check.py, resource_check.py
tools/make_cert.py self-signed certificate for localhost, 127.0.0.1 and every LAN IPv4 address
```

API: `GET /api/crew`, `GET /api/state/{id}`, `POST /api/state/{id}/patch`, `GET /api/history/{id}?field=`, `POST /api/chat`, `POST /api/identify`, `POST /api/enrol/{id}`, `POST /api/cabin`, `POST /api/scenario/{name}?speed=&crew_id=`, `GET /api/spaceweather`, `GET /api/health`. Added (see choices below): `GET /api/assessment/{id}`, `GET /api/aux/{id}`, `POST /api/log/{id}`, `GET /api/scenario`, `GET|POST /api/clock`.

The browser polls `GET /api/state/{id}` and `GET /api/aux/{id}` every 500 ms. No WebSockets.

## Contract additions

The frozen block is unchanged. These are the additions this build uses, exactly as listed in the spec (no others):

- `display_name`
- `identity.source` (`voice | manual`)
- `vitals.sources.{heart_rate, breathing_rate, spo2}` (`camera | sim | sensor`; `manual` also accepted)
- `manual.{bp_systolic, bp_diastolic, glucose_mgdl, temp_c, sleep_hours, mood, symptoms[], updated}`
- `voice.{talk_time, pitch}`
- `cognitive.{reaction_ms, baseline_ms, updated}`
- `drift.items[] {metric, delta_pct, zone, severity}`
- `action.{zone, severity, intervention}`
- `engagement.{streak_days, checkins_today, calm_levels_cleared, greenhouse_stage}`
- `radiation.{mission_profile, mission_day, dose_rate_msv_day, cumulative_msv, career_limit_msv, storm_level, sheltered, source}`
- `wellbeing.{mood_before, mood_after, last_game, updated}`

Anything else in a patch returns **422**. Things that are not contract fields live outside the state object: threshold results with kind and source (`/api/assessment`), Orb Calm and Aurora Run session numbers (history fields `session.*` via `/api/log`), the storm dose received/avoided, and the scenario status.

## Thresholds and sources

All limits are in `shared/thresholds.json`, each with `kind` and `source`; how each was checked is in `shared/SOURCES.md`. Highlights:

- CO2 alert above **3,947 ppm** = NASA-STD-3001 [V2 6004] 3 mmHg one-hour average at 760 mmHg (3 / 760 × 10⁶). Watch above 3,289 ppm (2.5 mmHg, headache risk < 1%).
- O2 alarm below **19.5%** (OSHA oxygen-deficient atmosphere, `clinical_reference`, not NASA); NASA's absolute hypoxia floor is PIO2 122 mmHg = **17.1%** at 14.7 psia.
- Career limit **600 mSv** [V1 4030]; SPE limit 250 mSv per event; shelter factor 50% for SPE dose (OCHMO radiation brief).
- Dose rates: ISS 0.35 mSv/day (midpoint of NASA's 0.2–0.5), Mars transit 1.8, Mars surface **0.67** (the spec's 0.64 was only found in secondary press, so the primary SwRI figure is used), lunar 1.37 (`demo_placeholder`, Chang'e-4, not NASA).
- Eye statistic: **about 69% of long-duration astronauts show the earliest indications of SANS** (NASA NTRS 20220000516). The team's **81% could not be confirmed** on a nasa.gov or NTRS page and is not used.
- Vital-sign ranges are `clinical_reference` (MedlinePlus, CDC, AHA, ADA), never labelled NASA.

**Every `demo_placeholder`:** all drift percentages (HR 15%, talk time 25%, pitch 10%, reaction 15%, systolic 12%, glucose 20%, temperature 2%, sleep 20%, mood 30%; alert at 2×); heart-rate alert above 130 and low watch below 50; SpO2 alert below 90; temperature low watch below 36.0; mood watch below 3; fatigue watch 0.5 / alert 0.7; stress watch 0.6; S2 as the shelter-alert level; storm extra dose per hour by S level; lunar dose rate; speaker-ID similarity 0.75; rPPG quality 0.35. Decision-layer cut-offs in `brain/decision.py` (stress 0.6, fatigue 0.6, poor sleep < 6 h, mood ≤ 2, HR ≥ 15% above baseline) are demo settings too.

## Choices made where the spec was silent

- **`action` is owned by the rules engine.** A patch may include `action`, but it is recomputed on every patch, so the "patch `action.zone: eyes`" test is driven through the real pipeline by raising `state.fatigue` (the eye zone) and checking that `zone-eyes` gets `is-target` and `is-alert`.
- **Zones.** fatigue → eyes; talk time, pitch, reaction, sleep, mood → head; HR, BP, stress → heart; breathing, SpO2 → lungs; glucose → gut; temperature and radiation → whole body. Bones has no sensor in this build (exercise log is DESIGNED).
- **Five interventions:** stress or HR ≥ 15% above baseline → breathing (Orb Calm); mood ≤ 2 → connection; fatigue ≥ 0.6 → Earth window; sleep < 6 h → music; emotion "bored" → Aurora Run.
- **Mock data:** six crew (`james`, `amara`, `kenji`, `sofia`, `lukas`, `priya`). Rename people by editing `display_name` in `shared/mock_data.json` only. The mock crew have an established reaction baseline. Fourteen days of SIM history are seeded at start so charts have context; seeded points are drawn hollow and badged SIM.
- **Provenance:** a manual or voice value shows LIVE only when its latest history point came from the user/microphone/camera.
- **Mission clock:** day 120 of a Mars transit, starting 08:00; the demo panel adds 3 h or 1 day. Routine completion per mission day is kept in the browser's localStorage (a convenience; the greenhouse stage and streak themselves are in the state).
- **Storm dose** accrues 60× faster during the scripted storm (1 s = 1 mission minute) so the passport moves visibly; real live-feed storms accrue in real time.
- **Ground-link delay** shown in the banner is a fixed SIM 12.7 min one-way, inside NASA's 4–24 min range.
- **rPPG quality**: share of in-band power within ±0.15 Hz of the peak, cut to 40% when the two halves of the window disagree on the peak. On 199 synthetic pure-noise windows this passed the 0.35 gate 3 times (1.5%); a median over the last five estimates further smooths the display.
- **DONKI** gives event times, not flux, so `solar_storm` replays the real onset of the 2024-05-10 GOES >10 MeV SEP event with a scripted S3 flux curve, and says so in its label.
- **Design:** "glass-cockpit display meets bedside monitor": deep slate-blue base, cyan line art, amber/red only for status, Bahnschrift (DIN, ships with Windows; falls back to Roboto on Android) so no font is fetched at runtime, corner-bracket panel frames instead of rounded cards, and the orb as the one bold element. Tokens are in `app/css/tokens.css`.
- **Build order:** phases 2–9 were built together and committed in one commit, then verified as a whole; Phase 0, Phase 1 and Phase 10 have their own commits.

## Cuts taken

- No cut lines from section 7 were needed for features. What is simpler than it could be: the Earth window is a CSS illustration; crew messaging only notes the message (DESIGNED, nothing is sent); the exercise log is DESIGNED; the ScriptProcessorNode is used for mic capture (deprecated, prints a console warning, works in Chrome and Android Chrome).
- The LLM path is built but untested against a real provider (no key).

## LLM key

Copy `.env.example` to `.env` and set `LLM_API_KEY` (Groq: https://console.groq.com/keys). Restart `run.ps1`. `/api/health` then reports `"llm": true` and replies are tagged "LLM". Any OpenAI-compatible endpoint works: change `LLM_BASE_URL` and `LLM_MODEL`. With no key, a 429, an error, a 6 s timeout, or a reply that cites a number not in the state, the rules bank answers ("rules").

## Enrolling voices

Open the demo panel → **Voice enrolment** → tap a name, and that person reads aloud for 10 seconds (any text). Voiceprints are stored in `voiceprints/` (git-ignored). After enrolment, saying "Hey Sentinel …" identifies the speaker (cosine similarity ≥ 0.75), switches to them, greets them by name, and shows "voice NN%" (LIVE). Below 0.75 the current person stays selected. If Resemblyzer is missing, the buttons are disabled and the crew selector is used.

## Tests

```powershell
.venv\Scripts\python -m pytest              # brain, systems, radiation, scenarios
node --test tests/js                          # pure JS: wake, pitch, WAV, rPPG, intents, validator, Orb Calm, Aurora, greenhouse
.venv\Scripts\python tests\browser_check.py https://localhost:8443    # Playwright, 3 viewports, needs the server running
.venv\Scripts\python tests\resource_check.py https://localhost:8443   # every requested file returns 200, no external hosts
```

### Results (13 Nov 2026, this laptop)

| Check | Result |
|---|---|
| `pytest` | **27 passed, 1 skipped**. Skipped: `test_with_key_reply_contains_a_state_number` (no `.env`, no LLM key). |
| `node --test tests/js` | **20 passed, 0 failed** (pitch 220 Hz ±5, wake table 10 positive / 10 negative, rPPG 72 ±3 bpm on 1.2 Hz with noise and ±6 ms jitter, pure noise gives no number, 26 intent phrases + 7 rejections, validator, scan order, Orb Calm 96→70 red→amber→blue + clear, Aurora path width and +2 mood, greenhouse, reaction median) |
| `run.ps1` from a fresh shell | starts uvicorn on `0.0.0.0:8443`, prints the URLs; `/api/health` answers on `https://localhost:8443` and on the LAN address `https://192.168.100.8:8443` (`curl -k`); certificate SANs: localhost, 127.0.0.1, 192.168.100.8, 192.168.136.1, 192.168.163.1 |
| `tests/resource_check.py` | 51 URLs requested after Start, 7 under `app/vendor/`, all 200, **no external hosts** |
| `tests/browser_check.py` (headless Chrome via Playwright, fake camera and mic, HTTPS) | **97 passed, 0 failed** at 1366×768, 1024×768 and 768×1024: no horizontal scroll, no overlapping panels, every tile has a value and a badge, touch-sized controls, all six zone panels open, eye zone gets `is-target` + `is-alert` and the pointing sequence zooms, beams, shows the callout and eases back, full scan visits head, eyes, lungs, heart, gut, bones in order with a badge on every line, every screen opens through the Director, trend chart renders, the no-face camera keeps the pulse SIM, typed questions get replies, the demo panel opens by button, every scenario runs, **zero console errors** (one MediaPipe line, "INFO: Created TensorFlow Lite XNNPACK delegate for CPU", is printed through `console.error` by the WASM runtime and is filtered as not an error) |
| `full_demo` via the API | action types for the tired crew member pass through `none → offer_orb_calm → offer_intervention → flag_cabin → offer_intervention` and the script ends at step "done". After Orb Calm the action becomes `offer_intervention` (Earth window), not `none`, because the simulated fatigue index stays raised; breathing lowers heart rate, not fatigue. |
| `tests/offline_check.py` | with `/api/*` blocked the page greys out, says "Brain offline: showing last known values", keeps the last values, and typed questions get a local reply |
| `tests/experience_check.py` | Aurora Run plays (drag + space), mood 2 → 4 stored as +2 in `wellbeing`; cognitive check by tapping stores a median and compares with the baseline; no page errors |
| Absolute URLs in the frontend | none loaded at runtime (only the SVG namespace string) |
| Thresholds | every level in `thresholds.json` has `kind` and `source` (pytest checks it) |

Screenshots of every state are in `tests/screenshots/` (git-ignored; regenerate with the browser check).

## Human checklist

Do these on the laptop in Chrome, then on the Samsung tablet.

1. **Microphone + wake phrase:** tap Start, allow the mic. Say "Hey Sentinel". Expect a chime, "Yes, James?", the orb rippling with your voice. Then "Hey Sentinel, how am I doing?" → a spoken reply tagged "rules" (or "LLM" with a key) in the transcript.
2. **Speech intents:** "Hey Sentinel, show me my heart" (beam + zoom to heart), "…run a full scan", "…open radiation", "…show my heart rate trend", "…go back", "…show me the hardware", "…stop".
3. **Voice features:** after a few commands, open the Voice tile chart: new points should be solid (LIVE). Speak quietly and briefly: talk time falls.
4. **Camera + pulse:** sit facing a window or lamp, still, face filling a third of the frame. Expect face and pose lines within seconds, "reading…" then "about N bpm" after 10–15 s, the camera badge turning LIVE, and the Heart rate tile badge LIVE. Compare with a finger on your wrist for 30 s; expect it within about ±10 bpm in good light (not a medical device). Cover the camera: within ~5 s the badge returns to SIM.
5. **Live-video ring:** with your face in view, raise fatigue (demo panel → Tired crew): the eye zone is pointed at and a red ring with "eyes" appears on your face.
6. **Speaker ID:** enrol two people in the demo panel (10 s each), then have each say "Hey Sentinel, how am I doing?". Expect the crew name to switch and "Hello <name>". A third, unenrolled person should not switch it.
7. **Orb Calm with the camera:** start Orb Calm and breathe slowly with the pacer; the HR badge should be LIVE and the orb should move toward blue as your pulse falls (it may not fall far enough to clear in a short test).
8. **Sound:** banner alarm, scan ticks, Orb Calm chime, ambient music; the mute button silences cues.
9. **Tablet:** connect (hotspot), accept the certificate, tap Start, allow camera and mic. Check: layout in landscape and portrait; the camera shows your face (front camera, not black); speech recognition in Chrome for Android, or the quick buttons; tilt in Aurora Run (tap "Use tilt"); the screen does not sleep during the demo (wake lock); three-finger tap opens the demo panel; every control works by touch.
10. **Offline:** turn WiFi off on the laptop (keep the hotspot link for the tablet, or test on the laptop alone): the page still loads, chat answers "rules", speech recognition stops (Chrome needs Google's servers) and the quick buttons take over, the radiation tile shows SNAPSHOT with its data time.

## Environment (Phase 0, 13 Nov 2026)

| Step | Result |
|---|---|
| Preflight | Python 3.12.10, git 2.49.0, Node v26.13.0 |
| Repo | `git init`, branch `build`, `.gitignore` covers .env, .venv, __pycache__, data, voiceprints, certs; `video/` is ignored and untouched |
| Python env | `.venv` already present; FastAPI 0.162.5, uvicorn 0.54.0, httpx 0.28.1, numpy 2.5.4, pytest 9.2.0, cryptography 50.0.2 verified by import; `requirements.txt` rewritten to the core pins; `requirements-speaker.txt` holds the speaker stack and its install order. Playwright 1.65.1 and pypdf added to the venv for testing and source checking (not in requirements). |
| Speaker ID | Resemblyzer 0.1.4 on torch 2.15.0+cpu imports and embeds 1 s of synthetic audio to a 256-value vector |
| Vendored JS | MediaPipe `vision_bundle.mjs`, `wasm/` (4 files), `face_landmarker.task`, `pose_landmarker_lite.task`, Chart.js UMD, GSAP: present, non-empty, all served 200 |
| NOAA | `shared/swpc_*.json` snapshot present; live feeds fetched 13 Nov and their structure matches the parser |
| DONKI | `shared/donki_sep_events.json`: 60 SEP events (two 60-day windows in 2024; DONKI rejects longer ranges) |
| LLM | no `.env`: rules fallback is the default |
| Certificate | `tools/make_cert.py` → `certs/` for localhost, 127.0.0.1, 192.168.100.8, 192.168.136.1, 192.168.163.1 |
| Skills | frontend-design, ui-ux-pro-max, design-system, dataviz loaded and followed; webapp-testing's approach (Playwright) used for the browser checks; gsap skills not loaded (GSAP is used only for three tweens) |
