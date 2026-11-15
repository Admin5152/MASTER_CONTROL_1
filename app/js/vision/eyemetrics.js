// Eye measurements from the face mesh. Pure: tested with node --test (tests/js/eyemetrics.test.mjs).
// Landmarks: MediaPipe Face Landmarker (478 points, iris 468-477), x/y normalised to the camera frame.

const d = (a, b, vw, vh) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);

/** Eye opening (lid gap / eye width) for each eye, and their mean. */
export function eyeOpening(lm, vw = 1, vh = 1) {
  const r = d(lm[159], lm[145], vw, vh) / (d(lm[33], lm[133], vw, vh) || 1);
  const l = d(lm[386], lm[374], vw, vh) / (d(lm[362], lm[263], vw, vh) || 1);
  return { right: r, left: l, mean: (r + l) / 2 };
}

/** Where the irises sit between the eye corners, 0..1 (mean of both eyes): the direction of gaze, left to right. */
export function irisPosition(lm) {
  const r = (lm[468].x - lm[33].x) / ((lm[133].x - lm[33].x) || 1e-6);
  const l = (lm[473].x - lm[362].x) / ((lm[263].x - lm[362].x) || 1e-6);
  return (r + l) / 2;
}

const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

/** Blinks from an eye-opening series [{t: seconds, open}]. A blink is a dip that recovers within 0.6 s; it is
 *  complete when the lids close (below 55% of the usual opening), incomplete when they only half close. */
export function blinks(series) {
  if (series.length < 10) return { count: 0, incomplete: 0, rate: null, open: null };
  const open = quantile(series.map((s) => s.open), 0.75);
  const dipAt = open * 0.8, closed = open * 0.55;
  let count = 0, incomplete = 0, inDip = false, start = 0, min = Infinity;
  for (const s of series) {
    if (!inDip && s.open < dipAt) { inDip = true; start = s.t; min = s.open; }
    else if (inDip) {
      min = Math.min(min, s.open);
      if (s.open >= dipAt) {
        inDip = false;
        const dur = s.t - start;
        if (dur <= 0.6) { if (min < closed) count++; else if (min < open * 0.7) { count++; incomplete++; } }
      }
    }
  }
  const minutes = (series[series.length - 1].t - series[0].t) / 60;
  return { count, incomplete, rate: minutes > 0 ? count / minutes : null, incompleteShare: count ? incomplete / count : 0, open };
}

/** Resample [{t, v}] to a uniform 30 Hz grid. */
function uniform(series, key, fs = 30) {
  const t0 = series[0].t, t1 = series[series.length - 1].t, n = Math.floor((t1 - t0) * fs) + 1, out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fs;
    while (j < series.length - 2 && series[j + 1].t < t) j++;
    const a = series[j], b = series[j + 1] || a, span = b.t - a.t || 1;
    out[i] = a[key] + (b[key] - a[key]) * Math.min(1, Math.max(0, (t - a.t) / span));
  }
  return out;
}

/** Smooth pursuit: how closely the gaze follows the dot. Returns {corr 0..1, lag_ms}. The eyes trail the target a
 *  little, so the best match over 0-400 ms of lag is used; blinks are left out (their samples are dropped). */
export function pursuit(series, fs = 30) {
  const s = series.filter((x) => x.iris != null && x.dot != null && !x.blink);
  if (s.length < 30) return { corr: null, lag_ms: null };
  const dot = uniform(s, "dot", fs), eye = uniform(s, "iris", fs);
  let best = { corr: 0, lag: 0 };
  for (let lag = 0; lag <= Math.round(0.4 * fs); lag++) {
    const n = dot.length - lag;
    if (n < 20) break;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += dot[i]; mb += eye[i + lag]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const a = dot[i] - ma, b = eye[i + lag] - mb; sab += a * b; saa += a * a; sbb += b * b; }
    const c = Math.abs(sab / (Math.sqrt(saa * sbb) || 1));   // the sign depends on the camera mirroring, not on the eyes
    if (c > best.corr) best = { corr: c, lag };
  }
  return { corr: Math.round(best.corr * 1000) / 1000, lag_ms: Math.round((best.lag / fs) * 1000) };
}
