// Vitals strip: one tile per indicator with value, unit, status word, badge and sparkline.
import { api } from "../core/api.js";
import { badgeFor, badgeHTML, esc, fmt, get, statusWord } from "./readings.js";

// field: state path; hist: history field for the sparkline; chart: Director metric name
export const TILES = [
  { id: "heart_rate", label: "Heart rate", field: "vitals.heart_rate", unit: "bpm", hist: "vitals.heart_rate" },
  { id: "breathing_rate", label: "Breathing", field: "vitals.breathing_rate", unit: "/min", hist: "vitals.breathing_rate" },
  { id: "spo2", label: "SpO2", field: "vitals.spo2", unit: "%", hist: "vitals.spo2" },
  { id: "bp", label: "Blood pressure", field: "manual.bp_systolic", field2: "manual.bp_diastolic", unit: "mmHg", hist: "manual.bp_systolic" },
  { id: "glucose", label: "Glucose", field: "manual.glucose_mgdl", unit: "mg/dL", hist: "manual.glucose_mgdl" },
  { id: "temp", label: "Temperature", field: "manual.temp_c", unit: "°C", hist: "manual.temp_c" },
  { id: "sleep", label: "Sleep", field: "manual.sleep_hours", unit: "h", hist: "manual.sleep_hours" },
  { id: "mood", label: "Mood", field: "manual.mood", unit: "/5", hist: "manual.mood" },
  { id: "reaction", label: "Reaction", field: "cognitive.reaction_ms", unit: "ms", hist: "cognitive.reaction_ms" },
  { id: "talk_time", label: "Voice", field: "voice.talk_time", unit: "s talk", hist: "voice.talk_time" },
  { id: "dose", label: "Dose (model)", field: "radiation.cumulative_msv", unit: "mSv", hist: null, screen: "radiation" },
  { id: "storm", label: "NOAA storm level", field: "radiation.storm_level", unit: "", hist: null, screen: "radiation" },
];

const sparkCache = new Map(); // id -> {t, points}

export function mountTiles(host, onOpen) {
  host.innerHTML = TILES.map((t) => `
    <button class="tile is-ok" type="button" data-tile="${t.id}" aria-label="${esc(t.label)} trend">
      <span class="tile-label">${esc(t.label)}</span>
      <span><span class="tile-value num">—</span><span class="tile-unit">${esc(t.unit)}</span></span>
      <span class="tile-top"><span class="tile-status">—</span><span class="tile-badge"></span></span>
      <canvas class="tile-spark" aria-hidden="true"></canvas>
    </button>`).join("");
  host.querySelectorAll(".tile").forEach((el) => el.addEventListener("click", () => onOpen(el.dataset.tile)));
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
  for (const r of aux?.assessment?.absolute || []) {
    if (fields.includes(r.metric) && rank[r.severity] > rank[worst]) worst = r.severity;
  }
  for (const d of state?.drift?.items || []) {
    if (fields.includes(d.metric) && rank[d.severity] > rank[worst]) worst = d.severity === "info" ? "watch" : d.severity;
  }
  return worst;
}

export function renderTiles(host, view, spaceweather) {
  const { state, aux } = view;
  if (!state) return;
  for (const t of TILES) {
    const el = host.querySelector(`[data-tile="${t.id}"]`);
    if (!el) continue;
    let value = get(state, t.field);
    let text = fmt(value, t.field);
    if (t.field2) text = `${fmt(value, t.field)}/${fmt(get(state, t.field2), t.field2)}`;
    let badge;
    if (t.id === "dose") badge = "SIM";
    else if (t.id === "storm") {
      text = `S${value ?? 0}`;
      const sc = spaceweather?.scenario;
      badge = sc ? "SIM" : spaceweather?.source === "live" ? "LIVE" : "SNAPSHOT";
    } else badge = badgeFor(t.field, state, aux);
    if (t.id === "heart_rate" && view.pulseReading && state.vitals?.sources?.heart_rate === "camera") badge = "LIVE";
    const sev = value == null ? "none" : severityFor(t, aux, state);
    el.className = `tile is-${sev}`;
    el.querySelector(".tile-value").textContent = text;
    el.querySelector(".tile-status").textContent = value == null ? "No reading" : statusWord(sev);
    const b = el.querySelector(".tile-badge");
    if (b.dataset.k !== badge) { b.innerHTML = badgeHTML(badge); b.dataset.k = badge; }
  }
}

/** Fetch history for sparklines every 10 s at most per tile. */
export async function refreshSparks(host, crewId) {
  const now = Date.now();
  await Promise.all(TILES.filter((t) => t.hist).map(async (t) => {
    const key = `${crewId}:${t.id}`;
    const c = sparkCache.get(key);
    if (c && now - c.t < 10000) { drawSpark(host, t.id, c.points); return; }
    try {
      const h = await api.history(crewId, t.hist);
      const pts = h.points.slice(-40).map((p) => p.v);
      sparkCache.set(key, { t: now, points: pts });
      drawSpark(host, t.id, pts);
    } catch { /* offline: keep the last drawing */ }
  }));
}

export function invalidateSparks() { sparkCache.clear(); }

function drawSpark(host, id, pts) {
  const cv = host.querySelector(`[data-tile="${id}"] .tile-spark`);
  if (!cv || pts.length < 2) return;
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
  const ctx = cv.getContext("2d");
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--line-dim").trim() || "#1b6f8c";
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  pts.forEach((v, i) => {
    const x = (i / (pts.length - 1)) * (cv.width - 2) + 1;
    const y = cv.height - 2 - ((v - min) / span) * (cv.height - 4);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  // last point
  const lx = cv.width - 2, ly = cv.height - 2 - ((pts[pts.length - 1] - min) / span) * (cv.height - 4);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--line").trim() || "#39d5ff";
  ctx.beginPath(); ctx.arc(lx, ly, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
}
