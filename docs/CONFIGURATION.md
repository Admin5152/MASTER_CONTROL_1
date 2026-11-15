# Configuration

Sentinel reads its settings from **`.env`** in the project folder. Copy `.env.example` to `.env` and fill in what you
have. **Every setting is optional:** with none, Sentinel runs fully offline on its fallbacks (rules bank for answers,
Whisper and Kokoro on the laptop for speech, English only).

`.env` is git-ignored. **Never put keys in `.env.example`**, which is committed and public.

## Keys and services

| Variable | What it turns on | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | **Claude** as the brain (first choice). Key from <https://platform.claude.com> → API keys; needs API credit | Groq answers (if `LLM_API_KEY` is set), else the rules bank |
| `CLAUDE_MODEL` | The Claude model. Default `claude-sonnet-5-5` | — |
| `CLAUDE_BUDGET_USD` | Spending stop in US dollars. Default `4.50`. Spending so far: `data/claude_usage.json` and `GET /api/health` | — |
| `LLM_API_KEY` | **Groq**: the fallback brain, and cloud speech recognition (Whisper, about 0.4 s). `GROQ_API_KEY` also works for speech | Speech recognition runs on the laptop (2–4 s) |
| `LLM_BASE_URL` | Any OpenAI-compatible endpoint. Default `https://api.groq.com/openai/v1` | — |
| `LLM_MODEL` | Fallback brain model. Default `openai/gpt-oss-120b` | — |
| `LLM_FALLBACK_MODELS` | Comma-separated models tried when the first is rate-limited. Default on Groq: `openai/gpt-oss-20b, qwen/qwen3.8-27b` | — |
| `ELEVENLABS_API_KEY` | **ElevenLabs** voices (Nathaniel, Jon, Bri, Samara) | Kokoro on the laptop, then the browser voice |
| `ELEVENLABS_CHAR_BUDGET` | Cap on ElevenLabs characters this install may spend. Default `9000`. Counted in `data/tts_usage.json`; cached lines cost nothing | — |
| `SENTINEL_TTS` | `kokoro` never calls ElevenLabs (rehearsals, saving credit) | — |
| `KHAYA_KEY` | **Khaya AI** (GhanaNLP): Twi, Ewe, Ga, Fante, Dagbani, Yoruba. Keys from <https://translation.ghananlp.org> → Profile → subscription keys | English only |
| `KHAYA_KEY_SECONDARY` | Second Khaya key, tried when the first is refused or out of allowance | — |

## Server

| Variable | What it does | Default |
| --- | --- | --- |
| `SENTINEL_TABLET_URL` | The tablet address shown in the demo panel. `run.ps1` sets it to the laptop's network address | `https://<laptop-ip>:8443/app/` |
| `SENTINEL_PIN` | A fixed tablet pairing PIN | A new random 6-digit PIN at every start (printed in the server window) |
| `SENTINEL_DATA_KEY` | The key that encrypts health data at rest (a Fernet key, ideally held off the device) | A key generated once into `data/.key` |
| `TWI_PORT` | Port of the local-language service | `3001` |

## Test and developer switches

The test suite sets these itself; you rarely need them.

| Variable | Effect |
| --- | --- |
| `SENTINEL_NO_NETWORK=1` | No outside calls (Claude, space weather). Tests use it, so they never spend credit |
| `SENTINEL_NO_PERSIST=1` | Nothing is written to `data/` |
| `SENTINEL_FRESH=1` | Start from the mock crew, ignoring saved state |
| `SENTINEL_NO_WARM=1` | Skip warming the models and connections at start-up |
| `SENTINEL_NO_SEED_PROFILES=1` | Start with empty health profiles |
| `KHAYA_LIVE=1` | Let `tests/test_twi.js` make live Khaya calls (they use up the allowance) |

## Files Sentinel writes (`data/`, git-ignored)

| File | What it holds |
| --- | --- |
| `state.json`, `profiles.json`, `alerts.json`, `reminders.json`, `care_logs.json`, `care_runs.json`, `eyes.json`, `notifications.json`, `ground.json` | The crew records, encrypted at rest where they hold health data |
| `audit.jsonl` | The audit log, one JSON object per line ([LOGS.md](LOGS.md)) |
| `claude_usage.json` | Claude spending: dollars, turns, tokens |
| `tts_usage.json` | ElevenLabs characters spent, per key |
| `tts_cache/` | Every spoken English line, so a repeat costs nothing |
| `twi_tts_cache/` | Khaya speech audio and `translations.json` |
| `spaceweather_cache.json` | The last NOAA space-weather reading, for offline use |

To start over, stop the server and delete `data/` (or run the `reset` scenario for a calm demo state).

## Settings inside the app (per browser)

Theme, glove mode, camera, microphone, voice, **language**, listening mode (wake phrase or push to talk) and mood
analysis are in **Settings** in the app and remembered in that browser.
