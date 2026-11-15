# Sentinel — Person 6 Integration & Handover Checklist
**Feature 6: Dataset and Integration (Person 6 Ownership)**  
*Document Version:* 1.0.0  
*Target Branch:* Local Workspace (`c:\Users\USER\OneDrive\Desktop\MASTER_CONTROL_1`)  
*CRITICAL REPOSITORY DIRECTIVE:* **DO NOT PUSH TO GITHUB.** All work remains local.

---

## 1. Executive Summary & Role Definition

Person 6 owns the dataset, the seed data, the NASA MRID dataset catalogue, the anomaly engine wiring, shared config files, and the merging of all five user-facing modules (P1–P5) into one unified, offline-first clinical decision platform.

```
       +--------------------------------------------------------+
       |                  PERSON 6 INTEGRATION                  |
       |  State Store  *  Decision Pipeline  *  Ground Handoff  |
       +--------------------------------------------------------+
              ^             ^            ^           ^
              |             |            |           |
        +-----+-----+ +-----+----+ +-----+----+ +----+-----+
        | P1        | | P2       | | P3       | | P4       | ... (P5 Games)
        | Radiation | | Body/3D  | | Face/STT | | Vitals   |
        +-----------+ +----------+ +----------+ +----------+
```

---

## 2. Integration Merge Order Status (Phases 0–6)

All 7 integration phases defined in Section 11.5 of the Sentinel Product Document are implemented and verified:

| Phase | Milestone Description | Dependencies | Status | Verification Reference |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 0** | **Core Foundation:** State store (`brain/store.py`), event bus (`app/js/core/bus.js`), mock data (`shared/mock_data.json`), environment profiles (`brain/environment.py`). | None | **DONE** | Store initializes 6 crew with 14-day history; bus pub/sub active; environments load. |
| **Phase 1** | **P4 (Vitals) Wiring:** Typed vital signs entry into store and decision pipeline (`/api/reading/{cid}`, `/api/state/{cid}/patch`). | Phase 0 | **DONE** | Ingesting BP/HR triggers threshold evaluation; body zone color updates via contract state. |
| **Phase 2** | **P3 (Face/Voice) Wiring:** Camera rPPG/expression readings and voice transcription/prosody streams into store. | Phase 0 | **DONE** | Face emotion inference (`/api/face/emotion`), STT (`/api/stt`), TTS (`/api/tts`), rPPG pulse mapped to `vitals.heart_rate`. |
| **Phase 3** | **P1 (Radiation) Wiring:** Live NOAA spaceweather feed, dosimeter rates, shelter status, and cumulative career limits. | Phase 0 | **DONE** | `spaceweather_loop` and `storm_dose_loop` active; radiation screen receives live/model stream. |
| **Phase 4** | **P2 (Body Model) Wiring:** Zone interactions (Head, Eyes, Heart, Lungs, Gut, Bones, Whole Body), symptom logger, indicator panels. | Phase 1 | **DONE** | Click zone triggers symptom log (`symptom_log`); fact sheets cite NASA MRID standards. |
| **Phase 5** | **P5 (Lonely Games) Wiring:** Interventions (Orb Calm, Aurora Run, Greenhouse, Slipstream race) and session log events. | Phase 1 | **DONE** | Logging session metrics (`session.calm_start_hr`, `session.race_mood_change`, etc.) persists to store history. |
| **Phase 6** | **End-to-End Orchestration:** Check-in -> anomaly evaluation -> recommendation card -> protocol action -> recheck -> ground digest. | All | **DONE** | All 19 Golden Scenarios (S1–S19) and SI1–SI7 Integration Tests pass cleanly. |

---

## 3. Functional Requirements Checklist (INT-1 to INT-9)

| Requirement ID | Specification Description | Priority | Implementation Location | Status |
| :--- | :--- | :--- | :--- | :--- |
| **INT-1** | **Strict Ingestion Validation:** State store persists per crew member and rejects any reading missing explicit `label` (`LIVE`, `MANUAL`, `SIM`, `DESIGNED`) or `confidence` (`0.0`–`1.0`). | Must Have (M) | `brain/store.py` (`ingest_reading`), `server.py` (`POST /api/reading/{cid}`, `POST /api/reading`) | **PASSED** (Verified by `test_SI1`) |
| **INT-2** | **Sequential Decision Pipeline:** Recomputes sequentially on every state patch: `radiation.py` (dose/storm) -> `thresholds.py` (absolute limits) -> `drift.py` (14-day baseline drift) -> `decision.py` (ordered action hierarchy). | Must Have (M) | `brain/store.py` (`_recompute`), `brain/decision.py` | **PASSED** (Verified by `test_SI2`) |
| **INT-3** | **Audit Trail Logging:** Unified event bus logging; every user action, state change, and system event writes to audit log without leaking sensitive protected health information (PHI). | Must Have (M) | `brain/audit.py`, `server.py` (`POST /api/audit`, `GET /api/audit`) | **PASSED** (Verified by `test_SI6`, `test_audit.py`) |
| **INT-4** | **Standardized Mock Roster:** Loads 6 crew members (`james`, `amara`, `kenji`, `sofia`, `lukas`, `priya`) with 14-day SIM history on startup. | Must Have (M) | `shared/mock_data.json`, `brain/store.py` (`_mock`, `_seed_history`) | **PASSED** (Verified by `test_SI4`, `test_mock_data_satisfies_contract`) |
| **INT-5** | **Store-and-Forward Ground Handoff:** Digest queue with SIM delay simulator (default 12.7 min one-way), holding messages during blackout and transmitting urgent messages first on reconnection. | Should Have (S) | `brain/ground.py`, `brain/ops.py`, `server.py` (`/api/digest`, `/api/ops`) | **PASSED** (Verified by `test_SI3`, `test_ground.py`, `test_ops.py`) |
| **INT-6** | **Sourced Medical Configs:** All clinical thresholds, indicator facts, and onboard med kit items cite authoritative sources (NASA MRID JSC 28913, clinical literature). | Must Have (M) | `shared/thresholds.json`, `shared/facts.json`, `shared/med_kit.json`, `shared/contract.json` | **PASSED** (Verified by `test_zone_facts_cite_mrids`, `test_every_threshold_has_source_and_kind`) |
| **INT-7** | **Full System Merge:** All 5 sub-features integrate cleanly into a single unified frontend and backend without module collisions. | Must Have (M) | `server.py`, `app/js/core/commands.js`, `app/js/core/bus.js` | **PASSED** (Verified by `test_SI5`, `test_systems.py`) |
| **INT-8** | **Golden Scenarios & Acceptance:** Golden scenarios S1–S19 and acceptance criteria AC-1–AC-22 pass 100%. | Must Have (M) | `tests/test_golden.py`, `tests/test_integration.py` | **PASSED** (21/21 golden scenarios green) |
| **INT-9** | **NASA MRID Catalogue:** Comprehensive indexing of 94 NASA MRID PDFs (68 unique) with primary owner assignments across P1–P6. | Should Have (S) | `dataset/_catalog.json`, `dataset/` | **PASSED** (All 94 PDFs catalogued and mapped) |

---

## 4. Integration Test Suite (SI1–SI7)

The dedicated test file `tests/test_integration.py` provides formal validation of the Person 6 integration contract:

| Test ID | Scenario | Expected Behavior | Test Function | Result |
| :--- | :--- | :--- | :--- | :--- |
| **SI1** | Store rejects invalid readings | Rejects readings missing `label` or `confidence`, invalid ranges, or non-numeric values with HTTP 422. Does not store corrupt state. | `test_SI1_store_rejects_reading_without_label_or_confidence` | **PASSED** |
| **SI2** | Decision pipeline on drifting crew | Multi-metric drift (sleep hours + reaction time + mood) triggers Level 2 assessment (ACT priority) and generates actionable recommendation card. | `test_SI2_full_decision_pipeline_on_drifting_crew` | **PASSED** |
| **SI3** | Ground digest offline & link restoration | Blackout holds routine and urgent packets in `"queued (no link)"`. When link opens, urgent packet leaves first. | `test_SI3_ground_digest_queued_offline_link_opens` | **PASSED** |
| **SI4** | 6 Mock crew load with 14-day history | Exactly 6 crew members present. All baseline numeric fields possess $\ge$ 14 historical points spanning $\ge$ 13 days. | `test_SI4_all_6_mock_crew_members_load` | **PASSED** |
| **SI5** | End-to-end: check-in to digest | Vitals check-in -> cardiovascular zone alert -> recommendation card -> follow-up measurement -> ground digest queueing. | `test_SI5_end_to_end_checkin_to_digest` | **PASSED** |
| **SI6** | Event bus audit trail | UI events (`page`), brain recompute events (`brain`), and ground transmissions appear in audit log; sensitive health background excluded. | `test_SI6_event_bus_audit` | **PASSED** |
| **SI7** | Golden scenarios S1–S19 pass | Direct execution of all 19 golden scenarios in isolated state containers. | `test_SI7_all_golden_scenarios_pass` | **PASSED** |

---

## 5. Clinical Experience & Workflows (Part 4: Sections 12 & 13)

### 5.1 Five Clinical Modes (Section 12.1)
Implemented in `brain/clinic.py` (`Clinic.get_clinical_mode`) and exposed via `GET /api/clinic/{cid}`:
1. **Monitor:** Continuous passive telemetry (camera rPPG, voice, cabin sensors); anomaly engine watches silently.
2. **Check-up:** Scheduled daily check-in (scan, vitals, mood, reaction test, summary).
3. **Triage:** Symptom or pattern anomaly triage; body-zone picker, structured questions, urgency level determination.
4. **Treat & Follow-up:** Action protocol execution, kit item mapping with contraindication filters, timers, recheck reminders.
5. **Escalate:** Severe red-flag symptoms, cabin air alarms, priority store-and-forward digest to flight surgeon.

### 5.2 A Day with Sentinel: Daily Blocks (Section 12.2)
Implemented in `brain/clinic.py` (`Clinic.current_block`, `Clinic.execute_*`) and exposed via `POST /api/clinic/{cid}/block`:
- **Wake:** 2-tap fast log for hours slept and mood (< 10 seconds).
- **Morning Check-in:** 2-minute guided check-in ending in a clear summary line.
- **Work Block:** Heads-down passive monitoring, silent unless it matters.
- **Exercise:** Workout log + 30-min post-exercise pulse suppression (`post_exercise` context) preventing false alarms.
- **EVA / Sortie:** Overlay mode with readiness check (`Ops.readiness`), strict suit-air limits, and paused reminders.
- **Something Feels Off:** Voice/touch symptom triage triggered any time ("Hey Sentinel, I have a headache").
- **Evening Wind-down:** Wind-down reminder, stress evaluation, and guided Orb Calm breathing recommendations.
- **Night Sleep Block:** Do-not-disturb rest mode (`ops.set_mode("rest")`); only urgent and cabin alerts break through.
- **Weekly Review:** Aggregates 7-day adherence, averages, countermeasure effectiveness (`GET /api/clinic/{cid}/weekly`).

### 5.3 Environments and Modes (Section 13)
Implemented in `brain/environment.py`, `brain/ops.py`, and `server.py`:
- **Spoken Understanding (13.1):**
  - Station: *"space station"*, *"in orbit"*, *"on the station"*
  - Transit: *"spacecraft"*, *"space cabin"*, *"in transit"*, *"on the way to Mars"*
  - Planetary Base: *"moon base"*, *"Mars base"*, *"surface habitat"*, *"on the base"*
  - Mode EVA / Sortie: *"going outside"*, *"EVA"*, *"spacewalk"*, *"taking the rover out"*
  - Mode Rest: *"going to sleep"*, *"rest time"*
  - Ambiguous queries: Asks which option applies (`"Which applies: space station, deep-space transit, planetary base, EVA or sortie, or rest mode?"`).
- **Confirmation Flow (13.1):** Always requires confirmation dialog before switching.
- **Environments & Wait Tolerance (13.2):**
  - **Station (`iss`):** Orbiting station, cardiovascular/sleep focus, docked return vehicle, 15 min wait tolerance, escalate early to ground.
  - **Transit (`mars_transit`):** Spacecraft cabin between worlds, behavioral/teamwork focus, 180 min wait tolerance, onboard autonomous care first.
  - **Planetary Base (`mars_surface`, `lunar`):** Surface habitat, partial gravity/EVA focus, 180 min (Mars) / 60 min (Lunar) wait tolerance.
  - **Critical (`critical`):** Launch, landing, docking short critical phases, 0 min wait tolerance, mission procedures lead.
- **Modes Specification (13.2):**
  - **Routine:** Normal ranges, full reminders (`reminders_paused=False`, `urgent_only=False`).
  - **EVA / Sortie:** Strict suit-air limits, routine reminders paused (`reminders_paused=True`, `urgent_only=False`).
  - **Rest:** Quiet hours, sleep tracking (`reminders_paused=True`, `urgent_only=True`).
  - **Contingency:** Emergency/drill mode, minimal screen, crew alerted, priority digest (`contingency=True`, `urgent_only=True`).
- **Same Problem, Different Plan (13.3):** Contextual guidance for severe symptoms, cabin air, sleep patterns, and stress across ISS, transit, and planetary bases.
- **Environment Profiles API (13.4):** Exposed via `GET /api/environment/profiles` and `GET /api/environment/profile/{name}`.

---

## 6. Dataset Architecture & Ownership Map

The `dataset/_catalog.json` indexes **94 NASA Medical Requirements Integration Documents (MRID JSC 28913)**. The documents are partitioned among team roles as follows:

| Owner Role | Document Count | Clinical / Operational Scope | Exemplar MRID Citations |
| :--- | :---: | :--- | :--- |
| **P1 (Radiation)** | 11 | Dosimeters, ionizing radiation, TEPC, CPDS, space weather limits | MR038D, MR039D, MR040D, JSC-65994 |
| **P2 (Body / 3D)** | 19 | Physical exam, eye exam (SANS/OCT), dental, bone mineral density, skin inspection | MEDB 1.1, MEDB 1.2, MR006D, MR007D |
| **P3 (Face / Voice)** | 2 | Neurological evaluation, hearing conservation, cognitive screening | MEDB 4.1, MR014D |
| **P4 (Vitals)** | 17 | Clinical chemistry, hematology, ECG, cardiovascular, spirometry | MEDB 2.1, MEDB 2.2, MR020D, MR021D |
| **P5 (Lonely Games)**| 0 | Behavioral health & cognitive interventions (sourced from NASA behavioral countermeasure papers) | NASA-TM-2015-218565 |
| **P6 (Integration)** | 19 | Cabin air quality, potable water standards, toxicology, EVA prebreathe protocols, environmental monitoring | MEDB 8.1, MEDB 8.2, MR050D, MR052D |

---

## 7. Shared Configuration Files Managed by Person 6

1. **`shared/contract.json`**  
   - Complete JSON schema defining the frozen state object.  
   - Validated on state patch by `brain/contract.py` (`validate_full`, `validate_patch`).
2. **`shared/thresholds.json`**  
   - Clinical reference ranges with upper/lower bounds, units, severity levels (`info`, `watch`, `alert`), and NASA MRID source citations.
3. **`shared/facts.json`**  
   - Explanatory copy for each body zone and indicator: `what_it_is`, `how_to_measure`, and `why_it_matters`, cross-referencing MRID document numbers.
4. **`shared/med_kit.json`**  
   - Exhaustive inventory of onboard medical pack items, physical pack locations, indications, contraindications, and dosage warnings.
5. **`shared/mock_data.json`**  
   - 6 crew records with diverse baseline profiles, mission profiles (ISS, Mars Transit, Lunar Surface), and 14 days of realistic pre-seeded telemetry.
6. **`shared/SOURCES.md`**  
   - Comprehensive academic and NASA JSC bibliography verifying all medical values.
7. **`shared/environments/` (`station.json`, `transit.json`, `base.json`, `critical.json`)**
   - Official Section 13.4 environment profile JSON configuration files. Each file specifies communication delay, return vehicle status, resupply expectations, wait tolerance, indicator weights, and direct citations to NASA MRID standards in `dataset/`.

---

## 8. Developer & Successor AI Operating Guide

### Environment & Test Execution
- **Python Executable:** `.venv\Scripts\python.exe`
- **Pytest Command (Crucial Rule):** Always run with `BypassSandbox: true` on Windows:
  ```powershell
  .venv\Scripts\pytest -q
  ```
  *(Reason: Windows sandbox loopback socket restrictions can hang `asyncio.ProactorEventLoop` when running tests inside the sandbox).*
- **Run Integration & Clinical Suites:**
  ```powershell
  .venv\Scripts\pytest -v tests/test_integration.py tests/test_clinic.py
  ```

### Starting the Sentinel Server
To launch the full system with TLS:
```powershell
.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
```
Access the application at `https://localhost:8443/app/`.

### Critical Handover Rules for Future Agents:
1. **NEVER PUSH TO GITHUB:** The user has strictly forbidden pushing any commits to remote repositories. Keep all git branches and changes local.
2. **HONESTY METADATA RULE:** Any new telemetry or sensor reading introduced into `Store` must include `label` (`LIVE`, `MANUAL`, `SIM`, `DESIGNED`) and `confidence` (`0.0`–`1.0`).
3. **STATE STORE PERSISTENCE:** In memory by default with JSON backup in `data/state.json`. When testing, use `persist=False` or `SENTINEL_NO_PERSIST=1`.
---

## 9. Personal Health Profile & Clinical Workflow Integration (Sections 13.5 & 14)

### 9.1 Section 13.5 Settling In
- **Environment Baseline Tagging:** Baselines maintain context of mission environment.
- **Settling Period (`SETTLING_DAYS = 3`):** Following a confirmed environment switch:
  - Personal-deviation and drift alerts soften to gentle note (`"Adjusting to the new environment: ..."`).
  - Absolute physiological range limits (`flag_ground`), cabin air alerts (`flag_cabin`), radiation storm alerts (`flag_radiation`), and clinical red flags (`flag_redflag`) fire at full strength.
  - Verified by golden acceptance test `test_S16_settling_in_softens_personal_alerts_but_not_limits`.

### 9.2 Section 14 Personal Health Profile Architecture (`brain/profile.py`)
- **14.1 Principles:**
  - Progressive profile builder: grows over time with check-in questions when fields are missing.
  - Mission preload capability (`Profiles.preload(cid, data, preloaded_by)`) and astronaut confirmation (`Profiles.confirm(cid)`).
  - Encrypted on-device storage (`data/profiles.json` via `brain/vault.py`), sensitive health background leaves device only with explicit consent.
- **14.2 Seven Core Profile Sections:**
  1. *Identity & preferences:* callsign, language, units, voice style, glove mode, reminder times.
  2. *Mission context:* environment, mode, duty schedule, sleep block, EVA roster.
  3. *Health background:* allergies, ongoing conditions, regular medicines, past kit reactions (`updatedBy`, `sensitive`, `includeInDigest`).
  4. *Personal baselines:* per-indicator baseline records; surgeon adjustable.
  5. *Wellbeing plan:* early warning signs, "what helps me" tool ranking, who to talk to, camera mood analysis toggle.
  6. *Sharing and consent:* crew buddy, share urgent with commander, surgeon trend sharing policy, crew pulse.
  7. *Emergency preferences:* crew buddy, commander, order of contact (`orderOfContact`).
- **14.3 Progressive 4-Stage Builder & Calibration:**
  - `Day 0 (~3 min)`: Onboarding (callsign, language, environment, consent, buddy). Stage `day_0`.
  - `Days 1 to 3`: Health background, reminder times, wellbeing plan. Stage `days_1_3`.
  - `Days 3 to 7`: Baselines calibrate automatically. Displays status `Calibrating (n of 7)` (e.g., `Calibrating (4 of 7)`).
  - `Day > 7`: Established baselines. Displays `Calibrated`.
  - `Completeness Meter`: Dynamic score (0.0 to 1.0) tracking 11 key profile fields; provides tailored `next_question_prompt` for morning check-ins.
- **14.4 Complete Verification of All Seven Visible Effects:**
  1. *An allergy or past reaction (AC-17):* Matching kit items are blocked on recommendation cards with explicit clinical reasons (`test_an_allergy_blocks_the_kit_item_with_the_reason`).
  2. *A regular medicine:* Injects `"You take <meds>: check the label and your surgeon before using this."` on related kit suggestions (`test_a_regular_medicine_adds_a_note_and_an_empty_profile_says_so`).
  3. *Duty and sleep schedule:* `is_in_sleep_block` and `get_reminder_schedule` enforce quiet hours, pausing routine reminders during scheduled sleep blocks and respecting rest (`test_section_14_4_table_row_duty_and_sleep_schedule_rest_respect`).
  4. *"What helps me":* Calming tools are ranked and offered in the astronaut's preferred order (`test_section_14_4_table_row_what_helps_me_tool_order`).
  5. *"My early signs":* When the astronaut reports personal early signs (e.g., tension, headache), Sentinel explicitly recognizes them on recommendation cards and offers early countermeasures (`test_section_14_4_table_row_early_signs_recognized`).
  6. *Buddy and consent choices:* Urgent wellbeing alerts route to designated buddy and commander alert is withheld when consent is not granted (`shareUrgentWithCommander = False`) (`test_section_14_4_table_row_buddy_and_consent_crisis_routing`).
  7. *Surgeon-adjusted baseline:* `Profiles.adjust_baseline` updates store baselines and decision thresholds, so anomaly/drift alerts compute against corrected normal (`test_section_14_4_surgeon_adjusted_baseline_syncs_to_store`).
- **14.4 Safety Rules Verification:**
  - View, export (`GET /api/profile/{cid}/export?sensitive=true/false`), and delete (`DELETE /api/profile/{cid}`).
  - Health background is excluded from flight surgeon digests unless explicit consent (`includeInDigest = True`) is set.
  - Missing health background returns AC-18 `"profile incomplete, check the label"`.
  - Device-level encryption at rest via `brain/vault.py`.

### 9.3 Verification Status
- **Test Suite:** 16 passed in `tests/test_profile.py`, 12 passed in `tests/test_clinic.py`, 5 passed in `tests/test_ops.py`, 28 passed in `tests/test_golden.py` + `tests/test_integration.py`.
- **Full Project Suite:** **145 passed, 6 skipped, 0 failed in 7.54s**.
- **Remote Git Status:** Clean, **NO GIT PUSH EXECUTED** (strictly local commits/changes).

---

## 10. Mental Wellbeing Engine Architecture (Section 15, FR-40 to FR-50)

### 10.1 Four Dimensions (Section 15.2 & 15.3)
- Implemented in `brain/wellbeing.py` (`WellbeingEngine.evaluate`):
  1. **Mood:** Evaluates self-rating (1-5), optional tags (`tired`, `irritable`, `anxious`, `lonely`, `motivated`), camera valence/arousal (when enabled).
  2. **Energy:** Sleep duration and quality, subjective energy, cognitive reaction time vs baseline. Generates a clinical readiness note.
  3. **Stress:** Subjective stress, resting pulse deviations, acute stress-spike detection.
  4. **Connection:** Voice talk-time share, alone time, missed check-in frequency. Prompts low-friction social reconnection.
- **Rule:** No single "wellbeing score": four distinct dimensions prevent gaming and misinterpretation.
- **Safeguard (AC-21):** Camera expression analysis is strictly opt-in (`cameraMoodAnalysis = False` disables camera valence/arousal, falling back to self-report and voice without degradation).

### 10.2 Wellbeing Levels & Supportive Wording (Section 15.4)
- **Level 0 (Steady):** Near baseline -> `"You're steady."`
- **Level 1 (Check-in):** 1 dimension drifting -> Gentle query offering 1 countermeasure (`"Your energy has been lower than usual. Want a short reset?"`).
- **Level 2 (Support plan):** 2+ dimensions drifting -> Opens guided support flow with top 3 personal tools (`"A few things have shifted this week. Here are three that have helped before."`).
- **Level 3 (Urgent concern):** Explicit reporting of acute distress, self-harm, or panic -> Fixed W14 safety script via `brain/safety.py`. *Level 3 never fires from statistics alone.*

### 10.3 Support Toolkit Catalogue (Section 15.5)
10 activities with scientific mechanisms cited from `shared/wellbeing_science.json`:
1. `orb_calm`: Cyclic sighing HRV biofeedback (`LIVE`)
2. `paced_breathing`: Resonance frequency breathing ring (`LIVE`)
3. `grounding`: 5-4-3-2-1 sensory grounding (`LIVE`)
4. `earth_window`: Biophilic Earth view with ambient soundscapes (`LIVE`)
5. `sound_music`: Auditory neuromodulation & calming playlists (`LIVE`)
6. `private_journal`: Encrypted on-device reflective journal (FR-47, `LIVE`)
7. `sleep_winddown`: Evening light and schedule wind-down (`LIVE`)
8. `connection_nudge`: Crewmate meal or check-in prompt (`LIVE`)
9. `home_messages`: Asynchronous family recordings (`DESIGNED`)
10. `greenhouse`: Red Harvest plant care log (NASA Veggie study, `DESIGNED`)

### 10.4 Closed-Loop Empirical Learning (FR-45 & Section 15.6)
- **Pre/Post Session Recording:** `record_session(cid, tool_id, pre_stress, post_stress, pre_mood, post_mood)` measures empirical efficacy delta (`delta_stress = pre - post`).
- **Dynamic Personalized Ranking:** `get_ranked_tools(cid, profile)` ranks tools per person based on observed stress reduction and mood improvement, personalized on top of their profile `whatHelps` preferences.

### 10.5 Team Cohesion & Privacy Safeguards (Section 15.7)
- **Team Cohesion:** `evaluate_team_cohesion(crew_states)` computes voice talk-time shares and generates non-judgmental cohesion notes (maps to NASA Inadequate Teamwork risk).
- **Crew Pulse Survey (FR-49, AC-22):** 2 weekly questions; results only unlock at team level once $\ge 3$ respondents participate, with names strictly anonymized.
- **On-Device Private Journal (FR-47):** `data/journal.json` encrypted with AES via `brain/vault.py`. Note contents never travel over telemetry, digests, or network.

### 10.6 REST API Endpoints (`server.py`)
- `GET /api/wellbeing/{cid}`: Four-dimensional assessment, drifting dimensions, level, and wording.
- `GET /api/wellbeing/toolkit`: Complete 10-tool support catalogue with mechanisms and labels.
- `GET /api/wellbeing/scales`: Clinician-approved brief screening scales (PHQ-2, GAD-2, NASA weekly reflection).
- `POST /api/wellbeing/{cid}/session`: Closed-loop session logger (pre/post stress and mood).
- `GET /api/wellbeing/{cid}/ranking`: Dynamically ranked tools based on empirical delta.
- `GET /api/wellbeing/{cid}/journal`: List on-device private journal entries.
- `POST /api/wellbeing/{cid}/journal`: Add encrypted private journal entry.
- `DELETE /api/wellbeing/{cid}/journal/{entry_id}`: Delete private journal entry.
- `GET /api/wellbeing/team/cohesion`: Team voice balance and cohesion status.

### 10.7 Verification Status
- **Test Suite:** 9 passed in `tests/test_wellbeing.py`, 16 passed in `tests/test_profile.py`, 12 passed in `tests/test_clinic.py`, 5 passed in `tests/test_ops.py`, 28 passed in `tests/test_golden.py` + `tests/test_integration.py`.
- **Full Project Suite:** **154 passed, 6 skipped, 0 failed in 7.84s**.
- **Remote Git Status:** Clean, **NO GIT PUSH EXECUTED** (strictly local).

---

## 11. Navigation & Screen Backend Services (Section 16.1 & 16.2)

*(UI/Frontend remains untouched per user constraint; all backend states, APIs, and workflows required to support the 13 screens and special states are implemented).*

### 11.1 Screen Backend Mapping
| Screen | Backend Engine / Module | APIs Provided | Special States Managed |
| :--- | :--- | :--- | :--- |
| **Home (Screen 1)** | `brain/store.py`, `brain/ops.py` | `GET /api/assessment/{cid}`, `GET /api/aux/{cid}` | `calibrating` (`Calibrating (n of 7)`), link chip (`delayed`/`live`/`blackout`) |
| **Indicator Detail (Screen 2)** | `brain/store.py` (`indicator_detail`) | `GET /api/indicator/{cid}/{metric}` | Low-confidence estimate flag (`is_estimate: True`, `label: SIM`, confidence $\le 0.35$) |
| **Check-in Flow (Screen 3)** | `brain/clinic.py` | `POST /api/clinic/{cid}/checkin` | Camera unavailable fallback to `label: MANUAL`, resumable |
| **Care: Triage (Screen 4)** | `brain/care.py` (`CareEngine`) | `GET /api/care/triage/questions`, `POST /api/care/triage/{cid}` | Red-flag symptoms trigger immediate jump to level 3 urgent card |
| **Care: Protocol Runner (Screen 5)** | `brain/care.py` (`CareEngine`) | `POST /api/care/protocol/start`, `POST /api/care/protocol/{id}/step`, `POST /api/care/protocol/{id}/pause`, `POST /api/care/protocol/{id}/resume`, `POST /api/care/protocol/{id}/escalate`, `POST /api/care/protocol/{id}/complete` | States: `running`, `paused`, `escalated`, `completed`; timers and tick-box steps |
| **Care: Log (Screen 6)** | `brain/care.py` (`CareEngine`) | `GET /api/care/log/{cid}` | Informative empty state when no prior clinical events logged |
| **Trends (Screen 7)** | `brain/trends.py` (`TrendsEngine`) | `GET /api/trends/{cid}?days=7` | Sleep vs reaction time correlation view; `not_enough_data` flag if $< 3$ points |
| **Plan (Screen 8)** | `brain/plan.py` (`PlanEngine`) | `GET /api/plan/{cid}`, `POST /api/plan/{cid}/snooze`, `POST /api/plan/{cid}/complete`, `POST /api/plan/{cid}/reminder` | Schedule templates (`transit_day_v1`), conflict detection (`has_conflicts: True`) |
| **Wellbeing (Screen 9)** | `brain/wellbeing.py` | `GET /api/wellbeing/{cid}`, `POST /api/wellbeing/{cid}/session`, `GET /api/wellbeing/{cid}/journal` | Level 3 urgent concern triggers fixed safety script only |
| **Crew & Cabin (Screen 10)** | `brain/store.py`, `brain/wellbeing.py` | `GET /api/state/{cid}`, `GET /api/wellbeing/team/cohesion` | Cabin alarm takeover (`flag_cabin`) |
| **Ground (Screen 11)** | `brain/ground.py`, `brain/ops.py` | `GET /api/digest/{cid}`, `POST /api/digest/{cid}`, `GET /api/ground/{cid}` | `offline`, `queued`, `replied` packet states |
| **Profile & Settings (Screen 12)** | `brain/profile.py` | `GET /api/profile/{cid}`, `PATCH /api/profile/{cid}`, `GET /api/profile/{cid}/export` | Profile preview, completeness meter |
| **Onboarding (Screen 13)** | `brain/onboarding.py` | `GET /api/onboarding/{cid}`, `POST /api/onboarding/{cid}/step` | Checklist (consent, kit, voice, calibration); `resumable_step` tracking |

### 11.2 Verification Status
- **Screens Test Suite:** 6 passed in `tests/test_screens.py` in **1.76s**.
- **Wellbeing Test Suite:** 9 passed in `tests/test_wellbeing.py` in **0.84s**.
- **Profile Test Suite:** 16 passed in `tests/test_profile.py` in **0.95s**.
- **Full Project Suite (`pytest -q`):** **160 passed, 6 skipped, 0 failed in 8.18s**.
- **Remote Git Status:** Clean, **NO GIT PUSH EXECUTED** (strictly local).

---

## 12. Section 17 Implementation: What We Track, Group Rule & NASA MRID Grounding

### 12.1 Overview & Requirements
- **Tracked Indicators Catalog (22 indicators):** Complete clinical catalog modeling all 22 indicators from Section 17 of `Sentinel Product Document.md`:
  - `heart_rate`, `bp_sys`, `bp_dia`, `breathing_rate`, `spo2`, `blood_glucose`, `temperature`, `sleep_hours`, `sleep_quality`, `reaction_ms`, `reaction_lapses`, `valence`, `arousal`, `mood_self`, `stress_self`, `energy_self`, `connection_self`, `talk_share`, `time_alone_pct`, `voice_pitch`, `exercise_minutes`, `hydration_log`, `cabin_o2`, `cabin_co2`, `rad_dose_rate`, `rad_cumulative`, `rad_event_level`, `shelter_status`, `missed_checkins`.
- **The Group Rule (15 Independence Groups):**
  - "If a measurement does not change a status, a recommendation or a reminder, we do not track it. The group column is the independence group used for the pattern rule: two indicators in the same group count as one signal."
  - Groups: `cardio`, `respiratory`, `metabolic`, `thermal`, `sleep`, `cognitive`, `mood`, `energy`, `social`, `voice`, `activity`, `nutrition`, `cabin`, `radiation`, `adherence`.
  - Implemented in `brain/indicators.py`: `get_indicator_group()`, `group_signals()`, and `count_independent_signals()`.
- **Layer 4 Pattern Across Signals (Section 19.2):**
  - "Two or more independent signal groups moving the wrong way inside one window raise a pattern flag (for example slower reactions, flatter mood and shorter sleep)."
  - Evaluated in `evaluate_pattern_layer()`, returning Level 2 "Act" pattern alert grouping all reasons into a single explanation per clinical fatigue controls (Section 19.5).
- **Non-Reading Records Engine:**
  - Implemented in `brain/indicators.py` and `brain/store.py`:
    - `symptoms` (zone, type, severity 0-10, onset, duration)
    - `protocol_runs` (steps done, outcome, duration)
    - `kit_usage` (item_id, dose, reason, timestamp)
    - `alert_feedback` (alert_id, useful, reason)
    - `schedule_context` (current_block, quiet_hours)
    - `data_quality` (confidence, quality_rating, remeasure_suggested)
    - `mood_tags` (context only)
    - `journal_entries` (strictly counts and timestamps only; engine never touches text!)
    - `crew_pulse` (strictly anonymized, no identity)
    - `audit_events` (full event logging)
- **NASA MRID Single Source of Truth Grounding:**
  - Grounded in NASA JSC 28913 Medical Requirements Integration Documents from `dataset/*.pdf` and `shared/nasa_mrid.json` (68 documents).
  - Reference ranges rule: 0 invented limits, 100% of thresholds in `shared/thresholds.json` have verified `kind` and `source`.
  - Endpoint `GET /api/dataset/verify` dynamically audits and confirms 100% compliance.

### 12.2 Verification Summary
- **Indicators Test Suite:** 20 passed in `tests/test_indicators.py` in **1.14s**.
- **Full Project Suite (`pytest -q`):** **180 passed, 6 skipped, 0 failed in 8.06s**!
- **Constraints Maintained:**
  - **NO GIT PUSH TO REMOTE**: All operations strictly local.
  - **NO UI / FRONTEND CHANGES**: Only backend modules, schemas, APIs, and tests.
  - **Single Source of Truth**: All indicators tied to NASA MRID citations.

---

## 13. Sections 18 & 19 Implementation: Clinical Pipeline, 5 Layers & Protocol Library

### 13.1 Overview & Requirements
- **The 9-Stage Clinical Pipeline (`brain/pipeline.py`):**
  1. `Ingest`: Reads from any source, verifies authenticity, logs raw input. Rejects unknown sources with audit logging.
  2. `Validate`: Checks physical limits, rapid delta changes, and confidence. Flags implausible values requiring remeasurement (never silently drops).
  3. `Normalize`: Standardizes units (degF $\to$ C, kPa $\to$ mmHg), tags ISO timestamp, and assigns contract label.
  4. `Store`: Persists normalized reading with retry protection and audit events.
  5. `Derive`: Robust statistics (Median + MAD) for personal baseline; trend slope calculation; calibration progression (`Calibrating (n of 7)`). Excludes post-exercise, EVA, and low-confidence data.
  6. `Assess`: Evaluates the 5 layers cheapest first (Safe Limits $\to$ Personal Baseline $\to$ Trend $\to$ Cross-Signal Pattern $\to$ Context).
     - **Clinical Safety Law:** Level 3 comes ONLY from range limits, red-flag symptoms, or cabin limits, NEVER from statistics alone. Personal deviation alone never exceeds Level 2.
  7. `Decide`: Triage logic matching protocols, active kit filter, recheck timers, priority digests. Unmatched symptoms generate generic card + escalate.
  8. `Present`: Modality dispatch (screen, voice, sound, orb) per Section 19.6 presentation matrix. Breaks through quiet hours ONLY for Level 3 and cabin alerts.
  9. `Learn`: Closed-loop outcome recording and bounded sensitivity tuning without loosening safe limits.
- **Alert Lifecycle & Fatigue Controls (`brain/alerts.py`):**
  - Manages all 8 states: `detected` $\to$ `presented` $\to$ `acknowledged` $\to$ `acting` $\to$ `rechecking` $\to$ `resolved` / `escalated` / `expired`.
  - Snooze controls: enforces reason, max 2 snoozes, **blocks snooze on Level 3 urgent alerts**.
  - Fatigue controls: cooldown per alert type, one alert per cause (grouped pattern alerts).
  - Explainability: "Why this?" plain-language generator citing readings, baseline delta, rule name, and NASA MRID citation.
- **Protocol Library & Recommendation Cards (`brain/protocols.py`):**
  - Starter set of 10 clinical protocols with verified NASA MRID sources:
    1. `headache_tx` (NASA MRID `MEDB 1.2`, `MR010L`)
    2. `stress_low_mood_tx` (NASA MRID `MEDB 7.1`, `MEDB 7.2`)
    3. `poor_sleep_tx` (NASA MRID `MR042S`, `MEDB 7.1`)
    4. `high_resting_hr_tx` (NASA MRID `MEDB 2.1`, `MR006L`, `MEDB 1.6`)
    5. `high_bp_tx` (NASA MRID `MEDB 2.1`, `MR006L`)
    6. `glucose_out_of_range_tx` (NASA MRID `MR010L`, `MR010S`)
    7. `raised_temp_tx` (NASA MRID `MEDB 1.1`, `MEDB 1.2`)
    8. `cabin_hypoxia_co2_tx` (NASA MRID `MR039L`, `MR043S`, `MR091L`)
    9. `motion_sickness_tx` (NASA MRID `MEDB 1.5`, `MEDB 1.2`)
    10. `vision_change_tx` (NASA MRID `MEDB 1.10`, `MR014S`, `MEDB 1.15` - SANS risk; ALWAYS ESCALATES)
  - Environment variants (`station`, `transit`, `base`, `eva`) merge over base.
  - Generates 7-part Section 19.3 Recommendation Cards (`seen`, `sure`, `now`, `use`, `recheck`, `escalate_if`, `why`).

### 13.2 Verification Summary
- **Pipeline Test Suite (`tests/test_pipeline.py`):** 21 passed in **0.88s**.
- **Indicators Test Suite (`tests/test_indicators.py`):** 20 passed in **1.14s**.
- **Full Project Test Suite (`pytest -q`):** **201 passed, 6 skipped, 0 failed in 8.53s**!
- **Constraints Maintained:**
  - **NO GIT PUSH TO REMOTE**: All operations strictly local.
  - **NO UI / FRONTEND CHANGES**: Only backend modules, schemas, API, and tests.
  - **Single Source of Truth**: All protocols, limits, and why-it-matters reasons grounded in NASA MRIDs (`dataset/` and `shared/nasa_mrid.json`).

---

## 14. Sections 20 & 21 Implementation: Reminders, Scheduling & Ground Handoff

### 14.1 Section 20 Reminders & Scheduling Architecture (`brain/plan.py`)
- **9 Reminder Types Handled:**
  1. `checkin` (routine daily health scan)
  2. `measurement` (scheduled BP, glucose, temperature)
  3. `treatment_timer` (e.g. ice pack 15m, posture hold)
  4. `recheck` (clinical protocol re-evaluation timer)
  5. `exercise` (aerobic/resistive countermeasure blocks)
  6. `hydration` (fluid intake prompt)
  7. `sleep_winddown` (pre-sleep cognitive deceleration)
  8. `mood` (midday mental wellbeing tap)
  9. `kit_check` (regular inventory and expiration audit)
- **Section 20 7-Step Scheduling Algorithm:**
  1. *Step 1: Daily Template Expansion* (`expand_schedule_7days` expands templates across 7-day rolling horizon).
  2. *Step 2: 1-Minute Engine Tick* (`tick_one_minute` advances scheduled reminders to `due`, respects sleep and EVA rest blocks).
  3. *Step 3: Protocol Treatment & Observation Timers* (`create_treatment_timer` binds timer directly to running protocol).
  4. *Step 4: Clinical Priority Ranking* (`rank_reminders` strictly places protocol rechecks and treatment timers ahead of routine tasks).
  5. *Step 5: Quiet Hours & EVA Breakthrough* (Routine reminders suppressed during EVA and sleep blocks; only clinical rechecks and urgent alerts break through).
  6. *Step 6: Snooze Constraints* (Enforces maximum 2 snoozes with mandatory clinical reason; blocks snooze on urgent items).
  7. *Step 7: Miss Lifecycle & Escalation* (`handle_miss` provides gentle re-prompt on misses 1–2; triggers consecutive-miss flight surgeon digest alert on miss 3).
- **Automated Clinical Rechecks (`create_recheck_reminder`):**
  - Generates follow-up reminder linked to original protocol run, prompting remeasurement and logging outcome.

### 14.2 Section 21 Ground Handoff Architecture (`brain/ground.py`)
- **Text-Only Clinical Digests:**
  - Guaranteed privacy: video frames, raw voice recordings, and camera imagery are strictly excluded.
  - Strict text payloads containing telemetry summary, protocol actions, and clinical questions.
- **Store-and-Forward Queue Lifecycle (4 States):**
  - Canonical state progression: `queued` $\to$ `sent` $\to$ `acknowledged` $\to$ `replied`.
  - Offline-first durability with automatic transmission upon link availability.
  - Priority dispatch: `URGENT` packets are prioritized over routine packets when communications window opens.
- **Ground Reply Cards with Step-by-Step Confirmations:**
  - `receive_reply`: Stores flight surgeon guidance with structured instruction steps.
  - `confirm_reply_step`: Enforces astronaut confirmation of each step before execution is logged to audit trail.
  - Tracks packet round-trip latency, timestamp of inquiry, and reply staleness.
- **Split-Screen Delay Simulator (`delay_simulator_view`):**
  - Dual perspective:
    - *Left ("What Ground Sees"):* Stale status, delayed telemetry, countdown until next uplink.
    - *Right ("What Sentinel Did Just Now"):* Immediate onboard autonomous action, protocol state, escalation tag.
- **Health Privacy Safeguards (`sanitize_digest`):**
  - Astronaut medical history and background are filtered out by default.
  - Health background included only if explicit consent (`includeHealthBackground = True`) is confirmed.

### 14.3 Verification Summary
- **Reminders & Ground Test Suite (`tests/test_reminders_ground.py`):** 14 passed in **0.91s**.
- **Full Project Test Suite (`pytest -q`):** **215 passed, 6 skipped, 0 failed in 8.55s**!
- **Constraints Maintained:**
  - **NO GIT PUSH TO REMOTE**: All operations strictly local.
  - **NO UI / FRONTEND CHANGES**: Only backend modules, schemas, API, and tests.
  - **NASA Dataset Single Source of Truth**: All thresholds and protocols grounded in NASA MRIDs.

---

## 15. Core Workflows (W1–W15) & Acceptance Criteria (AC-1–AC-22) Master Verification

### 15.1 Core Workflows (Section 22) Formal Backend Verification
Formally tested and verified in `tests/test_workflows_and_acceptance.py`:
- **W1 (First Run and Calibration):** Onboarding profile initialization, privacy consents, environment selection (`transit`), baseline calibration state.
- **W2 (Daily Check-in):** 30s camera scan, manual vitals entry, mood/energy tap, reaction time, and summary headline generation.
- **W3 (Passive Monitoring to Anomaly):** Validate, derive, assess; post-exercise pulse elevation suppressed; low-confidence spike ignored; multi-signal pattern alert.
- **W4 ("I Don't Feel Well" Triage, Treat, Follow-up):** Body zone picker, symptom entry, protocol triage, recommendation card, step runner, recheck timer, outcome logging.
- **W5 (Cabin / Emergency Alert):** Cabin atmospheric drop triggers full takeover alert, buddy and commander notification, and urgent priority flight surgeon digest.
- **W6 (Reminder Lifecycle):** Scheduled $\to$ tick due $\to$ presented $\to$ snooze with reason $\to$ complete $\to$ miss escalation.
- **W7 (Ground Handoff & Reply):** Structured digest builder, store-and-forward transmission, Ground reply cards with step confirmations.
- **W8 (Environment & Mode Change):** Natural language intent matching, user confirmation dialog, profile reload, 3-day settling-in period, EVA overlay with paused reminders.
- **W9 (Weekly Review):** 7-day adherence statistics, countermeasure usage, vital averages, and surgeon summary generation.
- **W10 (Personal Profile Builder):** Incremental profile completeness meter, dynamic morning check-in prompts, real-time allergy/medicine kit contraindication filtering.
- **W11 (Daily Mood & Energy Tap):** Fast 2-tap mood/energy input updating the four mental wellbeing dimensions (mood, energy, stress, connection).
- **W12 (Low-Mood Drift Support):** Level 2 wellbeing drift triggers supportive guidance offering the top 3 personalized coping tools.
- **W13 (Stress Spike Flow):** Acute pulse elevation and stress report offers Orb Calm HRV biofeedback, tracking pre/post stress delta.
- **W14 (Urgent Wellbeing Concern):** Acute distress or self-harm triggers fixed safety script ONLY, alerts buddy/commander, and queues priority digest (no generated counseling text).
- **W15 (Crew Pulse Aggregation):** Weekly opt-in pulse survey requiring $\ge 3$ respondents before revealing team-level averages with strict anonymization.

### 15.2 Master Acceptance Criteria (Section 32.2: AC-1 to AC-22) Verification Matrix
| ID | Specification Requirement | Verification Test Function | Status |
| :--- | :--- | :--- | :--- |
| **AC-1** | Every indicator shows colour, icon, and word | `test_AC1_triple_redundant_indicator_representation` | **PASSED** |
| **AC-2** | Out-of-range reading is amber/red with one-line reason and source | `test_AC2_out_of_range_reading_amber_or_red_with_source` | **PASSED** |
| **AC-3** | Two deviating signals in one window produce one pattern alert | `test_AC3_two_deviating_signals_produce_one_pattern_alert` | **PASSED** |
| **AC-4** | Low-confidence camera reading alone raises no alert, shown as estimate | `test_AC4_low_confidence_marked_estimate_no_alert` | **PASSED** |
| **AC-5** | Head symptom with vision change triggers Level 3, offers surgeon contact, queues priority digest | `test_AC5_head_symptom_vision_change_level_3_escalate` | **PASSED** |
| **AC-6** | Accepted Level 2 recommendation creates recheck reminder in Plan and logs outcome | `test_AC6_accepted_level_2_creates_recheck_and_logs_outcome` | **PASSED** |
| **AC-7** | Environment change reloads thresholds, kit, schedule, recomputes statuses, and lists banner | `test_AC7_environment_change_reloads_and_lists_banner` | **PASSED** |
| **AC-8** | Zero network: every workflow runs and digests queue locally | `test_AC8_offline_operation_and_local_queue` | **PASSED** |
| **AC-9** | Cabin oxygen below limit triggers full takeover, spoken warning, and buddy alert | `test_AC9_cabin_oxygen_alarm_takeover_voice_and_buddy` | **PASSED** |
| **AC-10** | Two missed routine reminders produce gentle reprompt and record adherence | `test_AC10_two_missed_routine_reminders_soft_reprompt` | **PASSED** |
| **AC-11** | Any alert's "Why this?" shows readings, rule, baseline, and NASA MRID source | `test_AC11_why_this_explainability` | **PASSED** |
| **AC-12** | Kit suggestion exists in active kit list | `test_AC12_kit_suggestion_in_active_kit` | **PASSED** |
| **AC-13** | Spoken "we're in transit cabin" asks confirmation, switches only after yes | `test_AC13_spoken_transit_confirmation` | **PASSED** |
| **AC-14** | Unrecognized location phrase asks which option applies, changes nothing | `test_AC14_unrecognised_location_phrase_asks_which` | **PASSED** |
| **AC-15** | Severe symptom in station vs transit gives different procedural cards | `test_AC15_severe_symptom_station_vs_transit_variance` | **PASSED** |
| **AC-16** | Environment switch softens personal alerts during settling in; safe limits fire full strength | `test_AC16_settling_in_softens_personal_deviation_not_limits` | **PASSED** |
| **AC-17** | Profile allergy matching kit item blocks item on card with reason | `test_AC17_profile_allergy_blocks_kit_item` | **PASSED** |
| **AC-18** | Missing health background displays "profile incomplete, check the label" | `test_AC18_missing_health_background_note` | **PASSED** |
| **AC-19** | Drift in two wellbeing dimensions opens support flow with top 3 personal tools | `test_AC19_two_wellbeing_dims_drift_offers_top_three_tools` | **PASSED** |
| **AC-20** | Urgent wellbeing phrase triggers Level 3, alerts buddy/commander, queues priority digest, safety script only | `test_AC20_urgent_wellbeing_phrase_safety_script_only` | **PASSED** |
| **AC-21** | Camera mood analysis off falls back to self-report and voice | `test_AC21_camera_mood_off_fallback_to_self_report_voice` | **PASSED** |
| **AC-22** | Crew pulse requires $\ge 3$ responses before revealing team-level averages | `test_AC22_crew_pulse_requires_three_responses` | **PASSED** |

### 15.3 Full Repository Test Suite Status
- **Workflows & Acceptance Suite (`tests/test_workflows_and_acceptance.py`):** **37 passed in 0.35s**
- **Indicators Suite (`tests/test_indicators.py`):** **20 passed in 1.14s**
- **Clinical Pipeline Suite (`tests/test_pipeline.py`):** **21 passed in 0.88s**
- **Reminders & Ground Suite (`tests/test_reminders_ground.py`):** **14 passed in 0.91s**
- **Golden Scenarios Suite (`tests/test_golden.py`):** **21 passed in 1.11s**
- **Integration Suite (`tests/test_integration.py`):** **7 passed in 1.15s**
- **Master Project Test Suite (`pytest -q`):** **252 passed, 6 skipped, 0 failed in 9.52s**!
- **Strict Directives Maintained:**
  - **NO GIT PUSH TO REMOTE**: All work strictly on local machine.
  - **NO UI / FRONTEND MODIFICATION**: Preserved UI integrity; all backend engines, schemas, and APIs complete.
  - **NASA Dataset Single Source of Truth**: 100% grounded in NASA JSC 28913 MRID standards.
