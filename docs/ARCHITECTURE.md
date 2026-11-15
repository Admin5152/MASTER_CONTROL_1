# Sentinel architecture

## The big picture

```
 Browser (laptop Chrome/Edge or tablet Chrome)                       Python (one uvicorn process)
 ┌─────────────────────────────────────────────────────────┐        ┌───────────────────────────────────────────┐
 │ HTML layer: status line + pill nav, stages, dock, sheet  │        │ server.py  (FastAPI)                       │
 │   bodypanel, vitals, screens, missionmed, race HUD       │        │   /app, /shared        static files        │
 │ ─────────────────────────────────────────────────────── │  HTTP  │   /api/state, /patch   state + rules       │
 │ Director (command bus) ◄── intents (local phrases)       │ ─────► │   /api/aux, /history   assessment, charts  │
 │      ▲                 ◄── rules engine (action.zone)    │ poll   │   /api/chat/stream     brain (NDJSON)      │
 │      │                 ◄── LLM commands (validated)      │ 500 ms │   /api/stt, /api/tts   voice               │
 │ ─────────────────────────────────────────────────────── │        │   /api/ground          store and forward   │
 │ World: ONE full-screen three.js canvas                   │        │   /api/log, /scenario, /spaceweather, ...  │
 │   sky (gradient + stars) → content scene → orb → bloom   │        │                                           │
 │   scenes: intro | space (Earth, Moon, Mars) | body | race│        │ brain/   core · rules · clinical · ai ·    │
 │ ─────────────────────────────────────────────────────── │        │          mission · crew (Claude, Groq)     │
 │ Voice: mic → VAD → /api/stt ; /api/tts → Web Audio → orb │        │ systems/ speaker ID · scenarios            │
 │ Vision: MediaPipe face mesh + pose → rPPG pulse          │        │ data/    state.json, tts_cache, ground     │
 └─────────────────────────────────────────────────────────┘        └───────────────────────────────────────────┘
```

## Browser layers

1. **The world** (`app/js/world/world.js`). One `WebGLRenderer` behind everything. Each frame composites the sky (a deep-space or Clinical-light gradient plus the starfield), the active content scene (intro solar system, space, body or race), and Sentinel's orb, which can be placed anywhere on screen in pixels; one bloom pass on top. Stages are camera moves and cross-fades inside this world. Nothing 3D is ever drawn in a card.
2. **Stages** (`app/js/core/stages.js`): `assistant` (Sentinel, home), `body`, `vitals`, `mission`, `vision`, `radiation`. A stage picks the world scene and the orb's place (centre on home, a corner elsewhere).
3. **Screens** (`app/js/interface/screens.js`): everything else opens in a sheet (side, wide, full-screen for the race, or around the orb for Orb Calm). Registered by name; each `render(el, ctx, arg)` returns a cleanup function.
4. **The HTML layer** floats over the world: the status line with the pill nav, the dock (menu, mic + text, badge key, conversation), the sheet, the callout and beam layer for pointing.

## The Director (command bus)

Every screen change and body move goes through `director.run(commands)` (`app/js/core/director.js`). Commands run in order; each resolves when its animation ends; a new run cancels the current one cleanly. The whitelist (`app/js/core/commands.js`, mirrored in `brain/ai/llm.py`):

`point_to {zone}` · `check_zone {zones}` · `start_scan` · `open_screen {name}` · `show_chart {metric}` · `rotate_body {view|angle}` · `zoom_body {zone|reset}` · `xray {on, style?}` · `isolate {part}` · `show_radiation {on}` · `close`

Three sources feed it: the **rules engine** (when `action.zone` changes, Sentinel points at it), **local intents** (`intents.js`, no network: "check my chest", "show me my spine", "turn around"), and the **LLM** (a final `COMMANDS:` line, validated server-side: unknown commands, zones and screens are dropped, at most three kept).

## Server routes

| Route | What |
|---|---|
| `GET /api/state/{id}`, `POST /api/state/{id}/patch` | the contract object; patches are validated (422 on unknown fields), then drift and decisions re-run |
| `GET /api/aux/{id}`, `/api/assessment/{id}`, `/api/history/{id}?field=` | thresholds with kind and source, zone severities, clock, scenario status; time series |
| `POST /api/chat`, `POST /api/chat/stream`, `POST /api/chat/forget` | the brain: one reply, or NDJSON sentences then a final object |
| `POST /api/stt`, `POST /api/tts`, `GET /api/voices` | speech in and out |
| `POST /api/ground/{id}`, `GET /api/ground` | store-and-forward packets with status from the clock |
| `POST /api/log/{id}` | whitelisted session numbers into the history |
| `POST /api/identify`, `/api/enrol/{id}` | speaker ID (Resemblyzer) |
| `POST /api/cabin`, `/api/scenario/{name}`, `GET /api/spaceweather`, `/api/clock`, `/api/health`, `/api/crew` | cabin sim, scripted demos, NOAA feed, mission clock, subsystem status |

## Rules engine

`brain/core/store.py` holds state per crew member (from `shared/mock_data.json`, persisted to `data/state.json`) and an append-only history. On every patch: `drift.py` computes change from each person's baseline per metric (thresholds in `shared/thresholds.json`, all `demo_placeholder` percentages), `thresholds.py` checks absolute limits with their `kind` and `source`, and `decision.py` sets `action` by an ordered list of rules (cabin alert, radiation storm, alert vitals, symptom with a kit match, stress, fatigue or low mood, mild drift, none). The LLM never touches `action`.

## Brain, speech and language chains

```
Brain:  question ──► health or general? ──► Claude Sonnet 5.5 (brain/ai/claude.py: no thinking pause, low effort,
                                             │  instructions cached, stops at CLAUDE_BUDGET_USD)
                                             ├─ Claude fails or declines before speaking ──► Groq openai/gpt-oss-120b,
                                             │  then gpt-oss-20b, qwen (brain/ai/llm.py; a rate-limited model rests)
                                             │ streamed sentence by sentence (at most 2, or 5 when asked to explain);
                                             │ health sentences checked: every number must be in the record
                                             ├─ no model reachable ──► rules bank (health) / "I can't reach my knowledge" (general)
                                             └─ COMMANDS line ──► validate ──► Director

Speech out: sentence ──► /api/tts ──► disk cache? ──► ElevenLabs Flash v2.5 (Nathaniel, Jon, Bri, Samara; character
            budget; 7 s timeout + one retry) ──► Kokoro (local) ──► browser speechSynthesis
            played through Web Audio; the analyser drives the orb's speaking pulse; listening pauses while speaking

Speech in:  mic ──► VAD (energy + zero-crossing, adaptive floor, 650 ms hangover) ──► 16 kHz WAV ──► /api/stt
            ──► Groq whisper-large-v3 (phantom phrases filtered) ──► local faster-whisper (a kept-warm worker process)
            transcript ──► wake phrase "hey Sentinel" or push-to-talk ──► local intent or the brain
            while Sentinel speaks: barge-in ("stop", "wait", "go on"; "yeah" and "okay" are listening noises)

Languages:  a local language (Twi, Ewe, Ga, Fante, Dagbani, Yoruba) ──► /api/lang/listen ──► Khaya ASR + translate to
            English ──► the brain (always English) ──► /api/lang/speak ──► Khaya translate + TTS ──► orb
            (services/twi, Node, port 3001; see LANGUAGES.md)
```

## Data honesty in the pipeline

- Scenario and demo-panel patches carry `source: "sim"`; a value shows LIVE only when its latest history point came from the camera, the microphone or the user.
- The X-ray is a reference anatomy fitted to the body, never the crew member's scan; the heartbeat strip is drawn at the measured rate and says it is an illustration.
- Sentinel Skin is DESIGNED; ground transport is SIM; the one-way delay is SIM.
