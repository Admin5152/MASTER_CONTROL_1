# Sentinel: Master Product and Build Document (v5)

**NASA Space Apps Challenge 2026 · Challenge: "Create Health Monitoring Software for Astronauts on Space Missions" · Nov 14, 2026 · @mistarstudio**

## 0. How to use this document

This is the single source of truth for Sentinel: the product, the six feature modules each person builds, the shared contracts that let them merge, and the SaaS platform it grows into. If something here is wrong, fix it here first, then tell the team. It replaces the earlier handbook, build plan, product spec, PRD and developer guide, and keeps every v4 rule, schema and test.

### What changed from v4

- **Feature-based ownership.** The build is split into six vertical feature modules, one per person. Each module has its own scope, files, events, schemas, tasks, tests and done criteria, so people work in parallel and merge through the event bus (section 4).
- **Radiation is now a module.** v4 listed radiation as out of scope. v5 adds an awareness and response layer (space-weather alerts, exposure tracking from simulated data, shelter guidance). It still does not measure dose, and everything it shows is labelled SIM or DESIGNED (section 6).
- **Lonely games is a module.** One person owns all the anti-loneliness and wellbeing experience tools: Orb Calm, Space Race, Greenhouse, Earth Window, ambient sound, and connection nudges (section 10).
- **Dataset and integration is a module.** One person owns seed data, the anomaly engine wiring, and merging the other five modules (section 11).
- **Platform framing.** Each module is also a product feature of the SaaS platform, so the same split serves the hackathon and the business (section 29).
- **NASA dataset folder.** 94 NASA Medical Requirements Integration Documents (MRIDs, 68 unique) are catalogued in `dataset/_catalog.json` with per-person ownership assignments (section 5.2 and section 11.2).

### Where to read

| If you are                               | Read                                              |
| ---------------------------------------- | ------------------------------------------------- |
| A judge or stakeholder                   | Sections 1, 2, 3, 4, 23, 32                       |
| Product or design                        | Sections 1 to 5, 12 to 16                         |
| Person 1 (Radiation Awareness)           | Sections 4, 5, 6, 17, 23, 32                      |
| Person 2 (Body Model & Zones)            | Sections 4, 5, 7, 17, 23, 32                      |
| Person 3 (Face, AI Model & Voice)        | Sections 4, 5, 8, 17, 23, 32                      |
| Person 4 (Vitals & Check-in)             | Sections 4, 5, 9, 17, 23, 32                      |
| Person 5 (Lonely Games & Wellbeing)      | Sections 4, 5, 10, 15, 23, 32                     |
| Person 6 (Dataset, Integration & Engine) | Sections 4, 5, 11, 17, 18, 19, 23, 24, 25, 31, 32 |
| Thinking about the platform or business  | Section 29                                        |

**Contents.** Part 1 Product Strategy (1 to 3) · Part 2 Team & Ownership Architecture (4 to 5) · Part 3 Feature Modules (6 to 11) · Part 4 Clinical Experience & Workflows (12 to 16) · Part 5 Clinical Intelligence & Detection (17 to 22) · Part 6 Master Requirements (23) · Part 7 System Architecture & Data (24 to 28) · Part 8 SaaS Platform (29) · Part 9 Build, Testing & Delivery (30 to 33)

# Part 1: Product Strategy

## 1. Product Overview

### 1.1 What Sentinel is

Sentinel is a health-monitoring and guidance application for astronauts on long missions. It is an **onboard clinic**: it gathers health indicators, compares them with the person's own baseline and their environment, spots abnormal changes, tells the astronaut what to do next, reminds them to measure and treat, supports their mental wellbeing, and prepares a handoff for the flight surgeon. It runs entirely on the device, with no link to Earth required.

### 1.2 The problem

NASA's Human Research Program has mapped five hazards of human spaceflight: space radiation, isolation and confinement, distance from Earth, gravity fields, and hostile or closed environments. The challenge brief says astronauts carry much of the responsibility for spotting changes in themselves on long missions, and NASA notes that instructions, supplies and medical care become harder to get from Earth the deeper crews travel. Today's tools log data or depend on ground analysis; none of them helps at 3 a.m. when something feels wrong and the link is down.

### 1.3 Positioning

For crew who must look after their own health far from a hospital, Sentinel is an onboard clinic. Unlike a data logger it tells you what to do; unlike telemedicine it works with no link; unlike a generic health app it judges every reading against your own baseline and your environment.

### 1.4 Problems it solves

| #   | Issue                                                  | How Sentinel solves it                                                       |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | No doctor nearby; the astronaut must self-assess       | Guided check-in, triage and step-by-step protocols                           |
| 2   | Link to Earth is delayed or absent                     | Offline-first; digests queue and send when a link opens                      |
| 3   | A normal range misses what is abnormal for this person | Personal baselines (median and spread)                                       |
| 4   | Sensors (webcam pulse, face reading) are noisy         | Confidence on every reading; low confidence cannot alert alone               |
| 5   | Constant alarms make people ignore the tool            | Group related signals, cooldowns, feedback tuning                            |
| 6   | AI advice can be wrong or unsafe                       | Rules and sourced protocols decide; the language model only rephrases        |
| 7   | People forget routine measurements and follow-ups      | Scheduled and adaptive reminders, automatic recheck                          |
| 8   | Missions differ (station, transit, base, EVA)          | Environment profiles change ranges, kit, schedule and escalation             |
| 9   | Mental and behavioral changes are hard to see          | Mood, energy, stress and connection signals against baseline; support tools  |
| 10  | A black box is hard to trust                           | Every alert has a "Why this?" trace                                          |
| 11  | Radiation events need fast, correct crew action        | Space-weather and exposure awareness with shelter guidance (SIM in the demo) |

### 1.5 Goals and non-goals

**Goals:** make the astronaut able to assess and act on their own health; catch problems early; keep working with no link; support mental wellbeing; make the radiation environment visible and actionable; hand off to the ground with context.

**Non-goals:**

- It does not diagnose or replace the flight surgeon or mission medical procedures.
- It does not measure radiation dose and does not replace mission dosimetry or radiation operations. It shows simulated or supplied exposure data, labelled as such (changed from v4, which excluded radiation entirely).
- It does not cover bone, immune or decompression risks.
- It is not a surveillance tool for command; the astronaut owns the data.
- It does not need the cloud.

### 1.6 Principles and north-star metric

The astronaut decides and Sentinel advises; never diagnose; explain every status in plain words; work fully offline; keep data on the device; label every value; when unsure, escalate.

**North-star metric:** median time from the first sign of a health change to the astronaut completing a correct first step.

### 1.7 Challenge checklist

| The challenge asks for                                                                 | Sentinel's answer                                                                                              | See      | Label                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------- |
| Gather health indicators (BP, heart rate, blood sugar, temperature, sleep hours, mood) | Camera for pulse and breathing; typed entry for BP, glucose, temperature, sleep; face and self-rating for mood | 11       | LIVE + MANUAL             |
| Input by keyboard, mouse or camera                                                     | All three                                                                                                      | 11       | LIVE                      |
| Visual tool; clickable human figure                                                    | Body figure; each zone opens its indicators                                                                    | 10       | LIVE                      |
| Colour coding at a glance                                                              | Green, amber, red chip per indicator, with icon and word                                                       | 10, 12   | LIVE                      |
| Dynamic charts over time                                                               | Trend per indicator with the person's baseline band                                                            | 10       | LIVE (history seeded SIM) |
| Guidance on treatments and health improvements                                         | Recommendation card, kit item, when to contact the flight surgeon                                              | 13       | LIVE                      |
| Simple instructions; don't assume astronauts know how to assess themselves             | "How to measure" and "Why it matters" on every indicator                                                       | 10, 19   | LIVE                      |
| Prompt for measurements as routine                                                     | Scheduled daily check-in and reminders                                                                         | 14       | LIVE                      |
| Gamification                                                                           | Orb Calm, reaction test, check-in streak                                                                       | 9, 10    | LIVE                      |
| Different environments                                                                 | Environment and mode selection                                                                                 | 7        | SIM (stretch)             |
| Understand how hazards affect health                                                   | Every indicator tagged to a hazard and an HRP risk; radiation module                                           | 5, 6, 11 | LIVE tags, SIM radiation  |

## 2. Users and Scenarios

| User                    | Role                                | Needs                                          | Worries                            | What Sentinel gives                                                     |
| ----------------------- | ----------------------------------- | ---------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Crew astronaut          | Primary; checks in, treats, decides | Fast status; clear next step; no busywork      | Being watched, false alarms        | Private dashboard, explained statuses, step-by-step care, reminders     |
| Crew buddy or commander | Backup                              | Know when a crewmate truly needs help          | Missing a real problem; over-reach | Alerts only for urgent and cabin events, plus what the astronaut shares |
| Flight surgeon (ground) | Advises, delayed                    | Context in one read; the question being asked  | Data floods; stale facts           | Short digest with trend, actions and the question                       |
| Mission planner         | Configures before flight            | Right ranges, kit and schedule per environment | Wrong defaults in flight           | Environment profiles, kit list, schedule templates                      |

## 3. What Makes Sentinel Unique, Honesty Rules & Evidence Base

### 3.1 What Makes Sentinel Unique

| #   | Difference                                                                                                    | Why it matters                               | How the demo shows it                                          |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| 1   | An **onboard clinic**, not a logger: it triages, tells you what to do and follows up                          | In space nobody else is nearby               | Triage, protocol, recheck                                      |
| 2   | **Environment-aware advice**: the same problem gets a different plan in a station, transit cabin, base or EVA | Help, return options and supplies differ     | Say "we're in the transit cabin" and watch the card change     |
| 3   | **Personal everything**: own baseline, personal profile, kit safety filter, "what helps me"                   | Generic ranges miss what is abnormal for you | An allergy blocks a kit item with a reason                     |
| 4   | **Mind and body in one loop**, mental wellbeing first-class                                                   | Isolation is a named NASA hazard             | Wellbeing drift opens a support flow                           |
| 5   | **Closed loop with biofeedback**: it acts, measures the result, learns what works for you                     | Most tools stop at a chart                   | Orb Calm settles as the real pulse falls                       |
| 6   | **Honest and explainable**: labels, confidence, "Why this?", rules decide                                     | Trust under delay and uncertainty            | Read the LIVE, MANUAL, SIM labels aloud                        |
| 7   | **A team layer with privacy**: crew pulse and cohesion notes without names                                    | Teamwork is a named NASA risk                | Crew view at team level only                                   |
| 8   | **Built for delay**: digests, store-and-forward, delay simulator                                              | Contact is late or absent                    | Split-screen ground link                                       |
| 9   | **Hazard awareness**: radiation and cabin air in the same clinic                                              | Hazards and health are linked                | Space-weather alert triggers shelter guidance and a crew check |
| 10  | **Earth spinoff**: offline, private, multilingual, phone and webcam                                           | Remote places face the same gap              | Closing slide (a plan, DESIGNED)                               |

| Capability               | Typical consumer wellness app | Ground-dependent telemedicine | Sensor data logger | Sentinel                             |
| ------------------------ | ----------------------------- | ----------------------------- | ------------------ | ------------------------------------ |
| Works with no link       | Sometimes                     | No                            | Yes                | Yes                                  |
| Personal baseline        | Basic                         | Clinician judgment            | Rarely             | Yes                                  |
| Environment-aware advice | No                            | Through the clinician         | No                 | Yes                                  |
| Tells you what to do     | Generic tips                  | Yes, once connected           | No                 | Yes, from sourced protocols          |
| Mental wellbeing support | Generic                       | Scheduled sessions            | No                 | Daily, personal, escalates to people |
| Explains each alert      | Rarely                        | Clinician explains            | No                 | Always                               |
| Team layer               | No                            | No                            | No                 | Yes, privacy-first                   |

The comparison characterizes categories, not any named product.

### 3.2 Honesty and Safety Rules

Every value is labelled **LIVE** (really measured now), **MANUAL** (typed in), **SIM** (simulated on purpose) or **DESIGNED** (a diagram or plan). Never imply SIM, MANUAL or DESIGNED is LIVE. Judges reward this, and it protects you under questioning.

The rules nobody breaks:

1. Every value carries a label and a confidence. The store rejects readings without them.
2. Sentinel never diagnoses. It reports change from baseline and suggests actions.
3. The language model never chooses a level, protocol or dose. Rules do.
4. A low-confidence reading cannot raise an alert alone.
5. Protocol text with no source is marked "unverified" and never shown as an instruction.
6. No video frames or audio are stored; only numbers.
7. Everything works offline. The language model has a scripted fallback.
8. Schemas change only by editing this document and telling the team.
9. When unsure, escalate rather than reassure.
10. Sentinel never presents a simulated or estimated radiation exposure as a measured dose. Every radiation value is labelled SIM in the demo.
11. Radiation guidance defers to the mission's radiation procedures and the radiation operations team. Sentinel provides awareness and suggests shelter; it does not set dose limits or clear crew for EVA.

Webcam pulse and expression reading are noisy: show them as estimates with a confidence indicator.

### 3.3 NASA Evidence Base

Risk names below are from the NASA Human Research Program (HRP) risks page. HRP's five hazards: space radiation, isolation and confinement, distance from Earth, gravity fields, hostile or closed environments.

| HRP risk (exact name)                                         | Hazard                              | Sentinel feature                                                                                      | Status                                       |
| ------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Risk of Behavioral Changes and Psychiatric Disorders          | Isolation and confinement, distance | Mood, energy, stress, connection against baseline; support tools                                      | LIVE                                         |
| Risk of Inadequate Teamwork                                   | Isolation and confinement           | Talk-time and withdrawal tracking, crew pulse                                                         | LIVE (speaker ID)                            |
| Risk of Inadequate Sleep and Irregular Schedules              | Isolation and confinement           | Sleep hours, reaction time, daily check-in                                                            | MANUAL + LIVE                                |
| Risk of Cardiovascular Adaptations                            | Gravity fields                      | Heart rate (webcam), blood pressure entry, trends                                                     | LIVE + MANUAL                                |
| Risk of Hypoxia                                               | Hostile or closed environments      | Cabin O2 and CO2 alert, SpO2                                                                          | SIM                                          |
| Risk of Spaceflight Associated Neuro-ocular Syndrome (SANS)   | Gravity fields                      | Eye zone on body model; eye camera on wearable                                                        | DESIGNED                                     |
| Risk of Reduced Cardiorespiratory and Musculoskeletal Fitness | Gravity fields                      | Exercise log; wearable accelerometer                                                                  | DESIGNED                                     |
| Risk of Inadequate Food and Nutrition                         | Hostile or closed environments      | Glucose entry; meal and fluid log (could)                                                             | MANUAL                                       |
| Risk of Radiation-Induced Cancers                             | Space radiation                     | Space-weather awareness, simulated exposure tracking, shelter guidance, crew check after storm events | SIM (awareness layer; does not measure dose) |

**We say the limit out loud:** we cover behavioral, sleep, cardiovascular, cabin-air and radiation-awareness risks. We do not cover bone, immune or decompression risks. Radiation is an awareness and shelter-guidance layer using simulated data; it does not measure dose and does not replace mission dosimetry.

**NASA is already measuring this way, so we are not inventing the need** (HRP ongoing research): ARCHeR on Artemis II monitored well-being, activity and sleep with a wrist actigraphy device; Standard Measures collects consistent physiological and psychological measurements from crews; Tempus Pro tested a telemedicine device that collects and integrates health data for remote, near real-time diagnoses; Space Gardening studies whether growing vegetables eases isolation. Frame Sentinel as the onboard software layer that lets the astronaut read such data and act on it. Do not claim NASA uses anything like Sentinel.

**Distance and delay:** NASA says instructions, supplies and medical care become harder to receive from Earth as crews go deeper. The Canadian Space Agency lists longer communication delays and less ability to rely on Earth for emergency medical help as missions go to the Moon and Mars. Neither page gives a minute figure.

**Earth spinoff:** the Canadian Space Agency says space-health studies produced findings that help people with balance problems, osteoporosis, cardiovascular disorders and Type-2 diabetes. That supports "space health research benefits Earth" in general; it does not show Sentinel itself does, so frame our Earth claims as a plan (DESIGNED).

**Still unverified, keep off slides until sourced:** "about 81% of astronauts show eye changes", "near-vision loss from about 3 weeks", "20 minutes each way", and the claim that a reaction-time test is a spaceflight standard.

# Part 2: Team and Ownership Architecture

## 4. Team Ownership Map & Non-Conflicting Handoffs

To build Sentinel rapidly without merge conflicts or duplicated work, the system is partitioned into **six vertical feature modules**, one per person. Each person owns their end-to-end slice: their data inputs, backend logic, UI screen, event contracts, NASA dataset research files, and golden scenario tests.

Modules communicate **strictly through the store and the event bus**. No module ever imports another module's internal code or writes directly into another person's directory.

### 4.1 Master Ownership Matrix

| Person       | Module Name                  | Scope & Capabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Codebase Files Owned                                                                                                                                                                                                                                 | UI Screen(s) Owned                                                                               | State Store Keys                                                                                                                                                | Publishes Events                                                                                     | Consumes Events / Data                                                                       | NASA Dataset Files (MRIDs)                                                                                                 | Golden Tests    |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Person 1** | **Radiation Awareness**      | Space-weather feed (NOAA GOES proton flux + snapshot fallback), cumulative dose passport model (SIM), S-scale storm levels (quiet, elevated, storm), shelter guidance & checklist, proton flux chart, dose vs reaction time view                                                                                                                                                                                                                                                                  | `brain/mission/radiation.py`<br>`app/js/mission/radiation.js`<br>`shared/radiation_snapshot.json`                                                                                                                                                            | `radiation` screen (dashboard, charts, shelter modal)                                            | `state.radiation`                                                                                                                                               | `radiation.updated`<br>`radiation.alert`<br>`shelter.advised`                                        | `state.vitals.reaction_ms`                                                                   | **11 files** (TEPC, dosimeters, RAD, REM2, CPDS)                                                                           | SR1–SR7         |
| **Person 2** | **Body Model & Zones**       | 3D human body model (BodyParts3D anatomy, Three.js), clickable anatomical zones (head, chest, abdomen, pelvis, limbs, hands, feet, eyes), X-ray / anatomy toggles, mesh scan animation, organ views (heart, lungs, brain, eyes, stomach), zone-based symptom logging                                                                                                                                                                                                                              | `app/js/body/*`<br>`app/js/systems/skin.js`<br>`brain/core/skin.py`                                                                                                                                                                                     | `body` screen (3D canvas, system rail, organ inspection)                                         | `state.indicators.*` (status glow)                                                                                                                              | `body.zone.selected`<br>`body.scan.complete`<br>`symptom.logged`                                     | `state.indicators.*` (worst indicator status per zone sets glow)                             | **19 files** (Physical exam, dental, ophthalmology, bone density, MRI, skin)                                               | SB1–SB7         |
| **Person 3** | **Face, AI Model & Voice**   | MediaPipe face mesh (468 landmarks) & pose, rPPG pulse extraction with confidence, breathing rate, blendshape classifier for valence & arousal (opt-in mood analysis), VAD, Groq Whisper STT + local fallback, ElevenLabs/Kokoro/Web Speech TTS chain, wake word "hey Sentinel", intent matching, speaker ID, Brain LLM card rephraser with numeric guard                                                                                                                                         | `brain/ai/speech.py`<br>`brain/ai/whisper_worker.py`<br>`brain/ai/llm.py`<br>`brain/ai/speaker.py`<br>`app/js/vision/face.js`<br>`app/js/core/intents.js`<br>`app/js/interface/orb.js`                                                                        | Ambient Voice Orb (all screens), camera scan modal                                               | `state.vitals.heart_rate` (camera)<br>`state.vitals.breathing_rate`<br>`state.wellbeing.dims.mood` (camera)                                                     | `reading.added` (camera)<br>`voice.command`<br>`voice.listening`                                     | `recommendation.created` (rephrases card)<br>`state.profile.wellbeingPlan`                   | **2 files** (Neurological assessment, hearing conservation)                                                                | SF1–SF8         |
| **Person 4** | **Vitals & Check-in**        | Core physiological vitals entry (BP, glucose, temp, sleep, SpO2, exercise, meals) with validation; 30-sec PVT cognitive reaction test with reaction time & lapses; daily check-in wizard; dynamic trend charts with baseline bands; routine reminder scheduling & timers                                                                                                                                                                                                                          | `app/js/systems/vitals.js`<br>`app/js/interface/readings.js`<br>`brain/rules/thresholds.py`<br>`shared/thresholds.json`<br>`shared/facts.json`                                                                                                             | `vitals` screen<br>`cognitive` test sheet<br>`measures` sheet<br>Daily check-in wizard           | `state.vitals.bp`<br>`state.vitals.blood_glucose`<br>`state.vitals.temperature`<br>`state.vitals.sleep_hours`<br>`state.vitals.reaction_ms`<br>`state.schedule` | `reading.added` (manual, test)<br>`checkin.started`<br>`checkin.complete`<br>`reminder.due`          | `state.baseline.*` (baseline bands)<br>`state.schedule`                                      | **17 files** (Clinical labs, treadmill exercise test, functional fitness, handgrip, EVA prebreathe)                        | SV1–SV8         |
| **Person 5** | **Lonely Games & Wellbeing** | Anti-isolation countermeasures suite: (1) Orb Calm WebGL biofeedback with live pulse response & 4s/6s breathing pacer; (2) Space Race (Aurora Run) Three.js flight game with pre/post mood logging; (3) Hydroponic Greenhouse SVG plant showing growth stages 0-8 and wilt mechanic; (4) Earth Window animated CSS perspective; (5) Ambient Sound synthesizer; (6) Connection Nudge crew messaging; (7) Intervention menu & empirical tool ranking                                                | `app/js/wellbeing/orbcalm.js`<br>`app/js/experience/race/*`<br>`app/js/wellbeing/greenhouse.js`<br>`app/js/wellbeing/interventions.js`<br>`app/js/wellbeing/logic.js`<br>`app/assets/game/*`                                                     | `orb_calm` sheet<br>`race` sheet<br>`greenhouse` sheet<br>`wellbeing` sheet<br>Intervention menu | `state.intervention_log`<br>`state.engagement.greenhouse_stage`                                                                                                 | `support.started`<br>`support.finished`<br>`intervention_log.added`<br>`greenhouse.stage`            | `state.vitals.heart_rate` (drives Orb Calm)<br>`state.wellbeing.level`<br>`state.engagement` | Research base (HRP Behavioral Health, NASA Space Gardening, isolation analogs)                                             | SG1–SG7         |
| **Person 6** | **Dataset & Integration**    | State store persistence & schema contract (`brain/core/store.py`, `shared/contract.json`), sequential decision pipeline (`thresholds.py` -> `drift.py` -> `decision.py`), event bus & UI router (`stages.js`, `commands.js`, `director.js`), ground link store-and-forward digest with 12.7-min delay simulation, environment profiles (station, transit, base, EVA), kit safety filter, NASA MRID catalog & source librarian, mock data seeder (6 crew, 14 days), master golden scenario verification | `server.py`<br>`brain/core/store.py`<br>`brain/rules/thresholds.py`<br>`brain/rules/drift.py`<br>`brain/rules/decision.py`<br>`brain/mission/ground.py`<br>`shared/contract.json`<br>`shared/mock_data.json`<br>`shared/med_kit.json`<br>`app/js/core/*`<br>`dataset/_catalog.json` | `ground` screen<br>`crew` sheet<br>`mission` screen<br>Environment & mode switchers              | All state keys (`state.*`), snapshot selector `getSnapshot(crewId)`                                                                                             | `status.updated`<br>`anomaly.raised`<br>`digest.queued`<br>`digest.changed`<br>`environment.changed` | Merges all state patches from P1–P5; handles all store mutations                             | **19 files** (Environmental air quality, water quality, toxicology, EVA prebreathe protocols, mission clinical management) | SI1–SI7, S1–S19 |

### 4.2 Non-Conflicting Handoff Rules

1. **Strict File Ownership:** You edit ONLY the files assigned to your person. If you believe a file owned by another person needs a change, ask that person or Person 6 (Integration).
2. **Contract-First Schema Changes:** Any change to the state schema (`shared/contract.json`) or event payloads MUST be documented in Section 25 of this document first and approved by Person 6. Never commit undocumented JSON fields.
3. **Zero Cross-Module Direct Imports:** Never write `import { ... } from '../another_person_module/'`. If Person 1 needs reaction time, they read `ctx.view.state.vitals.reaction_ms`. If Person 5 needs heart rate, they read `ctx.view.state.vitals.heart_rate`. All data flows through state or the event bus.
4. **Honesty Labels Required on Ingest:** Every value pushed to the store must carry `label: "LIVE" | "MANUAL" | "SIM" | "DESIGNED"` and `confidence: number (0.0 to 1.0)`. `brain/core/store.py` will reject and drop any reading missing these fields.
5. **UI Component Encapsulation:** All screens must implement the standard `render(el, ctx)` lifecycle and register in `app/js/core/commands.js`.
6. **Integration Verification:** Person 6 merges PRs in phase order (Phase 0 through Phase 6) and runs the golden scenario test suite to ensure no regressions.

## 5. Module Template, Dataset Linking & Codebase UI Guide

### 5.1 How to Build on the Codebase UI

Sentinel’s front end is built with vanilla JavaScript (ES modules) running natively in modern browsers with **zero build steps** (`npm run dev` or simple static server). There is no React or bundler overhead.

#### Screen Registration & Lifecycle

Every UI feature screen belongs to the `app/js/` directory and follows this contract:

1. **Register the Screen ID in `app/js/core/commands.js`:**
   Add your screen ID (e.g. `"radiation"`, `"orb_calm"`, `"greenhouse"`) to the `SCREENS` array.
2. **Implement the Stage in `app/js/core/stages.js`:**
   Export a render function that mounts into the container element `el`:

   ```javascript
   export function renderMyScreen(el, ctx) {
     // 1. Read current crew state snapshot
     const s = ctx.view.state;
     const crewId = s?.crew_id ?? "james";

     // 2. Render initial HTML
     el.innerHTML = `
       <div class="screen-layout">
         <h2>My Feature</h2>
         <div class="card" data-content></div>
       </div>`;

     // 3. Bind UI interactions and event subscriptions
     const contentEl = el.querySelector("[data-content]");
     const unsub = ctx.bus.on("my_event", (payload) => {
       // update UI reactively
     });

     // 4. Return teardown cleanup function (called when user navigates away)
     return () => {
       unsub();
       // cancel requestAnimationFrame, stop WebGL, mute audio
     };
   }
   ```

3. **Context (`ctx`) Object Available to Every Screen:**
   - `ctx.view.state`: Latest immutable state snapshot of the active crew member.
   - `ctx.bus`: The event bus (`emit(type, payload)`, `on(type, handler)`, `once(type, handler)`).
   - `ctx.openScreen(screenId)`: Navigate to another screen.
   - `ctx.openIntervention(id)`: Open a specific wellbeing intervention.
4. **Shared UI Components (`app/js/interface/`):**
   - `readings.js`: Use `badgeHTML(status, text)`, `sparkline(series)`, `esc(text)` to ensure visual consistency.
   - `orb.js`: Shared WebGL orb renderer (`createOrb(canvas, options)`).
   - High contrast CSS variables: Always use `--bg`, `--card`, `--line-dim`, `--ok` (green), `--watch` (amber), `--danger` (red), `--calm` (cyan). Never hardcode colours.

### 5.2 How to Connect and Build from the NASA Dataset

The `dataset/` folder contains **94 PDF files** (68 unique documents) from NASA Medical Requirements Integration Documents (JSC 28913). Each person has specific assigned documents cataloged in `dataset/_catalog.json`.

#### Step-by-Step Dataset Utilization Workflow:

1. **Find Your Files:** Inspect `dataset/_catalog.json` and filter by `"primaryOwner": "P<your_number>"`.
2. **Extract Thresholds & Reference Ranges:**
   - Find the physiological limits or monitoring trigger values in the PDF.
   - Place them in `shared/thresholds.json` under the appropriate indicator.
   - Add `"source": "NASA JSC 28913 MRID <number>"` and set `"demoDefault": false`.
3. **Extract Measurement Instructions:**
   - Extract the exact clinical procedure or equipment instructions.
   - Add them to `shared/facts.json` under `"how_to_measure"`.
4. **Extract Clinical Rationale:**
   - Map the measurement to NASA HRP risks (e.g. Cardiovascular Adaptations, Hypoxia, Radiation Carcinogenesis).
   - Add this explanation to `shared/facts.json` under `"why_it_matters"`.
5. **Document Sources in `shared/SOURCES.md`:**
   - Record every file used with its title, MRID number, and where in the code it is cited.

# Part 3: Feature Modules

## 6. Feature 1: Radiation Awareness (Person 1)

### 6.1 Purpose and scope

Give the crew real-time awareness of the space-radiation environment: current conditions, cumulative exposure (simulated), storm events, and shelter guidance. **This module does not measure dose.** Everything it shows is labelled **SIM** in the demo and defers to the mission's radiation operations team. It maps to the HRP risk "Risk of Radiation-Induced Cancers" and the space-radiation hazard.

### 6.2 Indicators

| Indicator id      | What                                | Unit               | Label | Worse when | Group     |
| ----------------- | ----------------------------------- | ------------------ | ----- | ---------- | --------- |
| `rad_dose_rate`   | Current dose rate from the feed     | µSv/h (demo units) | SIM   | high       | radiation |
| `rad_cumulative`  | Running cumulative exposure         | mSv (demo units)   | SIM   | high       | radiation |
| `rad_event_level` | Storm level: quiet, elevated, storm | enum               | SIM   | storm      | radiation |
| `shelter_status`  | Whether shelter is advised          | boolean            | SIM   | true       | radiation |

### 6.3 What is actually built

- **NOAA GOES proton flux feed** (`brain/mission/radiation.py`): live fetch from NOAA GOES satellite JSON endpoint with a snapshot fallback file for offline/demo use.
- **Dose passport model**: cumulative dose tracking from the feed, using a configurable shielding factor. Labelled SIM throughout.
- **Storm levels via S-scale**: proton flux thresholds mapped to NOAA S1–S5 scale (elevated at S1, storm at S3+).
- **Shelter button and storm checklist**: when storm level is reached, Sentinel advises shelter and presents a crew action checklist.
- **Proton flux chart**: real-time chart of flux values with storm threshold bands.
- **Radiation screen** (`app/js/mission/radiation.js`): dashboard with current dose rate, cumulative exposure, event level, shelter status, and the proton flux chart. Reaction-time-beside-dose view for crew readiness.

### 6.4 Functional requirements

| ID     | Requirement                                                                                      | Priority |
| ------ | ------------------------------------------------------------------------------------------------ | -------- |
| RAD-1  | Fetch or simulate a space-weather data feed and display current dose rate, labelled SIM          | M        |
| RAD-2  | Track cumulative exposure from the feed using a shielding model, labelled SIM                    | M        |
| RAD-3  | Classify conditions as quiet, elevated, or storm from proton flux thresholds                     | M        |
| RAD-4  | When storm level is reached, advise shelter with a crew action checklist                         | M        |
| RAD-5  | Show a proton flux chart with storm threshold bands                                              | S        |
| RAD-6  | Emit `radiation.updated` on every feed cycle with dose rate, cumulative, event level             | M        |
| RAD-7  | Emit `radiation.alert` when event level changes to elevated or storm                             | M        |
| RAD-8  | Show dose-rate trend alongside reaction-time trend for crew readiness view                       | S        |
| RAD-9  | Provide a snapshot fallback file so radiation works offline                                      | M        |
| RAD-10 | Every radiation value carries `label: "SIM"` and `confidence: 1`; the store rejects without them | M        |

### 6.5 Events

| Event               | Payload                                                                        | Emitted when                             |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `radiation.updated` | `{ crewId, dose_rate, cumulative, event_level, shelter_status, label: "SIM" }` | Every feed cycle                         |
| `radiation.alert`   | `{ event_level, previous_level, shelter_advised }`                             | Event level changes to elevated or storm |
| `shelter.advised`   | `{ reason, checklist[] }`                                                      | Storm threshold crossed                  |

### 6.6 Files owned by P1

- `brain/mission/radiation.py` — feed fetch, dose model, storm classification
- `app/js/mission/radiation.js` — radiation screen and chart
- `shared/radiation_snapshot.json` — offline fallback data

### 6.7 Dataset and codebase

**Your NASA MRIDs (11 files).** These are your evidence base — read them to understand what NASA actually measures for radiation monitoring, what units and thresholds they use, and what procedures exist. Use them as sources for your `thresholds.json` ranges and protocol text.

| File                                | Title                                                          |
| ----------------------------------- | -------------------------------------------------------------- |
| `cl5yvqhsv2snf01o6bh09ba10.pdf`     | MR004L In-flight Radiation Area Monitoring with Dosimeters     |
| `cl5yvqhsv2snj01o6c5fjglma (1).pdf` | MR004S In-Flight Radiation Monitoring with Passive Dosimeters  |
| `cl5yvqhsv2snl01o60mwu9p6r.pdf`     | MR005L In-flight Radiation Monitoring with TEPC                |
| `cl5yvqhsv2snn01o69ap47uqd.pdf`     | MR005S Radiation Monitoring Using Shuttle TEPC                 |
| `cl5yvqkq12spn01o63cg21vbx.pdf`     | MR092L In-flight Radiation Monitoring with RAD                 |
| `cl5yvqkq12spo01o6gj3x4son.pdf`     | MR093L In-flight Radiation Monitoring with Intravehicular TEPC |
| `cl5yvqkq12spp01o657hgcc75.pdf`     | MR094L In-flight Radiation Area Monitoring with Active REM2    |
| `cl5yvqhsu2smt01o6asca5dwu.pdf`     | MEDB 3 (radiation procedures)                                  |
| `cl5yvqhsu2smu01o67lseef9a.pdf`     | MEDB 3 (radiation procedures)                                  |
| `cl5yvqhsu2smz01o63a5sb3op.pdf`     | MEDB 6 (radiation limits)                                      |
| `cl5yvqhsv2sn901o6h0nsf1lg (1).pdf` | MEDB N3 (radiation operations)                                 |

**How to use them:** Extract real NASA threshold values, unit conventions, monitoring frequencies, and crew action procedures from these documents. When your code references a threshold or procedure, cite the MRID number as the source in `thresholds.json` and protocol definitions. If a document gives a numeric limit, use it as a `demoDefault: false` range; otherwise mark it `demoDefault: true`.

**Existing codebase to build on.** Your radiation module already has working code:

- **Backend**: `brain/mission/radiation.py` — start here. It fetches NOAA GOES data, calculates dose, classifies storms. Extend it with thresholds from your MRIDs.
- **Frontend**: `app/js/mission/radiation.js` — the radiation dashboard screen. It already renders in the app's UI framework (vanilla JS, no React). Follow the same patterns as the other screens in `app/js/`.
- **State contract**: your radiation data flows through `brain/core/store.py` and appears in `shared/contract.json`. Add any new fields there first.
- **UI patterns**: look at `app/js/core/commands.js` for screen registration, `app/js/core/stages.js` for screen lifecycle, and `app/js/interface/` for shared UI components (badges, readings, charts).

### 6.8 Tests

| ID  | Scenario                             | Expected                                                                  |
| --- | ------------------------------------ | ------------------------------------------------------------------------- |
| SR1 | Feed returns quiet-level flux        | `rad_event_level` = quiet, no alert, shelter not advised                  |
| SR2 | Feed returns storm-level flux        | `rad_event_level` = storm, `radiation.alert` emitted, shelter advised     |
| SR3 | Feed unavailable (offline)           | Snapshot fallback loads, values labelled SIM, no crash                    |
| SR4 | Cumulative dose increments over time | `rad_cumulative` increases monotonically with shielding factor applied    |
| SR5 | Storm event followed by quiet        | Shelter advisory clears, alert resolves                                   |
| SR6 | Every radiation reading stored       | All have `label: "SIM"` and `confidence: 1`                               |
| SR7 | Radiation screen renders             | Dose rate, cumulative, event level, chart, and shelter button all visible |

---

## 7. Feature 2: Body Model and Zones (Person 2)

### 7.1 Purpose and scope

Let the astronaut see their health on a clickable 3D body figure. Each zone opens indicators, how to measure, why it matters, and what to do. The body model supports zone-based symptom entry and colour-coded status at a glance. Maps to the challenge requirement for a "visual tool; clickable human figure."

### 7.2 What is actually built

- **3D body with BodyParts3D anatomy**: real anatomical meshes, not a cartoon. Head, torso, arms, legs, hands, feet, eyes.
- **X-ray modes**: radiograph overlay and anatomy view that toggle between skin and internal views.
- **Zone checks**: click a body zone to see all indicators mapped to that zone with their current status.
- **Mesh scan**: a diagnostic scan animation that highlights zones with active alerts.
- **Organ views**: drill into organs (heart, lungs, brain, eyes, stomach) for deeper indicator grouping.
- **Pointing**: click-to-locate for symptom entry ("where does it hurt?").
- **System rail**: navigation between body systems (cardiovascular, respiratory, neurological, etc.).
- **Colour coding**: each zone glows green, amber, or red based on the worst indicator in that zone. Status is never by colour alone — always icon + word.

### 7.3 Functional requirements

| ID     | Requirement                                                                                                    | Priority |
| ------ | -------------------------------------------------------------------------------------------------------------- | -------- |
| BODY-1 | Render a 3D body figure with clickable zones (head, torso, arms, legs, hands, feet, eyes)                      | M        |
| BODY-2 | Each zone glows green, amber, or red based on the worst indicator mapped to it                                 | M        |
| BODY-3 | Clicking a zone opens an indicator panel with value, status, chart, how to measure, why it matters, what to do | M        |
| BODY-4 | Support X-ray/anatomy toggle for internal organ views                                                          | S        |
| BODY-5 | Support mesh scan animation highlighting zones with active alerts                                              | S        |
| BODY-6 | Provide zone-based symptom entry ("where does it hurt?" → zone → symptom picker)                               | M        |
| BODY-7 | Status uses colour + icon + word, never colour alone (FR-32)                                                   | M        |
| BODY-8 | Body figure works with large touch targets for glove use                                                       | S        |

### 7.4 Events

| Event                | Payload                           | Emitted when                  |
| -------------------- | --------------------------------- | ----------------------------- |
| `body.zone.selected` | `{ zone, crewId }`                | A zone is clicked             |
| `body.scan.complete` | `{ zones_flagged[] }`             | Mesh scan finishes            |
| `symptom.logged`     | `{ zone, type, severity, onset }` | A symptom is entered via body |

### 7.5 Tests

| ID  | Scenario                            | Expected                                              |
| --- | ----------------------------------- | ----------------------------------------------------- |
| SB1 | All indicators green                | Every body zone glows green                           |
| SB2 | One indicator in head zone is amber | Head zone glows amber                                 |
| SB3 | Click head zone                     | Indicator panel opens with mapped indicators          |
| SB4 | Enter symptom via body              | `symptom.logged` event emitted with zone and severity |
| SB5 | X-ray toggle                        | View switches between skin and anatomy                |
| SB6 | Mesh scan with one alert            | Scan highlights the flagged zone                      |
| SB7 | Glove mode on                       | Touch targets are at least 48px                       |

### 7.6 Dataset and codebase

**Your NASA MRIDs (19 files).** These cover physical exams, dental, ophthalmology, bone density, body mass, MRI, skin checks, and other body-system assessments. Use them to understand which body zones NASA monitors, what measurements are taken at each zone, and what indicators map where.

**How to use them:** Each MRID describes a medical requirement for a body system. Map these to your body zones — for example, ophthalmology MRIDs tell you what eye indicators to show when the head/eyes zone is clicked; physical exam MRIDs tell you what to check at each body region. Use the measurement descriptions for your "How to measure" and "Why it matters" text on indicator panels. Cite the MRID number as the source.

**Existing codebase to build on.** The body model is already built:

- **3D body**: `app/js/body/` folder — BodyParts3D meshes, zone mapping, X-ray modes, organ views. This is a large working module with Three.js rendering.
- **Indicator panel**: `app/js/interface/readings.js` — shows value, status badge, chart. Your zone clicks open this panel.
- **Symptom entry**: `app/js/systems/skin.js` + `brain/core/skin.py` — zone-based symptom picker already exists.
- **UI patterns**: follow `app/js/core/stages.js` for screen lifecycle. The body screen is registered in `app/js/core/commands.js`.
- **State contract**: body status comes from `shared/contract.json` → `brain/core/store.py`. Zone colours derive from indicator statuses in the state.

---

## 8. Feature 3: Face, AI Model and Voice (Person 3)

### 8.1 Purpose and scope

Capture health signals from the face and voice: webcam pulse (rPPG), breathing rate, facial expression for mood (valence and arousal), speech-to-text, text-to-speech, wake word, intent matching, speaker identification, and the brain LLM that rephrases recommendation cards. Maps to HRP risks for behavioral changes, sleep, and cardiovascular adaptations.

### 8.2 What is actually built

- **MediaPipe face mesh and pose** (`app/js/systems/`): 468 face landmarks, 52 blendshapes, pose estimation. Used for rPPG pulse extraction and expression reading.
- **rPPG pulse**: forehead ROI colour channel analysis for heart rate estimation, with confidence scoring. Labelled LIVE.
- **VAD (voice activity detection)**: browser-based silence detection before STT.
- **Groq Whisper STT**: speech-to-text via Groq API with local faster-whisper fallback (`brain/ai/whisper_worker.py`).
- **Intent matching** (`app/js/core/intents.js`): maps spoken phrases to commands (open screens, triage, environment change, wellbeing).
- **Brain LLM** (`brain/ai/llm.py`): Groq LLM for rephrasing recommendation cards. Numeric guard prevents the model from inventing numbers. Scripted fallback when offline.
- **TTS**: ElevenLabs API → Kokoro local → browser Web Speech API fallback chain (`brain/ai/speech.py`, `brain/ai/speaker.py`).
- **Wake phrase**: "hey Sentinel" triggers listening.
- **Speaker identification**: Resemblyzer-based voiceprint enrolment and matching.

### 8.3 Mood model pipeline

1. MediaPipe blendshapes (52 scores per frame) from the webcam.
2. Small classifier (trained on FER2013/AffectNet/team samples) predicts valence and arousal.
3. Rolling window smooths scores. One frame never raises a flag.
4. Camera mood analysis is **opt-in per person** with fallback to self-report and voice.
5. Model card with held-out results published in `docs/model_card.md`.

### 8.4 Functional requirements

| ID     | Requirement                                                                           | Priority |
| ------ | ------------------------------------------------------------------------------------- | -------- |
| FACE-1 | Camera scan estimates heart rate via rPPG with a confidence value, labelled LIVE      | M        |
| FACE-2 | Camera scan estimates breathing rate from pose landmarks, labelled LIVE               | M        |
| FACE-3 | Expression model outputs valence and arousal from blendshapes, labelled LIVE          | M        |
| FACE-4 | Camera mood analysis is opt-in per person; fallback to self-report and voice when off | M        |
| FACE-5 | Speech-to-text with wake word "hey Sentinel" and speaker identification               | S        |
| FACE-6 | Intent matching maps spoken phrases to commands                                       | M        |
| FACE-7 | Brain LLM rephrases recommendation cards; never invents numbers, doses, or diagnoses  | M        |
| FACE-8 | TTS reads cards aloud with ElevenLabs → Kokoro → browser fallback chain               | S        |
| FACE-9 | Scripted fallback lines when the LLM is offline or errors                             | M        |

### 8.5 LLM system prompt

```
SYSTEM: You are Sentinel, a calm onboard health assistant for astronauts.
You receive a JSON recommendation card and a language code. Rephrase the card as at
most two short spoken sentences in that language. Do not add medical facts, doses,
diagnoses or reassurance that the card does not contain. If level is 3, start with the
single most important immediate step. If asked something the card does not answer, say
you will note the question for the flight surgeon.
```

### 8.6 Events

| Event             | Payload                                                                           | Emitted when              |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------- |
| `reading.added`   | `{ indicator: "heart_rate", source: "camera", label: "LIVE", confidence }`        | Camera scan pulse reading |
| `reading.added`   | `{ indicator: "valence"/"arousal", source: "camera", label: "LIVE", confidence }` | Expression model output   |
| `voice.command`   | `{ text, speakerId, confidence }`                                                 | Speech recognised         |
| `voice.listening` | `{ active: bool }`                                                                | Mic state changes         |

### 8.7 Tests

| ID  | Scenario                          | Expected                                                                 |
| --- | --------------------------------- | ------------------------------------------------------------------------ |
| SF1 | Camera scan in good light         | Heart rate reading with confidence ≥ 0.6, labelled LIVE                  |
| SF2 | Camera blocked                    | Graceful fallback to manual entry; check-in completes                    |
| SF3 | "Hey Sentinel, I have a headache" | Wake word triggers listening, intent matches triage, symptom flow starts |
| SF4 | LLM offline                       | Scripted fallback line spoken per level                                  |
| SF5 | Camera mood off in profile        | Wellbeing still computes from self-report and voice                      |
| SF6 | Low-confidence pulse reading      | Shown as estimate; no alert raised alone                                 |
| SF7 | Brain LLM receives a card         | Response is ≤ 2 sentences, no invented numbers                           |
| SF8 | Speaker identification            | Correct crew member identified from voiceprint                           |

### 8.8 Dataset and codebase

**Your NASA MRIDs (2 files).** You have neurological assessment and hearing conservation documents. These are smaller in number because face/voice/AI is more about the technology pipeline than NASA medical requirements, but the neurological assessment MRID gives you the basis for cognitive and behavioral signals.

**How to use them:** Extract any cognitive or neurological assessment procedures that inform your mood model and voice analysis. Use the hearing conservation MRID for voice input/output considerations (noise levels, hearing protection during use).

**Existing codebase to build on.** The face and voice pipeline is already built end-to-end:

- **Camera/MediaPipe**: `app/js/systems/` — face mesh, pose estimation, rPPG pulse already working. The blendshape extraction pipeline feeds into the state.
- **Voice pipeline**: `brain/ai/speech.py` (TTS), `brain/ai/whisper_worker.py` (STT), `brain/ai/speaker.py` (speaker ID). Wake word "hey Sentinel" works.
- **Intent matching**: `app/js/core/intents.js` — maps phrases to screen commands and actions. Add new intents here.
- **Brain LLM**: `brain/ai/llm.py` — Groq API with numeric guard. The system prompt is already tuned. Extend with new card types.
- **UI patterns**: the voice orb is in `app/js/interface/orb.js`. Speech state flows through `app/js/core/bus.js` events (`voice:listening`, `voice:result`).
- **State contract**: face readings (heart_rate from camera, valence, arousal) flow into `shared/contract.json` via `brain/core/store.py`.

---

## 9. Feature 4: Vitals and Check-in (Person 4)

### 9.1 Purpose and scope

Own all typed-entry vitals, the daily check-in flow, trend charts, the reaction test, and measurement reminders. This is the core data-entry path that feeds the anomaly engine. Maps to challenge requirements for gathering health indicators and prompting routine measurements.

### 9.2 Indicators owned by P4

| Indicator id                     | What                        | How captured       | Label  |
| -------------------------------- | --------------------------- | ------------------ | ------ |
| `bp_sys`, `bp_dia`               | Blood pressure              | Typed from a cuff  | MANUAL |
| `blood_glucose`                  | Blood glucose mg/dL         | Typed from a meter | MANUAL |
| `temperature`                    | Body temperature °C         | Typed              | MANUAL |
| `sleep_hours`, `sleep_quality`   | Sleep duration and quality  | Typed / tapped     | MANUAL |
| `reaction_ms`, `reaction_lapses` | 30-second PVT reaction test | Timed test         | LIVE   |
| `exercise_minutes`               | Exercise log                | Quick log          | MANUAL |
| `hydration_log`                  | Meals and fluids            | Quick log          | MANUAL |
| `spo2`                           | Oxygen saturation           | SIM (sensor later) | SIM    |

### 9.3 What is actually built

- **Typed entry forms**: BP, glucose, temperature, sleep, mood with unit labels and range validation.
- **30-second PVT reaction test**: measures reaction time and lapse count, labelled LIVE.
- **Daily check-in flow**: step bar → camera scan → typed entries → mood/energy taps → reaction test → summary with one headline and status per indicator.
- **Trend charts**: per-indicator charts with baseline band from seeded SIM history.
- **Measurement reminders**: scheduled daily check-in, recheck timers from protocols.

### 9.4 Functional requirements

| ID    | Requirement                                                                                 | Priority |
| ----- | ------------------------------------------------------------------------------------------- | -------- |
| VIT-1 | Typed entry for BP, glucose, temperature, sleep hours with unit labels and range validation | M        |
| VIT-2 | 30-second reaction test with lapse count, labelled LIVE                                     | S        |
| VIT-3 | Daily check-in flow: camera scan, typed entries, mood/energy taps, reaction test, summary   | M        |
| VIT-4 | Trend chart per indicator with baseline band                                                | M        |
| VIT-5 | Scheduled measurement reminders (check-in, recheck, exercise, hydration, sleep wind-down)   | M        |
| VIT-6 | Out-of-range typed entry prompts a remeasure, never silently dropped                        | M        |

### 9.5 Events

| Event              | Payload                                                                  | Emitted when             |
| ------------------ | ------------------------------------------------------------------------ | ------------------------ |
| `reading.added`    | `{ indicator, value, source: "manual", label: "MANUAL", confidence: 1 }` | A vital is entered       |
| `checkin.started`  | `{ crewId }`                                                             | Check-in flow begins     |
| `checkin.complete` | `{ crewId, summary }`                                                    | Check-in flow finishes   |
| `reminder.due`     | `{ type: "checkin"/"measurement", crewId }`                              | Scheduled reminder fires |

### 9.6 Tests

| ID  | Scenario                                     | Expected                                                |
| --- | -------------------------------------------- | ------------------------------------------------------- |
| SV1 | Type a BP of 180/110                         | Amber/red status, recommendation card generated         |
| SV2 | Type a BP of 120/80                          | Green status, no alert                                  |
| SV3 | Reaction test with fast responses            | `reaction_ms` below baseline, green                     |
| SV4 | Reaction test with slow responses and lapses | `reaction_ms` above baseline, amber, lapse count stored |
| SV5 | Complete daily check-in                      | All entered indicators show status; summary displays    |
| SV6 | Out-of-range glucose entry                   | Prompt to remeasure; not silently stored                |
| SV7 | Trend chart after 7 days of data             | Chart shows with baseline band                          |
| SV8 | Two missed check-ins                         | `missed_checkins` incremented; gentle re-prompt         |

### 9.7 Dataset and codebase

**Your NASA MRIDs (17 files).** These cover clinical laboratory testing, ECG, fitness testing (treadmill, handgrip dynamometry), cardiovascular assessments, pulmonary function, and EVA exercise prebreathe protocols. These are the core of what you build — they define the vital signs NASA actually measures, the units, the frequencies, and the normal ranges.

**How to use them:** For every indicator you own (BP, glucose, temperature, sleep, reaction time, SpO2, exercise), find the matching MRID and extract:

- **Reference ranges** → put into `shared/thresholds.json` with the MRID number as source and `demoDefault: false`
- **Measurement procedures** → put into `shared/facts.json` as the "How to measure" text for each indicator
- **Monitoring frequencies** → inform your reminder scheduling (daily, weekly, pre-EVA)
- **Clinical significance** → put into the "Why it matters" text on indicator panels

**Existing codebase to build on.** The vitals entry path is working:

- **Server**: `server.py` — FastAPI endpoints for state patches. All typed entries flow through here.
- **State store**: `brain/core/store.py` — stores per crew member, history append-only, capped at 2000 points.
- **Thresholds**: `brain/rules/thresholds.py` + `shared/thresholds.json` — range checking already runs on every patch. Add your MRID-sourced ranges here.
- **Check-in flow**: `app/js/systems/` — the daily check-in screens exist. Step bar, entry forms, validation.
- **Reaction test**: built in `app/js/` — 30-second PVT with lapse counting.
- **Trend charts**: rendered in `app/js/interface/` using the history from the state store.
- **UI patterns**: follow `app/js/core/commands.js` for screen registration, `app/js/core/stages.js` for lifecycle, `app/js/interface/readings.js` for indicator display.

---

## 10. Feature 5: Lonely Games and Wellbeing Experiences (Person 5)

### 10.1 Purpose and scope

Own all the anti-loneliness and wellbeing experience tools that help astronauts cope with isolation, stress, boredom, and homesickness. These are interactive tools — not passive data — designed to combat NASA's named hazards of isolation and confinement. Each tool logs mood or stress before and after so Sentinel learns what works for each person.

### 10.2 Tools and experiences

| Tool                        | What it does                                                                                                                                                                                     | Isolation hazard it addresses      | Label    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | -------- |
| **Orb Calm**                | Biofeedback: the orb starts turbulent and red at the live pulse, settles blue as pulse falls; paced-breathing ring; logs recovery time                                                           | Stress, anxiety, sleep difficulty  | LIVE     |
| **Space Race (Aurora Run)** | Three-lap 3D race past five worlds against ghost racers. Original racer model built in Blender. Mood logged before and after. A boredom and stress break — never a crash or game over            | Boredom, monotony, confinement     | LIVE     |
| **Greenhouse**              | SVG plant in a hydroponic pod. Grows with completed routine days and calm sessions; wilts (never dies) after missed days. Tending a living thing eases isolation (NASA Space Gardening research) | Isolation, disconnection from life | LIVE     |
| **Earth Window**            | Slow animated CSS view of Earth. A short break for tired eyes and mind; connection to home                                                                                                       | Homesickness, distance from Earth  | LIVE     |
| **Ambient Sound**           | Browser-generated ambient pad. Fades in slowly for wind-down                                                                                                                                     | Stress, sleep difficulty           | LIVE     |
| **Connection Nudge**        | Suggests a message to a crewmate. "Isolation is one of NASA's five hazards; a short message helps"                                                                                               | Isolation, withdrawal              | LIVE     |
| **Paced Breathing**         | Guided breathing ring (also part of Orb Calm)                                                                                                                                                    | Stress, panic                      | LIVE     |
| **Grounding Exercise**      | Short sensory exercise for anxiety or panic signs                                                                                                                                                | Anxiety, distress                  | LIVE     |
| **Messages from Home**      | Recordings made before flight, unlocked by the astronaut                                                                                                                                         | Homesickness, distance             | DESIGNED |

### 10.3 What is actually built

- **Orb Calm** (`app/js/wellbeing/orbcalm.js`): reads heart rate from state (camera LIVE or SIM), renders a WebGL orb on canvas that morphs from red/turbulent to blue/calm as pulse drops. Paced-breathing pacer (4s in, 6s out). Logs start HR, target, and recovery time. Greenhouse stage increments on successful calm sessions.
- **Space Race** (`app/js/experience/race/`): full 3D game using Three.js with a custom Blender racer model, gate pickups, asteroid obstacles (shield absorbs, otherwise slow-down — never a crash), three laps past planet textures (Solar System Scope). Mood before/after logged as LIVE. Session records mood change, time, and position.
- **Greenhouse** (`app/js/wellbeing/greenhouse.js`): SVG plant with 9 growth stages. Stage advances with completed check-in days and calm sessions. Wilt factor increases after missed days. Uses `GREENHOUSE_MAX` from logic.
- **Earth Window** (`app/js/wellbeing/interventions.js`): CSS-animated Earth view with rest prompt.
- **Ambient Sound** (`app/js/wellbeing/interventions.js`): Web Audio API oscillator-based ambient pad with slow fade.
- **Intervention menu** (`app/js/wellbeing/interventions.js`): unified menu listing all interventions with descriptions; Sentinel's rules choose a suggestion from the astronaut's current state.

### 10.4 Functional requirements

| ID     | Requirement                                                                                   | Priority |
| ------ | --------------------------------------------------------------------------------------------- | -------- |
| GAME-1 | Orb Calm reads live pulse, renders biofeedback orb, guides paced breathing, logs recovery     | M        |
| GAME-2 | Space Race runs a 3D race with mood before/after logging                                      | S        |
| GAME-3 | Greenhouse grows with completed days and calm sessions, wilts on missed days                  | S        |
| GAME-4 | Earth Window shows an animated Earth view                                                     | S        |
| GAME-5 | Ambient Sound generates a browser-based pad for wind-down                                     | C        |
| GAME-6 | Connection Nudge suggests messaging a crewmate                                                | S        |
| GAME-7 | Every tool logs mood/stress before and after as a `support.finished` event                    | M        |
| GAME-8 | Tools are offered in order of personal effectiveness (tool ranking from before/after results) | S        |
| GAME-9 | Intervention menu shows all available tools with descriptions; astronaut picks or declines    | M        |

### 10.5 Events

| Event                    | Payload                                             | Emitted when              |
| ------------------------ | --------------------------------------------------- | ------------------------- |
| `support.started`        | `{ flowId, type, tool, stressBefore }`              | An intervention starts    |
| `support.finished`       | `{ flowId, type, tool, stressBefore, stressAfter }` | An intervention completes |
| `intervention_log.added` | `{ type, stress_before, stress_after, recovery_s }` | Session result stored     |
| `greenhouse.stage`       | `{ stage, wilt }`                                   | Greenhouse stage changes  |

### 10.6 Files owned by P5

- `app/js/wellbeing/orbcalm.js` — Orb Calm biofeedback
- `app/js/wellbeing/race/race.js` — Space Race game
- `app/js/wellbeing/race/logic.js` — Race session and scoring logic
- `app/js/wellbeing/greenhouse.js` — Greenhouse plant
- `app/js/wellbeing/interventions.js` — Intervention menu, Earth window, ambient sound, connection nudge
- `app/js/wellbeing/logic.js` — Shared experience logic (calm session, greenhouse max, pacer)
- `app/assets/game/` — 3D models (racer, gate, pickup, asteroid)

### 10.7 Tests

| ID  | Scenario                                           | Expected                                              |
| --- | -------------------------------------------------- | ----------------------------------------------------- |
| SG1 | Start Orb Calm with elevated HR                    | Orb renders red and turbulent; pacer guides breathing |
| SG2 | HR drops below target for 10s during Orb Calm      | Orb settles blue; session logged with recovery time   |
| SG3 | Complete Space Race                                | Mood before and after logged; session record stored   |
| SG4 | 3 consecutive check-in days                        | Greenhouse plant advances one stage                   |
| SG5 | 2 missed days                                      | Greenhouse wilt factor increases (plant never dies)   |
| SG6 | Stress level 1, "what helps me" has orb_calm first | Orb Calm offered first in intervention menu           |
| SG7 | Complete 5 interventions with varying results      | Tool ranking updates based on average improvement     |

### 10.8 Dataset and codebase

**Your NASA MRIDs (0 direct files).** No NASA MRIDs cover games or interactive wellbeing tools directly. However, your evidence base comes from:

- **NASA's Space Gardening research** — cited in the HRP as studying whether growing vegetables eases isolation. This is the basis for the Greenhouse feature.
- **HRP risk: "Risk of Behavioral Changes and Psychiatric Disorders"** — the isolation and confinement hazard. All your tools address this.
- **Section 9 (Mental Wellbeing)** of this document — the wellbeing framework, support flows, tool ranking, and four dimensions (mood, energy, stress, connection) that your tools feed into.
- **P4's dataset files** on fitness testing and exercise protocols may inform the Space Race's physical engagement angle.

**How to use the research:** When describing each tool in the UI, reference the NASA hazard it addresses (e.g., "Isolation is one of NASA's five hazards" for the connection nudge). Ensure every tool logs mood/stress before and after so the tool-ranking algorithm has data.

**Existing codebase to build on.** All the experience tools are already built and working:

- **Orb Calm**: `app/js/wellbeing/orbcalm.js` — full WebGL orb with biofeedback, paced breathing, heart rate tracking. Uses `app/js/interface/orb.js` for the orb renderer and `app/js/wellbeing/logic.js` for calm session math.
- **Space Race**: `app/js/wellbeing/race/race.js` + `race/logic.js` — complete Three.js 3D game with Blender models in `app/assets/game/`. Three laps, gate pickups, asteroid obstacles, mood logging.
- **Greenhouse**: `app/js/wellbeing/greenhouse.js` — SVG plant with 9 growth stages and wilt mechanic.
- **Interventions**: `app/js/wellbeing/interventions.js` — unified menu, Earth window (CSS animation), ambient sound (Web Audio API), connection nudge.
- **Shared logic**: `app/js/wellbeing/logic.js` — calm session scoring, greenhouse max, pacer timing.
- **UI patterns**: these screens are registered in `app/js/core/commands.js` as `orb_calm`, `race`, `greenhouse`. They follow `app/js/core/stages.js` for lifecycle. The intervention menu is opened from `app/js/core/director.js` which routes wellbeing actions to the right tool.
- **State integration**: tool results flow into `intervention_log` in the state (`shared/contract.json`). The wellbeing engine reads these logs for tool ranking.

---

## 11. Feature 6: Dataset and Integration (Person 6)

### 11.1 Purpose and scope

Own the seed data, the NASA MRID dataset catalogue, the anomaly engine wiring, shared config files, and the job of merging the other five modules into one working product. This person is the glue: they make sure events flow correctly between modules, the state store serves every screen, and the demo runs end to end.

### 11.2 NASA MRID dataset

The `dataset/` folder contains **94 PDF files** (68 unique, 26 duplicates) from NASA's Medical Requirements Integration Documents (JSC 28913). These are the real NASA medical standards that define what measurements, exams, and monitoring astronauts undergo. The catalogue is in `dataset/_catalog.json` with:

- SHA256 hash, PDF title, extracted document ID (MRID number)
- Classification by primary owner (P1–P6)
- Confidence level (high when docId extracted, medium otherwise)

**Distribution by owner:**

| Owner             | Count | Examples                                                                    |
| ----------------- | ----- | --------------------------------------------------------------------------- |
| P1 (Radiation)    | 11    | TEPC, personal dosimeters, RAD, REM2, CPDS                                  |
| P2 (Body)         | 19    | Physical exam, dental, ophthalmology, bone density, body mass, MRI, skin    |
| P3 (Face/Voice)   | 2     | Neurological assessment (overlaps), hearing conservation                    |
| P4 (Vitals)       | 17    | Clinical labs, ECG, fitness testing, cardiovascular, pulmonary              |
| P5 (Lonely Games) | 0     | (No NASA MRIDs cover games directly; P5 uses wellbeing research references) |
| P6 (Integration)  | 19    | Air quality, water quality, toxicology, EVA prebreathe, general procedures  |

### 11.3 Shared config files owned by P6

- `shared/contract.json` — the frozen state contract (snapshot schema)
- `shared/thresholds.json` — reference ranges with sources
- `shared/facts.json` — per-indicator explainers (what, how to measure, why it matters)
- `shared/med_kit.json` — onboard kit items with location and tags
- `shared/mock_data.json` — 6 mock crew members (James, Amara, + 4 more) with 14-day SIM history
- `shared/SOURCES.md` — source citations for all medical content

### 11.4 What is actually built

- **State store** (`brain/core/store.py`): stores state per crew member in `data/state.json`. History is append-only per numeric field, capped at 2000 points.
- **Decision pipeline**: on every state patch: `radiation.py` (dose calc) → `thresholds.py` (absolute checks) → `drift.py` (baseline deviation) → `decision.py` (ordered rules → action).
- **Ground handoff** (`brain/mission/ground.py`): store-and-forward with SIM 12.7-min delay, packet queue with status states (queued → in transit → delivered → awaiting reply).
- **Mock data seeder**: 6 crew members with randomised baselines and 14-day history with injected scenarios.
- **Frontend event bus** (`app/js/core/bus.js`): simple pub/sub (emit/on/once) for UI events.

### 11.5 Integration plan — merge order

| Phase   | What                                                                | Depends on | Done when                                  |
| ------- | ------------------------------------------------------------------- | ---------- | ------------------------------------------ |
| Phase 0 | State store, event bus, mock data, environment profiles             | Nothing    | Any module can emit and read a reading     |
| Phase 1 | Wire P4 (vitals) typed entries into the store and decision pipeline | Phase 0    | Type a BP → see colour change on body (P2) |
| Phase 2 | Wire P3 (face/voice) camera readings into the store                 | Phase 0    | Camera scan → pulse appears in state       |
| Phase 3 | Wire P1 (radiation) feed into the store and radiation screen        | Phase 0    | Radiation screen shows live feed data      |
| Phase 4 | Wire P2 (body) zone clicks to indicator panel and symptom entry     | Phase 1    | Click zone → see indicators                |
| Phase 5 | Wire P5 (lonely games) intervention events to store                 | Phase 1    | Orb Calm → intervention_log recorded       |
| Phase 6 | End-to-end: check-in → anomaly → card → protocol → recheck → digest | All        | Golden scenarios S1–S19 pass               |

### 11.6 Functional requirements

| ID    | Requirement                                                                         | Priority |
| ----- | ----------------------------------------------------------------------------------- | -------- |
| INT-1 | State store persists per crew member, rejects readings without label and confidence | M        |
| INT-2 | Decision pipeline runs on every state patch: thresholds → drift → decision          | M        |
| INT-3 | Event bus connects all modules; every event writes an audit entry                   | M        |
| INT-4 | Mock data with 6 crew and 14-day SIM history loads on startup                       | M        |
| INT-5 | Ground handoff: digest queue, store-and-forward, delay simulator                    | S        |
| INT-6 | Shared config files (thresholds, facts, med_kit) are sourced and versioned          | M        |
| INT-7 | All 5 feature modules merge and run end to end                                      | M        |
| INT-8 | Golden scenarios S1–S19 and acceptance tests AC-1–AC-22 all pass                    | M        |
| INT-9 | Dataset catalogue maintained with per-person ownership                              | S        |

### 11.7 Events (integration-level)

| Event            | Payload                         | Emitted when                 |
| ---------------- | ------------------------------- | ---------------------------- |
| `status.updated` | `{ crewId, snapshot }`          | Any indicator changes level  |
| `anomaly.raised` | `{ assessment }`                | Pattern or threshold breach  |
| `digest.queued`  | `{ crewId, priority, content }` | A digest is ready for ground |
| `digest.changed` | `{ digestId, state }`           | Digest state transitions     |

### 11.8 Tests

| ID  | Scenario                                         | Expected                                          |
| --- | ------------------------------------------------ | ------------------------------------------------- |
| SI1 | Store rejects reading without label              | Error returned, reading not stored                |
| SI2 | Full decision pipeline on a drifting crew member | Level 2 assessment, recommendation card generated |
| SI3 | Ground digest queued offline, link opens         | Digest sends; urgent first                        |
| SI4 | All 6 mock crew members load                     | 6 crew in state, 14 days of history each          |
| SI5 | End-to-end: check-in to digest                   | Check-in → assessment → card → recheck → digest   |
| SI6 | Event bus audit                                  | Every emitted event appears in the audit log      |
| SI7 | All golden scenarios pass                        | S1–S19 green                                      |

### 11.9 Dataset and codebase

**Your NASA MRIDs (19 files).** These cover air quality, water quality, toxicology, EVA prebreathe protocols, and general operational procedures. These are the cross-cutting documents that don't belong to a single body system — they cover the environment and operational context that affects everyone.

**How to use them:** As the integration person, your dataset responsibilities are:

1. **Maintain `dataset/_catalog.json`** — keep the ownership assignments (P1–P6) accurate as the team discovers documents relevant to their features
2. **Extract cross-cutting thresholds** — air quality limits, water quality standards, and toxicology thresholds go into `shared/thresholds.json` with MRID sources
3. **Feed operational context** — EVA prebreathe protocols inform mode-switching logic; general procedures inform the escalation policies in environment profiles
4. **Serve as the source librarian** — when another person needs a sourced value, help them find it in the dataset and cite it properly

**Existing codebase to build on.** You own the entire backend and integration layer:

- **Server**: `server.py` — the FastAPI application. All HTTP endpoints, WebSocket connections, and the startup sequence.
- **State store**: `brain/core/store.py` — the core persistence layer. Every module writes through this. History is append-only per numeric field, capped at 2000 points.
- **Decision pipeline**: `brain/rules/thresholds.py` → `brain/rules/drift.py` → `brain/rules/decision.py` — runs on every state patch. You wire new modules into this chain.
- **Ground handoff**: `brain/mission/ground.py` — store-and-forward with SIM delay. Digest queue with state transitions.
- **Shared config**: `shared/contract.json` (state schema), `shared/thresholds.json` (ranges), `shared/facts.json` (indicator explainers), `shared/med_kit.json` (kit items), `shared/mock_data.json` (6 crew, 14-day history).
- **Frontend bus**: `app/js/core/bus.js` — pub/sub for UI events. You ensure all module events flow correctly.
- **Screen registration**: `app/js/core/commands.js` — the master list of all screens. You add new screens here when other modules deliver them.
- **Scenarios**: `brain/scenarios.py` / `brain/demo/scenarios.py` — the scenario engine that drives the demo. You configure which scenario runs.

**Your integration job:** When P1–P5 deliver their modules, you:

1. Verify their events emit correctly and match the contract in this document
2. Wire their readings into the decision pipeline (thresholds → drift → decision)
3. Register their screens in `commands.js`
4. Run the golden scenarios end-to-end
5. Fix any cross-module bugs
6. Ensure the demo flows smoothly with all 6 modules together

---

# Part 4 : Clinical Experience & Workflows

## 12. The Clinic Model and a Day With Sentinel

### 12.1 Five modes

| Mode                    | When                              | What happens                                                                    |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| **Monitor**             | Continuous, passive               | Camera, voice and cabin feeds update status quietly; the anomaly engine watches |
| **Check-up**            | Scheduled (daily)                 | Guided check-in: scan, typed entries, mood, reaction test, summary              |
| **Triage**              | "I don't feel well" or an anomaly | Pick body zone, answer a few questions, get an urgency level                    |
| **Treat and follow up** | After triage                      | Protocol steps, kit item, timers, recheck reminder, outcome logged              |
| **Escalate**            | Urgent, or the protocol says so   | Digest to the flight surgeon, crew buddy alerted, store-and-forward if delayed  |

### 12.2 A day with Sentinel

| Time block          | Context      | What Sentinel does                                                                            |
| ------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| Wake                | Just up      | Two taps: hours slept and mood (under 10 seconds)                                             |
| Morning check-in    | Scheduled    | Camera scan, typed entries, reaction test, summary; about 2 minutes; ends with one clear line |
| Work block          | Heads-down   | Passive monitoring; silent unless it matters                                                  |
| Exercise            | Scheduled    | Pre-exercise reminder; logs the session and suppresses expected pulse changes                 |
| EVA or sortie       | Overlay mode | Readiness check; strict suit-air limits; reminders paused; recovery check; voice-first        |
| Something feels off | Any time     | "Hey Sentinel, I have a headache" starts triage                                               |
| Evening             | Wind-down    | Sleep wind-down reminder, mood check, Orb Calm if stress is up, daily summary                 |
| Night               | Sleep block  | Do-not-disturb; only urgent and cabin alerts break through                                    |
| Weekly              | Review       | Trend report, what worked; optional share with the surgeon                                    |

## 13. Environments and Modes

### 13.1 Telling Sentinel where you are

Four ways, all ending in a confirmation: (1) **voice**: "Hey Sentinel, we're in the transit cabin now"; (2) **picker** in Settings or the chip at the top of Home; (3) **mission-planner preload**, confirmed by the astronaut on first run; (4) **gentle auto-suggest** from the schedule or cabin feed (never switches on its own).

Rules: Sentinel always confirms before switching, because ranges and escalation change. No answer means no change. It remembers the last confirmed environment. If the environment is unknown it uses the most cautious escalation policy and asks once.

| What the astronaut says                                         | Sentinel understands               |
| --------------------------------------------------------------- | ---------------------------------- |
| "space station", "in orbit", "on the station"                   | Environment: station               |
| "spacecraft", "space cabin", "in transit", "on the way to Mars" | Environment: transit               |
| "moon base", "Mars base", "surface habitat", "on the base"      | Environment: planetary base        |
| "going outside", "EVA", "spacewalk", "taking the rover out"     | Mode: EVA or sortie                |
| "going to sleep", "rest time"                                   | Mode: rest                         |
| Anything else                                                   | Sentinel asks which option applies |

```
Astronaut: Hey Sentinel, we're in the transit cabin now.
Sentinel:  Switching to deep-space transit. Ranges, kit, reminders and what I
           advise will update. Confirm?
Astronaut: Yes.
Sentinel:  Done. For the next few days I'll treat small changes as you settling
           in, and I'll still alert on air and safety limits.
```

### 13.2 Environments and modes

**Environment** is where you are; **mode** is what is happening.

| Environment              | In plain words                        | Watches harder                                    | Help and how fast                                             | Default escalation                                |
| ------------------------ | ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Station                  | Orbiting station with regular contact | Cardiovascular, exercise, eyes, sleep             | Ground reachable most of the time; a return vehicle is docked | Escalate early; ground can advise                 |
| Transit                  | Spacecraft cabin between worlds       | Behavioral, sleep, teamwork, nutrition, cabin air | Delayed reply; no quick return                                | Onboard first; priority digest for level 2 and up |
| Planetary base           | Surface habitat on the Moon or Mars   | Partial-gravity effects, injury, EVA, behavioral  | Delay depends on the world; limited return                    | As transit, plus EVA protocols                    |
| Launch, landing, docking | Short critical phases                 | Motion, stress, rapid checks                      | Mission procedures lead                                       | DESIGNED only                                     |

| Mode          | What changes                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Routine       | Normal ranges, full reminders                                                                                  |
| EVA or sortie | Strict suit-air limits; routine reminders paused; readiness and recovery checks; short protocols; abort advice |
| Rest          | Quiet hours; only urgent and cabin alerts break through; sleep tracking                                        |
| Contingency   | Emergency or drill: minimal screen, mission emergency procedures first, crew alerted, priority digest          |

The key idea is **wait tolerance**: how long a problem can safely wait for ground help. It comes from the profile. A long wait means Sentinel carries more of the treatment itself; a short one means it escalates sooner.

### 13.3 Same problem, different plan

Advice is procedural: who to tell, how fast to escalate, what to use, whether a return is possible. Medical specifics come from sourced protocols and the mission's own procedures.

| Situation                    | Station                                                                                                     | Transit                                                                                                                                | Base                                                                          | Sortie (EVA)                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Severe symptom** (level 3) | Alert a crewmate, contact ground now, follow mission procedures; a return vehicle exists and ground decides | Alert crewmate and commander, run the onboard protocol, priority digest; no quick return, so treat in place and expect a delayed reply | As transit; move to the medical area if safe; plan on help from the crew only | Stop work, call the crew, start the return to airlock or base per EVA procedure; treat after return |
| **Air alarm**                | Alarm and spoken steps; mission emergency procedure; tell ground                                            | Same; say which compartment; all crew alerted; more self-reliance                                                                      | Same; also check airlock and suit stores                                      | Read suit values first; strict limits; abort advice read out                                        |
| **Poor-sleep pattern**       | Wind-down reminders; raise at next ground contact                                                           | Light and schedule suggestions; closer tracking; weekly digest                                                                         | As transit, with day-length and workload context                              | Fatigue check before EVA; flag to the commander before risky tasks                                  |
| **Low mood or high stress**  | Calm tools, talk to a crewmate; ground psychological support can be scheduled                               | Calm tools, "what helps me" plan, more frequent check-ins; digest if it persists                                                       | As transit, plus connection nudges                                            | Short pause and breathing, tell the crew lead, recheck after return                                 |

Protocols hold this as `variants` per environment and mode (section 13.5).

### 13.4 Environment profile (config)

An environment profile is a config file. Switching it changes thresholds, schedule, kit, reminders and escalation, then recomputes every status. The same code runs everywhere.

```json
{
  "id": "transit",
  "label": "Deep-space transit",
  "comms": { "mode": "delayed", "one_way_delay_s": null },
  "return_option": "none",
  "resupply": "none",
  "kit_id": "kit_transit_v1",
  "indicator_weights": { "sleep_hours": 1.0, "mood": 1.2, "heart_rate": 1.0 },
  "threshold_overrides": {},
  "escalation_policy": {
    "act": "queue_digest",
    "urgent": "send_now_and_alert_commander",
    "wait_tolerance_min": null
  },
  "schedule_template": "transit_day_v1",
  "hazard_focus": ["isolation_confinement", "distance", "radiation"]
}
```

`null` means "set from mission documents". We do not invent delay or tolerance numbers; the demo uses a labelled SIM value.

### 13.5 Settling in

When the environment changes, a person's numbers often shift. Baselines carry an environment tag. For the first few days after a confirmed switch (tunable, start at 3), Sentinel keeps the old baseline, softens personal-deviation and trend alerts to a gentle "adjusting to a new environment" note, and still alerts at full strength on range limits, cabin air and red-flag symptoms.

## 14. Personal Health Profile

### 14.1 Principles

Built in short sessions and **grows over time** (Sentinel asks one new profile question at a check-in when something is missing). Can be **preloaded** by the flight surgeon or mission planner, then confirmed and edited by the astronaut. Stays on the device; sensitive parts leave only with consent. Used to make advice safer and more personal, never to judge.

### 14.2 What the profile holds

| Section                  | Holds                                                                              | Filled by                     | Used for                                       |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| Identity and preferences | Name or callsign, language, units, voice style, glove mode, reminder times         | Astronaut                     | Tone, language, reminder timing, accessibility |
| Mission context          | Environment, mode, duty and EVA schedule, sleep block                              | Planner, astronaut            | Schedules, quiet hours, environment rules      |
| Health background        | Allergies, ongoing conditions, regular medicines, past reactions to kit items      | Astronaut or flight surgeon   | Kit safety filter, notes on cards              |
| Personal baselines       | "My normal" per indicator                                                          | Automatic; surgeon can adjust | Anomaly detection                              |
| Wellbeing plan           | My early signs, what helps me, who I would talk to, camera mood analysis on or off | Astronaut                     | Support flows                                  |
| Sharing and consent      | Who sees what                                                                      | Astronaut                     | Alerts, digests                                |
| Emergency preferences    | Crew buddy, commander, order of contact                                            | Astronaut, planner            | Urgent alerts                                  |

### 14.3 How it is built

1. **Day 0, about three minutes:** name, language, environment, consent, kit confirmation, buddy.
2. **Days 1 to 3, a few questions at a time:** health background, reminder times, wellbeing plan.
3. **Days 3 to 7:** baselines complete themselves; the screen shows "Calibrating (n of N)".
4. A **completeness meter** shows what is empty; nothing is forced.

### 14.4 What the profile changes

| Profile content             | Visible effect                                                       |
| --------------------------- | -------------------------------------------------------------------- |
| An allergy or past reaction | The matching kit item is blocked on cards, with the reason           |
| A regular medicine          | A "check the label and your surgeon" note on related kit suggestions |
| Duty and sleep schedule     | Reminders land at sensible times and respect rest                    |
| "What helps me"             | Calming tools offered in the order that suits that person            |
| "My early signs"            | Sentinel recognises them when the astronaut reports them             |
| Buddy and consent choices   | Urgent alerts go to the right person; nothing else is shared         |
| Surgeon-adjusted baseline   | Alerts use the corrected "normal"                                    |

Safety rules: the astronaut can view, export and delete the profile at any time; health background is never placed in a digest unless the astronaut or surgeon chooses; missing health information shows as "profile incomplete, check the label" next to kit suggestions (Sentinel does not guess); the target is encryption at rest on the device.

## 15. Mental Wellbeing

### 15.1 Purpose and limits

Help the astronaut notice changes early, give them tools that work for them, and bring in a person when it matters. Sentinel supports; it does not treat, diagnose or label a condition. It speaks about **change from your usual**, never about disorders.

### 15.2 Four dimensions

| Dimension  | Signals used                                                                                                   | Shown as                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Mood       | Mood self-rating, expression valence and arousal, optional tags (tired, irritable, anxious, lonely, motivated) | Trend plus "steady" or "lower than usual" |
| Energy     | Sleep hours and quality, energy self-rating, reaction time                                                     | Trend and a readiness note                |
| Stress     | Stress self-rating, resting pulse trend, arousal                                                               | Trend and a stress-spike marker           |
| Connection | Connection self-rating, talk-time share, time alone, missed check-ins                                          | Trend and a gentle prompt to connect      |

There is no single "wellbeing score": four dimensions are harder to misread and to game.

### 15.3 Signals and their limits

| Signal                                          | Source         | Limit                                                           |
| ----------------------------------------------- | -------------- | --------------------------------------------------------------- |
| Daily mood and energy taps (10 seconds)         | Astronaut      | Self-report can be hidden or exaggerated                        |
| Expression valence and arousal                  | Camera model   | Noisy, culturally uneven; never used alone; can be switched off |
| Voice: talk time, pitch                         | Microphone     | Context changes it                                              |
| Reaction time and lapses                        | 30-second test | Also moved by sleep and caffeine                                |
| Engagement: missed check-ins, skipped reminders | System         | Busy is not withdrawn                                           |
| Social: time alone, talk-time share             | Speaker ID     | Needs a crew of more than one                                   |
| Weekly short reflection (3 to 5 questions)      | Astronaut      | Wording must be clinician-approved                              |

### 15.4 Wellbeing levels

| Level            | Looks like                                                                           | Sentinel does                                                                                                      | Example wording                                                                |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 0 Steady         | Near the person's usual                                                              | Normal routine                                                                                                     | "You're steady."                                                               |
| 1 Check-in       | One dimension drifting                                                               | Asks gently, offers one tool                                                                                       | "Your energy has been lower than usual. Want a short reset?"                   |
| 2 Support plan   | Two or more dimensions drifting, or one for several days                             | Opens the support flow, offers the top three tools from "what helps me", suggests a crewmate chat, queues a digest | "A few things have shifted this week. Here are three that have helped before." |
| 3 Urgent concern | The astronaut reports wanting to harm themselves or others, severe distress or panic | Safety script (W14)                                                                                                | "I'm here. Please call a crewmate now. I'm letting them know."                 |

Level 3 never comes from statistics; it comes only from what the astronaut says or reports.

### 15.5 Support toolkit

| Tool                | Offered when           | What it does                                                                                                                      | Label        |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Orb Calm            | Stress up, pulse high  | Biofeedback: the orb starts turbulent and red at the live pulse and settles blue as it falls; paced-breathing ring; logs recovery | LIVE         |
| Paced breathing     | Any stress             | Guided breathing ring                                                                                                             | LIVE         |
| Grounding exercise  | Anxiety, panic signs   | Short sensory exercise                                                                                                            | LIVE         |
| Window to Earth     | Low mood, homesickness | Calm Earth view with soft sound                                                                                                   | LIVE         |
| Sound and music     | Stress, sleep          | Soundscapes and playlists the astronaut chose                                                                                     | LIVE         |
| Private journal     | Low mood, a hard day   | Voice or text note kept only on the device                                                                                        | LIVE (could) |
| Sleep wind-down     | Poor sleep pattern     | Evening routine and reminders                                                                                                     | LIVE         |
| Connection nudge    | Connection dropping    | Suggests a call, a shared meal or a question for a crewmate                                                                       | LIVE         |
| Messages from home  | Low mood               | Recordings made before flight, unlocked by the astronaut                                                                          | DESIGNED     |
| Plant or garden log | Isolation              | Tending a plant (NASA's Space Gardening research looks at easing isolation)                                                       | DESIGNED     |

### 15.6 Support flows and learning

- **Stress spike:** "I'm stressed" by voice, or a pulse and arousal jump. Ask how strong (1 to 5), offer Orb Calm or breathing, log before and after, recheck in a few minutes.
- **Sleep trouble:** after a short-sleep pattern, offer the wind-down routine and a light and schedule tip; recheck in the morning.
- **Low-mood drift:** gentle open question, three tools from "what helps me", a crewmate chat, a recheck; if it persists for several days, propose a conversation with the flight psychologist and queue a digest.
- **Urgent concern:** the safety script (W14).

Every session records stress or mood before and after. Sentinel ranks tools per person by what worked, starting from the astronaut's own "what helps me" list until it has data. This closed loop makes the product personal.

### 15.7 Team wellbeing, tone and safeguards

- **Crew pulse (optional):** two quick weekly questions per member; results at team level only, only when at least three have answered, never with names.
- **Connection nudges** and a **cohesion note** (talk-time balance, shown as a gentle note, never a judgment; maps to NASA's Inadequate Teamwork risk).

| Do                                                   | Don't                         |
| ---------------------------------------------------- | ----------------------------- |
| "Your mood has been lower than your usual this week" | "You may be depressed"        |
| Offer choices ("Want to try one of these?")          | Give orders                   |
| Short, warm sentences                                | Clinical terms, long lectures |
| Respect a "no" and offer to check back later         | Repeat the same prompt        |
| Say what you noticed and why                         | Imply you can read minds      |

Safeguards: not therapy (Sentinel brings in a person as levels rise); camera mood analysis is **opt-in per person** with fallback to self-report and voice; wellbeing data supports the astronaut and is shared with command or ground only by their choice, except the urgent safety flow; all wellbeing wording, the urgent-phrase list and any scales are reviewed by a qualified clinician or psychologist before real use (draft for the hackathon); the face model is calibrated per person and documented in the model card.

## 16. Screens, Navigation and UX

### 16.1 Navigation and screens

Bottom bar: Home, Care, Trends, Plan, Ground. Always present: the voice orb, an "I don't feel well" button and an alert banner area.

| Screen                | Purpose                | Key components                                                                                                            | Special states                             |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Home                  | Status at a glance     | Body figure with colour zones, indicator list, today's reminders, alerts                                                  | Calibrating, no data yet, link status chip |
| Indicator detail      | Understand one reading | Value, status chip with icon and word, trend with baseline band, How to measure, Why it matters, What to do, source label | Low-confidence reading shown as estimate   |
| Check-in flow         | Daily measurements     | Step bar, camera scan, entry forms, reaction test, mood and energy taps, summary                                          | Camera unavailable: manual; resumable      |
| Care: triage          | Work out urgency       | One question per screen, big buttons, body-zone picker                                                                    | Red flag jumps to urgent card              |
| Care: protocol runner | Treat step by step     | Numbered steps, tick boxes, timers, kit item with location, "Contact flight surgeon"                                      | Paused, completed, escalated               |
| Care: log             | History                | Past symptoms, protocols, kit used, outcomes                                                                              | Empty state explains what will appear      |
| Trends                | Patterns               | Per-indicator charts, wellbeing dimensions, sleep and reaction time together, weekly report                               | Not enough data                            |
| Plan                  | Reminders and schedule | Today's list, upcoming, snooze, schedule template                                                                         | Conflicts shown                            |
| Wellbeing             | Mind support           | Four dimensions, mood tap, support tools, crew pulse                                                                      | Urgent: safety script only                 |
| Crew and cabin        | Environment and team   | Cabin O2 and CO2 gauges, talk-time balance, shared crew status                                                            | Cabin alert takeover                       |
| Ground                | Handoff                | Digest queue, send state, replies, delay simulator (demo)                                                                 | Offline, queued, replied                   |
| Profile and settings  | Configure              | Profile sections and completeness, environment and mode, language, units, kit list, consent                               | Profile change preview                     |
| Onboarding            | First run              | Consent, baseline calibration, kit confirmation, voice enrolment                                                          | Resumable                                  |

### 16.2 Home wireframe

```
+--------------------------------------------------------------------------+
| [Environment: Transit v]  [Ground link: delayed]  [EN v]  [Offline OK]   |
+----------------------------+---------------------------+-----------------+
|                            |                           | TODAY           |
|      BODY FIGURE           |   SELECTED INDICATOR      | [ ] Check-in    |
|  zones glow green/amber/   |   value, status, chart    | [ ] Recheck 15m |
|  red; click to open        |   with baseline band      | [ ] Exercise    |
|                            |   How to measure          |                 |
|                            |   Why it matters          | ALERTS          |
|                            |   What to do              | Watch: sleep    |
+----------------------------+---------------------------+-----------------+
|  (orb)  "Hey Sentinel"          [ I don't feel well ]    [ Daily check-in ] |
+--------------------------------------------------------------------------+
```

### 16.3 UX principles for space

- **Voice first, tap second, type last:** hands are busy and typing is awkward.
- **Large targets:** usable with gloves and in motion; no tiny sliders.
- **Low-light and glare safe:** dark theme, high contrast; status never by colour alone.
- **Short, resumable sessions:** a check-in under about 2 minutes.
- **One next step on screen:** never a wall of data when someone is unwell.
- **Calm tone:** short sentences, no alarmist words below level 3.
- **Plain language first, numbers second.**
- Visual language: dark, calm, glowing accents (cyan for calm, amber, red). The orb idles with a slow breathing glow, ripples with mic volume when listening, pulses when speaking, and shifts cyan to red on a warning.

# Part 5: Clinical Intelligence & Detection

## 17. What We Track

**Rule:** if a measurement does not change a status, a recommendation or a reminder, we do not track it. The **group** column is the independence group used for the pattern rule: two indicators in the same group count as one signal.

| Indicator id                              | What and how captured                                  | Label            | Worse when                        | Group        | HRP risk or purpose                                   |
| ----------------------------------------- | ------------------------------------------------------ | ---------------- | --------------------------------- | ------------ | ----------------------------------------------------- |
| `heart_rate`                              | Heart rate (bpm); camera scan, daily and on demand     | LIVE estimate    | high or low                       | cardio       | Cardiovascular Adaptations                            |
| `bp_sys`, `bp_dia`                        | Blood pressure (mmHg); typed from a cuff, daily        | MANUAL           | high or low                       | cardio       | Cardiovascular Adaptations                            |
| `breathing_rate`                          | Breaths per minute; camera and pose, daily             | LIVE estimate    | high or low                       | respiratory  | Supports Hypoxia monitoring                           |
| `spo2`                                    | Oxygen saturation (%); prepared data now, sensor later | SIM              | low                               | respiratory  | Hypoxia                                               |
| `blood_glucose`                           | mg/dL; typed from a meter, as scheduled                | MANUAL           | high or low                       | metabolic    | Inadequate Food and Nutrition                         |
| `temperature`                             | Body temperature (C); typed, daily and when unwell     | MANUAL           | high or low                       | thermal      | General status, illness signal                        |
| `sleep_hours`                             | Hours slept; typed, daily                              | MANUAL           | low                               | sleep        | Inadequate Sleep and Irregular Schedules              |
| `sleep_quality`                           | 1 to 5; tapped, daily                                  | MANUAL           | low                               | sleep        | Inadequate Sleep and Irregular Schedules              |
| `reaction_ms`, `reaction_lapses`          | 30-second reaction test                                | LIVE             | high                              | cognitive    | Fatigue and performance                               |
| `valence`, `arousal`                      | Expression model over a rolling window                 | LIVE             | low valence; arousal high or low  | mood         | Behavioral Changes and Psychiatric Disorders          |
| `mood_self`, `stress_self`, `energy_self` | 1 to 5 taps, daily                                     | MANUAL           | low (mood, energy); high (stress) | mood, energy | Behavioral Changes and Psychiatric Disorders          |
| `connection_self`                         | 1 to 5 tap                                             | MANUAL           | low                               | social       | Inadequate Teamwork, isolation                        |
| `talk_share`, `time_alone_pct`            | Speaker ID, rolling                                    | LIVE or SIM      | low vs own norm; high vs own norm | social       | Inadequate Teamwork                                   |
| `voice_pitch`                             | Microphone, rolling                                    | LIVE             | change vs own norm                | voice        | Behavioral signal                                     |
| `exercise_minutes`                        | Quick log; accelerometer later                         | MANUAL, DESIGNED | low                               | activity     | Reduced Cardiorespiratory and Musculoskeletal Fitness |
| `hydration_log`                           | Meals and fluids, quick log                            | MANUAL (could)   | low                               | nutrition    | Inadequate Food and Nutrition                         |
| `cabin_o2`, `cabin_co2`                   | Simulator now, sensor later, continuous                | SIM              | low (O2); high (CO2)              | cabin        | Hypoxia, hostile or closed environment                |
| `rad_dose_rate`                           | Current dose rate from space-weather feed              | SIM              | high                              | radiation    | Risk of Radiation-Induced Cancers                     |
| `rad_cumulative`                          | Running cumulative exposure from feed                  | SIM              | high                              | radiation    | Risk of Radiation-Induced Cancers                     |
| `rad_event_level`                         | Storm level: quiet, elevated, storm                    | SIM              | storm                             | radiation    | Risk of Radiation-Induced Cancers                     |
| `shelter_status`                          | Whether shelter is advised                             | SIM              | true                              | radiation    | Risk of Radiation-Induced Cancers                     |
| `missed_checkins`                         | System counts missed or skipped reminders              | LIVE             | high                              | adherence    | Missed check-ins are a signal                         |

**Non-reading records:** symptoms (zone, type, severity 0 to 10, onset, duration), protocol runs (steps done, outcome), kit usage, alert feedback (useful or not), schedule context (sleep blocks, exercise, EVA), data-quality scores, mood tags (context only), journal entries (a count and timestamp only; the text stays in a separate on-device store the engine never reads), crew pulse answers (no identity) and the audit log of every event.

**Reference ranges rule:** no invented limits. Every range lives in `thresholds.json` with a source. Use the NASA material from the challenge's Resources tab where it gives a range; otherwise use a widely published adult range as a **demo default** and mark it so on screen. This is a self-check aid, never a diagnosis.

## 18. How Sentinel Detects Something Abnormal

### 19.1 The pipeline

| Stage     | Input                          | Output                                                 | Failure handling                                                  |
| --------- | ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Ingest    | Reading from any source        | Raw reading with source and time                       | Unknown source rejected and logged                                |
| Validate  | Raw reading                    | Pass or flag: sane range, plausible change, confidence | Implausible value: ask the user to remeasure; never silently drop |
| Normalize | Valid reading                  | Standard units, onboard-clock timestamp, label         | Unit mismatch converted or rejected                               |
| Store     | Normalized reading             | Local record, audit event                              | Write failure retried; user warned                                |
| Derive    | History                        | Baseline, trend, features, data-quality score          | Too little data: reference ranges only, "calibrating"             |
| Assess    | Derived state plus environment | Level 0 to 3, reasons, confidence                      | Low confidence: downgrade or require another signal               |
| Decide    | Level, symptoms, profile, kit  | Recommendation, reminders, digest, alerts              | No matching protocol: generic card plus escalate                  |
| Present   | Decision                       | Screen, voice, sound per level                         | Voice unavailable: screen and sound                               |
| Learn     | Outcomes and feedback          | Which intervention worked, alert tuning                | Bounded: never loosens safe limits                                |

### 19.2 Five layers, cheapest first

Any layer can raise a flag; the reason is always shown.

1. **Safe limits:** a reading outside its reference range (from `thresholds.json`, per environment) is amber or red at once. Cabin O2 and CO2 live here.
2. **Personal baseline:** distance from that person's own recent median, in robust deviations (median and median absolute deviation). Catches "normal for most people, abnormal for you."
3. **Trend:** slope over several days, such as sleep falling night after night.
4. **Pattern across signals:** two or more independent signal groups moving the wrong way inside one window raise a **pattern** flag (for example slower reactions, flatter mood and shorter sleep).
5. **Context and quality:** suppress expected changes (higher pulse after exercise or EVA) and ignore low-confidence readings unless another signal agrees.

Personal baseline: a rolling median and spread over a recent window, excluding readings tagged post-exercise, EVA or illness and readings below minimum confidence. Until enough readings exist the screen says "Calibrating (3 of 7)" and only reference ranges apply. Window length, minimum count, deviation cut-offs and trend cut-offs are **tunable** values, not spaceflight facts; formulas are in section 21.

### 19.3 Levels and colours

Level 0 normal (green), 1 watch (amber), 2 act (amber), 3 urgent (red). **Level 3 comes only from range limits, red-flag symptoms or cabin limits, never from statistics alone.** Personal deviation alone never exceeds level 2.

### 19.4 Alert lifecycle

| State        | Meaning                         | Moves on when                                                                |
| ------------ | ------------------------------- | ---------------------------------------------------------------------------- |
| Detected     | Engine raised it                | Always shown or queued                                                       |
| Presented    | Shown or spoken                 | User taps or answers; otherwise re-presented louder after a timeout (config) |
| Acknowledged | User has seen it                | User accepts the steps or dismisses with a reason                            |
| Acting       | Protocol running                | Steps ticked or timer ends                                                   |
| Rechecking   | Reminder fired, user remeasures | Reading back in range, or not                                                |
| Resolved     | Back to normal or user confirms | Alert closes, outcome logged                                                 |
| Escalated    | Not resolving, or red flag      | Digest sent or queued; crew buddy alerted if level 3                         |
| Expired      | No response at all              | Escalates modality; a missed urgent alert alerts the buddy                   |

### 19.5 Alert-fatigue controls and explainability

- One alert per cause: related signals group into a single pattern alert with all reasons.
- Cooldown per alert type; re-alert only if the situation worsens.
- Snooze needs a reason and has a limit; urgent alerts cannot be snoozed.
- "Not useful" feedback makes that rule less sensitive within bounds, never below safe limits.
- Quiet hours respected; only urgent and cabin alerts break through.
- Every alert stores which readings, rule, baseline and source produced it; a "Why this?" button shows it in plain words.

**Honest note on data:** we are not aware of a public labelled dataset of astronaut health anomalies, so the anomaly engine is statistical and rule-based, which keeps it explainable. We validate it on synthetic crew histories with injected scenarios (section 26) and say so.

## 19. Triage, Recommendations and Protocols

### 19.1 Triage logic

1. A symptom arrives (zone, type, severity 0 to 10, answers) or an alert needs a card.
2. Find protocols whose triggers match the symptom or the alert's rule ids.
3. Evaluate red flags against the answers. Any red flag sets level 3 and escalate.
4. Otherwise set the level from severity and the matched alert. Demo default (tunable, clinician to confirm): severity 0 to 3 is level 1, 4 to 6 level 2, 7 to 10 level 3.
5. No protocol matches: produce a generic card ("We could not match this to a protocol"), level at least 2, and escalate.
6. Build the card, apply the environment variant and the kit filter, create the recheck reminder, queue the digest as the environment's escalation policy says.

### 19.2 Urgency ladder

| Level    | Meaning                                             | Sentinel does                                                                  | Ground                            |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| 0 Normal | Within range and near baseline                      | Shows green, keeps routine reminders                                           | Nothing                           |
| 1 Watch  | Small or single-signal change                       | Explains, suggests self-care, sets a recheck                                   | Noted in the next digest          |
| 2 Act    | Clear change or a pattern                           | Full protocol and kit item, recheck timer, asks the astronaut to confirm steps | Digest queued for the next window |
| 3 Urgent | Red flag, severe symptom or dangerous cabin reading | Immediate steps first, alerts crew buddy and commander, loud and spoken        | Priority digest sent now          |

In any real emergency the mission's emergency procedures come first; Sentinel alerts and reads them out, it does not replace them.

### 19.3 Recommendation card

1. **What we see:** readings and change from baseline, in plain words.
2. **How sure:** high, medium or low, with why.
3. **What to do now:** three to five numbered steps from a protocol.
4. **What to use:** an item from the active kit, by name; dosing only as the kit label or protocol states.
5. **Recheck:** a reminder created automatically.
6. **Escalate if:** clear red-flag triggers.
7. **Why it matters:** the hazard and HRP risk behind it, in one line.

```
WATCH  Resting heart rate +<X>% vs your usual, 2 days running
Sure?  Medium (camera estimate; sleep entry is typed)
Now    1. Sit and rest <N> min, then re-measure with the manual method
       2. Log water and meals today
       3. Do the breathing exercise (Orb Calm)
Use    Nothing needed. If headache starts: <kit item> as the kit label states
Recheck  Reminder set for <time>
Escalate if  chest pain, fainting, or reading stays red after recheck
Why    Cardiovascular Adaptations: circulation changes in weightlessness
```

### 19.4 Protocol library

Each protocol has triggers, questions, red flags, steps, kit items, a recheck interval and a source. Starter set (eight to ten for the hackathon, each with sourced content): headache; high stress or low mood; poor sleep; high resting heart rate; high blood pressure reading; glucose out of range; raised temperature; low cabin oxygen or high CO2 symptoms; dizziness or motion sickness; vision change (always escalate; ties to the SANS risk). A protocol without a source loads as `unverified` and is never shown as an instruction.

### 19.5 Variants and the kit filter

A protocol may define `variants` per environment or mode; the variant is merged over the base (variant wins, arrays replaced). Each variant needs its own source or is marked unverified. See the YAML in section 19.

`filterKit(kitItems, profile)` returns allowed items, blocked items with reasons, and notes: block an item whose class or tags match a profile allergy or past reaction; allow but note "check the label and your surgeon" for a regular medicine match; note "profile incomplete, check the label" when health data is missing; never assume an unknown match is safe. Sentinel suggests only items that exist in the active kit.

### 19.6 Presentation by level

| Level | Screen                         | Voice                     | Sound      | Orb         | Breaks through quiet hours |
| ----- | ------------------------------ | ------------------------- | ---------- | ----------- | -------------------------- |
| 0     | Green chips                    | Only on request           | None       | Cyan idle   | No                         |
| 1     | Badge and card in the feed     | At check-in or on request | None       | Soft amber  | No                         |
| 2     | Banner and recommendation card | Calm spoken summary       | Soft chime | Amber pulse | No                         |
| 3     | Full-screen takeover           | Spoken, repeated          | Alarm tone | Red         | Yes                        |

## 20. Reminders and Scheduling

**Types:** check-in, measurement, treatment timer, recheck, exercise, hydration and meals, sleep wind-down, mood, kit check. **Delivery:** screen, voice and an orb pulse.

Scheduling algorithm:

1. On profile load, expand the schedule template into reminders for the next seven days.
2. A one-minute tick moves due reminders to `due` and emits `reminder.due`.
3. Presentation respects sleep and EVA blocks. Protocol reminders (recheck, treatment timer) outrank routine ones.
4. A reminder with no response after `missAfterMin` becomes `missed`, is re-presented once after `retryMin` with a softer prompt, and if missed again increments `missed_checkins`.
5. Three misses in a row add a line to the next digest; never phrase it as a judgment.
6. Accepting a recommendation creates a `recheck` reminder at now plus `recheckAfterMin`.
7. Snooze is allowed with a limit; repeated misses are themselves a wellbeing signal.

## 21. Ground Handoff

Triggers: level 2 and above, a user request, or the weekly review. The digest is a few lines of text, never video, audio or images.

```
SENTINEL DIGEST | crew: james | env: transit | priority: ACT | onboard time: <t>
Summary: two-day pattern: resting HR above own baseline, sleep short, reaction time slower, mood flatter.
Readings: HR <v> (baseline <b>, camera estimate) | sleep <v> h (manual) | reaction <v> ms (test) | mood 2/5 (self)
Actions taken: rest and breathing exercise done; recheck at <t>: no change
Kit used: none
Question for flight surgeon: advice on persistent fatigue pattern.
Trend: 7-day numbers attached (no video, no images)
State: queued > sent > acknowledged > reply received
```

- **Queue states:** queued, sent, acknowledged, replied. Urgent items send first when the link opens; the queue persists offline.
- **Replies:** a ground reply appears as a Ground card with the instructions; the astronaut confirms each step before it is logged. The card shows the age of the reply and when the question was sent, so stale advice is visible.
- **Delay simulator (demo):** a split screen: left "what ground sees" (stale status and a countdown), right "what Sentinel did just now", tagged onboard or escalated.
- **Privacy:** the digest carries only what is relevant; health background is included only if the astronaut or surgeon chooses.

## 22. Core Workflows

**W1. First run and calibration.** Trigger: first launch or a new crew member. Explain what is tracked and who sees what; consent; pick environment; confirm kit; enrol voice; first check-in; "Calibrating" until enough readings exist. Edge cases: skipped camera (manual-only mode); resume an interrupted setup.

**W2. Daily check-in.** Trigger: reminder or the Check-in button. (1) 30-second camera scan with a confidence readout; (2) typed entries with validation and units; (3) mood and energy taps; (4) reaction test; (5) summary with one headline and a status per indicator; (6) any flag opens its recommendation card. Edge cases: camera blocked; out-of-range entry prompts a remeasure; interrupted flow saves progress; low confidence marked "estimate".

**W3. Passive monitoring to anomaly.** Trigger: new readings from camera, voice or cabin. Validate, derive, assess; on a pattern Sentinel asks gently by voice ("You seem tired. Want to check in?"); yes opens W2 or W4, no sets a recheck. A low-confidence reading alone never alerts; expected changes after exercise are suppressed.

**W4. "I don't feel well": triage, treat, follow up.** Trigger: button, voice, or an anomaly the user confirms. (1) body zone, symptom, severity; (2) three or four protocol questions; (3) urgency level 1 to 3; (4) recommendation card; (5) protocol runner; (6) kit item shown; (7) recheck reminder; (8) at recheck, remeasure or confirm; (9) resolved or escalated; (10) outcome logged. Any red flag skips to immediate steps, alerts the buddy and queues a priority digest.

**W5. Cabin or emergency alert.** Trigger: a cabin reading crosses a limit. Full-screen takeover, loud and spoken alert, immediate steps, buddy and commander alerted, symptom questions to the crew, priority digest. Mission emergency procedures take precedence. SIM in the demo.

**W6. Reminder lifecycle.** Scheduled from the template, then due, presented, done, snoozed or missed (section 14).

**W7. Ground handoff and reply.** Build the digest, queue with priority, send when the link opens, show state, present replies as Ground cards (section 15).

**W8. Environment and mode change.** Trigger: voice, picker, planner preload or auto-suggest. Match the phrase; ask "Switch to {environment or mode}?"; on yes reload ranges, kit, schedule, escalation and protocol variants; recompute statuses; start settling-in if the environment (not just the mode) changed; show a banner listing what changed. EVA overlay: readiness check, reminders paused, strict suit-air limits, recovery check afterwards. Unknown phrase: ask; no reply: no change.

**W9. Weekly review.** Summary of trends, what interventions worked, adherence and open items; the astronaut chooses what to share with the surgeon.

**W10. Build the personal profile.** Day 0 essentials, later short question sets, completeness meter; the astronaut or flight surgeon edits any section; the kit filter and reminders update at once.

**W11. Daily mood and energy tap.** Tap mood and energy (1 to 5), optional tags; the wellbeing engine updates the four dimensions.

**W12. Low-mood drift support.** Trigger: wellbeing level 1 or 2. Gentle question; offer the top three tools; the astronaut picks or declines; log before and after; schedule a recheck; if the drift persists for several days offer a conversation with the flight psychologist and queue a digest.

**W13. Stress spike.** Trigger: "I'm stressed" or a pulse and arousal jump. Ask strength (1 to 5), offer Orb Calm or breathing, log before and after, recheck in minutes.

**W14. Urgent wellbeing concern.** Trigger: the astronaut says they want to hurt themselves or others, or reports severe distress or panic. Safety script: stay calm and brief; ask them to contact a crewmate or the commander now; alert the buddy and commander; send a priority digest for the flight surgeon or psychologist; keep a grounding screen open; never argue, minimise or try to counsel alone; show only fixed scripted lines, no generated counselling text.

**W15. Crew pulse.** Weekly, opt-in: two quick questions per member; aggregate only when at least three have answered; no names.

# Part 6: Master Requirements Matrix

## 23. Requirements Matrix

Priority: **M** must ship, **S** should, **C** could. Every single functional requirement is explicitly mapped to one owner (P1 to P6) and one feature module so that ownership boundaries are unambiguous.

| ID    | Requirement                                                                                                        | Priority     | Owner    | Feature Module           |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ------------ | -------- | ------------------------ |
| FR-1  | Camera scan estimates heart rate and breathing rate and reads face expression, with a confidence value             | M            | Person 3 | Face, AI Model & Voice   |
| FR-2  | Typed entry for blood pressure, glucose, temperature, sleep hours and mood, with unit labels and range validation  | M            | Person 4 | Vitals & Check-in        |
| FR-3  | Symptom entry: tap a body zone, choose a symptom, rate severity                                                    | M            | Person 2 | Body Model & Zones       |
| FR-4  | 30-second cognitive reaction test with lapse count                                                                 | S            | Person 4 | Vitals & Check-in        |
| FR-5  | Voice capture with wake word "hey Sentinel" and speaker identification                                             | S            | Person 3 | Face, AI Model & Voice   |
| FR-6  | Cabin environment feed (oxygen, CO2) from a simulator                                                              | M            | Person 6 | Dataset & Integration    |
| FR-7  | Wearable ingestion (pulse, SpO2, temperature, eye camera, accelerometer)                                           | C (DESIGNED) | Person 6 | Dataset & Integration    |
| FR-8  | Green, amber or red status for every indicator against reference ranges                                            | M            | Person 4 | Vitals & Check-in        |
| FR-9  | Learn each person's baseline from early check-ins; use reference ranges until enough data exists                   | M            | Person 6 | Dataset & Integration    |
| FR-10 | Anomaly detection with the layered method (ranges, deviation, trend, pattern), always with a plain-language reason | M            | Person 6 | Dataset & Integration    |
| FR-11 | Trend over days per indicator, drawn with individual baseline band                                                 | M            | Person 4 | Vitals & Check-in        |
| FR-12 | Data-quality gate: a low-confidence reading cannot raise an alert alone                                            | S            | Person 6 | Dataset & Integration    |
| FR-13 | Clinical triage decision engine returning one of four urgency levels (0 to 3)                                      | M            | Person 6 | Dataset & Integration    |
| FR-14 | Recommendation card generation (seen, sure, do, use, recheck, escalate-if, why)                                    | M            | Person 6 | Dataset & Integration    |
| FR-15 | Evidence-sourced clinical protocol execution engine                                                                | M            | Person 6 | Dataset & Integration    |
| FR-16 | Active medical kit safety filter (suggest only available, non-contraindicated items)                               | M            | Person 6 | Dataset & Integration    |
| FR-17 | Follow-up: a recheck reminder is created automatically and the clinical outcome logged                             | S            | Person 6 | Dataset & Integration    |
| FR-18 | Spoken voice assistant responses to "What should I do?" via Brain LLM                                              | M            | Person 3 | Face, AI Model & Voice   |
| FR-19 | Scheduled reminders: check-in, measurements, exercise, nutrition, sleep wind-down                                  | M            | Person 4 | Vitals & Check-in        |
| FR-20 | Treatment and observation timers created by protocols                                                              | S            | Person 4 | Vitals & Check-in        |
| FR-21 | Adaptive reminders: snooze limits, respect sleep/EVA blocks, gentle escalation when missed                         | S            | Person 4 | Vitals & Check-in        |
| FR-22 | Multi-modal reminder delivery via screen banners, spoken voice, and orb glow pulses                                | M            | Person 4 | Vitals & Check-in        |
| FR-23 | Environment profiles (station, transit, base, EVA); switching recomputes thresholds, kit, schedule                 | M            | Person 6 | Dataset & Integration    |
| FR-24 | Communications status indicator (live, delayed, blackout) and wait-tolerance banner                                | S            | Person 6 | Dataset & Integration    |
| FR-25 | Mood trend from facial blendshapes, voice tone, and self-ratings, shown as change from baseline                    | M            | Person 3 | Face, AI Model & Voice   |
| FR-26 | Dynamic ranking and suggestion of calming interventions based on individual empirical efficacy                     | M            | Person 5 | Lonely Games & Wellbeing |
| FR-27 | Privacy-first crew communication balance and talk-time monitoring                                                  | C            | Person 6 | Dataset & Integration    |
| FR-28 | Structured clinical digest builder for ground flight surgeon handoff                                               | M            | Person 6 | Dataset & Integration    |
| FR-29 | Store-and-forward digest transmission queue with priority dispatch                                                 | S            | Person 6 | Dataset & Integration    |
| FR-30 | Interactive split-screen communication delay simulator (onboard vs ground perspective)                             | S            | Person 6 | Dataset & Integration    |
| FR-31 | Interactive 3D clickable body figure with anatomical zone inspection                                               | M            | Person 2 | Body Model & Zones       |
| FR-32 | Triple-redundant visual status language: colour + icon + text label (never colour alone)                           | M            | Person 2 | Body Model & Zones       |
| FR-33 | Multilingual voice interface, glove-friendly large touch targets, low-light high-contrast UI                       | S            | Person 3 | Face, AI Model & Voice   |
| FR-34 | Natural language and picker-based environment selection with mandatory user confirmation                           | M            | Person 6 | Dataset & Integration    |
| FR-35 | Operational mission modes (routine, EVA/sortie, rest, contingency) layered over environment                        | S            | Person 6 | Dataset & Integration    |
| FR-36 | Context-specific protocol variants ensuring different procedural plans per environment                             | M            | Person 6 | Dataset & Integration    |
| FR-37 | Post-environment transition settling-in calibration period with softened statistical alerts                        | S            | Person 6 | Dataset & Integration    |
| FR-38 | Incremental personal health profile builder with progressive completeness score                                    | M            | Person 6 | Dataset & Integration    |
| FR-39 | Real-time contraindication filter against known astronaut allergies and regular medications                        | M            | Person 6 | Dataset & Integration    |
| FR-40 | Four-dimensional mental wellbeing tracking (mood, energy, stress, connection)                                      | M            | Person 5 | Lonely Games & Wellbeing |
| FR-41 | Rapid 10-second daily mood/energy tap and weekly structured reflection                                             | M            | Person 5 | Lonely Games & Wellbeing |
| FR-42 | Individual wellbeing action plan (early personal warning signs, preferred coping tools, buddy contacts)            | S            | Person 5 | Lonely Games & Wellbeing |
| FR-43 | Guided multi-step support flows for acute stress spikes, insomnia patterns, and low-mood drift                     | M            | Person 5 | Lonely Games & Wellbeing |
| FR-44 | Fixed safety protocol and emergency alert script for acute psychiatric distress                                    | M            | Person 6 | Dataset & Integration    |
| FR-45 | Empirical tracking of stress delta before and after interventions to personalize tool ranking                      | S            | Person 5 | Lonely Games & Wellbeing |
| FR-46 | Granular opt-in consent for camera-based expression analysis with voice/self-report fallback                       | M            | Person 3 | Face, AI Model & Voice   |
| FR-47 | Encrypted on-device private astronaut reflective journal                                                           | C            | Person 5 | Lonely Games & Wellbeing |
| FR-48 | Scheduled playback of pre-recorded personal messages from home                                                     | C (DESIGNED) | Person 5 | Lonely Games & Wellbeing |
| FR-49 | Anonymized crew pulse survey aggregation requiring at least 3 respondents                                          | C            | Person 6 | Dataset & Integration    |
| FR-50 | Clinician-approved brief psychological screening scales                                                            | C            | Person 6 | Dataset & Integration    |
| FR-51 | Space-weather proton flux feed ingestion, S-scale storm classification, and cumulative dose calculation (SIM)      | M            | Person 1 | Radiation Awareness      |
| FR-52 | Space-weather shelter guidance, crew action checklist protocol, and storm recovery validation                      | M            | Person 1 | Radiation Awareness      |
| FR-53 | Interactive biofeedback Orb Calm with WebGL canvas, pulse-responsive turbulence, and 4s/6s breathing pacer         | M            | Person 5 | Lonely Games & Wellbeing |
| FR-54 | Space Race (Aurora Run) 3D flight game with custom Blender assets, obstacle navigation, and mood delta logging     | S            | Person 5 | Lonely Games & Wellbeing |
| FR-55 | Hydroponic Greenhouse plant visualization reflecting routine adherence streak and calm session completion          | S            | Person 5 | Lonely Games & Wellbeing |
| FR-56 | NASA MRID evidence catalog integration, multi-module event bus routing, and unified store state merge pipeline     | M            | Person 6 | Dataset & Integration    |

| ID    | Non-functional requirement                                                                    |
| ----- | --------------------------------------------------------------------------------------------- |
| NFR-1 | Works fully offline; cloud is optional                                                        |
| NFR-2 | Video frames never stored; only numbers kept, on the device                                   |
| NFR-3 | Every recommendation is explainable: which readings, which rule, which source                 |
| NFR-4 | Decisions come from rules and statistics, not the language model                              |
| NFR-5 | Every value and protocol line shows its label and source; unsourced lines marked "unverified" |
| NFR-6 | An audit log records every reading, flag, recommendation and action                           |
| NFR-7 | A status updates within a few seconds of a new reading                                        |

# Part 7: System Architecture & Data Contracts

## 24. Architecture

### 25.1 Overview

Everything is an event. Inputs create readings; the engine turns readings into levels and recommendations; the UI shows them. Modules never call each other directly; they publish and subscribe on one event bus, which is what lets several people build in parallel and merge safely.

```
 INPUTS                   CORE (on-device, offline)                           OUTPUTS
 Camera  -> Vision  (pose, face, pulse, breathing) --+                  +-> Dashboard (body, charts, cards)
 Mic     -> Voice   (speech in, speaker ID) ---------+                  +-> Voice and orb (speech, alerts)
 Forms   -> Check-in and symptom entry --------------+-> State store -> Assess -> Triage ->+-> Reminder scheduler
 Test    -> Reaction test ---------------------------+   (local)      (status,  (level,   +-> Ground digest queue
 Cabin   -> Cabin feed (SIM) ------------------------+               anomaly)  protocol)     (store and forward)
                                   ^                                        ^
                       Environment profile                     Knowledge base (protocols, ranges, kit)
```

### 25.2 Event bus

```js
bus.emit(type, payload); // publishes and writes an audit entry
bus.on(type, handler); // returns an unsubscribe function
bus.once(type, handler);
```

| Event                                  | Payload                                             | Emitted by                                  | Heard by                          |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| `reading.added`                        | `{ reading }`                                       | inputs                                      | store, assess                     |
| `reading.rejected`                     | `{ raw, issues[] }`                                 | validate                                    | forms, camera                     |
| `status.updated`                       | `{ crewId, snapshot }`                              | assess                                      | UI, voice                         |
| `anomaly.raised`                       | `{ assessment }`                                    | assess                                      | alerts, recommend, UI             |
| `alert.changed`                        | `{ alert }`                                         | alerts                                      | UI, voice, orb                    |
| `symptom.logged`                       | `{ symptom }`                                       | forms, voice                                | recommend                         |
| `recommendation.created`               | `{ card }`                                          | recommend                                   | UI, voice, reminders, llm         |
| `protocol.step`                        | `{ runId, stepIndex, done }`                        | care UI                                     | alerts, reminders                 |
| `reminder.due`, `reminder.changed`     | `{ reminder }`                                      | reminders                                   | UI, voice                         |
| `digest.queued`, `digest.changed`      | `{ digest }`                                        | recommend, digest                           | ground UI                         |
| `environment.requested`                | `{ source, environmentId?, mode?, text? }`          | voice, settings, schedule                   | environment engine                |
| `environment.confirmed`                | `{ environmentId?, mode }`                          | UI                                          | environment engine                |
| `environment.changed`                  | `{ profileId, mode }`                               | environment engine, after confirmation only | assess, recommend, reminders      |
| `mode.changed`                         | `{ mode }`                                          | environment engine                          | all                               |
| `profile.updated`                      | `{ crewId, section }`                               | profile                                     | kit filter, reminders             |
| `wellbeing.checked`, `wellbeing.level` | `{ crewId, dims, level }`                           | wellbeing                                   | UI, support flows                 |
| `support.started`, `support.finished`  | `{ flowId, type, tool, stressBefore, stressAfter }` | support flows                               | tool ranking                      |
| `feedback.given`                       | `{ alertId, useful }`                               | UI                                          | alerts                            |
| `voice.command`                        | `{ text, speakerId, confidence }`                   | voice                                       | recommend, environment engine, UI |
| `crewpulse.submitted`                  | `{ answers }`                                       | UI                                          | wellbeing                         |

### 25.3 Modules

| Module                                  | Job                                                                                                      | Done when                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `core/eventBus.js`                      | Publish and subscribe; audit every event                                                                 | An emitted event reaches handlers and appears in the audit log |
| `core/store.js`                         | Local storage (IndexedDB); `getSnapshot(crewId)` for the UI                                              | Rejects readings lacking label or confidence; survives reload  |
| `engine/validate.js`                    | Sanity range, plausibility, units, confidence                                                            | Out-of-range typed value prompts a remeasure                   |
| `engine/baseline.js`                    | Median and spread per person and indicator; `ready` flag                                                 | "Calibrating (n of N)" until ready                             |
| `engine/assess.js`                      | Levels, pattern, reasons                                                                                 | Golden scenarios S1 to S5 pass                                 |
| `engine/alerts.js`                      | Lifecycle, grouping, cooldown, snooze, feedback                                                          | Transitions follow section 12.4                                |
| `engine/recommend.js`                   | Triage, protocol match, card, kit filter, escalation                                                     | S6, S7 pass; kit-only suggestions                              |
| `engine/reminders.js`                   | Schedule, tick, snooze, missed, recheck                                                                  | S8 passes                                                      |
| `engine/digest.js`                      | Build, queue, track                                                                                      | Queue persists offline; urgent first                           |
| `engine/explain.js`                     | "Why this?" text                                                                                         | Every alert returns reasons                                    |
| `engine/environment.js`                 | Resolve voice or picker request, confirm, apply profile, settling-in                                     | S11, S12, S16 pass                                             |
| `engine/profile.js`                     | Build and store profile; completeness; `filterKit()`                                                     | S13 passes                                                     |
| `engine/wellbeing.js`                   | Dimensions, level, support flows, tool ranking                                                           | S14, S15, S18, S19 pass                                        |
| `inputs/forms`, `reactionTest`, `cabin` | Check-in and symptom entry, 30-second test, simulated cabin                                              | Labelled readings with validation                              |
| `inputs/camera`                         | MediaPipe landmarks, pulse, breathing, blendshapes                                                       | Numbers with confidence; no frames stored                      |
| `inputs/voice`                          | Wake word, speech in and out, speaker-ID client                                                          | "Hey Sentinel, I have a headache" starts triage                |
| `services/llm.js`                       | Phrases a card in one to two sentences                                                                   | Scripted fallback when offline                                 |
| `services/speaker` (Python)             | Enrol and match voices                                                                                   | Returns speaker and confidence                                 |
| `services/moodmodel` (Python)           | Blendshapes to valence and arousal                                                                       | Model card with held-out results                               |
| `ui/*`                                  | Body figure, indicator panel, check-in, care, trends, plan, wellbeing, ground, profile and settings, orb | Match section 10                                               |

### 25.4 Stack

Plain JavaScript with ES modules. Front end: React with Vite; Chart.js or Recharts. Local storage: IndexedDB for readings, baselines, alerts, reminders, digests, profile and the audit log. Browser: MediaPipe (pose, face landmarks, blendshapes), Web Speech API, Web Audio. Small local Python services: speaker identification (Resemblyzer), mood-model training (scikit-learn), seed-data generator. Mood model exported to run in the browser (ONNX or TensorFlow.js) or behind a local endpoint. Language model: optional API call for phrasing only.

### 25.5 Where the language model fits

It is the voice, not the doctor. Rules choose the level, protocol and steps. The model only rephrases the chosen card into a short, calm spoken reply and answers "what does this mean?" from `knowledge.json`.

```
SYSTEM: You are Sentinel, a calm onboard health assistant for astronauts.
You receive a JSON recommendation card and a language code. Rephrase the card as at
most two short spoken sentences in that language. Do not add medical facts, doses,
diagnoses or reassurance that the card does not contain. If level is 3, start with the
single most important immediate step. If asked something the card does not answer, say
you will note the question for the flight surgeon.
```

When offline or on error, speak a scripted line per level and language from `shared/fallback_lines.json`.

## 25. Data Model and Schemas

### 25.1 Entities

| Entity                | Key fields                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| CrewMember            | id, name, language, units, consents, voiceprint ref                                                   |
| Profile               | preferences, mission context, health background, wellbeing plan, sharing, completeness                |
| EnvironmentProfile    | id, comms mode, return option, kit id, threshold overrides, schedule template, escalation policy      |
| Indicator             | id, unit, reference ranges (with source), quality rules, group, hazard and HRP risk tags              |
| Reading               | id, crew id, indicator, value, unit, source, label, confidence, context tags, timestamp               |
| Baseline              | crew id, indicator, environment id, median, spread, window, count, updated at                         |
| Assessment            | id, crew id, level, reasons, confidence, rule ids, pattern, timestamp                                 |
| Alert                 | id, assessment id, state, presented at, acknowledged at, resolution, feedback                         |
| Symptom               | id, crew id, zone, type, severity, onset, duration                                                    |
| Protocol, ProtocolRun | triggers, questions, red flags, steps, variants, kit items, recheck, source; run progress and outcome |
| KitItem               | id, name, location, quantity, class, tags, label notes                                                |
| Reminder              | id, type, due, state, linked alert or protocol, snooze count                                          |
| Digest                | id, priority, content, state (queued, sent, acknowledged, replied), reply                             |
| WellbeingFlow         | id, type, step, offered tools, chosen tool, stress before and after                                   |
| AuditEvent            | id, time, actor, event, reference                                                                     |

### 25.2 Reading

```json
{
  "id": "uuid",
  "crewId": "james",
  "indicator": "heart_rate",
  "value": 72,
  "unit": "bpm",
  "source": "camera",
  "label": "LIVE",
  "confidence": 0.8,
  "context": ["post_exercise"],
  "ts": "2026-11-14T10:00:00Z"
}
```

`source` is camera, manual, sim, test or sensor. `label` is LIVE, MANUAL, SIM or DESIGNED. `confidence` is 0 to 1 (typed and cabin readings use 1). `ts` is the onboard clock in UTC. The store rejects a reading missing `source`, `label` or `confidence`.

### 25.3 Assessment, alert, recommendation card

```json
{
  "id": "uuid",
  "crewId": "james",
  "ts": "2026-11-14T10:00:00Z",
  "level": 2,
  "confidence": "medium",
  "reasons": [
    {
      "indicator": "sleep_hours",
      "kind": "baseline",
      "detail": "Lower than your usual for 3 nights"
    }
  ],
  "pattern": { "groups": ["sleep", "cognitive", "mood"], "count": 3 },
  "ruleIds": ["R-SLEEP-001"],
  "perIndicator": {
    "sleep_hours": {
      "level": 2,
      "rangeLevel": 0,
      "personalLevel": 2,
      "trendLevel": 2
    }
  }
}
```

```json
{
  "id": "uuid",
  "assessmentId": "uuid",
  "state": "presented",
  "level": 2,
  "presentedAt": "...",
  "acknowledgedAt": null,
  "resolution": null,
  "feedback": null
}
```

```json
{
  "id": "uuid",
  "alertId": "uuid",
  "level": 2,
  "seen": "Resting heart rate is above your usual two days running",
  "sure": "medium",
  "sureWhy": "camera estimate; sleep entry typed",
  "steps": [{ "text": "...", "timerS": null }],
  "kitItems": [{ "id": "kit-001", "name": "...", "location": "..." }],
  "kitNotes": ["profile incomplete, check the label"],
  "recheckAfterMin": null,
  "escalateIf": ["chest pain", "fainting"],
  "why": "Cardiovascular Adaptations: circulation changes in weightlessness",
  "protocolId": "P-HR-HIGH",
  "sources": ["..."],
  "unverified": false
}
```

### 25.4 Reminder and digest

```json
{
  "id": "uuid",
  "crewId": "james",
  "type": "checkin",
  "dueAt": "...",
  "state": "scheduled",
  "snoozeCount": 0,
  "linked": { "alertId": null, "protocolRunId": null }
}
```

Types: checkin, measurement, treatment_timer, recheck, exercise, hydration, sleep_winddown, mood, kit_check. States: scheduled, due, presented, done, snoozed, missed.

```json
{
  "id": "uuid",
  "crewId": "james",
  "envId": "transit",
  "priority": "ACT",
  "summary": "...",
  "readings": [],
  "actionsTaken": [],
  "kitUsed": [],
  "question": "...",
  "trend": [],
  "state": "queued",
  "reply": null,
  "createdAt": "...",
  "sentAt": null
}
```

Never include frames, audio or images.

### 25.5 Profile

```json
{
  "crewId": "james",
  "callsign": "",
  "language": "en",
  "units": "metric",
  "preferences": {
    "voice": "calm",
    "gloveMode": true,
    "reminderTimes": { "checkin": "08:00", "winddown": "21:30" }
  },
  "mission": {
    "environmentId": "transit",
    "mode": "routine",
    "dutySchedule": "transit_day_v1",
    "evaRoster": false
  },
  "health": {
    "allergies": [],
    "conditions": [],
    "regularMedicines": [],
    "pastKitReactions": [],
    "updatedBy": "astronaut|flight_surgeon",
    "sensitive": true
  },
  "wellbeingPlan": {
    "earlySigns": [],
    "whatHelps": ["orb_calm", "earth_window"],
    "whoToTalkTo": "",
    "cameraMoodAnalysis": true,
    "homeMessages": false
  },
  "sharing": {
    "buddy": "",
    "shareUrgentWithCommander": true,
    "shareTrendsWithSurgeon": "on_request",
    "crewPulse": false
  },
  "completeness": 0.4
}
```

`health` is stored on the device, never copied into a digest unless the astronaut or surgeon sets an include flag, and never passes through the reading store.

### 25.6 Health state snapshot (what the UI reads)

`getSnapshot(crewId)` builds this from the stored readings. In code, blood pressure is two indicators (`bp_sys`, `bp_dia`); the snapshot groups them as `blood_pressure` for display.

```json
{
  "crew_id": "james",
  "timestamp": "...",
  "lang": "en",
  "environment": "station|transit|base",
  "mode": "routine",
  "identity": { "confidence": 0.0 },
  "indicators": {
    "heart_rate": {
      "value": 0,
      "unit": "bpm",
      "source": "camera|manual|sim",
      "status": "green",
      "baseline": 0
    },
    "blood_pressure": {
      "value": { "sys": 0, "dia": 0 },
      "unit": "mmHg",
      "source": "manual",
      "status": "green"
    },
    "sleep_hours": {
      "value": 0,
      "unit": "h",
      "source": "manual",
      "status": "green",
      "baseline": 0
    },
    "reaction_ms": {
      "value": 0,
      "unit": "ms",
      "source": "test",
      "status": "green",
      "baseline": 0,
      "lapses": 0
    }
  },
  "wellbeing": {
    "level": 0,
    "dims": { "mood": 0, "energy": 0, "stress": 0, "connection": 0 }
  },
  "drift": { "flag": false, "note": "", "signals_agreeing": 0, "signals": [] },
  "cabin": { "oxygen_pct": 0, "co2_ppm": 0, "alert": false },
  "radiation": {
    "event_level": "quiet|elevated|storm",
    "dose_rate": null,
    "cumulative": null,
    "unit": "demo_units",
    "label": "SIM",
    "limits_set": false,
    "alert": false
  },
  "guidance": {
    "title": "",
    "steps": [],
    "kit_item": "",
    "contact_surgeon": false,
    "reason": ""
  },
  "action": { "type": "none", "detail": "", "handled": "onboard|escalated" },
  "intervention_log": [
    {
      "type": "orb_calm",
      "stress_before": 0.0,
      "stress_after": 0.0,
      "recovery_s": 0
    }
  ]
}
```

### 25.7 Config files

**`thresholds.json`:** per indicator, a green band, a wider amber band and a source; outside amber is red. `null` means "fill from the source; do not invent."

```json
{
  "heart_rate": {
    "unit": "bpm",
    "ranges": { "default": { "green": [null, null], "amber": [null, null] } },
    "overrides": { "sortie": {} },
    "source": "NASA Resources tab or marked demo default",
    "demoDefault": true
  }
}
```

**Rule shape:**

```yaml
rule_id: R-HR-REST-001
indicator: heart_rate
applies_to: [station, transit, base]
condition:
  baseline_deviation: ">= k_watch for 2 consecutive check-ins"
  quality: ">= medium"
context_suppress: [within_30min_of_exercise, during_eva]
level: 1
escalate_if: [persists_after_recheck, pattern_count >= 2]
protocol: P-HR-HIGH
explain: "Your resting heart rate is higher than your usual for two days in a row."
source: "HRP risk: Cardiovascular Adaptations; ranges from thresholds.json"
```

**Protocol shape with variants:**

```yaml
protocol_id: P-SEVERE-SYMPTOM
triggers: [symptom:any_severe]
questions: [onset, severity_0_10, vision_change, confusion]
red_flags: [vision_change, sudden_severe, confusion] # level 3, escalate
steps:
  - text: "..." # from knowledge.json, sourced or marked unverified
    timer_s: null
kit_items: [lookup_in_active_kit]
recheck_after_min: <config>
resolve_when: severity_drops_or_user_confirms
source: knowledge.json#severe_symptom
variants:
  station:
    {
      escalate_policy: contact_ground_now,
      contact: [crewmate, ground],
      return_note: "A return vehicle is docked; ground decides per mission procedure.",
    }
  transit:
    {
      escalate_policy: priority_digest,
      contact: [crewmate, commander],
      return_note: "No quick return; treat in place.",
    }
  sortie: { steps: [...] } # replaces base steps: stop work, call crew, begin return per EVA procedure
```

**`knowledge.json`:** one entry per indicator with `what`, `how_to_measure`, `why_it_matters` (hazard and HRP risk), `if_amber`, `if_red`, `contact_surgeon_when`, `sources`. **`kit.json`:** items with id, name, location, quantity, `class`, `tags`, notes from the label.

## 26. Data Sources and Model Training

| Need                                 | Source                                                                                                                                   | Used for                          | Status                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------- |
| Reference ranges and indicator facts | NASA HRP and Standard Measures material on the challenge Resources tab; published adult ranges as marked demo defaults                   | `thresholds.json`, status colours | To source and verify       |
| Protocols, risks, explanations       | NASA HRP risk pages; the onboard-kit list supplied by the event                                                                          | `knowledge.json`, recommendations | Written by us from sources |
| Face-expression training             | Public sets FER2013, AffectNet, RAF-DB, CK+ (licences and access vary); our own team samples (6 people, 5 states, about 30 seconds each) | Mood model                        | Request access early       |
| Pulse-from-video check               | Public rPPG sets such as UBFC-rPPG or PURE if access allows, plus a pulse oximeter on a teammate                                         | Check our heart-rate accuracy     | Optional                   |
| Spaceflight context                  | NASA Open Science Data Repository and HRP research descriptions                                                                          | Citations, example baselines      | Read-only                  |
| Crew history for charts and tests    | Seed script: baseline plus noise with injected scenarios                                                                                 | Charts, anomaly tests, demo       | SIM, say so                |
| Voice                                | Our own enrolment recordings                                                                                                             | Speaker ID                        | Own data                   |
| Cabin                                | Slider or script                                                                                                                         | Cabin alert                       | SIM                        |

Dataset names are from general knowledge; confirm access and licence before use.

**How a dataset becomes a working mood model:**

1. Run each dataset image through MediaPipe Face Landmarker; keep the 52 blendshape scores, not the pixels.
2. Train a small classifier (logistic regression or a small neural net) to predict neutral, happy, sad, tired and stressed, then map to valence and arousal.
3. Calibrate on our own team samples, because public data is mostly posed and Western-skewed.
4. Hold out data; publish a confusion matrix and per-class F1 in `docs/model_card.md`, including weak spots.
5. Export to the browser (ONNX or TensorFlow.js) or a local endpoint.
6. At run time: rolling window of scores, then valence and arousal, then change from baseline. One frame never raises a flag.
7. Fallbacks if it underperforms: a pretrained model (HSEmotion or DeepFace), or baseline-only drift on voice and reaction time.

The anomaly engine and the recommender are **not** trained on a dataset; they are rules and statistics over the person's own data and sourced protocols.

**Seed data:** `services/seed/seed_history.py` gives each crew member a baseline per indicator from `seed/profiles.json` (invented demo values, labelled SIM), adds Gaussian noise and injects scenario effects. Every seeded reading has `label: SIM`.

## 27. Algorithms (Implementation Reference)

Numbers marked tunable are starting values to adjust on the seeded scenarios; they are design choices, not spaceflight facts.

### 27.1 Assessment

```js
function assess(crewId, now, profile) {
  const perIndicator = {};
  for (const ind of INDICATORS) {
    const r = latestReading(crewId, ind.id);
    if (!r) continue;
    const rangeLevel = rangeStatus(ind, r.value, profile); // 0..3 from thresholds.json
    const base = getBaseline(crewId, ind.id);
    const personalLevel = base.ready ? deviationLevel(r.value, base, ind) : 0; // capped at 2
    const trendLvl = trendLevel(series(crewId, ind.id, TREND_DAYS), base, ind); // 0..2
    let level = Math.max(rangeLevel, personalLevel, trendLvl);
    if (r.confidence < MIN_CONFIDENCE) level = Math.min(level, 1); // quality gate
    if (isSuppressed(r, profile)) level = 0; // exercise, EVA
    if (inSettlingIn(profile)) level = Math.max(rangeLevel, Math.min(level, 1)); // settling in
    perIndicator[ind.id] = {
      level,
      rangeLevel,
      personalLevel,
      trendLevel: trendLvl,
    };
  }
  const groups = groupsAtOrAbove(perIndicator, 1); // independent groups only
  const pattern = groups.length >= 2 ? { groups, count: groups.length } : null;
  let level = Math.max(0, ...Object.values(perIndicator).map((p) => p.level));
  if (pattern) level = Math.max(level, 2);
  level = Math.max(
    level,
    symptomLevel(crewId),
    cabinLevel(crewId),
    radiationLevel(crewId),
  );
  return buildAssessment(crewId, now, level, perIndicator, pattern);
}
```

- **Range status:** green inside the green band, level 1 inside amber but outside green, level 3 outside amber. Typed and cabin readings (confidence 1) are never downgraded by the quality gate.
- **Baseline:** median and spread over the last `WINDOW_DAYS` of qualifying readings; `ready` when the count reaches `MIN_BASELINE`. Starting values (tunable): window 14 days, minimum 5 readings, minimum confidence 0.5. Baselines carry an environment tag; the previous baseline stays in use until the new one is `ready`.
- **Deviation:** `z = (x - median) / spread`, with `spread = max(1.4826 * MAD, minSpread[indicator])` so a flat history cannot divide by zero. Only movement in the worse direction counts. Level 1 at `K_WATCH`, level 2 at `K_ACT` (tunable, start at 2 and 3); never above level 2.
- **Trend:** least-squares slope over `TREND_DAYS` (start at 5), expressed in baseline spreads; level 1 or 2 when drift in the worse direction passes tunable cut-offs.
- **Pattern:** two or more independent groups at level 1 or more inside the window raises the level to at least 2 and produces one alert listing every reason.

### 27.2 Wellbeing

Dimensions: **mood** = `valence`, `mood_self`, `arousal`; **energy** = `sleep_hours`, `sleep_quality`, `energy_self`, `reaction_ms`; **stress** = `stress_self`, resting `heart_rate`, `arousal`; **connection** = `connection_self`, `talk_share`, `time_alone_pct`, `missed_checkins`.

```js
function wellbeingLevel(crewId, now, profile) {
  const dims = {};
  for (const d of DIMENSIONS) {
    dims[d] = dimensionLevel(crewId, d, now); // worst personal-baseline level in the dimension,
  } // quality-gated, capped at 2, softened when settling in
  const drifting = Object.values(dims).filter((l) => l >= 1).length;
  let level = Math.max(0, ...Object.values(dims)); // statistics alone never exceed 2
  if (drifting >= 2) level = Math.max(level, 2);
  if (urgentSelfReport(crewId, now) || urgentPhraseHit(crewId, now)) level = 3;
  return { level, dims };
}
```

If camera mood analysis is off, `valence` and `arousal` are skipped and mood runs on self-report and voice. Level 3 comes only from an explicit report (the weekly questions or a button) or a match in `shared/intents/wellbeing_urgent.json` (clinician-reviewed before real use), and shows only the fixed safety script.

**Tool ranking:** the astronaut's `wellbeingPlan.whatHelps` first, then per-person effectiveness (average improvement from `support.finished` events), then defaults (Orb Calm, paced breathing, Earth window). Offer the top three; write results to `intervention_log`.

### 27.3 Environment intent matching

`shared/intents/environment.json` maps phrases to ids per language:

```json
{
  "en": {
    "station": ["space station", "in orbit", "on the station"],
    "transit": ["spacecraft", "space cabin", "in transit", "on the way to"],
    "base": ["moon base", "mars base", "surface habitat", "on the base"],
    "eva": ["going outside", "eva", "spacewalk", "taking the rover out"],
    "rest": ["going to sleep", "rest time"]
  }
}
```

Matching is a lowercase "contains" check. One match gives a confirmation question; none or several makes Sentinel ask which option applies. Nothing changes without a yes. Mode matches (eva, rest) set `mode`; the others set `environmentId`.

## 28. Privacy, Consent and Security

| Data                        | Astronaut    | Crew buddy or commander | Flight surgeon                          | Mission planner |
| --------------------------- | ------------ | ----------------------- | --------------------------------------- | --------------- |
| Raw readings and trends     | Owner, full  | No                      | Only via digest or on request           | No              |
| Mood and voice analysis     | Owner        | No                      | Only if shared                          | No              |
| Urgent and cabin alerts     | Yes          | Yes                     | Priority digest                         | No              |
| Environment profile and kit | Yes          | Yes                     | Yes                                     | Edits           |
| Health background           | Owner        | No                      | If the astronaut or surgeon includes it | No              |
| Video frames                | Never stored | No                      | No                                      | No              |

- Data stays on the device; export is a deliberate, consented act. Sharing choices can change at any time and are shown in plain language.
- The astronaut can view, export and delete their data. Wellbeing data is not used for crew selection or fitness-for-duty without the astronaut's consent.
- Safety defaults: when readings conflict or confidence is low, escalate rather than reassure; never show unsourced protocol text as an instruction.
- Security target: encryption at rest on the device, an audit log of every reading, flag, recommendation and action, and signed configuration (profiles, protocols, kits) in the platform version (section 23). The hackathon build stores data locally without encryption.

# Part 8: SaaS Platform

## 29. From Hackathon Build to SaaS Platform

### 29.1 The idea

Sentinel is **edge-first**: the crew app runs on the device and needs no link. A SaaS platform wraps it with what organisations need to run it at scale: mission configuration, clinically reviewed content, a ground portal, sync, administration and audit. It would be offered as a service to organisations whose people work far from care: space agencies and mission operators first, then analog habitats and Earth remote-site operators.

The hackathon builds the crew app and demonstrates the platform pieces with files and a simulator. Everything else below is **DESIGNED**.

### 29.2 Platform components

| Component                            | Who uses it                         | What it does                                                                                                                                | Hackathon status              |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Crew app (edge)                      | Astronaut                           | Everything in sections 6 to 22, offline                                                                                                     | **Built (MVP)**               |
| Mission Config Studio                | Mission planner                     | Create environment profiles, schedules, kits, thresholds with sources; versioned and signed                                                 | JSON files; DESIGNED UI       |
| Content Library with clinical review | Clinicians, content reviewers       | Protocols, knowledge entries, wellbeing wording, urgent phrases; draft, review, approved, published; every item has a source and a reviewer | JSON files; DESIGNED workflow |
| Ground portal                        | Flight surgeon, flight psychologist | Receive digests, send replies, request trends with the astronaut's consent, adjust baselines                                                | Delay simulator; DESIGNED     |
| Sync service (store and forward)     | System                              | Moves digests, replies and config updates when a link opens; priority, resume, conflict rules                                               | Local queue; DESIGNED         |
| Admin and audit console              | Tenant admin, auditor               | Users, roles, audit log, data export, retention                                                                                             | DESIGNED                      |
| Aggregate analytics                  | Program staff                       | Privacy-preserving metrics from section 30; opt-in                                                                                          | DESIGNED                      |
| API and integrations                 | Partner systems                     | Digest and reply exchange, config distribution, export to standard health-data formats                                                      | DESIGNED                      |

### 29.3 Tenancy and roles

A **tenant** is an organisation. It owns **missions or sites**, which have **crew members**. Personal health data stays on the astronaut's device; the platform holds only what is shared (digests, replies, configuration, audit events).

| Role                                | Can see                                             | Can change                                 |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| Astronaut                           | Everything about themselves                         | Their profile, consents, readings entry    |
| Crew buddy, commander               | Urgent and cabin alerts; what the astronaut shares  | Nothing about others' data                 |
| Flight surgeon, flight psychologist | Digests and replies; trends if the astronaut allows | Replies, suggested baseline adjustments    |
| Mission planner                     | Mission configuration                               | Profiles, schedules, kit lists (versioned) |
| Content reviewer (clinician)        | Protocols and wording in review                     | Approve, reject, comment                   |
| Tenant admin                        | Users, roles, audit log                             | Users and roles                            |
| Auditor                             | Audit log, config history                           | Nothing                                    |

### 29.4 Configuration as data

Everything that varies per mission is data, not code: environment profiles, schedules, kits, thresholds, protocols and variants, intent phrases, languages and fallback lines. Each bundle has a version and a signature. The edge app verifies and stages a new bundle, shows the astronaut a plain-language **config diff** before applying it, and keeps the previous version for rollback. Bundles can travel by link or by offline media.

### 29.5 Content governance

- A protocol or explanation reaches the crew only after review and publication; each has a source, a reviewer, an effective date and a change log.
- No source means "unverified": never shown as an instruction.
- Translations stay unverified until a fluent reviewer confirms them.
- Wellbeing wording, the urgent-phrase list and scales need a qualified clinician or psychologist.

### 29.6 API sketch (illustrative)

| Endpoint                       | Purpose                                 |
| ------------------------------ | --------------------------------------- |
| `POST /v1/digests`             | Edge sends a digest (priority, content) |
| `GET /v1/replies?since=`       | Edge fetches ground replies             |
| `GET /v1/missions/{id}/config` | Edge fetches the signed config bundle   |
| `PUT /v1/protocols/{id}`       | Content author saves a draft version    |
| `POST /v1/reviews`             | Reviewer approves or rejects a version  |
| `GET /v1/audit`                | Auditor reads events                    |

Authentication with standard organisation sign-in and device identity; webhooks for digest and reply events; optional export in standard health-data formats.

### 29.7 Deployment modes

1. **Standalone on the device:** the hackathon build, analog missions, remote sites with no link.
2. **Edge plus ground portal with store-and-forward:** the mission model.
3. **Private cloud or on-premises for an agency or enterprise:** with offline signed updates.

### 29.8 Markets and packaging (to explore)

- **First:** space agencies, commercial crew operators, analog habitats.
- **Earth spinoffs:** polar and remote research stations, submarines and offshore platforms, remote clinics and schools with limited specialist access, disaster-response and humanitarian teams. Each setting needs its own protocols, ranges and language review.
- **Packaging options:** per mission or site licence, per-crew-member fee, a subscription to the reviewed content library, and services for configuration and clinical review.

### 29.9 Regulatory and compliance considerations

Software that gives medical guidance may be treated as a medical device or clinical decision support in many jurisdictions. Plan a regulatory assessment, a clinical safety case, a hazard analysis and human-factors testing before real use. Health-data privacy law varies by country; design for data protection from the start (on-device by default, consent, audit, export and delete). This is a planning note, not legal advice.

# Part 9: Build, Testing & Delivery

## 30. Repository and Setup

```
sentinel/
  README.md
  docs/                 model_card.md, protocol_sources.md, demo_script.md
  shared/
    schemas/            JSON Schemas for reading, assessment, card, reminder, digest, profile
    thresholds.json     ranges with sources
    knowledge.json      per-indicator explainers
    protocols.json      sourced protocols with variants
    kit.json            onboard kit lists
    environments/       station.json  transit.json  base.json  sortie.json
    schedules/          daily templates per environment
    intents/            environment.json  wellbeing_urgent.json
    fallback_lines.json scripted lines per level and language
    seed/               generated SIM history
  app/src/
    core/               eventBus.js  store.js  clock.js  labels.js
    engine/             validate  baseline  assess  alerts  recommend  reminders
                        digest  explain  environment  profile  wellbeing
    inputs/             forms/  reactionTest/  cabin/  camera/  voice/
    services/           llm.js  speech.js
    ui/                 screens/  components/  body/  orb/
  services/
    speaker/            enrol and match (Python)
    moodmodel/          train and export (Python)
    seed/               seed_history.py, profiles.json
  tests/                golden scenarios, acceptance tests
```

Prerequisites: Node.js LTS, Python 3.10 or newer, Chrome (best support for MediaPipe and Web Speech). The camera and microphone work on `localhost` or HTTPS only.

```
git clone <repo> && cd sentinel
cd app && npm install && npm run dev          # http://localhost:5173
cd ../services && python -m venv .venv && source .venv/bin/activate
pip install resemblyzer scikit-learn numpy pandas
python seed/seed_history.py --crew 6 --days 14 --scenario steady --out ../shared/seed/
```

These commands are a suggested starting point. For offline use, download the MediaPipe model and wasm files into `app/public/` and load them locally instead of from a CDN.

**Git:** one repo, a branch per person or feature, pull requests only (never push to `main`), small merges all day, and a `mock_data.json` in `shared/` (one calm crew member, one drifting) so everyone can test without waiting.

## 31. Build Order and Milestones

Build a vertical slice first. After **M2** you already have a demo; everything later enriches it.

| Milestone                         | Build                                                                              | Depends on | Done when                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| **M0 Skeleton**                   | Repo, schemas, event bus, store, labels, mock and seed data, environment profiles  | nothing    | Any module can emit and read a reading; calm and drifting mock crew load       |
| **M1 Manual check-in to colours** | Forms, validate, range status, body figure                                         | M0         | Type a blood pressure and see the heart zone change colour                     |
| **M2 Detail and charts**          | Indicator panel, `knowledge.json`, trend charts from seed history                  | M1         | Click a zone: value, chart with baseline band, how to measure, why, what to do |
| **M3 Anomaly engine**             | Baseline, deviation, trend, quality gate, pattern, alert lifecycle, explain        | M2         | Golden scenarios S1 to S5 pass; "Why this?" works                              |
| **M3b Environment engine**        | Intent matching, confirmation, profile reload, settling-in, protocol variants      | M3         | S11, S12, S16, S17 pass                                                        |
| **M4 Triage and care**            | Symptom entry, three protocols, card, kit, protocol runner                         | M3         | S6, S7 pass; a card appears with kit-only items                                |
| **M4b Profile and kit filter**    | Profile builder, completeness, kit filter                                          | M4         | S13 passes                                                                     |
| **M5 Reminders**                  | Scheduler, Plan screen, recheck, adherence                                         | M4         | S8 passes                                                                      |
| **M6 Camera scan**                | MediaPipe overlay, pulse, breathing, blendshapes into readings                     | M0         | Live heart rate appears labelled LIVE with confidence                          |
| **M7 Ground link**                | Digest builder, queue, delay screen                                                | M4         | S9, S10 pass                                                                   |
| **M8 Mind and voice**             | Mood model, reaction test, Orb Calm, voice assistant with LLM phrasing, speaker ID | M3, M6     | Say "Hey Sentinel" and hear a card read back; orb calms as pulse falls         |
| **M8b Wellbeing**                 | Wellbeing engine, mood tap, support flows, urgent flow, crew pulse                 | M3, M8     | S14, S15, S18, S19 pass                                                        |
| **M9 Harden**                     | Offline check, acceptance tests AC-1 to AC-22, backup demo video                   | all        | All acceptance tests pass with the network off                                 |

**Parallel tracks after M0:** (A) engine, (B) UI, (C) inputs and camera, (D) content (`knowledge.json`, protocols, thresholds with sources), (E) ML and voice services. Each works against mock and seed data until its milestone merges.

## 32. Testing & Verification

### 32.1 Golden scenarios

They run against the engine with no UI. `seed_history.py` generates them.

| ID  | Scenario                                                   | Expected result                                                                      |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| S1  | Steady 14 days                                             | Level 0, no alerts                                                                   |
| S2  | Sleep falling 4 nights, reaction slower, mood flatter      | One pattern alert, level 2, three groups listed                                      |
| S3  | Rising stress: heart rate up, valence down, self-mood down | One pattern alert, level 2                                                           |
| S4  | High heart rate tagged post_exercise                       | Suppressed, level 0                                                                  |
| S5  | One low-confidence heart-rate spike                        | No alert; shown as estimate                                                          |
| S6  | Cabin oxygen below its limit (SIM)                         | Level 3, takeover, buddy alert, priority digest                                      |
| S7  | Head symptom with vision change                            | Level 3, escalate, priority digest                                                   |
| S8  | Two missed check-ins                                       | Soft re-prompt, `missed_checkins` counted                                            |
| S9  | Switch station to transit                                  | Thresholds, kit and schedule reload; statuses recompute; banner lists changes        |
| S10 | Link down, then up                                         | Digests queue offline; urgent sends first                                            |
| S11 | Voice: "we're in the transit cabin"                        | Confirmation prompt, then `environment.changed` only after yes                       |
| S12 | Voice: "we're somewhere cold"                              | Asks which option applies; no change                                                 |
| S13 | Profile allergy matches a kit item                         | Item blocked on the card with a reason                                               |
| S14 | Valence, mood and connection drift down for days           | Wellbeing level 2; one support flow with the top three tools                         |
| S15 | Urgent phrase reported                                     | Level 3, buddy and commander alerted, priority digest, safety script only            |
| S16 | Station to transit switch with a personal alert pending    | Softened to "adjusting" for the settling-in days; a range or cabin alert still fires |
| S17 | Same severe symptom in station and transit                 | Cards differ in contact list, return note and digest priority                        |
| S18 | Camera mood analysis off                                   | Wellbeing still computed from self-report and voice                                  |
| S19 | Crew pulse with two responses                              | No team-level result shown                                                           |

### 32.2 Acceptance criteria

| ID    | Given / When / Then                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1  | Given a completed check-in, then every indicator shows a colour, an icon and a word within a few seconds                                                |
| AC-2  | Given a reading outside its range, then the chip is amber or red with a one-line reason and its source                                                  |
| AC-3  | Given two signals deviating in one window, then the user sees one pattern alert listing both reasons                                                    |
| AC-4  | Given a low-confidence camera reading alone, then no alert is raised and the value shows as an estimate                                                 |
| AC-5  | Given a head symptom with a vision change, then level 3, the card offers "Contact flight surgeon", and a priority digest is queued                      |
| AC-6  | Given an accepted level-2 recommendation, then a recheck reminder exists in Plan and the outcome is logged after it                                     |
| AC-7  | Given an environment change, then thresholds, kit and schedule reload, statuses recompute and a banner lists what changed                               |
| AC-8  | Given no network, then every workflow runs and digests queue locally                                                                                    |
| AC-9  | Given cabin oxygen below its limit (SIM), then a full-screen alert, a spoken warning and a crew-buddy alert appear                                      |
| AC-10 | Given two missed routine reminders, then a gentle re-prompt appears and adherence records the misses                                                    |
| AC-11 | Given any alert, then "Why this?" shows readings, rule, baseline and source                                                                             |
| AC-12 | Given a kit suggestion, then the item exists in the active kit list                                                                                     |
| AC-13 | Given "we're in the transit cabin", then Sentinel asks to confirm and only after yes reloads the transit profile                                        |
| AC-14 | Given an unrecognised location phrase, then Sentinel asks which option applies and changes nothing                                                      |
| AC-15 | Given the same severe symptom in station and in transit, then the cards differ in escalation, return advice and digest priority                         |
| AC-16 | Given an environment change, then personal alerts soften for the settling-in period while range and cabin alerts stay full strength                     |
| AC-17 | Given a profile allergy matching a kit item, then the item is blocked on the card with the reason shown                                                 |
| AC-18 | Given a missing health background, then kit suggestions say "profile incomplete, check the label"                                                       |
| AC-19 | Given drift in two wellbeing dimensions, then one support flow opens offering the top three tools from "what helps me"                                  |
| AC-20 | Given an urgent wellbeing phrase, then level 3 fires, buddy and commander are alerted, a priority digest is queued, and only the safety script is shown |
| AC-21 | Given camera mood analysis switched off, then wellbeing still works from self-report and voice                                                          |
| AC-22 | Given fewer than three crew pulse responses, then no team-level result is shown                                                                         |

### 32.3 Conventions and definition of done

- ES modules, JSDoc type comments, one responsibility per file, names match this document.
- A label check test fails if any stored reading lacks a label or confidence.
- **A pull request is done when:** it works offline, passes its golden or acceptance test, labels are correct, no unsourced medical text is shown, and any schema change is written into this document.

## 33. Recipes and Troubleshooting

**Add an indicator:** (1) add it to the indicator registry with id, unit, group and worse-direction; (2) add its entry to `thresholds.json` with a source; (3) add its `knowledge.json` entry; (4) add a capture path that emits a labelled reading; (5) add it to the snapshot selector and the UI list; (6) add a golden test.

**Add a protocol:** (1) write it in `protocols.json` with a source for every step; (2) set triggers and red flags; (3) add variants where the plan differs by environment; (4) check every kit item id exists in `kit.json`; (5) test a matching symptom and a red-flag case.

**Add an environment:** (1) copy a file in `shared/environments/`; (2) set comms, return option, kit, escalation policy and hazard focus; (3) add threshold overrides only where a source supports them; (4) add a schedule template and intent phrases; (5) run S9, S11, S16.

**Add a language:** (1) add UI strings, intent phrases and fallback lines; (2) set speech recognition and synthesis language codes; (3) translate card text and mark it unverified until a fluent reviewer confirms it.

**Troubleshooting:**

- **Camera or microphone blocked:** they need `localhost` or HTTPS and a granted permission. Fall back to manual entry; the check-in must still complete.
- **Web Speech does not work:** use Chrome, check microphone permission, fall back to buttons and typed commands.
- **MediaPipe fails offline:** bundle the model and wasm files in `app/public/`.
- **Pulse reading unstable:** low light and movement ruin it; lower the confidence, show it as an estimate, or switch the source to manual or SIM and say so.
- **Voices differ by device:** test the text-to-speech voice for every demo language on the demo machine.
- **Storage empty after refresh:** IndexedDB is blocked in some private windows; use a normal window.
