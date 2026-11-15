# Model card: the models inside Sentinel

**Updated:** 15 November 2026 · **Product:** Sentinel (COSMOcare), NASA Space Apps Challenge 2026 ·
**Scope:** an onboard crew-health companion for Earth-Independent Medical Operations

Sentinel uses models to **sense** (camera, microphone) and to **talk** (understand speech, phrase answers, speak).
**No model makes a medical decision.** Urgency levels, protocols, alerts and kit suggestions come from rules and
statistics over each person's own readings (`brain/rules/`, `brain/clinical/`), which can be read line by line ("Why
this?" on every alert). The team trained no models; every model below is used as published.

## 1. The models

| Role | Model | Runs | Used for | If unavailable |
| --- | --- | --- | --- | --- |
| Brain (phrasing) | **Claude Sonnet 5.5** (Anthropic) | Cloud | Phrasing answers; general questions; asking the app to open screens | Groq |
| Brain fallback | **openai/gpt-oss-120b**, gpt-oss-20b, qwen (on Groq) | Cloud | The same, when Claude fails or reaches its spending stop | Offline rules bank |
| Speech to text | **Whisper large-v3** (on Groq) | Cloud | What the crew member said (English) | Whisper base.en on the laptop |
| Speech to text, offline | **Whisper base.en** (faster-whisper, CTranslate2) | Laptop | The same, offline | Browser recognition |
| Text to speech | **ElevenLabs Flash v2.5** (Nathaniel, Jon, Bri, Samara) | Cloud | Sentinel's English voice | Kokoro |
| Text to speech, offline | **Kokoro-82M** (ONNX) | Laptop | The same, offline | Browser voice |
| Local languages | **Khaya AI** (GhanaNLP): speech recognition, translation, speech | Cloud | Twi, Ewe, Ga, Fante, Dagbani, Yoruba ([LANGUAGES.md](LANGUAGES.md)) | Words shown, spoken in English |
| Who is speaking | **Resemblyzer** (GE2E voice embeddings) | Laptop | Matching a voice to an enrolled crew member (cosine similarity ≥ 0.75, a demo placeholder) | Names spoken aloud ("I'm Eliah") |
| Face and pose | **MediaPipe** Face Landmarker and Pose | Browser | Face mesh, eye metrics, breathing from shoulder movement, blendshapes | Manual entry |
| Pulse from the camera | **POS rPPG** (Wang et al. 2017), our implementation | Browser | Pulse estimate from skin colour, with a quality score | Manual entry, worn sensors |
| Expression | **HSEmotion** `enet_b0_8_va_mtl` (ONNX), pretrained by its authors on AffectNet | Laptop | Opt-in mood reading: valence and arousal from a face crop | Self-reported mood |
| Expression, in the browser | MediaPipe **blendshapes** → valence and arousal (`app/js/vision/face.js`) | Browser | A lighter mood estimate | Self-reported mood |

## 2. Intended use, and what is out of scope

- **Intended:** helping a crew member notice change from their own normal, understand it in plain words, follow
  sourced steps, and keep the flight surgeon informed across the delay.
- **Out of scope:** diagnosis, prescribing, dosing, replacing mission emergency procedures, or any decision without
  the crew and flight surgeon. Sentinel is a hackathon build: not validated clinically, not a medical device.

## 3. How the models are kept in check

| Guard | What it does | Where |
| --- | --- | --- |
| **Rules decide** | The model never sets an alert, level, protocol or kit item | `brain/rules/decision.py` |
| **Number check** | Every number in a health answer must be in the crew member's record; one that is not, and the rules reply is used instead, checked sentence by sentence while streaming | `brain/ai/llm.py` `numbers_ok` |
| **Brief by design** | Two sentences, five when asked to explain; no invented mission details | `brain/ai/llm.py` prompts and sentence cap |
| **Validated commands** | A model can only ask for whitelisted app commands; unknown ones are dropped, at most three kept | `validate_commands`, `app/js/core/commands.js` |
| **Safety script** | An urgent wellbeing concern gets a fixed script, never generated text | `brain/rules/safety.py` |
| **Thinking in English** | In a local language, the brain still works in English; Khaya only translates | [LANGUAGES.md](LANGUAGES.md) |
| **Quality gate** | A camera pulse below quality 0.35 is shown as an estimate and cannot raise an alert on its own | `app/js/vision/rppg.js` |
| **No single-frame alerts** | Expression and pulse are smoothed over seconds; one frame never raises anything | `app/js/vision/` |
| **Labels** | Every value is LIVE, MANUAL, SIM or DESIGNED, everywhere it is shown | the whole app |
| **Spending stops** | Claude stops at `CLAUDE_BUDGET_USD`; ElevenLabs at `ELEVENLABS_CHAR_BUDGET` | [CONFIGURATION.md](CONFIGURATION.md) |

## 4. What data leaves the device

| Data | Goes to | When |
| --- | --- | --- |
| Speech audio (English) | Groq (Whisper) | Every utterance the microphone picks up while listening, including speech that turns out not to be for Sentinel (this is how "Hey Sentinel" is found quickly; the team chose speed over keeping it local). Push to talk only (Settings) sends just what you say after a tap. Without a Groq key, speech stays on the laptop |
| Speech audio (local language) | Khaya AI | In a local-language mode |
| The question, recent conversation, and the parts of the record the question needs | Anthropic (Claude), or Groq as the fallback | When the brain answers. General questions get only the name, the screen, the mission mode and day, not the health record |
| Reply text | ElevenLabs; Khaya in a local language | To speak it. Repeated lines come from the cache |
| Camera frames | **Nowhere.** Face mesh, pulse and blendshapes run in the browser. The opt-in expression model gets a face crop over the local network, on the laptop; no image is stored | — |
| Health record | **Stays on the device**, encrypted at rest ([SECURITY.md](SECURITY.md)) | — |

On a mission, each cloud model is replaced by its on-board counterpart (most are already the fallbacks); see
[INTEGRATION.md](INTEGRATION.md#5-how-it-works-in-space).

## 5. Evaluation

Measured results come only from tests in this repository. Anything that needs a real camera, a reference device or
labelled recordings is marked **not yet measured**, and no figure is invented for it.

| What | How | Result |
| --- | --- | --- |
| Number check | Injected answers citing numbers not in the record | All rejected; the rules reply used (pytest) |
| Sentence cap | Health and general replies | At most 2 sentences, 5 when asked to explain (pytest) |
| Command validation | Unknown commands, zones, screens | Dropped (pytest, node --test) |
| Camera pulse quality gate | Low light or motion samples | No estimate below quality 0.35 (node --test) |
| Wake phrase and intents | "Hey Sentinel", names, EVA phrases, language requests | Unit tests (node --test); live false-wake rate not yet measured |
| Brain answer speed | Live, Claude Sonnet 5.5 | First sentence about 1.6 s on a warm connection |
| Speech recognition speed | Live, Groq Whisper | About 0.4 s; the laptop's Whisper 2.6–3.7 s |
| Camera pulse accuracy | Against a pulse oximeter | **Not yet measured** (target: mean error ≤ 3.5 bpm at rest, good light) |
| Breathing rate accuracy | Against a reference | **Not yet measured** (target: ≤ 2 breaths/min) |
| Expression (valence, arousal) | Labelled held-out set | **Not yet measured** |
| Speaker identification | Enrolled crew, room noise | **Not yet measured** |

## 6. Known limits

- **Camera estimates are estimates.** Light, motion, skin tone and cameras vary; nothing here is validated against
  medical devices.
- **Expression models** were trained on Earth faces; spaceflight changes faces (fluid shift). Mood reading is
  opt-in and never raises an alert alone.
- **Language models can be wrong.** That is why they only phrase, and why health numbers are checked.
- **Local-language quality** depends on Khaya; translations of medical wording may be imperfect, so critical
  alerts also play in English.
- **Cloud dependence in the demo.** The brain, fast speech recognition and the voices use cloud services on Earth;
  the offline fallbacks are slower or plainer.
