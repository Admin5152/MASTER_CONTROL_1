// The body screen in the refs 12-16 layout language: a left rail of body systems (each isolates that
// system on the model), the large 3D body with a few data chips pinned to it, a right column with the
// selected system (status chip, 2-3 metric cards with gradient range bars, a care strategy card with
// tabs), and an insights card bottom-left with Sentinel's latest findings.
import { badgeHTML, esc, fmt, statusWord, zoneReadings, ZONE_NAMES, get, badgeFor } from "./readings.js";
import { gradientCss, rangeBar } from "./ranges.js";

export const SYSTEMS = [
  { id: "whole_body", label: "Whole body", title: "Whole body", icon: '<circle cx="12" cy="4.6" r="2.2"/><path d="M12 7.5v7M7 9.5l5 1 5-1M9.5 21l2.5-6.5 2.5 6.5"/>' },
  { id: "head", label: "Brain", title: "Brain and cognition", part: "brain", icon: '<path d="M9 5.5a3 3 0 0 0-5 2.5 3 3 0 0 0 0 5 3 3 0 0 0 5 3.5V5.5zM15 5.5a3 3 0 0 1 5 2.5 3 3 0 0 1 0 5 3 3 0 0 1-5 3.5V5.5z"/><path d="M9 16.5v2M15 16.5v2"/>' },
  { id: "eyes", label: "Eyes", title: "Eyes and vision", part: "eyes", icon: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>' },
  { id: "heart", label: "Heart", title: "Cardiovascular system", part: "heart", icon: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>' },
  { id: "lungs", label: "Lungs", title: "Respiratory system", part: "lungs", icon: '<path d="M12 4v8M12 12c-1.5 1-3 1-3 1M12 12c1.5 1 3 1 3 1"/><path d="M8.5 8C6 8.5 4 13 4 17c0 1.5 1.2 2.5 2.6 2.2C8.5 18.8 9 17 9 15V9M15.5 8C18 8.5 20 13 20 17c0 1.5-1.2 2.5-2.6 2.2C15.5 18.8 15 17 15 15V9"/>' },
  { id: "gut", label: "Gut", title: "Digestion and nutrition", part: "intestines", icon: '<path d="M8 4h8M9 4c0 3 6 2 6 5s-7 2-7 5 7 2 7 5"/>' },
  { id: "bones", label: "Bones", title: "Musculoskeletal system", part: "skeleton", icon: '<path d="M7 7l10 10M5.5 8.5a2 2 0 1 1 3-3M8.5 5.5M15.5 18.5a2 2 0 1 0 3-3M18.5 15.5"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/>' },
  { id: "vessels", label: "Vessels", title: "Blood vessels", part: "vessels", zone: "heart", icon: '<path d="M12 3v18M12 8l-5 4M12 8l5 4M12 14l-4 4M12 14l4 4"/>' },
];
const SEV_COL = { ok: "var(--nominal)", info: "var(--watch)", watch: "var(--watch)", alert: "var(--alert)" };
const BAR_COL = { ok: "#7fe0a6", info: "#ffc35c", watch: "#ffc35c", alert: "#ff5468" };

// Lifestyle notes per system: general guidance only, never treatment.
const LIFESTYLE = {
  head: ["Protect the sleep period: under 6 hours is linked with slower reactions in flight (PMC8919197).", "Short breaks between tasks; the space race or Orb Calm count.", "Talk with the crew or home today."],
  eyes: ["Rest your eyes between screen blocks.", "Report any blurred near vision: crews are screened for SANS."],
  heart: ["Keep the daily exercise schedule (cycle, treadmill, resistance).", "Slow breathing for two minutes when the heart rate is up.", "Drink to plan: fluid shifts upward in weightlessness."],
  lungs: ["Check the cabin air reading if breathing feels harder.", "Slow, full breaths with the Orb Calm pacer."],
  gut: ["Eat the planned menu; log appetite changes.", "Space-motion sickness usually settles in the first days."],
  bones: ["Resistance exercise is the main countermeasure for bone and muscle loss.", "Log any back pain: spines lengthen in weightlessness."],
  whole_body: ["Use the shelter area during a solar storm.", "Keep the weekly standard measures."],
};

let state = { system: "heart", tab: "plan", insightsOpen: false };
let deps = null;

export function mountBodyPanels({ rail, panel, insights, director, screens, getView, facts, kit }) {
  deps = { rail, panel, insights, director, screens, getView, facts, kit };
  rail.innerHTML = SYSTEMS.map((s) => `<button type="button" class="rail-btn" data-sys="${s.id}" aria-label="${esc(s.label)}" title="${esc(s.label)}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${s.icon}</svg><span class="rail-label">${esc(s.label)}</span><i class="rail-dot"></i></button>`).join("");
  rail.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sys]");
    if (b) selectSystem(b.dataset.sys, { show: true });
  });
  panel.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) { state.tab = tab.dataset.tab; render(); return; }
    if (e.target.closest("[data-check]")) {
      const z = zoneOf(state.system);
      director.run([z === "whole_body" ? { cmd: "start_scan" } : { cmd: "check_zone", zones: [z] }]);
    }
    const m = e.target.closest("[data-metric]");
    if (m) screens.chart(m.dataset.metric);
    if (e.target.closest("[data-organ]")) screens.open("organ", zoneOf(state.system));
  });
  insights.addEventListener("click", (e) => {
    if (e.target.closest("[data-ins-toggle]")) { state.insightsOpen = !state.insightsOpen; render(); }
    const z = e.target.closest("[data-ins-zone]");
    if (z) director.run([{ cmd: "point_to", zone: z.dataset.insZone }]);
  });
}

function zoneOf(id) { const s = SYSTEMS.find((x) => x.id === id); return s?.zone || s?.id || "heart"; }

/** Pick a system: highlights the rail, shows its panel, and (with show) isolates it on the model. */
export function selectSystem(id, { show = false } = {}) {
  state.system = id;
  state.tab = "plan";
  render();
  if (!show) return;
  const s = SYSTEMS.find((x) => x.id === id);
  if (id === "whole_body") deps.director.run([{ cmd: "xray", on: false }, { cmd: "zoom_body", zone: "reset" }]);
  else deps.director.run([{ cmd: "isolate", part: s.part }]);
}

/** The worst zone, so the body screen opens on what matters. */
export function defaultSystem(view) {
  const zones = view.aux?.assessment?.zones || {};
  const rank = { ok: 0, info: 1, watch: 2, alert: 3 };
  let best = "heart", r = -1;
  for (const z of ["heart", "head", "lungs", "eyes", "gut", "bones"]) if ((rank[zones[z]] || 0) > r) { r = rank[zones[z]] || 0; best = z; }
  return r > 0 ? best : "heart";
}

export function render() {
  if (!deps) return;
  const v = deps.getView();
  if (!v.state) return;
  const zones = v.aux?.assessment?.zones || {};
  // rail
  deps.rail.querySelectorAll("[data-sys]").forEach((b) => {
    const z = zoneOf(b.dataset.sys);
    b.classList.toggle("is-on", b.dataset.sys === state.system);
    const sev = b.dataset.sys === "whole_body" ? null : zones[z];
    b.querySelector(".rail-dot").className = `rail-dot ${sev && sev !== "ok" ? `is-${sev === "info" ? "watch" : sev}` : ""}`;
  });
  renderPanel(v, zones);
  renderInsights(v, zones);
}

function bar(r) {
  const b = r.levels ? rangeBar(r.levels, typeof r.value === "number" ? r.value : NaN) : null;
  if (!b) return "";   // no sourced band for this reading: the change from baseline below says it
  return `<div class="rbar" style="background:${gradientCss(b.stops, BAR_COL)}"><i style="left:${(b.pos * 100).toFixed(1)}%"></i></div>
    <div class="rbar-scale"><span>${esc(fmt(b.min))}</span><span>${esc(fmt(b.max))}</span></div>`;
}

function renderPanel(v, zones) {
  const sys = SYSTEMS.find((s) => s.id === state.system) || SYSTEMS[3];
  const zone = zoneOf(sys.id);
  const sev = zones[zone] || "ok";
  const rs = zoneReadings(zone, v.state, v.aux).filter((r) => r.value != null).slice(0, 3);
  const z = deps.facts?.zones?.[zone] || {};
  const organImg = ["head", "eyes", "heart", "lungs", "gut", "bones"].includes(zone) ? { head: "brain" }[zone] || zone : null;
  const cards = rs.length ? rs.map((r) => `<button type="button" class="mcard" data-metric="${esc(metricKey(r.field))}">
      <span class="mcard-top"><span class="mcard-label">${esc(r.label)}</span>${badgeHTML(r.badge)}</span>
      <span class="mcard-val"><strong class="num">${esc(fmt(r.value, r.field))}</strong><small>${esc(r.unit || "")}</small><em class="st-${r.severity}">${esc(statusWord(r.severity))}</em></span>
      ${bar(r)}
      <span class="mcard-change">${esc(r.change || "No baseline comparison yet")}</span></button>`).join("")
    : `<p class="note mcard-none">No sensor on this system yet. The Sentinel Skin wearable (DESIGNED) would add one. Log a symptom in the health log.</p>`;
  const a = v.state.action || {};
  const plan = [
    a.zone === zone && a.detail ? `<li class="is-now"><strong>Now</strong><span>${esc(a.detail)}</span>${badgeHTML("SIM")}</li>` : "",
    z.next ? `<li><strong>Next</strong><span>${esc(z.next)}</span></li>` : "",
    `<li><strong>Check</strong><span>Run a focused ${esc(sys.label.toLowerCase())} check with Sentinel.</span></li>`,
  ].join("");
  const kitItems = kitFor(zone);
  const kit = kitItems.length ? kitItems.map((k) => `<li><strong>${esc(k.name)}</strong><span>${esc(k.pack)} · for ${esc(k.symptoms.join(", "))}</span></li>`).join("") +
    `<li class="caveat"><span>${esc(deps.kit?.caveat || "Consult mission medical protocol before use.")}</span>${badgeHTML("SIM")}</li>` : `<li><span>No stocked item mapped to this system. Consult the flight surgeon.</span></li>`;
  const life = (LIFESTYLE[zone] || []).map((t) => `<li><span>${esc(t)}</span></li>`).join("");
  deps.panel.innerHTML = `
    <header class="sys-head">
      <span class="sys-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${sys.icon}</svg></span>
      <h2>${esc(sys.title)}</h2>
      <span class="sev-chip is-${sev === "info" ? "watch" : sev}">${esc(statusWord(sev))}</span>
    </header>
    <p class="sys-sub">${esc(z.what || "")} ${z.hazard ? `<span class="fine">NASA hazard: ${esc(z.hazard)}</span>` : ""}</p>
    <div class="mcards">${cards}</div>
    <div class="care card">
      <div class="care-head"><h3>Care strategy</h3>
        <div class="seg" role="tablist">${[["plan", "Action plan"], ["kit", "Onboard kit"], ["life", "Lifestyle"]].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}</button>`).join("")}</div>
      </div>
      <ul class="care-list">${state.tab === "plan" ? plan : state.tab === "kit" ? kit : life}</ul>
    </div>
    <div class="sys-actions">
      <button class="pill pill-light" type="button" data-check>${zone === "whole_body" ? "Full scan" : "Check with Sentinel"}</button>
      ${organImg ? `<button class="organ-mini" type="button" data-organ aria-label="Open the ${esc(sys.label)} view"><img src="assets/organs/${organImg}.png" alt=""><span>Organ view</span></button>` : ""}
    </div>`;
}

function metricKey(field) {
  return { "vitals.heart_rate": "heart_rate", "vitals.breathing_rate": "breathing_rate", "vitals.spo2": "spo2", "manual.bp_systolic": "bp", "manual.bp_diastolic": "bp",
    "manual.glucose_mgdl": "glucose", "manual.temp_c": "temp", "manual.sleep_hours": "sleep", "manual.mood": "mood", "cognitive.reaction_ms": "reaction",
    "voice.talk_time": "talk_time", "voice.pitch": "pitch" }[field] || "heart_rate";
}

function kitFor(zone) {
  const k = deps.kit;
  if (!k) return [];
  const byItem = {};
  for (const [sym, z] of Object.entries(k.symptom_zone || {})) {
    if (z !== zone) continue;
    const id = k.symptom_map?.[sym];
    const item = k.items?.find((i) => i.id === id);
    if (!item) continue;
    (byItem[id] ||= { name: item.name, pack: item.pack, symptoms: [] }).symptoms.push(sym);
  }
  return Object.values(byItem).slice(0, 3);
}

function renderInsights(v, zones) {
  const items = (v.state.drift?.items || []).filter((d) => d.severity !== "info");
  const flagged = Object.entries(zones).filter(([z, s]) => s !== "ok" && z !== "cabin");
  const n = flagged.length;
  const list = flagged.slice(0, 4).map(([z, s]) => {
    const r = zoneReadings(z, v.state, v.aux).find((x) => x.severity !== "ok");
    return `<li><button type="button" data-ins-zone="${esc(z)}"><span class="ins-dot is-${s === "info" ? "watch" : s}"></span><span><strong>${esc(ZONE_NAMES[z] || z)}</strong>${r ? `<small>${esc(r.label)} ${esc(fmt(r.value, r.field))} ${esc(r.unit || "")}${r.change ? ` · ${esc(r.change)}` : ""}</small>` : ""}</span></button></li>`;
  }).join("");
  void items;
  deps.insights.classList.toggle("is-open", state.insightsOpen);
  deps.insights.innerHTML = `<button type="button" class="ins-head" data-ins-toggle aria-expanded="${state.insightsOpen}">
      <span class="ins-n num">${n}</span><span class="ins-t">${n === 1 ? "new insight" : "new insights"}<small>${n ? "Change from your own baseline" : "Everything within your usual range"}</small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${state.insightsOpen ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"}"/></svg></button>
    ${state.insightsOpen && n ? `<ul class="ins-list">${list}</ul><p class="fine">Tap one and Sentinel points to it. Not a diagnosis.</p>` : ""}`;
}

/** Data chips pinned to the body (ref 14): short values beside a zone's dot. */
export function chipText(zone, v) {
  const s = v.state;
  if (!s) return "";
  const val = (f, d = 0) => { const x = get(s, f); return typeof x === "number" ? x.toFixed(d) : null; };
  const t = {
    heart: val("vitals.heart_rate") && `${val("vitals.heart_rate")} bpm`,
    lungs: val("vitals.spo2") && `SpO2 ${val("vitals.spo2")}%`,
    head: val("manual.sleep_hours", 1) && `Sleep ${val("manual.sleep_hours", 1)} h`,
    gut: val("manual.glucose_mgdl") && `${val("manual.glucose_mgdl")} mg/dL`,
  }[zone];
  if (!t) return "";
  const field = { heart: "vitals.heart_rate", lungs: "vitals.spo2", head: "manual.sleep_hours", gut: "manual.glucose_mgdl" }[zone];
  return { text: t, badge: badgeFor(field, s, v.aux) };
}

export const bodyPanelState = state;
