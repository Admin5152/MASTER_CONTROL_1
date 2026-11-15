# API reference

Sentinel's server (`server.py`, FastAPI) serves the app and a JSON API on one port:

| How you run it | Base URL |
| --- | --- |
| `run.ps1` (default, HTTPS, laptop and tablet) | `https://localhost:8443` (tablet: `https://<laptop-ip>:8443`) |
| `run.ps1 -Http` (laptop only) | `http://127.0.0.1:8000` |

FastAPI also publishes an interactive explorer of every endpoint at **`/docs`** (Swagger UI) and the raw schema at
**`/openapi.json`** while the server runs.

## Conventions

- **JSON in, JSON out**, except speech: `POST /api/stt` takes a WAV body and `POST /api/tts` returns audio.
- **`{cid}`** is a crew member's id, e.g. `james` (shown on screen as Eliah). `GET /api/crew` lists them.
- **Labels.** Readings carry a `label` (`LIVE`, `MANUAL`, `SIM`, `DESIGNED`) and a `confidence` from 0 to 1. The label
  follows a value everywhere it is shown.
- **Errors** use HTTP status codes with `{"detail": "..."}`: `400` bad input, `401` not paired, `404` unknown crew
  member or item, `413` audio too long, `422` a patch with unknown fields, `503` a speech engine or service unavailable.
- **Pairing.** Requests from the laptop itself (`localhost`) are always allowed. Any other device (the tablet) must
  pair first with the PIN the server prints at start-up (also `GET /api/pin`, from the laptop only):

  ```http
  POST /api/pair
  {"pin": "652173"}
  ```

  The response sets an HTTP-only cookie (`sentinel_pair`, 12 hours) that authorises the device's later requests.
- **Every change is audited** to `data/audit.jsonl` (see [LOGS.md](LOGS.md)).

## The endpoints you will use most

### Health: is everything up?

```http
GET /api/health
```

```json
{
  "ok": true,
  "llm": true,
  "llm_model": "claude-sonnet-5-5",
  "tts": "elevenlabs",
  "stt": "groq",
  "claude": {"model": "claude-sonnet-5-5", "spent_usd": 0.0138, "budget_usd": 4.5, "turns": 2, "on": true, "last_error": ""},
  "speaker_id": true,
  "spaceweather": "noaa",
  "tablet_url": "https://192.168.137.1:8443/app/"
}
```

### Talk to the brain (streamed)

```http
POST /api/chat/stream
{"crew_id": "james", "transcript": "how far is the moon"}
```

The reply is **NDJSON**: one line per sentence as soon as it is written, then a final line.

```json
{"type": "sentence", "text": "About 384,000 kilometers on average.", "source": "llm"}
{"type": "final", "reply": "About 384,000 kilometers on average...", "commands": [], "source": "llm", "kind": "general"}
```

- `source`: `llm` (Claude, or Groq as the fallback), `rules` (the offline rules bank) or `safety` (the fixed safety
  script for an urgent wellbeing concern).
- `commands`: validated app commands the reply asked for, e.g. `{"cmd": "open_screen", "name": "vitals"}`.
- Health answers may only cite numbers that are in the crew member's record; a reply that breaks this is replaced
  by the rules reply.
- `POST /api/chat` is the same, non-streamed. `POST /api/chat/forget` clears the conversation memory.

### Speech in

```http
POST /api/stt?hint=names
Content-Type: audio/wav

<16 kHz mono WAV, one utterance, at most 20 s>
```

```json
{"text": "I'm Eliah", "source": "groq"}
```

`source` is `groq` (cloud Whisper) or `local` (Whisper on the laptop). `hint=names` biases recognition towards crew
names (used on the "who's here" screen).

### Speech out

```http
POST /api/tts
{"text": "Hello, I'm Sentinel.", "voice": "nathaniel"}
```

Returns audio (`audio/mpeg` from ElevenLabs, or `audio/wav` from Kokoro offline). Headers: `X-TTS-Source`
(`elevenlabs` or `kokoro`) and `X-TTS-Cached` (`true` when the line came from the disk cache and cost nothing).
`GET /api/voices` lists the voices (Nathaniel, Jon, Bri, Samara).

### State and readings

```http
GET  /api/state/{cid}                 the crew member's record (the contract object in shared/contract.json)
POST /api/state/{cid}/patch           {"manual": {"sleep_hours": 6.5}}   -> the updated record (422 on unknown fields)
POST /api/device/{cid}                readings from a device (below)
GET  /api/devices/{cid}               every device, whether it is sending, what it last reported
```

The device door, where a watch, chest hub, suit or cabin sensor plugs in:

```http
POST /api/device/{cid}
{
  "device": "watch",
  "readings": [{"metric": "heart_rate", "value": 74, "confidence": 0.95}, {"metric": "spo2", "value": 97}],
  "sim": false
}
```

A device may only report the metrics it measures; impossible values are refused as faults; `"sim": true` labels the
readings SIM.

### EVA and the suit (simulated)

```http
POST /api/suit/{cid}     {"action": "eva"}                                   start an EVA (returns the readiness check)
POST /api/suit/{cid}     {"action": "leak", "region": "left_glove", "size": "slow" | "leak" | "major"}
POST /api/suit/{cid}     {"action": "seal"}
POST /api/suit/{cid}     {"action": "iva"}                                   end the EVA
GET  /api/ops/{cid}/readiness                                                pulse, sleep, open alerts, cabin air, suit
```

Regions: `helmet`, `torso`, `backpack`, `left_glove`, `right_glove`, `left_arm`, `right_arm`, `left_leg`,
`right_leg`, `left_boot`, `right_boot`. A leak notifies every other crew member.

### Local languages (Khaya AI)

`/api/lang/*` and `/api/twi/*` are the same endpoints. The server forwards them to the Node service in
`services/twi/` (port 3001). Language codes: `twi`, `ewe`, `gaa` (Ga), `fat` (Fante), `dag` (Dagbani), `yor`
(Yoruba). Default `twi`. See [LANGUAGES.md](LANGUAGES.md).

```http
GET  /api/lang/languages
POST /api/lang/speak               {"text": "Drink some water and rest.", "lang": "ewe", "speaker": "female"}
POST /api/lang/listen?lang=ewe     <WAV body>
POST /api/lang/translate           {"text": "Me tirim yɛ me ya", "source": "twi", "target": "eng"}
GET  /api/lang/health
```

`speak` returns the translation and its audio:

```json
{"ok": true, "lang": "ewe", "eng_text": "Drink some water and rest.", "text": "No tsi aɖewo eye nàgbɔ ɖe eme.",
 "audio": "data:audio/wav;base64,...", "is_critical": false, "resting_until": null}
```

`listen` returns what was said and its English: `{"ok": true, "lang": "ewe", "text": "...", "eng_text": "..."}`.
When Khaya's call allowance is used up, `audio` is empty and `resting_until` says when it returns.

### Ground link (simulated delay)

```http
POST /api/ground/{cid}    {"kind": "note", "title": "Headache, day 3", "body": {"text": "..."}}
GET  /api/ground          {"one_way_min": 12.7, "transport": "SIM", "packets": [...]}
```

### Demo scenarios

```http
GET  /api/scenario                       the scenario names
POST /api/scenario/{name}?speed=1        run one (e.g. solar_storm); "reset" returns everyone to baseline
```

## Every endpoint

<!-- ROUTES:BEGIN -->

_150 endpoints, generated from `server.py` by `tools/gen_api_docs.py`. `{cid}` is a crew member's id (`GET /api/crew` lists them)._

### System and session

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/audit` | — |
| POST | `/api/audit` | The page's bus events, batched: [{"t", "event", "detail"}], plus counts of high-frequency telemetry. |
| POST | `/api/cabin` | — |
| GET | `/api/clock` | — |
| POST | `/api/clock` | — |
| GET | `/api/health` | — |
| POST | `/api/pair` | — |
| GET | `/api/pin` | The pairing PIN, for this laptop only (shown in the demo panel). |
| GET | `/api/scenario` | — |
| POST | `/api/scenario/{name}` | — |
| POST | `/api/warm` | The app calls this when it loads so the first spoken turn does not pay for cold connections. |

### Crew and state

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/assessment/{cid}` | — |
| GET | `/api/aux/{cid}` | Everything the screen needs besides the contract object, in one poll. |
| POST | `/api/context/{cid}` | Reading context: {"activity": "post_exercise"/"none", "minutes"} and/or {"hr_confidence": 0-1} (S4, S5). |
| GET | `/api/crew` | — |
| POST | `/api/crew` | Add a crew member. They start with a clean record and an empty profile, and every function works for them. |
| POST | `/api/crew/message` | Send a direct message from one crew member to another or to all crew. |
| GET | `/api/crew/messages` | Get recent crew intercom chat history. |
| GET | `/api/crew/{cid}/card` | What the crew may see about a crewmate on the shared map: where they are (SIM), their radiation exposure and shelter state, and whether they need help. No readings, no health background (section 28). |
| GET | `/api/history/{cid}` | — |
| POST | `/api/log/{cid}` | — |
| GET | `/api/record/{cid}` | Everything stored for this person: per field the count, how many were entered or measured, the newest value. |
| GET | `/api/state/{cid}` | — |
| POST | `/api/state/{cid}/patch` | — |

### Readings, devices and the pipeline

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/baselines/{cid}` | The personal baseline model: median, spread and calibration stage per indicator (19.2). |
| POST | `/api/baselines/{cid}/learn` | Re-fit "my normal" from the stored readings and use it. Surgeon-adjusted baselines are left alone. |
| POST | `/api/device/{cid}` | Readings from any device: {"device": "watch"/"chest_hub"/"suit"/"cabin"/"camera", "readings": [{"metric", "value", "confidence"}], "sim": false}. Each is checked against what that device may report, labelled LIVE (or SIM when a simulator sends it), and enters the same pipeline as a typed entry: ranges, baseline, alerts, the record. |
| GET | `/api/devices/{cid}` | Every device Sentinel can take readings from: connected or not, last heard, what it last reported. |
| GET | `/api/indicator/{cid}/{metric}` | Detailed view for one physiological reading with clinical facts, trends, and estimates (Section 16.1). |
| GET | `/api/indicators` | Tracked indicators catalog (Section 17: What We Track). All 22 indicators with independence groups, HRP risks, worse-when directions, and NASA MRID single source of truth citations. |
| GET | `/api/indicators/groups` | The 15 independence groups used for the Section 17 Group Rule. |
| GET | `/api/indicators/{indicator_id}` | Single indicator definition with NASA MRID single source of truth evidence. |
| POST | `/api/pattern/evaluate` | Evaluate Layer 4 pattern across signals per Section 17 Group Rule: 'Two indicators in the same group count as one signal. Two or more independent signal groups moving the wrong way inside one window raise a pattern flag.' |
| POST | `/api/pipeline/assess` | Evaluate 5 layers anomaly assessment on a metric (Section 19.2). |
| POST | `/api/pipeline/process` | Execute the full 9-stage Sentinel clinical intelligence pipeline (Section 19.1). |
| POST | `/api/pipeline/validate` | Validate a reading for sanity and plausible change (Section 19.1 Stage 2). |
| GET | `/api/pulse` | — |
| POST | `/api/pulse/{cid}` | — |
| POST | `/api/reading` | Generic endpoint accepting crew_id in body. |
| POST | `/api/reading/{cid}` | Ingest a validated reading into store and decision pipeline (INT-1, INT-2, SI1, SI2). Requires label ('LIVE'/'MANUAL'/'SIM'/'DESIGNED') and confidence (0.0-1.0). |
| POST | `/api/scan/{cid}` | Save the result of a finished scan (FR-1): the face scan's pulse, breathing and expression with their confidence, labelled LIVE estimate, or the body scan's flagged zones. The readings enter the same pipeline as any other (ranges, baseline, alerts); a low-confidence pulse is kept as an estimate and raises nothing alone. |
| GET | `/api/scans/{cid}` | — |
| POST | `/api/skin/{cid}` | Switch the Sentinel Skin SIM data source on or off for one crew member (demo only). |
| GET | `/api/trends/{cid}` | Multi-indicator trends, sleep vs reaction correlation, and data sufficiency flag (Section 16.1). |

### Brain and voice

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/card/rephrase` | Rephrase a recommendation card (FACE-7, FACE-9, SF4, SF7). |
| POST | `/api/chat` | — |
| POST | `/api/chat/forget` | — |
| POST | `/api/chat/stream` | NDJSON: one {"type":"sentence"} line per complete sentence as the LLM writes it, then {"type":"final"}. |
| POST | `/api/enrol/{cid}` | — |
| POST | `/api/face/emotion` | Cropped face image bytes -> {emotion, scores (8 emotions), valence, arousal, confidence, wording} (FACE-3, FACE-4). |
| POST | `/api/identify` | — |
| POST | `/api/stt` | 16 kHz WAV of one utterance -> {text, source: "groq" / "local"}. |
| POST | `/api/symptom/extract` | Voice symptom intake: LLM extracts fields (zone, symptom, onset, severity); astronaut confirms before recording. Deterministic clinical rules pick the protocol. |
| POST | `/api/tts` | {text, voice?, engine?} -> audio (mp3 from ElevenLabs or wav from Kokoro), cached on disk. |
| GET | `/api/voices` | — |

### Local languages (Khaya AI)

| Method | Path | What it does |
| --- | --- | --- |
| GET, POST | `/api/lang/{path:path}` | Local-language voice (Khaya AI): proxied to the Node service in services/twi on port 3001. /api/lang/* and /api/twi/* are the same endpoints (see docs/API.md). |
| GET, POST | `/api/twi/{path:path}` | Local-language voice (Khaya AI): proxied to the Node service in services/twi on port 3001. /api/lang/* and /api/twi/* are the same endpoints (see docs/API.md). |

### Alerts and notifications

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/alerts/{alert_id}/acknowledge` | Acknowledge alert when user has seen it (Section 19.4). |
| GET | `/api/alerts/{alert_id}/explain` | 'Why this?' plain-words explainability breakdown citing readings, baseline, and NASA MRID (Section 19.5). |
| POST | `/api/alerts/{alert_id}/feedback` | Record 'useful' or 'not useful' feedback to adapt rule sensitivity within bounds (Section 19.5). |
| POST | `/api/alerts/{alert_id}/snooze` | Snooze alert with reason and limit check (Section 19.5). Urgent level 3 alerts blocked. |
| GET | `/api/alerts/{cid}` | List active and historic alerts for a crew member. |
| POST | `/api/alerts/{cid}/acknowledge-open` | The banner's Acknowledge: every open alert at or above a level is marked seen. |
| POST | `/api/alerts/{cid}/tick` | Unanswered alerts: which to present again (louder), and which expired. A missed urgent alert alerts the buddy. |
| GET | `/api/notifications/{cid}` | This person's inbox: notices that a crewmate needs help, newest first. |
| POST | `/api/notifications/{cid}/clear` | — |
| POST | `/api/safety/{cid}` | W14 urgent wellbeing concern: alert the buddy and the commander (SIM) and queue an URGENT message for the flight surgeon or psychologist. Only the category travels, never the person's words. |

### Care, protocols and the clinic

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/care/log/{cid}` | Care history log for past symptoms, protocols, and kit usage (Section 16.1). |
| POST | `/api/care/protocol/start` | Start step-by-step clinical protocol runner with timers and checklist (Section 16.1). |
| GET | `/api/care/protocol/{run_id}` | Get active protocol run status. |
| POST | `/api/care/protocol/{run_id}/complete` | Complete protocol run and record outcome in Care Log. |
| POST | `/api/care/protocol/{run_id}/escalate` | Escalate protocol run to flight surgeon. |
| POST | `/api/care/protocol/{run_id}/pause` | Pause active protocol run. |
| POST | `/api/care/protocol/{run_id}/resume` | Resume paused protocol run. |
| POST | `/api/care/protocol/{run_id}/step` | Advance or check off step in active protocol run (Section 16.1). |
| POST | `/api/care/recommendation` | Generate structured Section 19.3 Recommendation Card (seen, sure, now, use, recheck, escalate_if, why). |
| GET | `/api/care/triage/questions` | Structured triage questions per body zone (Section 16.1). |
| POST | `/api/care/triage/{cid}` | Evaluate triage inputs, check for red flags, and determine protocol (Section 16.1). |
| GET | `/api/clinic/protocol/{situation}` | Protocol variants per environment and mode (Section 13.3 & 13.5). |
| GET | `/api/clinic/{cid}` | Clinical mode (12.1) and current day time block (12.2). |
| POST | `/api/clinic/{cid}/block` | Execute actions for clinical time blocks (wake, exercise, winddown, etc.). |
| POST | `/api/clinic/{cid}/checkin` | Morning daily check-in (Section 12.2 & 14.1). |
| GET | `/api/clinic/{cid}/weekly` | Weekly review summary, adherence, and countermeasures for surgeon (12.2). |
| GET | `/api/exercise/{cid}` | The exercise countermeasure made specific: device, minutes and how; today's sessions and total. |
| DELETE | `/api/eyes/{cid}` | — |
| GET | `/api/eyes/{cid}` | — |
| POST | `/api/eyes/{cid}` | — |
| POST | `/api/kit/filter` | Evaluate filterKit(kitItems, profile) per Section 19.5. Returns allowed items, blocked items with reasons, and notes. |
| GET | `/api/plan/{cid}` | Today's reminders list, schedule template, and schedule conflict detection (Section 16.1). |
| POST | `/api/plan/{cid}/complete` | Mark a reminder done (Section 16.1). |
| POST | `/api/plan/{cid}/expand-7days` | Step 1: On profile load, expand the schedule template into reminders for the next seven days. |
| POST | `/api/plan/{cid}/miss` | Steps 4 & 5: Handle missed reminder, soft prompt re-presentation, and consecutive miss digest alert. |
| POST | `/api/plan/{cid}/recheck` | Step 6: Accepting a recommendation creates a recheck reminder at now plus recheckAfterMin. |
| POST | `/api/plan/{cid}/reminder` | Add a custom reminder (Section 16.1 & 25.1). |
| POST | `/api/plan/{cid}/snooze` | Snooze a reminder by N minutes (Section 16.1). |
| POST | `/api/plan/{cid}/tick` | Steps 2 & 3: One-minute tick moves due reminders to 'due' and respects sleep and EVA blocks. |
| GET | `/api/protocols` | List all 10 clinical protocols with NASA MRID grounding and verification status (Section 19.4). |
| GET | `/api/protocols/{protocol_id}` | Get single clinical protocol with environment and mode variants (Section 19.4 & 19.5). |
| GET | `/api/records/{cid}` | Get all non-reading records for a crew member. |
| GET | `/api/records/{cid}/{record_type}` | Get non-reading records of a specific type. |
| POST | `/api/records/{cid}/{record_type}` | Add a non-reading record (Section 17): symptoms, protocol runs, kit usage, alert feedback, schedule context, data-quality scores, mood tags, journal entries, crew pulse, audit log. |

### Mission, EVA and ground

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/digest/{cid}` | — |
| POST | `/api/digest/{cid}` | Build the digest (section 21) and queue it for the flight surgeon; a blackout holds it until the link returns. |
| GET | `/api/environment/match` | What a spoken place means: {"env"} to confirm, {"ask"} to clarify, or null (section 13.1). |
| GET | `/api/environment/profile/{name}` | Specific environment profile config (Section 13.4). |
| GET | `/api/environment/profiles` | Environment profiles, wait tolerances, and modes (Section 13.2 & 13.4). |
| POST | `/api/environment/{cid}` | A CONFIRMED switch (the page asks first): reload, settle in, recompute; returns the banner of changes. |
| GET | `/api/ground` | — |
| POST | `/api/ground/{cid}` | Queue a packet for ground (SIM transport: store-and-forward with the one-way delay). |
| GET | `/api/ground/{cid}/delay-simulator` | Delay simulator split-screen view (Section 21). Left: 'what ground sees' (stale status and countdown) Right: 'what Sentinel did just now' (tagged onboard or escalated) |
| POST | `/api/ground/{packet_id}/acknowledge` | Acknowledge ground packet (Section 21 queue state: acknowledged). |
| POST | `/api/ground/{packet_id}/confirm-step` | Astronaut confirms each step on the Ground card before it is logged (Section 21). |
| POST | `/api/ground/{packet_id}/reply` | Ground reply appears as a Ground card with instructions (Section 21). |
| POST | `/api/ops/{cid}` | Mission mode {"mode": routine/eva/rest/contingency} and the SIM link {"blackout_min": n} (0 ends it). |
| GET | `/api/ops/{cid}/readiness` | — |
| GET | `/api/radiation/events` | — |
| GET | `/api/spaceweather` | — |
| POST | `/api/suit/{cid}` | SIM suit telemetry: {"action": "eva" / "iva" / "leak" / "seal", "region": ..., "size": "slow" / "leak" / "major"}. |

### Profile and onboarding

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/onboarding/{cid}` | Onboarding first run status, checklist, and resumable step (Section 16.1). |
| POST | `/api/onboarding/{cid}/step` | Advance resumable onboarding step (Section 16.1). |
| DELETE | `/api/profile/{cid}` | — |
| GET | `/api/profile/{cid}` | The personal health profile (section 14): viewable and exportable at any time. |
| PATCH | `/api/profile/{cid}` | — |
| POST | `/api/profile/{cid}/baseline` | Surgeon adjusts personal baseline indicator (Section 14.4). |
| POST | `/api/profile/{cid}/confirm` | Astronaut confirms preloaded profile (Section 14.1). |
| GET | `/api/profile/{cid}/export` | Export the personal health profile (Section 14.4). Sensitive fields redacted if sensitive=False. |
| POST | `/api/profile/{cid}/preload` | Preload profile by flight surgeon or mission planner (Section 14.1). |

### Wellbeing and crew comms

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/messages/{cid}/conversation/{other_cid}` | Fetch message history for conversation between `cid` and `other_cid`. |
| GET | `/api/messages/{cid}/conversations` | List all conversation threads for crew member `cid`. |
| POST | `/api/messages/{cid}/read/{other_cid}` | Mark all unread messages received by `cid` from `other_cid` as read. |
| GET | `/api/messages/{cid}/unread` | Get total unread message count for crew member `cid`. |
| POST | `/api/messages/{from_cid}/send` | Send a direct message from `from_cid` to another crew member. |
| POST | `/api/race/room` | Slipstream multiplayer: create a room; the creator is the host. |
| POST | `/api/race/room/{code}/join` | — |
| POST | `/api/race/room/{code}/leave` | — |
| POST | `/api/race/room/{code}/start` | — |
| POST | `/api/race/room/{code}/state` | Post my position, get everyone's (about ten times a second). |
| GET | `/api/wellbeing/scales` | Clinician-approved brief psychological screening scales (Section 15.3 & FR-50). |
| GET | `/api/wellbeing/team/cohesion` | Team communication balance and cohesion note (Section 15.7, Inadequate Teamwork risk). |
| GET | `/api/wellbeing/toolkit` | Support toolkit activities with mechanisms, triggers, and evidence (Section 15.5). |
| GET | `/api/wellbeing/{cid}` | Four-dimensional mental wellbeing assessment (Section 15.2 & 15.4). |
| GET | `/api/wellbeing/{cid}/journal` | List on-device private journal entries (Section 15.5 & 15.7, FR-47). |
| POST | `/api/wellbeing/{cid}/journal` | Create encrypted on-device private journal entry (Section 15.5 & 15.7, FR-47). |
| DELETE | `/api/wellbeing/{cid}/journal/{entry_id}` | Delete an on-device private journal entry (Section 15.7). |
| GET | `/api/wellbeing/{cid}/ranking` | Personalized tool ranking based on empirical closed-loop efficacy (Section 15.6, FR-45). |
| POST | `/api/wellbeing/{cid}/session` | Record intervention session before/after scores for closed-loop learning (Section 15.6, FR-45). |
| POST | `/api/wellbeing/{cid}/spike` | W13 Stress spike: Ask strength (1 to 5), offer Orb Calm or breathing, recheck in minutes. |

### NASA dataset

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/dataset/mrid` | Authoritative NASA JSC 28913 MRID dataset single source of truth (68 documents). |
| GET | `/api/dataset/mrid/{mrid_id}` | Retrieve specific NASA MRID document by ID from dataset single source of truth. |
| GET | `/api/dataset/verify` | Verify that every tracked indicator is grounded in NASA MRIDs and all thresholds have kind and source citations with zero invented limits (Section 17). |

<!-- ROUTES:END -->
