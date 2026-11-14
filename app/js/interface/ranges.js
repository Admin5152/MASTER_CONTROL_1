// Gradient range bars (ref 12): where a reading sits against its sourced bands. Pure, tested with node --test.
// levels come from shared/thresholds.json via /api/assessment: [{severity, above?|below?, kind, source}].

const SEV_RANK = { ok: 0, info: 1, watch: 2, alert: 3 };

/** Severity of a value against a list of levels (the worst level it crosses). */
export function severityAt(levels, v) {
  let sev = "ok";
  for (const l of levels || []) {
    const hit = (l.above != null && v > l.above) || (l.below != null && v < l.below);
    if (hit && (SEV_RANK[l.severity] || 0) > (SEV_RANK[sev] || 0)) sev = l.severity;
  }
  return sev;
}

/** Domain, marker position (0..1) and colour stops for a range bar. Returns null if there are no bands. */
export function rangeBar(levels, value, { samples = 48 } = {}) {
  const cuts = (levels || []).flatMap((l) => [l.above, l.below]).filter((x) => typeof x === "number");
  if (!cuts.length || typeof value !== "number" || !Number.isFinite(value)) return null;
  let lo = Math.min(...cuts, value), hi = Math.max(...cuts, value);
  const span = Math.max(hi - lo, Math.abs(value) * 0.15, 1e-6);   // never a needle-thin scale
  lo -= span * 0.18; hi += span * 0.18;
  if (lo < 0 && Math.min(...cuts, value) >= 0) lo = 0;
  const stops = [];
  let prev = null;
  for (let i = 0; i <= samples; i++) {
    const at = i / samples, sev = severityAt(levels, lo + (hi - lo) * at);
    if (sev !== prev) { if (prev) stops.push({ at, sev: prev }); stops.push({ at, sev }); prev = sev; }
  }
  stops.push({ at: 1, sev: prev });
  return { min: lo, max: hi, pos: Math.min(1, Math.max(0, (value - lo) / (hi - lo))), sev: severityAt(levels, value), stops };
}

/** CSS linear-gradient for a bar, given colours per severity. */
export function gradientCss(stops, colors) {
  return `linear-gradient(90deg, ${stops.map((s) => `${colors[s.sev] || colors.ok} ${(s.at * 100).toFixed(1)}%`).join(", ")})`;
}
