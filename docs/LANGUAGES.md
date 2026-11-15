# Languages: English, Twi, Ewe, Ga, Fante, Dagbani, Yoruba

Sentinel speaks and listens in English and in six African languages. English uses ElevenLabs (its voices speak
English). The other languages go through **Khaya AI** by GhanaNLP, which transcribes, translates and speaks them.

| Language | App code | Khaya code | Listens | Translates | Speaks |
| --- | --- | --- | --- | --- | --- |
| English | `en` | `eng` | Groq Whisper | — | ElevenLabs (Kokoro offline) |
| Twi (Asante) | `tw` | `twi` | Khaya | Khaya | Khaya |
| Ewe | `ee` | `ewe` | Khaya | Khaya | Khaya |
| Ga | `gaa` | `gaa` | Khaya | Khaya | Khaya |
| Fante | `fat` | `fat` | Khaya | Khaya | Khaya |
| Dagbani | `dag` | `dag` | Khaya | Khaya | Khaya |
| Yoruba | `yo` | `yor` | Khaya | Khaya | Khaya |

Each Khaya language was checked live on 15 November 2026: a translation from English, then speech with the
multilingual voices, then recognition of that speech.

## How it works

```
Crew member speaks Ewe
   │
   ▼
POST /api/lang/listen?lang=ewe ──► Khaya ASR: Ewe speech → Ewe text ──► Khaya translate: Ewe → English
   │
   ▼
The brain works in English: rules, safety checks, number checks, Claude (or Groq) phrases the answer
   │
   ▼
POST /api/lang/speak {lang: "ewe"} ──► Khaya translate: English → Ewe ──► Khaya TTS: Ewe speech
   │
   ▼
The orb speaks Ewe; the caption shows Ewe with the English underneath
```

The brain always thinks in English, for three reasons:

- **Safety.** The rules, the urgent-concern script and the check that every number in a health answer is in the
  record all work on English.
- **Quality.** Khaya, a model trained for these languages, writes better Ewe or Twi than a general model.
- **One code path.** Every language works the same way.

Critical safety and medical alerts **also play in English**, whatever the language.

## Switching language

- **By voice:** "speak Ewe", "switch to Ga", "can you answer in Fante", "let's talk Dagbani", "speak Yoruba please",
  "speak English". A question such as "how many people speak Yoruba?" does not switch.
- **In Settings:** the **Language** row. Below it, a status line says whether the local-language voice is ready.
- The choice is remembered in the browser (`localStorage` key `sentinel_voice_language`).

Twi greetings ("Maakye", "Wo ho te sɛn?") switch to Twi and get a Twi reply.

## What happens when Khaya is unavailable

| Situation | What Sentinel does |
| --- | --- |
| Call allowance used up (Khaya answers 403 "Out of call volume quota … replenished in d.hh:mm:ss") | That key **rests** until the time Khaya gives: no calls are made with it. The second key is tried. When both rest, every request returns at once with `resting_until`. |
| No audio for a reply | The translated words are shown and the reply is spoken **once** in the English voice. |
| Translation fails | Twi: built-in phrase rules (`services/twi/twi_rules.js`). Other languages: the English is shown as it is. |
| Khaya slow | Every call has a 10-second timeout; the English fallback plays. |

Settings shows when the allowance returns. The rest of the app is unaffected.

## Saving the call allowance

Every Khaya call counts against the plan's allowance, so:

- **Speech audio is cached** on disk (`data/twi_tts_cache/*.wav`) and in memory, keyed by text, voice and language.
- **Translations are cached** in `data/twi_tts_cache/translations.json`.
- **The health check runs at most every 30 minutes**, and not at all while the keys rest.
- **The test script makes no Khaya calls** unless asked: `node tests/test_twi.js` runs offline;
  `KHAYA_LIVE=1 node tests/test_twi.js` also makes the live calls.

## Setup

1. Get keys at <https://translation.ghananlp.org>: sign in, then **Profile → subscription keys**.
2. Put them in `.env` (never in `.env.example`, which is committed):

   ```ini
   KHAYA_KEY=<primary key>
   KHAYA_KEY_SECONDARY=<secondary key>
   ```

3. Node.js 18 or later must be installed. `run.ps1` installs the service's packages (`npm ci`) the first time and
   starts it on port 3001. Without Node, Sentinel runs in English only.
4. Check: `GET https://localhost:8443/api/lang/health` should return `"ok": true`.

## The service (`services/twi/`)

| File | What it does |
| --- | --- |
| `server.js` | A small HTTP server on port 3001 (`TWI_PORT`). Sentinel's server forwards `/api/lang/*` and `/api/twi/*` to it |
| `routes/twi.js` | The endpoints: `languages`, `listen`, `speak`, `translate`, `health`, `rules` |
| `khaya.js` | The Khaya client: keys and rotation, the rest-until-replenished rule, caches, WAV conversion, `LANGUAGES` |
| `twi_rules.js` | Offline Twi phrases, used when Khaya cannot be reached |
| `khaya.md` | Notes on Khaya's API (endpoints, payloads, errors) |
| `examples/` | React versions of the language switch; not used by the app |

In the browser:

| File | What it does |
| --- | --- |
| `app/js/voice/languages.js` | The language list, and recognising "speak Ewe" (tested in `tests/js/languages.test.mjs`) |
| `app/js/voice/twi.js` | Speaking a reply through Khaya: queue, playback through the orb, captions, English fallback |
| `app/js/voice/voice.js` | Listening: a local language goes to `/api/lang/listen`, English to `/api/stt` |

The endpoints and their request and response shapes are in [API.md](API.md#local-languages-khaya-ai).

## Adding a language

1. Check Khaya supports it: its code must be in the translation list (`GET /api/lang/health` shows
   `translation_languages`) and speech must work with it (try `POST /api/lang/speak` with `"lang": "<code>"`).
2. Add it to `LANGUAGES` in `services/twi/khaya.js` (`code: "Name"`).
3. Add a row to `LANGUAGES` in `app/js/voice/languages.js`: app code, Khaya code, name, native name, and the words people
   use to ask for it.
4. Add a case to `tests/js/languages.test.mjs`, run `node --test tests/js`, then restart with `run.ps1`.
