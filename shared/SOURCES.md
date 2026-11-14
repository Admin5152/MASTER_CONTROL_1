# Sources checked during setup (13 Nov 2026)

Every number below was read on the page named, except where marked. `thresholds.json` stores each one with its `kind` and URL.

## Cabin atmosphere (NASA)
- **CO2.** NASA OCHMO-TB-004 Carbon Dioxide (https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf). Text read from the PDF: "NASA-STD-3001 Volume 2 Rev D [V2 6004]: The system shall limit the average one-hour CO2 partial pressure (ppCO2) in the habitable volume to no more than 3 mmHg." Also: "To keep the risk of headache below 1%, average 7-day CO2 needs to be maintained below 2.5 mmHg."
  - Conversion (this build): ppm = ppCO2 / total pressure x 10^6. ISS cabin is 14.7 psia = 760 mmHg (stated in OCHMO-TB-003). 3 / 760 x 10^6 = **3,947 ppm** (alert). 2.5 / 760 x 10^6 = **3,289 ppm** (watch).
- **Oxygen.** NASA OCHMO-TB-003 Habitable Atmosphere (https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf). [V2 6003] refers to Table 6.2-1 (Inspired Oxygen Partial Pressure Exposure Ranges); the table itself is an image and could not be read as text, but its footnote reads "1-hour time-weighted average with an absolute lower limit for the minimum hypoxia range of 122 mmHg/2.36 psia". The brief gives PIO2 = (PB - PH2O) x FiO2 with PH2O = 47 mmHg, and sea-level PIO2 = 149.7 mmHg.
  - Conversion (this build): at 760 mmHg, FiO2 = 122 / (760 - 47) = **17.1%**.
  - The app's cabin alarm fires at **19.5%**, the OSHA definition of an oxygen-deficient atmosphere (29 CFR 1910.146), marked `clinical_reference` because it is an occupational-safety number, not a NASA one.

## Radiation
- **Career limit 600 mSv, SPE 250 mSv per event, shielding 50% for SPE / 7% for GCR**: NASA OCHMO-TB-020 radiation protection technical brief (https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf), read from the PDF. "[V1 4030] ... total career effective radiation dose due to space flight radiation exposure shall be less than 600 mSv. This limit is universal for all ages and sexes."
- **Mars cruise 1.8 mSv/day**: NASA JPL release, 30 May 2013 (https://www.jpl.nasa.gov/news/data-from-nasa-rovers-voyage-to-mars-aids-planning/).
- **Mars surface 0.67 mSv/day**: SwRI release on Hassler et al. 2014 (https://www.swri.org/press-release/swri-scientists-publish-first-radiation-measurements-surface-mars); NTRS record 20180007641. **The spec's 0.64 could only be found in secondary press coverage (Space.com, NBC), so 0.67 from the primary release is used.**
- **ISS 0.2 to 0.5 mSv/day**: Simonsen, Zawaski, Weeks, NASA, NTRS 20250006168, read from the PDF. The app uses the midpoint, 0.35.
- **Lunar surface 1.37 mSv/day**: Zhang et al. 2020, Science Advances (Chang'e-4 LND). Not NASA; marked `demo_placeholder`.
- **NOAA S-scale**: S1 10 pfu, S2 100, S3 1,000, S4 10,000, S5 100,000 (>=10 MeV protons). https://www.swpc.noaa.gov/noaa-scales-explanation (served from spaceweather.gov).
- **Live feeds** (structure read 13 Nov 2026):
  - `integral-protons-1-day.json`: a list of `{time_tag, satellite, flux, energy}`; `energy` strings include `">=10 MeV"`; 5-minute cadence, one row per energy channel.
  - `noaa-scales.json`: an object keyed `"-1"`, `"0"`, `"1"`... where `"0"` is current; `S.Scale` is a string such as `"0"` (null on forecast days).
- **DONKI**: `shared/donki_sep_events.json` holds two 60-day windows (May-June 2024 and Sept-Oct 2024; DONKI rejects ranges over 60 days). DONKI gives event onset times and linked flares and CMEs, **not peak flux**, so the `solar_storm` scenario replays the real onset time of the 2024-05-10 GOES >10 MeV event but its flux curve is scripted; the label says so.

## Eyes (SANS)
- NASA NTRS 20220000516, "Spaceflight Associated Neuro-ocular Syndrome (SANS): Clinical Update": "Approximately 69% of long duration astronauts present with the earliest indications of SANS." Qualifier: a new sign in at least one eye (optic disc edema, chorioretinal folds, globe flattening, refractive shift >= +0.75 D).
- **The team's "81%" could not be found on a nasa.gov or NTRS page** (it appears in a 2026 ophthalmology trade article). It is not used anywhere in the app.

## Other NASA pages
- Five hazards: https://www.nasa.gov/hrp/hazards/
- Isolation and confinement: https://www.nasa.gov/hrp/hazard-isolation-and-confinement/ (seen in search results; not opened in full)
- Mars delay, about 4 min at closest to about 24 min at farthest: https://www.nasa.gov/centers-and-facilities/goddard/space-communications-7-things-you-need-to-know/
- Veggie VEG-04: NTRS 20205008589; 2025 behavioural-health poster NTRS 20250000411 (from search-result abstracts).
- ISS medical kit categories: NASA Medical Kit Checklist, https://www.nasa.gov/wp-content/uploads/2015/03/medical_kit_checklist_-_full_release.pdf (from search result; the kit in `med_kit.json` is illustrative, SIM).

## Clinical reference ranges (not NASA)
- MedlinePlus vital signs (https://medlineplus.gov/ency/article/002341.htm): pulse 60-100, breathing 12-18, temperature 36.5-37.3 C.
- MedlinePlus pulse oximetry: SpO2 95-100% normal.
- CDC fever definition: 38 C or greater.
- AHA blood pressure categories (page returned 403 to the fetcher; categories are the 2017 AHA/ACC ones: stage 1 at 130/80, crisis above 180/120).
- ADA: hypoglycaemia below 70 mg/dL; target below 180 mg/dL 1-2 h after meals.
- CDC: adults need 7 or more hours of sleep.
- Sentinel also flags systolic blood pressure at 180 mmHg or diastolic at 110 mmHg as an app recheck alert to satisfy P4's SV1 demo scenario. This is labelled `demo_placeholder`; it is not a NASA limit or a substitute for clinical guidance. The source-backed AHA levels remain separately identified.

## demo_placeholder thresholds
All drift percentages; heart-rate alert 130 and low watch 50; SpO2 alert 90; temperature low watch 36.0; mood watch below 3; fatigue and stress indices; S2 as the shelter-alert level; storm extra dose per hour; lunar dose rate; speaker-ID 0.75 cut-off; rPPG quality cut-off.

## Body model and zones: NASA MRIDs (JSC 28913)
The "How to measure" and "Why it matters" text on each body zone (`shared/facts.json`, `zones.*.how_to_measure`, `why_it_matters`, `mrids`) paraphrases these Medical Requirements Integration Documents from `dataset/` (Person 2's set). Schedules and durations are as written in the documents; nothing is added to them.
- **MEDB 1.1** Pre- and Postflight Physical Exam for Long Duration Crews (includes MEDB 1.4 Neurological Assessment): `dataset/cl5yvqhsu2slb01o685y93vkb.pdf`
- **MEDB 1.2** Crew Medical Officer Health Status Evaluations: `dataset/cl5yvqhsu2sm901o68cdoern1.pdf`
- **MEDB 1.6** Resting ECG: `dataset/cl5yvqhsu2smd01o61igocemc.pdf`
- **MEDB 1.8** Hearing Assessment: `dataset/cl5yvqhsu2smn01o6ad8lewzs.pdf`
- **MEDB 1.9** Dental Examination: `dataset/cl5yvqhsu2sl801o6a7fn6v7t.pdf`
- **MEDB 1.10** Eye Examinations: `dataset/cl5yvqhsu2sm101o6fou61gqq.pdf`
- **MEDB 1.12** Ultrasound Imaging (Sonography): `dataset/cl5yvqhsu2slc01o676lm0fsz.pdf`
- **MEDB 1.14** Photodocumentation of Skin: `dataset/cl5yvqhsu2sm501o67yu9azg9.pdf`
- **MEDB 7.2** Private Psychological Conferences: `dataset/cl5yvqhsv2sn401o6cfkvah14.pdf`
- Read but not cited in the app: MEDB 1.9.1 (dental X-ray), MEDB 2.3 (tuberculosis screening), MEDB 7.1 and 7.5 (psychological status check, behavioural observation of training), MR009S, MR013S, MR032L, MR076S, MR084L, MR089S (shuttle-era or ground-only requirements).
- The dataset has no MRID for bone density, body mass or MRI in Person 2's set, so the bones zone cites only the physical exam.

## NASA JSC 28913 MRIDs: all 68 documents

Every document in `dataset/` is parsed by `tools/mrid_extract.py` into `shared/nasa_mrid.json` (purpose, measurement
parameters, deliverables, pre-, in- and postflight activities, and the numeric statements each one makes). The app shows
them on the Evidence screen and in each body zone's panel. Numeric limits taken from them into `shared/thresholds.json`:
MR084L and MEDB 1.8 (85 dBA hazardous noise), MEDB 3.2 (biodosimetry above 10 rem, 100 mSv), MR006L (90% of predicted
maximum heart rate in a graded exercise test), MR008L (CO above 50 ppm confirmed by Draeger tube), MR039L (CO2 compared
with the 7-day SMAC). The other documents set procedures and schedules rather than limits; they are cited for how a
measure is taken and why it matters.

| MRID | Title | Owner | Used in | Body zones | File |
| --- | --- | --- | --- | --- | --- |
| MEDB 3.1 | Radiation Monitoring/Crew Personal Dosimetry | P1 | Brain, cabin and integration, Radiation Watch | lungs, whole_body | `cl5yvqhsu2smt01o6asca5dwu.pdf` |
| MEDB 3.2 | Biodosimetry Testing (Occupational Monitoring) | P1 | Brain, cabin and integration, Radiation Watch | lungs, whole_body | `cl5yvqhsu2smu01o67lseef9a.pdf` |
| MEDB 6.1 | and MEDB 6.2 EVA Medical Monitoring | P1 | Brain, cabin and integration, Radiation Watch, Vitals and check-in | bones, heart, lungs, whole_body | `cl5yvqhsu2smz01o63a5sb3op.pdf` |
| MEDB N3.04 | Biodosimetry | P1 | Brain, cabin and integration, Radiation Watch | lungs, whole_body | `cl5yvqhsv2sn901o6h0nsf1lg (1).pdf` |
| MR004L | In-flight Radiation Area Monitoring with Dosimeters | P1 | Brain, cabin and integration, Radiation Watch | lungs, whole_body | `cl5yvqhsv2snf01o6bh09ba10.pdf` |
| MR004S | In-Flight Radiation Monitoring with Passive Dosimeters | P1 | Brain, cabin and integration, Radiation Watch | lungs, whole_body | `cl5yvqhsv2snj01o6c5fjglma (1).pdf` |
| MR005L | In-flight Radiation Monitoring with Tissue Equivalent Proportional Counter (TEPC) for Long | P1 | Radiation Watch | whole_body | `cl5yvqhsv2snl01o60mwu9p6r.pdf` |
| MR005S | Radiation Monitoring using Shuttle TEPC for Short Duration Flights | P1 | Radiation Watch | whole_body | `cl5yvqhsv2snn01o69ap47uqd.pdf` |
| MR092L | In-flight Radiation Monitoring with Radiation Assessment Detector (Rad Detector) for Long  | P1 | Radiation Watch | whole_body | `cl5yvqkq12spn01o63cg21vbx.pdf` |
| MR093L | In-flight Radiation Monitoring with Intravehicular Tissue Equivalent Proportional Counter  | P1 | Radiation Watch | whole_body | `cl5yvqkq12spo01o6gj3x4son.pdf` |
| MR094L | In-flight Radiation Area Monitoring with Active Radiation Environment Monitor 2 (REM2) | P1 | Brain, cabin and integration, Radiation Watch | lungs, whole_body | `cl5yvqkq12spp01o657hgcc75.pdf` |
| MEDB 1.1 | Pre- and Postflight Physical Exams for Long Duration Crews (includes MEDB 1.4 Neurological | P2 | Body model and zones, Face and voice, Vitals and check-in | bones, eyes, head, heart, whole_body | `cl5yvqhsu2slb01o685y93vkb.pdf` |
| MEDB 1.10 | Eye Examinations (includes MED Volume B sections 1.10 and 1.10.1) | P2 | Body model and zones | eyes, whole_body | `cl5yvqhsu2sm101o6fou61gqq.pdf` |
| MEDB 1.12 | Ultrasound Imaging (Sonography) | P2 | Body model and zones, Brain, cabin and integration | lungs, whole_body | `cl5yvqhsu2slc01o676lm0fsz.pdf` |
| MEDB 1.14 | Photodocumentation of Skin | P2 | Body model and zones, Brain, cabin and integration | lungs, whole_body | `cl5yvqhsu2sm501o67yu9azg9.pdf` |
| MEDB 1.2 | Crew Medical Officer Health Status Evaluations | P2 | Brain, cabin and integration, Vitals and check-in | gut, lungs, whole_body | `cl5yvqhsu2sm901o68cdoern1 (1).pdf` |
| MEDB 1.6 | Resting ECG | P2 | Vitals and check-in | heart | `cl5yvqhsu2smd01o61igocemc (1).pdf` |
| MEDB 1.8 | Hearing Assessment (includes MED Volume B Sections 1.8 and 1.8.1) | P2 | Body model and zones | head | `cl5yvqhsu2smn01o6ad8lewzs (1).pdf` |
| MEDB 1.9 | Dental Examination | P2 | Body model and zones, Brain, cabin and integration | head, lungs, whole_body | `cl5yvqhsu2sl801o6a7fn6v7t.pdf` |
| MEDB 1.9.1 | Dental Orthopantomogram | P2 | Body model and zones | head | `cl5yvqhsu2slh01o60xjte6mf.pdf` |
| MEDB 2.3 | Tuberculosis | P2 | Body model and zones | whole_body | `cl5yvqhsu2slk01o63c15htp4.pdf` |
| MEDB 7.1 | PREFLIGHT PSYCHIATRIC/PSYCHOLOGICAL STATUS CHECK | P2 | Body model and zones, Wellbeing | head | `cl5yvqhsv2sn301o600z4bg12 (1).pdf` |
| MEDB 7.2 | Private Psychological Conferences (PPCs) | P2 | Body model and zones, Wellbeing | head | `cl5yvqhsv2sn401o6cfkvah14.pdf` |
| MEDB 7.5 | Behavioral Observation of Training | P2 | Body model and zones, Wellbeing | head | `cl5yvqhsv2sn701o6fz3e2432.pdf` |
| MR009S | Pre- and Postflight Physical Exam for Short Duration Crews | P2 | Body model and zones, Face and voice, Vitals and check-in | bones, eyes, head, heart, whole_body | `cl5yvqhsv2snv01o67637aw8j (1).pdf` |
| MR013S | Audiometry for Shuttle Crews | P2 | Body model and zones | head | `cl5yvqkq02sny01o64azp7z3j (1).pdf` |
| MR032L | ISS Private Family Conferences (PFCs) | P2 | Wellbeing | head | `cl5yvqkq02sof01o6ey5fea1j (1).pdf` |
| MR076S | Photodocumentation of Skin Injuries and Allergic Reactions for Shuttle Crews | P2 | Body model and zones, Brain, cabin and integration | lungs, whole_body | `cl5yvqkq12sp801o6a672356o.pdf` |
| MR084L | Acoustic Monitoring and Countermeasures for Long Duration Flights | P2 | Body model and zones | head, whole_body | `cl5yvqkq12spc01o65mpk0zwd.pdf` |
| MR089S | Annual Medical Examinations | P2 | Body model and zones, Brain, cabin and integration, Vitals and check-in | lungs, whole_body | `cl5yvqkq12spk01o603tkalsp.pdf` |
| MEDB 1.5 | Neurovestibular Platform Test | P3 | Body model and zones, Face and voice | head, whole_body | `cl5yvqhsu2slg01o6e5za71ti (1).pdf` |
| MR032S | Private Family Conferences (PFCs) for Shuttle | P3 | Wellbeing | head | `cl5yvqkq02sog01o62avo2o1n.pdf` |
| MEDB 1.11 | Bone Densitometry | P4 | Body model and zones | bones | `cl5yvqhsu2sm301o64r32h484.pdf` |
| MEDB 1.13 | Body Mass Measurement | P4 | Body model and zones | whole_body | `cl5yvqhsu2sm401o6bkmf7r9v.pdf` |
| MEDB 1.7 | 24-Hour Ambulatory ECG Monitoring | P4 | Vitals and check-in | heart | `cl5yvqhsu2sml01o68wen97cf (1).pdf` |
| MEDB 2.1 | Laboratory Testing | P4 | Brain, cabin and integration, Vitals and check-in | bones, gut, heart, lungs, whole_body | `cl5yvqhsu2smp01o6c03eekh2.pdf` |
| MEDB 5.1 | Functional Fitness Assessments | P4 | Vitals and check-in | bones, heart | `cl5yvqhsu2smv01o66ubia6sh.pdf` |
| MEDB 5.2 | On-Orbit Strength & Conditioning Monitoring | P4 | Brain, cabin and integration, Vitals and check-in | bones, heart, lungs, whole_body | `cl5yvqhsu2smy01o6h2p9625g (1).pdf` |
| MEDB 5.4 | Calf Volume Measurement | P4 | Brain, cabin and integration | lungs, whole_body | `cl5yvqkq12spt01o690lx8s30.pdf` |
| MEDB 6.3 | Arm Ergometry Test | P4 | Brain, cabin and integration, Vitals and check-in | bones, heart, lungs, whole_body | `cl5yvqhsv2sn201o6dmol41da.pdf` |
| MEDB N3.07 | Cycle Ergometer Test/Aerobic Functional Capacity | P4 | Body model and zones, Vitals and check-in | bones, gut, heart, whole_body | `cl5yvqhsv2snc01o6d7jx6iah (1).pdf` |
| MR006L | Exercise Treadmill Test | P4 | Vitals and check-in | bones, gut, heart, whole_body | `cl5yvqhsv2sno01o650ot7ri1 (1).pdf` |
| MR010L | Clinical Laboratory Testing for Long Duration Flights | P4 | Brain, cabin and integration, Vitals and check-in | bones, gut, heart, lungs, whole_body | `cl5yvjgoa2lx801o60p2o7ii6.pdf` |
| MR010S | Clinical Laboratory Testing for Short-Duration Flights | P4 | Brain, cabin and integration, Vitals and check-in | bones, gut, heart, lungs, whole_body | `cl5yvqkq02snw01o6d70cd93h.pdf` |
| MR026L | Postflight Reconditioning | P4 | Vitals and check-in | bones, heart | `cl5yvqkq02so701o60z8easal.pdf` |
| MR078L | Physical Fitness Evaluation: Functional Fitness | P4 | Brain, cabin and integration, Vitals and check-in | bones, heart, lungs, whole_body | `cl5yvqkq12sp901o6b5jm8r9v.pdf` |
| MR081L | Physical Fitness Evaluation: Handgrip Dynamometry Testing | P4 | Brain, cabin and integration, Vitals and check-in | bones, heart, lungs, whole_body | `cl5yvqkq12spa01o66uwvamtq (1).pdf` |
| MR087L | EVA Exercise Pre-breathe Protocol for ISS Crewmembers | P4 | Brain, cabin and integration, Vitals and check-in | bones, heart, lungs, whole_body | `cl5yvqkq12spf01o69ijggvi1.pdf` |
| MR090L | In-Suit Light Exercise Prebreathe Protocol for ISS Crewmembers | P4 | Brain, cabin and integration, Vitals and check-in | bones, heart, lungs, whole_body | `cl5yvqkq12spl01o6hq2f8mtb.pdf` |
| MEDB 1.15 | MRI Brain and MR Angiography | P6 | Body model and zones | whole_body | `cl5yvqhsu2sm601o63pq856v2 (1).pdf` |
| MEDB 1.3 | Private Medical Conference | P6 | Vitals and check-in, Wellbeing | head, whole_body | `cl5yvqhsu2smc01o6eoqi9t79.pdf` |
| MEDB 2.2 | H. Pylori Testing | P6 | Brain, cabin and integration | - | `cl5yvqhsu2slj01o66jb8eug0.pdf` |
| MEDB 2.4 | Methicillin Resistant Staphylococcus aureus (MRSA) Nasal Screen and Suppression | P6 | Brain, cabin and integration | gut, lungs, whole_body | `cl5yvqhsu2smq01o6e0iuarrg.pdf` |
| MEDB N3.06 | Nutritional Assessments | P6 | Body model and zones | bones, whole_body | `cl5yvqhsv2snb01o6frdnbitl.pdf` |
| MR008L | Toxicological Assessment Using Compound Specific Analyzer-Combustion Products (CSA-CP) | P6 | Brain, cabin and integration | lungs | `cl5yvqhsv2snr01o6bdgm7mew (1).pdf` |
| MR014S | Eye Examinations | P6 | Body model and zones, Brain, cabin and integration | eyes, lungs, whole_body | `cl5yvqkq02snz01o66btg9mq7 (1).pdf` |
| MR017S | Private Medical Conferences (PMCs) for Shuttle | P6 | Brain, cabin and integration, Wellbeing | head, lungs, whole_body | `cl5yvqkq02so101o6binl4s1e.pdf` |
| MR021S | Crew Microbiology | P6 | Brain, cabin and integration, Vitals and check-in | gut, lungs, whole_body | `cl5yvqhsu2sl901o66sic04fe.pdf` |
| MR022S | Shuttle Environmental Microbiology | P6 | Brain, cabin and integration | gut | `cl5yvqkq02so401o6gbgs2bta.pdf` |
| MR025L | Postflight Medical Status Checks | P6 | Vitals and check-in | whole_body | `cl5yvqkq02so601o608bn5w9j.pdf` |
| MR029L | Pre- and Postflight Pulmonary Assessment | P6 | Vitals and check-in | lungs | `cl5yvqkq02soa01o6derp3rgj.pdf` |
| MR036L | Toxicological Assessment Using Grab Sample Container | P6 | Brain, cabin and integration | lungs | `cl5yvqkq02sok01o6bazt7csv.pdf` |
| MR039L | Toxicological Assessment Using the Carbon Dioxide Monitor Kit (CDMK) | P6 | Brain, cabin and integration | lungs, whole_body | `cl5yvqkq02soo01o65jzy9pdr (1).pdf` |
| MR042S | Functional Neurological Assessment (Pre- and Postflight) for Short Duration Crewmembers | P6 | Body model and zones, Face and voice | head, whole_body | `cl5yvqkq02sor01o6d84j7zbt (1).pdf` |
| MR043S | Shuttle Air Quality Monitoring | P6 | Brain, cabin and integration | lungs | `cl5yvqkq02sos01o6fpe73y3d.pdf` |
| MR050L | Microbial Analysis of ISS Surfaces Using the Surface Sampler Packet Assembly | P6 | Brain, cabin and integration | gut, lungs, whole_body | `cl5yvqkq02sow01o61ybvfwpk (1).pdf` |
| MR054L | ISS Potable Water Quality Monitoring | P6 | Brain, cabin and integration | gut, lungs | `cl5yvqkq12sp501o695vo3bf3.pdf` |
| MR091L | Toxicological Assessment Using the Air Quality Monitor (AQM) | P6 | Brain, cabin and integration | lungs | `cl5yvqkq12spm01o608vcf2vf.pdf` |
