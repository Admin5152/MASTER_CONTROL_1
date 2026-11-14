# How NASA monitors crew health, and where Sentinel fits

Research notes for the team and the pitch. Every claim has a source; status words matter (a NASA concept document is not a flying system).

## 1. The problem NASA itself has named: Earth-Independent Medical Operations (EIMO)

- NASA's Exploration Medical Capability (ExMC) element describes EIMO as "the gradual transfer of medical care and decision-making from Earth-based support to space-based systems." For Gateway and the lunar surface, evacuation is possible; for Mars transit there are **no evacuations** and onboard care must be crew- and vehicle-reliant. Source: NASA EIMO Concept of Operations, 2024 (NTRS 20240001402): https://ntrs.nasa.gov/citations/20240001402
- The 2025 revision adds tools to assist the **Crew Medical Officer (CMO)** "during medical events where Ground Support is either unavailable or communication-delayed beyond practicality," with requirements traced to NASA-STD-3001. Status: concept stage, not a flown system.
- **Sentinel's pitch, in NASA's words:** Sentinel is an EIMO assistant for the crew and the CMO: it monitors, explains change from each person's baseline, guides the next step, and packages findings for delayed ground review.

## 2. NASA is building an integrated crew-health data layer: CHP-IDA / CHP-IDSP

- The Crew Health and Performance Integrated Data Architecture (CHP-IDA) is "a platform to enable the amalgamation of a variety of crew health data sources." Its successor work (CHP-IDSP) supports Periodic Health Status exam scenarios with data from sensors, an otoscope and surveys. Status: in development. Sources: https://ntrs.nasa.gov/api/citations/20250000330/downloads/CHP-IDSP%20Project%20Updates_IWS%202025.pdf and https://ntrs.nasa.gov/api/citations/20250004859/downloads/CHP-IDSP_AsMA%202025.pdf
- A 2016 NASA/PHM paper described the ISS Crew Health Care System (CHeCS) architecture as out of date, with "lack of actionable and inconsistent data." Source: https://phmsociety.org/wp-content/uploads/2016/08/WFink_APopov_AHess_PHM_Conference_2016_v3.pdf
- NASA Glenn notes the ISS relies on separate medical devices and is evaluating a single integrated vital-sign system. Source: https://www.nasa.gov/glenn/glenn-expertise-space-exploration/human-health-performance/exploration-medical-technologies/multifunctional-integrated-medical-devices
- **Sentinel fit:** our one shared per-crew state object (vitals, voice, cognition, cabin, radiation, wearable) is a small working version of this idea: many sources, one record, actionable output. Sentinel Skin is our answer to "one integrated vital-sign system".

## 3. What crews are actually measured on

| NASA practice | What it is | Source | Sentinel feature |
|---|---|---|---|
| **Reaction Self Test (RST)** | ISS version of the Psychomotor Vigilance Test: a 3-minute self-test of reaction to a light, used as a caution flag for fatigue from poor sleep and high workload; in use since 2009 | https://ntrs.nasa.gov/citations/20090029851 , https://spinoff.nasa.gov/Spinoff2013/hm_1.html | Cognitive check becomes a 3-minute PVT with standard outputs: mean and median reaction time, **lapses (>500 ms)**, false starts, and change from the crew member's baseline |
| **Sleep and performance** | 24 astronauts on 6-month missions: sleep under 6 h was associated with significantly slower psychomotor speed, higher stress and workload; average in-flight sleep about 6.5 h | https://pmc.ncbi.nlm.nih.gov/articles/PMC8919197 | Sentinel links the sleep log to the reaction test and calls out "under 6 hours" nights |
| **Cognition test battery** | 10 brief computerised tests (reaction time, learning, working memory, abstraction, spatial orientation), taken pre-, in- and post-flight; a 2024 study of 25 ISS astronauts found no systematic decline | https://www.frontiersin.org/articles/10.3389/fphys.2024.1451269/full | A short weekly battery: the reaction test plus one working-memory task, labelled "inspired by", never "the NASA battery" |
| **Spaceflight Standard Measures** | A minimal set of physiological, biochemical, psychosocial, cognitive and functional measures collected consistently from all ISS crew, including sit-to-stand and tandem-walk tests | https://ntrs.nasa.gov/api/citations/20180002943/downloads/20180002943.pdf | A weekly "standard measures" checklist with the functional tests timed in the app |
| **Periodic Health Status (PHS) exam** | Periodic in-flight general health check, crew examining one another; the NASA standard lists periodic monitoring of general health status as in-mission preventive care | https://nasa.gov/reference/3-0-health-and-medical-care | **Guided exam mode**: Sentinel walks the crew through a PHS-style exam step by step (vitals, blood pressure, temperature, eyes, symptoms survey), then writes a summary packet for the flight surgeon |
| **Ocular health / SANS** | In-flight ocular ultrasound, OCT, fundoscopy, tonometry; optic nerve sheath diameter as an early marker | https://www.nasa.gov/missions/station/iss-research/vision-changes-on-space-station | Eye zone + Sentinel Skin eye module |
| **Astroskin / Bio-Monitor** | CSA smart shirt flown on ISS: ECG, BP, breathing, SpO2, skin temperature, activity | https://asc-csa.gc.ca/eng/sciences/astroskin.asp | Sentinel Skin base layer |

## 4. Pitch lines that are true and defensible

- "NASA calls this Earth-Independent Medical Operations. On the way to Mars there is no evacuation and help is up to 40 minutes round trip. Sentinel is an onboard assistant for exactly that." (EIMO ConOps 2024)
- "Astronauts already take a 3-minute reaction test on the ISS as a fatigue flag. Sentinel runs the same kind of test and connects it to sleep, which NASA found matters: under six hours of sleep, reaction speed drops." (RST; PMC8919197)
- "NASA is building one integrated crew-health data platform because the ISS system is a set of separate devices. Sentinel shows what that feels like to the crew." (CHP-IDSP; NASA Glenn)

## 5. What not to claim

- Do not say Sentinel meets or implements NASA-STD-3001, EIMO or CHP-IDA. Say it is designed around the problems they describe.
- Do not call our cognitive check "the NASA Cognition battery" or "the Reaction Self Test". Say "a psychomotor vigilance test like the ISS Reaction Self Test".
- EIMO and CHP-IDSP are concepts in development; say so if asked.
