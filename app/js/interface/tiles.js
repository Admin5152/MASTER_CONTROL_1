// Vitals (refs 05, 07): one card per indicator with icon, value, unit, time of the last reading,
// status word, LIVE/SIM badge and a small Chart.js chart. Five chart cards plus five compact cards on
// the body screen; dose and storm level live on the mission and radiation screens (same .tile markup).
import { api } from "../core/api.js";
import { badgeFor, badgeHTML, esc, fmt, get, statusWord } from "./readings.js";

const ICON = {
  heart_rate: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  bp: '<path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z"/>',
  spo2: '<path d="M8 7.5a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z"/><path d="M12 16.5V21M9 21h6"/>',
  temp: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a3.5 3.5 0 1 1-4 0z"/><path d="M12 9v7"/>',
  sleep: '<path d="M18.5 14.5A7 7 0 0 1 9.5 5.5a7 7 0 1 0 9 9z"/>',
};

// chart: kind of mini chart (brief 3.4: bar for sleep, line for temperature, smoothed line for heart
// rate, bar-pairs for blood pressure, area for SpO2)
export const TILES = [
  { id: "heart_rate", label: "Heart rate", field: "vitals.heart_rate", unit: "bpm", hist: "vitals.heart_rate", chart: "smooth" },
  { id: "bp", label: "Blood pressure", field: "manual.bp_systolic", field2: "manual.bp_diastolic", unit: "mmHg", hist: "manual.bp_systolic", hist2: "manual.bp_diastolic", chart: "pairs" },
  { id: "spo2", label: "Oxygen saturation", field: "vitals.spo2", unit: "%", hist: "vitals.spo2", chart: "area" },
  { id: "temp", label: "Temperature", field: "manual.temp_c", unit: "°C", hist: "manual.temp_c", chart: "line" },
  { id: "sleep", label: "Sleep", field: "manual.sleep_hours", unit: "h", hist: "manual.sleep_hours", chart: "bars" },
  { id: "breathing_rate", label: "Breathing", field: "vitals.breathing_rate", unit: "/min", hist: "vitals.breathing_rate", mini: true },
  { id: "glucose", label: "Glucose", field: "manual.glucose_mgdl", unit: "mg/dL", hist: "manual.glucose_mgdl", mini: true },
  { id: "mood", label: "Mood", field: "manual.mood", unit: "/5", hist: "manual.mood", mini: true },
  { id: "reaction", label: "Reaction", field: "cognitive.reaction_ms", unit: "ms", hist: "cognitive.reaction_ms", mini: true },
  { id: "talk_time", label: "Voice", field: "voice.talk_time", unit: "s talk", hist: "voice.talk_time", mini: true },
  { id: "dose", label: "Dose (model)", field: "radiation.cumulative_msv", unit: "mSv", external: true },
  { id: "storm", label: "NOAA storm level", field: "radiation.storm_level", unit: "", external: true },
];

const charts = new Map();      // id -> Chart
const histCache = new Map();   // key -> { t, pts, pts2 }
const lastTime = new Map();    // id -> epoch s of latest point

function cardHTML(t) {
  const icon = ICON[t.id] ? `<span class="vicon"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t.id]}</svg></span>` : "";
  return `<button class="tile vcard card is-ok" type="button" data-tile="${t.id}" aria-label="${esc(t.label)}: open the trend">
      ${icon}
      <span class="tile-label">${esc(t.label)}</span>
      <span class="tile-meta"><span class="tile-badge"></span><span class="tile-status">—</span><span class="tile-time"></span></span>
      <span><span class="tile-value num">—</span><span class="tile-unit">${esc(t.unit)}</span></span>
      ${t.chart ? `<span class="vchart"><canvas aria-hidden="true"></canvas></span>` : ""}
    </button>`;
}

export function mountTiles(host, onOpen) {
  host.innerHTML = TILES.filter((t) => !t.mini && !t.external).map(cardHTML).join("") +
    `<div class="vmini">${TILES.filter((t) => t.mini).map(cardHTML).join("")}</div>`;
  host.querySelectorAll(".tile").forEach((el) => el.addEventListener("click", () => onOpen(el.dataset.tile)));
}

/** Markup for an externally placed tile (dose, storm) so every value keeps one renderer. */
export function tileMarkup(id, extraClass = "") {
  const t = TILES.find((x) => x.id === id);
  return `<span class="tile ${extraClass}" data-tile="${id}"><span class="tile-value num">—</span><span class="tile-unit">${esc(t.unit)}</span> <span class="tile-badge"></span> <span class="tile-status"></span></span>`;
}

function severityFor(t, aux, state) {
  if (t.id === "dose") {
    const r = state.radiation;
    const frac = r.cumulative_msv / r.career_limit_msv;
    return frac >= 1 ? "alert" : frac >= 0.8 ? "watch" : "ok";
  }
  if (t.id === "storm") {
    const l = state.radiation.storm_level;
    return l >= 2 ? "alert" : l >= 1 ? "watch" : "ok";
  }
  const fields = [t.field, t.field2].filter(Boolean);
  let worst = "ok";
  const rank = { ok: 0, info: 1, watch: 2, alert: 3 };
  for (const r of aux?.assessment?.absolute || []) if (fields.includes(r.metric) && rank[r.severity] > rank[worst]) worst = r.severity;
  for (const d of state?.drift?.items || []) if (fields.includes(d.metric) && rank[d.severity] > rank[worst]) worst = d.severity === "info" ? "watch" : d.severity;
  return worst;
}

function ago(ts) {
  if (!ts) return "";
  const s = Date.now() / 1000 - ts;
  if (s < 90) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${Math.round(s / 86400)} d ago`;
}

/** Badge and display text for one tile; shared by every place a value is shown. */
export function tileValue(t, view, spaceweather) {
  const { state, aux } = view;
  const value = get(state, t.field);
  let text = fmt(value, t.field);
  if (t.field2) text = `${fmt(value, t.field)}/${fmt(get(state, t.field2), t.field2)}`;
  let badge;
  if (t.id === "dose") badge = "SIM";
  else if (t.id === "storm") {
    text = `S${value ?? 0}`;
    badge = spaceweather?.scenario ? "SIM" : spaceweather?.source === "live" ? "LIVE" : "SNAPSHOT";
  } else badge = badgeFor(t.field, state, aux);
  const sev = value == null ? "none" : severityFor(t, aux, state);
  return { value, text, badge, sev };
}

export function renderTiles(root, view, spaceweather) {
  const { state } = view;
  if (!state) return;
  for (const t of TILES) {
    const els = root.querySelectorAll(`[data-tile="${t.id}"]`);
    if (!els.length) continue;
    const { value, text, badge, sev } = tileValue(t, view, spaceweather);
    for (const el of els) {
      el.classList.remove("is-ok", "is-watch", "is-alert", "is-none");
      el.classList.add(`is-${sev}`);
      el.querySelector(".tile-value").textContent = text;
      const st = el.querySelector(".tile-status");
      if (st) st.textContent = value == null ? "No reading" : statusWord(sev);
      const b = el.querySelector(".tile-badge");
      if (b.dataset.k !== badge) { b.innerHTML = badgeHTML(badge); b.dataset.k = badge; }
      const tm = el.querySelector(".tile-time");
      if (tm) tm.textContent = ago(lastTime.get(t.id));
    }
  }
}

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Fetch history (at most every 10 s per tile) and draw the small charts. */
export async function refreshSparks(host, crewId) {
  const now = Date.now();
  await Promise.all(TILES.filter((t) => t.hist).map(async (t) => {
    const key = `${crewId}:${t.id}`;
    let c = histCache.get(key);
    if (!c || now - c.t > 10000) {
      try {
        const h = await api.history(crewId, t.hist);
        const h2 = t.hist2 ? await api.history(crewId, t.hist2) : null;
        c = { t: now, pts: h.points.slice(-24), pts2: h2 ? h2.points.slice(-24) : null };
        histCache.set(key, c);
      } catch { return; }
    }
    if (c.pts.length) lastTime.set(t.id, c.pts[c.pts.length - 1].t);
    if (t.chart) drawChart(host, t, c);
  }));
}

export function invalidateSparks() { histCache.clear(); lastTime.clear(); }

function drawChart(host, t, c) {
  const cv = host.querySelector(`[data-tile="${t.id}"] canvas`);
  const Chart = window.Chart;
  if (!cv || !Chart || c.pts.length < 2) return;
  const sev = host.querySelector(`[data-tile="${t.id}"]`).classList.contains("is-alert") ? "alert" : "ok";
  const accent = sev === "alert" ? css("--alert") : css("--assist");
  const muted = css("--rule-2");
  const live = (p) => ["user", "camera", "voice", "sensor"].includes(p.source);
  const labels = c.pts.map((p) => p.t);
  let data;
  if (t.chart === "pairs" && c.pts2) {
    const n = Math.min(c.pts.length, c.pts2.length);
    const s = c.pts.slice(-n), d = c.pts2.slice(-n);
    data = { labels: s.map((p) => p.t), datasets: [{ type: "bar", data: s.map((p, i) => [d[i].v, p.v]), backgroundColor: s.map((p, i) => (i === n - 1 ? accent : muted)), borderRadius: 2, barPercentage: 0.5, categoryPercentage: 1 }] };
  } else if (t.chart === "bars") {
    data = { labels, datasets: [{ type: "bar", data: c.pts.map((p) => p.v), backgroundColor: c.pts.map((p, i) => (i === c.pts.length - 1 ? accent : muted)), borderRadius: 3, barPercentage: 0.7, categoryPercentage: 1 }] };
  } else {
    data = { labels, datasets: [{ type: "line", data: c.pts.map((p) => p.v), borderColor: accent, borderWidth: t.chart === "line" ? 1.5 : 2,
      borderDash: t.chart === "line" ? [3, 3] : [], tension: t.chart === "smooth" ? 0.45 : t.chart === "area" ? 0.4 : 0.1,
      pointRadius: c.pts.map((p, i) => (i === c.pts.length - 1 ? 2.5 : t.chart === "line" ? 1.5 : 0)), pointBackgroundColor: c.pts.map((p) => (live(p) ? accent : css("--surface-solid"))), pointBorderColor: accent,
      fill: t.chart === "area" ? { target: "origin", above: css("--assist-soft") } : false }] };
  }
  const old = charts.get(t.id);
  if (old && old.canvas === cv) { old.data = data; old.update("none"); return; }
  old?.destroy();
  const vals = c.pts.map((p) => p.v).concat(c.pts2 ? c.pts2.map((p) => p.v) : []);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  charts.set(t.id, new Chart(cv, {
    data, options: { responsive: true, maintainAspectRatio: false, animation: false, events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, min: t.chart === "bars" ? 0 : lo - (hi - lo) * 0.15 - 0.5, max: hi + (hi - lo) * 0.15 + 0.5 } } },
  }));
}
