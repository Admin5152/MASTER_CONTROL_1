# Khaya AI (GhanaNLP) Confirmed API Shapes

This document records the exact confirmed request and response formats discovered and verified against the live GhanaNLP API gateway (`https://translation-api.ghananlp.org`).

---

## 1. Authentication & Common Headers

All requests to the Khaya API gateway require the following header:
```http
Ocp-Apim-Subscription-Key: <KHAYA_KEY>
```
- **Error on Invalid Key**: `401 Unauthorized` or `403 Forbidden: Access denied due to invalid subscription key`.
- **Automatic Fallback**: Handled in `services/twi/khaya.js` by retrying once with `KHAYA_KEY_SECONDARY`.

---

## 2. Automatic Speech Recognition (ASR v3)

### Endpoint
```http
POST /asr/v3/transcribe?language=twi
```

> **CRITICAL DISCOVERY**: Calling the bare endpoint `/asr/v3/transcribe` without `?language=twi` returns `404 Resource not found`. The query parameter `?language=twi` is mandatory.

### Headers
```http
Content-Type: audio/wav
Ocp-Apim-Subscription-Key: <KHAYA_KEY>
```

### Request Body
Raw binary audio buffer (PCM WAV, MP3, FLAC, or OGG).
- The gateway explicitly validates headers. If raw arbitrary bytes are sent without a valid container header, it returns `400 INVALID_AUDIO_FORMAT: Supported formats are WAV, MP3, FLAC, OGG`.

### Response (200 OK)
```json
{
  "text": "Nom nsuo bi na gye wʼahome."
}
```

### Languages Discovery
```http
GET /asr/v3/languages
```
Returns list of 34 supported African languages including `"Twi (twi)"`, `"Akuapem Twi (atw)"`, and `"Fante (fat)"`.

---

## 3. Translation API (v2)

### Endpoint
```http
POST /v2/translate
```

### Headers
```http
Content-Type: application/json
Ocp-Apim-Subscription-Key: <KHAYA_KEY>
```

### Request Body (Confirmed Shape)
```json
{
  "text": "Drink some water and rest.",
  "source_language": "eng",
  "target_language": "twi"
}
```

> **NOTE**: Calling with `{ text, source, target }` or `{ from, to }` returns a 400 validation error. The schema strictly requires `source_language` and `target_language` with ISO 639-3 language codes (`"eng"`, `"twi"`).

### Response (200 OK)
```json
{
  "text": "Nom nsuo bi na gye w'ahome.",
  "source_language": "eng",
  "target_language": "twi",
  "warnings": []
}
```

### Languages Discovery
```http
GET /v2/languages
```
Returns:
```json
{
  "languages": {
    "eng": "English",
    "twi": "Twi",
    "ewe": "Ewe",
    "gaa": "Ga",
    "fat": "Fante",
    "yor": "Yoruba",
    "dag": "Dagbani",
    "kik": "Kikuyu",
    "gur": "Gurune",
    "luo": "Luo",
    "mer": "Kimeru",
    "kus": "Kusaal"
  }
}
```

---

## 4. Text-To-Speech (TTS v2)

### Endpoint
```http
POST /tts/v2/synthesize
```

### Headers
```http
Content-Type: application/json
Ocp-Apim-Subscription-Key: <KHAYA_KEY>
```

### Request Body (Confirmed Shape)
```json
{
  "text": "Nom nsuo bi na gye w'ahome.",
  "language": "twi",
  "speaker": "female"
}
```
- Accepted `speaker` values: `"female"`, `"male_low"`, `"male_high"`.

### Response (200 OK)
```http
Content-Type: audio/wav
```
Returns raw binary audio stream (`RIFF...WAVE` 16-bit PCM WAV).

### Speakers Discovery
```http
GET /tts/v2/speakers
```
Returns:
```json
{
  "speakers": {
    "Multilingual": [
      "male_low",
      "male_high",
      "female"
    ]
  }
}
```

---

## 5. Gateway Error Shape (Diagnostic Parsing)

On any 400 validation error, Khaya returns:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "...",
    "details": [
      {
        "code": "INVALID_FIELD",
        "target": "target_language",
        "message": "Target language is not supported"
      }
    ]
  }
}
```
`services/twi/khaya.js` automatically parses `error.details` and logs the bad field to console without ever exposing the API keys.
