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

## demo_placeholder thresholds
All drift percentages; heart-rate alert 130 and low watch 50; SpO2 alert 90; temperature low watch 36.0; mood watch below 3; fatigue and stress indices; S2 as the shelter-alert level; storm extra dose per hour; lunar dose rate; speaker-ID 0.75 cut-off; rPPG quality cut-off.
