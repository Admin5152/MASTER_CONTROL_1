# Sentinel

An onboard crew-health assistant for long missions, built for the NASA Space Apps Challenge 2026. NASA calls the problem **Earth-Independent Medical Operations**: on a Mars transit there is no evacuation and a message to ground takes minutes each way. A crew member talks to Sentinel; it reads their pulse from the camera, compares every reading with **their own baseline**, shows them the body system that changed on a real anatomy X-ray, explains what it means, guides the next step, and packages findings for the flight surgeon to review later.

Sentinel describes change from baseline. It never diagnoses. Every value on screen carries a badge: **LIVE** (measured or entered now), **SIM** (simulated or prepared on purpose) or **DESIGNED** (a design, not running).

New here? Read this file, then [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Credits and licences: [CREDITS.md](CREDITS.md).

---

## Quickstart (from a clean clone)

Requirements: Windows 10/11 (macOS and Linux work for the server and tests; `run.ps1` is Windows), Python 3.10+ (3.12 used), Chrome or Edge. Node 18+ only for the JS tests.

```powershell
git clone <repo> sentinel; cd sentinel
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-voice.txt
copy .env.example .env          # optional: add keys (see "Keys")
powershell -ExecutionPolicy Bypass -File run.ps1 -Http
```

Open **http://127.0.0.1:8000/app/** (plain HTTP on localhost keeps the camera and microphone working). Tap anywhere to skip the intro, then **Begin**.

For the **Samsung tablet** (or any second device) run `run.ps1` without `-Http`: it serves HTTPS on `0.0.0.0:8443`, regenerates the self-signed certificate for the laptop's LAN address and prints the tablet URL.

1. Laptop and tablet on the same network (a phone hotspot beats venue WiFi, which often blocks device-to-device traffic).
2. First run: allow Python through Windows Firewall on **Private networks**.
3. On the tablet open the printed `https://<laptop-ip>:8443/app/` in **Chrome** (not Samsung Internet), tap **Advanced → Proceed**, tap **Begin**, allow camera and microphone.

`run.ps1` options: `-Http` (laptop only, port 8000), `-NoBrowser`, `-SkipSpeaker` (skip the optional speaker-ID install).

### Models (git-ignored, fetch once)

Both are optional: without them the browser's own voice and recognition are the fallbacks.

```powershell
# Kokoro text-to-speech (Apache 2.0), the offline fallback voice
mkdir models\tts
curl.exe -L -o models\tts\kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl.exe -L -o models\tts\voices-v1.0.bin  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
# Whisper base.en for offline speech recognition (CTranslate2 build, MIT)
.venv\Scripts\python -c "from faster_whisper import download_model; download_model('base.en', output_dir='models/whisper/base.en')"
```

### Keys

Copy `.env.example` to `.env`. Every variable is documented there and all are optional.

- `LLM_API_KEY` (Groq): the brain (`openai/gpt-oss-120b`, `reasoning_effort: low`) and Groq Whisper speech recognition. Without it, the rules bank answers health and mission questions and general questions get "I need a connection to answer that".
- `ELEVENLABS_API_KEY`: the primary voice (flash model, premade voices only; River by default). Characters spent are counted in `data/tts_usage.json` and capped by `ELEVENLABS_CHAR_BUDGET` (default 9000). Every line is cached on disk, so the demo lines cost nothing after the first time. `SENTINEL_TTS=kokoro` never calls ElevenLabs (rehearsals, tests).

Never commit `.env`. It is git-ignored, and a scan of the full history on 14 Nov found no keys (see "Repository hygiene").

---

## What it does

| Area | What you see | Label | Status |
|---|---|---|---|
| Intro | Camera sweeps over a textured solar system; the planets drift out and Sentinel's orb forms; **Begin** unlocks audio, camera and mic | — | run (Playwright) |
| Sentinel (home) | The glass orb in one continuous space world, greeting above, live caption below, input bar with push-to-talk; a quiet status line and a pill nav (Overview, Body, Vitals, Mission, Radiation, Wellbeing) | — | run |
| Body | The 3D body (male or female per crew member), a left rail of body systems that isolates each one, data chips pinned to the body, the selected system on the right (status chip, metric cards with sourced gradient range bars, care strategy tabs: action plan / onboard kit / lifestyle), insights card | per reading | run |
| X-ray | Real anatomy (BodyParts3D, 18 systems) in two styles: radiograph and coloured anatomy, the checked zone in full colour and the rest dimmed | visualisation; readings keep their badges | run |
| Mesh scan, zone check, pointing | The body's own mesh sweeps down and dissolves into the X-ray; Sentinel turns and zooms to the zone, shows a red dot, leader line and callout, and says one sentence | per reading | run + test |
| Organ view | One organ isolated in a realistic lit material, turn and zoom, its readings with range bars, next step; organ thumbnails rendered in Blender | DESIGNED (reference anatomy) | run |
| Vitals | Heartbeat strip at the measured rate (labelled as an illustration), pressure gauge, every reading with its sparkline, the day's plan schedule | per reading | run |
| Reaction test | 3-minute psychomotor vigilance test like the ISS Reaction Self Test: mean, median, lapses (> 500 ms), false starts, change from baseline, sleep link; 30 s practice mode | LIVE | test (logic) + run (opens); tapping: human |
| Guided exam | A periodic-health-status-style exam, step by step by voice and screen, ending in a one-page ground packet | LIVE entries, SIM where simulated | run (opens) |
| Messages to ground | Store-and-forward queue with the one-way delay: queued, in transit, delivered, awaiting reply | SIM transport | test + run |
| Weekly measures | Reaction test, mood and sleep, timed sit-to-stand and tandem walk, guided exam; "inspired by NASA Spaceflight Standard Measures" | LIVE | run (opens) |
| Space race | Original Blender-made racer vs three ghost racers, three laps past textured planets; Earth shield, Mars boost, Jupiter slingshot + magnet, Saturn ring dash, Moon low gravity; mood before/after logged; keys, drag or tilt | mood LIVE, HR own badge | test (logic) + run (menu → finish → mood saved) |
| Sentinel Skin | The DESIGNED wearable: smart shirt (CSA Astroskin), ultrasound patches (MIT BAUS), eye module for optic nerve sheath diameter (SANS), pocket compute; each with its source; chips on the body. A demo switch feeds simulated module readings into zone checks (ejection fraction with a looping echo view, lung B-lines, optic nerve sheath diameter against its 5.0 mm line, vena cava) | DESIGNED; readings SIM · Sentinel Skin | test (feed) + run (real GPU: eye and heart checks) |
| Voice in | VAD on the mic → `/api/stt` (Groq Whisper; local faster-whisper offline); wake phrase "hey Sentinel" or push-to-talk (tap the orb or mic); browser recognition only as the last fallback | — | test (VAD, STT) ; live mic: human |
| Voice out | Sentence-by-sentence `/api/tts` (ElevenLabs → Kokoro → browser), played through Web Audio so the orb pulses with the real audio | — | test (Kokoro, cache) + live ElevenLabs call; listening: human |
| Brain | Health questions answered only from the state (numeric guard), general questions answered naturally, last 8 turns remembered, streamed sentence by sentence, commands validated | reply tagged LLM or rules | test (mocked) + live Groq run |
| Face scan, pulse | MediaPipe face mesh and pose on the webcam, camera pulse (POS rPPG) with a quality gate | LIVE | logic: test; real face: human |
| Radiation Watch | NOAA GOES live feed, storm level, dose passport, storm response | LIVE · NOAA / SNAPSHOT / SIM | test + run |
| Cabin, Orb Calm, health log, trends, greenhouse, crew, scenarios, alert banner | As in v1, restyled | as labelled | test + run (v1) |
| Themes | Dark (space) is the default; **Clinical light** in Settings, remembered per browser | — | run (screenshots of both) |

Live checks on 14 Nov with the real keys: the brain's first sentence arrived in 0.56–0.92 s; a follow-up ("And how long would a radio message take?") used the memory; Groq Whisper transcribed a Kokoro test phrase exactly in 0.68 s; ElevenLabs returned the first line in 1.07 s and the cached repeat in 11 ms (42 characters spent).

---

## The 90-second demo

| # | Who | Says / does | Screen |
|---|---|---|---|
| 1 | Presenter | Taps **Begin** after the intro | The orb forms; "Hello, I'm Sentinel." |
| 2 | Presenter | "Hey Sentinel, let me see you." (or tap the mic) | Face scan with the mesh; pulse "about N bpm" (LIVE) |
| 3 | Presenter | "Check my heart." | Body turns and zooms, mesh sweep, radiograph, then the heart in colour (ref 11), callout with the change from baseline |
| 4 | Presenter | "How far is Mars?" then "And how long would a message take?" | General answer, then a follow-up that uses memory |
| 5 | Presenter | Opens **Wellbeing → Space race** | One lap, a planet power-up, the finish, mood logged |
| 6 | Presenter | Opens **Guided exam**, then **Send to ground** | The packet queued with the one-way delay (SIM) |
| 7 | Presenter | Opens **Sentinel Skin** | The DESIGNED wearable with its real sources |

No internet, camera or mic? The demo panel (`D`, or the sliders button) runs the scripted scenarios with the offline lines; everything stays badged SIM.

---

## Verification (14 Nov)

| Check | Result |
|---|---|
| `pytest` | **45 passed** (brain, systems, radiation, voice and brain v2, ground link). The local-Whisper test skips itself with a stated reason if the machine is short of memory (it did once on this laptop with many apps open) |
| `node --test tests/js` | **28 passed** (wake phrase, pitch, WAV, rPPG, intents incl. isolate and X-ray styles, validator, scan order, Orb Calm, greenhouse, VAD, race logic, range bars, PVT) |
| Playwright (Edge, software WebGL), 1366×768 | every main screen in both themes (`tests/layout_shots.py both`), the body X-ray, zone check and pointing (`tests/body_shots.py`), the race from menu to saved mood (`tests/race_check.py`); no page errors |
| Real GPU (installed Chrome, Intel Iris Xe, `tests/gpu_check.py`) | 60 fps on home, body, X-ray, vitals, mission and the race; 52 fps during the heart check (mesh sweep + X-ray); no page errors |
| Live keys | brain, Groq Whisper and ElevenLabs as above |
| Secret scan | no Groq (`gsk_`) or ElevenLabs keys anywhere in the git history; `.env`, `certs/`, `models/`, `data/` never committed |

Screenshots: `tests/screenshots/v2/dark/`, `tests/screenshots/v2/light/`, `tests/screenshots/v2/body/`, `tests/screenshots/v2/race/` (git-ignored; regenerate with the scripts above).

### Not verified (needs a person)

- A real face on the webcam (face mesh, pulse accuracy), the real microphone (VAD tuning on a real room, wake phrase, push-to-talk), how the voice sounds and its latency through speakers, the Samsung tablet (layout, touch, tilt in the race, Chrome speech), frame rate on the tablet GPU.
- `tests/browser_check.py`, `tests/offline_check.py` and `tests/resource_check.py` are the v1 browser scripts; they were not re-run against the v2 interface.

## Human checklist

1. **Mic and voice:** Begin, allow the mic. Tap the mic, say "how far is Mars?": the orb listens, then answers aloud (ElevenLabs River). Say "hey Sentinel, check my heart". In Settings switch to "Push to talk only" if the room is noisy.
2. **Follow-up:** "and how long would a radio message take?" should continue the topic.
3. **Camera:** Face scan: the cyan face mesh, then "about N bpm" after 10–15 s in good light; cover the camera and the badge returns to SIM.
4. **Body:** tap each system on the rail, open an organ view, run a full scan and a zone check; drag to turn, scroll to zoom.
5. **Reaction test:** run the 30 s practice, then the full 3 minutes; lapses and false starts are counted.
6. **Race:** one race with the keyboard; on the tablet try drag and "Use tilt".
7. **Themes:** Settings → Clinical light; check each screen.
8. **Tablet:** connect over HTTPS as above; Begin; camera, mic, race tilt, every control by touch.

---

## Choices made (where the brief left room)

- **Brain model.** `openai/gpt-oss-120b` on Groq with `reasoning_effort: low`; only the final `content` is spoken, Unicode is normalised (U+202F, U+2011) before speech. `llama-3.3-70b-versatile` is no longer available on Groq. The model replies in plain text with an optional final `COMMANDS: [...]` line, which streams cleanly; the v1 JSON format is still accepted.
- **Why not OpenClaw.** OpenClaw is a self-hosted personal agent that runs on a computer, connects to messaging apps and acts on the machine. It still needs an LLM underneath, adds latency and setup, and giving it system access on the demo laptop is a security risk. Sentinel needs a fast conversational model behind a deterministic rules engine, which it has.
- **Health vs general questions** are told apart by a word list; the numeric guard (no number that is not in the state) applies only to health answers, checked sentence by sentence while streaming.
- **Local Whisper runs in its own process** (`brain/whisper_worker.py`): on this laptop the Kokoro (onnxruntime) and Whisper (CTranslate2) models did not fit together in one process, and the venv's PyAV is incompatible with faster-whisper's decoder, so the worker decodes WAV itself.
- **Heart-rate drift is two-sided**: a 20% drop against the 15% line is a change from baseline (watch), never "within your usual range".
- **Anchors, rings, scan spans and camera framings** are derived from each loaded model's geometry, so the 1.60 m female and the 1.89 m male both frame correctly. The six mock crew are a mix (`body_model` in each profile).
- **The X-ray is a visualisation** of one adult male reference specimen (BodyParts3D) fitted to both bodies; the lungs are generated to fit the ribcage because the dataset has no lung tissue. The About panel says so.
- **Store and forward** uses a fixed SIM one-way delay of 12.7 min (inside NASA's 4–24 min Earth–Mars range); packets are stored in `data/ground.json`.
- **The race replaced Aurora Run**; the backend's intervention id `aurora_run` is kept for contract compatibility and opens the race.

## Contract additions

The frozen block is unchanged. Additions used: `display_name`, `identity.source`, `vitals.sources.*`, `manual.*`, `voice.*`, `cognitive.*`, `drift.items[]`, `action.{zone, severity, intervention}`, `engagement.*`, `radiation.*`, `wellbeing.*` (all from v1) and, new in v2, **`body_model`** (`"male" | "female"`). Anything else in a patch returns 422. Session numbers that are not state (race, reaction-test lapses, timed measures) go to the history through `POST /api/log/{id}` with a whitelisted field name.

## Thresholds and sources

All limits are in `shared/thresholds.json`, each with `kind` (`nasa`, `clinical_reference`, `demo_placeholder`) and `source`; see `shared/SOURCES.md`. All drift percentages are `demo_placeholder`. NASA monitoring background for the pitch: `design/NASA_MONITORING_RESEARCH.md`. Sentinel is designed around NASA's problems; it does not claim compliance with NASA-STD-3001, EIMO or CHP-IDA, and it is not a medical device.

## Cuts

- **Measurement rings on the upper arms** (horizontal slices of A-pose arms read badly); chest, waist, thighs and head rings ship.
- **Exploded view** of the wearable; modules are listed and pinned on the body instead.
- **v1 browser scripts** not ported to the v2 interface (see "Not verified").

## Repository hygiene

`.gitignore` covers `.env`, `.venv/`, `certs/`, `models/`, `data/` (state, TTS cache, usage, ground queue), `voiceprints/`, caches and screenshots. The largest tracked files are the vendored MediaPipe WASM (14 MB each); nothing is near 50 MB. A scan of all commits found no `gsk_` keys and no ElevenLabs keys; two long tokens flagged by the pattern were minified vendor code.
