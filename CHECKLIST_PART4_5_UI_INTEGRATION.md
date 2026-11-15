# Sentinel: Part 4 and Part 5 checklist (Clinical Experience, Clinical Intelligence)

Audit date: 2026-11-15. Scope: Product Document sections 12 to 22.
This supersedes the "no UI changes" note in `CHECKLIST_PERSON6_INTEGRATION.md`: the backend engines existed and
passed their tests, but the app called almost none of them. This pass connected them to the existing screens.

**Status words:** DONE = built, reachable in the app and checked. PARTIAL = works, with the stated limit.
NOT BUILT = not in this build.

**How it was checked:** `pytest` 270 passed, 6 skipped. `node --test tests/js` 75 passed.
`tests/clinic_ui_check.py` (a real browser driving the app) 62 checks.
The new screens were also looked at in the light theme at 1270 x 548, 1024 x 768 and 768 x 1024.

## 1. What the audit found

| # | Finding | Fixed |
| --- | --- | --- |
| 1 | The app never called the clinic, care, plan, alerts, wellbeing, indicator, onboarding or trends endpoints. No screen showed them. | Yes: 12 screens added in the existing side sheet |
| 2 | Heart rate, breathing rate and SpO2 could not be typed in by hand anywhere | Yes: Health log and Daily check-in |
| 3 | Stress, energy and connection self-ratings were rejected by the state contract, so they could never be saved | Yes: `manual.stress_self`, `energy_self`, `connection_self`, `mood_tags` |
| 4 | Non-reading records (symptoms, kit usage, alert feedback) and the alert history were lost on every restart | Yes: both are now written to disk, encrypted |
| 5 | **Data loss:** a symptom record was copied into the saved state in a shape the contract rejects. On the next start the store failed validation and silently reset every crew member's record | Yes: the entry is mapped to the contract shape; a bad entry is repaired on load |
| 6 | **Data loss:** the engine emits `flag_redflag` and `flag_pattern`, which the contract did not list. Closing the app while one was active wiped the record on the next start | Yes: added to the contract |
| 7 | An unreadable saved state was overwritten without a trace | Yes: it is kept as `data/state.unreadable-<time>.json` |
| 8 | Ticking or snoozing a schedule reminder created a second, untitled row; a reminder whose time had passed was shown as "done" without being done; the plan always used 08:30 instead of the mission clock; snooze had no limit | Yes |
| 9 | Triage ignored severity (spec 19.1 step 4), and sent any unmatched symptom to the headache protocol | Yes: 0 to 3 level 1, 4 to 6 level 2, 7 to 10 level 3; no match gives the generic card and escalates |
| 10 | Alerts were only created by a test endpoint, so "Why this?" had nothing to explain in real use | Yes: every decision from a saved reading becomes an alert with its readings, baseline, rule and source |

## 1b. Second pass (same day): what changed after the first review

| # | Asked for | Done |
| --- | --- | --- |
| 1 | Choose the name first; alerts only after | No banner, alarm, action card or spoken alert until a crew member is chosen. Then Sentinel says that person's status and their alert appears |
| 2 | One step at a time, Done, "did it work?", next step, escalate | The Care runner shows one step. Done on an action step asks "Did that help?": Better closes and logs it, About the same moves on, Worse or no relief after the last step escalates with a digest of what was done |
| 3 | The same by voice | "I have a headache" or "my stomach is not well" starts triage. "five", "yes/no", "start", "done", "still hurts", "better", "worse", "repeat" are understood while Care is open. Anything else goes to normal conversation |
| 4 | Stomach trouble gives steps | New supportive-care step list (rest, sip water, note intake, kit item by its label). It is a demo default, marked as not yet clinician-reviewed, and suggests no medicine itself |
| 5 | Tick off the action plan | Each line of the body panel's action plan can be ticked; when all are, it asks whether it helped. No opens triage |
| 6 | Remove the clutter | Body screen: the tool buttons no longer sit on the ask bar on short windows (the side panel scrolls inside itself). Vitals: the plan schedule uses equal slots, so close times cannot print over each other. The top navigation no longer stays on Wellbeing after its sheet closes |
| 7 | Open items from the first pass | See the rows marked "second pass" below |

## 1c. Third pass: every body area, the saved scan, NASA datasets, remaining rows

| # | Asked for | Done |
| --- | --- | --- |
| 1 | Steps and escalation for every organ and body area | Triage now offers Head, Eyes, Throat nose and ears, Chest and heart, Breathing, Stomach, Hands and arms, Legs and feet, Back and neck, Skin, Whole body. Each leads to a step list with red flags, the one-step-at-a-time flow and escalation. Numbness, swelling and chest symptoms start at Act, never Watch |
| 2 | Where those steps come from | Six new step lists (limb and joint, chest, airway, skin, feeling unwell, stomach) are general first-aid and supportive care written for this build. They have no NASA source and no clinician review, they name no medicine, and every card and run says "demo default". This must be replaced with reviewed content before real use |
| 3 | The scan records its result | The face scan runs 15 seconds from the moment the camera starts (and again from "Scan again"). It then saves one result: pulse with its quality, breathing rate and expression, labelled LIVE estimate, into the same pipeline as every other reading. A weak signal is kept as an estimate and raises nothing alone. No clear reading in 15 seconds saves nothing and says so. The full body scan is saved too (which areas it flagged). Both are listed under Scans in My saved record |
| 4 | More NASA datasets | `tools/nlsp_fetch.py` reads the NASA Life Sciences Portal index and keeps the human datasets that are available online and touch something Sentinel tracks: 691 of 2,593, in `shared/nlsp_catalog.json`. New screen "NASA research datasets" (menu, Evidence, and from a reading's detail) searches them by topic. Only the catalogue (titles, what was measured, descriptions, links) was fetched: the portal did not serve the data files themselves to an anonymous request, and much human data needs a data request |
| 5 | What the datasets are used for | Context and citations, as section 26 says. They do not train anything: detection stays rules and statistics over each person's own readings |
| 6 | W3: a gentle question | A new change from your usual is asked, not announced: "... Want to check in now?" Yes opens the check-in; no sets a recheck in 30 minutes |
| 7 | One profile question at check-in | Answered inline on the check-in summary |
| 8 | Missed check-ins | A check-in whose time has gone by gets one soft re-prompt, then is counted; three add a line for the digest |
| 9 | Suggestion from the cabin feed | A cabin alert offers contingency mode. It asks; it never switches itself |
| 10 | Planner preload | A profile preloaded by the surgeon or planner shows on First run with a Confirm button. There is still no planner-side screen to create one |

## 1d. Fourth pass: less friction, visible state, detail pages, crew and notifications

Checked by: `pytest` 276 passed, 6 skipped; `node --test tests/js` 75 passed; `tests/clinic_ui_check.py` 100 of 100.

| Asked for | Done |
| --- | --- |
| Health log like a modern health app | A seven-step wizard: one small group per step, large number fields with minus and plus, the last value shown, a review page with a pen on every row that goes straight to that field. Guidance sits behind an info button |
| Told at once when a value is wrong | The field turns red as you type, with the allowed range; the wizard will not move on. Same in the daily check-in |
| Ranges too narrow (a low body temperature could not be saved) | Entry limits are now what a body can show (temperature 25 to 45 C, pulse 20 to 250, SpO2 from 50). Unusual values are flagged by the engine, never refused by the form |
| Say or type a reading | "My heart rate is 68 and my blood pressure is 118 over 76" is saved as MANUAL and read back. An impossible number is refused and said why |
| Exercise is vague | Device, minutes and how for each session (ARED 60, T2 30, CEVIS 30, mobility 10). Sessions add up toward 120 minutes a day. Devices and total from NASA; the split and moves are a demo default |
| Today is a long scroll | Three cards first (Tasks and logs, Rest mode, I don't feel well); the lists open from the first card |
| Detail pages | Body system, trends, a single reading, cabin air and the saved record open as full pages with the chart, the numbers and every stored entry. Entries can be searched and filtered by source and period |
| The home card says only "a reading has moved" | It now names the reading and the change, with a "See what changed" button |
| Profiles | The six crew have preloaded demo profiles (invented values, marked as such) that each person edits and saves. Allergies, conditions, medicines and early signs are chip pickers with search. Deleting a profile leaves it empty |
| Add a crew member | Crew screen: name and body model. They start with a clean record and every function works for them |
| Buddy is told | An urgent triage, an unanswered urgent alert, a protocol that did not help and the safety flow put a notice in the buddy's inbox (and the commander's if allowed). It is shown and spoken when that person is at the screen. Bell with a count; clear one or all. The notice says help is needed, never the readings |
| Emergency step lists | The suit-breach steps can be ticked; when all are done Sentinel asks if the pressure is holding, and "no" escalates to ground. The storm shelter list can be ticked too |
| Radiation map | Tapping a crew member shows their dose, rate, storm level, shelter state and whether they need help. No health readings |
| Microphone state | A slash on both microphone buttons and the words in the ask bar when muted. Tap the microphone to mute or unmute; hold it (or the space bar) to talk |
| Menu | Closes when you tap outside it, and scrolls instead of running off the top, so Face scan is reachable again |
| Status line | Shorter: "Transit", "Link 12.7m"; detail moved to the tooltip. Tooltips on icon buttons, navigation and badges |
| Wellbeing in light mode | The hub follows the light theme |
| Top navigation stuck on Wellbeing | Fixed |
| Conversation | Without a language-model key Sentinel now answers greetings, thanks, "how are you", a hard day, missing home and similar with fixed friendly lines, and still refuses to guess facts. Free conversation needs `LLM_API_KEY` in `.env` |
| Something sent to ground | A visible notice with what was sent, its state and when it arrives, as well as the spoken line |

Not done in this pass: a redesign of the reaction test and a second reaction game (I could not tell which game was meant);
a visual redesign of the profile page beyond the pickers and full-page layout; calendar date pickers (nothing in the app
asks for a date yet; times use the system time picker).

The 6 skipped tests need things this machine does not have: an LLM key (1), `onnxruntime`, which has no build for
Python 3.15 (2), Resemblyzer and torch (1), the Whisper and Kokoro model files (2).

**If saving says "manual.energy_self: unknown field":** the server was started before these changes. Stop it and start it again.

## 2. Where each new thing is in the app

Every screen opens in the existing side sheet and uses the existing cards, pills, chips and lists.
Reach them from the menu (the nine-dot button), the More hub, Settings, or by typing or saying the name.

| Screen | Open it from | What it does |
| --- | --- | --- |
| Today | Home button "Today", menu | Current clinical mode and day block, quick logs (wake, exercise, wind-down), today's reminders with Done and Snooze, add a reminder |
| Daily check-in | Home button, menu, Today | Scan, typed entries, mood and energy taps, reaction test, one-line summary; resumable |
| Care | Home button "I don't feel well", menu, after logging a symptom | Triage one question per screen, recommendation card, protocol runner with timers, care log, protocol library |
| Alerts | Menu, "Why this?" on the home card and Health log | Alert list with state, Why this?, Got it, snooze with a reason, useful or not useful |
| How I'm doing | Menu | Four wellbeing dimensions, level wording, tools that help, "I'm stressed" flow, crew note |
| Private journal | How I'm doing, More hub | Entries kept encrypted on the device only |
| My saved record | Menu, Health log after saving | Every stored reading with counts, "my normal" per reading, re-learn button |
| Weekly review | Today, Trends | Averages, sleep beside reaction time, care this week, share with the surgeon by choice |
| Reading detail | All readings (tap a tile), My saved record | Value, status, how to measure, why it matters, what to do, source |
| Environment and mode | Chip in the status line, menu, Settings | Pick, confirm, see what changed; settling-in note |
| First run | Settings, More hub | Consent, kit, voice, calibration checklist; resumable |
| Medical kit | Care, Settings | Kit list filtered by the profile, blocked items with the reason |

## 3. Part 4: Clinical Experience and Workflows

### Section 12: clinic model and a day with Sentinel

| Item | Status | Note |
| --- | --- | --- |
| Five modes (monitor, check-up, triage, treat, escalate) shown | DONE | Today screen |
| Wake: two taps under 10 seconds | DONE | Today, quick log; stored as MANUAL |
| Morning check-in about 2 minutes, one clear line | DONE | Daily check-in |
| Work block: silent unless it matters | DONE | Existing behaviour |
| Exercise: log and suppress expected pulse change | DONE | Today, quick log; 30 minutes |
| EVA: readiness check, reminders paused | DONE | Today (readiness) and Environment (mode) |
| "I have a headache" starts triage | DONE (second pass) | Said or typed; Sentinel asks how strong it is and carries on by voice or touch. The same for "my knee is swollen", "my hand is numb", a cough, a rash |
| Evening wind-down, Orb Calm if stress is up | DONE | Today, quick log |
| Night: do-not-disturb | DONE | Today in the night block, or Environment |
| Weekly trend report with optional share | DONE | Weekly review |

### Section 13: environments and modes

| Item | Status | Note |
| --- | --- | --- |
| Voice switch with confirmation | DONE | Existing |
| Picker in Settings and chip at the top | DONE | New; always confirms; no answer means no change |
| Mission-planner preload | PARTIAL | The astronaut can confirm a preloaded profile on First run; no planner-side screen |
| Auto-suggest from schedule or cabin feed | PARTIAL (second pass) | From the schedule (rest mode inside the sleep block, routine after it) and from the cabin feed (contingency on a cabin alert). It asks; no answer means no change |
| Banner listing what changed | DONE | |
| Same problem, different plan | DONE | Protocol library shows the variant for the current environment and mode |
| Settling in (3 days) | DONE | Shown in the chip and the Environment screen |
| Launch, landing, docking | DESIGNED only | As the spec says |

### Section 14: personal health profile

| Item | Status | Note |
| --- | --- | --- |
| Profile screen, completeness meter, export, delete | DONE | Existing; now also linked from menu and Settings |
| One new profile question at check-in | DONE (third pass) | Answered inline on the summary |
| Allergy blocks the kit item with the reason | DONE | Recommendation card and Medical kit |
| "Profile incomplete, check the label" | DONE | Recommendation card |
| Calibrating (n of N) | DONE | My saved record and Reading detail |
| Encryption at rest | DONE | Existing vault; new files use it |

### Section 15: mental wellbeing

| Item | Status | Note |
| --- | --- | --- |
| Four dimensions, no single score | DONE | How I'm doing |
| Self-ratings for mood, energy, stress, connection, tags | DONE | Health log and Daily check-in; they now drive their dimension |
| Levels 0 to 2 with the spec wording | DONE | |
| Level 3 only from what the person says | DONE | Existing safety flow, unchanged |
| Top three tools from "what helps me" | DONE | |
| Stress spike flow (W13) | DONE | Asks strength 1 to 5, offers a tool, sets a recheck time |
| Before and after logged, tools ranked per person | DONE | Every support session now also reaches the wellbeing engine |
| Private journal | DONE | |
| Crew pulse, cohesion note | DONE | Existing pulse; cohesion note now shown |
| Speaker-ID time alone | SIM | No change |
| Messages from home, plant log | DESIGNED | Shown as not in this build |
| Wording reviewed by a clinician | NOT DONE | Draft for the hackathon, as the spec says |

### Section 16: screens and UX

| Screen in 16.1 | Status |
| --- | --- |
| Home, Check-in flow, Care triage, Care runner, Care log, Trends, Plan (as Today), Wellbeing, Crew and cabin, Ground, Profile and settings, Onboarding | DONE |
| Indicator detail | DONE |
| Bottom bar "Home, Care, Trends, Plan, Ground" | NOT BUILT, on purpose. A second bar would sit on the ask bar and add back the clutter that was just removed. Care, Check-in and Today are buttons on Home and in the menu |
| Always present: voice orb, "I don't feel well", alert banner | DONE |
| Large targets, glove mode | DONE | New controls follow glove mode |
| Status never by colour alone | DONE | Icon and word on every level |
| Light theme and tablet sizes for the new screens | CHECKED (second pass) | Looked at in light theme at three sizes; no horizontal overflow, no page errors |

## 4. Part 5: Clinical Intelligence and Detection

### Section 17: what we track

| Item | Status | Note |
| --- | --- | --- |
| Every manual entry stored with source, label and time | DONE | History points carry `MANUAL` and confidence 1 |
| Heart rate, breathing rate, SpO2 by hand | DONE | |
| Stress, energy, connection, mood tags | DONE | |
| Symptoms, protocol runs, kit usage, alert feedback, journal count | DONE | Now persisted |
| Reference ranges with a source | DONE | Existing |

### Section 18 and 19: detection, triage, protocols

| Item | Status | Note |
| --- | --- | --- |
| Pipeline and five layers | DONE | Existing engine |
| Personal baseline: median and spread, excluding post-exercise and low confidence | DONE | "Re-learn my normal" refits it from the stored readings |
| Level 3 never from statistics alone | DONE | Checked by test |
| One alert per cause, cool-down | DONE | |
| "Why this?" | DONE | |
| Snooze needs a reason and has a limit; urgent cannot be snoozed | DONE | |
| "Not useful" lowers sensitivity within bounds | DONE (second pass) | The personal-deviation cut-off moves by the recorded amount, clamped to 20% looser or 10% tighter. Range limits are untouched (tested) |
| Alert moves on to acting, resolved, escalated | DONE (second pass) | Starting the steps moves the newest open alert to acting; the outcome resolves or escalates it. The banner's Acknowledge marks urgent alerts seen. "Rechecking" as its own state is not used |
| Unanswered alert re-presented louder; missed urgent alert alerts the buddy | DONE (second pass) | Checked every 20 seconds. Repeats after 1, 5 or 15 minutes by level, twice, then expires; an expired urgent alert alerts the buddy (SIM). The times are tunable defaults |
| Recommendation card, seven parts | DONE | |
| Red flag jumps to the urgent card, alerts the buddy, priority digest | DONE | |
| Protocol runner: steps, timers, pause, escalate, outcome | DONE | Timers run in the page; closing the sheet stops a timer |
| Starter protocol set with sources | PARTIAL | Triage now matches the symptom words to 10 protocols (headache, motion sickness, eye irritation, stomach upset, racing heart, fever, poor sleep, stress, breathlessness, vision change). Vision change always escalates. No match gives the generic card at level 2 with escalation. Every body area now has a step list (third pass). Six of them are demo defaults without a NASA source or clinician review, and say so on screen |
| Kit filter | DONE | |

### Section 20 and 21: reminders and ground

| Item | Status | Note |
| --- | --- | --- |
| Template reminders, due, done, snooze with limit, add | DONE | Today |
| Recheck reminder when a recommendation is accepted | DONE | |
| Quiet hours and EVA hold routine reminders | DONE | |
| Missed, re-presented once, three misses in the digest | DONE (third pass) | For schedule check-ins; the count now lands in `engagement.missed_checkins`, where the wellbeing engine reads it |
| Two reminder systems | PARTIAL (second pass) | They now share "done" both ways for check-in, exercise, hydration, mood log and wind-down. They are still two lists with different times |
| Digest, queue states, urgent first | DONE | Existing |
| Ground reply card, confirm each step, age of reply | DONE | To ground screen; a demo button simulates a reply |
| Delay simulator | DONE | To ground screen |

### Section 22: workflows

| Workflow | Status |
| --- | --- |
| W1 first run, W2 daily check-in, W4 triage to follow-up, W5 cabin alert, W6 reminders, W7 ground, W8 environment, W9 weekly review, W10 profile, W11 mood tap, W12 low-mood support, W13 stress spike, W14 urgent concern, W15 crew pulse | DONE in the app |
| W3 passive monitoring to a gentle spoken question | DONE (third pass): asks "Want to check in now?"; yes opens the check-in, no sets a recheck |

### Normal conversation

There is no `.env` file on this machine, so no language-model key. Without one Sentinel answers health and mission
questions from its rules and says it needs a connection for anything else. Copy `.env.example` to `.env` and set
`LLM_API_KEY` to get free conversation. This was not changed and could not be tested here.

## 5. "Train the model on the dataset"

There is no model to train in the machine-learning sense, and that is by design in the spec (section 19.5):
no public labelled dataset of astronaut health anomalies exists, so detection is statistical and rule-based.

- The `dataset/` folder holds NASA requirement PDFs. They are documents, not training rows. They are already
  parsed into `shared/nasa_mrid.json` and cited by thresholds, protocols and the Evidence screen.
- What does learn is the **personal baseline**: a median and spread per reading, fitted from each person's own
  stored entries. It now includes what you type in, shows "Calibrating (n of 7)" until it has enough, and can be
  refitted from My saved record. It moves only the personal baseline; range limits never change.
- The camera expression model (HSEmotion) is used as shipped. It was not retrained.

## 6. Run it

```powershell
.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
```

Checks:

```powershell
.venv\Scripts\pytest -q
node --test tests/js
# browser check: start a clean server on port 8765 first
$env:SENTINEL_NO_PERSIST="1"; $env:SENTINEL_FRESH="1"; .venv\Scripts\python.exe -m uvicorn server:app --port 8765
.venv\Scripts\python.exe tests\clinic_ui_check.py
```

Nothing was committed or pushed.
