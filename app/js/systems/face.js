// Person 3: Face, AI Model & Voice System (FACE-1 .. FACE-4, SF1, SF2, SF5, SF6).
// Handles MediaPipe face mesh (468 landmarks), pose estimation, rPPG pulse extraction,
// breathing rate estimation from chest displacement, and blendshape valence/arousal classification.
// Stage 1: exports drawFaceMesh() so vision.js can call it from its draw() loop.

import { emit, on } from "../core/bus.js";
import { PulseTracker } from "../vision/rppg.js";

/**
 * Stage 1 (FACE-1, SF1): Draw the full 468-landmark triangulated face tessellation
 * plus brighter contour lines for eyes, lips and face oval, using the CSS colour
 * variables already defined in the app (--line, --accent).
 *
 * Called from app/js/vision/vision.js draw() — only the drawing logic lives here;
 * the canvas context and landmark data come from vision.js.
 *
 * @param {CanvasRenderingContext2D} ctx   The overlay canvas 2D context.
 * @param {Array}  lm   FaceLandmarker result: faceLandmarks[0] (468 objects with .x/.y).
 * @param {object} mp   The imported MediaPipe vision_bundle module (provides connection tables).
 * @param {number} W    Canvas pixel width.
 * @param {number} H    Canvas pixel height.
 */
export function drawFaceMesh(ctx, lm, mp, W, H) {
  if (!lm || !mp) return;
  const css = getComputedStyle(document.documentElement);
  const lineC  = css.getPropertyValue("--line").trim()  || "rgba(0,200,255,0.35)";
  const accentC = css.getPropertyValue("--accent").trim() || "rgba(0,220,255,0.75)";

  // ── 1. Full tessellation (thin, semi-transparent) ───────────────────────────
  ctx.save();
  ctx.lineWidth   = 0.55;
  ctx.strokeStyle = lineC;
  ctx.shadowBlur  = 0;              // no extra shadow on 468 triangles (perf)
  ctx.globalAlpha = 0.55;

  if (mp.FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
    ctx.beginPath();
    for (const c of mp.FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
      const a = lm[c.start], b = lm[c.end];
      ctx.moveTo(a.x * W, a.y * H);
      ctx.lineTo(b.x * W, b.y * H);
    }
    ctx.stroke();
  }

  // ── 2. Bright contour lines (eyes, lips, face oval) ─────────────────────────
  ctx.lineWidth   = 1.4;
  ctx.strokeStyle = accentC;
  ctx.shadowColor = accentC;
  ctx.shadowBlur  = 6;
  ctx.globalAlpha = 1.0;

  const CONTOUR_SETS = [
    mp.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
    mp.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
    mp.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
    mp.FaceLandmarker.FACE_LANDMARKS_LIPS,
    mp.FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
    mp.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  ].filter(Boolean);  // guard: not all bundles expose every set

  for (const set of CONTOUR_SETS) {
    ctx.beginPath();
    for (const c of set) {
      ctx.moveTo(lm[c.start].x * W, lm[c.start].y * H);
      ctx.lineTo(lm[c.end].x   * W, lm[c.end].y   * H);
    }
    ctx.stroke();
  }

  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

/** Extract valence and arousal from MediaPipe FaceLandmarker blendshapes (FACE-3). */
export function classifyBlendshapes(categories) {
  if (!categories || !categories.length) return null;
  const map = {};
  for (const c of categories) {
    map[c.categoryName || c.displayName] = c.score;
  }

  const smile = ((map["mouthSmileLeft"] || 0) + (map["mouthSmileRight"] || 0)) * 0.5;
  const cheek = ((map["cheekSquintLeft"] || 0) + (map["cheekSquintRight"] || 0)) * 0.5;
  const positive = (smile * 0.7) + (cheek * 0.3);

  const frown = ((map["mouthFrownLeft"] || 0) + (map["mouthFrownRight"] || 0)) * 0.5;
  const browDown = ((map["browDownLeft"] || 0) + (map["browDownRight"] || 0)) * 0.5;
  const negative = (frown * 0.6) + (browDown * 0.4);

  // Raw valence in [-1.0, +1.0], mapped to 1..5 mood scale
  const rawValence = Math.max(-1.0, Math.min(1.0, positive - negative));
  const valence = Math.round((3.0 + 2.0 * rawValence) * 10) / 10;

  // Arousal: eye wide, jaw open, brow inner up (activation vs calmness)
  const eyeWide = ((map["eyeWideLeft"] || 0) + (map["eyeWideRight"] || 0)) * 0.5;
  const jawOpen = map["jawOpen"] || 0;
  const browUp = map["browInnerUp"] || 0;
  const arousal = Math.round(Math.min(1.0, eyeWide * 0.4 + jawOpen * 0.3 + browUp * 0.3) * 100) / 100;

  return { valence, arousal, rawValence };
}

/** The eight HSEmotion classes (enet_b0_8_va_mtl), in the model's output order. */
export const EMOTIONS = ["Anger", "Contempt", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"];

/** Square crop around the face in video pixels, padded and clamped to the frame. Pure.
 *  `landmarks` are MediaPipe normalised points (0..1). Returns {x, y, size} or null. */
export function faceCropBox(landmarks, vw, vh, pad = 0.2) {
  if (!landmarks || !landmarks.length || !vw || !vh) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of landmarks) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  const w = (x1 - x0) * vw, h = (y1 - y0) * vh;
  const size = Math.min(Math.max(w, h) * (1 + pad * 2), vw, vh);
  if (!(size >= 16)) return null;
  const cx = (x0 + x1) / 2 * vw, cy = (y0 + y1) / 2 * vh;
  const x = Math.max(0, Math.min(vw - size, cx - size / 2));
  const y = Math.max(0, Math.min(vh - size, cy - size / 2));
  return { x: Math.round(x), y: Math.round(y), size: Math.round(size) };
}

/** Status lines for the Expression panel (FACE-3, FACE-4). */
export const EMOTION_NOTES = {
  cameraOff: "camera off",
  noFace: "no face detected",
  reading: "reading…",
  optOut: "camera mood analysis is off for this profile",
  unavailable: "expression model unavailable",
  unreachable: "expression service not reachable",
};

/** Rolling window over the last `size` model replies. The mean is what the panel shows, so the bars do
 *  not flicker, and nothing is reported until `minCount` replies are in, so one frame never raises a flag. */
export class EmotionWindow {
  constructor(size = 5, minCount = 3) { this.size = size; this.minCount = minCount; this.items = []; }
  push(scores) {
    const row = {};
    for (const name of EMOTIONS) row[name] = Number(scores?.[name]) || 0;
    this.items.push(row);
    while (this.items.length > this.size) this.items.shift();
  }
  get count() { return this.items.length; }
  get ready() { return this.items.length >= this.minCount; }
  /** Mean of each emotion over the window, or null when the window is empty. */
  mean() {
    if (!this.items.length) return null;
    const out = {};
    for (const name of EMOTIONS) {
      let sum = 0;
      for (const row of this.items) sum += row[name];
      out[name] = sum / this.items.length;
    }
    return out;
  }
  reset() { this.items = []; }
}

/** The emotion with the highest probability: {name, score}. Pure. */
export function topEmotion(scores) {
  let name = null, score = -1;
  for (const e of EMOTIONS) if ((scores?.[e] ?? -1) > score) { name = e; score = scores[e]; }
  return name ? { name, score } : null;
}

/** Breathing rate estimation from vertical chest displacement samples in pose (FACE-2). */
export function estimateBreathingRate(samples, minWindowSec = 10) {
  if (!samples || samples.length < 30) return null;
  const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
  const duration = t1 - t0;
  if (duration < minWindowSec) return null;

  // Mean center
  let sumY = 0;
  for (const s of samples) sumY += s.y;
  const meanY = sumY / samples.length;

  // Zero-crossing count on smoothed signal (0.15 Hz to 0.5 Hz => 9 to 30 breaths/min)
  let zeroCrossings = 0;
  let prevVal = samples[0].y - meanY;
  for (let i = 1; i < samples.length; i++) {
    const val = samples[i].y - meanY;
    if ((prevVal < 0 && val >= 0) || (prevVal > 0 && val <= 0)) {
      zeroCrossings++;
    }
    prevVal = val;
  }

  // Each full breath cycle has two zero crossings (up and down)
  const cycles = zeroCrossings / 2;
  const rateBpm = Math.round((cycles / duration) * 60);

  if (rateBpm >= 8 && rateBpm <= 32) {
    return {
      breathing_rate: rateBpm,
      confidence: Math.min(0.9, 0.5 + (samples.length / 100) * 0.4),
      label: "LIVE"
    };
  }
  return null;
}

export class FaceSystem {
  constructor(options = {}) {
    this.pulseTracker = new PulseTracker(11);
    this.poseBuffer = [];      // [{ t, y }] for chest movement
    this.moodBuffer = [];      // [{ t, valence, arousal }]
    this.optInMood = options.optInMood ?? true;
    this.lastEstimateTime = 0;
    this.lastGoodPulse = 0;
    this.lastPulse = null;
    this.lastBreathing = null;
    this.lastMood = null;
    this.onReading = options.onReading || (() => {});
  }

  setOptInMood(optIn) {
    this.optInMood = !!optIn;
    if (!this.optInMood) { this.moodBuffer = []; this.lastMood = null; }   // opt-out drops what was gathered
  }

  pushPose(landmarks, nowSec) {
    if (!landmarks || landmarks.length < 13) return;
    // Torso displacement: mid-shoulder y coordinate (landmarks 11 and 12)
    const midY = (landmarks[11].y + landmarks[12].y) / 2;
    this.poseBuffer.push({ t: nowSec, y: midY });
    while (this.poseBuffer.length > 0 && nowSec - this.poseBuffer[0].t > 20) {
      this.poseBuffer.shift();
    }
  }

  pushBlendshapes(blendshapes, nowSec) {
    if (!this.optInMood || !blendshapes) return;
    const scores = classifyBlendshapes(blendshapes);
    if (scores) {
      this.moodBuffer.push({ t: nowSec, ...scores });
      while (this.moodBuffer.length > 0 && nowSec - this.moodBuffer[0].t > 15) {
        this.moodBuffer.shift();
      }
    }
  }

  estimatePulse() {
    const est = this.pulseTracker.estimate();
    if (est.smoothed != null && est.quality >= 0.35) {
      const bpm = Math.round(est.smoothed);
      const conf = Math.min(1.0, Math.round(est.quality * 100) / 100);
      this.lastPulse = { heart_rate: bpm, confidence: conf, label: "LIVE" };
      return this.lastPulse;
    }
    return null;
  }

  estimateBreathing() {
    const est = estimateBreathingRate(this.poseBuffer, 10);
    if (est) {
      this.lastBreathing = est;
      return est;
    }
    return null;
  }

  estimateMood() {
    if (!this.optInMood || !this.moodBuffer.length) return null;
    let vSum = 0, aSum = 0;
    for (const m of this.moodBuffer) {
      vSum += m.valence;
      aSum += m.arousal;
    }
    const n = this.moodBuffer.length;
    this.lastMood = {
      valence: Math.round((vSum / n) * 10) / 10,
      arousal: Math.round((aSum / n) * 100) / 100,
      confidence: 0.85,
      label: "LIVE"
    };
    return this.lastMood;
  }

  emitReadings() {
    const pulse = this.estimatePulse();
    if (pulse) {
      emit("reading.added", {
        indicator: "heart_rate",
        value: pulse.heart_rate,
        source: "camera",
        label: pulse.label,
        confidence: pulse.confidence
      });
      emit("vision:hr", pulse.heart_rate);
    }

    const br = this.estimateBreathing();
    if (br) {
      emit("reading.added", {
        indicator: "breathing_rate",
        value: br.breathing_rate,
        source: "camera",
        label: br.label,
        confidence: br.confidence
      });
    }

    const mood = this.estimateMood();
    if (mood) {
      emit("reading.added", {
        indicator: "valence",
        value: mood.valence,
        source: "camera",
        label: mood.label,
        confidence: mood.confidence
      });
      emit("reading.added", {
        indicator: "arousal",
        value: mood.arousal,
        source: "camera",
        label: mood.label,
        confidence: mood.confidence
      });
    }
  }

  reset() {
    this.pulseTracker.reset();
    this.poseBuffer = [];
    this.moodBuffer = [];
    this.lastPulse = null;
    this.lastBreathing = null;
    this.lastMood = null;
  }
}

/**
 * Camera readings -> patches for the crew member's record (the state contract in shared/contract.json).
 * Pure: it only decides what to write and when; the caller sends the patch.
 *   breathing rate -> vitals.breathing_rate, vitals.sources.breathing_rate = "camera"
 *   expression     -> state.emotion, state.emotion_confidence
 * Heart rate is not handled here: vision.js already writes it through patchHr. Valence and arousal
 * have no field in the contract, so they are not written.
 * A value is written when it changes, and re-written every `minGapMs` while it stays the same.
 */
export class CameraLog {
  constructor({ minGapMs = 5000, minConfidence = 0.35 } = {}) {
    this.minGapMs = minGapMs;
    this.minConfidence = minConfidence;
    this.last = {};
  }

  _due(key, value, nowMs) {
    const l = this.last[key];
    if (l && l.value === value && nowMs - l.t < this.minGapMs) return false;
    this.last[key] = { value, t: nowMs };
    return true;
  }

  /** A `reading.added` payload -> patch, or null when there is nothing to write. */
  fromReading(r, nowMs) {
    if (!r || r.source !== "camera" || r.label !== "LIVE" || r.indicator !== "breathing_rate") return null;
    const v = Math.round(Number(r.value));
    if (!Number.isFinite(v) || !((Number(r.confidence) || 0) >= this.minConfidence)) return null;
    if (!this._due("breathing_rate", v, nowMs)) return null;
    return { vitals: { breathing_rate: v, sources: { breathing_rate: "camera" } } };
  }

  /** A `vision:emotion` payload -> patch, or null. */
  fromEmotion(e, nowMs) {
    if (!e || !e.emotion || e.source !== "camera") return null;
    const conf = Math.round((Number(e.confidence) || 0) * 100) / 100;
    if (conf < this.minConfidence) return null;
    const name = String(e.emotion).toLowerCase();
    if (!this._due("emotion", name, nowMs)) return null;
    return { state: { emotion: name, emotion_confidence: conf } };
  }

  /** One line for the face scan page: what is in the record from this scan. */
  summary(state) {
    const parts = [];
    const src = state?.vitals?.sources || {};
    if (src.heart_rate === "camera" && state.vitals.heart_rate) parts.push(`pulse ${Math.round(state.vitals.heart_rate)} bpm`);
    if (this.last.breathing_rate) parts.push(`breathing ${this.last.breathing_rate.value}/min`);
    if (this.last.emotion) parts.push(`expression ${this.last.emotion.value}`);
    return parts.join(" · ");
  }

  /** Forget what was written (camera stopped, signal lost, crew member changed). */
  reset() { this.last = {}; }
}
