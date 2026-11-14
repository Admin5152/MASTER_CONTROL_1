// Trend charts with Chart.js (vendored). One series per chart, one y-axis, baseline as a dashed
// line and threshold bands drawn behind the data by a small inline plugin.
import { api } from "../core/api.js";
import { badgeHTML, esc } from "./readings.js";

export const METRIC_DEFS = {
  heart_rate: { field: "vitals.heart_rate", label: "Heart rate", unit: "bpm", th: "vitals.heart_rate", base: (s) => s.baseline.heart_rate },
  breathing_rate: { field: "vitals.breathing_rate", label: "Breathing rate", unit: "/min", th: "vitals.breathing_rate" },
  spo2: { field: "vitals.spo2", label: "SpO2", unit: "%", th: "vitals.spo2" },
  bp: { field: "manual.bp_systolic", label: "Systolic blood pressure", unit: "mmHg", th: "manual.bp_systolic" },
  glucose: { field: "manual.glucose_mgdl", label: "Blood glucose", unit: "mg/dL", th: "manual.glucose_mgdl" },
  temp: { field: "manual.temp_c", label: "Body temperature", unit: "°C", th: "manual.temp_c" },
  sleep: { field: "manual.sleep_hours", label: "Sleep", unit: "hours", th: "manual.sleep_hours" },
  sleep_quality: { field: "manual.sleep_quality", label: "Sleep quality", unit: "1-5", th: "manual.sleep_quality" },
  exercise: { field: "manual.exercise_minutes", label: "Exercise", unit: "minutes", th: "manual.exercise_minutes" },
  hydration: { field: "manual.hydration_ml", label: "Fluids", unit: "mL", th: "manual.hydration_ml" },
  mood: { field: "manual.mood", label: "Mood", unit: "1-5", th: "manual.mood" },
  reaction: { field: "cognitive.reaction_ms", label: "Reaction time", unit: "ms", base: (s) => s.cognitive.baseline_ms },
  talk_time: { field: "voice.talk_time", label: "Talk time", unit: "s", base: (s) => s.baseline.talk_time },
  pitch: { field: "voice.pitch", label: "Voice pitch", unit: "Hz", base: (s) => s.baseline.pitch },
  o2: { field: "cabin.oxygen_pct", label: "Cabin oxygen", unit: "%", th: "cabin.oxygen_pct" },
  co2: { field: "cabin.co2_ppm", label: "Cabin CO2", unit: "ppm", th: "cabin.co2_ppm" },
};

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const bandsPlugin = {
  id: "sentinelBands",
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    if (!a) return;
    ctx.save();
    for (const b of opts.bands || []) {
      const top = b.max == null ? a.top : Math.max(a.top, y.getPixelForValue(b.max));
      const bot = b.min == null ? a.bottom : Math.min(a.bottom, y.getPixelForValue(b.min));
      if (bot <= top) continue;
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.13;
      ctx.fillRect(a.left, top, a.right - a.left, bot - top);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = b.color;
      ctx.font = `12px ${css("--font")}`;
      ctx.fillText(b.label, a.left + 6, (b.max == null ? bot - 6 : top + 14));
    }
    if (opts.baselineBand) {
      const top = Math.max(a.top, y.getPixelForValue(opts.baselineBand.max));
      const bot = Math.min(a.bottom, y.getPixelForValue(opts.baselineBand.min));
      if (bot > top) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = css("--assist");
        ctx.fillRect(a.left, top, a.right - a.left, bot - top);
      }
    }
    if (opts.baseline != null) {
      const yy = y.getPixelForValue(opts.baseline);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = css("--ink-2");
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css("--ink-2");
      ctx.fillText(`your usual ${opts.baseline}`, a.right - 110, yy - 6);
    }
    ctx.restore();
  },
};

/** Bands from thresholds.json levels: watch/alert regions above or below each limit. */
export function bandsFrom(levels = []) {
  const color = { watch: css("--watch"), alert: css("--alert") };
  return levels.map((l) => (l.below != null
    ? { max: l.below, min: null, color: color[l.severity], label: `${l.severity} below ${l.below} (${l.kind.replace("_", " ")})` }
    : { min: l.above, max: null, color: color[l.severity], label: `${l.severity} above ${l.above} (${l.kind.replace("_", " ")})` }));
}

/** Render a trend chart into `host`. Returns a cleanup function. */
export async function renderTrend(host, crewId, metric, state, thresholds) {
  const def = METRIC_DEFS[metric];
  if (!def) { host.innerHTML = `<p class="note">No chart for ${esc(metric)}.</p>`; return () => {}; }
  const levels = def.th ? thresholds?.absolute?.[def.th]?.levels || [] : [];
  host.innerHTML = `
    <div class="chart-head"><h3>${esc(def.label)} <span class="note">(${esc(def.unit)})</span></h3><p class="note chart-src"></p></div>
    <div class="chart-box"><canvas aria-label="${esc(def.label)} trend chart" role="img"></canvas></div>
    <p class="note">Dashed line: your usual value. The pale band shows your personal range over the last 7 days; other shaded bands are sourced thresholds. SIM points are hollow; entered or measured points are solid.</p>
    <ul class="note chart-sources"></ul>`;
  let pts = [];
  try { pts = (await api.history(crewId, def.field)).points; } catch { /* offline */ }
  if (!pts.length) { host.querySelector(".chart-box").innerHTML = `<p class="note">No history yet for this reading.</p>`; return () => {}; }
  const live = (p) => ["user", "camera", "voice", "sensor"].includes(p.source);
  const baselineValues = pts.filter((p) => p.t >= Date.now() / 1000 - 7 * 86400).map((p) => p.v).sort((a, b) => a - b);
  const ownBaseline = baselineValues.length ? baselineValues[Math.floor((baselineValues.length - 1) / 2)] : null;
  const baseline = def.base ? def.base(state) : ownBaseline;
  const baselineBand = baselineValues.length >= 4 ? {
    min: baselineValues[Math.floor((baselineValues.length - 1) * 0.25)],
    max: baselineValues[Math.ceil((baselineValues.length - 1) * 0.75)],
  } : null;
  const nLive = pts.filter(live).length;
  host.querySelector(".chart-src").innerHTML = `${badgeHTML(nLive ? "LIVE" : "SIM")} ${nLive} of ${pts.length} points measured or entered; the rest simulated.`;
  host.querySelector(".chart-sources").innerHTML = levels.map((l) =>
    `<li>${esc(l.severity)} ${l.below != null ? "below " + l.below : "above " + l.above}: <span class="kind kind-${l.kind}">${esc(l.kind)}</span> ${l.source.url ? `<a class="src-link" href="${esc(l.source.url)}" target="_blank" rel="noopener">${esc(l.source.title)}</a>` : esc(l.source.title)}</li>`).join("");
  const canvas = host.querySelector("canvas");
  const Chart = window.Chart;
  if (!Chart) return () => {};
  const line = css("--line");
  const fmtT = (t) => { const d = new Date(t * 1000); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: pts.map((p) => fmtT(p.t)),
      datasets: [{
        data: pts.map((p) => p.v), borderColor: line, borderWidth: 2, tension: 0.25,
        pointRadius: pts.length > 80 ? 0 : 4, pointHoverRadius: 6,
        pointBackgroundColor: pts.map((p) => (live(p) ? line : css("--surface-solid"))), pointBorderColor: line,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.formattedValue} ${def.unit} · ${live(pts[c.dataIndex]) ? "LIVE" : "SIM"}` } },
        sentinelBands: { bands: bandsFrom(levels), baseline, baselineBand },
      },
      scales: {
        x: { ticks: { color: css("--ink-3"), maxTicksLimit: 6, maxRotation: 0 }, grid: { color: css("--rule") } },
        y: { ticks: { color: css("--ink-2") }, grid: { color: css("--rule") } },
      },
    },
    plugins: [bandsPlugin],
  });
  return () => chart.destroy();
}
