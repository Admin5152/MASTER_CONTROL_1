# Sentinel

**An onboard health companion for deep-space crews.** Built by COSMOcare for the NASA Space Apps Challenge 2026.

**Repository:** <https://github.com/Admin5152/MASTER_CONTROL_1>

On the way to Mars a message to Earth takes up to 24 minutes each way, and there is no quick ride home. NASA calls
the problem **Earth-Independent Medical Operations**. When an astronaut feels unwell, the first response has to
happen on board.

A crew member talks to Sentinel. It:

- reads their pulse from the camera
- compares every reading with **their own normal**
- shows the body system that changed on real 3D anatomy
- explains what it means in plain words, and guides the next step
- queues a summary for the flight surgeon across the delay

> Sentinel describes change from baseline; it never diagnoses. Every value carries a badge: **LIVE** (measured now),
> **MANUAL** (entered by the crew member), **SIM** (simulated on purpose) or **DESIGNED** (a design, not running).
> It is a hackathon build, designed around NASA's published problems. It is not certified and not a medical device.

## Highlights

| | |
| --- | --- |
| **Rules decide, AI only talks** | Urgency, protocols and alerts come from rules you can read ("Why this?" on every alert). The language model only phrases the answer, and every number it says is checked against the record |
| **Works offline where it matters** | Every medical decision runs on the device. Delay-tolerant queue to ground |
| **NASA-sourced** | 68 NASA medical requirement documents (JSC 28913), NASA-STD-3001 limits, live NOAA space weather, NASA DONKI |
| **Voice first** | "Hey Sentinel", interrupt any time, knows who is speaking. Claude for answers, ElevenLabs voices |
| **Seven languages** | English, plus Twi, Ewe, Ga, Fante, Dagbani and Yoruba through Khaya AI (GhanaNLP) |
| **Real anatomy** | 3D body and X-ray of 18 body systems (BodyParts3D), eye check, EVA suit monitoring, radiation watch |

## Quick start

Needs Windows 10/11, Python 3.10+, Chrome; Node.js 18+ for the local languages.

```powershell
git clone https://github.com/Admin5152/MASTER_CONTROL_1.git sentinel
cd sentinel
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-voice.txt
copy .env.example .env                      # add your keys (all optional)
powershell -ExecutionPolicy Bypass -File run.ps1 -SkipSpeaker
```

Chrome opens **https://localhost:8443/app/**. Tap **Begin** and say **"Hey Sentinel"**. To use the tablet, see
[docs/HOW-TO-RUN.md](docs/HOW-TO-RUN.md).

## Documentation

| Guide | For |
| --- | --- |
| [How to run](docs/HOW-TO-RUN.md) | Setup, the laptop and tablet, what to say, stopping, tests |
| [Configuration](docs/CONFIGURATION.md) | Every `.env` setting, key and file Sentinel writes |
| [API reference](docs/API.md) | Every endpoint, with request and response examples (also live at `/docs` while running) |
| [Logs and troubleshooting](docs/LOGS.md) | The server window, the audit log, health and usage meters, fixes for common problems |
| [Datasets](docs/DATASETS.md) | Every dataset we used (NASA, NOAA, clinical, 3D) and how Sentinel uses each |
| [Languages](docs/LANGUAGES.md) | Twi, Ewe, Ga, Fante, Dagbani and Yoruba through Khaya AI: how it works, setup, adding a language |
| [Architecture](docs/ARCHITECTURE.md) | How the browser, server, rules engine, brain and voice fit together |
| [Integration and space](docs/INTEGRATION.md) | The device interface, where NASA systems would plug in, how it works in flight |
| [Judge walkthrough](docs/JUDGE_WALKTHROUGH.md) | The product in one read, and a problem followed start to finish |
| [Contributing](CONTRIBUTING.md) | Folder map, where each feature lives, conventions, workflow |
| [Credits](CREDITS.md) | Data, models, assets and licences |

All documents are indexed in [docs/README.md](docs/README.md).

## Project layout

```
app/            the browser app (what the crew sees): js/ core, voice, vision, world, interface, experience
brain/          Python logic, grouped: core (record) · rules (assessment) · clinical (care) · ai (brain, speech)
                · mission (radiation, EVA, ground) · crew (messages, wellbeing)
services/twi/   local-language service (Node, Khaya AI)
systems/        speaker ID, scripted scenarios, Sentinel Skin feed
shared/         sourced data: thresholds, NASA MRIDs, crew, environments, med kit
dataset/        the 68 NASA MRID PDFs
server.py       the server (FastAPI): the app and every /api endpoint
run.ps1         runs everything with one command
tools/          build, anatomy (Blender), API-doc generator, recording scripts
tests/          pytest, node --test (js/), browser checks (browser/)
docs/           guides; product/, pitch/ and checklists/ for the product document, pitch material and checklists
```

The full map, file by file: [CONTRIBUTING.md → Folder map](CONTRIBUTING.md#folder-map).

## Tech stack

| Layer | Technology |
| --- | --- |
| Front end | Vanilla JavaScript (ES modules, no build step), three.js, GSAP, Chart.js, MediaPipe Tasks Vision |
| Server | Python 3.12, FastAPI, uvicorn (HTTPS on the local network), httpx, cryptography |
| Brain | Claude Sonnet 5.5 (Anthropic); Groq `openai/gpt-oss-120b` as the fallback; an offline rules bank |
| Speech | Groq Whisper and local faster-whisper (in); ElevenLabs Flash v2.5 and Kokoro (out); Resemblyzer (who is speaking) |
| Languages | Khaya AI (GhanaNLP) through a Node.js service |
| 3D | BodyParts3D anatomy and MakeHuman bodies, prepared in Blender |
| Tests | pytest (305), node --test (95), Playwright |

## Tests

```powershell
.venv\Scripts\python -m pytest -q        # backend; no network, keys or credit used
node --test tests/js                      # front-end logic
node tests/test_twi.js                    # language service, offline
```

## Team and licence

COSMOcare, NASA Space Apps Challenge 2026. Third-party data, models and assets are credited, with their licences, in
[CREDITS.md](CREDITS.md). Older build notes: [docs/product/BUILD_NOTES.md](docs/product/BUILD_NOTES.md).
