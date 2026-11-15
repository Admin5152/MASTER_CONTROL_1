# Local-language service (Khaya AI)

A small Node.js service that gives Sentinel Twi, Ewe, Ga, Fante, Dagbani and Yoruba through Khaya AI (GhanaNLP):
it transcribes speech, translates to and from English, and speaks. Sentinel's server forwards `/api/lang/*` (and the
older `/api/twi/*`) here.

The folder is called `twi` because Twi came first; it serves every language in `khaya.js`'s `LANGUAGES`.

## Run

`run.ps1` starts it (minimised window, port 3001) and installs its packages the first time. By hand:

```powershell
npm ci
node services/twi/server.js        # or: npm run start:twi
```

Keys come from the project's `.env` (`KHAYA_KEY`, `KHAYA_KEY_SECONDARY`); `services/twi/.env` is read first if present.
The port is `TWI_PORT` (default 3001).

## Endpoints (on port 3001; the same paths through Sentinel at `https://localhost:8443`)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/twi/languages` | — | `{languages: [{code, name}], english: "eng"}` |
| POST | `/api/twi/speak` | `{text, lang?, speaker?, is_critical?, already_translated?}` | `{ok, lang, eng_text, text, audio, is_critical, resting_until}` |
| POST | `/api/twi/listen?lang=ewe` | WAV body, or `{audio: "<base64>", mimeType}` | `{ok, lang, text, eng_text}` |
| POST | `/api/twi/translate` | `{text, source, target}` | `{ok, text, source, target}` |
| GET | `/api/twi/health` | — | Khaya availability per capability, or `resting_until` |
| GET | `/api/twi/rules` | — | The offline Twi phrase rules |

- `lang` is a Khaya code: `twi` (default), `ewe`, `gaa`, `fat`, `dag`, `yor`.
- `speaker` is `female` (default), `male_low` or `male_high`.
- `audio` is a `data:audio/wav;base64,...` URL, or empty when Khaya could not speak (out of allowance, offline).

## Files

| File | What it does |
| --- | --- |
| `server.js` | HTTP server and request dispatch |
| `routes/twi.js` | The endpoint handlers, with a 10-second timeout on every Khaya call |
| `khaya.js` | Khaya client: two keys, rest-until-replenished on a used-up allowance, speech and translation caches, WAV conversion |
| `twi_rules.js` | Offline Twi phrases, used only when Khaya cannot translate |
| `khaya.md` | Notes on Khaya's API shapes and errors |
| `examples/` | React versions of the language switch (not used by the app) |

Caches are written to `data/twi_tts_cache/` in the project. Tests: `node tests/test_twi.js` (offline;
`KHAYA_LIVE=1` adds live calls). The full guide is [docs/LANGUAGES.md](../../docs/LANGUAGES.md).
