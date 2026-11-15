# Sentinel Twi Voice Integration (Khaya AI / GhanaNLP)

## 1. Executive Summary & Purpose

This document details the engineering process, architecture, and operational mechanics of adding **Twi voice support** to Sentinel using **Khaya AI** (`https://translation-api.ghananlp.org`). 

Sentinel is an autonomous onboard clinic designed for deep space missions (e.g., Mars transit and lunar surface operations). Prior to this phase, Sentinel exclusively spoke English through an ElevenLabs synthesis pipeline (with local Kokoro and browser speech fallbacks). 

Twi was integrated as an **additive voice layer**—enabling astronauts to speak in Twi and receive spoken medical, clinical, and mission guidance in Twi—while keeping Sentinel's underlying clinical intelligence, medical protocol rules, risk scores, and English ElevenLabs voice pipeline **100% intact and untouched**.

---

## 2. Architecture & Design Principles

### 2.1 The Two-Way Voice Pipeline

```
[ Astronaut Speaks Twi ]
        │ (Microphone / Web Audio)
        ▼
   POST /api/twi/listen
        │
        ├── 1. Khaya ASR v3 (/asr/v3/transcribe?language=twi) ──> Twi Text
        │
        └── 2. Khaya Translation v2 (twi -> eng) ───────────────> English Text
                                                                       │
                                                                       ▼
                                                    [ Sentinel Existing Engine ]
                                                    (Clinical Rules, LLM, Vitals)
                                                                       │
                                                                       ▼
                                                            [ English Advice ]
                                                                       │
        ┌──────────────────────────────────────────────────────────────┴──────────────────────────┐
        │                                                                                         │
  [ language === "en" ]                                                             [ language === "tw" ]
        │                                                                                         │
  Existing ElevenLabs Path                                                                  POST /api/twi/speak
   (Completely Untouched)                                                                         │
                                                                                ├── 1. Khaya Translation v2 (eng -> twi)
                                                                                │      ──> Twi Text
                                                                                │
                                                                                └── 2. Khaya TTS v2 (/tts/v2/synthesize)
                                                                                       ──> Audio Buffer (WAV)
                                                                                               │
                                                                    ┌──────────────────────────┴──────────────────────────┐
                                                                    ▼                                                     ▼
                                                            [ Play Twi Audio & ]                             [ Is Critical Alert? ]
                                                            [ Show Dual Subtitles ]                                       │
                                                            (Twi primary, Eng small)                              YES ────┴──── NO
                                                                                                                   │            │
                                                                                                          [ ALSO Play English ] [ Done ]
                                                                                                          [ via ElevenLabs    ]
```

### 2.2 Core Architectural Principles

1. **Strict File Isolation**:
   All Twi logic lives in dedicated new files (`services/twi/khaya.js`, `services/twi/routes/twi.js`, `services/twi/examples/useTwiVoice.js`, `services/twi/examples/LanguageSelector.js`, `services/twi/server.js`, and `tests/test_twi.js`).
2. **Single Existing Code Edit**:
   Only a single line in `app/js/main.js` was modified at the voice routing junction:
   ```javascript
   return ((globalThis.language === "tw" || (typeof language !== "undefined" && language === "tw")) ? (globalThis.speakTwi ? globalThis.speakTwi(text, { interrupt: !append, source: opts.source, fallback: () => voiceMod.speak(text, { interrupt: !append }) }) : import("../../services/twi/examples/useTwiVoice.js").then((m) => m.speakTwi(text, { interrupt: !append, source: opts.source, fallback: () => voiceMod.speak(text, { interrupt: !append }) }))) : voiceMod.speak(text, { interrupt: !append }));
   ```
3. **Fail-Safe Fallback**:
   If any Khaya API call times out (~10s), encounters network loss, or experiences credential expiration, the system **never crashes or goes silent**. It automatically displays the text on screen and falls back to the English ElevenLabs audio output.
4. **Mission Safety First (Dual-Voice for Critical Alerts)**:
   In space medicine, ambiguous alerts can be life-threatening. If an alert is critical (e.g., radiation shelter advisory, suit pressure loss, hypoxia, cardiac spike), Sentinel speaks the guidance in Twi **and immediately plays the English ElevenLabs warning as well**.

---

## 3. Khaya API Schema Discoveries & Corrections

During live API probing against `https://translation-api.ghananlp.org`, several API specifics and schema constraints were empirically verified:

| API Service | Endpoint | Discovered Constraint / Field Correction | Resolution Implemented |
|---|---|---|---|
| **ASR v3 (Speech-to-Text)** | `POST /asr/v3/transcribe` | Calling bare path `/asr/v3/transcribe` returns `404 Resource not found`. Requires `?language=twi` query parameter. Body must be binary audio, not JSON. | Updated URL to `/asr/v3/transcribe?language=twi`, set `Content-Type: audio/wav`, and passed raw binary buffer. |
| **Audio Format Validation** | `POST /asr/v3/transcribe` | Sending raw unformatted chunks returns `400 INVALID_AUDIO_FORMAT: Supported formats are WAV, MP3, FLAC, OGG`. | Client records or wraps audio to 16kHz 16-bit mono PCM WAV headers before sending. |
| **Translation v2** | `POST /v2/translate` | Standard request requires `{ text, source_language, target_language }`. Using `{ text, source, target }` or `{ from, to }` returns 400 validation error. | Formatted payload as `{ text: cleanText, source_language: "eng", target_language: "twi" }` (or vice-versa). Accepts ISO 639-3 codes (`eng`, `twi`). |
| **TTS v2 (Text-to-Speech)** | `POST /tts/v2/synthesize` | Requires `{ text, language, speaker }`. Accepted speakers from `GET /tts/v2/speakers` are `female`, `male_low`, `male_high`. Returns binary `audio/wav`. | Structured request with `{ text, language: "twi", speaker: "female" }` and handled response as binary stream/buffer. |
| **Authentication & Headers** | All Endpoints | Header key must be `Ocp-Apim-Subscription-Key`. | Injected header with automatic key rotation on HTTP 401 or 403. |

---

## 4. Security & Secret Management

- **Zero Client Exposure**: `KHAYA_KEY` and `KHAYA_KEY_SECONDARY` are strictly loaded in Node.js via `services/twi/khaya.js`. They are never passed to the client browser or bundle.
- **Git Protection**: Verified `.gitignore` contains `.env` at line 1.
- **Example Template**: `.env.example` committed with safe placeholder entries:
  ```ini
  # --- Twi Voice (Khaya AI / GhanaNLP) ---
  KHAYA_KEY=your_key_here
  KHAYA_KEY_SECONDARY=your_secondary_key_here
  ```
- **Automatic Key Rotation**: If a request receives a `401 Unauthorized` or `403 Forbidden` using the primary key, `services/twi/khaya.js` automatically retries once using `KHAYA_KEY_SECONDARY`.
- **Sanitized Logging**: On 400 validation errors, `error.details` is parsed and logged to the server console for diagnostic purposes without ever logging keys or sensitive authorization headers.

---

## 5. Audio Caching Architecture

To preserve API quotas and eliminate latency during repetitive astronaut prompts:
- **Two-Tier Caching**:
  1. **Memory Cache**: Fast `Map` lookup keyed by MD5 hash of `normalized_text:speaker`.
  2. **Disk Cache**: Persistent WAV files stored in `data/twi_tts_cache/<md5_hash>.wav`.
- **Pre-warmed Mission Lines**:
  - Greeting: *"Akwaaba. Me ne Sentinel."* (Hello. I am Sentinel.)
  - Prompt: *"Mɛtumi aboa wo sɛn nnɛ?"* (How can I help you today?)
  - Calming guidance: *"Nom nsuo bi na gye w'ahome."* (Drink some water and rest.)
  - Vitals check: *"Wo ho te sɛn?"* (How are you feeling?)
- **Verification**: Cached synthesis returns in `< 1ms` with 0 network calls.

---

## 6. Dual-Language Display in UI

When `language === "tw"` is selected:
- Both Twi and English text are presented in Sentinel's caption container (`#caption`) and transcript (`#transcript`).
- Twi is displayed as the primary bold headline, with English displayed beneath in a smaller italicized subtitle.
- This ensures clarity, crew training, and unambiguous communication between multicultural astronauts and ground control flight surgeons.

---

## 7. File Manifest

### Created Files:
1. `services/twi/khaya.js`: Complete GhanaNLP client library (ASR v3, Translation v2, TTS v2, key rotation, zero-dep env loader, caching).
2. `services/twi/routes/twi.js`: Route handlers for `/api/twi/listen`, `/api/twi/speak`, `/api/twi/translate`, and `/api/twi/health` with 10s timeout protection.
3. `services/twi/server.js`: Standalone Node.js HTTP server running on port 3001 with CORS and Express/HTTP dispatcher support.
4. `services/twi/examples/useTwiVoice.js`: Plain JS module & React Hook for mic capture, dual subtitles, 10s timeout fallback, and ElevenLabs critical alert dispatch.
5. `services/twi/examples/LanguageSelector.js`: Universal language selector (EN / TWI toggle) with live state persistence and voice loading spinner.
6. `package.json`: NPM package metadata and scripts (`npm run start:twi`, `npm run test:twi`).
7. `tests/test_twi.js`: Comprehensive 10-test automated verification suite for all Twi operations.
8. `docs/TWI_VOICE_INTEGRATION.md`: This architecture and operations document.

### Modified Existing Files (Exactly 1 Line Changed in 1 Code File):
1. `app/js/main.js` (Line 887):
   ```javascript
   return ((globalThis.language === "tw" || (typeof language !== "undefined" && language === "tw")) ? (globalThis.speakTwi ? globalThis.speakTwi(text, { interrupt: !append, source: opts.source, fallback: () => voiceMod.speak(text, { interrupt: !append }) }) : import("../../services/twi/examples/useTwiVoice.js").then((m) => m.speakTwi(text, { interrupt: !append, source: opts.source, fallback: () => voiceMod.speak(text, { interrupt: !append }) }))) : voiceMod.speak(text, { interrupt: !append }));
   ```
2. `.env.example`: Added 4 lines of configuration comments and placeholder keys.

---

## 8. Verification & Test Results

### 8.1 Existing Regression Suite (`pytest -q`)
- **280 passed, 6 skipped, 0 failures**.
- English ElevenLabs voice pipeline and all clinical systems pass without regression.

### 8.2 Twi Voice Suite (`node tests/test_twi.js`)
- **10 passed, 0 failed**:
  - Test 1: Security - `.env` is properly git-ignored.
  - Test 2: Security - `.env.example` contains placeholders only.
  - Test 3: Khaya Translation (`eng -> twi`): *"Nom nsuo bi na gye w'ahome."*
  - Test 4: Khaya Translation (`twi -> eng`): *"Drink some water and relax."*
  - Test 5: Khaya TTS & Caching: 96,314 bytes WAV (API: 940ms, Cache: 0ms).
  - Test 6: Khaya ASR v3 Transcription: *"Nom nsuo bi na gye wʼahome."*
  - Test 7: Route `/api/twi/speak` -> valid base64 WAV payload returned.
  - Test 8: Route `/api/twi/listen` -> audio transcribed to Twi and translated to English for Sentinel.
  - Test 9: Graceful Error Handling -> empty/invalid input handled without server crash.
  - Test 10: Critical Alert Flag -> successfully triggers secondary English ElevenLabs playback.
