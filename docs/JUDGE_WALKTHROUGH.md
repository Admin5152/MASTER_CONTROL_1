# COSMOcare Sentinel: a walkthrough for judges

## The problem in one sentence

On the way to Mars a message to Earth takes up to 24 minutes each way and there is no quick ride home, so when an
astronaut feels unwell the first response has to happen on board, with no doctor in the room.

NASA calls this Earth-Independent Medical Operations. Today's model, where the flight surgeon on the ground is
always minutes away, stops working beyond the Moon.

## What Sentinel is

Sentinel is a crew-health companion that runs on a tablet inside the spacecraft, with no internet. It:

1. **Watches** a small set of readings for each crew member.
2. **Notices change** against medical reference ranges and against that person's own normal.
3. **Explains** what changed, in plain words, and why it matters.
4. **Guides** the astronaut through sourced steps, one at a time, by touch or by voice.
5. **Brings in people**: the crew buddy on board, and the flight surgeon on Earth through a delay-tolerant message queue.

It does not diagnose and it does not replace the mission's emergency procedures. It closes the gap between "I don't
feel right" and "the flight surgeon has seen it".

## Three things that make it different

**1. It acts first and asks Earth second.** Every decision is made on the device. When the link is down, messages
to the ground wait in a queue and the urgent ones leave first when it returns. Nothing in the medical path needs a
connection.

**2. Every number tells you where it came from.** Each reading carries a label: LIVE (measured now), MANUAL (typed or
said by the astronaut), SIM (simulated) or DESIGNED (not built). Every range and protocol carries a source. Judges,
crew and doctors can always see what is real.

**3. Rules decide; the AI only talks.** Urgency levels, protocols and alerts come from rules and statistics that can
be explained line by line ("Why this?" on every alert). A language model, when connected, only phrases the answer.
With no model, Sentinel still works.

## Walk through one problem, start to finish

This is the path a judge can follow live in the app.

| Step | What the astronaut does | What Sentinel does | Where it lives in the code |
| --- | --- | --- | --- |
| 1. Who is here | Taps their name | Nothing about anyone is shown or spoken until the person is chosen. Then it says their status and any message waiting for them | `app/js/main.js` (`identified`) |
| 2. A reading comes in | Says "my heart rate is 68 and my blood pressure is 118 over 76", or uses the health log, the 15-second face scan or a worn device | Checks the value is physically possible, labels it, stores it encrypted, compares it with ranges and with their own normal | `brain/core/devices.py`, `brain/core/store.py`, `brain/rules/drift.py`, `brain/rules/thresholds.py` |
| 3. Something changes | Nothing | Raises one alert per cause, says which reading moved and by how much, and offers "See what changed" and "Why this?" | `brain/clinical/alerts.py`, `brain/rules/decision.py` |
| 4. They don't feel well | Says "my stomach is not well" | Asks how strong it is (0 to 10), asks a few yes/no questions one at a time, checks for red flags, sets an urgency level from 1 to 3 | `brain/clinical/care.py`, `app/js/clinical/care.js` |
| 5. One step at a time | Says "done" | Shows one step. After a step that should help, asks "Did that help?". Better closes it; the same moves on; worse escalates | `care.js` (guided runner) |
| 6. It isn't working | Says "it's getting worse" | Escalates: a digest of what was done goes to the flight surgeon, and their chosen crew buddy gets a notice that is spoken when the buddy reaches the screen | `server.py` (`_notify_contacts`), `brain/crew/notify.py`, `brain/mission/ground.py` |
| 7. Waiting for Earth | Nothing | The digest waits through a blackout, leaves urgent-first, and the reply comes back as steps the astronaut confirms one by one, showing how old the advice is | `brain/mission/ground.py`, `brain/mission/ops.py` |
| 8. Follow-up | Nothing | A recheck reminder is set; the outcome is kept in the care log; their personal normal keeps learning from their own data | `brain/clinical/plan.py`, `Store.learn_baselines` |

A red flag at step 4 (for example a headache with vision change) skips straight to the urgent card: tell a crewmate
now, buddy and commander alerted, priority digest sent. Level 3 can only come from a red flag, a range limit or the
cabin air, never from statistics alone.

## The rest of the mission day

- **Daily check-in** in about two minutes: scan, a few entries, mood and energy taps, a reaction test, one summary line.
- **Exercise** that names the device, minutes and method (ARED, treadmill, cycle) and counts toward the day.
- **Mental wellbeing** in four dimensions (mood, energy, stress, connection), never one score, with tools that the
  person rates; Sentinel learns which ones help them.
- **Environment and mode**: station, transit or planetary base; routine, EVA, rest or contingency. Each changes how
  fast Sentinel escalates. It always asks before switching.
- **EVA**: suit pressure is watched; a leak raises tickable steps and tells the whole crew inside.
- **Radiation**: live NOAA space-weather data, a dose passport, shelter guidance, and each crewmate's exposure on a map.
- **Privacy**: health data stays with its owner. A crewmate sees only that help is needed, never the readings.

## How it would work with NASA systems

Every input enters through one door (`POST /api/device/{crew}`). A reading from a real suit looks exactly like a
simulated one, except it is labelled LIVE instead of SIM. Swapping a simulator for real hardware means writing one
small translator, not changing the system.

| Sentinel part | Today | Would connect to | Public source we checked |
| --- | --- | --- | --- |
| Device interface | Simulated watch, chest hub, suit and cabin | Real worn sensors and suit telemetry over the vehicle network | CSA Bio-Monitor (Astroskin); NASA SUITS telemetry server |
| Cabin air | Simulator | The vehicle's life-support data | ISS Live public telemetry feed |
| Message queue to Earth | Store and forward with a simulated delay | NASA's Delay/Disruption Tolerant Networking | NTRS 20100020137 |
| Health record | On the device, encrypted | NASA's onboard Medical Data Architecture | NTRS 20200000568 |
| Ranges and protocols | JSON files, each with a source | Mission medical requirements and the flight surgeon's protocols | 68 NASA JSC 28913 MRIDs, already parsed |
| Space weather | Live NOAA flux, NASA DONKI storm replay | The mission's radiation operations feed | Already connected |

Links and detail: `docs/INTEGRATION.md`.

## What is built, in numbers

| | |
| --- | --- |
| Backend tests | 280 passing (`pytest`) |
| Front-end logic tests | 75 passing (`node --test tests/js`) |
| Real-browser checks driving the app | 105 of 105 (`tests/browser/clinic_ui_check.py`) |
| Golden scenarios and acceptance criteria from our spec | S1 to S19 and AC-1 to AC-22, each with a test |
| NASA requirement documents parsed | 68 JSC 28913 MRIDs |
| NASA human research datasets catalogued | 691 of 2,593 in the NASA Life Sciences Portal index |
| Sourced protocols | 10, each with triggers, red flags, steps and a source |

## What we are honest about

| Part | State |
| --- | --- |
| Decision engine, alerts, triage, guided steps, reminders, notifications, care log, saved record | Working in this build |
| Camera pulse and breathing, voice, speaker recognition | Working, as estimates; not validated against medical devices |
| Watch, chest hub, skin patch | Designed hardware; the interface runs and a simulator drives it |
| Suit, cabin air, ground link and delay | Simulated |
| NASA system connections | Proposed. None exist; we have not seen a flight interface specification |
| Six first-aid step lists and the exercise split | Demo defaults, not reviewed by a clinician; the app labels them |
| Crew profiles | Invented demo values |

Before real use NASA would need: interface specifications, clinician review of every protocol, a medical-device and
safety assessment, and flight-grade security.

## Why this team

- **We built the hard part, not just the screens.** An explainable decision engine, a delay-tolerant ground link and
  a closed loop from symptom to escalation, all tested.
- **We designed for space, not adapted from Earth.** Offline first, voice first, glove-sized targets, quiet hours,
  EVA mode, settling-in after a move between environments, privacy in a crew of six.
- **We are honest by construction.** Every value and step shows its source and whether it is real. Judges can verify
  every claim on screen.
- **It is ready to meet NASA halfway.** One door for every device means the path to real hardware is a translator per
  system, not a rewrite.

## A three-minute demo script

1. **Begin**, tap Eliah. Sentinel greets him and says his status.
2. Say **"my blood pressure is 192 over 124"**. The red banner appears; tap **Details**, then **Recommended steps**.
3. Say **"my stomach is not well"**. Answer "three" and "no" to the questions. Say **"start"**, **"done"**, then **"it's getting worse"**. Show the escalation and the digest on **To ground**.
4. Switch to **Seth** (Eliah's buddy). The bell lights up and Sentinel tells him Eliah needs a check-in.
5. Open **Devices** and send a simulated suit reading that drops pressure. The suit card appears with tickable steps.
6. Open **Radiation** and tap a crewmate on the map.
7. Close on the badges: every number on screen says whether it is LIVE, MANUAL, SIM or DESIGNED.
