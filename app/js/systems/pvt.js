// Psychomotor vigilance test (brief section 10 item 4): a 3-minute reaction test like the ISS Reaction
// Self Test (NTRS 20090029851; NASA Spinoff 2013). Stimuli appear after random 2-10 s waits; outputs are
// mean and median reaction time, lapses (> 500 ms) and false starts, compared with the crew member's own
// baseline. Pure: tested with node --test. A short practice mode (30 s, shorter waits) is for demos.
// Sources: https://ntrs.nasa.gov/citations/20090029851 , https://pmc.ncbi.nlm.nih.gov/articles/PMC8919197

export const PVT = {
  full: { seconds: 180, minWait: 2000, maxWait: 10000 },
  practice: { seconds: 30, minWait: 1000, maxWait: 4000 },
  lapseMs: 500,
  minValidMs: 100,          // faster than this is an anticipation, counted as a false start
  timeoutMs: 30000,
};

/** Wait before the next stimulus: uniform in [minWait, maxWait], from a 0..1 random number. */
export function nextWait(mode, r = Math.random()) {
  const m = PVT[mode] || PVT.full;
  return Math.round(m.minWait + (m.maxWait - m.minWait) * Math.min(1, Math.max(0, r)));
}

/** Classify one response: {ms} (ms since the stimulus) or {early: true} (pressed during the wait). */
export function classify(t) {
  if (t.early || (t.ms != null && t.ms < PVT.minValidMs)) return "false_start";
  if (t.ms == null) return "none";
  return t.ms > PVT.lapseMs ? "lapse" : "valid";
}

/** Summary of a run: mean and median of all on-time responses (lapses included, as in the PVT), lapses, false starts. */
export function summarize(trials) {
  const rts = trials.filter((t) => ["valid", "lapse"].includes(classify(t))).map((t) => t.ms).sort((a, b) => a - b);
  const falseStarts = trials.filter((t) => classify(t) === "false_start").length;
  const lapses = trials.filter((t) => classify(t) === "lapse").length;
  if (!rts.length) return { n: 0, mean: null, median: null, lapses, falseStarts, fastest10: null };
  const mean = Math.round(rts.reduce((a, b) => a + b, 0) / rts.length);
  const m = Math.floor(rts.length / 2);
  const median = rts.length % 2 ? rts[m] : Math.round((rts[m - 1] + rts[m]) / 2);
  const k = Math.max(1, Math.round(rts.length * 0.1));
  const fastest10 = Math.round(rts.slice(0, k).reduce((a, b) => a + b, 0) / k);
  return { n: rts.length, mean, median, lapses, falseStarts, fastest10 };
}

/** Change from the crew member's baseline median (percent; positive = slower). */
export function versusBaseline(summary, baselineMs) {
  if (!summary?.median || !baselineMs) return null;
  return Math.round(((summary.median - baselineMs) / baselineMs) * 1000) / 10;
}

/** The sleep link from PMC8919197: under 6 hours of sleep goes with slower psychomotor speed. */
export function sleepNote(sleepHours) {
  if (typeof sleepHours !== "number") return "";
  return sleepHours < 6
    ? `Last night's sleep was ${sleepHours} hours. In a study of 24 ISS astronauts, nights under 6 hours went with slower reaction speed.`
    : `Last night's sleep was ${sleepHours} hours (6 or more).`;
}
