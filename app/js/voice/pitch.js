// Voice features. Pure: tested with node --test.

/** Pitch by normalised autocorrelation over 70-400 Hz. Returns Hz or null if unvoiced. */
export function estimatePitch(samples, sampleRate, minHz = 70, maxHz = 400) {
  const n = samples.length;
  if (n < sampleRate / minHz * 2) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += (samples[i] - mean) ** 2;
  if (energy / n < 1e-6) return null;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(Math.ceil(sampleRate / minHz), n - 1);
  const corr = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1 && lag < n; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = samples[i] - mean, b = samples[i + lag] - mean;
      s += a * b; e1 += a * a; e2 += b * b;
    }
    corr[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
  }
  // first strong peak (avoids octave errors from picking a later multiple)
  let best = -1, bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) if (corr[lag] > best) { best = corr[lag]; bestLag = lag; }
  if (best < 0.5) return null;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corr[lag] > 0.9 * best && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) { bestLag = lag; break; }
  }
  // parabolic interpolation around the peak
  const y0 = corr[bestLag - 1] ?? corr[bestLag], y1 = corr[bestLag], y2 = corr[bestLag + 1] ?? corr[bestLag];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
  return sampleRate / (bestLag + shift);
}

/** Median pitch over frames of an utterance. */
export function medianPitch(samples, sampleRate, frameSec = 0.04, hopSec = 0.02, rmsGate = 0.01) {
  const fl = Math.round(frameSec * sampleRate), hop = Math.round(hopSec * sampleRate);
  const vals = [];
  for (let i = 0; i + fl <= samples.length; i += hop) {
    const f = samples.subarray ? samples.subarray(i, i + fl) : samples.slice(i, i + fl);
    if (rms(f) < rmsGate) continue;
    const p = estimatePitch(f, sampleRate);
    if (p) vals.push(p);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

export function rms(f) {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s / Math.max(1, f.length));
}

/** Seconds of voiced audio: frames above an energy gate. */
export function talkTime(samples, sampleRate, frameSec = 0.03, gate = 0.015) {
  const fl = Math.round(frameSec * sampleRate);
  let voiced = 0;
  for (let i = 0; i + fl <= samples.length; i += fl) {
    if (rms(samples.subarray ? samples.subarray(i, i + fl) : samples.slice(i, i + fl)) >= gate) voiced++;
  }
  return voiced * frameSec;
}
