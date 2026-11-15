# SENTINEL: Autonomous Onboard Crew-Health Assistant
## NASA Space Apps Challenge 2026 Master Pitch Deck
**Challenge:** "Create Health Monitoring Software for Astronauts on Space Missions"  
**Team:** @mistarstudio · Nov 2026  
**Format:** 18-Slide Comprehensive Presentation Blueprint (Slide Visuals + Copy + Technical Backing + Speaker Pitch Scripts)

---

## Slide Index & Overview

1. [Slide 1: Title & Hook — Autonomous Healthcare 40 Million Miles from Earth](#slide-1-title--hook)
2. [Slide 2: The Core Problem — The 3 A.M. Crisis & The Cognitive Gap](#slide-2-the-core-problem)
3. [Slide 3: Introducing Sentinel — An Onboard Clinic, Not a Data Logger](#slide-3-introducing-sentinel)
4. [Slide 4: What Makes Sentinel Different — The 10 Architectural Differentiators](#slide-4-what-makes-sentinel-different)
5. [Slide 5: End-to-End System Architecture — Edge-Native & Zero-Cloud](#slide-5-end-to-end-system-architecture)
6. [Slide 6: Core Workflow: The 5 Operational Clinic Modes](#slide-6-core-workflow-the-5-operational-clinic-modes)
7. [Slide 7: Multimodal Check-in & The 3D Interactive Body](#slide-7-multimodal-check-in--the-3d-interactive-body)
8. [Slide 8: The Clinical Intelligence Engine — Deterministic Rules over LLM Guesses](#slide-8-the-clinical-intelligence-engine)
9. [Slide 9: Behavioral Health & Anti-Isolation Countermeasures](#slide-9-behavioral-health--anti-isolation-countermeasures)
10. [Slide 10: Space-Weather & Radiation Awareness](#slide-10-space-weather--radiation-awareness)
11. [Slide 11: End-to-End Operational Crew Care Flow (Patient Walkthrough)](#slide-11-end-to-end-operational-crew-care-flow)
12. [Slide 12: Interplanetary Networking — Operating in Deep Space Without Internet](#slide-12-interplanetary-networking)
13. [Slide 13: NASA Systems Integration — Pluggable Add-on for EIMO & CHP-IDA](#slide-13-nasa-systems-integration)
14. [Slide 14: Phased Deployment Horizon — The 3-Phase Integration Roadmap](#slide-14-phased-deployment-horizon)
15. [Slide 15: Grounded in Real NASA Evidence — 94 JSC 28913 MRID Documents](#slide-15-grounded-in-real-nasa-evidence)
16. [Slide 16: Radical Honesty & Trust — LIVE, MANUAL, SIM & DESIGNED](#slide-16-radical-honesty--trust)
17. [Slide 17: Dual-Horizon Impact — From Mars Transit to Remote Earth Telemedicine](#slide-17-dual-horizon-impact)
18. [Slide 18: Live Demonstration & Mission Summary](#slide-18-live-demonstration--mission-summary)

---

### Slide 1: Title & Hook
#### Visual Blueprint
- **Background:** High-contrast deep space backdrop (stars, subtle Mars silhouette).
- **Hero Graphic:** Sentinel WebGL Ambient Orb glowing calm cyan, accompanied by the 3D anatomical body scan with illuminated health zones.
- **Header:** **SENTINEL** in futuristic, crisp typography (*Michroma / Inter*).
- **Sub-header:** The Autonomous Onboard Clinical Assistant for Deep Space Missions.
- **Badge Bar:** `NASA Space Apps Challenge 2026` · `Edge-Native / Offline-First` · `HRP Aligned` · `Deterministic Clinical Engine`

#### Slide Content
- **The Challenge:** Building autonomous, trustworthy health management software when Earth is up to 24 light-minutes away.
- **Our Solution:** An edge-native onboard clinic that captures vitals, evaluates personal baselines, triages acute symptoms, executes evidence-based medical protocols, and protects mental wellbeing.
- **Tagline:** *"Because 40 million miles from Earth, you can't call 911."*

#### Speaker Script (Pitch Hook - 30 seconds)
> "Judges, imagine you are six months into a three-year mission to Mars. It’s 3:00 a.m. onboard. You wake up with sudden chest tightness and a throbbing headache. You cannot call Houston for immediate help—radio communications face a 20-minute speed-of-light delay each way. Today’s commercial health tools are passive data loggers or cloud-tethered telemedicine apps that completely collapse without an internet link.
> 
> Meet **Sentinel**: an autonomous onboard clinic designed specifically for long-duration spaceflight. Sentinel doesn't just record numbers—it notices changes from your personal baseline, tells you exactly what to do step-by-step from NASA protocols, guides you through live biofeedback, and packages clinical digests for the flight surgeon. Completely offline. Never guessing. Welcome to Sentinel."

---

### Slide 2: The Core Problem — The 3 A.M. Crisis & The Cognitive Gap
#### Visual Blueprint
- **Layout:** 2-column comparative layout.
  - *Left Column:* NASA's 5 Hazards of Human Spaceflight diagram (Radiation, Isolation/Confinement, Distance from Earth, Gravity Fields, Closed/Hostile Environments).
  - *Right Column:* The Deep-Space Clinical Reality (The 3 Critical Friction Points: Comms Latency, Non-Specialist CMO Cognitive Load, Multi-System Sensor Overload).
- **Alert Callout Box:** *"Standard telemedicine fails when round-trip delay reaches 40 minutes."*

#### Slide Content
* **The Reality of Deep Space Exploration (Moon, Mars, Deep Space Transit):**
  1. **Speed-of-Light Latency:** Telemedicine requires real-time conversation. At Mars distance (0.5 to 2.7 AU), radio signals take between 3 and 22 minutes *one-way* (up to 44 minutes round-trip). Real-time ground consultation is physically impossible.
  2. **Trained, But Non-Specialist Crews:** Astronauts and designated Crew Medical Officers (CMOs) undergo cross-disciplinary emergency medical training. However, they are *not board-certified emergency physicians or clinical specialists*. Under extreme physical exhaustion, sleep deprivation, and microgravity stress, recalling and executing dozens of intricate differential diagnostic protocols without an expert in the room represents an overwhelming cognitive burden.
  3. **Multi-System Compounding:** Microgravity degrades cardiovascular fitness; isolation drives behavioral drift; cosmic radiation increases stress; hostile cabin air causes insidious hypoxia.
  4. **The Sensor Trap:** Astronauts are overwhelmed by raw numbers, disconnected charts, and false alarms without actionable, verified clinical context.

#### Speaker Script (45 seconds)
> "NASA's Human Research Program has defined five irreducible hazards of human spaceflight. When humanity heads to Mars, we cross a historic threshold: the complete severance of real-time medical evacuation and instant ground support.
>
> Astronauts and Crew Medical Officers undergo rigorous cross-disciplinary medical training, but they are primarily pilots, geologists, and aerospace engineers—not career emergency room physicians. At 3 a.m., under physical exhaustion and microgravity fluid shifts, executing complex differential diagnoses from memory is a massive cognitive burden.
>
> Furthermore, ground control won't even receive an emergency telemetry packet for 15 to 20 minutes. By the time flight surgeons reply, the emergency has either resolved or turned catastrophic. Deep-space crews do not need raw graphs; they need an autonomous clinical co-pilot that acts as a cognitive force multiplier. That is the exact gap Sentinel was engineered to bridge."

---

### Slide 3: Introducing Sentinel — An Onboard Clinic, Not a Data Logger
#### Visual Blueprint
- **Centerpiece:** UI screenshot of the Sentinel Home Screen:
  - 3D Interactive Anatomical Figure with glowing organ status zones (Head, Heart, Lungs, Gut, Bones).
  - Selected vital detail showing the **Personal Baseline Band** (not just a generic normal range).
  - Active Recommendation Card with step-by-step numbered protocol and kit item location.
  - Multi-modal status chip: Colour + Icon + Word (`OK [Green]`, `WATCH [Amber]`, `ACT [Amber]`, `URGENT [Red]`).
- **Feature Triangle:** `Autonomous Triage` ◄► `Personalized Baseline` ◄► `Closed-Loop Care`

#### Slide Content
* **What is an Onboard Clinic?**
  - **Triages:** Translates raw signals into an urgency classification (Levels 0–3).
  - **Guides:** Delivers step-by-step checklists citing NASA Medical Requirements Integration Documents (MRIDs).
  - **Filters Medical Supplies:** Checks the onboard medical kit and filters suggestions against astronaut allergies.
  - **Follows Up:** Sets automatic recheck timers and logs whether the intervention restored baseline health.
  - **Communicates Asynchronously:** Prepares structured clinical handoff digests for the flight surgeon when communications windows open.

#### Speaker Script (45 seconds)
> "We want to be very clear about our positioning: **Sentinel is an onboard clinic, not a data logger.** 
>
> A fitness watch or telemetry dashboard simply records that your pulse is 112 bpm and draws a red line. Sentinel does something fundamentally different: it evaluates that 112 bpm against your personal 14-day median, checks your mission context—verifying you aren't currently exercising or on EVA—correlates it with your sleep deficit and reaction time, and determines if this represents an isolated fluctuation or a multi-system pattern.
>
> If intervention is needed, Sentinel displays an unambiguous recommendation card: Step 1, rest in a seated position; Step 2, hydrate with 300ml; Step 3, initiate Orb Calm breathing. It points to the exact drawer in the medical kit, blocks contraindicated medicines, and sets an automatic 15-minute recheck timer. It turns data into autonomous care."

---

### Slide 4: What Makes Sentinel Different — The 10 Architectural Differentiators
#### Visual Blueprint
- **Layout:** High-impact comparison matrix (Sentinel vs. Consumer Apps vs. Standard Telemedicine vs. Raw Data Loggers).
- **Highlights:** Glowing checkmarks across Sentinel's 10 differentiators.

#### Slide Content: The 10 Differentiators Table
| # | Capability | Consumer Health App | Standard Telemedicine | Sensor Data Logger | **SENTINEL** |
|---|---|:---:|:---:|:---:|:---:|
| **1** | **Onboard Clinic (Triage & Protocol)** | ❌ Generic tips | ⚠️ Yes, once linked | ❌ No | **✅ Autonomous, On-Device** |
| **2** | **Environment-Aware Logic** | ❌ None | ⚠️ Human clinician | ❌ None | **✅ Station / Transit / Base / EVA** |
| **3** | **Personal Baseline Tracking** | ❌ Population averages | ⚠️ Periodic notes | ❌ Raw thresholds | **✅ Rolling Median + Robust MAD** |
| **4** | **Integrated Mind & Body Loop** | ❌ Disconnected | ⚠️ Fragmented | ❌ No | **✅ 4D Mental State in Decision Tree** |
| **5** | **Closed-Loop Biofeedback** | ❌ Static timers | ❌ No | ❌ No | **✅ Real-Time Pulse-Responsive Orb** |
| **6** | **Explainability & Labeling** | ❌ Black-box AI | ⚠️ Doctor explains | ❌ Raw numbers | **✅ "Why This?" Trace + Honest Labels** |
| **7** | **Privacy-First Team Layer** | ❌ None | ❌ No | ❌ No | **✅ Anonymous Crew Pulse (3+ rule)** |
| **8** | **Delay-Tolerant Architecture** | ❌ Crashes offline | ❌ Latency failure | ⚠️ Dumps raw files | **✅ 12.7-min Store & Forward Digest** |
| **9** | **Cabin & Hazard Integration** | ❌ None | ❌ No | ⚠️ Separate sensor | **✅ Radiation S-Scale & Life Support** |
| **10** | **Earth Spinoff Potential** | ⚠️ Consumer wellness | ⚠️ Requires 5G/Sat | ❌ Hardware only | **✅ Polar / Submarine / Rural Offline** |

#### Speaker Script (45 seconds)
> "When evaluating health software, judges often ask: 'How is this different from an Apple Watch or an electronic health record?' Here are the differentiators that set Sentinel apart:
>
> First, **Environment-Aware Advice**. The same headache is treated completely differently if you are on the space station with a docked return vehicle, inside a deep-space transit cabin where resupply is zero, or inside an EVA spacesuit where you cannot touch your face and suit pressure is life-critical.
> Second, **Zero Hallucination Architecture**. In medical software, an LLM must never invent dosages or diagnose illnesses. In Sentinel, deterministic mathematical rules and sourced NASA protocols make every single medical decision. The language model is strictly confined to natural voice rephrasing with rigid numeric guardrails.
> Third, **Closed-Loop Biofeedback**. When you launch our Orb Calm tool, the WebGL sphere directly synchronizes with your live webcam pulse, calming from turbulent red to tranquil blue only as your physiological vitals physically recover."

---

### Slide 5: End-to-End System Architecture — Edge-Native & Zero-Cloud
#### Visual Blueprint
- **Architecture Flow Diagram:**
  - `Inputs Layer` (Camera rPPG, Forms, 30s PVT Reaction Test, Cabin Feeds, NOAA Space Weather)
  - `Core Engine (Local FastAPI & Store)`
    - Validation Gate (Sanity bounds, Confidence score)
    - Personal Baseline Engine (Rolling Median + MAD)
    - Sequential Decision Pipeline: `thresholds.py` → `drift.py` → `decision.py`
  - `Presentation & UI Layer` (Vanilla JS ES-Modules, Three.js 3D Body/Mars, Web Audio Pad, Web Speech TTS)
  - `Ground Comms Link` (Store-and-Forward Digest Queue, 12.7-Min Delay Simulator)
- **Key Metric Callout:** `100% Offline Capability` · `0ms Cloud Latency` · `Zero npm/bundler runtime dependencies`

#### Slide Content
* **Input Ingestion:**
  - Non-contact webcam photoplethysmography (rPPG) extracts pulse and respiration rate in real time without sensors.
  - Manual vitals validation (Blood Pressure, Blood Glucose, Core Temp, Sleep Quality).
  - Neuro-behavioral 30-second Psychomotor Vigilance Task (PVT) for fatigue and lapse counting.
* **The Unified State Store (`brain/core/store.py`):**
  - Thread-safe local persistence (`data/state.json`).
  - Append-only telemetry history capped at 2,000 points per metric.
  - Strict ingestion gate: rejects any telemetry packet lacking a data `label` or `confidence` score.
* **Event-Driven Communication (`app/js/core/bus.js`):**
  - Complete decoupling via pub/sub event bus (`reading.added`, `status.updated`, `anomaly.raised`, `digest.queued`).
  - Full cryptographic audit trail: every reading, decision, alert acknowledgment, and kit usage is recorded locally.

#### Speaker Script (45 seconds)
> "Let’s look under the hood at Sentinel’s architecture. Sentinel was built from day one to operate completely disconnected from the internet. The entire backend runs as a lightweight, memory-efficient Python FastAPI engine, while the frontend is pure modern ES-module JavaScript with zero heavy framework bloat.
>
> Telemetry enters from five distinct channels: non-contact computer vision rPPG, manual clinical entry forms, active 30-second cognitive reaction tests, cabin environmental monitors, and live NOAA space-weather proton feeds.
>
> Every piece of data passes through our strict validation gate in `store.py`. If a reading lacks an honesty label or a confidence metric, the store rejects it. Once validated, readings trigger our sequential decision pipeline: first checking absolute safety thresholds, then computing statistical drift against personal history, and finally evaluating deterministic clinical rules. Everything communicates through an event bus that logs every transaction to an immutable audit trail."

---

### Slide 6: Core Workflow: The 5 Operational Clinic Modes
#### Visual Blueprint
- **Circular State Machine Diagram:** Illustrating the progression through Sentinel's 5 operational clinic modes:
  1. `MONITOR` (Silent, passive background telemetry)
  2. `CHECK-UP` (Scheduled daily 2-minute clinical check-in wizard)
  3. `TRIAGE` ("I don't feel well" acute symptom questionnaire)
  4. `TREAT & FOLLOW-UP` (Actionable protocol runner, kit item drawer location, timers)
  5. `ESCALATE` (Priority ground digest dispatch, buddy & commander alerts)

#### Slide Content
* **Mode 1: Continuous Monitor**
  - Runs passively in the habitat. Evaluates ambient cabin oxygen, CO2, and space-weather storm alerts. Silent unless safe limits are breached.
* **Mode 2: Morning Check-up (The 2-Minute Ritual)**
  - 30-second camera scan for pulse and respiration → 3-tap manual vitals → 10-second mood/energy tap → 30-second PVT cognitive test → Comprehensive daily status headline.
* **Mode 3: Autonomous Triage**
  - Triggered by voice (*"Hey Sentinel, I have a migraine"*) or clicking the 3D body figure.
  - Evaluates red-flag symptoms (e.g., headache + vision changes = immediate SANS / acute escalation).
  - Assigns an objective Urgency Level from 0 (Normal) to 3 (Urgent).
* **Mode 4: Treat and Follow-up**
  - Displays numbered clinical checklists sourced directly from NASA Medical Requirements.
  - Indicates exact physical kit item location (e.g., *Medical Pack Beta, Tray 2*).
  - Automatically schedules a follow-up recheck reminder (15m, 1h, or 4h).
* **Mode 5: Escalate**
  - Slashes through quiet hours for critical emergencies. Sends loud auditory alarm, speaks urgent steps, alerts the astronaut's designated crew buddy, and queues priority flight surgeon digests.

#### Speaker Script (45 seconds)
> "In practice, an astronaut experiences Sentinel through five distinct clinical modes that mirror a world-class medical consultation:
>
> Throughout the day, Sentinel remains in **Monitor Mode**—silent, non-intrusive, watching cabin life support and space weather. Each morning, the astronaut completes **Check-up Mode**: a guided two-minute workflow capturing biometric vitals, psychological state, and cognitive reaction time.
>
> If an astronaut feels unwell, they say *'Hey Sentinel, I have a headache'* or tap the 3D body model to enter **Triage Mode**. Sentinel asks three targeted clinical questions to rule out red flags—such as neurological vision loss or sudden onset. It assigns an urgency level, provides the exact treatment protocol in **Treat Mode**, checks for drug allergies, highlights where the medication is stored in the habitat, and sets a timer to verify if the treatment worked. If the condition deteriorates, Sentinel automatically transitions into **Escalate Mode**, alerting the crew commander and dispatching an encrypted digest to Earth."

---

### Slide 7: Multimodal Check-in & The 3D Interactive Body
#### Visual Blueprint
- **Left Panel:** The 3D Body Mesh (`BodyParts3D` anatomical model rendered in Three.js).
  - Shows X-Ray toggle mode, revealing internal organs (Heart, Lungs, Brain, Digestive tract).
  - Anatomical zones glowing green/amber based on real-time indicator status.
- **Right Panel:** The Check-in Flow & Cognitive Test UI:
  - MediaPipe facial landmarker and forehead ROI camera feed estimating heart rate (rPPG).
  - 30-Second PVT (Psychomotor Vigilance Task) millisecond reaction timer showing lapse count.
  - Triple-redundant status badge: Icon + Text + Colour (`● OK - Nominal`, `▲ WATCH - Drift Detected`).

#### Slide Content
* **3D Interactive Body (`app/js/body/` & `app/js/world/body3d.js`):**
  - Real anatomical models from BodyParts3D, not stylized cartoons.
  - Click-to-inspect: tapping the chest immediately loads ECG/HR trends, respiration history, and cardiac clinical guidance.
  - X-Ray & Anatomy toggles reveal underlying organ systems.
  - Glove-friendly UI design: oversized touch targets (minimum 48px hit areas) optimized for pressurized spacesuit operations.
* **Computer Vision rPPG (`app/js/vision/rppg.js` & `app/js/systems/face.js`):**
  - Measures subtle micro-vascular facial skin color variations (photoplethysmography) from standard webcams.
  - Calculates confidence values based on ambient lighting and movement; low-confidence readings are labeled `LIVE estimate` and never trigger false alarms alone.
* **PVT Cognitive Reaction Test (`app/js/systems/pvt.js`):**
  - 30-second standardized spaceflight psychomotor vigilance test.
  - Measures reaction latency (ms) and attention lapses, providing objective operational fatigue tracking.

#### Speaker Script (45 seconds)
> "The visual cornerstone of Sentinel is our interactive 3D human body model. Built with Three.js utilizing real BodyParts3D anatomical datasets, it gives astronauts instant situational awareness of their physical state.
>
> Astronauts can toggle between external surface skin, diagnostic mesh scans, and internal organ X-rays. If an astronaut feels pain, they don't have to fill out complex forms—they simply tap the affected zone on the 3D figure.
>
> Notice our input methods: for hands-free operation while wearing heavy gloves, astronauts use our natural voice interface. For vitals, our camera scan extracts real-time pulse and respiration rates using computer vision rPPG without requiring wired sensors. And to monitor the severe cognitive fatigue caused by sleep disruption in microgravity, we built a 30-second Psychomotor Vigilance Task directly into the daily check-in routine."

---

### Slide 8: The Clinical Intelligence Engine — Deterministic Rules over LLM Guesses
#### Visual Blueprint
- **Pipeline Diagram:** Visual representation of the 5-layer anomaly detection pipeline:
  ```
  [Raw Ingest] ──> [1. Safe Limits] ──> [2. Personal Baseline (MAD)] ──> [3. Multi-Day Trend] ──> [4. Cross-Signal Pattern] ──> [5. Context Suppression]
                                                                                                                        │
  [Deterministic Decision: Level 0-3] <─────────────────────────────────────────────────────────────────────────────────┘
           │
           ▼
  [Brain LLM: Strict 2-Sentence Card Rephraser + Numeric Guardrail] ──> [Spoken Voice TTS & UI Card]
  ```
- **Code Snippet / Formula Callout:**
  $$z = \frac{x - \text{median}}{\max(1.4826 \times \text{MAD}, \text{minSpread})}$$
  *"Personal baseline deviation measures distance from your own median, never a generic population average."*

#### Slide Content
* **Why Statistics & Deterministic Rules Beat Generative AI:**
  - Standard LLMs suffer from hallucinations, stochastic unpredictability, and unverified medical advice.
  - **Sentinel's Iron Rule:** Rules and clinical protocols make 100% of the diagnostic and triage decisions. The LLM only handles conversational rephrasing.
* **The 5-Layer Detection Pipeline (`brain/rules/drift.py` & `brain/rules/thresholds.py`):**
  1. **Absolute Safe Limits:** Instant breach detection (e.g., Cabin $O_2 < 19.5\%$ or Heart Rate $> 160\text{ bpm}$).
  2. **Personal Baseline Drift:** Evaluates rolling 14-day median and Median Absolute Deviation (MAD). Catches subtle individual deviations that appear 'normal' on population charts.
  3. **Multi-Day Trend Slopes:** Least-squares linear regression identifying steady deterioration over 3–5 days.
  4. **Cross-Signal Compounding Patterns:** Evaluates multi-system strain (e.g., decreased sleep + slower PVT reaction time + flattened mood = Level 2 Fatigue Syndrome).
  5. **Contextual Suppression:** Automatically silences alerts if vitals shift during or immediately following scheduled EVA or heavy exercise sessions.
* **The Brain LLM with Numeric Guard (`brain/ai/llm.py`):**
  - Groq-accelerated lightweight Llama/Whisper model with local fallback.
  - Regex-enforced Numeric Guard: guarantees the model can never introduce unverified dosages, numbers, or unauthorized medications into spoken responses.

#### Speaker Script (50 seconds)
> "One of the most critical engineering decisions we made is how we handle Artificial Intelligence. In high-stakes aerospace medicine, trusting an unconstrained Large Language Model to prescribe treatments is unacceptable. LLMs hallucinate, invent dosages, and lack deterministic accountability.
>
> In Sentinel, **the clinical brain is 100% deterministic**. We employ a five-stage mathematical anomaly engine. First, it verifies safe reference limits. Second, it calculates the astronaut's distance from their personal rolling median using Median Absolute Deviation. This means if an astronaut's baseline resting pulse is 52 bpm, a jump to 78 bpm triggers a watch alert—even though 78 is considered 'normal' on Earth.
>
> Third, it detects subtle multi-day slope trends. Fourth, it identifies cross-signal compounding patterns—such as a simultaneous drop in sleep duration, spike in PVT reaction lapses, and decline in vocal pitch.
>
> Where does the LLM fit? It acts strictly as a calm, conversational voice interface. Our Brain LLM takes the structured JSON recommendation card and rephrases it into two concise spoken sentences. Our custom numeric guardrail validates that every number uttered matches the underlying medical card exactly."

---

### Slide 9: Behavioral Health & Anti-Isolation Countermeasures
#### Visual Blueprint
- **Visual Collage of 4 Wellbeing Systems:**
  - *Orb Calm:* WebGL breathing orb glowing red with high pulse turbulence, shifting to serene blue and smooth geometry as heart rate normalizes.
  - *Space Race (Aurora Run):* Three.js 3D spaceflight navigation game featuring custom Blender spacecraft and planetary flybys.
  - *Hydroponic Greenhouse:* Interactive growing plant reflecting consecutive check-in streaks and mindfulness sessions (wilts with neglect, never dies).
  - *Earth Window & Ambient Pad:* Calming slow-motion orbital view of Earth with Web Audio multi-oscillator binaural acoustic soundscapes.
- **Callout:** *"NASA HRP Hazard: Isolation and Confinement. Mitigated through empirical, closed-loop psychological support."*

#### Slide Content
* **The 4 Dimensions of Mental Wellbeing:**
  - **Mood:** Daily self-ratings + optional MediaPipe facial valence/arousal tracking.
  - **Energy:** Sleep duration + sleep quality + PVT cognitive reaction readiness.
  - **Stress:** Self-rated stress + resting heart rate drift + autonomic arousal.
  - **Connection:** Communication balance, talk-time participation, and social engagement.
* **Empirical Closed-Loop Learning (`app/js/experience/logic.js`):**
  - Every intervention logs pre-session and post-session stress ratings.
  - Sentinel dynamically ranks which countermeasures actually work for each specific astronaut over time (e.g., ranking Orb Calm ahead of Earth Window if biofeedback produces a greater $\Delta\text{Stress}$ reduction).
* **Privacy-Preserving Crew Pulse:**
  - Weekly 2-question team cohesion survey.
  - Aggregated only when $\ge 3$ crew members respond; names and identities are cryptographically stripped to protect psychological safety.

#### Speaker Script (45 seconds)
> "NASA lists isolation and confinement as one of the most dangerous psychological hazards of long-duration spaceflight. When you are confined to a metal canister for three years, homesickness, depression, and sensory monotony take a severe toll.
>
> Sentinel treats mental wellbeing as an integral vital sign. We track four distinct psychological dimensions: Mood, Energy, Stress, and Connection. But we don't just display a bleak graph—we provide active countermeasures.
>
> Our flagship tool is **Orb Calm**: an interactive WebGL biofeedback experience. The orb syncs to your live camera pulse. If you are anxious, it pulses rapidly with jagged red turbulence. As you follow the 4-second inhale, 6-second exhale breathing pacer, the orb visibly cools and stabilizes into a serene blue sphere.
>
> We also built **Space Race**, an arcade 3D flight game designed to break monotonous cognitive fatigue; a **Hydroponic Greenhouse** where a virtual plant flourishes as you maintain your check-in streak; and an **Earth Window** offering calming views of home. Crucially, Sentinel measures stress before and after every session, empirically learning which tool works best for your brain."

---

### Slide 10: Space-Weather & Radiation Awareness
#### Visual Blueprint
- **Dashboard UI Mockup:** The Sentinel Radiation Awareness Screen:
  - Live NOAA GOES Proton Flux graph with logarithmic scaling.
  - S-Scale storm classification badges (`S1 - Minor`, `S2 - Moderate`, `S3 - Strong`, `S4 - Severe`, `S5 - Extreme`).
  - Cumulative Dose Passport gauge (mSv) calculating exposure against mission limits.
  - Action Banner: `S3 Solar Radiation Storm Detected · Move to Storm Shelter Immediately · Crew Checklist Active`.
- **Honesty Callout:** `Label: SIM · Awareness & Shelter Guidance Only · Does Not Measure Physical Dose`

#### Slide Content
* **Real-Time Space Weather Tracking (`brain/mission/radiation.py`):**
  - Continuous ingestion from NOAA GOES satellite real-time proton flux JSON feeds (with local snapshot fallback for offline resilience).
  - Categorizes Solar Particle Events (SPEs) into NOAA S-scale space weather alerts.
* **Autonomous Shelter Advisory Protocol:**
  - When proton flux crosses storm thresholds ($\ge S2/S3$), Sentinel automatically sounds an alert and generates an emergency crew protocol:
    1. Cease current habitat tasks and cancel planned EVAs.
    2. Move to heavily shielded central core / storm shelter module.
    3. Verify water-wall shielding barriers are deployed.
    4. Log shelter ingress timestamp and monitor radiation status.
* **Dose Passport & Crew Readiness View:**
  - Models cumulative ionizing radiation accumulation based on vehicle shielding factors.
  - Correlates radiation flux spikes with astronaut PVT reaction times to verify physical and cognitive readiness.

#### Speaker Script (45 seconds)
> "Deep-space missions travel far beyond the protective shield of Earth's magnetosphere. Solar Particle Events and Galactic Cosmic Rays pose an acute threat of radiation sickness and long-term carcinogenesis.
>
> Sentinel features a dedicated Space-Weather and Radiation Awareness module. In live operations, it ingests proton flux data directly from NOAA GOES satellite feeds, with automatic fallback to verified offline snapshots.
>
> When proton levels cross storm thresholds—reaching NOAA S2 or S3 levels—Sentinel issues an immediate habitat alert. It presents a prioritized checklist: evacuate exposed corridors, retreat to the central water-shielded habitat core, and log ingress time.
>
> In accordance with our radical honesty principles, Sentinel clearly labels all radiation values as **SIM**. We explicitly tell astronauts and judges: this module provides tactical environmental awareness and shelter guidance; it does not replace calibrated physical dosimeters."

---

### Slide 11: End-to-End Operational Crew Care Flow (Patient Walkthrough)
#### Visual Blueprint
- **Chronological Horizontal Workflow Diagram:**
  ```
  [03:14 AM] Acute Symptom ──> [03:15 AM] Voice & 3D Pointing ──> [03:16 AM] Deterministic Rule Match
                                                                               │
  [03:20 AM] Ground Link Queue <── [03:18 AM] Biofeedback & Recheck <── [03:17 AM] Kit Check & Allergy Filter
  ```
- **UI Screen Callouts:**
  - *Callout A:* 3D Body touch highlight on Head/Eyes zone.
  - *Callout B:* Active Recommendation Card showing kit drawer location and allergy checkmark.
  - *Callout C:* 15-minute recheck timer ticking down.

#### Slide Content
* **Real-World Mission Care Scenario:**
  1. **Trigger (03:14 AM):** Astronaut wakes with throbbing orbital pain and visual blurring during sleep block.
  2. **Contact (03:15 AM):** Hands-free voice trigger: *"Hey Sentinel, I don't feel well."* Astronaut taps the Head/Eyes zone on the 3D body figure.
  3. **Triage & Red-Flag Screening (03:15 AM):** Sentinel prompts 3 rapid clinical questions: sudden onset, visual field defect, or nausea. Screens for acute SANS (Spaceflight Associated Neuro-ocular Syndrome) and intracranial pressure shifts.
  4. **Protocol Execution (`brain/rules/decision.py`):** Matches Protocol `P-HEAD-SANS` (Level 2 Act). Evaluates NASA MR017 and MR010L guidelines.
  5. **Medical Kit & Allergy Safety Filter (`brain/core/profile.py`):** Suggests Acetaminophen from *Medical Kit Drawer 3B*; cross-references astronaut's encrypted profile to guarantee no hepatic contraindications or active medication interactions.
  6. **Closed-Loop Follow-up:** Directs astronaut to rest in a seated position; initiates a 5-minute dark-cabin Orb Calm breathing exercise; sets an automated 30-minute recheck timer.
  7. **Asynchronous Ground Digest (`brain/mission/ground.py`):** Encrypts and queues a priority Clinical Digest for Houston Flight Medicine.

#### Speaker Script (50 seconds)
> "Let’s walk through a real-world scenario to see how all six modules function together as an integrated clinical workflow:
>
> It’s 3:14 a.m. in deep transit. An astronaut wakes with throbbing pain behind the eyes. Without touching a mouse, they speak: *'Hey Sentinel, I don't feel well.'* The ambient voice assistant activates, and they tap the Head and Eyes zone on the 3D body model.
>
> Sentinel immediately executes a rapid triage algorithm to rule out red flags for acute intracranial pressure or Spaceflight Associated Neuro-ocular Syndrome. Finding no emergency red flag, it matches our evidence-based protocol, citing NASA standards MR017 and MR010L.
>
> Next, Sentinel checks the physical habitat manifest: it points to Drawer 3B for medication, while running our safety filter against the astronaut’s medical profile to verify there are zero drug allergies. It launches a 5-minute Orb Calm breathing exercise to reduce autonomic pressure, sets a 30-minute recheck timer, and automatically packages a priority clinical digest for Houston's next ground pass. From symptom to complete care in six minutes."

---

### Slide 12: Interplanetary Networking — Operating in Deep Space Without Internet
#### Visual Blueprint
- **Network Topology Architecture Diagram:**
  - *Inside the Vehicle (Zero Internet):* High-Speed Habitat LAN (1 Gbps Ethernet / 802.11 Wi-Fi) connecting crew tablets, local edge server (`server.py`), and habitat displays. 100% on-premises.
  - *Interplanetary Chasm:* Speed-of-light latency (3–22 minutes one-way) + Comms Blackout Zones (Solar Conjunction, Lunar Far Side).
  - *Earth Ground Link:* Deep Space Network (DSN 34m/70m antennas) ➔ Houston Flight Medicine Portal.
- **Protocol Badges:** `CCSDS Standard Packets` · `DTN / Bundle Protocol (RFC 9171)` · `Zero-Cloud Dependency`

#### Slide Content
* **How Sentinel Functions Completely Offline:**
  - **Local Edge Server:** The entire Sentinel stack (FastAPI daemon, SQLite/JSON state store, Three.js 3D engine) runs directly on vehicle hardware (payload computer or crew tablet).
  - **Zero External Network Calls:** Real-time triage, 3D anatomical rendering, computer-vision rPPG, and biofeedback require **zero external internet connectivity**.
* **Interplanetary Communications Architecture:**
  - **Delay-Tolerant Networking (DTN):** Utilizes the Bundle Protocol (RFC 9171) and CCSDS File Delivery Protocol (CFDP) standards.
  - **Persistent Local Queue:** During communications blackouts (solar conjunction, planetary occultation), clinical digests queue locally with cryptographic integrity.
  - **Bandwidth-Optimized Packets:** Sentinel never streams gigabytes of heavy video or raw telemetry dumps across deep-space antennas. It compresses structured clinical digests into tiny, high-density packets (< 50 KB) that transmit rapidly over S-band or Ka-band radio links.

#### Speaker Script (45 seconds)
> "A frequent question from judges is: 'How does this actually work without the internet?'
>
> Inside the spacecraft, Sentinel runs over the habitat's local high-speed LAN—connecting crew iPads and laptops to an edge server hosted directly on the vehicle. All clinical decision logic, 3D graphics, and computer-vision algorithms run 100% locally on device. There are zero cloud dependencies.
>
> When communicating with Earth, Sentinel interfaces with deep-space communications architectures. We align with NASA's Delay-Tolerant Networking standards—using the Bundle Protocol and CCSDS packet formatting.
>
> During periods of communications blackout—such as when Mars passes behind the Sun—our store-and-forward queue securely buffers records locally. The moment antenna line-of-sight is restored with the Deep Space Network, Sentinel doesn't flood the antenna with video—it transmits compact, compressed clinical digests under 50 kilobytes. It is built specifically for deep space physics."

---

### Slide 13: NASA Systems Integration — Pluggable Add-on for EIMO & CHP-IDA
#### Visual Blueprint
- **Integration Ecosystem Diagram:**
  - `NASA EIMO Framework (Earth-Independent Medical Operations)`
    - *Existing NASA Base:* ECLSS (Life Support), CHeCS (ISS Crew Health Care System), ISS 1553 Telemetry Bus.
    - *NASA Next-Gen Projects:* CHP-IDA / CHP-IDSP (Crew Health and Performance Integrated Data Architecture), ExMC Decision Support.
    - *SENTINEL's Role:* The **Crew-Facing Edge Clinic & Decision Node** that feeds directly into CHP-IDA and flight medicine registries.
- **Standards Badge:** `NASA-STD-3001 Vol 1 & 2 Aligned` · `EIMO ConOps 2024` · `NTRS 20240001402`

#### Slide Content
* **Designed for NASA's Exact Exploration Roadmap:**
  - **EIMO ConOps (Earth-Independent Medical Operations):** Traced directly to NASA Exploration Medical Capability (ExMC) 2024 Concept of Operations, shifting medical autonomy from ground control to the onboard crew.
  - **CHP-IDA / CHP-IDSP Integration:** NASA is actively consolidating fragmented medical devices into the Crew Health and Performance Integrated Data Architecture. Sentinel serves as the lightweight, astronaut-facing edge application that unifies vitals, cognitive scores, and psychological state into one actionable record.
  - **ECLSS Life Support Telemetry:** Ingests cabin environmental data (Cabin $O_2$, $CO_2$, pressure, temperature) directly from vehicle environmental control buses (MIL-STD-1553, SpaceWire, Ethernet).
  - **NASA-STD-3001 Compliance:** Designed around NASA Spaceflight Human-System Standards for medical care, clinical records, and operational habitability.

#### Speaker Script (45 seconds)
> "Sentinel was not developed in an academic vacuum—it was designed specifically to plug into NASA's active medical modernization initiatives.
>
> NASA's Exploration Medical Capability element has defined the **Earth-Independent Medical Operations (EIMO)** concept of operations for missions to the Moon and Mars. Concurrently, NASA is building **CHP-IDA**—an integrated data architecture to replace the aging, fragmented medical hardware on the ISS.
>
> Sentinel fits squarely into this vision. We act as the astronaut-facing edge clinic and in-flight decision support platform. We ingest cabin telemetry from life-support buses, provide autonomous guidance when ground communication is blocked, and feed structured clinical records directly into NASA's medical repositories. We don't replace NASA's systems; we provide the autonomous software layer they currently lack."

---

### Slide 14: Phased Deployment Horizon — The 3-Phase Integration Roadmap
#### Visual Blueprint
- **3-Phase Evolution Roadmap Graphic:**
  - `Phase 1: Standalone Edge Add-On (Current Build)` ➔ `Phase 2: Subsystem & Vehicle Bus Integration` ➔ `Phase 3: Autonomous Sensor & Habitat Ecosystem`
- **Milestone Timeline:** `Hackathon MVP (Today)` ➔ `Analog Habitats (CHAPEA/HERA 2027)` ➔ `Lunar Gateway (2028)` ➔ `Mars Transit (2030s)`

#### Slide Content
* **Phase 1: Standalone Edge Add-On (Built Today — Near-Term Deployment)**
  - **Zero Flight Avionics Certification Risk:** Runs as an isolated application on standard crew laptops/tablets (Crew iPad, Microsoft Surface, or ThinkPad) over cabin Wi-Fi.
  - Contactless webcam rPPG pulse capture + manual clinical entry forms + 30-sec PVT cognitive reaction test.
  - Local SQLite/JSON persistence; manual or scheduled file export of Flight Surgeon digests during DSN ground passes.
* **Phase 2: Subsystem & Vehicle Bus Integration (Mid-Term Flight Integration)**
  - Automated ingestion of vehicle life support (ECLSS) via onboard Ethernet/SpaceWire (automated Cabin $O_2$, $CO_2$, pressure).
  - Direct connection to spacecraft avionics radiation monitors (active dosimeters, CPDS, TEPC, REM2).
  - Native integration with the spacecraft DTN (Delay-Tolerant Networking) router for automatic flight surgeon sync.
* **Phase 3: Ambient Sensor & Autonomous Closed-Loop Ecosystem (Long-Term Deep Space)**
  - Direct continuous telemetry from smart garments (CSA Bio-Monitor / Astroskin) and wireless bio-patches (continuous ECG, SpO2, core temperature).
  - Smart medical locker with automated RFID drug inventory and robotic dispensing.
  - Closed-loop habitat actuation (e.g., automatically adjusting habitat circadian lighting based on crew fatigue, or increasing airflow scrubbers upon localized CO2 spikes).

#### Speaker Script (50 seconds)
> "To deliver a realistic product to NASA, we developed a clear **Three-Phase Integration Strategy**:
>
> **Phase 1 is what we built today: a Standalone Edge Add-On.** It requires zero recertification of flight-critical vehicle avionics. It runs on existing crew iPads and laptops over cabin Wi-Fi, capturing contactless camera vitals, cognitive PVT tests, and manual logs. This can fly tomorrow on the ISS or in NASA's CHAPEA Mars analog habitat.
>
> **Phase 2 connects Sentinel to vehicle subsystems.** We plug into the spacecraft Ethernet and SpaceWire buses to automatically ingest life-support telemetry from ECLSS and radiation data from active dosimeters, while syncing directly with NASA's Delay-Tolerant Network router.
>
> **Phase 3 completes the deep-space vision:** continuous biometric telemetry from smart garments like the CSA Bio-Monitor, smart RFID medicine lockers, and closed-loop environmental actuation—automatically adapting habitat lighting to circadian fatigue. A clear, phased engineering path from hackathon prototype to interplanetary voyage."

---

### Slide 15: Grounded in Real NASA Evidence — 94 JSC 28913 MRID Documents
#### Visual Blueprint
- **Visual Graphic:** Catalog matrix showing the 94 NASA Medical Requirements Integration Documents (JSC 28913) grouped into 6 clinical domains.
- **Direct Citations Callout:**
  - `MR005L / MR093L:` Intravehicular Tissue Equivalent Proportional Counter (TEPC) radiation limits.
  - `MR010L:` Clinical Laboratory Testing for Long-Duration Spaceflight.
  - `MR021:` Environmental Air Quality and Closed-Environment Toxicology standards.
  - `MR030:` In-flight Neurological and Functional Performance Testing.

#### Slide Content
* **Evidence-Based Medical Architecture:**
  - Every reference range, threshold band, measurement instruction, and clinical rationale in Sentinel is directly anchored in NASA medical specifications.
  - Cataloged in `dataset/_catalog.json` with cryptographic SHA-256 validation.
* **NASA Human Research Program (HRP) Risk Mapping:**
| NASA HRP Risk | Hazard | Sentinel Module & Indicators | Sourced MRID Citation |
|---|---|---|---|
| **Behavioral Changes & Disorders** | Isolation & Confinement | Face blendshapes, mood taps, voice pitch | NASA Behavioral Health & MR030 |
| **Inadequate Sleep & Fatigue** | Isolation & Confinement | Sleep logs, 30s PVT reaction test | JSC 28913 Sleep Actigraphy |
| **Cardiovascular Adaptations** | Gravity Fields | rPPG pulse, typed BP, trend deviations | MR010L Clinical Lab & Cardiovascular |
| **Risk of Hypoxia** | Closed Environment | Cabin $O_2$, $CO_2$, respiratory rate | MR021 Shuttle/ISS Toxicology |
| **Radiation-Induced Cancers** | Space Radiation | NOAA proton flux feed, S-scale storm levels | MR004L, MR005L, MR092L, MR093L |
| **Spaceflight Neuro-ocular Syndrome (SANS)** | Gravity Fields | Interactive Eye Zone, vision change alerts | MR017 In-flight Ophthalmology |

#### Speaker Script (45 seconds)
> "Sentinel is not an imaginary sci-fi concept—it is anchored directly in authentic NASA aerospace medicine.
>
> Our team ingested and cataloged **94 NASA Medical Requirements Integration Documents (JSC 28913)** from the Johnson Space Center. These are the exact operational medical guidelines used on the Space Shuttle and International Space Station.
>
> When Sentinel checks blood pressure thresholds, cabin atmosphere parameters, or radiation storm levels, it doesn't use guesswork. It cites specific NASA standards: MR010L for clinical laboratory vitals, MR021 for closed-loop air toxicology, and MR093L for TEPC radiation monitoring.
>
> Every indicator in our system maps directly to one of the five hazards and official risks defined by NASA's Human Research Program. If an instruction appears on screen, it has an authentic scientific citation."

---

### Slide 16: Radical Honesty & Trust — LIVE, MANUAL, SIM & DESIGNED
#### Visual Blueprint
- **The Honesty System Key:** Four distinct, glowing visual badges utilized throughout the Sentinel interface:
  - `LIVE [Emerald Badge]` — Measured right now from onboard hardware (webcam rPPG pulse, PVT test, mic).
  - `MANUAL [Sky Blue Badge]` — Typed in by the astronaut from certified physical cuffs or meters.
  - `SIM [Amber Badge]` — Simulated or fed from telemetry feeds (NOAA GOES proton feed, cabin life support).
  - `DESIGNED [Purple Badge]` — Architectural blueprints and future roadmaps (wearable ECG, Mars base).
- **Core Principle Callout:** *"In mission-critical software, claiming simulated data is live is a safety failure."*

#### Slide Content
* **The 5 Immutable Rules of Sentinel Honesty:**
  1. **Strict Metadata Binding:** Every single indicator displayed in the UI carries its source label and a confidence value (0.0 to 1.0). The store rejects any reading that lacks them.
  2. **Confidence-Gated Triaging:** A noisy, low-confidence computer-vision reading can *never* raise a critical alert on its own.
  3. **No Phantom Diagnoses:** Sentinel reports *deviations from personal baseline* and offers procedural first steps; it never diagnoses clinical diseases.
  4. **The "Why This?" Audit Trace:** Every recommendation card contains an inspectable audit trace showing the exact rules, baseline values, and NASA citations that generated it.
  5. **Explicit Radiation Disclaimers:** Radiation data is clearly marked as simulated awareness, deferring dose measurements to mission dosimetry teams.

#### Speaker Script (40 seconds)
> "In aerospace software, trust is everything. If an assistant claims it is measuring something when it isn't, astronauts will disable it.
>
> That is why Sentinel enforces **Radical Honesty**. Every single number on screen carries an explicit tag: **LIVE** for data measured from live hardware right now; **MANUAL** for numbers typed in from cuffs; **SIM** for simulated or satellite-fed environments; and **DESIGNED** for future hardware blueprints.
>
> If webcam lighting is poor, our vision engine drops its confidence score to 0.4. Sentinel marks the pulse as an 'estimate' and prevents the anomaly engine from triggering a false alarm. And if an astronaut ever questions an alert, a single tap on 'Why This?' reveals the exact mathematical formula, historical baseline, and NASA source document behind the recommendation."

---

### Slide 17: Dual-Horizon Impact — From Mars Transit to Remote Earth Telemedicine
#### Visual Blueprint
- **Split Vision Graphic:**
  - *Left Horizon (Space Exploration):* Deep-space transit spacecraft, Lunar Gateway, and Mars Base Alpha.
  - *Right Horizon (Earth Spinoffs):* Antarctic Research Stations (McMurdo, Concordia), Submarines, Offshore Drilling Rigs, Rural Indigenous Clinics, Disaster Relief Tents.
- **Commercial SaaS Model Architecture:**
  - `Edge Crew App` (Built Hackathon MVP)
  - `Mission Config Studio` (Pre-flight threshold and kit builder)
  - `Clinically Reviewed Content Library` (Versioned protocols)
  - `Ground Control Portal` (Asynchronous flight surgeon triage)

#### Slide Content
* **Immediate Space Applications:**
  - **NASA Artemis & Gateway Missions:** Autonomous medical companion for lunar orbit where ground teams cannot intervene instantaneously.
  - **Mars Transit Habitat:** Essential autonomous healthcare layer for 3-year round-trip missions.
  - **Analog Habitats:** Ready for field validation in CHAPEA (Crew Health and Animal Performance Exploration Analog), HERA, and NEEMO.
* **Earth Spinoff Impact (The Civilian Dividend):**
  - **Extreme Remote Environments:** Antarctic scientific research bases, naval submarines, and commercial maritime vessels operating under complete radio silence.
  - **Rural & Underserved Global Health:** Developing regions and remote indigenous communities where broadband internet is absent and specialized physicians are hundreds of miles away.
  - **Disaster Response:** Offline field hospital triaging following hurricanes, earthquakes, or grid failures.

#### Speaker Script (45 seconds)
> "The technologies we develop for deep space have immediate, transformative applications right here on Earth.
>
> While Sentinel's primary mission is keeping astronauts alive on the voyage to Mars, its architecture solves the fundamental challenge of **extreme remote medicine**. Over one billion people on Earth live in regions without reliable broadband connectivity or immediate access to specialized healthcare.
>
> Sentinel's edge-native, zero-cloud architecture can be deployed tomorrow in Antarctic research stations like Concordia, inside naval submarines, on offshore energy platforms, or in mobile humanitarian clinics following natural disasters.
>
> Looking ahead, we have architected Sentinel to grow from this hackathon MVP into an enterprise SaaS platform—featuring a Mission Config Studio for planners and a Clinically Reviewed Protocol Library for medical directors. Technology built for Mars can heal the Earth."

---

### Slide 18: Live Demonstration & Mission Summary
#### Visual Blueprint
- **Live Demo Flow Map:**
  1. *Daily Check-in:* Camera rPPG heart rate capture + 30s PVT cognitive reaction test.
  2. *Anomaly Detection:* Synthetic injection of sleep disruption + cardiac drift triggering Level 2 Alert.
  3. *Actionable Care:* Inspecting the 3D anatomical body, reviewing protocol steps, verifying kit location.
  4. *Biofeedback in Action:* Live WebGL Orb Calm pulse synchronization.
  5. *Ground Handoff:* Simulating 12.7-minute Mars comms delay and generating the Flight Surgeon digest.
- **Closing Headline:**
  **SENTINEL: The Autonomous Clinic for Humanity's Greatest Journey.**

#### Slide Content: Key Takeaways
- ✅ **Fully Functional & Edge-Native:** Runs locally in the browser with zero cloud dependencies.
- ✅ **Deterministic Clinical Safety:** Pure mathematical anomaly detection with zero LLM hallucinations.
- ✅ **Scientifically Anchored:** 94 NASA JSC 28913 MRID documents backing all clinical ranges.
- ✅ **Comprehensive Care:** Integrates physical vitals, space radiation, and mental wellbeing into one unified loop.
- ✅ **Open Source & Extensible:** Built with vanilla web standards and modular Python architecture.

#### Speaker Script (Closing - 30 seconds)
> "To conclude: Sentinel is not a mockup or a slide deck concept—it is a living, working software application running on our local machine right now.
>
> In our live demo, we will show you the entire clinical loop: taking a live camera pulse, executing a cognitive fatigue test, watching our deterministic engine detect a multi-system drift, inspecting the 3D anatomical body, calming the live WebGL orb, and transmitting an asynchronous digest across our deep-space comms simulator.
>
> As humanity prepares to venture farther from Earth than ever before, our astronauts deserve a medical companion that is autonomous, honest, and scientifically grounded.
>
> We are Team Sentinel. Thank you, and we look forward to your questions!"

---

## Appendix: Presenter Q&A Cheat-Sheet (Defending the Pitch)

### Q1: "Why not just use ChatGPT or Claude for medical triage?"
- **Answer:** *"LLMs are probabilistic and stochastic. In clinical medicine, a model must never 'guess' a dose or hallucinate a nonexistent countermeasure. Furthermore, cloud APIs cannot be reached across interplanetary radio delays. Sentinel uses deterministic mathematical rules for 100% of its medical decisions, using a local LLM strictly as a voice rephraser with rigid numeric guardrails."*

### Q2: "How accurate is camera rPPG compared to medical-grade ECG?"
- **Answer:** *"Webcam rPPG is an optical estimate subject to lighting and motion noise. That is why Sentinel enforces our Radical Honesty rules: rPPG is strictly tagged as `LIVE estimate` with an active confidence score (0.0–1.0). If confidence drops below 0.6, Sentinel displays the reading with a warning badge and mathematically blocks it from triggering an alert alone without manual or multi-signal corroboration."*

### Q3: "Does Sentinel replace the NASA Flight Surgeon?"
- **Answer:** *"Never. Sentinel explicitly operates as an onboard clinical assistant, not a doctor. It provides immediate first-responder guidance during the communications vacuum, helps astronauts manage routine minor health and wellbeing, and prepares structured, bandwidth-efficient clinical digests so the Flight Surgeon has complete context the moment communications are established."*

### Q4: "How does the personal baseline handle adaptation to microgravity?"
- **Answer:** *"When an astronaut enters a new environment (e.g., transitioning from Earth to Transit, or Transit to Lunar Base), Sentinel enters a configurable 'Settling-In' calibration period (typically 3–7 days). During settling-in, statistical baseline drift alerts are softened into gentle adjustment notes, while absolute life-support limits and red-flag symptom checks remain at 100% full strength."*

### Q5: "How does Sentinel plug into NASA's existing ISS or Artemis architecture?"
- **Answer:** *"In Phase 1, it deploys as an isolated edge app on crew iPads or ThinkPads over cabin Wi-Fi with zero avionics risk. In Phase 2, it connects to vehicle buses for ECLSS cabin atmosphere data and interfaces with Delay-Tolerant Networking (DTN) routers, directly aligning with NASA's EIMO (Earth-Independent Medical Operations) framework and the CHP-IDA integrated data architecture."*
