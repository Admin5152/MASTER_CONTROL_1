# Model Card: Sentinel Face, AI Model & Voice Pipeline (Person 3)

**Version:** 1.0  
**Date:** November 14, 2026  
**Module Owner:** Person 3 (Face, AI Model & Voice)  
**Challenge:** NASA Space Apps Challenge 2026 — *Create Health Monitoring Software for Astronauts on Space Missions*  
**Operational Scope:** Onboard Earth-Independent Medical Operations (EIMO)

---

## 1. Model Overview

The Sentinel Person 3 pipeline integrates non-invasive computer vision, physiological signal processing, edge machine learning, and acoustic modeling to capture health indicators from face and voice without physical probes:

1. **rPPG Pulse Extraction**: Forehead & cheek region of interest (ROI) color channel analysis using the Plane-Orthogonal-to-Skin (POS) algorithm (Wang et al., 2017) with Green-channel fallback, producing continuous heart rate estimates labelled `LIVE` alongside a confidence metric (0.0 to 1.0).
2. **Breathing Rate Estimation**: Thoracic cage displacement tracker using MediaPipe Pose landmarks (left/right shoulder elevation and vertical torso oscillation).
3. **Facial Blendshape Expression & Affect Classifier**: 52-blendshape feature extractor mapping action units to continuous Valence (pleasantness/unpleasantness, mapped to 1.0–5.0 mood dimension) and Arousal (physiological activation 0.0–1.0).
4. **Speech-to-Text (STT)**: High-accuracy Groq Whisper API pipeline paired with local offline CTranslate2 `faster-whisper` (`base.en`) fallback worker.
5. **Text-to-Speech (TTS)**: ElevenLabs API primary voice (River) with local offline Kokoro-v1.0 ONNX fallback and browser Web Speech API safety net.
6. **Voice Activity Detection & Wake Word**: Energy/zero-crossing based VAD with phonetic fuzzy matcher for *"hey Sentinel"*.
7. **Speaker Identification**: Voiceprint embedding and cosine similarity identification via Resemblyzer (GE2E loss).
8. **Brain LLM Card Rephraser**: Calm onboard conversational assistant with a strict deterministic numeric guard preventing hallucinated medical facts, doses, or diagnoses.

---

## 2. Intended Use & Boundaries

- **Intended Use**: Non-invasive self-assessment and trend tracking for astronauts during long-duration transit and surface operations.
- **Out of Scope & Prohibited Use**: Does not provide autonomous diagnostic declarations or prescribe medical dosages without flight surgeon oversight.
- **Opt-in Privacy Requirement (FACE-4)**: Facial expression analysis and webcam mood tracking are strictly **opt-in per crew profile**. If opted out, the system defaults to self-reported check-ins and acoustic prosody (pitch/talk time).

---

## 3. NASA Medical Requirements Integration Documents (MRIDs)

The pipeline is grounded in two key NASA Human Research Program medical requirements:

### 3.1 NASA Neurological Assessment MRID
- **Application**: Informs the behavioral, cognitive, and affective monitoring framework.
- **Design Impact**: Neurological baseline tracking integrates facial symmetry, subtle motor agitation (arousal), and cognitive reaction stability. The system treats a deviation from personal baseline as a signal for supportive check-ins (e.g. Orb Calm or flight surgeon packet).

### 3.2 NASA Hearing Conservation MRID
- **Application**: Informs acoustic thresholds, signal-to-noise ratio (SNR) requirements, and speech intelligibility in spacecraft cabins.
- **Design Impact**:
  - Voice output volume is capped to prevent auditory fatigue in noisy ECLSS environments (~60 dBA ambient cabin noise).
  - VAD incorporates adaptive noise spectral floor subtraction to filter background ventilation hiss and pump cycles.
  - Push-to-talk (PTT) mode is provided as an immediate override when ambient acoustic interference degrades wake phrase detection.

---

## 4. Training Data & Affect Calibration

The blendshape expression classifier was trained and calibrated using:
- **FER2013 & AffectNet Subsets**: Annotated facial expression benchmarks mapped to continuous circumplex valence/arousal dimensions.
- **Team & Analog Simulation Samples**: Neutral, fatigued, microgravity fluid-shift simulated expressions (puffy-face puffiness normalization).
- **Temporal Windowing**: 10-second moving average boxcar filter. A transient expression in a single frame **never** raises an alert.

---

## 5. Quantitative Evaluation & Held-Out Performance

> **Note:** Held-out benchmark evaluations for rPPG, breathing rate, and valence/arousal
> require a real camera and labelled physiological ground-truth recordings that cannot be
> collected in a simulation-only environment. The numbers below marked **[PENDING]** are
> placeholders — they represent the pass criteria the system is designed to meet, not
> measured results. They will be replaced with real measurements when access to a camera,
> reference monitor (e.g. pulse oximeter), and annotated expression dataset is available.

| Metric / Task | Benchmark / Condition | Measured Performance | Pass Criteria |
|---|---|---|---|
| **Heart Rate (rPPG)** | Normal ambient light (300–600 lux), stationary | **[PENDING — camera test required]** | MAE ≤ 3.5 bpm |
| **Heart Rate (rPPG)** | Low lighting (< 100 lux) or motion | Yields `reading...` (Confidence < 0.35) — **verified in JS unit test (SF6 ✅)** | No false alerts |
| **Breathing Rate** | Pose shoulder displacement (10–25 bpm) | **[PENDING — camera test required]** | MAE ≤ 2.0 breaths/min |
| **Valence (Mood)** | Blendshape held-out expression set | **[PENDING — camera test required]** | RMSE ≤ 0.25 (1–5 scale) |
| **Arousal** | Blendshape activation held-out set | **[PENDING — camera test required]** | RMSE ≤ 0.25 (0–1 scale) |
| **Wake Word Precision** | "Hey Sentinel" intent path in `matchIntent()` | **Verified via JS unit test (SF3 ✅)** — live mic test needed for false-wake rate | Zero false wakes on general talk |
| **Card Rephraser Length** | Brain recommendation cards (levels 1/2/3) | **≤ 2 sentences — verified in pytest (SF7 ✅)** | Never > 2 sentences |
| **Numeric Guard** | Hallucinated vital values injection in test | **100% rejected & fell back to rules — verified in pytest (SF4 ✅)** | Zero unverified numbers |

---

## 6. Ethical, Safety & Human Factors Considerations

1. **Honesty Labels**: Every sensor extraction carries an explicit provenance badge (`LIVE` for real camera/microphone, `SIM` for simulated feeds).
2. **Confidence Gate**: Readings below 0.35 confidence are displayed as provisional estimates and suppressed from triggering autonomous intervention alerts.
3. **Local Edge Compute**: MediaPipe and Web Audio run entirely client-side via WebAssembly/WebGPU. No raw video frames or voice recordings are transmitted to external servers.
