const fs = require('fs');
const path = require('path');

const docPath = 'c:/Users/USER/OneDrive/Desktop/MASTER_CONTROL_1/Sentinel Product Document.md';
const content = fs.readFileSync(docPath, 'utf8');
const lines = content.split('\n');

function sliceBetween(startPattern, endPattern) {
  const startIdx = lines.findIndex(l => startPattern.test(l));
  if (startIdx === -1) throw new Error('Could not find start: ' + startPattern);
  let endIdx = -1;
  if (endPattern) {
    endIdx = lines.findIndex((l, idx) => idx > startIdx && endPattern.test(l));
    if (endIdx === -1) throw new Error('Could not find end: ' + endPattern);
  } else {
    endIdx = lines.length;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

// 1. Title & Section 0
const section0 = `# Sentinel: Master Product and Build Document (v5)

**NASA Space Apps Challenge 2026 · Challenge: "Create Health Monitoring Software for Astronauts on Space Missions" · Nov 14, 2026 · @mistarstudio**

## 0. How to use this document

This is the single source of truth for Sentinel: the product, the six feature modules each person builds, the shared contracts that let them merge, and the SaaS platform it grows into. If something here is wrong, fix it here first, then tell the team. It replaces the earlier handbook, build plan, product spec, PRD and developer guide, and keeps every v4 rule, schema and test.

### What changed from v4

- **Feature-based ownership.** The build is split into six vertical feature modules, one per person. Each module has its own scope, files, events, schemas, tasks, tests and done criteria, so people work in parallel and merge through the event bus (section 4).
- **Radiation is now a module.** v4 listed radiation as out of scope. v5 adds an awareness and response layer (space-weather alerts, exposure tracking from simulated data, shelter guidance). It still does not measure dose, and everything it shows is labelled SIM or DESIGNED (section 6).
- **Lonely games is a module.** One person owns all the anti-loneliness and wellbeing experience tools: Orb Calm, Space Race, Greenhouse, Earth Window, ambient sound, and connection nudges (section 10).
- **Dataset and integration is a module.** One person owns seed data, the anomaly engine wiring, and merging the other five modules (section 11).
- **Platform framing.** Each module is also a product feature of the SaaS platform, so the same split serves the hackathon and the business (section 29).
- **NASA dataset folder.** 94 NASA Medical Requirements Integration Documents (MRIDs, 68 unique) are catalogued in \`dataset/_catalog.json\` with per-person ownership assignments (section 5.2 and section 11.2).

### Where to read

| If you are | Read |
| --- | --- |
| A judge or stakeholder | Sections 1, 2, 3, 4, 23, 32 |
| Product or design | Sections 1 to 5, 12 to 16 |
| Person 1 (Radiation Awareness) | Sections 4, 5, 6, 17, 23, 32 |
| Person 2 (Body Model & Zones) | Sections 4, 5, 7, 17, 23, 32 |
| Person 3 (Face, AI Model & Voice) | Sections 4, 5, 8, 17, 23, 32 |
| Person 4 (Vitals & Check-in) | Sections 4, 5, 9, 17, 23, 32 |
| Person 5 (Lonely Games & Wellbeing) | Sections 4, 5, 10, 15, 23, 32 |
| Person 6 (Dataset, Integration & Engine) | Sections 4, 5, 11, 17, 18, 19, 23, 24, 25, 31, 32 |
| Thinking about the platform or business | Section 29 |

**Contents.** Part 1 Product Strategy (1 to 3) · Part 2 Team & Ownership Architecture (4 to 5) · Part 3 Feature Modules (6 to 11) · Part 4 Clinical Experience & Workflows (12 to 16) · Part 5 Clinical Intelligence & Detection (17 to 22) · Part 6 Master Requirements (23) · Part 7 System Architecture & Data (24 to 28) · Part 8 SaaS Platform (29) · Part 9 Build, Testing & Delivery (30 to 33)
`;

// 2. Part 1: Product Strategy (Sections 1, 2, 3)
let rawPart1 = sliceBetween(/^# Part 1: Product/, /^# Part 2: Experience/);
rawPart1 = rawPart1.replace('# Part 1: Product', '# Part 1: Product Strategy');
rawPart1 = rawPart1.replace('## 3. What Makes Sentinel Unique', '## 3. What Makes Sentinel Unique, Honesty Rules & Evidence Base\n\n### 3.1 What Makes Sentinel Unique');
rawPart1 = rawPart1.replace('## 4. Honesty and Safety Rules', '### 3.2 Honesty and Safety Rules');
rawPart1 = rawPart1.replace('## 5. NASA Evidence Base', '### 3.3 NASA Evidence Base');

// 3. Part 2: Team and Ownership Architecture (Sections 4 & 5)
const part2 = `# Part 2: Team and Ownership Architecture

## 4. Team Ownership Map & Non-Conflicting Handoffs

To build Sentinel rapidly without merge conflicts or duplicated work, the system is partitioned into **six vertical feature modules**, one per person. Each person owns their end-to-end slice: their data inputs, backend logic, UI screen, event contracts, NASA dataset research files, and golden scenario tests.

Modules communicate **strictly through the store and the event bus**. No module ever imports another module's internal code or writes directly into another person's directory.

### 4.1 Master Ownership Matrix

| Person | Module Name | Scope & Capabilities | Codebase Files Owned | UI Screen(s) Owned | State Store Keys | Publishes Events | Consumes Events / Data | NASA Dataset Files (MRIDs) | Golden Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Person 1** | **Radiation Awareness** | Space-weather feed (NOAA GOES proton flux + snapshot fallback), cumulative dose passport model (SIM), S-scale storm levels (quiet, elevated, storm), shelter guidance & checklist, proton flux chart, dose vs reaction time view | \`brain/mission/radiation.py\`<br>\`app/js/systems/radiation.js\`<br>\`shared/radiation_snapshot.json\` | \`radiation\` screen (dashboard, charts, shelter modal) | \`state.radiation\` | \`radiation.updated\`<br>\`radiation.alert\`<br>\`shelter.advised\` | \`state.vitals.reaction_ms\` | **11 files** (TEPC, dosimeters, RAD, REM2, CPDS) | SR1–SR7 |
| **Person 2** | **Body Model & Zones** | 3D human body model (BodyParts3D anatomy, Three.js), clickable anatomical zones (head, chest, abdomen, pelvis, limbs, hands, feet, eyes), X-ray / anatomy toggles, mesh scan animation, organ views (heart, lungs, brain, eyes, stomach), zone-based symptom logging | \`app/js/body/*\`<br>\`app/js/systems/skin.js\`<br>\`systems/skin.py\` | \`body\` screen (3D canvas, system rail, organ inspection) | \`state.indicators.*\` (status glow) | \`body.zone.selected\`<br>\`body.scan.complete\`<br>\`symptom.logged\` | \`state.indicators.*\` (worst indicator status per zone sets glow) | **19 files** (Physical exam, dental, ophthalmology, bone density, MRI, skin) | SB1–SB7 |
| **Person 3** | **Face, AI Model & Voice** | MediaPipe face mesh (468 landmarks) & pose, rPPG pulse extraction with confidence, breathing rate, blendshape classifier for valence & arousal (opt-in mood analysis), VAD, Groq Whisper STT + local fallback, ElevenLabs/Kokoro/Web Speech TTS chain, wake word "hey Sentinel", intent matching, speaker ID, Brain LLM card rephraser with numeric guard | \`brain/ai/speech.py\`<br>\`brain/ai/whisper_worker.py\`<br>\`brain/ai/llm.py\`<br>\`systems/speaker.py\`<br>\`app/js/systems/face.js\`<br>\`app/js/core/intents.js\`<br>\`app/js/interface/orb.js\` | Ambient Voice Orb (all screens), camera scan modal | \`state.vitals.heart_rate\` (camera)<br>\`state.vitals.breathing_rate\`<br>\`state.wellbeing.dims.mood\` (camera) | \`reading.added\` (camera)<br>\`voice.command\`<br>\`voice.listening\` | \`recommendation.created\` (rephrases card)<br>\`state.profile.wellbeingPlan\` | **2 files** (Neurological assessment, hearing conservation) | SF1–SF8 |
| **Person 4** | **Vitals & Check-in** | Core physiological vitals entry (BP, glucose, temp, sleep, SpO2, exercise, meals) with validation; 30-sec PVT cognitive reaction test with reaction time & lapses; daily check-in wizard; dynamic trend charts with baseline bands; routine reminder scheduling & timers | \`app/js/systems/vitals.js\`<br>\`app/js/interface/readings.js\`<br>\`brain/rules/thresholds.py\`<br>\`shared/thresholds.json\`<br>\`shared/facts.json\` | \`vitals\` screen<br>\`cognitive\` test sheet<br>\`measures\` sheet<br>Daily check-in wizard | \`state.vitals.bp\`<br>\`state.vitals.blood_glucose\`<br>\`state.vitals.temperature\`<br>\`state.vitals.sleep_hours\`<br>\`state.vitals.reaction_ms\`<br>\`state.schedule\` | \`reading.added\` (manual, test)<br>\`checkin.started\`<br>\`checkin.complete\`<br>\`reminder.due\` | \`state.baseline.*\` (baseline bands)<br>\`state.schedule\` | **17 files** (Clinical labs, treadmill exercise test, functional fitness, handgrip, EVA prebreathe) | SV1–SV8 |
| **Person 5** | **Lonely Games & Wellbeing** | Anti-isolation countermeasures suite: (1) Orb Calm WebGL biofeedback with live pulse response & 4s/6s breathing pacer; (2) Space Race (Aurora Run) Three.js flight game with pre/post mood logging; (3) Hydroponic Greenhouse SVG plant showing growth stages 0-8 and wilt mechanic; (4) Earth Window animated CSS perspective; (5) Ambient Sound synthesizer; (6) Connection Nudge crew messaging; (7) Intervention menu & empirical tool ranking | \`app/js/experience/orbcalm.js\`<br>\`app/js/experience/race/*\`<br>\`app/js/experience/greenhouse.js\`<br>\`app/js/experience/interventions.js\`<br>\`app/js/experience/logic.js\`<br>\`app/assets/game/*\` | \`orb_calm\` sheet<br>\`race\` sheet<br>\`greenhouse\` sheet<br>\`wellbeing\` sheet<br>Intervention menu | \`state.intervention_log\`<br>\`state.engagement.greenhouse_stage\` | \`support.started\`<br>\`support.finished\`<br>\`intervention_log.added\`<br>\`greenhouse.stage\` | \`state.vitals.heart_rate\` (drives Orb Calm)<br>\`state.wellbeing.level\`<br>\`state.engagement\` | Research base (HRP Behavioral Health, NASA Space Gardening, isolation analogs) | SG1–SG7 |
| **Person 6** | **Dataset & Integration** | State store persistence & schema contract (\`brain/core/store.py\`, \`shared/contract.json\`), sequential decision pipeline (\`thresholds.py\` -> \`drift.py\` -> \`decision.py\`), event bus & UI router (\`stages.js\`, \`commands.js\`, \`director.js\`), ground link store-and-forward digest with 12.7-min delay simulation, environment profiles (station, transit, base, EVA), kit safety filter, NASA MRID catalog & source librarian, mock data seeder (6 crew, 14 days), master golden scenario verification | \`server.py\`<br>\`brain/core/store.py\`<br>\`brain/rules/thresholds.py\`<br>\`brain/rules/drift.py\`<br>\`brain/rules/decision.py\`<br>\`brain/mission/ground.py\`<br>\`shared/contract.json\`<br>\`shared/mock_data.json\`<br>\`shared/med_kit.json\`<br>\`app/js/core/*\`<br>\`dataset/_catalog.json\` | \`ground\` screen<br>\`crew\` sheet<br>\`mission\` screen<br>Environment & mode switchers | All state keys (\`state.*\`), snapshot selector \`getSnapshot(crewId)\` | \`status.updated\`<br>\`anomaly.raised\`<br>\`digest.queued\`<br>\`digest.changed\`<br>\`environment.changed\` | Merges all state patches from P1–P5; handles all store mutations | **19 files** (Environmental air quality, water quality, toxicology, EVA prebreathe protocols, mission clinical management) | SI1–SI7, S1–S19 |

### 4.2 Non-Conflicting Handoff Rules

1. **Strict File Ownership:** You edit ONLY the files assigned to your person. If you believe a file owned by another person needs a change, ask that person or Person 6 (Integration).
2. **Contract-First Schema Changes:** Any change to the state schema (\`shared/contract.json\`) or event payloads MUST be documented in Section 25 of this document first and approved by Person 6. Never commit undocumented JSON fields.
3. **Zero Cross-Module Direct Imports:** Never write \`import { ... } from '../another_person_module/'\`. If Person 1 needs reaction time, they read \`ctx.view.state.vitals.reaction_ms\`. If Person 5 needs heart rate, they read \`ctx.view.state.vitals.heart_rate\`. All data flows through state or the event bus.
4. **Honesty Labels Required on Ingest:** Every value pushed to the store must carry \`label: "LIVE" | "MANUAL" | "SIM" | "DESIGNED"\` and \`confidence: number (0.0 to 1.0)\`. \`brain/core/store.py\` will reject and drop any reading missing these fields.
5. **UI Component Encapsulation:** All screens must implement the standard \`render(el, ctx)\` lifecycle and register in \`app/js/core/commands.js\`.
6. **Integration Verification:** Person 6 merges PRs in phase order (Phase 0 through Phase 6) and runs the golden scenario test suite to ensure no regressions.

## 5. Module Template, Dataset Linking & Codebase UI Guide

### 5.1 How to Build on the Codebase UI

Sentinel’s front end is built with vanilla JavaScript (ES modules) running natively in modern browsers with **zero build steps** (\`npm run dev\` or simple static server). There is no React or bundler overhead.

#### Screen Registration & Lifecycle
Every UI feature screen belongs to the \`app/js/\` directory and follows this contract:

1. **Register the Screen ID in \`app/js/core/commands.js\`:**
   Add your screen ID (e.g. \`"radiation"\`, \`"orb_calm"\`, \`"greenhouse"\`) to the \`SCREENS\` array.
2. **Implement the Stage in \`app/js/core/stages.js\`:**
   Export a render function that mounts into the container element \`el\`:
   \`\`\`javascript
   export function renderMyScreen(el, ctx) {
     // 1. Read current crew state snapshot
     const s = ctx.view.state;
     const crewId = s?.crew_id ?? "james";

     // 2. Render initial HTML
     el.innerHTML = \`
       <div class="screen-layout">
         <h2>My Feature</h2>
         <div class="card" data-content></div>
       </div>\`;

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
   \`\`\`
3. **Context (\`ctx\`) Object Available to Every Screen:**
   - \`ctx.view.state\`: Latest immutable state snapshot of the active crew member.
   - \`ctx.bus\`: The event bus (\`emit(type, payload)\`, \`on(type, handler)\`, \`once(type, handler)\`).
   - \`ctx.openScreen(screenId)\`: Navigate to another screen.
   - \`ctx.openIntervention(id)\`: Open a specific wellbeing intervention.
4. **Shared UI Components (\`app/js/interface/\`):**
   - \`readings.js\`: Use \`badgeHTML(status, text)\`, \`sparkline(series)\`, \`esc(text)\` to ensure visual consistency.
   - \`orb.js\`: Shared WebGL orb renderer (\`createOrb(canvas, options)\`).
   - High contrast CSS variables: Always use \`--bg\`, \`--card\`, \`--line-dim\`, \`--ok\` (green), \`--watch\` (amber), \`--danger\` (red), \`--calm\` (cyan). Never hardcode colours.

### 5.2 How to Connect and Build from the NASA Dataset

The \`dataset/\` folder contains **94 PDF files** (68 unique documents) from NASA Medical Requirements Integration Documents (JSC 28913). Each person has specific assigned documents cataloged in \`dataset/_catalog.json\`.

#### Step-by-Step Dataset Utilization Workflow:
1. **Find Your Files:** Inspect \`dataset/_catalog.json\` and filter by \`"primaryOwner": "P<your_number>"\`.
2. **Extract Thresholds & Reference Ranges:**
   - Find the physiological limits or monitoring trigger values in the PDF.
   - Place them in \`shared/thresholds.json\` under the appropriate indicator.
   - Add \`"source": "NASA JSC 28913 MRID <number>"\` and set \`"demoDefault": false\`.
3. **Extract Measurement Instructions:**
   - Extract the exact clinical procedure or equipment instructions.
   - Add them to \`shared/facts.json\` under \`"how_to_measure"\`.
4. **Extract Clinical Rationale:**
   - Map the measurement to NASA HRP risks (e.g. Cardiovascular Adaptations, Hypoxia, Radiation Carcinogenesis).
   - Add this explanation to \`shared/facts.json\` under \`"why_it_matters"\`.
5. **Document Sources in \`shared/SOURCES.md\`:**
   - Record every file used with its title, MRID number, and where in the code it is cited.
`;

// 4. Part 3: Feature Modules (Sections 6 to 11)
let part3 = sliceBetween(/^# Part 3: Feature Modules/, /^# Part 4: Functionality/);

// 5. Part 4: Clinical Experience & Workflows (Sections 12 to 16)
let rawExp = sliceBetween(/^# Part 2: Experience/, /^# Part 3: Feature Modules/);
let part4 = rawExp.replace('# Part 2: Experience', '# Part 4: Clinical Experience & Workflows');
part4 = part4.replace('## 6. The Clinic Model and a Day With Sentinel', '## 12. The Clinic Model and a Day With Sentinel');
part4 = part4.replace(/### 6\./g, '### 12.');
part4 = part4.replace('## 7. Environments and Modes', '## 13. Environments and Modes');
part4 = part4.replace(/### 7\./g, '### 13.');
part4 = part4.replace('## 8. Personal Health Profile', '## 14. Personal Health Profile');
part4 = part4.replace(/### 8\./g, '### 14.');
part4 = part4.replace('## 9. Mental Wellbeing', '## 15. Mental Wellbeing');
part4 = part4.replace(/### 9\./g, '### 15.');
part4 = part4.replace('## 10. Screens, Navigation and UX', '## 16. Screens, Navigation and UX');
part4 = part4.replace(/### 10\./g, '### 16.');

// 6. Part 5: Clinical Intelligence & Detection (Sections 17 to 22)
let rawFunc = sliceBetween(/^# Part 4: Functionality/, /^## 18\. Requirements/);
let part5 = rawFunc.replace('# Part 4: Functionality', '# Part 5: Clinical Intelligence & Detection');
part5 = part5.replace('## 12. What We Track', '## 17. What We Track');
part5 = part5.replace('## 13. How Sentinel Detects Something Abnormal', '## 18. How Sentinel Detects Something Abnormal');
part5 = part5.replace(/### 13\./g, '### 18.');
part5 = part5.replace('## 14. Triage, Recommendations and Protocols', '## 19. Triage, Recommendations and Protocols');
part5 = part5.replace(/### 14\./g, '### 19.');
part5 = part5.replace('## 15. Reminders and Scheduling', '## 20. Reminders and Scheduling');
part5 = part5.replace('## 16. Ground Handoff', '## 21. Ground Handoff');
part5 = part5.replace('## 17. Core Workflows', '## 22. Core Workflows');

// 7. Part 6: Master Requirements Matrix (Section 23)
const part6 = `# Part 6: Master Requirements Matrix

## 23. Requirements Matrix

Priority: **M** must ship, **S** should, **C** could. Every single functional requirement is explicitly mapped to one owner (P1 to P6) and one feature module so that ownership boundaries are unambiguous.

| ID | Requirement | Priority | Owner | Feature Module |
| --- | --- | --- | --- | --- |
| FR-1 | Camera scan estimates heart rate and breathing rate and reads face expression, with a confidence value | M | Person 3 | Face, AI Model & Voice |
| FR-2 | Typed entry for blood pressure, glucose, temperature, sleep hours and mood, with unit labels and range validation | M | Person 4 | Vitals & Check-in |
| FR-3 | Symptom entry: tap a body zone, choose a symptom, rate severity | M | Person 2 | Body Model & Zones |
| FR-4 | 30-second cognitive reaction test with lapse count | S | Person 4 | Vitals & Check-in |
| FR-5 | Voice capture with wake word "hey Sentinel" and speaker identification | S | Person 3 | Face, AI Model & Voice |
| FR-6 | Cabin environment feed (oxygen, CO2) from a simulator | M | Person 6 | Dataset & Integration |
| FR-7 | Wearable ingestion (pulse, SpO2, temperature, eye camera, accelerometer) | C (DESIGNED) | Person 6 | Dataset & Integration |
| FR-8 | Green, amber or red status for every indicator against reference ranges | M | Person 4 | Vitals & Check-in |
| FR-9 | Learn each person's baseline from early check-ins; use reference ranges until enough data exists | M | Person 6 | Dataset & Integration |
| FR-10 | Anomaly detection with the layered method (ranges, deviation, trend, pattern), always with a plain-language reason | M | Person 6 | Dataset & Integration |
| FR-11 | Trend over days per indicator, drawn with individual baseline band | M | Person 4 | Vitals & Check-in |
| FR-12 | Data-quality gate: a low-confidence reading cannot raise an alert alone | S | Person 6 | Dataset & Integration |
| FR-13 | Clinical triage decision engine returning one of four urgency levels (0 to 3) | M | Person 6 | Dataset & Integration |
| FR-14 | Recommendation card generation (seen, sure, do, use, recheck, escalate-if, why) | M | Person 6 | Dataset & Integration |
| FR-15 | Evidence-sourced clinical protocol execution engine | M | Person 6 | Dataset & Integration |
| FR-16 | Active medical kit safety filter (suggest only available, non-contraindicated items) | M | Person 6 | Dataset & Integration |
| FR-17 | Follow-up: a recheck reminder is created automatically and the clinical outcome logged | S | Person 6 | Dataset & Integration |
| FR-18 | Spoken voice assistant responses to "What should I do?" via Brain LLM | M | Person 3 | Face, AI Model & Voice |
| FR-19 | Scheduled reminders: check-in, measurements, exercise, nutrition, sleep wind-down | M | Person 4 | Vitals & Check-in |
| FR-20 | Treatment and observation timers created by protocols | S | Person 4 | Vitals & Check-in |
| FR-21 | Adaptive reminders: snooze limits, respect sleep/EVA blocks, gentle escalation when missed | S | Person 4 | Vitals & Check-in |
| FR-22 | Multi-modal reminder delivery via screen banners, spoken voice, and orb glow pulses | M | Person 4 | Vitals & Check-in |
| FR-23 | Environment profiles (station, transit, base, EVA); switching recomputes thresholds, kit, schedule | M | Person 6 | Dataset & Integration |
| FR-24 | Communications status indicator (live, delayed, blackout) and wait-tolerance banner | S | Person 6 | Dataset & Integration |
| FR-25 | Mood trend from facial blendshapes, voice tone, and self-ratings, shown as change from baseline | M | Person 3 | Face, AI Model & Voice |
| FR-26 | Dynamic ranking and suggestion of calming interventions based on individual empirical efficacy | M | Person 5 | Lonely Games & Wellbeing |
| FR-27 | Privacy-first crew communication balance and talk-time monitoring | C | Person 6 | Dataset & Integration |
| FR-28 | Structured clinical digest builder for ground flight surgeon handoff | M | Person 6 | Dataset & Integration |
| FR-29 | Store-and-forward digest transmission queue with priority dispatch | S | Person 6 | Dataset & Integration |
| FR-30 | Interactive split-screen communication delay simulator (onboard vs ground perspective) | S | Person 6 | Dataset & Integration |
| FR-31 | Interactive 3D clickable body figure with anatomical zone inspection | M | Person 2 | Body Model & Zones |
| FR-32 | Triple-redundant visual status language: colour + icon + text label (never colour alone) | M | Person 2 | Body Model & Zones |
| FR-33 | Multilingual voice interface, glove-friendly large touch targets, low-light high-contrast UI | S | Person 3 | Face, AI Model & Voice |
| FR-34 | Natural language and picker-based environment selection with mandatory user confirmation | M | Person 6 | Dataset & Integration |
| FR-35 | Operational mission modes (routine, EVA/sortie, rest, contingency) layered over environment | S | Person 6 | Dataset & Integration |
| FR-36 | Context-specific protocol variants ensuring different procedural plans per environment | M | Person 6 | Dataset & Integration |
| FR-37 | Post-environment transition settling-in calibration period with softened statistical alerts | S | Person 6 | Dataset & Integration |
| FR-38 | Incremental personal health profile builder with progressive completeness score | M | Person 6 | Dataset & Integration |
| FR-39 | Real-time contraindication filter against known astronaut allergies and regular medications | M | Person 6 | Dataset & Integration |
| FR-40 | Four-dimensional mental wellbeing tracking (mood, energy, stress, connection) | M | Person 5 | Lonely Games & Wellbeing |
| FR-41 | Rapid 10-second daily mood/energy tap and weekly structured reflection | M | Person 5 | Lonely Games & Wellbeing |
| FR-42 | Individual wellbeing action plan (early personal warning signs, preferred coping tools, buddy contacts) | S | Person 5 | Lonely Games & Wellbeing |
| FR-43 | Guided multi-step support flows for acute stress spikes, insomnia patterns, and low-mood drift | M | Person 5 | Lonely Games & Wellbeing |
| FR-44 | Fixed safety protocol and emergency alert script for acute psychiatric distress | M | Person 6 | Dataset & Integration |
| FR-45 | Empirical tracking of stress delta before and after interventions to personalize tool ranking | S | Person 5 | Lonely Games & Wellbeing |
| FR-46 | Granular opt-in consent for camera-based expression analysis with voice/self-report fallback | M | Person 3 | Face, AI Model & Voice |
| FR-47 | Encrypted on-device private astronaut reflective journal | C | Person 5 | Lonely Games & Wellbeing |
| FR-48 | Scheduled playback of pre-recorded personal messages from home | C (DESIGNED) | Person 5 | Lonely Games & Wellbeing |
| FR-49 | Anonymized crew pulse survey aggregation requiring at least 3 respondents | C | Person 6 | Dataset & Integration |
| FR-50 | Clinician-approved brief psychological screening scales | C | Person 6 | Dataset & Integration |
| FR-51 | Space-weather proton flux feed ingestion, S-scale storm classification, and cumulative dose calculation (SIM) | M | Person 1 | Radiation Awareness |
| FR-52 | Space-weather shelter guidance, crew action checklist protocol, and storm recovery validation | M | Person 1 | Radiation Awareness |
| FR-53 | Interactive biofeedback Orb Calm with WebGL canvas, pulse-responsive turbulence, and 4s/6s breathing pacer | M | Person 5 | Lonely Games & Wellbeing |
| FR-54 | Space Race (Aurora Run) 3D flight game with custom Blender assets, obstacle navigation, and mood delta logging | S | Person 5 | Lonely Games & Wellbeing |
| FR-55 | Hydroponic Greenhouse plant visualization reflecting routine adherence streak and calm session completion | S | Person 5 | Lonely Games & Wellbeing |
| FR-56 | NASA MRID evidence catalog integration, multi-module event bus routing, and unified store state merge pipeline | M | Person 6 | Dataset & Integration |

| ID | Non-functional requirement |
| --- | --- |
| NFR-1 | Works fully offline; cloud is optional |
| NFR-2 | Video frames never stored; only numbers kept, on the device |
| NFR-3 | Every recommendation is explainable: which readings, which rule, which source |
| NFR-4 | Decisions come from rules and statistics, not the language model |
| NFR-5 | Every value and protocol line shows its label and source; unsourced lines marked "unverified" |
| NFR-6 | An audit log records every reading, flag, recommendation and action |
| NFR-7 | A status updates within a few seconds of a new reading |
`;

// 8. Part 7: System Architecture & Data Contracts (Sections 24 to 28)
let rawSys = sliceBetween(/^# Part 5: System and Data/, /^# Part 6: SaaS Platform/);
let part7 = rawSys.replace('# Part 5: System and Data', '# Part 7: System Architecture & Data Contracts');
part7 = part7.replace('## 19. Architecture', '## 24. Architecture');
part7 = part7.replace(/### 19\./g, '### 24.');
part7 = part7.replace('## 20. Data Model and Schemas', '## 25. Data Model and Schemas');
part7 = part7.replace(/### 20\./g, '### 25.');
part7 = part7.replace('## 21. Data Sources and Model Training', '## 26. Data Sources and Model Training');
part7 = part7.replace('## 22. Algorithms (Implementation Reference)', '## 27. Algorithms (Implementation Reference)');
part7 = part7.replace(/### 22\./g, '### 27.');
part7 = part7.replace('## 23. Privacy, Consent and Security', '## 28. Privacy, Consent and Security');

// 9. Part 8: SaaS Platform (Section 29)
let rawSaas = sliceBetween(/^# Part 6: SaaS Platform/, /^# Part 7: Build and Delivery/);
let part8 = rawSaas.replace('# Part 6: SaaS Platform', '# Part 8: SaaS Platform');
part8 = part8.replace('## 24. From Hackathon Build to SaaS Platform', '## 29. From Hackathon Build to SaaS Platform');
part8 = part8.replace(/### 24\./g, '### 29.');

// 10. Part 9: Build, Testing & Delivery (Sections 30 to 33)
let rawBuild = sliceBetween(/^# Part 7: Build and Delivery/, null);
let part9 = rawBuild.replace('# Part 7: Build and Delivery', '# Part 9: Build, Testing & Delivery');
part9 = part9.replace('## 25. Repository and Setup', '## 30. Repository and Setup');
part9 = part9.replace('## 26. Build Order and Milestones', '## 31. Build Order and Milestones');
part9 = part9.replace('## 27. Testing', '## 32. Testing & Verification');
part9 = part9.replace(/### 27\./g, '### 32.');
part9 = part9.replace('## 28. Recipes and Troubleshooting', '## 33. Recipes and Troubleshooting');

// Combine everything cleanly
const finalDoc = [
  section0.trim(),
  rawPart1.trim(),
  part2.trim(),
  part3.trim(),
  part4.trim(),
  part5.trim(),
  part6.trim(),
  part7.trim(),
  part8.trim(),
  part9.trim()
].join('\n\n') + '\n';

fs.writeFileSync(docPath, finalDoc, 'utf8');
console.log('Rebuilt document successfully!');
console.log('Total length:', finalDoc.length, 'Total lines:', finalDoc.split('\n').length);
