# Security and privacy

Sentinel holds health data about a small crew, so the rules are simple: **health data stays on the device, only its
owner sees it, and every change is recorded.** This page describes what the build does today and the limits it states
openly. It is a hackathon build; a flight system would need a formal security review.

## Health data on the device

| Protection | What it does | Where |
| --- | --- | --- |
| **Encryption at rest** | Health state, profiles (allergies, medicines), the ground queue and the crew pulse are written encrypted with Fernet (AES-128-CBC with HMAC-SHA256, `cryptography` library) | `brain/core/vault.py` |
| **The key** | `SENTINEL_DATA_KEY` if set (ideally held off the device); otherwise a key generated once into `data/.key` | `brain/core/vault.py` |
| **Private journal** | Wellbeing journal entries are encrypted on the device and can be deleted by their owner | `/api/wellbeing/{cid}/journal` |
| **Audit log** | Every reading, decision, alert, pairing attempt and demo reset is appended to `data/audit.jsonl`. Readings are logged by **field name, never with health background** | `brain/core/audit.py` ([LOGS.md](LOGS.md)) |
| **Export and delete** | A crew member can view and export their profile, and delete it | `/api/profile/{cid}`, `/api/profile/{cid}/export` |

**Stated limit:** a key on the same disk protects a copied `data/` folder, not a stolen laptop. In flight the key
would live in the spacecraft's secure element.

## Who sees what

| Person | Sees |
| --- | --- |
| The crew member | Everything about themselves |
| Their chosen buddy, and the commander if they allow it | A notice that help is needed, **never the readings** |
| Other crewmates | Urgent and cabin alerts only |
| The flight surgeon | The digests the crew member's Sentinel queues for ground |

Camera mood reading is **opt-in per crew member** (Settings → Camera mood analysis). Off means no face crop is sent and
expression is not read.

## Connecting devices: the tablet pairing PIN

- The server listens on HTTPS (port 8443) with a certificate made on the laptop (`tools/make_cert.py`, `certs/`).
- **Requests from the laptop itself** (localhost) are always allowed.
- **Any other device must pair first** with the 6-digit PIN printed in the server window. A new random PIN is made at
  every start (or set `SENTINEL_PIN`).
- A correct PIN sets an **HTTP-only, SameSite=strict cookie** (marked secure when served over HTTPS) that lasts 12 hours. Without it, every API
  call except `/api/health` and `/api/pair` returns `401`.
- Accepted and refused pairings are written to the audit log, with the device's address.

## API keys

- Keys live only in **`.env`**, which is git-ignored. `.env.example` (committed) holds empty placeholders only.
- **Keys never reach the browser.** The Anthropic, Groq and ElevenLabs keys are used by the Python server; the Khaya
  keys by the local-language service. The app only talks to Sentinel's own server.
- Keys are not logged. Usage meters record spending (dollars, characters), not keys.
- Spending stops protect the credit: `CLAUDE_BUDGET_USD` and `ELEVENLABS_CHAR_BUDGET`. A Khaya key that runs out of
  allowance rests instead of retrying ([LANGUAGES.md](LANGUAGES.md)).
- The tests never call paid services (`SENTINEL_NO_NETWORK=1`, Khaya offline unless `KHAYA_LIVE=1`).

**If a key is exposed** (pasted in a chat, committed, shown on screen): revoke it at the provider, create a new one,
and put the new one in `.env`. Removing it from a later commit does not remove it from git history.

## What leaves the device

On Earth, for speed and quality, speech recognition, the brain's phrasing, the voices and the local languages use
cloud services. The full list of what is sent, and when, is in the [model card](model_card.md#4-what-data-leaves-the-device).
In short:

- **Never sent:** camera frames, the stored health record, the audit log.
- **Sent when talking:** speech audio (to Groq, or Khaya in a local language), the question with the parts of the
  record it needs (to Claude, or Groq), and reply text to be spoken (ElevenLabs or Khaya).
- **For the most privacy:** set listening to **Push to talk only**, so only what you say after a tap is sent. Or run
  with no keys at all, so everything stays on the laptop on the offline fallbacks.

On a mission, these are replaced by on-board models ([INTEGRATION.md](INTEGRATION.md#5-how-it-works-in-space)).

## Before real use

1. A formal threat model and security review; signed configuration; device identity for each sensor.
2. Keys in a hardware secure element, not on the same disk as the data.
3. Clinical safety assessment: software giving medical guidance is likely to be regulated as a medical device or
   clinical decision support.
4. Replace the cloud services with on-board models, or agree data-processing terms with each provider.

## Reporting a problem

Tell the team privately (not in a public issue), with steps to reproduce. **Never include `.env` contents or keys.**
