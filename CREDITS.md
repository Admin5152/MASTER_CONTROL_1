# Credits and licences

Show these on the About panel (in the app) and in the presentation.

## Data and science

| What | Source | Licence / terms |
|---|---|---|
| Space weather: GOES proton flux, NOAA space weather scales | NOAA Space Weather Prediction Center (services.swpc.noaa.gov) | US Government work, public domain |
| Storm replay dates | NASA DONKI (api.nasa.gov) | US Government work |
| Thresholds, hazards, eye-change statistic, radiation limits | NASA-STD-3001, OCHMO technical briefs, NASA Human Research Program, NTRS; clinical references (CDC, AHA, ADA, MedlinePlus, OSHA) | cited per value in `shared/thresholds.json`, `shared/facts.json`, `shared/SOURCES.md` |
| NASA monitoring practice (EIMO, Reaction Self Test, Standard Measures, PHS exam, sleep study) | NTRS 20240001402, 20090029851, 20180002943; NASA-STD-3001; PMC8919197 | cited in `design/NASA_MONITORING_RESEARCH.md` and in the app |
| Sentinel Skin design basis | CSA Astroskin; MIT bioadhesive ultrasound (Science 2022, via NIH); npj Microgravity 2022 ocular review | cited on the Sentinel Skin screen and in `shared/facts.json` |
| Medical kit categories (illustrative, SIM) | NASA ISS Medical Kit Checklist (2015 release) | US Government work |

## 3D, images and sound

| What | Source | Licence |
|---|---|---|
| Planet textures (Sun, planets, Moon, Earth day/night/clouds, Saturn ring, stars) | Solar System Scope, based on NASA imagery | CC BY 4.0: "Planet textures: Solar System Scope (CC BY 4.0), based on NASA imagery" |
| Anatomy (bones, organs, vessels; 18 systems) | BodyParts3D, (c) The Database Center for Life Science (DBCLS) | CC BY 4.0 (older files state CC BY-SA 2.1 Japan). Lungs are generated to fit the ribcage (no lung tissue in the dataset) |
| Human bodies (male, female) | MakeHuman / MPFB base mesh | CC0 |
| Organ thumbnails, race ship, gates, power-ups, asteroids | made for Sentinel in Blender 5.2 (`tools/anatomy/render_organs.py`, `tools/game/make_game_assets.py`) | ours; organ renders derive from BodyParts3D (CC BY 4.0) |
| Fonts: Inter, Michroma | Google Fonts | SIL Open Font License 1.1 |

## Voice and AI

| What | Source | Licence / terms |
|---|---|---|
| Primary voice | ElevenLabs (premade voices River, Eric, Sarah, Daniel; flash v2.5 model) | ElevenLabs terms of service (Starter plan) |
| Fallback voice | Kokoro-82M (ONNX via kokoro-onnx) | Apache 2.0 |
| Speech recognition | OpenAI Whisper: whisper-large-v3-turbo on Groq; base.en via faster-whisper / CTranslate2 locally | MIT (model and libraries); Groq terms of service |
| Brain | openai/gpt-oss-120b on Groq | Apache 2.0 (model); Groq terms of service |
| Speaker ID | Resemblyzer | Apache 2.0 |

## Libraries (vendored or installed)

three.js (MIT), GSAP (GreenSock standard licence), Chart.js (MIT), MediaPipe Tasks Vision (Apache 2.0), FastAPI (MIT), uvicorn (BSD), httpx (BSD), numpy (BSD), onnxruntime (MIT), Playwright (Apache 2.0, tests only).

## Reference images

`design/refs/` holds style references collected by the team lead (Dribbble and similar shots, the Kurzgesagt-style art reference). They guided layout and mood only; no image, character or brand from them is used in the app.

## Mars surface texture

- `app/assets/mars/ground_diff.jpg`, `ground_nor_gl.jpg`, `ground_rough.jpg`: "Aerial Ground Rock" by Amal Kumar, Poly Haven (https://polyhaven.com/a/aerial_ground_rock), CC0. Resized from 2K to 1K.
