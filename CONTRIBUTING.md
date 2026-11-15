# Contributing to Sentinel

Welcome. This page tells you where things live, how to run everything, and the few rules that keep Sentinel honest. Read [README.md](README.md) first for the quickstart and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces talk.

## The rules that matter most

1. **Badges are not decoration.** Every value on screen shows LIVE (measured or entered now), SIM (simulated on purpose) or DESIGNED (a design, not running). A SIM value that looks LIVE is a bug as serious as a crash.
2. **Change from baseline, never diagnosis.** Say "your heart rate is 18 above your usual", never "you have X". Medicine suggestions always carry "consult mission medical protocol before use".
3. **No invented science.** Every threshold in `shared/thresholds.json` has a `kind` (`nasa`, `clinical_reference`, `demo_placeholder`) and a `source`. If you cannot source a number, mark it `demo_placeholder`.
4. **The rules engine owns alerts.** The LLM only words replies and may suggest validated screen commands. It never sets `action` and never produces numbers that are not in the state.
5. **Every dependency has a fallback.** No key, no network, no mic, no camera, no GPU: the app must still load and work.
6. **Never commit secrets.** Keys live in `.env` (git-ignored). Don't print or log them.

## Folder map

```
server.py                FastAPI app: serves /app and /shared, all /api routes (proxies /api/twi to the Twi service)
run.ps1                  one command to run everything (HTTPS for the tablet, the Twi service, the browser)
brain/                   Python logic
  contract.py              the state contract (shared/contract.json): validation, deep merge
  store.py                 in-memory state + history, persisted to data/state.json; LOG_FIELDS whitelist
  drift.py, decision.py    change-from-baseline engine and the ordered rules that set `action`
  thresholds.py            absolute thresholds with kind + source
  llm.py                   the brain: prompt, health vs general, memory, streaming, numeric guard, command validator
  claude.py                Claude (Anthropic) first, with a spending stop; Groq after (in llm.py)
  speech.py                /api/stt (Groq Whisper -> local worker) and /api/tts (ElevenLabs -> Kokoro), cache, budget
  whisper_worker.py        local faster-whisper in its own process
  ground.py, messages.py   store-and-forward queue to ground (SIM transport); crew messaging
  suit.py, ops.py          EVA suit (SIM telemetry), EVA readiness, the flight-surgeon digest
  eyes.py, radiation.py, medicine.py, care.py, protocols.py, alerts.py, vault.py (encrypted record) ...
systems/                 speaker ID (Resemblyzer), Sentinel Skin feed, scripted scenarios
services/twi/            Twi voice: a small Node service on port 3001 that calls Khaya AI (GhanaNLP)
  server.js, routes/twi.js   /api/twi/listen, /speak, /translate, /health
  khaya.js, twi_rules.js     the Khaya client (quota, caches) and the offline phrase rules
  examples/                  React versions of the language switch (not used by the app)
shared/                  contract, mock crew, thresholds, med kit, facts (all cited), NASA MRIDs, NOAA snapshot, environments
dataset/                 the 68 NASA JSC 28913 MRID PDFs (parsed into shared/nasa_mrid.json)
app/                     the browser app (plain ES modules, no build step)
  index.html             markup for every stage and the status line, dock and sheet
  css/tokens.css         design tokens: dark (default) and Clinical light
  css/app.css            components and v1-era screens; css/layout.css the refs 12-16 layout language
  js/main.js             boot, intro, Begin, wiring, polling, captions, routines
  js/core/               api.js, bus.js, director.js (command bus), commands.js (whitelist), intents.js, stages.js, state.js, sound.js
  js/world/              world.js (one full-screen three.js canvas), intro.js, space.js, body3d.js (body, anatomy, X-ray, scan)
  js/interface/          orb.js, bodypanel.js (rail, system panel, insights, chips), vitals.js, ranges.js, readings.js, screens.js, tiles.js, charts.js, banner.js, demopanel.js, dashboard.js
  js/voice/              voice.js (VAD capture, STT, TTS playback), bargein.js, vad.js, wake.js, pitch.js, wav.js, twi.js
  js/vision/             MediaPipe face mesh + pose, rPPG pulse, eye metrics
  js/systems/            cognitive.js + pvt.js (reaction test, Fitts's Law), radiation.js, symptom intake
  js/experience/         race/ (space race), eyecheck.js, missionmed.js (exam, ground, measures, wellbeing, organ view), hardware.js (Sentinel Skin), orbcalm.js, greenhouse.js, ...
  js/comms/              crew messages
  assets/                body3d (bodies + anatomy GLB), game (Blender GLBs), organs (Blender PNGs), space (planet textures), sound, fonts
  vendor/                three.js, MediaPipe, Chart.js, GSAP (all local; nothing loads from the internet)
tools/                   make_cert.py, mrid_extract.py, nlsp_fetch.py; anatomy/ and game/ (Blender); recording and build scripts
tests/                   pytest (test_*.py), node --test (tests/js), test_twi.js, Playwright scripts (*_shots.py, race_check.py)
docs/                    ARCHITECTURE, INTEGRATION, HOW-TO-RUN, JUDGE_WALKTHROUGH, TWI_VOICE_INTEGRATION, model card
  product/                 the product document, build spec, v2 redesign
  pitch/                   pitch deck notes, slides.html, the ASTRA blueprint
  checklists/              integration checklists, morning notes
design/                  reference images, voice samples, NASA research notes
data/, models/, certs/   local only (git-ignored): the record, caches, usage meters, voice models, HTTPS certificate
```

## Where each feature lives

| Feature | Front end | Back end |
|---|---|---|
| Talking to Sentinel | `js/main.js` (handleCommand, say, captions), `js/voice/voice.js` | `brain/ai/llm.py`, `brain/ai/speech.py`, routes `/api/chat/stream`, `/api/stt`, `/api/tts` |
| Screen changes and pointing | `js/core/director.js` (every command), `js/core/intents.js` (local phrases) | `brain/ai/llm.py` `validate_commands` (same whitelist as `js/core/commands.js`) |
| Body, X-ray, scan, organ view | `js/world/body3d.js`, `js/world/fit.js` (anatomy fitted inside each body at load), `js/interface/bodypanel.js`, `js/interface/body.js` (zone status, pointing regions), `js/experience/missionmed.js` (organ) | readings via `/api/state`, `/api/aux`; how to measure / why it matters with MRIDs in `shared/facts.json` |
| Symptom entry ("Where does it hurt?") | `js/systems/symptom.js`, `js/systems/symptomlog.js` | `manual.symptom_log` in the contract, kit match in `brain/rules/decision.py` |
| Readings, badges, range bars | `js/interface/readings.js`, `js/interface/ranges.js`, `js/interface/tiles.js` | `brain/rules/thresholds.py`, `brain/rules/drift.py` |
| Reaction test | `js/systems/cognitive.js`, `js/systems/pvt.js` | baseline in `brain/core/store.py` |
| Exam, ground, measures | `js/experience/missionmed.js` | `brain/mission/ground.py`, `/api/ground`, `/api/log` |
| Space race | `js/experience/race/` | `/api/log` (session fields) |

## Run it

```powershell
powershell -ExecutionPolicy Bypass -File run.ps1 -Http     # http://127.0.0.1:8000/app/
```

The server has no auto-reload: restart it after changing Python. Front-end changes need only a browser refresh. Keys: `D` opens the demo panel, `H` Sentinel Skin, `Esc` closes.

## Test it

```powershell
.venv\Scripts\python -m pytest                      # backend: brain, systems, radiation, voice, ground
node --test tests/js                                 # pure front-end logic
# with a server running (pip install -r requirements-dev.txt):
.venv\Scripts\python tests\layout_shots.py http://127.0.0.1:8000 both     # every main screen, dark and light
.venv\Scripts\python tests\body_shots.py http://127.0.0.1:8000            # X-ray, zone check, pointing, female body
.venv\Scripts\python tests\body_zones_check.py http://127.0.0.1:8000      # Product Document SB1-SB7 (server started with SENTINEL_FRESH=1)
.venv\Scripts\python tests\race_check.py http://127.0.0.1:8000            # the race from menu to saved mood
```

Playwright scripts use Edge with software WebGL; they disable GSAP lag smoothing so animations run on time at 1-4 fps. Set `SENTINEL_TTS=kokoro` on the server you test against so you don't spend ElevenLabs credit.

Add a test with every change to pure logic: Python in `tests/test_*.py` (use the `client` and `store` fixtures in `tests/conftest.py`; they run with no network, no key and no persistence), JavaScript in `tests/js/pure.test.mjs` (keep those modules free of DOM and three.js).

## The shared state contract

One JSON object per crew member, defined in `shared/contract.json` (a frozen block plus listed additions). `POST /api/state/{id}/patch` deep-merges a partial object, validates it, re-runs drift and decisions, and returns the new state. **Unknown fields are rejected with 422**, so nobody invents private fields. To add a field: add it to `shared/contract.json` (and its enum if it has one), to every crew in `shared/mock_data.json`, document it under "Contract additions" in the README, and add a test. Numbers that are not state (game sessions, test details) go to the history through `POST /api/log/{id}` with a field listed in `brain/core/store.py` `LOG_FIELDS`.

## Adding a Director command

1. Add it to `validateCommands` in `app/js/core/commands.js` and to `validate_commands` in `brain/ai/llm.py` (same rules).
2. Implement it in `step()` in `app/js/core/director.js` (return a promise that resolves when its animation ends).
3. Add phrases to `app/js/core/intents.js` and describe it in `SYSTEM_PROMPT` in `brain/ai/llm.py`.
4. Add tests on both sides.

## Workflow

- Branch from `main`: `feature/<short-name>` or `fix/<short-name>`. One topic per branch.
- Commit small, with a message that says what changed and why.
- Open a pull request; it needs one review and green tests (`pytest`, `node --test tests/js`). Attach before/after screenshots for UI changes, in both themes.
- Don't commit `.env`, `models/`, `data/`, `certs/` or screenshots.

## Conventions

- Plain ES modules, no build step, no framework, nothing from a CDN: vendor what you need into `app/vendor/`.
- Colours, type, spacing and radii come from `app/css/tokens.css`; never hard-code a colour in a component. Both themes must work.
- One 3D canvas (the world). Never put 3D inside a card or window.
- Keep the copy calm and short: one number, one chart, one sentence per panel; detail one tap away.
- Python: type hints, small pure functions for logic, FastAPI routes thin. JS: small modules, pure logic separated for tests.
- Credit every third-party asset in [CREDITS.md](CREDITS.md) and, where shown to users, in the About panel.
