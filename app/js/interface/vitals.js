// Vitals stage (refs 13, 15): a heartbeat strip, a blood-pressure gauge, every reading as a tile with its
// sparkline and badge, and the day's plan as a horizontal schedule. The strip is drawn at the measured rate
// as an illustration (there is no ECG sensor); it says so under the card.
import { badgeFor, badgeHTML, esc } from "./readings.js";

let ctxRef = null, raf = 0, phase = 0, last = 0, hr = 60;
const PLAN = [
  { h: 8, label: "Morning vitals", screen: "health_log" },
  { h: 10, label: "Exercise block", note: "per crew schedule" },
  { h: 12, label: "Hydration and meals", screen: "health_log" },
  { h: 13, label: "Reaction test", screen: "cognitive", note: "3 min" },
  { h: 16, label: "Weekly measures", screen: "measures" },
  { h: 19, label: "Mood and sleep log", screen: "health_log" },
  { h: 21, label: "Sleep wind-down", screen: "health_log" },
  { h: 22, label: "Guided exam", screen: "exam", note: "weekly" },
];

export function mountVitals(ctx) {
  ctxRef = ctx;
  document.getElementById("plan-line").addEventListener("click", (e) => {
    const b = e.target.closest("[data-screen]");
    if (b) ctx.director.run([{ cmd: "open_screen", name: b.dataset.screen }]);
  });
  document.getElementById("bp-card").addEventListener("click", () => ctx.director.run([{ cmd: "show_chart", metric: "bp" }]));
  document.getElementById("ecg-card").addEventListener("click", () => ctx.director.run([{ cmd: "show_chart", metric: "heart_rate" }]));
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (ctx.stages?.current !== "vitals" || document.hidden) { last = now; return; }
    drawEcg(now);
  };
  raf = requestAnimationFrame(loop);
}

/** One PQRST-like beat shape, t in 0..1 of a beat. Illustrative only. */
function beat(t) {
  const g = (c, w, a) => a * Math.exp(-((t - c) ** 2) / (2 * w * w));
  return g(0.12, 0.025, 0.12) - g(0.22, 0.008, 0.12) + g(0.25, 0.012, 1) - g(0.285, 0.01, 0.25) + g(0.48, 0.05, 0.28);
}

function drawEcg(now) {
  const c = document.getElementById("ecg");
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dt = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  phase += dt * (hr / 60);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const col = css.getPropertyValue("--assist").trim() || "#6fd0ff";
  const beats = 3.2, mid = h * 0.62;
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "transparent"); grad.addColorStop(0.25, col); grad.addColorStop(1, col);
  g.strokeStyle = grad; g.lineWidth = 2; g.lineJoin = "round";
  g.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const b = phase - (1 - x / w) * beats;
    const y = mid - beat(((b % 1) + 1) % 1) * h * 0.5;
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  // area under the trace, as in ref 15
  g.lineTo(w, h); g.lineTo(0, h); g.closePath();
  const fill = g.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, "rgba(111,208,255,0.16)"); fill.addColorStop(1, "rgba(111,208,255,0)");
  g.fillStyle = fill; g.fill();
}

export function renderVitals(v) {
  const s = v?.state;
  if (!s || !ctxRef) return;
  const rate = s.vitals?.heart_rate;
  if (typeof rate === "number") hr = Math.max(35, Math.min(180, rate));
  document.getElementById("ecg-hr").textContent = typeof rate === "number" ? Math.round(rate) : "—";
  const hb = badgeFor("vitals.heart_rate", s, v.aux);
  const eb = document.getElementById("ecg-badge");
  if (eb.dataset.k !== hb) { eb.innerHTML = badgeHTML(hb); eb.dataset.k = hb; }
  // gauge: systolic on an 80-180 mmHg arc, coloured by its own sourced band
  const sys = s.manual?.bp_systolic, dia = s.manual?.bp_diastolic;
  document.getElementById("bp-val").textContent = sys != null ? `${Math.round(sys)}/${dia != null ? Math.round(dia) : "—"}` : "—";
  const f = sys != null ? Math.max(0, Math.min(1, (sys - 80) / 100)) : 0;
  const arc = document.getElementById("g-arc");
  const len = Math.PI * 80;
  arc.style.strokeDasharray = `${len}`; arc.style.strokeDashoffset = `${len * (1 - f)}`;
  document.getElementById("g-needle").style.transform = `rotate(${-90 + f * 180}deg)`;
  const absBp = (v.aux?.assessment?.absolute || []).find((a) => a.metric === "manual.bp_systolic");
  const sev = absBp?.severity || "ok";
  arc.classList.toggle("is-watch", sev === "watch" || sev === "info"); arc.classList.toggle("is-alert", sev === "alert");
  const bb = badgeFor("manual.bp_systolic", s, v.aux);
  const bpb = document.getElementById("bp-badge");
  if (bpb.dataset.k !== bb) { bpb.innerHTML = badgeHTML(bb); bpb.dataset.k = bb; }
  document.getElementById("bp-note").textContent = absBp ? `${sev === "ok" ? "Within" : "Outside"} the reference band (${absBp.levels?.[0]?.kind === "clinical_reference" ? "clinical reference" : "see sources"}).` : "Log a reading in the health log.";
  // plan schedule
  const c = v.aux?.clock;
  const now = c ? c.hour + c.minute / 60 : 12;
  document.getElementById("plan-day").textContent = c ? `Mission day ${c.mission_day}` : "";
  const line = document.getElementById("plan-line");
  const key = `${Math.floor(now * 4)}`;
  if (line.dataset.k === key) return;
  line.dataset.k = key;
  line.style.setProperty("--now", `${Math.max(0, Math.min(1, (now - 7) / 15)) * 100}%`);
  line.innerHTML = PLAN.map((p) => {
    const st = now >= p.h + 1 ? "is-past" : now >= p.h ? "is-now" : "";
    return `<li class="${st}" style="--x:${((p.h - 7) / 15) * 100}%">
      ${p.screen ? `<button type="button" data-screen="${p.screen}" title="Tap to log activities for ${esc(p.label)}">` : "<div>"}
        <span class="plan-time num">${String(p.h).padStart(2, "0")}:00</span><strong>${esc(p.label)}</strong>${st === "is-now" ? `<span class="badge badge-live" style="margin-top:2px;font-size:9.5px;padding:1px 6px">LOG NOW</span>` : (p.note ? `<small>${esc(p.note)}</small>` : "")}
      ${p.screen ? "</button>" : "</div>"}</li>`;
  }).join("");
}

export function stopVitals() { cancelAnimationFrame(raf); }
