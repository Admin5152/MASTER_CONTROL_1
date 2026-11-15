# Sentinel: how it works, how it would plug into NASA systems, and how it runs in space

This document is for engineers and reviewers who want to know what Sentinel does today, where a real suit, wearable
or vehicle system would connect, and what has to be true for it to work on a mission.

Three labels are used throughout, the same ones the app shows:

- **LIVE**: measured or computed now, in this build.
- **SIM**: a simulator or prepared data stands in for the real thing.
- **DESIGNED**: a design. It does not run in this build.

Sentinel is a hackathon build. It is designed around NASA's published material. It does not implement or claim
compliance with any NASA standard, it is not a medical device, and it does not diagnose.

## 1. What Sentinel is

Sentinel is a crew-health companion that runs on a device inside the vehicle. It watches a small set of readings
per crew member, compares them with reference ranges and with that person's own normal, explains any change in
plain words, walks the crew member through sourced steps, and packages what happened for the flight surgeon.

It is built for the case NASA calls Earth-Independent Medical Operations: on a Mars transit a message takes many
minutes each way and there is no quick return, so the first response has to happen on board.

## 2. How it works

Everything is a reading. A reading goes through the same stages whatever produced it.

```
 Devices and people                 On the device, offline                         Out
 ---------------------------        ------------------------------------------     ---------------------------
 Camera (pulse, breathing)   --+
 Microphone (speech, tone)   --+    check -> label -> store -> my normal ->       Screen, voice, sound
 Typed or spoken entries     --+--> assess (ranges, change, trend, pattern) ->    Reminders and rechecks
 Watch, chest hub, patch     --+    decide (level, protocol, kit) -> present      Buddy and commander notices
 EVA suit telemetry          --+                                                   Digest queue to ground
 Cabin air sensors           --+    environment profile + sourced protocols        (store and forward)
```

| Stage | What happens | Where in the code |
| --- | --- | --- |
| Check | A value outside what a body or a sensor can produce is refused and a remeasure is asked for | `brain/core/devices.py`, `brain/core/pipeline.py` |
| Label | Every reading carries its source, LIVE / MANUAL / SIM, and a confidence from 0 to 1 | `brain/core/store.py` |
| Store | Kept on the device, encrypted at rest; survives a restart | `brain/core/store.py`, `brain/core/vault.py` |
| My normal | A median and spread per person per reading, from their own history | `Store.learn_baselines` |
| Assess | Reference ranges, change from my normal, trend, and two or more independent signals moving together | `brain/rules/thresholds.py`, `brain/rules/drift.py`, `brain/rules/indicators.py` |
| Decide | An urgency level 0 to 3, a protocol, a kit item filtered by the person's allergies | `brain/rules/decision.py`, `brain/clinical/care.py`, `brain/clinical/protocols.py` |
| Present | Screen, voice and sound by level; quiet hours respected | `app/js/` |
| Escalate | Alerts follow through; the buddy is told; a text digest is queued for ground | `brain/clinical/alerts.py`, `brain/crew/notify.py`, `brain/mission/ground.py` |

Rules that do not bend:

- **Level 3 never comes from statistics alone.** It comes from a range limit, a red-flag symptom or a cabin limit.
- **Decisions come from rules and statistics, not from the language model.** The model, when one is connected,
  only phrases what the rules decided. With no model Sentinel still works.
- **A weak signal cannot raise an alert on its own.** A low-confidence camera pulse is shown as an estimate.
- **Mission emergency procedures come first.** Sentinel alerts and reads steps; it does not replace them.

## 3. One door for every device

A suit, a watch and the camera all hand over readings the same way. This is the integration point.

```
POST /api/device/{crew_id}
{
  "device": "watch",
  "readings": [ { "metric": "heart_rate", "value": 74, "confidence": 0.95 },
                { "metric": "spo2", "value": 97 } ],
  "sim": false
}
```

- Each device may only report the metrics it measures. A watch cannot report cabin CO2.
- A value outside the sensor's possible range is refused as a fault and never stored.
- `"sim": true` labels the readings SIM. A real device leaves it out and is labelled LIVE. The label follows the
  reading into every screen, chart and digest.
- Accepted readings enter the same pipeline as a typed entry: ranges, my normal, alerts, the record.
- `GET /api/devices/{crew_id}` lists every device, whether it is sending now, and what it last reported. The
  assistant reads the same list, so "which devices are connected?" gets a true answer.

| Device | Reports | State in this build |
| --- | --- | --- |
| Camera | Pulse and breathing estimates, expression | LIVE. A 15-second scan saves one result with its quality |
| Microphone | Speech, talk time, voice pitch, speaker recognition | LIVE |
| SpaceWear watch | Pulse, SpO2, skin temperature, movement, sleep | DESIGNED hardware; the interface runs and a simulator can drive it |
| SpaceWear chest hub | Pulse, breathing rate, temperature; bridge for the watch, patch and suit | DESIGNED hardware; interface runs |
| Sentinel Skin ultrasound patch | Heart motion, lung surface, optic nerve sheath, fluid shift | DESIGNED; shown as SIM on the body screen |
| EVA suit | Suit pressure, oxygen flow, CO2, the wearer's pulse | SIM. Telemetry sent through the interface replaces the built-in model while it is fresh |
| Cabin air sensors | Oxygen, carbon dioxide | SIM |

**The suit.** When suit telemetry arrives, Sentinel judges integrity from the measured pressure and how fast it is
changing. Falling pressure raises the suit alert with steps that can be ticked off, puts a notice in every
crewmate's inbox, and pauses routine reminders for the EVA. Telemetry cannot say where a leak is, so the steps
start with the gloves and the helmet seal. The alarm lines are demo placeholders, not flight rules.

**When two devices disagree.** A sensor reading and a camera estimate are both kept, each with its own label and
confidence. The latest accepted reading is the current value; the camera's lower confidence means it cannot raise
an alert alone. Choosing between sources by rule (for example, always prefer the chest hub) is not built.

## 4. How it would plug into NASA systems

None of the connections in this section exist. They are where Sentinel's existing seams would meet systems NASA
has described publicly. Interface details would have to come from NASA; nothing here has been checked against a
real interface specification.

| Sentinel seam | What it does today | What it would connect to |
| --- | --- | --- |
| Device interface (section 3) | Accepts readings over local HTTP | Crew-worn biomedical sensors and suit telemetry, delivered over the vehicle's own data network. The adapter is a small translator from the vehicle's message format to the reading shape above |
| Cabin feed | A simulator sets oxygen and CO2 | The vehicle's environmental control and life support data |
| Space-weather feed | NOAA proton flux when online, a saved snapshot offline, a storm replay from NASA DONKI | The mission's radiation operations feed and the crew's own dosimeters |
| Ground digest queue | A text digest, queued with a simulated one-way delay, urgent first when the link returns | A store-and-forward link to the flight surgeon's console. The queue already assumes the link can vanish |
| Ground replies | A reply card whose steps the astronaut confirms one by one | Flight surgeon instructions coming back up the same link |
| Thresholds, protocols, kit | JSON files with a source on every entry | Mission medical requirements, the flight surgeon's protocols and the actual kit manifest, reviewed and signed |
| Crew profile preload | A profile can be preloaded and confirmed by the astronaut | Preflight medical data, loaded by the flight surgeon with consent |
| The record | Per-crew readings on the device | NASA has described work toward one integrated crew-health data layer (CHP-IDA). Sentinel's reading shape is the unit that would be exported to it |

### 4.1 What is public today, and how each seam would meet it

Looked up on 2026-11-15 from public pages. For each row the middle columns are what the source says; the last
column is our proposal. We have not read any flight interface specification, and none of these adapters is built.

| Seam | Public source | What it shows | How Sentinel would connect |
| --- | --- | --- | --- |
| Suit telemetry | NASA SUITS challenge Telemetry Stream Server: [TSS_2024](https://github.com/SUITS-Techteam/TSS_2024), [SUITS_Test_TSS](https://github.com/SUITS-Techteam/SUITS_Test_TSS/blob/main/README.md) | NASA's student challenge publishes a telemetry server that simulates suit and EVA device state for teams' displays; the test version exposes a REST server and a WebSocket that clients read telemetry from | The nearest public stand-in for a suit link. An adapter would read the stream and post pressure, oxygen, CO2 and pulse to `/api/device/{crew}` as `suit`. It is a challenge simulator, not a flight suit, and we have not confirmed its message format |
| Worn biomedical sensors | Canadian Space Agency [Bio-Monitor](https://www.asc-csa.gc.ca/eng/sciences/bio-monitor.asp) (Astroskin); NASA analog test, [NTRS 20190001996](https://ntrs.nasa.gov/citations/20190001996) | A smart shirt, headband and tablet app for the ISS, measuring heart electrical activity, blood pressure, breathing rate and volume, skin temperature, blood oxygen and activity, built to send data to the ground through the station's communications | The same readings our `watch` and `chest_hub` entries accept. A real garment's tablet app, or its export, would post to the device interface. We found no public description of its data format |
| Medical data on board | NASA Exploration Medical Capability, Medical Data Architecture project: [NTRS 20200000568](https://ntrs.nasa.gov/citations/20200000568), [NTRS 20170009788](https://ntrs.nasa.gov/citations/20170009788) | NASA's own effort to capture, store, integrate and analyse medical data on exploration missions with little ground help; an early test bed did automated collection and retrieval for the crew medical officer, and a later prototype was meant to inform Gateway medical system requirements | This is the system Sentinel would sit beside or feed. Our reading (who, what, value, unit, source, label, confidence, time) is the record we would export. The papers are from 2016 to 2020; we do not know the project's current state |
| Link to ground | NASA Delay/Disruption Tolerant Networking: [NTRS 20100020137](https://ntrs.nasa.gov/citations/20100020137); [emulation study, arXiv 2605.21624](https://arxiv.org/pdf/2605.21624) | A store-and-forward network service for links with long delays and gaps: data is held at each node until the next hop is available, with custody transfer. Described as an operational service on the ISS since 2016; NASA's implementation is called ION | Sentinel's digest queue already behaves this way at the application level (hold, send urgent first, tolerate a lost link). In flight a digest would be handed to the vehicle's DTN service instead of being sent over HTTP |
| Cabin air | ISS Live public telemetry: [Lightstreamer and NASA](https://lightstreamer.com/customer-story/how-nasa-is-using-lightstreamer/), [example client](https://github.com/Lightstreamer/Lightstreamer-example-ISSLive-client-javascript) | A public real-time feed of ISS telemetry relayed from Mission Control, including the environmental console's readings; an open example client and community projects read it | A real data source for a station demo: an adapter would map the environmental items to `cabin` readings. We have not confirmed which item names carry oxygen and CO2 partial pressure |
| Space weather | NOAA Space Weather Prediction Center; NASA CCMC [DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI) | Proton flux and the S-scale from NOAA; DONKI lists solar energetic particle events, flares and CMEs | Already connected: live NOAA flux when online, a saved snapshot offline, DONKI events for the storm replay (`shared/SOURCES.md`). One secondary source says the DONKI web service address changed in September 2026; check it before relying on a live call |

Two of these can be tried by anyone without NASA access: the SUITS telemetry server for the suit seam, and the ISS
Live feed for the cabin seam. Neither adapter is written yet; each is a small translator into the reading shape in
section 3.

### 4.2 What is already in the repository

What the team has already taken from NASA sources, and where it is used:

- **68 NASA JSC 28913 Medical Requirements Integration Documents**, parsed in `shared/nasa_mrid.json`. They inform
  which readings are tracked and are cited on the Evidence screen.
- **691 human research datasets** from the NASA Life Sciences Portal, catalogued in `shared/nlsp_catalog.json` by
  `tools/nlsp_fetch.py`. They are context and citations. Only the catalogue was fetched, not the data files.
- **Reference ranges and limits** in `shared/thresholds.json`, each with a source and marked as a NASA figure, a
  clinical reference or a demo placeholder.

What would be needed before a real connection:

1. NASA's interface definitions for suit and biomedical telemetry, and for the cabin and radiation feeds.
2. Clinician review of every protocol, range and line of wellbeing wording. Six step lists and the exercise
   split in this build are general first-aid defaults with no NASA source; the app marks them as such.
3. A regulatory and clinical safety assessment. Software that gives medical guidance is likely to be treated as a
   medical device or clinical decision support.
4. Security work: signed configuration, device identity, key storage in the vehicle rather than on the same disk.

## 5. How it works in space

| Condition in flight | What Sentinel does about it |
| --- | --- |
| No network | Everything runs on the device. No cloud service is required for any decision |
| Minutes of delay each way | It acts on board first, then queues a text digest. The card shows when the question was sent and how old a reply is, so stale advice is visible |
| Link lost | Digests wait in the queue and leave when the link returns, urgent ones first |
| No quick return | The environment profile sets how long a problem can wait for ground. In transit Sentinel carries more of the response itself; on a station it escalates sooner |
| Gloves, motion, low light | Large targets, a glove mode, dark theme, status never by colour alone, voice first |
| Hands busy | A symptom, a reading or an answer can be spoken: "my stomach is not well", "my heart rate is 72", "done", "it's worse" |
| An EVA | Suit pressure is watched, routine reminders pause, and the crew inside are told of a problem |
| Sleep | Quiet hours: only urgent and cabin alerts break through |
| A new environment | Small changes from your normal are treated as settling in for the first days. Range limits, cabin air and red flags stay at full strength |
| Someone needs help | Their chosen buddy, and the commander if they allow it, find a notice waiting and hear it when they reach the screen. It says help is needed, never what the readings are |
| Privacy in a small crew | Health data stays with its owner. A crewmate sees urgent and cabin alerts only |
| Power or restart | The record, alerts, reminders, care log and notices are on disk and come back |

What changes between environments is data, not code: `shared/environments/` holds a profile each for station,
transit, surface base and critical phases, with its own escalation policy, wait tolerance and protocol variants.

## 6. What is real, what is simulated, what is only designed

| Area | State |
| --- | --- |
| Decision pipeline, alerts, triage, protocols runner, reminders, care log, notifications | LIVE in this build |
| Typed and spoken entries, the saved record, personal baselines | LIVE |
| Camera pulse and breathing, expression, voice, speaker recognition | LIVE, as estimates. Not validated against medical devices |
| Device interface | LIVE as software. No real watch, chest hub or suit has been connected to it |
| Suit, cabin air, wearable patch readings, ground link and delay | SIM |
| Wearable hardware, ground portal, mission configuration studio | DESIGNED |
| Six step lists and the exercise split | Demo defaults, not clinician-reviewed |
| The six crew profiles | Invented demo values |

## 7. Try it

```powershell
# start
.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
```

In the app, open the menu and choose **Devices** to see what is connected and send simulated readings from the
watch, chest hub, suit and cabin sensors.

Checks: `pytest -q`, `node --test tests/js`, and `tests/browser/clinic_ui_check.py` against a clean server.
Status by requirement: `docs/checklists/CHECKLIST_PART4_5_UI_INTEGRATION.md`. Sources: `shared/SOURCES.md`.
