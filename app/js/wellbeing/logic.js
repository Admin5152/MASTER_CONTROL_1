// Pure logic for Orb Calm, Aurora Run, the Greenhouse and the cognitive check.
// No DOM: tested with node --test.

// ---------------- Orb Calm ----------------
export const CALM_HOLD_SEC = 10;
const HUE = { red: 356, amber: 38, blue: 214 };

/** target = baseline or start minus 10%, whichever is lower. */
export function calmTarget(startHr, baseline) {
  const tenPct = startHr * 0.9;
  return baseline ? Math.min(baseline, tenPct) : tenPct;
}

export function createCalm(startHr, baseline, t0 = 0) {
  return { startHr, target: calmTarget(startHr, baseline), t0, belowSince: null, cleared: false, recoverySec: null, endHr: startHr, minHr: startHr };
}

function lerpHue(a, b, f) { const d = ((b - a + 540) % 360) - 180; return (a + d * f + 360) % 360; }

/** Advance the session with a new heart-rate reading at time t (seconds). */
export function updateCalm(s, hr, t) {
  s.endHr = hr;
  s.minHr = Math.min(s.minHr, hr);
  const span = Math.max(1, s.startHr - s.target);
  const p = Math.max(0, Math.min(1, (s.startHr - hr) / span));
  const phase = hr >= s.startHr ? "red" : hr <= s.target ? "blue" : "amber";
  if (hr <= s.target) {
    if (s.belowSince == null) s.belowSince = t;
    if (!s.cleared && t - s.belowSince >= CALM_HOLD_SEC) {
      s.cleared = true;
      s.recoverySec = Math.round(t - s.t0);
    }
  } else s.belowSince = null;
  const hue = p < 0.5 ? lerpHue(HUE.red, HUE.amber, p * 2) : lerpHue(HUE.amber, HUE.blue, (p - 0.5) * 2);
  return {
    phase, progress: p, cleared: s.cleared, recoverySec: s.recoverySec,
    holdSec: s.belowSince == null ? 0 : Math.min(CALM_HOLD_SEC, t - s.belowSince),
    visual: { turbulence: 0.05 + 0.45 * (1 - p), hue, rate: 0.6 + 1.2 * (1 - p) },
  };
}

/** Breathing pacer: 4 s in, 6 s out. */
export function pacer(tSec, inSec = 4, outSec = 6) {
  const cyc = inSec + outSec;
  const x = ((tSec % cyc) + cyc) % cyc;
  return x < inSec ? { phase: "in", frac: x / inSec } : { phase: "out", frac: (x - inSec) / outSec };
}

/** Breathing patterns. steps: [phase, seconds, lung volume at the end of the step 0..1]. */
export const PATTERNS = {
  resonance: { name: "Resonance", bpm: 5.5, blurb: "Even, slow breaths at about 5.5 a minute: the rate that makes the heart rhythm swing the most.", steps: [["in", 5.45, 1], ["out", 5.45, 0]] },
  sigh: { name: "Cyclic sigh", bpm: 6.7, blurb: "Two in-breaths through the nose, then a long, slow out-breath. Lifted mood most in a 2023 Stanford trial.", steps: [["in", 2, 0.75], ["top", 1, 1], ["out", 6, 0]] },
  exhale: { name: "Long exhale", bpm: 6, blurb: "In for 4, out for 6. The longer out-breath is the calming half.", steps: [["in", 4, 1], ["out", 6, 0]] },
  box: { name: "Box", bpm: 3.75, blurb: "In, hold, out, hold, 4 seconds each. Steady and simple under pressure.", steps: [["in", 4, 1], ["hold", 4, 1], ["out", 4, 0], ["rest", 4, 0]] },
};
export const PHASE_WORD = { in: "Breathe in", top: "Sip in again", out: "Breathe out", hold: "Hold", rest: "Hold" };

/** Where in the pattern we are at time t: {phase, frac, left, volume 0..1, index, cycle}. */
export function breathAt(pattern, t) {
  const steps = pattern.steps;
  const cyc = steps.reduce((a, s) => a + s[1], 0);
  const x = ((t % cyc) + cyc) % cyc;
  let acc = 0, prevVol = steps[steps.length - 1][2];
  for (let i = 0; i < steps.length; i++) {
    const [phase, dur, vol] = steps[i];
    if (x < acc + dur || i === steps.length - 1) {
      const frac = Math.min(1, (x - acc) / dur);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * frac);     // eased like a real breath
      return { phase, frac, left: dur - (x - acc), volume: prevVol + (vol - prevVol) * e, index: i, cycle: Math.floor(t / cyc) };
    }
    acc += dur; prevVol = vol;
  }
  return null;
}

/** Summary of a calm session's heart-rate samples [{t, hr}]. */
export function calmSummary(samples, target) {
  const v = samples.filter((s) => Number.isFinite(s.hr));
  if (!v.length) return { start: null, end: null, min: null, drop: null, inTargetS: 0 };
  const head = v.slice(0, Math.min(3, v.length)).map((s) => s.hr), tail = v.slice(-3).map((s) => s.hr);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  let inT = 0;
  for (let i = 1; i < v.length; i++) if (v[i].hr <= target) inT += v[i].t - v[i - 1].t;
  const start = avg(head), end = avg(tail);
  return { start, end, min: Math.min(...v.map((s) => s.hr)), drop: start - end, inTargetS: Math.round(inT) };
}

// ---------------- Mood (shared by the breaks) ----------------
export function moodChange(before, after) {
  if (before == null || after == null) return null;
  return after - before;
}

// ---------------- Greenhouse ----------------
export const GREENHOUSE_MAX = 8;

/** One day passes: a completed routine grows a stage, a missed day wilts at most one, never below zero. */
export function greenhouseDay(stage, completed, max = GREENHOUSE_MAX) {
  if (completed) return Math.min(max, stage + 1);
  return Math.max(0, stage - 1);
}

/** A completed calm session also grows the plant one stage. */
export function greenhouseCalm(stage, max = GREENHOUSE_MAX) { return Math.min(max, stage + 1); }

/** Routine for a day is complete when vitals, cognitive and mood/sleep are all logged. */
export function routineComplete(done) { return !!(done.vitals && done.cognitive && done.log); }

// ---------------- Cognitive check ----------------
/** Median of valid reaction times (false starts excluded). */
export function medianReaction(trials) {
  const v = trials.filter((t) => !t.falseStart && t.ms != null && t.ms > 80 && t.ms < 2000).map((t) => t.ms).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}
