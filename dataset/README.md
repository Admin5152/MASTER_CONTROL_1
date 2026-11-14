# NASA Spaceflight Medical Dataset & MRID Assignment Directory

**NASA JSC 28913 Medical Requirements Integration Documents (MRIDs)**
This directory contains the clinical standards, monitoring procedures, and baseline physiological thresholds used by NASA for astronaut medical management. The catalog maps all 68 unique documents (94 PDF files including duplicates) to the 6 feature owners.

## Ownership Summary

| Owner | Feature Module | Assigned MRIDs | Focus Area |
| --- | --- | --- | --- |
| **Person 1** | Radiation Awareness | 11 files | Area dosimeters, TEPC, intravehicular monitors, space radiation limits |
| **Person 2** | Body Model & Zones | 19 files | Physical exams, dental, vision/eyes, bone density, body mass, MRI, skin |
| **Person 3** | Face, AI Model & Voice | 2 files | Neurological evaluation, hearing conservation & acoustics |
| **Person 4** | Vitals & Check-in | 17 files | Clinical labs, ECG, exercise treadmill, handgrip, fitness evaluation |
| **Person 5** | Lonely Games & Wellbeing | Research Base | NASA Space Gardening research, HRP Behavioral Health & Performance, isolation analogs |
| **Person 6** | Dataset & Integration | 19 files | Air quality, water quality, toxicology, EVA prebreathe protocols, mission operations |

## How to Use Your Assigned Documents in the Codebase

1. **Extract Reference Ranges:** Open your PDFs and locate normal resting ranges and alarm limits. Place them into `shared/thresholds.json` citing the MRID document number.
2. **Extract Measurement Instructions:** Find the clinical equipment and measurement technique. Place this into `shared/facts.json` under `"how_to_measure"` so astronauts see clear instructions on their screens.
3. **Extract Clinical Rationale:** Extract the physiological risk explanation. Place this into `shared/facts.json` under `"why_it_matters"` linked to NASA HRP risks.
4. **Cite Sources:** Add every referenced MRID to `shared/SOURCES.md`.

### Person 1: Radiation Awareness (11 Documents)

| PDF Filename | Document Title / Description | Confidence | Duplicates in Folder |
| --- | --- | --- | --- |
| `cl5yvqhsu2smt01o6asca5dwu.pdf` | MEDB 3 | medium | None |
| `cl5yvqhsu2smu01o67lseef9a.pdf` | MEDB 3 | medium | None |
| `cl5yvqhsu2smz01o63a5sb3op.pdf` | MEDB 6 | medium | None |
| `cl5yvqhsv2sn901o6h0nsf1lg (1).pdf` | MEDB N3 | medium | cl5yvqhsv2sn901o6h0nsf1lg.pdf |
| `cl5yvqhsv2snf01o6bh09ba10.pdf` | MR004L In-flight Radiation Area Monitoring with Dosimeters    Page 1 of 7       M | medium | None |
| `cl5yvqhsv2snj01o6c5fjglma (1).pdf` | MR004S In-Flight Radiation Monitoring with Passive Dosimeters  MR004S    SM-FI-00 | medium | cl5yvqhsv2snj01o6c5fjglma.pdf |
| `cl5yvqhsv2snl01o60mwu9p6r.pdf` | MR005L In-flight Radiation Monitoring with Tissue Equivalent Proportional Counter | medium | None |
| `cl5yvqhsv2snn01o69ap47uqd.pdf` | MR005S Radiation Monitoring Using Shuttle TEPC for Short Duration Flights | medium | None |
| `cl5yvqkq12spn01o63cg21vbx.pdf` | MR092L In-flight Radiation Monitoring with Radiation Assessment Detector | medium | None |
| `cl5yvqkq12spo01o6gj3x4son.pdf` | MR093L In-flight Radiation Monitoring with Intravehicular Tissue Equivalent Propo | medium | None |
| `cl5yvqkq12spp01o657hgcc75.pdf` | MR094L In-flight Radiation Area Monitoring with Active Radiation Environment Moni | medium | None |

### Person 2: Body Model & Anatomical Zones (19 Documents)

| PDF Filename | Document Title / Description | Confidence | Duplicates in Folder |
| --- | --- | --- | --- |
| `cl5yvqhsu2sl801o6a7fn6v7t.pdf` | MEDB 1 | medium | None |
| `cl5yvqhsu2slb01o685y93vkb.pdf` | MEDB 1 | medium | None |
| `cl5yvqhsu2slc01o676lm0fsz.pdf` | MEDB 1 | medium | None |
| `cl5yvqhsu2slh01o60xjte6mf.pdf` | MEDB 1 | medium | None |
| `cl5yvqhsu2slk01o63c15htp4.pdf` | MEDB 2 | medium | None |
| `cl5yvqhsu2sm101o6fou61gqq.pdf` | MEDB 1.10 Ophthalmology Examination | medium | None |
| `cl5yvqhsu2sm501o67yu9azg9.pdf` | MEDB 1 | medium | None |
| `cl5yvqhsu2sm901o68cdoern1 (1).pdf` | MEDB 1 | medium | cl5yvqhsu2sm901o68cdoern1.pdf |
| `cl5yvqhsu2smd01o61igocemc (1).pdf` | MEDB 1 | medium | cl5yvqhsu2smd01o61igocemc (2).pdf, cl5yvqhsu2smd01o61igocemc.pdf |
| `cl5yvqhsu2smn01o6ad8lewzs (1).pdf` | MEDB 1 | medium | cl5yvqhsu2smn01o6ad8lewzs.pdf |
| `cl5yvqhsv2sn301o600z4bg12 (1).pdf` | MEDB 7 | medium | cl5yvqhsv2sn301o600z4bg12.pdf |
| `cl5yvqhsv2sn401o6cfkvah14.pdf` | MEDB 7 | medium | None |
| `cl5yvqhsv2sn701o6fz3e2432.pdf` | MEDB 7 | medium | None |
| `cl5yvqhsv2snv01o67637aw8j (1).pdf` | MR009S Pre- and Postflight Physical Exam for Short Duration Crews   MR009S    MSD | medium | cl5yvqhsv2snv01o67637aw8j.pdf |
| `cl5yvqkq02sny01o64azp7z3j (1).pdf` | MR013S Audiometry for Shuttle Crews  MR013S    SM-FI-180-R2 Page 1 of 4 Approved | medium | cl5yvqkq02sny01o64azp7z3j.pdf |
| `cl5yvqkq02sof01o6ey5fea1j (1).pdf` | MR032L ISS Private Family Conferences | medium | cl5yvqkq02sof01o6ey5fea1j.pdf |
| `cl5yvqkq12sp801o6a672356o.pdf` | MR076S Photodocumentation of Skin Injuries and Allergic Reactions for Shuttle Cre | medium | None |
| `cl5yvqkq12spc01o65mpk0zwd.pdf` | MR084L Acoustic Monitoring   Countermeasures for Long Duration Flights        Pag | medium | None |
| `cl5yvqkq12spk01o603tkalsp.pdf` | MR089S Annual Medical Examinations  MR089S | medium | None |

### Person 3: Face, AI Model & Voice (2 Documents)

| PDF Filename | Document Title / Description | Confidence | Duplicates in Folder |
| --- | --- | --- | --- |
| `cl5yvqhsu2slg01o6e5za71ti (1).pdf` | MEDB 1 | medium | cl5yvqhsu2slg01o6e5za71ti.pdf |
| `cl5yvqkq02sog01o62avo2o1n.pdf` | MR032S Private Family Conferences | medium | None |

### Person 4: Vitals & Check-in (17 Documents)

| PDF Filename | Document Title / Description | Confidence | Duplicates in Folder |
| --- | --- | --- | --- |
| `cl5yvjgoa2lx801o60p2o7ii6.pdf` | MR010L Clinical Laboratory Testing for Long Duration Flights           MR010L | medium | None |
| `cl5yvqhsu2sm301o64r32h484.pdf` | MEDB 1 | medium | None |
| `cl5yvqhsu2sm401o6bkmf7r9v.pdf` | MEDB 1 | medium | None |
| `cl5yvqhsu2sml01o68wen97cf (1).pdf` | MEDB 1 | medium | cl5yvqhsu2sml01o68wen97cf.pdf |
| `cl5yvqhsu2smp01o6c03eekh2.pdf` | MEDB 2 | medium | None |
| `cl5yvqhsu2smv01o66ubia6sh.pdf` | MEDB 5 | medium | None |
| `cl5yvqhsu2smy01o6h2p9625g (1).pdf` | MEDB 5 | medium | cl5yvqhsu2smy01o6h2p9625g.pdf |
| `cl5yvqhsv2sn201o6dmol41da.pdf` | MEDB 6 | medium | None |
| `cl5yvqhsv2snc01o6d7jx6iah (1).pdf` | Unknown | medium | cl5yvqhsv2snc01o6d7jx6iah (2).pdf, cl5yvqhsv2snc01o6d7jx6iah.pdf |
| `cl5yvqhsv2sno01o650ot7ri1 (1).pdf` | MR006L Exercise Treadmill Test   MR006L    MSD-MO-023   Page 1 of 4 Medical Requi | medium | cl5yvqhsv2sno01o650ot7ri1.pdf |
| `cl5yvqkq02snw01o6d70cd93h.pdf` | MR010S Clinical Laboratory Testing for Short-Duration Flights    MR010S    SM-FI- | medium | None |
| `cl5yvqkq02so701o60z8easal.pdf` | MR026L Postflight Reconditioning Page 1 of 4  Revised 10/01/18           Medical | medium | None |
| `cl5yvqkq12sp901o6b5jm8r9v.pdf` | MR078L Physical Fitness Evaluation  Functional Fitness  MR078L    SM-FI-025-1-R2 | medium | None |
| `cl5yvqkq12spa01o66uwvamtq (1).pdf` | MR081L Physical Fitness Evaluation  Handgrip Dynamometry Testing     MR081L | medium | cl5yvqkq12spa01o66uwvamtq (2).pdf, cl5yvqkq12spa01o66uwvamtq (3).pdf, cl5yvqkq12spa01o66uwvamtq.pdf |
| `cl5yvqkq12spf01o69ijggvi1.pdf` | MR087L EVA Exercise Prebreathe Protocol for ISS Crewmembers   MR087L        SLSDC | medium | None |
| `cl5yvqkq12spl01o6hq2f8mtb.pdf` | MR090L   EVA In-Suit Light Exercise Prebreathe Protocol for ISS Crewmembers | medium | None |
| `cl5yvqkq12spt01o690lx8s30.pdf` | MEDB 5 | medium | None |

### Person 6: Dataset, Core Engine & Integration (19 Documents)

| PDF Filename | Document Title / Description | Confidence | Duplicates in Folder |
| --- | --- | --- | --- |
| `cl5yvqhsu2sl901o66sic04fe.pdf` | Microsoft Word - Finali_MR021ShuttleRev3 | medium | None |
| `cl5yvqhsu2slj01o66jb8eug0.pdf` | MEDB 2 | medium | None |
| `cl5yvqhsu2sm601o63pq856v2 (1).pdf` | MEDB 1 | medium | cl5yvqhsu2sm601o63pq856v2 (2).pdf, cl5yvqhsu2sm601o63pq856v2.pdf |
| `cl5yvqhsu2smc01o6eoqi9t79.pdf` | MEDB 1 | medium | None |
| `cl5yvqhsu2smq01o6e0iuarrg.pdf` | MEDB 2 | medium | None |
| `cl5yvqhsv2snb01o6frdnbitl.pdf` | MEDB N3 | medium | None |
| `cl5yvqhsv2snr01o6bdgm7mew (1).pdf` | MR008L Toxicological Assessment Using Compound Specific Analyzer-Combustion Produ | medium | cl5yvqhsv2snr01o6bdgm7mew.pdf |
| `cl5yvqkq02snz01o66btg9mq7 (1).pdf` | Microsoft Word - MR014S | medium | cl5yvqkq02snz01o66btg9mq7.pdf |
| `cl5yvqkq02so101o6binl4s1e.pdf` | MR017S Private Medical Conferences | medium | None |
| `cl5yvqkq02so401o6gbgs2bta.pdf` | MR022S Shuttle Environmental Microbiology  MR022S    SM-FI-038 Page 1 of 5 Approv | medium | None |
| `cl5yvqkq02so601o608bn5w9j.pdf` | MR025L Postflight Medical Status Checks | medium | None |
| `cl5yvqkq02soa01o6derp3rgj.pdf` | MR029L Pre- and Postflight Pulmonary Assessment    MR029L     SM-FI-018 Page 1 of | medium | None |
| `cl5yvqkq02sok01o6bazt7csv.pdf` | MR036L Toxicological Assessment Using Grab Sample Container | medium | None |
| `cl5yvqkq02soo01o65jzy9pdr (1).pdf` | MR039L Toxicological Assessment Using the Carbon Dioxide Monitor Kit | medium | cl5yvqkq02soo01o65jzy9pdr.pdf |
| `cl5yvqkq02sor01o6d84j7zbt (1).pdf` | MR042S Functional Neurological Assessment | medium | cl5yvqkq02sor01o6d84j7zbt.pdf |
| `cl5yvqkq02sos01o6fpe73y3d.pdf` | MR043S Shuttle Air Quality Monitoring   MR043S    SM-FI-158-R1 Page 1 of 10 Appro | medium | None |
| `cl5yvqkq02sow01o61ybvfwpk (1).pdf` | MR050L Microbial Analysis of ISS Surfaces Using the Surface Sampler Packet Assemb | medium | cl5yvqkq02sow01o61ybvfwpk.pdf |
| `cl5yvqkq12sp501o695vo3bf3.pdf` | MR054L ISS Potable Water Quality Monitoring        Page 1 of 8 Approved 05/23/17 | medium | None |
| `cl5yvqkq12spm01o608vcf2vf.pdf` | MR091L Air Quality Monitor | medium | None |

### Person 5: Lonely Games & Wellbeing Experiences (Evidence Base)

No NASA MRIDs govern entertainment or games directly. Instead, Person 5 builds from the following NASA Human Research Program (HRP) published evidence:

- **NASA Space Gardening & Plant Growth Research:** Evidence that caring for living systems in space directly mitigates isolation, confinement, and monotony. Informs the **Hydroponic Greenhouse** (`app/js/experience/greenhouse.js`).
- **HRP Risk of Behavioral Changes & Psychiatric Disorders:** Establishes the requirement for daily behavioral countermeasures, active mental breaks, and biofeedback-assisted autonomic regulation. Informs **Orb Calm** (`app/js/experience/orbcalm.js`) and **Space Race (Aurora Run)** (`app/js/experience/race/`).
- **Isolation Analog Protocols (HERA, NEK, HI-SEAS):** Operational research showing that self-reported mood tracking before and after breaks helps individuals identify and manage psychological drift.

