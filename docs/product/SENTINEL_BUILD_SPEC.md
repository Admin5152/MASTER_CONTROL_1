# Sentinel — Build Spec

You are building **Sentinel**, an onboard crew-health companion for the NASA Space Apps Challenge (14–15 Nov 2026). This file is the complete brief. Build the whole thing in this directory, working autonomously. The full scope is budgeted at **about 6 hours**; the cut lines in section 7 bring it down to 5 if you must finish sooner.

If your context is ever summarised, re-read this file before continuing. It is the source of truth.

---

## 1. What you are building and why

Astronauts on long missions (Moon, Mars) cannot wait for a doctor on Earth: a Mars signal takes many minutes each way. Sentinel is a browser tool that lets a crew member assess their own health, understand what the numbers mean, and get guidance, without ground support.

The challenge asks for "a visual tool that helps astronauts assess their own health during space missions and provides guidance on treatments and health improvements." Judges score impact, creativity, validity, use of NASA data, and documentation. Every feature below maps to one of those, so do not trade a listed feature for an unlisted one.

**The finished product is one web app**, served from a laptop and used either on that laptop or on a **tablet on the same network** (touch-first, see section 6.10). A presenter drives it through a 90-second demo:

1. Says "Hey Sentinel". A glowing orb wakes and greets them by name.
2. Says "let me see you". The webcam view draws face and pose lines and reads their pulse. Sentinel runs a full scan down the body model and it shows green.
3. A tired teammate speaks. Sentinel names them, notes a change from their own baseline, and points: a beam runs from the orb to the eye zone, which glows red and zooms, with a callout explaining what changed (section 6.11).
4. Sentinel offers the Orb Calm game. As the heart rate falls, the orb settles from turbulent red to calm blue.
5. Cabin oxygen dips. Sentinel warns the crew aloud and flags it to ground.
6. A slide shows the designed wearable hardware.

Beyond the 90 seconds, the app also has a radiation watch driven by real space-weather data (6.8) and a mental-health game (6.9), which the team shows during questions.

**Done means:** `run.ps1` starts the app from a clean clone, it opens and works on a tablet over the local network, every item in section 9 passes or is reported as not passing, and the demo above can be driven end to end with no internet (using the fallbacks in section 8).

---

## 2. Rules that apply to everything

**Honesty labels.** Every reading and feature shown on screen carries a visible badge: `LIVE` (really measured or computed now), `SIM` (driven by prepared or simulated data on purpose), or `DESIGNED` (a diagram, not running). A SIM value must never look LIVE. This is a judging criterion and it protects the team under questioning, so treat a missing or wrong badge as a bug of the same severity as a crash.

**Change from baseline, never diagnosis.** Sentinel says "your heart rate is 18 above your usual" and "this may warrant a check with the flight surgeon". It never says "you have X". Medicine suggestions always carry "consult mission medical protocol before use".

**No invented science.** Every threshold in the app has a `source` (title + URL) and a `kind`: `nasa`, `clinical_reference`, or `demo_placeholder`. If you cannot verify a number from a real source during setup, mark it `demo_placeholder` and show it as such in the UI. Do not present a guessed limit as a NASA limit.

**Deterministic safety, generative voice.** A rules engine decides what is flagged and what action Sentinel takes. The LLM only words the spoken reply from the state it is given. The LLM never decides alerts and never produces numbers that are not in the state.

**Fallback on every external dependency.** Network, LLM key, microphone, camera, and the Python speaker-ID stack can each fail on stage. Each has a defined fallback in section 8. The app must never show a blank screen or an unhandled error because one of them is missing.

**Work autonomously.** Do not stop to ask questions. Where this spec is silent, pick the simplest option that satisfies the acceptance tests and note the choice in `README.md`. The only reason to stop is a missing prerequisite you cannot install (section 4).

**Time discipline.** Section 7 gives a time box per phase and a cut line. When a phase overruns its box, take the fallback and move on. A complete app with two SIM features beats a half app with everything LIVE.

**Verify before you claim.** Run the tests and say what ran. Camera, microphone and speech features cannot be verified by you; list them in the final report as "needs human check" with the exact steps. Never report something as working that you did not see work.

---

## 3. Architecture (fixed, do not redesign)

```
sentinel/
  run.ps1                  starts backend over HTTPS, opens Chrome, prints the tablet URL
  .env.example  .env       LLM settings (never commit .env)
  requirements.txt
  README.md                setup, demo script, LIVE/SIM/DESIGNED table, sources
  shared/
    contract.json          the frozen schema (section 5)
    mock_data.json         6 crew members that satisfy the contract
    thresholds.json        every limit with source + kind
    med_kit.json           onboard kit list + problem -> item mapping
    facts.json             pitch facts with source URLs
  brain/                   Python: state store, baseline+drift, decision layer, medicine
  systems/                 Python: speaker ID (Resemblyzer), cabin sim
  server.py                FastAPI: serves /app static + /api/*
  app/                     frontend, plain ES modules, no build step
    index.html
    vendor/                all third-party JS, wasm and model files, served locally
    js/voice/  js/vision/  js/interface/  js/systems/  js/experience/  js/core/
    assets/
  tests/                   pytest + node --test
```

**The stack:**

| Layer | Choice | Why |
|---|---|---|
| Backend | Python 3.10+, FastAPI, uvicorn | Owns state, drift and decision logic, LLM proxy, speaker ID |
| Brain LLM | Groq `llama-3.3-70b-versatile` through an OpenAI-compatible call (httpx) | Free, fast enough for speech; swappable in `.env` |
| Speaker ID | Resemblyzer (PyTorch, CPU) | Voiceprint matching; optional |
| Frontend | HTML, CSS, vanilla JavaScript ES modules, no build step | Nothing to compile, nothing to break on the day |
| Vision | MediaPipe Tasks Vision (Face + Pose Landmarker, WebAssembly) | Runs in the browser, on laptop and tablet |
| Pulse | Hand-written rPPG signal processing in JS | No dependency |
| Speech | Web Speech API (`SpeechRecognition`, `SpeechSynthesis`) and Web Audio API | Built into the browser |
| Graphics | Canvas 2D (orb, games), inline SVG (body model, hardware slide, greenhouse) | No dependency |
| Motion | GSAP (vendored) for UI transitions only: zoom, panels, banners | Smooth on tablets; the orb and games use their own canvas loops |
| Charts | Chart.js (vendored) | Trend charts |
| Live data | NOAA SWPC JSON feeds, fetched by the backend | Real space-weather for the radiation watch |
| Transport | HTTPS with a self-signed certificate, polling | Camera and mic need a secure context on the tablet |
| Tests | pytest, `node --test` | |

- **Backend** owns state, runs the drift and decision logic, proxies the LLM (so the API key never reaches the browser), and runs speaker ID.
- **Frontend** has no bundler, no framework, no npm install at runtime. This removes a whole class of build failures.
- **Everything vendored.** No CDN links at runtime. Venue WiFi fails; the app must load fully from the laptop.
- **State sync:** the browser polls `GET /api/state/{crew_id}` every 500 ms and sends changes with `POST /api/state/{crew_id}/patch`. Do not use WebSockets.
- **Serving.** One uvicorn process (state is in memory, so there must be only one) bound to `0.0.0.0:8443` over HTTPS. The laptop opens `https://localhost:8443`; the tablet opens `https://<laptop LAN IP>:8443`. Browsers block the camera, microphone and motion sensors on plain `http://` for any address other than localhost, which is why the tablet needs HTTPS. `run.ps1 -Http` serves plain HTTP on port 8000 for laptop-only use.
- **Browser targets:** current Chrome on Windows; Chrome on Android tablets; Safari on iPad. All frontend URLs are relative, so the same page works from any host.

API surface:

| Route | Purpose |
|---|---|
| `GET /api/crew` | list crew ids and display names |
| `GET /api/state/{id}` | current contract object for one crew member |
| `POST /api/state/{id}/patch` | deep-merge a partial object, re-run drift + decision, return new state |
| `GET /api/history/{id}?field=vitals.heart_rate` | time series for charts |
| `POST /api/chat` | `{crew_id, transcript}` -> `{reply, source: "llm" or "rules"}` |
| `POST /api/identify` | WAV bytes -> `{crew_id, confidence, source}` |
| `POST /api/enrol/{id}` | WAV bytes -> stores that person's voiceprint |
| `POST /api/cabin` | set simulated `oxygen_pct` / `co2_ppm` |
| `POST /api/scenario/{name}` | run a scripted demo scenario (section 6.7) |
| `GET /api/spaceweather` | latest NOAA proton flux and storm level, with `source: "live"` or `"snapshot"` |
| `GET /api/health` | which subsystems are available (llm, speaker_id, spaceweather) and the tablet URL |

---

## 4. Phase 0 — setup and downloads (do this first, 25 min)

Run every step. Record the result of each in `README.md` under "Environment".

**Already prepared before the event. Verify each exists and is non-empty, and do not re-download or regenerate what is there:**

- `.venv/` with the backend packages and `requirements.txt` (check whether `resemblyzer` imports; if it does, step 4 is done).
- `app/vendor/mediapipe/vision_bundle.mjs`, `app/vendor/mediapipe/wasm/`, and `app/vendor/mediapipe/models/face_landmarker.task` and `pose_landmarker_lite.task`. Read the package's `vision.d.ts` on npm if you need the API for the vendored version.
- `app/vendor/chartjs/chart.umd.js` and `app/vendor/gsap/gsap.min.js`.
- `shared/swpc_protons_1day.json` and `shared/swpc_noaa_scales.json`: the NOAA offline snapshot. The proton file is a list of `{time_tag, satellite, flux, energy}` rows where `energy` is a string such as `">=10 MeV"`; the scales file is keyed `"0"`, `"1"`… with `S.Scale` holding the current storm level.
- `app/assets/body.svg`: the body model (section 6.4). Use it as it is; do not redraw it.

So steps 3, 4, 5 and the feed download in step 6 reduce to verification.

**Leave the `video/` folder alone.** It holds the team's presentation trailer, a separate project with its own tooling and its own `.gitignore`. Do not edit, move, lint or test anything in it, and do not let its files into the app.

**Speaker ID is installed and tested on this machine** (it produced a 256-value voiceprint). The plain `pip install resemblyzer` fails on Windows because its `webrtcvad` dependency needs a C++ compiler. The working order is: `pip install webrtcvad-wheels`, then `pip install resemblyzer --no-deps`, then `pip install librosa scipy`. pip will warn that `typing` and `webrtcvad` are missing; that warning is harmless. Because of this, `pip install -r requirements.txt` will fail on a fresh clone: have `run.ps1` install in that order, document it in the README, and keep `resemblyzer` out of the plain requirements list (put it in `requirements-speaker.txt` with the instructions).

1. **Preflight.** Check `python --version` (need 3.10+), `git --version`, `node --version` (used only for `node --test`; optional). If Python or git is missing, try `winget install`. If that fails, stop and report exactly what to install. That is the only permitted stop.
2. **Repo.** `git init`, create branch `build`, add a `.gitignore` covering `.env`, `.venv/`, `__pycache__/`, `data/`, `voiceprints/`, `certs/`. Commit at the end of every phase with a plain message. Do not push and do not add a remote.
3. **Python env.** Create `.venv`. Install `fastapi`, `uvicorn[standard]`, `python-multipart`, `httpx`, `python-dotenv`, `numpy`, `pytest`. Pin the versions you got into `requirements.txt`.
4. **Speaker-ID stack (time box 15 min, optional).** In the same venv install CPU-only `torch`, then `webrtcvad-wheels`, then `resemblyzer` (if the plain install tries to compile `webrtcvad`, install `resemblyzer` with `--no-deps` and add `librosa`, `scipy`, `typing` deps by hand). Confirm with a one-line import and by embedding one second of synthetic audio. If it does not work inside the box, skip it: the app runs with the manual crew selector (section 8) and `/api/health` reports `speaker_id: false`.
5. **Vendor frontend libraries** into `app/vendor/` using `npm pack` or direct download, then confirm each file is non-empty:
   - `@mediapipe/tasks-vision` (check the current version with `npm view @mediapipe/tasks-vision version`): the ES bundle and the whole `wasm/` folder.
   - MediaPipe models. Expected URLs, verify each with a HEAD request and search the MediaPipe docs if one 404s:
     - `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
     - `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
   - `chart.js` UMD build (one file), for the trend charts.
   - `gsap` core (one minified file), for UI transitions.
   - Nothing else. The orb, body model and games are hand-written canvas and SVG.
6. **NASA sources.** Fetch and read these, then fill `shared/thresholds.json` and `shared/facts.json` with the values and the exact URL each came from. Save a short `shared/SOURCES.md`.
   - NASA-STD-3001 Vol 2 and the OCHMO technical briefs on carbon dioxide and habitable atmosphere (nasa.gov). Known starting point: requirement V2 6004 limits the one-hour average CO2 partial pressure to 3 mmHg; confirm it and convert to ppm at cabin pressure, showing the conversion. Take the oxygen range from the inspired-oxygen table in the standard or the habitable-atmosphere brief.
   - NASA Human Research Program pages on the five hazards of spaceflight, and on Spaceflight Associated Neuro-ocular Syndrome (SANS).
   - A NASA page on Mars communication delay.
   - **The eye-change statistic needs care.** The team's notes say "~81% of astronauts show eye changes". Public NASA material more often says about 70% of long-duration crew show some sign, and a NASA clinical briefing gives much lower figures for clinically significant cases. Use only a figure you find on a nasa.gov or NTRS page, quote it with its qualifier (who, mission length, what counts), and store the URL. If you cannot confirm 81%, do not use it.
   - For blood pressure, blood glucose, body temperature, SpO2, resting heart rate and sleep, use standard clinical reference ranges from a named body (for example AHA, ADA, WHO, CDC) and mark them `clinical_reference`, not `nasa`.
   - **Radiation.** Confirm each of these on a primary page and store the URL: NASA's career limit of 600 mSv effective dose (NASA-STD-3001 Vol 1 and the OCHMO radiation protection technical brief); the Curiosity RAD measurements of about 1.8 mSv/day in cruise to Mars and about 0.64 mSv/day on the Martian surface (the 2013 and 2014 Science papers, or the SwRI and NASA releases about them); a typical ISS daily dose from a NASA page; and the NOAA solar radiation storm scale (S1 to S5, defined by the flux of protons at or above 10 MeV).
   - **Space weather feed.** Fetch `https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json` and `https://services.swpc.noaa.gov/products/noaa-scales.json`. Read the actual structure of each (do not assume field names) and write the parser against what you see. The saved copies in `shared/swpc_protons_1day.json` and `shared/swpc_noaa_scales.json` are the offline fallback.
   - **Behavioural health.** Find the NASA page or NTRS record on the Veggie plant-care studies as a behavioural health countermeasure (VEG-04), and an HRP page on the isolation and confinement hazard. Store the URLs in `facts.json`; the greenhouse and the game cite them.
7. **LLM config.** Write `.env.example` with the three variables in section 6.1. If `.env` exists with a key, call the provider's `/models` endpoint, confirm the configured model id is listed, and send one test message. If there is no key, continue: the rules fallback is the default and the key can be added later with no code change.
8. **HTTPS certificate.** Install `cryptography` and generate a self-signed certificate into `certs/` (git-ignored) whose subject alternative names include `localhost`, `127.0.0.1` and every current LAN IPv4 address of this machine. `run.ps1` regenerates it when the LAN address changes, starts uvicorn with it, and prints the tablet URL in large text. The same URL is shown in the demo panel.
9. **Design skills.** These are already installed in this Claude Code setup. Load each with the Skill tool at the point noted, and follow it where it does not conflict with this spec (this spec wins on stack: no React, no Tailwind, no build step).
   - `frontend-design` (Anthropic's official skill, installed in this project at `.claude/skills/`): before Phase 2. Follow its two-pass process: write a short design plan, check it against this brief, then build. Its warning about generic looks applies here: a near-black screen with one bright accent is the default "AI dashboard". Sentinel's look should come from its subject, spacecraft displays and medical monitors, and the orb should be the one bold element with everything around it quiet.
   - `webapp-testing` (also official, also in `.claude/skills/`): from Phase 2 onward, for the browser checks in section 9.
   - `ui-ux-pro-max`: before Phase 2. Use it to choose the palette, type pairing, spacing scale and touch-target rules for a dark, high-contrast, glanceable health HUD.
   - `design-system`: before Phase 2. Define the design tokens once as CSS variables (colour, type, spacing, radius, glow, motion durations) in `app/css/tokens.css`; every component uses tokens, never raw values.
   - `gsap-core`, `gsap-timeline`, `gsap-performance`: before building the zoom, panel and alert transitions.
   - `dataviz`: before building the trend charts and vitals tiles.
   If a skill is not listed in your session, carry on without it. Do not download skills or plugins from the internet; unvetted code is a risk and none is needed.

Commit: "Phase 0: environment, vendored assets, sourced thresholds".

---

## 5. The data contract

One JSON object per crew member. The first block is frozen by the team and must not change shape. The second block is the set of additions this build needs for the challenge's manual health indicators; they are listed in `README.md` under "Contract additions" so the team can see them. Do not add any other field.

```json
{
  "crew_id": "james",
  "timestamp": "2026-11-14T10:00:00Z",
  "identity": { "confidence": 0.0 },
  "vitals": { "heart_rate": 0, "breathing_rate": 0, "spo2": 0, "source": "camera | sim | sensor" },
  "state": { "emotion": "neutral", "emotion_confidence": 0.0, "fatigue": 0.0, "stress": 0.0 },
  "baseline": { "heart_rate": 0, "talk_time": 0.0, "pitch": 0.0 },
  "drift": { "flag": false, "note": "" },
  "cabin": { "oxygen_pct": 20.9, "co2_ppm": 400, "alert": false },
  "action": { "type": "none", "detail": "" }
}
```

Additions:

```json
{
  "display_name": "James",
  "identity": { "source": "voice | manual" },
  "vitals": { "sources": { "heart_rate": "camera", "breathing_rate": "sim", "spo2": "sim" } },
  "manual": {
    "bp_systolic": null, "bp_diastolic": null, "glucose_mgdl": null,
    "temp_c": null, "sleep_hours": null, "mood": null, "symptoms": [],
    "updated": null
  },
  "voice": { "talk_time": 0.0, "pitch": 0.0 },
  "cognitive": { "reaction_ms": null, "baseline_ms": null, "updated": null },
  "drift": { "items": [ { "metric": "", "delta_pct": 0.0, "zone": "", "severity": "info | watch | alert" } ] },
  "action": { "zone": "", "severity": "none | info | watch | alert", "intervention": "" },
  "engagement": { "streak_days": 0, "checkins_today": 0, "calm_levels_cleared": 0, "greenhouse_stage": 0 },
  "radiation": {
    "mission_profile": "iss | lunar | mars_transit | mars_surface",
    "mission_day": 0, "dose_rate_msv_day": 0.0, "cumulative_msv": 0.0,
    "career_limit_msv": 600, "storm_level": 0, "sheltered": false,
    "source": "model | live_feed | sim"
  },
  "wellbeing": { "mood_before": null, "mood_after": null, "last_game": "", "updated": null }
}
```

`action.type` is one of: `none`, `gentle_checkin`, `offer_orb_calm`, `offer_intervention`, `suggest_medicine`, `flag_cabin`, `flag_radiation`, `flag_ground`.
`zone` is one of: `head`, `eyes`, `heart`, `lungs`, `gut`, `bones`, `whole_body`, `cabin`.

`shared/mock_data.json` holds six crew members who each satisfy the full contract, with different baselines. Use placeholder names (`james` plus five others) and make the names editable in one place, because the real team will rename them.

---

## 6. Module specifications

Each module has an acceptance test. Build the module, then make its test pass before moving on.

### 6.1 Brain (Python, `brain/`)

**State store.** In memory, loaded from `shared/mock_data.json` at start, persisted to `data/state.json` on change, with an append-only history of every patched numeric field (timestamp, value, source) capped at 2,000 points per field. Patches are deep-merged and validated against the contract; unknown fields are rejected with a 422 so nobody invents private fields.

**Baseline and drift engine.** A pure function: `(baseline, current readings, thresholds) -> drift`. For each metric (heart rate, talk time, pitch, reaction time, and any manual indicator with a history) compute the percent change from that person's own baseline. Flag when the change exceeds the metric's threshold. Notes are worded as change from baseline, for example "Talking 40% less and pitch 15% flatter than James's usual". Each flagged item names the body `zone` it maps to and a `severity`.

**Absolute thresholds.** Separately, compare readings against `thresholds.json` (cabin O2 and CO2, SpO2, heart rate, temperature, blood pressure, glucose, sleep). Every threshold result carries its `kind` and `source` through to the UI.

**Decision layer.** A pure, ordered rules function that sets `action`. Priority, highest first: cabin alert -> `flag_cabin` and `flag_ground`; radiation storm at or above level S2 while not sheltered -> `flag_radiation`; any `alert` severity vital -> `flag_ground` plus the zone; reported symptom with a kit match -> `suggest_medicine`; high stress or heart rate well above baseline -> `offer_orb_calm`; fatigue or low mood or boredom -> `offer_intervention` with one of `breathing`, `aurora_run`, `earth_window`, `music`, `connection`; mild drift -> `gentle_checkin`; otherwise `none`. Different states must yield different interventions.

**Medicine suggestion.** `shared/med_kit.json` holds an illustrative kit list (base it on publicly documented categories of ISS medical kit contents, mark it SIM) and a mapping from symptom to stocked item. The function only ever returns an item that is on the list, with the caveat text. An unmapped symptom returns "no stocked item mapped, consult flight surgeon".

**LLM reply (`/api/chat`).** Any OpenAI-compatible endpoint, set in `.env`:

```
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
LLM_API_KEY=
```

Send a system prompt plus the crew member's current state JSON and the transcript. Persona: calm, concise, warm, never alarmist; at most two short sentences; plain spoken English with no markdown, lists or emoji because the reply is read aloud; cite only numbers present in the state; describe changes from baseline and never diagnose; if `action` is set, say what Sentinel is doing about it. Timeout 6 seconds. On timeout, error, HTTP 429, or no key, return a reply from the rules template bank instead and set `source: "rules"`. The UI shows which one answered.

Acceptance (pytest):
- Feeding "quieter, flatter" voice data raises `drift.flag` with a note that mentions baseline.
- A patch with an unknown field returns 422.
- Cabin oxygen below the threshold yields `flag_cabin` regardless of other state.
- Symptom "headache" returns an item that exists in `med_kit.json`; symptom "xyzzy" returns the no-match text.
- Five distinct crafted states produce five distinct interventions.
- `/api/chat` with no key returns `source: "rules"` and a reply that contains the heart rate from the state.
- With a key present: "How am I doing?" returns a reply containing at least one number from the state (skip this test, and say so, if no key).

### 6.2 Voice (`app/js/voice/`)

- `SpeechRecognition` (continuous, interim results) and `SpeechSynthesis`. Act only on a transcript that starts with the wake phrase; accept common mishearings ("hey sentinel", "a sentinel", "hey centinel", "hey sentinal").
- After the wake phrase, the rest of the utterance is the command. Local intents are handled without the LLM: "let me see you" (open vision), "start orb calm", "how is the cabin", "log my health" (open the manual form), "stop". Anything else goes to `/api/chat`.
- Emit events on a shared bus: `voice:listening`, `voice:transcript`, `voice:speaking-start`, `voice:speaking-end`. Pause recognition while speaking so Sentinel does not hear itself.
- While the user speaks, capture mono PCM with the Web Audio API, compute talk time (seconds of voiced audio in the utterance) and median pitch (autocorrelation, 70–400 Hz), and patch them to `voice`. Encode the same audio as 16 kHz WAV in the browser and post it to `/api/identify`. Encoding WAV in the browser avoids needing ffmpeg on the server.
- A text box is always visible as a typed alternative to speaking, and a small transcript log shows what was heard and what was said.
- Offline pack: eight key demo lines stored as text in `app/assets/demo_lines.json`, spoken through `SpeechSynthesis` when the scripted scenarios run. Label these SIM.

Acceptance: the pitch estimator returns 220 Hz ±5 for a synthetic 220 Hz tone and the wake-phrase matcher passes a table of positive and negative cases (`node --test`). Speaking and hearing need a human check.

### 6.3 Vision (`app/js/vision/`)

- MediaPipe Face Landmarker and Pose Landmarker from `app/vendor/`, running on the webcam, drawn as thin glowing lines over the video. Keep it above 20 fps: run pose every other frame if needed.
- **Pulse (rPPG), LIVE.** Average the red, green and blue channels over a forehead region and both cheeks, located from face landmarks, sampled at the frame rate with real timestamps. Keep a 10–12 second window. Turn the three colour traces into one pulse signal with the POS method (Wang et al., 2017, "Algorithmic Principles of Remote PPG"), which holds up better than the green channel alone when the person moves or the light changes; write it yourself from the published algorithm, and keep green-only as the fallback if POS quality is low. Then detrend, band-pass 0.7–3.0 Hz, take the spectral peak, convert to beats per minute. For reference only, `Rouast-Labs/vitallens.js` and `prouast/heartbeat-js` on GitHub implement these methods; read them if stuck, but do not copy code (heartbeat-js is GPL) and do not add them as dependencies. Smooth over the last few estimates. Compute a signal-quality score from peak prominence; below a threshold show "reading…" instead of a number and do not patch state. Show "about N bpm" and a quality indicator. Do not claim medical accuracy anywhere.
- **Breathing rate and SpO2 are SIM** from the simulator, badged SIM. Webcam SpO2 is not credible and must not be shown as measured.
- Patch `vitals.heart_rate` with `vitals.sources.heart_rate: "camera"` once per second while quality is good.
- **Zoom moment.** When `action.zone` is set, highlight that region's landmarks in red on the video (eyes from face landmarks, chest from shoulder landmarks) and emit `vision:zone`.
- If the camera is denied or absent, show a clear message and switch heart rate to SIM with the SIM badge.

Acceptance: the rPPG estimator, as a pure function fed a synthetic 1.2 Hz signal with noise sampled at 30 fps with jitter, returns 72 bpm ±3; fed pure noise it returns low quality and no number (`node --test`). Live tracking needs a human check.

### 6.4 Interface (`app/js/interface/`, `app/index.html`)

One screen, dark, JARVIS-like: near-black background, cyan accents, amber for watch, red for alert. Readable from the back of a room: large type, high contrast. Colour is never the only signal; pair it with a word or icon.

Layout: orb in the centre; body model on the left; camera view on the right; a vitals strip along the bottom with one tile per indicator; a status line at the top with crew name, identity confidence, mission clock and cabin readout.

- **Orb (canvas, no libraries).** States: `idle` (slow breathing glow), `listening` (ripples scale with microphone volume from an `AnalyserNode`), `speaking` (pulses while TTS is active; drive this from the speaking events with a synthetic envelope, since TTS audio cannot be tapped), `warning` (amber or red by severity). Expose `orb.setState(name)`, `orb.setSeverity(level)`, and `orb.drive({turbulence, hue, rate})` for the Orb Calm game. Respect `prefers-reduced-motion`.
- **Body model (inline SVG).** Use the prepared `app/assets/body.svg`: fetch it and inline it so its classes can be driven. It has six zones as `<g class="zone" id="zone-…" data-zone="…" data-anchor="x,y">`: `head` (brain and cognition), `eyes`, `heart`, `lungs`, `gut` (digestion and nutrition), `bones` (bones and muscles), plus a `whole_body` radiation layer. Set exactly one of `is-ok`, `is-watch`, `is-alert` on each zone from the state. Add `is-target` to show the rotating pointer ring on a zone, `show-radiation` on the root to show the radiation layer, and `is-scanning` on the root to run the scan line. `data-anchor` is the point in SVG coordinates where a pointer line should land. Colours are CSS variables (`--sentinel-ok`, `--sentinel-watch`, `--sentinel-alert`, `--sentinel-line`); map them to the design tokens. `gut` takes glucose and nutrition readings; `bones` takes the exercise log and the bone and muscle loss explanation. Clicking a zone opens a panel with: what this body system does, how spaceflight affects it and which of NASA's five hazards is involved (with source link), the crew member's current readings for that zone with badges, what the thresholds are and where they come from, and what to do next. When `action.zone` is set, that zone glows and the view zooms into it smoothly, then returns.
- **Vitals tiles.** Value, unit, status word (Normal, Watch, Alert), LIVE/SIM badge, and a small sparkline. Clicking a tile opens a Chart.js trend chart for that indicator with the baseline and threshold bands drawn.
- **Manual health log.** A form for blood pressure, blood glucose (mg/dL), body temperature, sleep hours, mood (1–5) and symptoms. Each field has a one-line "how to measure this in microgravity" hint and a "why it matters" line. Validate ranges and reject impossible values. Saving patches `manual` and re-runs the brain. These readings are LIVE (user-entered).
- **Routine prompts.** A small schedule (morning vitals, midday cognitive check, evening mood and sleep log). When an item is due, the orb nudges gently and a card appears. For the demo, a "time skip" control in the demo panel advances the mission clock.
- **Engagement.** Streak counter, today's check-ins, Orb Calm levels cleared. Keep it understated.
- **Alert banner.** Cabin and crew alerts take over the top of the screen with a full-width banner, a tone generated with Web Audio, and the spoken warning. It persists until acknowledged. It must be impossible to miss from across a room.
- **Demo panel.** Hidden drawer toggled with the `D` key: crew selector, cabin O2 and CO2 sliders, heart-rate override, scenario buttons, time skip, reset. Everything the panel drives is badged SIM on the main screen.
- **Legend.** A persistent small key explaining LIVE, SIM and DESIGNED.

Acceptance: with the backend running on mock data and no camera or microphone, the page loads with zero console errors, every tile shows a value and a badge, clicking each body zone opens its panel, and patching `action.zone: "eyes"` turns the eye zone red and zooms. Check this with a headless Chrome run if one is available (`chrome --headless --dump-dom` or similar); if not, list it for human check.

### 6.5 Systems (`systems/`, `app/js/systems/`)

- **Speaker ID.** Resemblyzer embeddings. `/api/enrol/{id}` stores a voiceprint from a 10-second clip into `voiceprints/`. `/api/identify` returns the closest enrolled crew member by cosine similarity and a confidence; below 0.75 similarity return `crew_id: null`. An enrolment screen in the demo panel records each teammate in turn. On a match, set the active crew member and `identity.confidence`, and Sentinel greets them by name. Badge LIVE only when a real voice match happened; a manual selection is badged `manual`.
- **Cabin monitor, SIM.** Oxygen and CO2 driven by the demo panel sliders or a scenario script. Crossing a threshold from `thresholds.json` sets `cabin.alert`, which raises the alert banner and the spoken warning, and logs "flagged to ground" with the simulated one-way delay shown. Always badged SIM: there is no real sensor.
- **Cognitive check.** A 25-second reaction game: targets appear at random intervals, the user clicks or presses space, and the median reaction time is stored. The first three runs set the baseline. Later runs go through the same drift engine; a slow run produces "reaction time down N% vs baseline" mapped to the `head` zone. False starts are counted and excluded.

Acceptance (pytest): with two synthetic voiceprints enrolled, identify returns the right one for each and `null` for noise (skip, and say so, if Resemblyzer is not installed). Dropping oxygen below threshold through `/api/cabin` sets `cabin.alert` and `action.type: "flag_cabin"`. A reaction time 30% slower than baseline raises a drift item on `head`.

### 6.6 Experience (`app/js/experience/`)

- **Orb Calm (the signature feature).** Starts from the current heart rate. The orb is turbulent and red when the heart rate is at or above the starting value, and moves through amber to calm blue as it falls toward a target (baseline, or start minus 10%, whichever is lower). A breathing pacer (4 seconds in, 6 seconds out) guides the user. Holding at or below target for 10 seconds clears the level. Log start heart rate, end heart rate and recovery time to history, and increment `engagement.calm_levels_cleared`. It reads heart rate from state, so it works with the camera (LIVE) or the simulator (SIM) and shows the correct badge either way.
- **Intervention menu.** Five options the brain can choose: breathing (Orb Calm), Aurora Run (the game in 6.9), Earth window (a slow CSS-animated Earth view, no external imagery needed), music (a generated ambient pad with Web Audio), and a connection nudge (a prompt to message a crewmate). The brain's `action.intervention` selects one; the user can also pick.
- **Hardware slide, DESIGNED.** An SVG exploded view of the planned wearable: pulse sensor, SpO2, skin temperature, eye camera, accelerometer, where each sits on the body and how they connect to Sentinel. Dark, glowing, same visual language. A large DESIGNED badge. Opened with the `H` key or the voice command "show me the hardware".
- **Pitch material** in `README.md`: the 90-second demo script with who says what, and an opening hook built only from facts in `shared/facts.json` with their sources.

Acceptance: fed a heart-rate series falling from 96 to 70 over 40 seconds, the Orb Calm logic moves from the red state to the blue state and reports a level clear with a recovery time (`node --test` on the pure logic).

### 6.7 Scenarios (the demo safety net)

`POST /api/scenario/{name}` runs a timed script against the state so the demo can be driven with no camera, microphone or network. All scenario output is badged SIM.

- `tired_crew`: quieter and flatter voice, heart rate up, fatigue up -> drift flag, eye zone alert, Orb Calm offered.
- `calm_down`: heart rate falls over 40 seconds.
- `cabin_dip`: oxygen falls over 15 seconds past the threshold, then recovers on acknowledge.
- `solar_storm`: proton flux climbs to an S3 storm over 20 seconds, then decays.
- `full_demo`: the six demo steps in order with spoken lines from the offline pack.
- `reset`: back to mock data.

### 6.8 Radiation Watch (`brain/mission/radiation.py`, `app/js/systems/radiation.js`)

Radiation is one of NASA's five hazards and the one a crew cannot feel. This module makes it visible and tells the crew what to do.

- **Live space weather, LIVE.** The backend fetches the NOAA GOES proton flux and storm scales every 60 seconds, caches the last good response to disk, and falls back to the saved files in `shared/` when offline. Convert the flux of protons at or above 10 MeV to the NOAA storm level S0 to S5. The tile shows the current level, a 24-hour flux chart on a log axis with the S-level bands drawn, and the badge `LIVE · NOAA GOES` or `SNAPSHOT` with the time of the data. Caption it honestly: this is measured near Earth; on a deep-space mission the same display would be fed by the onboard dosimeter (DESIGNED).
- **Dose passport, modelled.** A mission profile selector (ISS, lunar, Mars transit, Mars surface) sets the daily dose rate from `thresholds.json`. Cumulative dose is the rate times mission days, plus any storm dose. Show it as a bar against the 600 mSv career limit with the remaining margin in days at the current rate. Badge it `SIM · modelled from measured rates` and link the source of each rate. Never show it as a personal dosimeter reading.
- **Storm response.** At S2 or above (live or scenario), raise the alert banner and speak: what is happening, and the action checklist (move to the shelter area, stay until the level falls, log the time). A "sheltered" toggle starts a timer; the passport shows dose received against dose avoided, using a shielding factor that is marked `demo_placeholder` unless you find a sourced one.
- **Real storm replay.** During setup, query NASA's DONKI space-weather database (`https://api.nasa.gov/DONKI/SEP` and `/DONKI/FLR`, dates as `yyyy-MM-dd`, `api_key=DEMO_KEY`, which allows about 30 requests an hour, so make only the few calls you need) for solar energetic particle events over the last few years. Save the response to `shared/donki_sep_events.json`. The `solar_storm` scenario then replays a real dated event, labelled `SIM · replay of the <date> event (NASA DONKI)`, instead of an invented one. If the API is unreachable, fall back to the scripted storm and say so.
- **Body model.** A whole-body radiation layer: clicking it explains the effects NASA tracks (cancer risk, central nervous system and cognitive effects, cardiovascular effects, cataracts) with the HRP source, and why the crew is asked to do the cognitive check.
- **Link to the cognitive check.** The radiation panel plots reaction-time history beside cumulative dose. Caption: "tracked together so a trend is noticed early; this is not a diagnosis".

Acceptance (pytest): a proton flux of 5 maps to S0, 10 to S1, 100 to S2, 1,000 to S3; the parser reads the saved snapshot and returns a level and a timestamp; with the network call mocked to fail, `/api/spaceweather` returns `source: "snapshot"`; Mars transit at day 180 gives a cumulative dose equal to 180 times the stored rate; storm level 2 while not sheltered gives `flag_radiation`, and sheltered does not.

### 6.9 Aurora Run and the Greenhouse (`app/js/experience/`)

Isolation and confinement is another of the five hazards. These two features are the mental-health countermeasures.

- **Aurora Run (the game).** An original, calm, no-fail flight game on canvas. A small craft glides forward through ribbons of aurora. The player steers by tilting the tablet, dragging a finger, or the arrow keys. There are no lives, no score penalty and no game over: touching a ribbon edge only dims the craft's light trail for a moment. A breathing pacer runs along the bottom; the player holds a finger down while breathing in and lifts it while breathing out (space bar on a laptop). Staying in time with the pacer, and a heart rate at or below baseline when one is available, widens the path, brightens the aurora and adds light to the trail. A session lasts two minutes and ends with a quiet summary.
  - **It measures as well as soothes.** Before and after each session the player taps a mood from 1 to 5. Store both in `wellbeing` and in history, along with start and end heart rate. The wellbeing panel charts mood change per session, so the crew and the judges can see whether it helped. Mood entries are LIVE (user-entered); heart rate carries its own badge.
  - Tilt uses `DeviceOrientationEvent`; on iPad call `DeviceOrientationEvent.requestPermission()` from a tap. If tilt is unavailable, touch drag is the default. Keep it at 60 fps on a tablet: one canvas, no per-frame allocation, cap the particle count. Respect `prefers-reduced-motion` by slowing the scene.
- **The Greenhouse (the engagement layer).** A small SVG plant in a hydroponic pod on the main screen. It grows one stage for each day the crew member completes their routine (vitals check, cognitive check, mood and sleep log) and after each completed calm session, and it wilts slightly, never dies, after missed days. This replaces points and badges as the visible reward. The info card cites the NASA Veggie plant-care research from `facts.json` as the reason a plant was chosen.

Acceptance (`node --test` on pure logic): the path-width function is wider for in-time breathing than for out-of-time breathing; a session with mood 2 before and 4 after records a change of +2; the greenhouse stage rises on a completed routine day, falls by at most one on a missed day, and never goes below zero.

### 6.10 Tablet support

The team's tablet is a **Samsung Galaxy Tab running Chrome for Android**. That is the primary tablet target: speech recognition, speech synthesis, camera, tilt and wake lock all work there. Use Chrome, not the Samsung Internet browser. The iPad notes below are a graceful fallback only. The app must be fully usable on a tablet with no keyboard.

- **Start screen.** A single "Start Sentinel" tap opens the app. That one gesture creates the `AudioContext`, speaks a silent utterance to unlock speech synthesis, and requests camera, microphone and (on iPad) motion permission. Without a user gesture, tablets block all of these.
- **Layout.** Responsive with CSS grid. Landscape tablet: the same three-column layout as the laptop. Portrait: orb on top, body model and camera side by side beneath, vitals strip scrolling horizontally. Use `100dvh`, honour safe-area insets, and disable pinch-zoom and pull-to-refresh on the app shell so gestures do not fight the games.
- **Touch.** Every control is at least 48 px. Nothing depends on hover or on a key press: the demo panel opens with a three-finger tap or a small corner button as well as `D`; the hardware slide has a button as well as `H`; the cognitive check and games take taps.
- **Camera.** Request the front camera (`facingMode: "user"`), and add `playsinline` and `muted` to the video element or iPad shows a black frame. On a tablet, run the face landmarker at 640x480 and the pose landmarker every third frame; if the frame rate falls below 15, turn pose off and keep the face and pulse.
- **Speech.** Chrome on Android supports speech recognition. Safari on iPad is unreliable; detect whether `SpeechRecognition` exists and works, and if not, make the text box and a row of quick-command buttons ("Hey Sentinel, how am I doing?", "Let me see you", "Start Orb Calm") the primary input. Speech synthesis works on both after the start tap.
- **Network.** The README explains: put the laptop and tablet on the same network (a phone hotspot is safer than venue WiFi, which often blocks device-to-device traffic), allow Python through Windows Firewall on first run, open the printed HTTPS URL on the tablet, and accept the certificate warning once. On Android Chrome the warning has an "Advanced, proceed" link; on iPad Safari choose "Show details, visit this website".
- **Wake lock.** Request a screen wake lock so the tablet does not sleep mid-demo.

Acceptance: at 1024x768, 768x1024 and 1366x768 viewports there is no horizontal scroll and no overlapping panels (check with headless Chrome window sizes if available); the server answers on the LAN address over HTTPS with the generated certificate (`curl -k`); no feature is reachable only by keyboard. The real tablet run needs a human check.

### 6.11 The Director: Sentinel drives the screen (`app/js/core/director.js`)

Sentinel does not only talk. It opens screens, points at the body part with the problem, and walks the crew member through what it found. This is the feature that makes it feel like an assistant, so build it with care.

**One command bus.** Every screen change goes through `director.run(commands)`, where each command is one of a fixed whitelist:

| Command | Effect |
|---|---|
| `point_to {zone}` | Runs the pointing sequence below |
| `open_screen {name}` | `home`, `vision`, `health_log`, `trends`, `radiation`, `cognitive`, `orb_calm`, `aurora_run`, `greenhouse`, `hardware`, `crew` |
| `show_chart {metric}` | Opens the trend chart for one indicator |
| `start_scan` | Runs the full body scan below |
| `show_radiation {on}` | Toggles the radiation layer on the body model |
| `close` | Returns to home |

Commands run in order, each returning a promise that resolves when its animation finishes, so speech and motion stay in step. A new command set cancels the one in progress cleanly.

**Three sources feed it:**
1. **The rules engine.** Whenever `action.zone` changes to a new value, the frontend runs `point_to` for it. This is the automatic "Sentinel noticed something" moment.
2. **Voice and touch intents**, matched locally with no network: "show me my heart", "what's wrong with my eyes", "open radiation", "show my heart rate trend", "run a full scan", "open the health log", "go back". Build the matcher from a table of phrases per command so it is easy to extend, and include synonyms (chest -> lungs, head or brain -> head, stomach -> gut, legs or bones or muscles -> bones).
3. **The LLM.** `/api/chat` asks the model for JSON: `{"reply": "...", "commands": [...]}`. The backend validates it: unknown commands, zones or screens are dropped, at most three commands are kept, and if the JSON does not parse, the raw text is used as the reply with no commands. The LLM may navigate and point; it still cannot raise alerts or set `action`. The rules fallback also returns commands, so pointing works with no key and no network.

**The pointing sequence** (about four seconds, the centrepiece):
1. The orb turns toward the body model and a thin beam of light draws from the orb to the zone's `data-anchor` point (an SVG line in an overlay layer, animated with GSAP).
2. The zone gets `is-target` (the rotating ring) and the body model zooms smoothly so the zone fills about a third of the panel.
3. A callout card unfolds beside the zone with a leader line: the zone name, the reading that triggered it, its badge, the change from baseline, and one line of what it means.
4. Sentinel says the same thing in one sentence while the card is open.
5. If the camera is on, the matching region on the live video (eyes from face landmarks, chest from shoulder landmarks, head from the face outline) gets the same ring and a small label, so Sentinel is pointing at the real person as well as the dummy.
6. The card offers the next step as one large button (start Orb Calm, open the health log, see the trend). After the user acts or eight seconds pass, the view eases back.

**The full scan** (`start_scan`, also the voice command "run a full scan"): the scan line sweeps down the body model; as it crosses each zone the zone lights in its status colour with a soft tick sound, and a one-line result appears in a list beside the model. At the end Sentinel gives a one-sentence summary and, if anything is amber or red, points to the worst zone. Around ten seconds in total. Scan results come straight from the state; nothing is invented, and each line keeps its LIVE or SIM badge.

**Polish that matters on stage:** every transition eases (no jump cuts); sound cues are short and quiet (generated with Web Audio, with a mute control); the beam and ring use the severity colour; with `prefers-reduced-motion` the zoom and beam are replaced by an instant highlight.

Acceptance (`node --test` for the pure parts, headless run for the rest): the intent matcher maps a table of at least 20 phrases to the right commands and rejects unrelated phrases; the validator drops an unknown command and an unknown zone and keeps valid ones; `/api/chat` with a mocked LLM reply of invalid JSON returns the text as the reply with an empty command list; patching `action.zone: "eyes"` results in `zone-eyes` having `is-target` and `is-alert`; `start_scan` visits all six zones in top-to-bottom order.

---

## 7. Build order and time boxes

| Phase | Work | Box | Cut line if it overruns |
|---|---|---|---|
| 0 | Verify prepared assets, sources, certificate (section 4) | 0:20 | Skip Resemblyzer |
| 1 | Contract, mock data, state store, API, drift, decisions, medicine, tests | 0:50 | none, this is the core |
| 2 | Interface shell: tokens, responsive layout, start screen, orb, body model, tiles, badges, demo panel, polling | 0:55 | Drop sparklines |
| 2b | Director (6.11): command bus, pointing sequence, full scan, intents | 0:35 | Keep pointing + scan; drop the live-video ring |
| 3 | Vision: landmarks, rPPG, zone highlight | 0:30 | Heart rate stays SIM |
| 4 | Voice: wake word, intents, chat, TTS, pitch and talk time | 0:30 | Drop pitch, keep talk time |
| 5 | Systems: cabin alerts, cognitive check, speaker ID | 0:30 | Manual crew selector only |
| 6 | Experience: Orb Calm, interventions, hardware slide | 0:30 | Keep Orb Calm + Earth window + slide |
| 7 | Radiation Watch (6.8) | 0:30 | Keep live feed tile + dose passport; drop shelter timer |
| 8 | Aurora Run and Greenhouse (6.9) | 0:35 | Touch-drag only, no tilt; greenhouse as a static stage icon |
| 9 | Manual log, charts, routine prompts, zone info content | 0:20 | Drop routine prompts |
| 10 | Tablet pass (6.10), scenarios, full verification, README, final report | 0:30 | never cut |

That totals about 6 hours 25 minutes. Do not cut the Director (2b) or Orb Calm; they are what the judges will remember. To land in 5, take the cut lines for phases 5, 7, 8 and 9 from the start rather than waiting to overrun.

Commit at the end of each phase. After each phase, start the server and confirm the earlier acceptance tests still pass before starting the next.

---

## 8. Fallback ladder

| If this fails | The app does this | Badge |
|---|---|---|
| No internet | Everything loads from the laptop; chat uses the rules bank; speech recognition (which needs Google's servers in Chrome) is replaced by the text box and scenario buttons | replies marked "rules" |
| No LLM key, 429, or timeout | Rules template reply | "rules" |
| Microphone denied | Text box; orb listening state is driven by typing | n/a |
| Camera denied or no face | Heart rate from the simulator | SIM |
| Poor rPPG signal | "reading…", no value written | n/a |
| Resemblyzer missing or low confidence | Manual crew selector | manual |
| NOAA feed unreachable | Saved snapshot, with its date shown | SNAPSHOT |
| Speech recognition missing (iPad) | Text box and quick-command buttons | n/a |
| Tilt sensor missing or denied | Touch drag or arrow keys | n/a |
| Tablet cannot reach the laptop | Run on the laptop; README lists the hotspot and firewall steps | n/a |
| Backend unreachable | Frontend shows a clear "brain offline" state and keeps the last known values greyed out | stale |

---

## 9. Final verification and report

Before you finish:

1. Run `pytest` and `node --test`. All tests pass, or each failure is listed with its cause.
2. Start the app with `run.ps1` from a fresh shell and confirm `/api/health` responds and the page serves with no missing files (request every file under `app/vendor/` that the page references and confirm 200).
3. Run the `full_demo` scenario through the API and confirm the state passes through each expected `action.type` in order.
3b. **Browser run with Playwright.** Install `playwright` in the venv and drive the installed browser (`channel="msedge"` or `"chrome"`, so no browser download is needed). Launch with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --ignore-certificate-errors` so the camera and microphone permission paths run against the browser's synthetic devices. At 1366x768, 1024x768 and 768x1024: tap Start, confirm zero console errors, click every body zone, patch `action.zone` and confirm the pointing sequence completes, run the full scan, open every screen through the Director, run each scenario, and save a screenshot of each state to `tests/screenshots/`. Look at the screenshots yourself and fix what looks wrong: overlaps, clipped text, unreadable contrast, missing badges. The synthetic camera has no face, so this also proves the no-face fallback; a real face still needs the human check.
4. Search the frontend for any absolute `http://` or `https://` URL loaded at runtime; there should be none (the LLM and NOAA calls are made by the backend, and source links in info panels are plain anchors).
5. Check that every value rendered in a tile or panel has a badge, and that nothing driven by the simulator or a scenario can show LIVE.
6. Check that no threshold in `thresholds.json` lacks a `source` and `kind`.

Then write the final report in `README.md` and repeat it in your last message:

- A table of every feature with its label (LIVE, SIM, DESIGNED) and status (verified by test, verified by run, needs human check, not built).
- The human checklist: the exact steps to verify microphone, speech, camera, pulse and speaker enrolment in Chrome, and the tablet run (connect, accept certificate, start tap, camera, tilt, speech or quick commands).
- Every cut you took and every `demo_placeholder` threshold.
- Contract additions, for the team.
- How to add the LLM key and how to enrol voices.

State plainly what you did not verify. A report that says "pulse reading not verified, needs a person in front of the camera" is correct; a report that says "all working" when you could not see the camera is not.
