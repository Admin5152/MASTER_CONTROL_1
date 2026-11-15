# Logs, monitoring and troubleshooting

Sentinel keeps three kinds of record:

1. **The server window**: what is happening right now.
2. **The audit log** (`data/audit.jsonl`): what happened, kept on the device.
3. **The health endpoint and usage meters**: whether each service is up and what it has cost.

## 1. The server window

`run.ps1` prints the addresses and the pairing PIN, then one line per request and tagged lines for the events that
matter:

```
  LAPTOP:  https://localhost:8443/app/
  TABLET:  https://192.168.137.1:8443/app/
  Twi voice service started on port 3001.
[sentinel] tablet pairing PIN: 652173
INFO:     127.0.0.1:57705 - "POST /api/stt HTTP/1.1" 200 OK
[sentinel heard] (groq) 'start an EVA'
```

| Tag | Source | Means |
| --- | --- | --- |
| `[sentinel]` | `server.py` | Start-up: the pairing PIN |
| `[sentinel heard] (groq\|local) '...'` | `POST /api/stt` | Exactly what speech recognition heard. **Start here when a voice command "did nothing"**: if the words are wrong, it is a hearing problem; if they are right, the command was not recognised |
| `[sentinel brain] ...` | `brain/ai/llm.py`, `claude.py` | A model refused or failed (rate limit, no credit, outage) and which one answers instead, for how long |
| `[sentinel voice] ...` | `brain/ai/speech.py` | ElevenLabs failed or was retried; Kokoro answered instead |
| `[sentinel face] ...` | `brain/ai/llm.py` | The expression model loaded, or why not |
| `[khaya] ...` | `services/twi/khaya.js` (minimised Node window) | A Khaya key was refused or ran out of allowance, and until when it rests |
| `[twi speak]`, `[twi route]` | `services/twi/routes/twi.js` | A translation or speech call failed and the fallback was used |
| `[sentinel-twi]` | `services/twi/server.js` | The local-language service started (port 3001) |

The local-language service runs in its own **minimised Node window**; its `[khaya]` lines appear there.

## 2. The audit log: `data/audit.jsonl`

One JSON object per line, newest last, kept to the newest 5,000 lines:

```json
{"t": 1794686904.267, "src": "page", "event": "crew:changed", "crew": "james", "detail": "james"}
{"t": 1794687001.512, "src": "brain", "event": "reading.patched", "crew": "james", "detail": {"fields": ["vitals.heart_rate"], "action": "flag_drift", "severity": "watch", "zone": "heart"}}
```

| Field | Meaning |
| --- | --- |
| `t` | Unix time in seconds |
| `src` | `page` (the app, batched every 5 s by `POST /api/audit`) or `brain` (the server) |
| `event` | What happened (below) |
| `crew` | The crew member's id, or `null` |
| `detail` | Event data. **Readings are logged by field name, never with health background** |

Common events:

| Event | From | Meaning |
| --- | --- | --- |
| `boot`, `online`, `crew:changed` | page | The app started, reconnected, or switched crew member |
| `voice:capture`, `voice:sentence`, `voice:speaking-start/end`, `voice:interrupt`, `voice.command` | page | The voice loop: heard, answered, spoke, was interrupted, ran a command |
| `stage`, `screen:open`, `screen:close` | page | Navigation |
| `body:zone`, `body:isolate`, `body.scan.complete` | page | The 3D body |
| `reading.added`, `reminder.due`, `vision:emotion` | page | A reading, a reminder, an expression reading (when opted in) |
| `telemetry.counts` | page | Counts of high-frequency events (kept as counts, not one line each) |
| `reading.patched` | brain | A reading changed the record, and the decision it led to |
| `suit.eva`, `suit.leak`, `suit.seal`, `notify.crew` | brain | EVA actions, and the crew being told |
| `pair.accepted`, `pair.refused` | brain | A device paired, or a wrong PIN was tried |
| `demo.reset` | brain | The demo was reset to baseline |

Read it from the app (**Menu → Audit**), from the API (`GET /api/audit`), or directly:

```powershell
Get-Content data\audit.jsonl -Tail 20                       # the newest 20 events
Select-String -Path data\audit.jsonl -Pattern '"suit\.'     # every suit event
```

## 3. Health and usage meters

```http
GET /api/health          brain model, speech engines, Claude spending, speaker ID, space weather, tablet URL
GET /api/lang/health     Khaya: languages available, or "resting_until" when the allowance is used up
```

| Meter | Where | Stop |
| --- | --- | --- |
| Claude spending | `data/claude_usage.json`, and `claude` in `/api/health` | `CLAUDE_BUDGET_USD` (default $4.50), then Groq answers |
| ElevenLabs characters | `data/tts_usage.json` | `ELEVENLABS_CHAR_BUDGET`, then Kokoro speaks |
| Khaya allowance | `resting_until` in `/api/lang/health`, and Settings → Language | Set by the Khaya plan; Sentinel rests the key until it returns |

## Troubleshooting

| Symptom | Look at | Usual cause and fix |
| --- | --- | --- |
| Tablet does not open the page | The tablet's browser | Laptop and tablet on different networks, or campus Wi-Fi blocking devices from each other. Use the laptop's **Mobile hotspot** and `https://192.168.137.1:8443/app/`; allow Python through Windows Firewall (Private) |
| Tablet says "wrong PIN" | The server window | The PIN changes at every start; use the newest `[sentinel] tablet pairing PIN` |
| A voice command did nothing | `[sentinel heard]` | Misheard: speak closer, or use push to talk (Settings). Heard right but no action: the phrase is not recognised yet (`app/js/core/intents.js`) |
| "Voice unavailable", or the browser voice speaks | `[sentinel voice]` | ElevenLabs timed out or the character budget is spent; Kokoro or the browser voice takes over. Check `ELEVENLABS_API_KEY` and `data/tts_usage.json` |
| General questions get "I can't reach my knowledge" | `[sentinel brain]`, `/api/health` | No model reachable: check `ANTHROPIC_API_KEY` or `LLM_API_KEY`, the Claude budget, and the network |
| Twi or Ewe replies are spoken in English | `/api/lang/health` | Khaya allowance used up (`resting_until`), Node not installed, or keys missing ([LANGUAGES.md](LANGUAGES.md)) |
| "Port 8443 was in use" | The server window | An old server was still running; `run.ps1` stops it and restarts. Nothing to do |
| The page shows old behaviour after an update | — | Refresh the page; on the tablet, pull down in Chrome |
| Something is wrong and you need a clean demo | — | Demo panel (**D**) → reset, or `POST /api/scenario/reset` |

When reporting a problem, include the `[sentinel ...]` lines around it, the output of `GET /api/health`, and the last
lines of `data/audit.jsonl`. **Never paste `.env` or API keys.**
