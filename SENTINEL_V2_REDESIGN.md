# Sentinel v2 — Redesign Brief

Sentinel v1 is built and working (branch `build`, see `README.md` and `SENTINEL_BUILD_SPEC.md`). The backend logic is sound and its tests pass. This brief is a **redesign of the look and of the voice and brain**, not a rewrite of the logic. Read `SENTINEL_BUILD_SPEC.md` too: every rule in its section 2 (honesty labels, change-from-baseline, sourced thresholds, deterministic safety, fallbacks) still applies, and every v1 acceptance test must still pass at the end.

The team lead looked at v1 and said, in effect: it works, but it looks like a generic dashboard. They want it to look like the reference images in `design/refs/`, sound like a real assistant, and answer ordinary questions smoothly. **Open and study every image in `design/refs/` before designing anything.**

Work autonomously. Do not ask questions. Commit on branch `build` after each phase. Do not push and do not add a remote. Do not touch `video/`.

---

## 1. What the references say

| File | Take from it |
|---|---|
| `01-orb-home.png` | The home screen. A glossy, glowing glass sphere with light ribbons wrapping it, floating in deep blue-black. Under it, a small grey greeting ("Hello James") and a large two-line question in a clean sans ("How can I help you today?"). Calm, centred, lots of space. This replaces the v1 orb. |
| `02-space-dashboard.png` | The overall system look. Photographic planets with real lighting and an atmosphere rim, a starfield, thin orbit lines. Large light-weight display type in caps. Small spaced status labels ("SYSTEM STATUS • NOMINAL"). A row of dark glass cards with hairline borders and rounded corners, each with a small caps title and a status at top right. One pale-green accent used sparingly. The team wants the Earth and planets to be **real imagery and to move** (rotate, orbit). |
| `03-body-side-stats.png`, `04-body-front-measure.png` | The body model. A realistic, smooth, matte slate-blue 3D human on a dark navy background with soft studio light. Measurement rings around chest, waist, arms and legs, with the active ring highlighted in blue. Stat cards beside it. Bottom tab bar with simple icons. |
| `05-xray-markers-vitals.png`, `06-xray-callout.png`, `07-medical-dashboard-layout.png` | The diagnostic mode. An X-ray/translucent body where problem points get a **red dot with a white ring and a soft red glow**, connected by a thin red leader line to a callout card (title, date, one-paragraph explanation). Beside the body, a column of vitals cards each with a value, unit, date and a small chart (bar, line, sparkline, area). This is how Sentinel "points to a body part". |
| `08-game-art-style.png` | The game's art direction only: bold, flat, saturated vector illustration of a microscopic world (cells, membranes, nuclei) in purples, magentas, oranges and teal, with thick shapes, soft inner highlights and playful characters. **Make original characters and art in this general style.** Do not copy these specific images, characters or any studio's branding. |

Two looks live side by side and must feel like one product: the **space/system** look (refs 1–2) for home, mission, cabin and radiation, and the **clinical body** look (refs 3–7) for the body, scan and vitals. Share one type system, one set of tokens and the same glass-card component. Only the game (ref 8) breaks into colour, on purpose, because it is the calming escape.

---

## 2. Prepared assets (already on disk — use them, don't re-download)

- `app/vendor/three/` — three.js 0.187.0 (`three.module.js`, `three.core.js`, and `jsm/` with GLTFLoader, OrbitControls, postprocessing, etc.). Use an import map in `index.html` mapping `three` and `three/addons/` to these local files.
- `app/assets/body3d/human.glb` — an athletic male human in an A-pose, generated with MakeHuman/MPFB (CC0 base mesh), 13,380 vertices, about 1.89 m tall, no materials, smooth normals. Use it for the body model. Apply materials in three.js.
- `app/assets/space/` — planet textures from Solar System Scope (CC BY 4.0, built from NASA imagery): `earth_day.jpg` (2k), `earth_day_8k.jpg`, `earth_night.jpg`, `earth_clouds.jpg`, `moon.jpg`, `mars.jpg`, `stars.jpg`. Credit "Planet textures: Solar System Scope (CC BY 4.0), based on NASA imagery" in the README and in an About/credits panel. Use the 2k Earth on tablets and the 8k on the laptop.
- `models/tts/kokoro-v1.0.onnx` and `models/tts/voices-v1.0.bin` — the Kokoro text-to-speech model (Apache 2.0). `kokoro-onnx` 0.6.1 and `soundfile` are already installed in `.venv` and tested: warm synthesis runs at about 0.7× real time on this laptop's CPU. `models/` is git-ignored; document in the README where the files come from.
- `design/voice_samples/` — four sample voices (`af_heart`, `af_nova`, `am_michael`, `bm_george`) for the team to choose from. Default to `af_heart` and make the voice a setting.

---

## 3. The redesign, screen by screen

### 3.1 Design system first

Before any screen, load the `frontend-design`, `ui-ux-pro-max` and `design-system` skills, and the GSAP skills before building transitions. Write `app/css/tokens.css` with the full token set, replacing v1's. Then build one glass-card component, one status pill, one section label, one icon button and one tab bar, and use only those.

- **Colour:** deep space ground (near `#05070d` to `#0a1424` gradient, not flat black), clinical navy for body screens (around `#1b2740` to `#26324d`), white ink at two opacities, one pale mint-green accent (`#b8f5c8`-ish) for "nominal", cyan-blue for the assistant and active states, red `#ff3b4e` with a white ring for alerts only, amber for watch.
- **Type:** vendor the fonts locally as woff2 in `app/assets/fonts/` (download from Google Fonts during setup; nothing loads from the internet at runtime). A light, wide geometric sans for display in caps (for example "Michroma" or "Syncopate" for small labels, and "Inter" or "Manrope" at weight 200–300 for the large display lines), plus Inter for body text. Pick one pairing and record it in `tokens.css`.
- **Glass card:** dark translucent fill, `backdrop-filter: blur`, 1 px hairline border at about 10% white, radius 20–24 px, small caps title top-left, status top-right.
- **Motion:** slow and smooth. Screen changes are camera moves or cross-fades of about 600–900 ms with GSAP, never hard swaps. Respect `prefers-reduced-motion`.

### 3.2 Home: the orb (ref 01)

- Replace the v1 canvas orb with a **three.js glass sphere**: a sphere with a fresnel rim shader in blue-white, inner darkness, and two or three animated light ribbons (thin tubes along curves, additive blending) sweeping around it, with bloom (`UnrealBloomPass`). It should look glossy and alive, like ref 01.
- States: idle (slow drift of the ribbons), listening (ribbons speed up and brighten with microphone level), thinking (ribbons tighten and orbit faster), speaking (sphere pulses with the actual TTS audio level, now possible because TTS audio plays through Web Audio), warning (rim shifts amber or red).
- Under it: "Hello James" in small grey, then the large two-line prompt. When Sentinel speaks, the large line becomes the live caption of what it is saying.
- A frosted input bar at the bottom (as at the bottom of ref 01) with a microphone button and a text field.
- Behind the orb, very faint, the live starfield from 3.3 so home and the mission view feel like one space.

### 3.3 Mission view: real moving Earth (ref 02)

- A three.js scene: Earth with day texture, night-lights texture blended on the dark side, a separate slowly rotating cloud layer, an atmosphere rim glow, lit by a directional "sun"; the Moon on a slow orbit; a starfield sphere from `stars.jpg`; one or two thin orbit lines. Mars appears in the distance or on the radiation screen when the mission profile is a Mars mission.
- Everything moves continuously and slowly. The camera drifts a little. Cap the frame rate and pixel ratio on tablets.
- Overlaid in the ref-02 layout: large light display line (for example "CREW HEALTH. ON BOARD." or the mission name), a "SYSTEM STATUS • NOMINAL" label that reflects the real cabin state, a right-hand column of three stats (crew members, mission day, signal delay to Earth), and a bottom row of glass cards: Crew status, Cabin (O2/CO2, SIM badge), Radiation (live NOAA storm level), Next check-in (routine), and Greenhouse.
- This becomes the dashboard home after the first interaction; the orb stays reachable as the assistant layer that floats over every screen (small in a corner when not in focus, large when talking).

### 3.4 Body: 3D model with X-ray mode and pointing (refs 03–07)

- Load `human.glb` in three.js. Default material: matte slate blue (`MeshStandardMaterial`, roughness about 0.6) with soft key and rim lights, on navy, with a soft floor shadow, like refs 03–04. OrbitControls limited to rotation around the vertical axis and gentle zoom.
- **X-ray mode** (toggle, and automatic during a scan or an alert): switch the body to a translucent fresnel material in pale blue so the inside reads, and show simple internal organs as glowing meshes inside it: brain, eyes, heart, two lungs, stomach/gut, and a spine. Build the organs procedurally in three.js (smoothed spheres and capsules shaped and placed by hand against the GLB's proportions) — they only need to read as organs at a glance, like ref 05.
- **Measurement rings** (ref 04) at chest, waist, upper arms and thighs during the scan, with the active ring highlighted.
- **Pointing** (ref 06): when the brain flags a zone, the camera eases to frame it, the organ glows red, a **red dot with a white ring and red glow** sits on the body surface at the zone (project the 3D anchor to screen space every frame), and a thin red leader line runs to a glass callout card with the zone name, the time, and one or two sentences of change-from-baseline explanation with its LIVE/SIM badge. Multiple flags can show multiple dots (ref 05). Keep the existing Director command bus (`point_to`, `start_scan`, `open_screen`, etc.) and re-implement its visuals here; its tests must still pass.
- **Vitals column** (refs 05, 07): beside the body, a column of glass cards, each with icon, value, unit, timestamp, badge and a small Chart.js chart styled to match (bar for sleep, line for temperature, smoothed line for heart rate, bar-pairs for blood pressure, area for SpO2). Clicking one opens the full trend.
- The full scan sweeps a horizontal light plane down the body, lighting each zone and its ring in turn, then points at the worst zone.

### 3.5 Face scan: mesh style

- On the camera screen, draw MediaPipe's **full face-mesh tessellation** (the 468-landmark triangle mesh, `FaceLandmarker.FACE_LANDMARKS_TESSELATION`) as thin glowing cyan lines over the face, with brighter contours for eyes, lips and face oval, and points at the vertices. Add a slow horizontal scan band moving over the face while the pulse window fills. Pose lines stay, styled to match.
- Show the pulse reading and its quality ring beside the face, and the forehead and cheek sampling regions as faint highlighted patches of the mesh.
- **Use the laptop's built-in webcam by default.** Add a camera picker and a microphone picker in settings (`navigator.mediaDevices.enumerateDevices`), remembered per browser, so the team can choose the PC camera or an external one.

### 3.6 Cabin and radiation

Restyle both in the system look. Radiation shows Earth or Mars (by mission profile) in three.js with the live NOAA storm level as a glowing particle stream hitting the planet's limb, plus the dose passport and storm response from v1.

### 3.7 The game: "Cell Drift" (ref 08)

Re-skin Aurora Run as an original game in the ref-08 art style. Keep every v1 mechanic and test (no-fail, breathing pacer with hold-to-inhale, heart rate widening the path, two-minute session, mood before and after, recovery logging, tilt/drag/arrow steering).

- The player is an original, friendly round cell character with big simple eyes drifting through a bright bloodstream-like channel of flat vector shapes. Breathing in time widens the channel and makes the surrounding cells glow and wave; a calm heart rate turns the palette from magenta-orange to soft teal.
- Draw everything as flat vector shapes on canvas (or SVG for the characters) with bold colours, thick outlines where useful, soft inner highlights, parallax layers of cells and membranes. Original designs only.
- The Orb Calm game keeps its mechanics and moves onto the new three.js orb.

### 3.8 Everything else

Restyle the health log, cognitive check, interventions, greenhouse, hardware slide, demo panel and alert banner with the new components. Keep every LIVE/SIM/DESIGNED badge visible and readable in the new style — restyle the badge, never drop it.

---

## 4. Voice and brain

### 4.1 Listening (speech to text)

v1 uses the browser's `SpeechRecognition`, which needs Google's servers and is weak with accents. Replace it with a server-side pipeline that works offline:

- **Browser:** capture the microphone with Web Audio, run a simple voice-activity detector (energy plus zero-crossing with hangover, tuned on the real microphone level), and cut each utterance (max 15 s). Post the 16 kHz WAV to `/api/stt`. The existing pitch and talk-time measurement and the speaker-ID post use the same capture.
- **Server `/api/stt`:** if `GROQ_API_KEY`/`LLM_API_KEY` is set and online, transcribe with Groq's Whisper endpoint (`whisper-large-v3-turbo`, OpenAI-compatible `/audio/transcriptions`); otherwise transcribe locally with `faster-whisper` (`base.en`, int8, CPU — install it and download the model during setup into `models/whisper/`; verify the model id and API against the package docs). Return `{text, source: "groq" | "local"}`.
- **Wake phrase:** check the transcript for "hey sentinel" and its variants, as in v1. Also: tapping the orb or the mic button starts a single utterance with no wake phrase (push-to-talk), which is the reliable path on stage.
- Keep browser `SpeechRecognition` only as a last fallback if both Whisper paths fail.

### 4.2 Speaking (text to speech)

- **Server `/api/tts`:** synthesise with Kokoro (`models/tts/`, voice from settings, default `af_heart`, `lang` `en-us` for `a*` voices and `en-gb` for `b*` voices). Load the model once at startup in a background thread and warm it with one short sentence.
- **Stream by sentence:** split each reply into sentences and synthesise the first sentence immediately so speech starts within about 1.5 s; queue the rest. Return WAV; cache by (voice, text) on disk for repeated lines such as the demo pack.
- If `ELEVENLABS_API_KEY` is set, use ElevenLabs instead (model `eleven_flash_v2_5` for low latency, voice configurable) and fall back to Kokoro on any error.
- **Browser:** play through Web Audio so the orb's speaking state follows the real audio level. Pause listening while speaking. `speechSynthesis` remains the last fallback.

### 4.3 The brain

The team asked about using **OpenClaw** for the brain. Do not. OpenClaw is a self-hosted personal agent that runs on a computer, connects to messaging apps and acts on the machine; it still needs an LLM underneath, it adds latency and setup, and giving it system access on the demo laptop is a security risk. Sentinel needs a fast conversational model behind a safe rules engine, which it already has. Record this reasoning in the README.

Improve the existing brain instead:

- **Two kinds of question.** Health and mission questions are answered from the crew member's state, exactly as now (numbers only from the state, change from baseline, never a diagnosis, rules engine owns alerts). **General questions** ("how far is Mars?", "tell me a joke", "what's the capital of Ghana?", "explain radiation sickness") are answered naturally and correctly, still briefly (two to four spoken sentences), in Sentinel's calm voice. Update the system prompt to say this explicitly and add tests with a mocked LLM for both kinds.
- **Conversation memory:** keep the last eight turns per crew member in the server and send them with each request, so follow-ups ("and what about yesterday?", "why?") work.
- **Streaming:** stream the LLM response (Groq supports `stream: true`), and feed complete sentences to TTS as they arrive, so the first words are spoken while the rest is still being generated. Commands (`point_to`, `open_screen`, …) still come back as validated JSON; put them in a final structured chunk or a parallel tool call, and keep the v1 validator.
- **Model:** keep it configurable through `.env`. Default `llama-3.3-70b-versatile` on Groq. At setup, if a key exists, call `/models` and, if `openai/gpt-oss-120b` is listed, note it in the README as a stronger option for general knowledge.
- **No key / offline:** the rules bank still answers health and mission questions; for general questions it says plainly that it needs a connection to answer that. Never invent an answer.
- Keep the numeric-grounding guard from v1 for health answers only (general answers may contain numbers that are not in the state).

---

## 5. Build order

| Phase | Work | Box |
|---|---|---|
| A | Study refs; design plan via `frontend-design` two-pass process; tokens, fonts, components; import map for three.js | 0:40 |
| B | Home orb in three.js + assistant layer floating over every screen | 0:45 |
| C | Mission view with real moving Earth, Moon, stars, glass cards | 0:45 |
| D | 3D body: clay + X-ray modes, organs, rings, pointing with dot/leader/callout, scan, vitals column; Director re-wired | 1:15 |
| E | Face-mesh camera screen, device pickers | 0:30 |
| F | Voice: VAD capture, `/api/stt` (Groq Whisper + local faster-whisper), `/api/tts` (Kokoro streaming, ElevenLabs optional), push-to-talk | 0:50 |
| G | Brain: general questions, memory, streaming, tests | 0:40 |
| H | Cell Drift game, Orb Calm on the new orb, restyle remaining screens | 0:50 |
| I | Performance pass for the Samsung tablet, full verification, README, report | 0:35 |

About 7 hours. If you must cut, cut in this order: X-ray organs become simple glowing spheres; measurement rings; radiation particle stream; the 8k Earth. Never cut the pointing callout, the face mesh, the new orb, the real Earth, or the voice pipeline.

---

## 6. Verification and report

- All v1 tests and all new tests pass (`pytest`, `node --test`). Add tests for `/api/stt` (with a short generated WAV of speech from Kokoro, transcribed by local Whisper, checked for key words), `/api/tts` (returns audio, caches), the general-question prompt path and memory (mocked LLM), and the VAD segmenter (pure function on synthetic audio).
- Playwright run at 1366×768, 1024×768 and 768×1024 (use the installed Chrome or Edge with fake media devices, as in v1). Screenshot every screen and state into `tests/screenshots/v2/`, then **look at them yourself and compare them with `design/refs/`**. Fix anything that looks generic, cramped, misaligned or unlike the references before you finish. Check the WebGL scenes render (not black) and hold at least 30 fps on the laptop.
- **Test on a separate port (8444).** The team may have v1 running on 8443 from their own terminal; leave that process alone. In the report, tell them to stop it and start v2 with `run.ps1`.
- Final message: what changed, how to run it, a feature table with labels and verification status, a human checklist (real face mesh on the PC webcam, microphone and wake phrase, voice quality and latency, a general question, a follow-up question, the Samsung tablet), every cut, and every credit the team must show (planet textures CC BY 4.0, Kokoro, MakeHuman CC0, NOAA, NASA). State plainly what you did not verify.

---

## 7. Changes from the team lead (13 Nov evening)

These override the sections above where they conflict.

1. **Light mode is now the default theme.** Clean, futuristic, organised, calm: not too simple, not too techy, no clutter. Refs 06 and 07 (light clinical) are the base, with the space look kept as framed "windows" inside the light UI (the real moving Earth lives in a deep-space card or hero panel, not as the whole page background). Keep a dark theme as a setting, using the same tokens. Everything must feel smooth and solid: consistent spacing, clear hierarchy, every screen organised into a small number of well-grouped sections even when there is a lot of information. When in doubt, show less and put detail one tap away.
2. **Body scan is a mesh scan over the entire body.** During a scan a glowing wireframe (the body's own triangle mesh drawn as lines, e.g. WireframeGeometry/EdgesGeometry overlay or a wireframe shader) sweeps over the full body from head to feet, the solid surface dissolving into mesh as the scan band passes, then resolving into the X-ray view with the organs.
3. **The body is turnable and zoomable** by the user (drag to rotate, pinch/scroll to zoom, smooth damping) and by Sentinel: new Director commands `rotate_body {angle or view: front|back|left|right}`, `zoom_body {zone|reset}` and `xray {on|off}`, usable from the rules engine, the local intent matcher ("turn around", "show my back", "zoom into my chest", "show me the x-ray") and the LLM command whitelist. The pointing sequence rotates to the best view of the zone, zooms in, switches to X-ray, then shows the red dot, leader line and callout. All camera moves eased, never snapping. Tests for the new commands in the validator and intent matcher.
4. **Game: replace Cell Drift with an original space racing game** built with assets made in Blender (5.2, headless `blender -b -P script.py`, GLB exported to `app/assets/game/`, game runs in three.js). The player pilots a sleek racer through a course weaving past planets; each planet type gives its own power-up when you fly through its pickup: Earth = shield, Mars = speed boost, Jupiter = gravity slingshot / magnet that pulls in pickups, Saturn = ring-dash (short dash), Moon = low-gravity float / slow-motion. Race against the clock and 2-3 AI ghost racers on the same track, laps or checkpoint run, clean HUD (position, lap, time, current power-up), smooth controls (keyboard on laptop, tilt or on-screen touch on tablet). Clean, polished menus matching the light/futuristic product style; a beautiful in-race space scene using the real planet textures in `app/assets/space`. Original designs only. Tied to health: offered as the boredom/stress break; log session time and mood before/after as Aurora Run did; optionally a calm heart rate gives a small "focus" handling bonus. Orb Calm stays as the breathing biofeedback game. Replace the Aurora Run tests with tests of the new game's pure logic (power-up effects and durations, lap/checkpoint timing, mood logging). Budget about 1.5 hours; if short, one well-made track with all five power-ups.
5. **A Groq API key is coming**; the team lead will put it in `.env`. Keep building against the no-key fallback; if `.env` appears with a key during the work, use it to verify the LLM and Whisper paths live and report the results.
6. **"Check this part of my body."** The crew member can say or type "check my chest", "check my eyes and my head", "something feels off in my stomach", or tap a zone and press Check. Sentinel runs a focused zone check for each named zone in turn: rotate to the best view, zoom in, run the mesh scan over just that region (wireframe band sweeping the zone, the surface dissolving to mesh), switch to X-ray showing that organ, then give a verdict card and a spoken sentence. The verdict comes only from the state and the rules engine: either "All readings for your heart are within your usual range" with the readings and badges listed, or the change-from-baseline finding with the red dot, leader line and callout, plus the next step. It never diagnoses. If a zone has no data source at all, it says so plainly ("I have no sensor on your stomach yet; log a symptom?"). Add a `check_zone {zones: [...]}` Director command to the validator, intent matcher (with synonyms and multi-zone phrases) and LLM whitelist, with tests.
7. **The wearable: "Sentinel Skin"** (DESIGNED hardware, fed by SIM data in the demo). A wearable that could actually scan the body internally, designed from real, published technologies, each cited in `facts.json` and on the hardware screen:
   - Base-layer smart shirt for ECG, heart rate, breathing rate and volume, blood pressure, SpO2, skin temperature and activity: based on the CSA's Astroskin Bio-Monitor, flown on the ISS (https://asc-csa.gc.ca/eng/sciences/astroskin.asp).
   - Stamp-sized bioadhesive ultrasound patches over the heart, lungs and abdomen for continuous internal imaging (heart chamber motion, lung surface, stomach, bladder, inferior vena cava for fluid shift): based on MIT's bioadhesive ultrasound (BAUS) patch, Science 2022, which imaged organs continuously for 48 hours including during exercise (https://www.nih.gov/news-events/nih-research-matters/ultrasound-imaging-gets-small-wearable). Real limitation: it needs external computing today, hence the pocket compute module.
   - Eye module: closed-eyelid ultrasound patches tracking optic nerve sheath diameter, the early marker linked to SANS. ISS crews already do ocular ultrasound in the Ocular Health study, and a 2022 review says a portable, reliable, non-invasive tool remains an area of need (https://www.nature.com/articles/s41526-022-00228-1.pdf). This is the headline: the wearable fills a gap NASA researchers have named.
   - Pocket compute module that processes on board and links to Sentinel over Bluetooth Low Energy, so nothing waits for Earth.
   In the app: (a) a three.js hardware screen with the 3D body wearing the system, each module placed where it sits, an exploded view on tap, each module's card saying what it measures, the real technology and its source link, and DESIGNED clearly; (b) a "Sentinel Skin" data source in the demo panel feeding simulated module data into the state (labelled SIM · Sentinel Skin), so zone checks show what the wearable would add: simulated ultrasound panels in the callout for the heart (looping echo-style motion on canvas), lungs, and eyes (optic nerve sheath diameter against its reference, with its source). These panels say SIM and must never be confused with live webcam data. Replaces the v1 hardware slide. Budget about 45 minutes; if short, ship the hardware screen and the eye module data first.

**Protection order if time overruns:** pointing / zone check, mesh scan + X-ray, voice pipeline, light-mode polish, racing game, Sentinel Skin screen, then everything else.

---

## 8. Direction reset from the team lead (14 Nov, after seeing the light-mode work in progress)

**This section overrides section 7 item 1 and anything in sections 1–3 that conflicts.** The team lead saw the in-progress light-mode shell and rejected it: the orb sitting inside a framed "window" looked like a cutout, and the overall UI felt odd and busy. New direction, in their words: dark mode because it is in space, cleaner, and **Sentinel handling everything**.

1. **Dark only.** Drop the light theme and the theme setting. Deep space throughout: near-black with a subtle blue depth gradient and the real starfield. One assistant accent (cyan-blue), mint only for "nominal", amber for watch, red with a white ring for alerts.

2. **One continuous world, no windows.** A single full-screen three.js canvas sits behind the whole app and hosts everything 3D: the intro solar system, the Sentinel orb, Earth, the body. Screens are camera moves and cross-fades inside that one world, not separate framed panels. **No 3D content is ever drawn inside a card, frame, rounded box or "window".** The UI is a light HTML layer floating on top of the world.

3. **Sentinel is the interface.** The home screen is Sentinel: the orb large in the centre, the greeting above, the live caption of what it is saying below, and the input bar (mic + text) at the bottom. Nothing else on home except a thin, quiet status line at the top (crew member, mission day, cabin status, radiation level, each a single word or number). No grid of cards on home. When Sentinel opens something (body, vitals, radiation, game, wearable, log), the orb glides aside and shrinks to a corner, the content arrives as a small number of clean floating panels arranged around the 3D subject, and when the user says "go back" or taps the orb, everything returns to Sentinel in the centre. The user should feel they are talking to Sentinel, which shows them things, rather than navigating an app. Keep a minimal way to reach every screen by touch (a small radial or bottom menu that opens from the orb), since voice can fail on stage.

4. **The orb must be solid.** Rendered directly in the full-screen world with no frame or backdrop: a real, glossy, weighty sphere, like ref 01: dark glass body, bright fresnel rim, inner luminous core, light ribbons wrapping it, bloom, and a soft reflection of light on the "floor" or ambient glow so it sits in space rather than on a flat background. Smooth, physically plausible motion: no jitter, eased state changes, the speaking pulse driven by real TTS audio.

5. **Start screen: a cinematic intro.** On load, the camera looks down at the solar system: the Sun with its glow at the centre and the planets (Mercury, Venus, Earth with Moon, Mars, Jupiter, Saturn with its ring, Uranus, Neptune) revolving on faint orbit lines at different speeds, real textures (all now in `app/assets/space/`: `sun.jpg`, `mercury.jpg`, `venus.jpg`, `earth_*.jpg`, `moon.jpg`, `mars.jpg`, `jupiter.jpg`, `saturn.jpg`, `saturn_ring.png` (alpha), `uranus.jpg`, `neptune.jpg`, `stars.jpg`). The camera slowly sweeps in over 5–7 seconds; then the planets dim and drift outward, a point of light appears at the centre and Sentinel's orb forms there with a soft burst, and the greeting fades in: "Hello. I'm Sentinel." A single "Begin" tap (needed to unlock audio, camera and microphone) appears as the orb settles; tapping it makes Sentinel speak its greeting. The intro is skippable with a tap and plays at reduced length with `prefers-reduced-motion`. Scale and speeds are artistic, not to scale; say so nowhere on screen, it is an intro.

6. **Cleaner.** Fewer elements on every screen, generous spacing, one type family for UI plus the light display face for big lines, labels used sparingly. A panel shows at most one main number, one chart and one sentence; detail sits one tap away. Keep every LIVE/SIM/DESIGNED badge, restyled small and quiet but always readable.

7. **Keep everything else from sections 4–7**: the voice and brain work, the mesh scan + X-ray body with rotate/zoom by user and by Sentinel, `check_zone`, the space racing game made with Blender assets, and Sentinel Skin. All of them now live inside this dark, Sentinel-centred world.

**Revised protection order:** intro + solid orb + Sentinel-centred home, pointing / zone check with mesh scan and X-ray, voice pipeline, racing game, Sentinel Skin, everything else.
