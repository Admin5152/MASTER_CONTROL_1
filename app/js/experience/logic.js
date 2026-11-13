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

// ---------------- Aurora Run ----------------
/** Fraction of samples where the finger state matched the pacer (held on "in", lifted on "out"). */
export function breathSync(samples) {
  if (!samples.length) return 0;
  let ok = 0;
  for (const s of samples) if ((s.phase === "in") === !!s.holding) ok++;
  return ok / samples.length;
}

/** Path half-width in 0..1 of the screen: wider when breathing in time and heart rate at or below baseline. */
export function pathWidth(syncRatio, hr = null, baseline = null) {
  let w = 0.18 + 0.22 * Math.max(0, Math.min(1, syncRatio));
  if (hr != null && baseline) w += hr <= baseline ? 0.06 : 0;
  return Math.min(0.46, w);
}

export function moodChange(before, after) {
  if (before == null || after == null) return null;
  return after - before;
}

export function sessionSummary({ moodBefore, moodAfter, startHr, endHr, syncRatio }) {
  return { mood_before: moodBefore, mood_after: moodAfter, mood_change: moodChange(moodBefore, moodAfter),
    start_hr: startHr ?? null, end_hr: endHr ?? null, sync_pct: Math.round((syncRatio || 0) * 100) };
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
