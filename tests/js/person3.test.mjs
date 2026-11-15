// Person 3 Test Suite: SF1 - SF8 Golden Scenarios
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchWake } from "../../app/js/voice/wake.js";
import { matchIntent } from "../../app/js/core/intents.js";
import { PulseTracker } from "../../app/js/vision/rppg.js";
import { classifyBlendshapes, estimateBreathingRate, FaceSystem, EMOTIONS, EMOTION_NOTES, EmotionWindow, faceCropBox, topEmotion } from "../../app/js/vision/face.js";

// SF1: Camera scan in good light gives heart rate with confidence >= 0.6, labelled LIVE
test("SF1: Camera scan in good light gives pulse with confidence >= 0.6", () => {
  const tracker = new PulseTracker(11);
  const fs = 30;
  const f_pulse = 1.2; // 72 bpm
  for (let i = 0; i < fs * 12; i++) {
    const t = i / fs;
    const wave = 0.05 * Math.sin(2 * Math.PI * f_pulse * t);
    tracker.push({ t, r: 120, g: 100 + wave * 100, b: 80 - wave * 50 });
  }
  const est = tracker.estimate();
  assert.ok(est.smoothed !== null, "pulse must be detected");
  assert.ok(Math.abs(est.smoothed - 72) <= 3, `estimated ${est.smoothed} bpm`);
  assert.ok(est.quality >= 0.6, `quality was ${est.quality}, expected >= 0.6`);
});

// SF2: Camera blocked: graceful fallback (quality < 0.35, no false pulse)
test("SF2: Camera blocked yields low confidence and no pulse reading", () => {
  const tracker = new PulseTracker(11);
  const fs = 30;
  // Uniform dark image or static noise
  for (let i = 0; i < fs * 10; i++) {
    tracker.push({ t: i / fs, r: 5, g: 5, b: 5 });
  }
  const est = tracker.estimate();
  assert.equal(est.smoothed, null, "smoothed pulse must be null when blocked");
  assert.ok(est.quality < 0.35, `quality was ${est.quality}, expected < 0.35`);
});

// SF3: 'Hey Sentinel, I have a headache' triggers listening and matches symptom triage flow
test("SF3: 'Hey Sentinel, I have a headache' triggers listening and matches head zone triage", () => {
  const text = "Hey Sentinel, I have a headache";
  const wake = matchWake(text);
  assert.equal(wake.woke, true, "wake phrase must match");
  assert.equal(wake.command, "i have a headache", "command must extract symptom");

  const intent = matchIntent(wake.command);
  assert.ok(intent, "intent must match");
  assert.equal(intent.intent, "check", "intent must be check/triage");
  assert.deepEqual(intent.commands, [{ cmd: "check_zone", zones: ["head"] }], "must check head zone");
});

// SF5: Camera mood off in profile: FaceSystem respects opt-in toggle
test("SF5: Camera mood off in profile disables camera valence and arousal", () => {
  const faceSys = new FaceSystem({ optInMood: false });
  assert.equal(faceSys.optInMood, false);

  const mockBlendshapes = [
    { categoryName: "mouthSmileLeft", score: 0.8 },
    { categoryName: "mouthSmileRight", score: 0.8 },
    { categoryName: "cheekSquintLeft", score: 0.7 },
    { categoryName: "cheekSquintRight", score: 0.7 }
  ];

  faceSys.pushBlendshapes(mockBlendshapes, 1.0);
  assert.equal(faceSys.moodBuffer.length, 0, "moodBuffer must remain empty when opted out");
  assert.equal(faceSys.estimateMood(), null, "estimateMood must return null when opted out");

  // When enabled, mood is computed
  faceSys.setOptInMood(true);
  faceSys.pushBlendshapes(mockBlendshapes, 2.0);
  assert.equal(faceSys.moodBuffer.length, 1);
  const mood = faceSys.estimateMood();
  assert.ok(mood !== null);
  assert.ok(mood.valence > 3.0, `valence ${mood.valence} should be positive (> 3.0)`);
  assert.equal(mood.label, "LIVE");
});

// SF6: Low-confidence pulse reading shown as estimate only
test("SF6: Low-confidence pulse reading has quality < 0.35", () => {
  const tracker = new PulseTracker(11);
  const fs = 30;
  // White noise signal
  for (let i = 0; i < fs * 12; i++) {
    const t = i / fs;
    const noise = Math.random() * 20;
    tracker.push({ t, r: 100 + noise, g: 100 + noise, b: 100 + noise });
  }
  const est = tracker.estimate();
  assert.equal(est.smoothed, null, "noisy signal must not produce smoothed heart rate");
  assert.ok(est.quality < 0.35, "quality must be below confidence threshold");
});

// FACE-2: Breathing rate estimation from pose chest displacement
test("FACE-2: Breathing rate estimation from pose vertical displacement", () => {
  const fs = 10;
  const f_resp = 0.25; // 15 breaths per minute (0.25 Hz)
  const samples = [];
  for (let i = 0; i < fs * 16; i++) {
    const t = i / fs;
    const y = 0.45 + 0.03 * Math.sin(2 * Math.PI * f_resp * t);
    samples.push({ t, y });
  }
  const est = estimateBreathingRate(samples, 10);
  assert.ok(est !== null, "breathing rate must be estimated");
  assert.ok(Math.abs(est.breathing_rate - 15) <= 2, `estimated ${est.breathing_rate} br/min`);
  assert.equal(est.label, "LIVE");
  assert.ok(est.confidence >= 0.5);
});

// FACE-3: the eight HSEmotion classes shown on the face scan
test("EMOTIONS lists the eight HSEmotion classes in model order", () => {
  assert.deepEqual(EMOTIONS, ["Anger", "Contempt", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"]);
});

test("faceCropBox pads the face into a square and stays inside the frame", () => {
  const lm = [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.5, y: 0.7 }];
  const box = faceCropBox(lm, 640, 480);
  // face is 128 x 192 px; padded by 20% each side -> 269 px square centred on (320, 240)
  assert.equal(box.size, 269);
  assert.ok(Math.abs(box.x + box.size / 2 - 320) <= 1 && Math.abs(box.y + box.size / 2 - 240) <= 1);
  // a face at the edge is clamped, a huge face is limited to the frame, no landmarks gives null
  const edge = faceCropBox([{ x: 0.0, y: 0.0 }, { x: 0.2, y: 0.3 }], 640, 480);
  assert.ok(edge.x === 0 && edge.y === 0);
  const big = faceCropBox([{ x: 0, y: 0 }, { x: 1, y: 1 }], 640, 480);
  assert.deepEqual(big, { x: 80, y: 0, size: 480 });
  assert.equal(faceCropBox([], 640, 480), null);
  assert.equal(faceCropBox(lm, 0, 0), null);
});

test("EmotionWindow: rolling mean of the last five replies, nothing reported before three", () => {
  const win = new EmotionWindow(5, 3);
  assert.equal(win.mean(), null);
  win.push({ Happiness: 0.9, Neutral: 0.1 });
  assert.equal(Object.keys(win.mean()).length, 8, "all eight emotions are always present");
  assert.equal(win.mean().Anger, 0);
  assert.equal(win.ready, false, "one frame is never enough");
  win.push({ Happiness: 0.9, Neutral: 0.1 });
  assert.equal(win.ready, false);
  win.push({ Anger: 1 });                       // one outlier frame
  assert.equal(win.ready, true);
  assert.deepEqual(topEmotion(win.mean()).name, "Happiness", "a single outlier does not flip the top expression");
  assert.ok(Math.abs(win.mean().Happiness - 0.6) < 1e-9);
  for (let i = 0; i < 5; i++) win.push({ Sadness: 1 });
  assert.equal(win.count, 5, "the window keeps only the last five");
  assert.deepEqual(topEmotion(win.mean()), { name: "Sadness", score: 1 });
  win.reset();
  assert.equal(win.count, 0);
  assert.equal(topEmotion(null), null);
});

test("Expression status lines use the agreed wording; opt-out clears gathered mood (SF5)", () => {
  assert.equal(EMOTION_NOTES.noFace, "no face detected");
  assert.equal(EMOTION_NOTES.unavailable, "expression model unavailable");
  assert.equal(EMOTION_NOTES.optOut, "camera mood analysis is off for this profile");
  const fs = new FaceSystem();
  fs.pushBlendshapes([{ categoryName: "mouthSmileLeft", score: 0.8 }], 1.0);
  assert.equal(fs.moodBuffer.length, 1);
  fs.setOptInMood(false);
  assert.equal(fs.moodBuffer.length, 0);
  assert.equal(fs.estimateMood(), null);
});

// Face scan -> record: camera readings become contract patches (breathing rate, expression)
import { CameraLog } from "../../app/js/vision/face.js";

test("CameraLog: a camera breathing reading becomes a vitals patch marked camera", () => {
  const log = new CameraLog();
  const p = log.fromReading({ indicator: "breathing_rate", value: 14.2, source: "camera", label: "LIVE", confidence: 0.7 }, 0);
  assert.deepEqual(p, { vitals: { breathing_rate: 14, sources: { breathing_rate: "camera" } } });
});

test("CameraLog: heart rate, mood scores, manual and low-confidence readings are not written", () => {
  const log = new CameraLog();
  assert.equal(log.fromReading({ indicator: "heart_rate", value: 72, source: "camera", label: "LIVE", confidence: 0.9 }, 0), null);
  assert.equal(log.fromReading({ indicator: "valence", value: 3.2, source: "camera", label: "LIVE", confidence: 0.85 }, 0), null);
  assert.equal(log.fromReading({ indicator: "breathing_rate", value: 14, source: "manual", label: "MANUAL", confidence: 1 }, 0), null);
  assert.equal(log.fromReading({ indicator: "breathing_rate", value: 14, source: "camera", label: "LIVE", confidence: 0.2 }, 0), null);
});

test("CameraLog: the same value is not re-written inside the gap, a new value is", () => {
  const log = new CameraLog({ minGapMs: 5000 });
  const r = (v) => ({ indicator: "breathing_rate", value: v, source: "camera", label: "LIVE", confidence: 0.7 });
  assert.ok(log.fromReading(r(14), 0));
  assert.equal(log.fromReading(r(14), 1000), null);
  assert.ok(log.fromReading(r(15), 2000));
  assert.ok(log.fromReading(r(15), 7000));
});

test("CameraLog: expression becomes state.emotion in lower case with its confidence", () => {
  const log = new CameraLog();
  const p = log.fromEmotion({ emotion: "Happiness", confidence: 0.812, source: "camera", label: "LIVE" }, 0);
  assert.deepEqual(p, { state: { emotion: "happiness", emotion_confidence: 0.81 } });
  assert.equal(log.fromEmotion({ emotion: "Happiness", confidence: 0.6, source: "camera" }, 1000), null);
  assert.equal(log.fromEmotion({ emotion: "Fear", confidence: 0.2, source: "camera" }, 2000), null);
  assert.equal(log.summary({ vitals: { heart_rate: 71.6, sources: { heart_rate: "camera" } } }), "pulse 72 bpm · expression happiness");
  log.reset();
  assert.ok(log.fromEmotion({ emotion: "Happiness", confidence: 0.6, source: "camera" }, 3000));
});
