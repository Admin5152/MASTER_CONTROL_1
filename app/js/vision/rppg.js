// Remote photoplethysmography (rPPG). Pure: tested with node --test.
// Written from the published POS algorithm (Wang, den Brinker, Stuijk, de Haan, 2017,
// "Algorithmic Principles of Remote PPG", IEEE TBME 64(7)). Green-channel fallback.
// Input: samples [{t: seconds, r, g, b}] of mean skin colour (forehead + cheeks).
// Output: { bpm | null, quality 0..1, method }. No medical accuracy is claimed.

export const BAND = [0.7, 3.0];        // Hz: 42-180 bpm
export const FS = 30;                   // resample rate, Hz
export const MIN_QUALITY = 0.35;        // demo_placeholder (thresholds.json rppg.min_quality)

/** Resample irregular samples onto a uniform grid by linear interpolation. */
export function resampleUniform(samples, fs = FS) {
  const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
  const n = Math.floor((t1 - t0) * fs) + 1;
  const out = { r: new Float64Array(n), g: new Float64Array(n), b: new Float64Array(n) };
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fs;
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j], c = samples[j + 1] || a;
    const span = c.t - a.t || 1;
    const f = Math.min(1, Math.max(0, (t - a.t) / span));
    out.r[i] = a.r + (c.r - a.r) * f;
    out.g[i] = a.g + (c.g - a.g) * f;
    out.b[i] = a.b + (c.b - a.b) * f;
  }
  return out;
}

function mean(a, s = 0, e = a.length) { let m = 0; for (let i = s; i < e; i++) m += a[i]; return m / (e - s); }
function std(a) { const m = mean(a); let v = 0; for (let i = 0; i < a.length; i++) v += (a[i] - m) ** 2; return Math.sqrt(v / a.length); }

/** POS: project temporally normalised RGB onto the plane orthogonal to skin tone, overlap-add. */
export function pos(rgb, fs = FS) {
  const n = rgb.g.length;
  const l = Math.round(1.6 * fs);
  const H = new Float64Array(n);
  const s1 = new Float64Array(l), s2 = new Float64Array(l);
  for (let m = 0; m + l <= n; m++) {
    const mr = mean(rgb.r, m, m + l), mg = mean(rgb.g, m, m + l), mb = mean(rgb.b, m, m + l);
    if (!mr || !mg || !mb) continue;
    for (let k = 0; k < l; k++) {
      const r = rgb.r[m + k] / mr, g = rgb.g[m + k] / mg, b = rgb.b[m + k] / mb;
      s1[k] = g - b;
      s2[k] = -2 * r + g + b;
    }
    const alpha = std(s1) / (std(s2) || 1e-9);
    let hm = 0;
    const h = new Float64Array(l);
    for (let k = 0; k < l; k++) { h[k] = s1[k] + alpha * s2[k]; hm += h[k]; }
    hm /= l;
    for (let k = 0; k < l; k++) H[m + k] += h[k] - hm;
  }
  return H;
}

export function greenSignal(rgb) {
  const mg = mean(rgb.g);
  return Float64Array.from(rgb.g, (g) => -(g / (mg || 1) - 1));
}

/** Remove a linear trend. */
export function detrend(x, fs = FS) {
  const n = x.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const icpt = (sy - slope * sx) / n;
  // Slow drift below 0.7 Hz is rejected by the band-limited spectrum that follows.
  void fs;
  return Float64Array.from(x, (v, i) => v - (slope * i + icpt));
}

/** Power spectrum inside the band on a 1-bpm grid (Hann-windowed DFT). */
export function bandSpectrum(x, fs = FS, band = BAND) {
  const n = x.length;
  const w = Float64Array.from(x, (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  const freqs = [], power = [];
  for (let f = band[0]; f <= band[1] + 1e-9; f += 1 / 60) {
    let re = 0, im = 0;
    const k = (2 * Math.PI * f) / fs;
    for (let i = 0; i < n; i++) { re += w[i] * Math.cos(k * i); im -= w[i] * Math.sin(k * i); }
    freqs.push(f);
    power.push(re * re + im * im);
  }
  return { freqs, power };
}

/** Peak frequency and quality: share of in-band power within +/-0.15 Hz of the peak. */
export function peakOf(spec) {
  const { freqs, power } = spec;
  let pi = 0, total = 0;
  for (let i = 0; i < power.length; i++) { total += power[i]; if (power[i] > power[pi]) pi = i; }
  let near = 0;
  for (let i = 0; i < power.length; i++) if (Math.abs(freqs[i] - freqs[pi]) <= 0.15) near += power[i];
  // refine with parabolic interpolation
  const y0 = power[pi - 1] ?? power[pi], y1 = power[pi], y2 = power[pi + 1] ?? power[pi];
  const d = y0 - 2 * y1 + y2;
  const shift = d !== 0 ? 0.5 * (y0 - y2) / d : 0;
  const f = freqs[pi] + shift / 60;
  return { freq: f, quality: total > 0 ? near / total : 0 };
}

/** Peak plus a quality score. The score is the share of in-band power near the peak, cut to
 *  40% when the two halves of the window disagree on the peak (noise rarely agrees with itself). */
export function analyse(sig) {
  const full = peakOf(bandSpectrum(detrend(sig)));
  const h = Math.floor(sig.length / 2);
  const a = peakOf(bandSpectrum(detrend(sig.slice(0, h))));
  const b = peakOf(bandSpectrum(detrend(sig.slice(h))));
  const agree = Math.abs(a.freq - full.freq) <= 0.12 && Math.abs(b.freq - full.freq) <= 0.12;
  return { freq: full.freq, quality: agree ? full.quality : full.quality * 0.4, agree };
}

export function estimateBpm(samples, { minQuality = MIN_QUALITY, minSeconds = 6 } = {}) {
  if (!samples || samples.length < 30) return { bpm: null, quality: 0, method: "none" };
  const dur = samples[samples.length - 1].t - samples[0].t;
  if (dur < minSeconds) return { bpm: null, quality: 0, method: "none" };
  const rgb = resampleUniform(samples);
  const p = analyse(pos(rgb));
  let best = { ...p, method: "pos" };
  if (p.quality < minQuality) {
    const g = analyse(greenSignal(rgb));
    if (g.quality > p.quality) best = { ...g, method: "green" };
  }
  if (best.quality < minQuality) return { bpm: null, quality: best.quality, method: best.method };
  return { bpm: best.freq * 60, quality: best.quality, method: best.method };
}

/** Keeps a 10-12 s window and smooths the last few good estimates (median). */
export class PulseTracker {
  constructor(windowSec = 11, keep = 5) { this.windowSec = windowSec; this.keep = keep; this.samples = []; this.estimates = []; }
  push(s) {
    this.samples.push(s);
    const cut = s.t - this.windowSec;
    while (this.samples.length && this.samples[0].t < cut) this.samples.shift();
  }
  reset() { this.samples = []; this.estimates = []; }
  estimate(opts) {
    const e = estimateBpm(this.samples, opts);
    if (e.bpm != null) {
      this.estimates.push(e.bpm);
      if (this.estimates.length > this.keep) this.estimates.shift();
      const sorted = [...this.estimates].sort((a, b) => a - b);
      return { ...e, smoothed: sorted[Math.floor(sorted.length / 2)] };
    }
    return { ...e, smoothed: null };
  }
}
