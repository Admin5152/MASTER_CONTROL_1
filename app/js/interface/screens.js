// Screen manager. Stages (assistant, mission, body, vision, radiation) go through the stage manager;
// everything else opens in the side sheet so detail is one tap away and the stage stays in view.
import { LANGUAGES, cleanLang } from "../voice/languages.js";
import { api } from "../core/api.js";
import { emit } from "../core/bus.js";
import { STAGES } from "../core/stages.js";
import { renderTrend, METRIC_DEFS } from "./charts.js";
import { ZONE_NAMES, badgeFor, badgeHTML, esc, fmt, statusHTML, statusKey, statusWord, zoneReadings } from "./readings.js";

const sheet = () => document.getElementById("sheet");
const registry = new Map(); // name -> { title, badge, wide, full, orb, render(el, ctx, arg) -> cleanup }
let cleanupFn = null;
let currentName = null;
let ctxRef = null;
const ALIAS = { aurora_run: "race" };

export function registerScreen(name, def) { registry.set(name, def); }
export function currentScreen() { return currentName; }

export function initScreens(ctx) {
  ctxRef = ctx;
  document.getElementById("sheet-close").addEventListener("click", () => closeScreen());
  registerScreen("zone", { title: "Body system", wide: true, render: renderZone });
  registerScreen("health_log", { title: "Health log", badge: "LIVE", render: renderHealthLog });
  registerScreen("trends", { title: "Trends", wide: true, render: renderTrends });
  registerScreen("crew", { title: "Crew", render: renderCrew });
  registerScreen("more", { title: "More", render: renderHub });
  registerScreen("cabin", { title: "Cabin air", badge: "SIM", wide: true, render: renderCabin });
  registerScreen("settings", { title: "Settings", render: renderSettings });
  registerScreen("about", { title: "About and credits", render: renderAbout });
  registerScreen("evidence", { title: "NASA evidence", badge: "68 MRIDs", render: renderEvidence });
  return api_;
}

function show(name, arg) {
  const def = registry.get(name);
  if (!def) return;
  ctxRef.nextScreen = name;   // a screen's cleanup can tell it is being replaced by the same kind (organ to organ)
  closeScreen(true);
  ctxRef.nextScreen = null;
  const el = sheet();
  currentName = name;
  el.hidden = false;
  el.classList.toggle("is-wide", !!def.wide);
  el.classList.toggle("is-full", !!def.full);
  document.body.classList.toggle("is-fullscreen", !!def.full);
  el.classList.toggle("is-orb", !!def.orb);
  el.dataset.screen = name;
  document.getElementById("sheet-title").textContent = typeof def.title === "function" ? def.title(arg) : def.title;
  const badge = typeof def.badge === "function" ? def.badge(arg) : def.badge;
  document.getElementById("sheet-badge").innerHTML = badge ? badgeHTML(badge) : "";
  const body = document.getElementById("sheet-body");
  body.innerHTML = "";
  body.scrollTop = 0;
  if (def.orb) ctxRef.stages?.setOrbMode("calm");
  if (def.full) ctxRef.stages?.setOrbMode("off");
  try {
    const c = def.render(body, ctxRef, arg);
    cleanupFn = typeof c === "function" ? c : null;
    if (c?.then) c.then((fn) => { if (currentName === name && typeof fn === "function") cleanupFn = fn; });
  } catch (err) {
    console.warn("screen failed", name, err);
    body.innerHTML = `<p class="note">This screen could not load: ${esc(err.message)}</p>`;
  }
  if (window.gsap && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.gsap.fromTo(el, { opacity: 0, x: def.full || def.wide || def.orb ? 0 : 24, scale: def.full ? 1.01 : 1 }, { opacity: 1, x: 0, scale: 1, duration: 0.6, ease: "power3.out" });
  }
  emit("screen:open", name);
}

export function closeScreen(silent = false) {
  if (cleanupFn) { try { cleanupFn(); } catch {} }
  cleanupFn = null;
  const was = currentName;
  const def = registry.get(was);
  currentName = null;
  sheet().hidden = true;
  sheet().classList.remove("is-wide", "is-full", "is-orb");
  document.body.classList.remove("is-fullscreen");
  document.getElementById("sheet-body").innerHTML = "";
  if (def?.orb || def?.full) ctxRef.stages?.restoreOrb();
  if (!silent && was) emit("screen:close", was);
}

const api_ = {
  async open(name, arg) {
    name = ALIAS[name] || name;
    if (name === "home") { closeScreen(); return ctxRef.stages.go(ctxRef.homeStage()); }
    if (STAGES.includes(name)) { closeScreen(); return ctxRef.stages.go(name); }
    show(name, arg);
  },
  chart(metric) { show("trends", metric); },
  zone(zone) { show("zone", zone); },
  intervention(name) { emit("intervention:open", name); },
  close() {
    if (currentName) { closeScreen(); return; }
    return ctxRef.stages.go(ctxRef.homeStage());
  },
  current: () => currentName,
};

// ---------- zone panel ----------
function renderZone(el, ctx, zone) {
  document.getElementById("sheet-title").textContent = ZONE_NAMES[zone] || zone;
  el.innerHTML = `<div data-zbody></div><div data-ztrend></div>`;
  const box = el.querySelector("[data-zbody]"), trendBox = el.querySelector("[data-ztrend]");
  let trendCleanup = () => {};
  const showTrend = async (field) => {
    const k = metricOfField(field);
    if (!k) { trendBox.innerHTML = ""; return; }
    const fields = zoneReadings(zone, ctx.view.state, ctx.view.aux).map((r) => [r.field, r.label]).filter(([f]) => metricOfField(f));
    trendBox.innerHTML = `<h3>Trend and history</h3>${fields.length > 1 ? `<div class="quick" style="display:flex;flex-wrap:wrap;position:static">${fields.map(([f, l]) => `<button class="chip" type="button" data-zf="${esc(f)}" aria-selected="${f === field}">${esc(l)}</button>`).join("")}</div>` : ""}
      <div data-zchart style="margin-top:var(--s-3)"></div><div data-zentries></div>`;
    trendBox.querySelectorAll("[data-zf]").forEach((b) => b.addEventListener("click", () => showTrend(b.dataset.zf)));
    trendCleanup();
    trendCleanup = await renderTrend(trendBox.querySelector("[data-zchart]"), ctx.view.crewId, k, ctx.view.state, ctx.thresholds);
    entriesTable(trendBox.querySelector("[data-zentries]"), ctx.view.crewId, METRIC_DEFS[k]);
  };
  const draw = () => {
    const { state, aux } = ctx.view;
    const f = ctx.facts.zones[zone] || {};
    const readings = zoneReadings(zone, state, aux);
    const sev = aux?.assessment?.zones?.[zone] || "ok";
    const rows = readings.map((r) => `<tr class="cl-rowlink" data-ind="${esc(r.field)}" title="Open this reading">
        <td>${esc(r.label)}</td>
        <td class="num"><strong>${esc(fmt(r.value, r.field))}</strong> ${esc(r.unit || "")}</td>
        <td>${badgeHTML(r.badge)}</td>
        <td class="st-cell st-${statusKey(r.severity)}">${statusHTML(r.severity)}</td>
        <td class="note">${esc(r.change || "")}</td></tr>`).join("");
    const ths = readings.flatMap((r) => (r.levels || []).map((l) => `<li>${esc(r.label)}: ${esc(l.severity)} ${l.below != null ? "below " + l.below : "above " + l.above} ${esc(r.unit || "")}.
        <span class="kind kind-${l.kind}">${esc(l.kind)}</span> ${l.source.url ? `<a class="src-link" href="${esc(l.source.url)}" target="_blank" rel="noopener">${esc(l.source.title)}</a>` : esc(l.source.title)}</li>`)).join("");
    const extra = zone === "bones" ? `<p>${badgeHTML("DESIGNED")} Exercise log: the wearable's accelerometer would log resistance exercise here. Not running in this build.</p>` : "";
    const rad = zone === "whole_body" ? `<p class="note">Effects NASA tracks: cancer risk, central nervous system and cognitive effects, cardiovascular effects, and cataracts. Because radiation cannot be felt, Sentinel asks for the cognitive check so a trend is noticed early. This is not a diagnosis.</p>
      <button class="pill pill-ghost" type="button" data-open="radiation">Open Radiation Watch</button>` : "";
    box.innerHTML = `
      <h3>Your readings <span class="co-sev st-cell st-${statusKey(sev)}">${statusHTML(sev)}</span></h3>
      ${rows ? `<table class="readings"><thead><tr><th>Reading</th><th>Value</th><th>Source</th><th>Status</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="note">No readings for this area yet.</p>`}
      <p style="margin-top:var(--s-4)" class="zone-acts"><button class="pill pill-dark" type="button" data-steps>Recommended steps</button> <button class="pill pill-ghost" type="button" data-check>Check this area</button> <button class="pill pill-ghost" type="button" data-hurt>Log a symptom</button></p>
      ${f.how_to_measure ? `<h3>How to measure</h3><p data-how>${esc(f.how_to_measure)}</p>` : ""}
      ${f.why_it_matters ? `<h3>Why it matters</h3><p data-why>${esc(f.why_it_matters)}</p>` : ""}
      ${f.mrids?.length ? `<details class="mrids-box"><summary class="fine">NASA evidence: ${f.mrids.length} MRID${f.mrids.length > 1 ? "s" : ""} cover this system</summary><p class="fine mrids" data-mrids>${f.mrids.map((m) => `<span class="mrid" title="${esc(m.file)}">${esc(m.id)} ${esc(m.title)}</span>`).join("; ")}. Designed around these requirements, not an implementation of them. <a href="#" data-ev="${esc(zone)}">Open the evidence</a></p></details>` : ""}
      <h3>What to do next</h3><p>${esc(f.next || "")}</p>
      <details class="more"><summary>What it does and how spaceflight affects it</summary>
        <p>${esc(f.what || "")}</p><p>${esc(f.spaceflight || "")}</p>
        <p class="note">NASA hazard: ${esc(f.hazard || "")}. Source: <a href="${esc(f.source?.url || "")}" target="_blank" rel="noopener">${esc(f.source?.title || "")}</a></p>
        ${extra}${rad}</details>
      <details class="more"><summary>Thresholds and where they come from</summary>
        ${ths ? `<ul class="note">${ths}</ul>` : `<p class="note">No numeric threshold applies to this area in this build.</p>`}</details>
      <p class="fine">Sentinel describes change from your own baseline. It does not diagnose; anything that worries you is a question for the flight surgeon.</p>`;
    el.querySelector("[data-open]")?.addEventListener("click", () => api_.open("radiation"));
    el.querySelector("[data-check]")?.addEventListener("click", () => { closeScreen(); ctx.director.run([{ cmd: "check_zone", zones: [zone] }]); });
    el.querySelector("[data-hurt]")?.addEventListener("click", () => api_.open("care", { zone: zone === "heart" ? "chest" : zone === "whole_body" ? undefined : zone, view: "triage" }));
    box.querySelector("[data-steps]")?.addEventListener("click", () => api_.open("care", { zone: zone === "heart" ? "chest" : zone === "whole_body" ? undefined : zone, view: "triage" }));
    box.querySelectorAll("[data-ind]").forEach((r) => r.addEventListener("click", () => api_.open("indicator", r.dataset.ind)));
  };
  draw();
  const firstField = zoneReadings(zone, ctx.view.state, ctx.view.aux).map((r) => r.field).find((f) => metricOfField(f));
  if (firstField) showTrend(firstField);
  const t = setInterval(() => { if (!el.contains(document.activeElement) && !box.querySelector("details[open]")) draw(); }, 3000);
  return () => { clearInterval(t); trendCleanup(); };
  el.querySelector("[data-ev]")?.addEventListener("click", (e) => { e.preventDefault(); show("evidence", { q: "" , zone: e.currentTarget.dataset.ev }); });
}

// ---------- manual health log ----------
const FIELDS = [
  { key: "heart_rate", group: "vitals", label: "Heart rate", unit: "bpm", min: 20, max: 250, step: 1,
    hint: "Count the pulse at the wrist or neck for 30 seconds and double it, or read it from a device.", why: "Resting pulse shows how the heart is adapting; Sentinel compares it with your own usual." },
  { key: "breathing_rate", group: "vitals", label: "Breathing rate", unit: "breaths/min", min: 2, max: 80, step: 1,
    hint: "Count breaths for 30 seconds at rest and double it.", why: "A change at rest can be an early sign of illness or poor cabin air." },
  { key: "spo2", group: "vitals", label: "Oxygen saturation (SpO2)", unit: "%", min: 50, max: 100, step: 1,
    hint: "Finger clip oximeter; keep the hand still and warm.", why: "Shows whether the blood is carrying enough oxygen." },
  { key: "bp_systolic", label: "Blood pressure, systolic", unit: "mmHg", min: 40, max: 300, step: 1,
    hint: "Cuff on the upper arm at heart level; sit strapped in so the arm is not floating.", why: "Fluid shifts toward the head in weightlessness change how the heart and vessels work." },
  { key: "bp_diastolic", label: "Blood pressure, diastolic", unit: "mmHg", min: 20, max: 200, step: 1,
    hint: "Read from the same cuff measurement.", why: "Together with systolic it shows cardiovascular load." },
  { key: "glucose_mgdl", label: "Blood glucose", unit: "mg/dL", min: 10, max: 900, step: 1,
    hint: "Finger-stick meter; wick the drop onto the strip, it will not fall in microgravity.", why: "Diet is planned months ahead; glucose shows how meals and activity are balanced." },
  { key: "temp_c", label: "Body temperature", unit: "°C", min: 25, max: 45, step: 0.1,
    hint: "Under the tongue or in the ear; the cabin is often warm, so rest five minutes first.", why: "Fever is an early sign that an infection may warrant a check." },
  { key: "sleep_hours", label: "Sleep last night", unit: "hours", min: 0, max: 24, step: 0.25,
    hint: "Count from lights-out in the sleep station, not from the schedule.", why: "Light cycles every 90 minutes in orbit; sleep loss slows reaction time." },
  { key: "sleep_quality", label: "Sleep quality", unit: "1–5", min: 1, max: 5, step: 1,
    hint: "Rate how restorative sleep felt, from 1 (poor) to 5 (restful).", why: "A short self-rating helps compare sleep with your own recent pattern." },
  { key: "exercise_minutes", label: "Exercise today", unit: "minutes", min: 0, max: 600, step: 1,
    hint: "Enter active exercise minutes from your planned session.", why: "Exercise is a scheduled countermeasure for cardiovascular and musculoskeletal changes." },
  { key: "hydration_ml", label: "Fluids today", unit: "mL", min: 0, max: 10000, step: 50,
    hint: "Enter the approximate total fluid intake; log meals in the field below if useful.", why: "Fluid intake supports a useful daily hydration record." },
];

function renderHealthLog(el, ctx) {
  const m = { ...(ctx.view.state?.manual || {}) };
  const vit = ctx.view.state?.vitals || {};
  let mood = null;
  const self = {};
  const lastOf = (f) => (f.group === "vitals" ? vit[f.key] : m[f.key]);
  const pathOf = (f) => `${f.group || "manual"}.${f.key}`;
  const crewId = ctx.view.crewId;
  emit("checkin.started", { crewId });
  el.innerHTML = `
    <div class="hw-head" data-hw-head></div>
    <form class="form-grid" novalidate>
      ${FIELDS.map((f) => `<div class="field" data-key="${f.key}">
        <label for="f-${f.key}">${esc(f.label)} <span class="note">(${esc(f.unit)})</span></label>
        <input id="f-${f.key}" name="${f.key}" type="number" inputmode="decimal" min="${f.min}" max="${f.max}" step="${f.step}" placeholder="last: ${esc(fmt(lastOf(f), pathOf(f)))}${badgeFor(pathOf(f), ctx.view.state, ctx.view.aux) === "LIVE" ? " (LIVE)" : " (SIM)"}">
        <span class="hint">How in microgravity: ${esc(f.hint)}</span>
        <span class="why">Why it matters: ${esc(f.why)}</span>
        <span class="err" aria-live="polite"></span></div>`).join("")}
      <div class="field" data-key="mood">
        <label>Mood today <span class="note">(1 low to 5 good)</span></label>
        <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-mood="${n}" aria-pressed="false">${n}</button>`).join("")}</div>
        <span class="hint">Tap the number that fits right now; there is no right answer.</span>
        <span class="why">Why it matters: isolation and confinement is one of NASA's five hazards.</span>
      </div>
      ${[["energy_self", "Energy today", "1 drained to 5 full"], ["stress_self", "Stress today", "1 calm to 5 very stressed"], ["connection_self", "Connection with the crew", "1 distant to 5 close"]].map(([k, label, hint]) => `<div class="field" data-key="${k}">
        <label>${label} <span class="note">(${hint})</span></label>
        <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-self="${k}" data-n="${n}" aria-pressed="false">${n}</button>`).join("")}</div></div>`).join("")}
      <div class="field" data-key="symptoms">
        <label for="f-symptoms">Symptoms</label>
        <input id="f-symptoms" type="text" placeholder="e.g. headache, nausea, dry eyes">
        <span class="hint">Separate with commas. Sentinel checks the onboard kit list (SIM) and never suggests anything not stocked.</span>
        <span class="why">Why it matters: early symptoms are easier to manage before they grow.</span>
      </div>
      <div class="field" data-key="meals"><label for="f-meals">Meals (optional)</label>
        <input id="f-meals" type="text" placeholder="e.g. breakfast, lunch, dinner"><span class="hint">Separate meal notes with commas.</span></div>
    </form>
    <p><button class="pill pill-dark pill-block" type="button" data-save>Save health log</button></p>
    <p class="note" data-result aria-live="polite"></p>
    <p class="note" data-stored aria-live="polite"></p>`;
  // ---- the health log as a short wizard: one small group per step, big numbers with steppers, then a review ----
  const HW = [
    { t: "Heart and breathing", s: "From a device, or count for 30 seconds and double it.", keys: ["heart_rate", "breathing_rate", "spo2"], i: '<path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.400C19 15.600 12 20 12 20z"/><path d="M5.500 12.500h3l1.500-3 2.500 5.500 1.500-2.500h4"/>' },
    { t: "Blood pressure", s: "Cuff on the upper arm, at heart level.", keys: ["bp_systolic", "bp_diastolic"], i: '<circle cx="12" cy="13" r="7"/><path d="M12 13l3.500-3.500M9.500 3.500h5M12 3.500V6"/>' },
    { t: "Glucose and temperature", s: "Meter and thermometer readings.", keys: ["glucose_mgdl", "temp_c"], i: '<path d="M12 3.500c3 4 5 6.500 5 9.500a5 5 0 0 1-10 0c0-3 2-5.500 5-9.500z"/>' },
    { t: "Sleep", s: "Last night.", keys: ["sleep_hours", "sleep_quality"], i: '<path d="M19.500 14.500A8 8 0 0 1 9.500 4.500a8 8 0 1 0 10 10z"/>' },
    { t: "Activity and fluids", s: "Today so far.", keys: ["exercise_minutes", "hydration_ml", "meals"], i: '<path d="M4 9v6M7 6.500v11M17 6.500v11M20 9v6M7 12h10"/>' },
    { t: "How you feel", s: "Tap what fits right now. There is no right answer.", keys: ["mood", "energy_self", "stress_self", "connection_self", "symptoms"], i: '<circle cx="12" cy="12" r="8.500"/><path d="M8.500 14a4 4 0 0 0 7 0M9 10h.010M15 10h.010"/>' },
    { t: "Review and save", s: "Check it, then save. Blank fields are left as they were.", keys: [], i: '<path d="M5 12.500l4.500 4.500L19 7.500"/>' },
  ];
  let hwStep = 0;
  const formEl = el.querySelector("form.form-grid"), saveP = el.querySelector("[data-save]").parentElement;
  formEl.classList.add("hw");
  el.querySelectorAll(".form-grid .field").forEach((f) => {
    f.dataset.hwStep = String(Math.max(0, HW.findIndex((h) => h.keys.includes(f.dataset.key))));
    const inp = f.querySelector('input[type="number"]');
    if (!inp) return;
    // "last: 72 (SIM)" becomes a quiet line under a large number field with minus and plus
    const m = /last:\s*([\d.]+)?\s*(\((?:LIVE|SIM)\))?/.exec(inp.placeholder || "");
    const lastV = m && m[1] ? Number(m[1]) : null, unit = FIELDS.find((x) => x.key === f.dataset.key)?.unit || "";
    inp.placeholder = "—";
    const wrap = document.createElement("div"); wrap.className = "hw-num";
    const mk = (d, label) => { const b = document.createElement("button"); b.type = "button"; b.className = "hw-step"; b.textContent = d > 0 ? "+" : "−"; b.setAttribute("aria-label", `${label} ${f.querySelector("label").textContent.trim().split("(")[0].trim()}`);
      b.addEventListener("click", () => { const st = Number(inp.step) || 1, cur = inp.value === "" ? (lastV ?? Number(inp.min)) : Number(inp.value) + d * st;
        inp.value = String(Math.round(Math.min(Number(inp.max), Math.max(Number(inp.min), cur)) / st) * st).replace(/(\.\d{2})\d+$/, "$1"); inp.dispatchEvent(new Event("input")); }); return b; };
    inp.replaceWith(wrap); wrap.append(mk(-1, "Lower"), inp, mk(1, "Raise"));
    const u = document.createElement("span"); u.className = "hw-unit"; u.textContent = unit; wrap.append(u);
    const last = document.createElement("span"); last.className = "hw-last fine";
    last.textContent = `${lastV != null ? `Last: ${lastV} ${unit}${m[2] ? ` ${m[2].replace(/[()]/g, "")}` : ""}` : "No earlier value"} · accepts ${inp.min} to ${inp.max}`;
    wrap.after(last);
    // told at once, on the field itself: a slip is fixed while the device is still in your hand, not hunted for later
    const live = () => {
      const v = inp.value.trim(), n = Number(v);
      let why = v !== "" && (!Number.isFinite(n) || n < Number(inp.min) || n > Number(inp.max)) ? `${v} is outside ${inp.min} to ${inp.max} ${unit}. Check the device and enter it again.` : "";
      const sys = Number(el.querySelector("#f-bp_systolic")?.value), dia = Number(el.querySelector("#f-bp_diastolic")?.value);
      if (!why && f.dataset.key === "bp_diastolic" && v !== "" && el.querySelector("#f-bp_systolic")?.value !== "" && dia >= sys) why = "Diastolic must be lower than systolic. Check which number is which.";
      f.classList.toggle("has-err", !!why);
      f.querySelector(".err").textContent = why;
      inp.setAttribute("aria-invalid", String(!!why));
    };
    inp.addEventListener("input", live);
    if (f.dataset.key === "bp_systolic") inp.addEventListener("input", () => el.querySelector("#f-bp_diastolic")?.dispatchEvent(new Event("input")));
  });
  const review = document.createElement("div"); review.className = "hw-review"; review.hidden = true; formEl.after(review);
  const nav = document.createElement("div"); nav.className = "exam-nav hw-nav";
  nav.innerHTML = `<button class="pill pill-ghost" type="button" data-hw-back>Back</button><button class="pill pill-light" type="button" data-hw-next>Next</button>`;
  saveP.before(nav);
  const stepOk = () => {   // the same limits the save uses, checked as you go so a slip is caught on its own step
    let ok = true;
    formEl.querySelectorAll(`.field[data-hw-step="${hwStep}"] input[type="number"]`).forEach((inp) => {
      const w = inp.closest(".field"), v = inp.value.trim(), bad = v !== "" && (!Number.isFinite(Number(v)) || Number(v) < Number(inp.min) || Number(v) > Number(inp.max));
      inp.dispatchEvent(new Event("input"));   // the live check owns the message
      if (bad || w.classList.contains("has-err")) ok = false;
    });
    return ok;
  };
  const hwDraw = () => {
    const h = HW[hwStep], last = hwStep === HW.length - 1;
    el.querySelector("[data-hw-head]").innerHTML = `<ol class="hw-dots" aria-label="Step ${hwStep + 1} of ${HW.length}">${HW.map((x, n) => `<li class="${n < hwStep ? "is-done" : n === hwStep ? "is-now" : ""}"><button type="button" data-hw-go="${n}" aria-label="${esc(x.t)}"></button></li>`).join("")}</ol>
      <div class="hw-title"><span class="env-ic hw-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${h.i.replace(/(\d)\.(\d)00\b/g, "$1.$2").replace(/\.0(\d)0\b/g, ".0$1")}</svg></span>
        <div><span class="label">Step ${hwStep + 1} of ${HW.length}</span><h3>${esc(h.t)}</h3><p class="fine">${esc(h.s)}</p></div></div>`;
    el.querySelectorAll("[data-hw-go]").forEach((b) => b.addEventListener("click", () => { if (Number(b.dataset.hwGo) < hwStep || stepOk()) { hwStep = Number(b.dataset.hwGo); hwDraw(); } }));
    formEl.querySelectorAll(".field").forEach((f) => { f.hidden = Number(f.dataset.hwStep) !== hwStep; });
    formEl.hidden = last;
    review.hidden = !last;
    saveP.hidden = !last;
    nav.querySelector("[data-hw-back]").disabled = hwStep === 0;
    nav.querySelector("[data-hw-next]").hidden = last;
    if (last) {
      const pen = (key, label) => `<button type="button" class="hw-edit" data-hw-edit="${key}" aria-label="Edit ${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg></button>`;
      const row = (key, label, value) => `<li><span>${esc(label)}</span><strong class="num">${value}</strong>${pen(key, label)}</li>`;
      const rows = FIELDS.map((f) => [f, el.querySelector(`#f-${f.key}`)?.value.trim()]).filter(([, v]) => v).map(([f, v]) => row(f.key, f.label, `${esc(v)} <small>${esc(f.unit)}</small>`));
      if (mood != null) rows.push(row("mood", "Mood", `${mood} <small>of 5</small>`));
      for (const [k, v] of Object.entries(self)) rows.push(row(k, k.replace("_self", "")[0].toUpperCase() + k.replace("_self", "").slice(1), `${v} <small>of 5</small>`));
      const sy = el.querySelector("#f-symptoms").value.trim(), ml = el.querySelector("#f-meals").value.trim();
      if (sy) rows.push(row("symptoms", "Symptoms", esc(sy)));
      if (ml) rows.push(row("meals", "Meals", esc(ml)));
      review.innerHTML = rows.length ? `<ul class="hw-list">${rows.join("")}</ul>` : `<p class="note">Nothing entered yet. Go back and add at least one reading, or close this.</p>`;
      el.querySelector("[data-save]").disabled = !rows.length;
      review.querySelectorAll("[data-hw-edit]").forEach((b) => b.addEventListener("click", () => {   // straight to the field, cursor in it
        const f = formEl.querySelector(`.field[data-key="${b.dataset.hwEdit}"]`);
        if (!f) return;
        hwStep = Number(f.dataset.hwStep); hwDraw();
        const inp = f.querySelector("input, [data-mood], [data-self]");
        inp?.focus(); inp?.select?.(); f.scrollIntoView({ block: "center", behavior: "smooth" });
      }));
    }
  };
  nav.querySelector("[data-hw-back]").addEventListener("click", () => { hwStep = Math.max(0, hwStep - 1); hwDraw(); });
  nav.querySelector("[data-hw-next]").addEventListener("click", () => { if (stepOk()) { hwStep = Math.min(HW.length - 1, hwStep + 1); hwDraw(); el.querySelector("#sheet-body, .sheet-body")?.scrollTo?.(0, 0); document.getElementById("sheet-body").scrollTop = 0; } });
  // a value the save rejects sends you to its step
  el.querySelector("[data-save]").addEventListener("click", () => setTimeout(() => { const bad = formEl.querySelector(".field.has-err"); if (bad) { hwStep = Number(bad.dataset.hwStep); hwDraw(); } }, 0));
  hwDraw();
  el.querySelectorAll(".form-grid .field").forEach((f) => {   // less to read: the guidance opens on demand
    if (!f.querySelector(".hint, .why")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "cl-info"; b.textContent = "i";
    b.setAttribute("aria-label", "How to measure this and why it matters"); b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", (e) => { e.preventDefault(); b.setAttribute("aria-expanded", String(f.classList.toggle("is-info"))); });
    f.querySelector("label")?.append(" ", b);
  });
  el.querySelectorAll("[data-self]").forEach((b) => b.addEventListener("click", () => {
    self[b.dataset.self] = Number(b.dataset.n);
    el.querySelectorAll(`[data-self="${b.dataset.self}"]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  el.querySelectorAll("[data-mood]").forEach((b) => b.addEventListener("click", () => {
    mood = Number(b.dataset.mood);
    el.querySelectorAll("[data-mood]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  el.querySelector("[data-save]").addEventListener("click", async () => {
    const out = {};
    let ok = true;
    for (const f of FIELDS) {
      const wrap = el.querySelector(`[data-key="${f.key}"]`);
      const raw = wrap.querySelector("input").value.trim();
      wrap.classList.remove("has-err");
      wrap.querySelector(".err").textContent = "";
      if (raw === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < f.min || v > f.max) {
        ok = false;
        wrap.classList.add("has-err");
        wrap.querySelector(".err").textContent = `Enter a value between ${f.min} and ${f.max} ${f.unit}. Check the device and remeasure if the reading falls outside this range.`;
        continue;
      }
      out[f.key] = v;
    }
    if (out.bp_systolic != null && out.bp_diastolic != null && out.bp_diastolic >= out.bp_systolic) {
      ok = false;
      const w = el.querySelector('[data-key="bp_diastolic"]');
      w.classList.add("has-err");
      w.querySelector(".err").textContent = "Diastolic must be lower than systolic.";
    }
    if (!ok) return;
    if (mood != null) out.mood = mood;
    Object.assign(out, self);
    // readings typed from a device go to the vitals record, marked as entered by hand
    const vitals = {};
    for (const f of FIELDS) if (f.group === "vitals" && out[f.key] != null) { vitals[f.key] = out[f.key]; delete out[f.key]; }
    const sym = el.querySelector("#f-symptoms").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    out.symptoms = sym;
    out.meals = el.querySelector("#f-meals").value.split(",").map((x) => x.trim()).filter(Boolean);
    out.updated = new Date().toISOString();
    const result = el.querySelector("[data-result]");
    try {
      const body = { manual: out };
      if (Object.keys(vitals).length) body.vitals = { ...vitals, sources: Object.fromEntries(Object.keys(vitals).map((k) => [k, "manual"])) };
      const s = await ctx.patch(body);
      const entered = { ...vitals, ...out };
      for (const f of FIELDS) {
        if (entered[f.key] == null) continue;
        emit("reading.added", { indicator: f.key, value: entered[f.key], source: "manual", label: "MANUAL", confidence: 1 });
      }
      for (const [k, v] of Object.entries(self)) emit("reading.added", { indicator: k, value: v, source: "manual", label: "MANUAL", confidence: 1 });
      // show that it is really stored: what was saved now and how many entries the record holds
      api.record(crewId).then((rec) => {
        const saved = [...FIELDS.filter((f) => entered[f.key] != null).map((f) => [f.label, pathOf(f)]), ...(mood != null ? [["Mood", "manual.mood"]] : []),
          ...Object.keys(self).map((k) => [k.replace("_self", ""), `manual.${k}`])];
        const box = el.querySelector("[data-stored]");
        if (!box || !saved.length) return;
        box.innerHTML = `<strong>Stored in your record</strong> (on this device, kept after a restart): ${saved.map(([label, path]) => `${esc(label)} · ${rec.fields[path]?.entered ?? 1} entr${(rec.fields[path]?.entered ?? 1) === 1 ? "y" : "ies"}`).join("; ")}. <button class="link-btn" type="button" data-rec>Open my saved record</button>`;
        box.querySelector("[data-rec]").addEventListener("click", () => api_.open("record"));
      }).catch(() => {});
      if (mood != null) emit("reading.added", { indicator: "mood", value: mood, source: "manual", label: "MANUAL", confidence: 1 });
      ctx.onCheckin?.("log", out);
      const a = s.action;
      const outsideFields = Object.entries(ctx.thresholds?.absolute || {}).filter(([field, def]) => {
        const v = field.startsWith("manual.") ? out[field.slice(7)] : field.startsWith("vitals.") ? vitals[field.slice(7)] : null;
        return v != null && (def.levels || []).some((l) => l.below != null ? v < l.below : v > l.above);
      }).map(([field]) => field.slice(7));
      const flaggedNow = a.type && a.type !== "none";
      const outside = outsideFields.length > 0;
      result.textContent = `${a.type === "none" ? "Saved. Everything is within your usual range." : `Saved. ${a.detail}`}${outside ? " Please remeasure this reading when ready; the entered value is saved for review." : ""}`;
      if (outside) {
        const remeasure = document.createElement("button");
        remeasure.type = "button";
        remeasure.className = "pill pill-ghost";
        remeasure.textContent = "Re-measure reading";
        remeasure.addEventListener("click", () => el.querySelector(`#f-${outsideFields[0]}`)?.focus());
        result.append(" ", remeasure);
      }
      if (flaggedNow) {
        const whyBtn = document.createElement("button");
        whyBtn.type = "button"; whyBtn.className = "pill pill-ghost"; whyBtn.textContent = "Why this?";
        whyBtn.addEventListener("click", () => api_.open("alerts"));
        result.append(" ", whyBtn);
      }
      ctx.say(a.type === "none" ? "Saved. Thank you." : `Saved. ${a.detail}`);
    } catch (e) {
      result.textContent = `Not saved: ${e.message}. Check the brain link at the top right.`;
    }
  });
}

// ---------- trends ----------
function renderTrends(el, ctx, metric) {
  const m = metric && METRIC_DEFS[metric] ? metric : "heart_rate";
  el.innerHTML = `<div class="quick" style="display:flex;flex-wrap:wrap;position:static" role="tablist">${Object.entries(METRIC_DEFS).map(([k, d]) =>
    `<button class="chip" type="button" role="tab" data-m="${k}" aria-selected="${k === m}">${esc(d.label)}</button>`).join("")}</div>
    <div data-chart style="margin-top: var(--s-4)"></div>
    <div data-entries></div>
    <div class="exam-nav"><button class="pill pill-ghost" type="button" data-more="weekly">Weekly review: sleep and reaction together</button><button class="pill pill-ghost" type="button" data-more="mind">Wellbeing dimensions</button><button class="pill pill-ghost" type="button" data-more="record">My saved record</button></div>`;
  el.querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => api_.open(b.dataset.more)));
  let cleanup = () => {};
  const load = async (k) => {
    cleanup();
    el.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.m === k)));
    document.getElementById("sheet-title").textContent = `Trend: ${METRIC_DEFS[k].label}`;
    cleanup = await renderTrend(el.querySelector("[data-chart]"), ctx.view.crewId, k, ctx.view.state, ctx.thresholds);
    entriesTable(el.querySelector("[data-entries]"), ctx.view.crewId, METRIC_DEFS[k]);
  };
  el.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => load(b.dataset.m)));
  load(m);
  return () => cleanup();
}

/** Under a chart: latest, my normal, the week's low and high, then every stored entry with where it came from. */
async function entriesTable(box, crewId, def) {
  if (!box || !def) return;
  box.innerHTML = "";
  let pts = [], base = null;
  try { [pts, base] = await Promise.all([api.history(crewId, def.field).then((r) => r.points || []), api.baselines(crewId).then((b) => b.indicators[def.field]).catch(() => null)]); } catch { return; }
  if (!pts.length) return;
  const wk = pts.filter((p) => p.t >= Date.now() / 1000 - 7 * 86400).map((p) => p.v), last = pts[pts.length - 1];
  const lab = (p) => p.label || (p.source === "sim" ? "SIM" : p.source === "user" || p.source === "manual" ? "MANUAL" : "LIVE");
  const tile = (k, v) => `<div class="card cl-stat"><span class="label">${k}</span><strong class="num">${v}</strong></div>`;
  box.innerHTML = `<div class="cl-stats">${tile("Latest", `${esc(fmt(last.v, def.field))} <small>${esc(def.unit)}</small>`)}${tile("My normal", base ? `${esc(fmt(base.median, def.field))} <small>± ${esc(fmt(base.spread, def.field))}</small>` : "—")}
      ${tile("7-day low", wk.length ? esc(fmt(Math.min(...wk), def.field)) : "—")}${tile("7-day high", wk.length ? esc(fmt(Math.max(...wk), def.field)) : "—")}</div>
    <p class="fine">${base ? esc(base.stage) : ""}${base ? ` · ${base.entered} entered or measured of ${base.count} stored` : ""}</p>
    <details class="more" open><summary>All ${pts.length} stored entries</summary>
      <div class="ev-tools hist-tools"><input type="search" data-hq placeholder="Search a date or a value: Nov 14, 72…" aria-label="Search the entries">
        <div class="ev-chips">${[["", "All sources"], ["mine", "Entered by me"], ["live", "Measured"], ["sim", "SIM"]].map(([k, l]) => `<button type="button" data-hs="${k}" aria-pressed="${k === ""}">${l}</button>`).join("")}</div>
        <div class="ev-chips">${[["0", "All time"], ["1", "Today"], ["7", "7 days"], ["30", "30 days"]].map(([k, l]) => `<button type="button" data-hd="${k}" aria-pressed="${k === "0"}">${l}</button>`).join("")}</div></div>
      <p class="fine" data-hcount></p>
      <table class="readings"><thead><tr><th>When</th><th>Value</th><th>Source</th></tr></thead><tbody data-hbody></tbody></table></details>`;
  const rows = [...pts].reverse().map((p) => ({ p, when: new Date(p.t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), val: fmt(p.v, def.field), lab: lab(p) }));
  let src = "", days = 0;
  const draw = () => {
    const q = box.querySelector("[data-hq]").value.trim().toLowerCase(), since = days ? Date.now() / 1000 - days * 86400 : 0;
    const shown = rows.filter((r) => (!src || (src === "mine" ? r.lab === "MANUAL" : src === "sim" ? r.lab === "SIM" : r.lab.startsWith("LIVE"))) && r.p.t >= since
      && (!q || `${r.when} ${r.val} ${r.lab}`.toLowerCase().includes(q)));
    box.querySelector("[data-hcount]").textContent = `${shown.length} of ${rows.length} entries`;
    box.querySelector("[data-hbody]").innerHTML = shown.slice(0, 200).map((r) => `<tr><td>${esc(r.when)}</td><td class="num"><strong>${esc(r.val)}</strong> ${esc(def.unit)}</td><td>${badgeHTML(r.lab)}</td></tr>`).join("") || `<tr><td colspan="3" class="note">No entry matches.</td></tr>`;
  };
  box.querySelector("[data-hq]").addEventListener("input", draw);
  box.querySelectorAll("[data-hs]").forEach((b) => b.addEventListener("click", () => { src = b.dataset.hs; box.querySelectorAll("[data-hs]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  box.querySelectorAll("[data-hd]").forEach((b) => b.addEventListener("click", () => { days = Number(b.dataset.hd); box.querySelectorAll("[data-hd]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  draw();
}
const metricOfField = (field) => Object.entries(METRIC_DEFS).find(([, d]) => d.field === field)?.[0] || null;

// ---------- crew ----------
function renderCrew(el, ctx) {
  el.innerHTML = `<p class="note">Choose who is using Sentinel. A manual choice is badged <span class="badge badge-sim">manual</span>; a voice match is badged LIVE.</p>
    <div class="hub" style="margin-top:var(--s-4)">${ctx.view.crew.map((c) => `<button type="button" data-crew="${esc(c.crew_id)}"><strong>${esc(c.display_name)}</strong><span>${c.crew_id === ctx.view.crewId ? "Using Sentinel now" : "Switch to"}</span></button>`).join("")}</div>
    <h3>Crew Intercom & Chat</h3>
    <p class="note">Send messages directly to crewmates on board. Messages appear in their notification inbox and live chat feed.</p>
    <div class="field" style="margin-bottom:var(--s-2)">
      <label><span>Recipient</span>
        <select data-comms-to style="width:100%; border-radius:8px; padding:6px; background:rgba(15,23,42,0.7); color:inherit; border:1px solid rgba(148,163,184,0.3);">
          <option value="all">All Crew (Broadcast)</option>
          ${ctx.view.crew.filter(c => c.crew_id !== ctx.view.crewId).map(c => `<option value="${esc(c.crew_id)}">${esc(c.display_name)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="field" style="margin-bottom:var(--s-2)">
      <label><span>Message</span>
        <textarea data-comms-text rows="2" placeholder="Type a message to your crewmate..." style="width:100%; border-radius:8px; padding:8px; background:rgba(15,23,42,0.6); color:inherit; border:1px solid rgba(148,163,184,0.3); resize:vertical; font-family:inherit;"></textarea>
      </label>
    </div>
    <div style="display:flex; gap:8px; margin-top:var(--s-2); align-items:center;">
      <button class="pill pill-light" type="button" data-comms-send>Send Message</button>
      <span class="note" data-comms-status aria-live="polite"></span>
    </div>
    <div data-comms-feed style="margin-top:var(--s-3); max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
      <p class="hint fine">Loading recent messages...</p>
    </div>`;

  const toSel = el.querySelector("[data-comms-to]");
  const txtArea = el.querySelector("[data-comms-text]");
  const sendBtn = el.querySelector("[data-comms-send]");
  const statusEl = el.querySelector("[data-comms-status]");
  const feedEl = el.querySelector("[data-comms-feed]");

  const refreshFeed = async () => {
    try {
      const res = await api.json("../api/crew/messages");
      const msgs = res?.messages || [];
      if (!msgs.length) {
        feedEl.innerHTML = `<p class="hint fine" style="opacity:0.6;">No intercom messages yet. Start a conversation above.</p>`;
        return;
      }
      feedEl.innerHTML = msgs.slice(-15).reverse().map((m) => `
        <div style="padding:6px 10px; border-radius:8px; background:rgba(30,41,59,0.7); border:1px solid rgba(148,163,184,0.2); font-size:12px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
            <strong style="color:#38bdf8;">${esc(m.from_name || "Crew")} &rarr; ${esc(m.to_cid === "all" ? "All Crew" : (ctx.view.crew.find(c => c.crew_id === m.to_cid)?.display_name || m.to_cid))}</strong>
            <span style="opacity:0.5; font-size:10px;">${new Date((m.t || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div style="color:#f1f5f9;">${esc(m.text || "")}</div>
        </div>
      `).join("");
    } catch {
      feedEl.innerHTML = `<p class="hint fine" style="opacity:0.6;">Intercom messages saved locally.</p>`;
    }
  };
  refreshFeed();

  sendBtn?.addEventListener("click", async () => {
    const text = txtArea.value.trim();
    if (!text) { txtArea.focus(); return; }
    const toCid = toSel.value;
    statusEl.textContent = "Sending...";
    try {
      await api.post("../api/crew/message", { from_cid: ctx.view.crewId, to_cid: toCid, text });
      txtArea.value = "";
      statusEl.textContent = "Sent!";
      setTimeout(() => { statusEl.textContent = ""; }, 2500);
      refreshFeed();
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  });
  el.querySelectorAll("[data-crew]").forEach((b) => b.addEventListener("click", () => { ctx.setCrew(b.dataset.crew, "manual"); closeScreen(); }));
  el.insertAdjacentHTML("beforeend", `<h3>Add a crew member</h3>
    <p class="note">They start with a clean record: no borrowed readings, baselines calibrate from their own check-ins, and everything in Sentinel works for them straight away.</p>
    <label class="pf-field"><span>Name or callsign</span><input type="text" data-new-name maxlength="24" placeholder="e.g. Noor" autocomplete="off"></label>
    <div class="pf-field"><span>Body model</span><div class="mood-row"><button type="button" data-bm="male" aria-pressed="true">Male</button><button type="button" data-bm="female" aria-pressed="false">Female</button></div></div>
    <p><button class="pill pill-dark" type="button" data-add-crew>Add and set up</button> <span class="note" data-add-msg aria-live="polite"></span></p>`);
  let bm = "male";
  el.querySelectorAll("[data-bm]").forEach((b) => b.addEventListener("click", () => { bm = b.dataset.bm; el.querySelectorAll("[data-bm]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
  el.querySelector("[data-add-crew]").addEventListener("click", async () => {
    const name = el.querySelector("[data-new-name]").value.trim(), msg = el.querySelector("[data-add-msg]");
    if (name.length < 2) { el.querySelector("[data-new-name]").focus(); return; }
    try {
      const c = await api.crewAdd(name, bm);
      ctx.view.crew = await api.crew();
      emit("crew.added", { crewId: c.crew_id });
      ctx.setCrew(c.crew_id, "manual");
      setTimeout(() => api_.open("onboarding"), 700);   // first run: consent, kit, profile, first check-in
    } catch (e) { msg.textContent = e.message; }
  });
}

// ---------- the More hub: everything else, grouped ----------
function renderHub(el, ctx) {
  const groups = [
    ["Today", [["today", "Today with Sentinel", "The day's blocks, quick logs and reminders"], ["checkin", "Daily check-in", "Scan, entries, mood, reaction, summary"], ["care", "Care", "I don't feel well: triage and protocols"],
      ["alerts", "Alerts", "What was flagged and why"], ["record", "My saved record", "Everything stored, and my normal"], ["weekly", "Weekly review", "Trends, what worked, what to share"]]],
    ["Check-ins", [["health_log", "Health log", "Pulse, blood pressure, glucose, temperature, sleep, mood"], ["cognitive", "Cognitive check", "25-second reaction test"], ["trends", "Trends", "Every reading over time"]]],
    ["Wellbeing", [["orb_calm", "Stillpoint", "A breathing game, tracked by heart rate"], ["race", "Slipstream", "Race past the planets; boost and draft"], ["greenhouse", "Red Harvest", "Farm on Mars: grow crops, fill crew orders"], ["wellbeing", "Wellbeing hub", "Stillpoint, Slipstream, Red Harvest and the science"], ["mind", "How I'm doing", "Mood, energy, stress, connection"], ["journal", "Private journal", "Kept on this device only"], ["interventions", "Suggestions", "What Sentinel recommends now"]]],
    ["Crew and ship", [["environment", "Environment and mode", "Where you are; what changes"], ["profile", "My health profile", "Allergies, plan, buddy, consent"], ["onboarding", "First run", "Consent, kit, voice, calibration"], ["kit", "Medical kit", "On board, filtered for you (SIM)"], ["crew", "Crew", "Who is using Sentinel"], ["cabin", "Cabin air", "Oxygen and carbon dioxide (SIM)"], ["hardware", "Sentinel Skin", "The wearable design (DESIGNED)"], ["settings", "Settings", "Theme, camera, microphone, voice"], ["devices", "Devices", "Camera, watch, chest hub, suit, cabin: what is connected"], ["datasets", "NASA research datasets", "Published human datasets behind what is tracked"], ["about", "About and credits", "Sources and licences"]]],
  ];
  el.innerHTML = groups.map(([g, items]) => `<section class="hub-group"><h3>${esc(g)}</h3><div class="hub">${items.map(([k, t, d]) =>
    `<button type="button" data-open="${k}"><strong>${esc(t)}</strong><span>${esc(d)}</span></button>`).join("")}</div></section>`).join("");
  el.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.open;
    if (k === "race" || k === "orb_calm" || k === "health_log" || k === "trends" || k === "cognitive" || k === "hardware" || k === "greenhouse" || k === "crew" || k === "wellbeing") ctx.director.run([{ cmd: "open_screen", name: k }]);
    else api_.open(k);
  }));
}

// ---------- cabin ----------
function renderCabin(el, ctx) {
  const th = ctx.thresholds?.absolute || {};
  const host = el;
  host.innerHTML = `<div data-cnow></div><h3>History</h3><div data-c1></div><div data-ce1></div><div data-c2 style="margin-top:var(--s-4)"></div><div data-ce2></div>`;
  el = host.querySelector("[data-cnow]");
  const cleanups = [];
  (async () => {
    for (const [k, c1, c2] of [["o2", "[data-c1]", "[data-ce1]"], ["co2", "[data-c2]", "[data-ce2]"]]) {
      cleanups.push(await renderTrend(host.querySelector(c1), ctx.view.crewId, k, ctx.view.state, ctx.thresholds));
      entriesTable(host.querySelector(c2), ctx.view.crewId, METRIC_DEFS[k]);
    }
  })();
  const draw = () => {
    const c = ctx.view.state?.cabin || {};
    const lv = (k) => (th[k]?.levels || []).map((l) => `${l.severity} ${l.below != null ? "below " + l.below : "above " + l.above} <span class="kind kind-${l.kind}">${esc(l.kind)}</span> <a class="src-link" href="${esc(l.source?.url || "")}" target="_blank" rel="noopener">${esc(l.source?.title || "")}</a>`).join("<br>");
    el.innerHTML = `<p class="note">There is no cabin sensor in this build: these values come from the simulator and the demo panel, so they are always SIM.</p>
      <div class="cabin-big two" style="margin-top:var(--s-4)">
        <div class="card rcard"><span class="label">Oxygen</span><span class="big-stat num">${esc(fmt(c.oxygen_pct))}<small class="note"> %</small></span>${badgeHTML("SIM")}<p class="fine">${lv("cabin.oxygen_pct")}</p></div>
        <div class="card rcard"><span class="label">Carbon dioxide</span><span class="big-stat num">${esc(fmt(c.co2_ppm))}<small class="note"> ppm</small></span>${badgeHTML("SIM")}<p class="fine">${lv("cabin.co2_ppm")}</p></div>
      </div>
      <h3>Status</h3><p>${c.alert ? "Out of range. Flagged to ground with the one-way signal delay shown in the banner (SIM)." : "Both within limits."}</p>
      <p class="fine">CO2 limit from NASA-STD-3001 V2 6004 (3 mmHg one-hour average, converted at 760 mmHg). The oxygen alarm level is a clinical reference, not a NASA limit.</p>`;
  };
  draw();
  const t = setInterval(draw, 1500);
  return () => { clearInterval(t); cleanups.forEach((f) => { try { f(); } catch { /* chart already gone */ } }); };
}

// ---------- settings: theme, camera, microphone, voice ----------
function renderSettings(el, ctx) {
  const st = ctx.settings;
  el.innerHTML = `
    <h3>Sentinel's voice</h3><div class="field"><select data-voice></select><span class="hint" data-voice-note></span></div>
    <p style="margin-top:var(--s-3)"><button class="pill pill-ghost" type="button" data-test-voice>Test voice</button> <span class="note" data-voice-res aria-live="polite"></span></p>
    <h3>You and the mission</h3>
    <div class="hub">${[["profile", "My health profile", "Allergies, wellbeing plan, buddy, consent"], ["environment", "Environment and mode", "Station, transit, base; routine, EVA, rest"], ["onboarding", "First run", "Consent, kit, voice, calibration"], ["kit", "Medical kit", "On board, filtered for you"]].map(([k, t, d]) => `<button type="button" data-set-open="${k}"><strong>${t}</strong><span>${d}</span></button>`).join("")}</div>
    <h3>Theme</h3>
    <div class="mood-row"><button type="button" data-theme-set="dark" aria-pressed="${document.documentElement.dataset.theme !== "light"}">Space (dark)</button><button type="button" data-theme-set="light" aria-pressed="${document.documentElement.dataset.theme === "light"}">Clinical light</button></div>
    <h3>Glove mode</h3>
    <div class="mood-row"><button type="button" data-glove="off" aria-pressed="${document.documentElement.dataset.glove !== "on"}">Off</button><button type="button" data-glove="on" aria-pressed="${document.documentElement.dataset.glove === "on"}">On: larger targets</button></div>
    <p class="hint fine">For gloved hands: every control on the body screen becomes at least 56 px.</p>
    <h3>Camera</h3><div class="field"><select data-cam><option value="">Default (built-in)</option></select><span class="hint">Used for the face scan and the camera pulse. Remembered in this browser.</span></div>
    <h3>Camera mood analysis</h3>
    <div class="mood-row"><button type="button" data-mood-optin="on" aria-pressed="${st.get(`mood_optin:${ctx.view.crewId}`) !== "off"}">On</button><button type="button" data-mood-optin="off" aria-pressed="${st.get(`mood_optin:${ctx.view.crewId}`) === "off"}">Off</button></div>
    <p class="hint fine">For the current crew member. On: about once a second the face scan sends a face crop to the model on this laptop to read expression; no image is stored. Off: no face crop is sent and expression is not read; pulse and breathing still work.</p>
    <h3>Microphone</h3><div class="field"><select data-mic><option value="">Default</option></select><span class="hint">Used for listening, talk time, pitch and speaker ID.</span></div>
    <h3>Language</h3>
    <div class="mood-row lang-row">${LANGUAGES.map((l) => `<button type="button" data-lang-set="${l.code}" aria-pressed="${cleanLang(localStorage.getItem("sentinel_voice_language") || "en") === l.code}" title="${esc(l.engine)}">${esc(l.name)}${l.native !== l.name ? ` <span class="fine">${esc(l.native)}</span>` : ""}</button>`).join("")}</div>
    <p class="hint fine">English is spoken by the ElevenLabs voice above (ElevenLabs voices speak English). Twi, Ewe, Ga, Fante, Dagbani and Yoruba go through Khaya AI (GhanaNLP): it hears you in that language, Sentinel thinks in English, and Khaya translates and speaks the answer. Critical safety alerts also play in English. You can also say "speak Ewe" or "speak English".</p>
    <p class="hint fine" data-twi-status aria-live="polite"></p>
    <h3>Listening</h3>
    <div class="mood-row"><button type="button" data-listen="wake" aria-pressed="${st.get("listen") !== "ptt"}">Wake phrase</button><button type="button" data-listen="ptt" aria-pressed="${st.get("listen") === "ptt"}">Push to talk only</button></div>
    <p class="hint fine">Wake phrase: say "Hey Sentinel" any time. Push to talk: tap the microphone or the orb, then speak.</p>`;
  el.querySelectorAll("[data-set-open]").forEach((b) => b.addEventListener("click", () => api_.open(b.dataset.setOpen)));
  el.querySelectorAll("[data-theme-set]").forEach((b) => b.addEventListener("click", () => {
    ctx.setTheme?.(b.dataset.themeSet);
    el.querySelectorAll("[data-theme-set]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  el.querySelectorAll("[data-glove]").forEach((b) => b.addEventListener("click", () => {
    ctx.setGlove?.(b.dataset.glove === "on");
    el.querySelectorAll("[data-glove]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  el.querySelectorAll("[data-mood-optin]").forEach((b) => b.addEventListener("click", () => {
    st.set(`mood_optin:${ctx.view.crewId}`, b.dataset.moodOptin);
    el.querySelectorAll("[data-mood-optin]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  el.querySelectorAll("[data-listen]").forEach((b) => b.addEventListener("click", () => {
    st.set("listen", b.dataset.listen); ctx.applyListening?.();
    el.querySelectorAll("[data-listen]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  el.querySelectorAll("[data-lang-set]").forEach((b) => b.addEventListener("click", () => {
    const l = b.dataset.langSet;
    try { localStorage.setItem("sentinel_voice_language", l); } catch {}
    globalThis.language = l;
    if (globalThis.setSentinelLanguage) globalThis.setSentinelLanguage(l);
    el.querySelectorAll("[data-lang-set]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  // Twi voice status: Khaya's plan has a call allowance; when it is used up Twi shows on screen and is spoken in English
  fetch("../api/twi/health").then((r) => r.json()).then((h) => {
    const n = el.querySelector("[data-twi-status]");
    if (!n) return;
    if (h.ok) n.textContent = "Local-language voice (Khaya AI): ready.";
    else if (h.resting_until) n.textContent = `Local-language voice: Khaya's call allowance is used up until ${new Date(h.resting_until).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}. Until then the translation is shown on screen and spoken in English.`;
    else n.textContent = "Local-language voice: Khaya can't be reached right now; replies are spoken in English.";
  }).catch(() => {});
  (async () => {
    try {
      const devs = await navigator.mediaDevices?.enumerateDevices?.() || [];
      const fill = (sel, kind, key) => {
        devs.filter((d) => d.kind === kind).forEach((d, i) => sel.insertAdjacentHTML("beforeend", `<option value="${esc(d.deviceId)}">${esc(d.label || `${kind === "videoinput" ? "Camera" : "Microphone"} ${i + 1}`)}</option>`));
        sel.value = st.get(key) || "";
        sel.addEventListener("change", () => { st.set(key, sel.value); ctx.onDeviceChange?.(key); });
      };
      fill(el.querySelector("[data-cam]"), "videoinput", "camera");
      fill(el.querySelector("[data-mic]"), "audioinput", "mic");
    } catch { /* no device list */ }
    try {
      const v = await api.json("../api/voices");
      const sel = el.querySelector("[data-voice]");
      const opt = (x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`;
      const group = (label, list) => (list.length ? `<optgroup label="${label}">${list.map(opt).join("")}</optgroup>` : "");
      sel.innerHTML = group("Male voices", v.elevenlabs.filter((x) => x.gender === "male")) + group("Female voices", v.elevenlabs.filter((x) => x.gender === "female"));
      if (!sel.options.length) sel.innerHTML = "<option>Browser voice</option>";
      sel.value = st.get("voice") || v.default;
      el.querySelector("[data-voice-note]").textContent = "Or say \"use a female voice\", \"switch to Jon\". If the voice service can't be reached, the browser's own voice reads the words.";
      sel.addEventListener("change", () => { st.set("voice", sel.value); ctx.setVoice?.(sel.value); });
    } catch { el.querySelector("[data-voice]").innerHTML = `<option>Browser voice</option>`; }
  })();
  el.querySelector("[data-test-voice]").addEventListener("click", async (e) => {
    const b = e.currentTarget, res = el.querySelector("[data-voice-res]");
    b.disabled = true; res.textContent = "Playing…";
    try {
      const r = await ctx.testVoice();
      const name = { elevenlabs: "ElevenLabs", kokoro: "Kokoro (this laptop)", browser: "the browser's voice" }[r.engine] || r.engine;
      res.textContent = `Played by ${name}.${r.engine === "browser" ? " The server voices were unavailable; see the console." : ""}`;
    } catch (err) { res.textContent = `No voice: ${err.message}`; }
    b.disabled = false;
  });
}

const FEATURES = { radiation: "Radiation", vitals: "Vitals", body: "Body", face_voice: "Face and voice", wellbeing: "Wellbeing", integration: "Cabin and integration" };
/** Every NASA JSC 28913 MRID in the dataset: searchable, grouped by the Sentinel feature it informs. */
async function renderEvidence(el, ctx, arg) {
  el.innerHTML = `<p class="note">The team's dataset: NASA JSC 28913 Medical Requirements Integration Documents. Each entry is the document's own wording, parsed from the PDF. Sentinel is designed around these requirements; it does not claim to implement them.</p>
    <div class="ev-tools"><input type="search" data-q placeholder="Search: ECG, radiation, noise, bone, water…" aria-label="Search the NASA documents" value="${esc(arg?.q || "")}">
    <div class="ev-chips" role="tablist"><button type="button" data-f="" aria-pressed="true">All</button>${Object.entries(FEATURES).map(([k, v]) => `<button type="button" data-f="${k}" aria-pressed="false">${v}</button>`).join("")}</div></div>
    <p class="fine" data-count></p><div class="ev-list" data-list><p class="note">Loading the documents…</p></div>
    <p><button class="pill pill-ghost" type="button" data-nlsp>NASA research datasets (Life Sciences Portal)</button></p>`;
  el.querySelector("[data-nlsp]").addEventListener("click", () => api_.open("datasets"));
  let data = ctx.mrid;
  if (!data) { try { data = ctx.mrid = await (await fetch("../shared/nasa_mrid.json")).json(); } catch { el.querySelector("[data-list]").innerHTML = `<p class="note">Could not load shared/nasa_mrid.json.</p>`; return; } }
  let feat = arg?.feature || "";
  const list = el.querySelector("[data-list]"), q = el.querySelector("[data-q]");
  const block = (h, v) => (v ? `<h4>${h}</h4><p>${esc(v)}</p>` : "");
  const draw = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const docs = data.documents.filter((d) => (!feat || d.features.includes(feat)) &&
      words.every((w) => `${d.id} ${d.title} ${d.purpose} ${d.parameters} ${d.zones.join(" ")} ${d.indicators.join(" ")}`.toLowerCase().includes(w)));
    el.querySelector("[data-count]").textContent = `${docs.length} of ${data.count} documents`;
    list.innerHTML = docs.map((d) => `<details class="ev-doc"><summary><b>${esc(d.id)}</b><span>${esc(d.title)}</span><small>${d.features.map((x) => FEATURES[x] || x).join(" · ")}</small></summary>
      ${block("Why NASA does it", d.purpose)}${block("What is measured", d.parameters)}${block("Deliverables", d.deliverables)}
      ${block("Preflight", d.preflight)}${block("In flight", d.inflight)}${block("Postflight", d.postflight)}
      ${d.limits.length ? `<h4>Numbers it states</h4><ul class="ev-lim">${d.limits.slice(0, 8).map((l) => `<li><b>${esc(l.value)}</b> ${esc(l.context)}</li>`).join("")}</ul>` : ""}
      <p class="fine">Informs: ${d.zones.length ? `body zones ${esc(d.zones.join(", "))}; ` : ""}${d.indicators.length ? `readings ${esc(d.indicators.join(", "))}. ` : ""}Owner ${esc(d.owner || "")}. ${d.pages} pages, <code>dataset/${esc(d.file)}</code></p></details>`).join("") || `<p class="note">No document matches.</p>`;
  };
  q.addEventListener("input", draw);
  el.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
    feat = b.dataset.f; el.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw();
  }));
  if (feat) el.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.f === feat)));
  draw();
}

function renderAbout(el) {
  setTimeout(() => el.querySelector("[data-open-evidence]")?.addEventListener("click", (e) => { e.preventDefault(); ctxRef.screens?.open?.("evidence") ?? show("evidence"); }), 0);
  el.innerHTML = `<p>Sentinel is an onboard crew-health companion built for the NASA Space Apps Challenge 2026. It describes change from each person's own baseline and never diagnoses.</p>
    <h3>Why: Earth-Independent Medical Operations</h3>
    <p class="note">NASA describes EIMO as "the gradual transfer of medical care and decision-making from Earth-based support to space-based systems". On a Mars transit there is no evacuation and a message to ground takes minutes each way, so care must be crew- and vehicle-reliant. Sentinel is designed around that problem: it monitors, explains change from baseline, guides the next step (a guided exam, the reaction test, a breathing break) and packages findings for delayed ground review. Source: <a href="https://ntrs.nasa.gov/citations/20240001402" target="_blank" rel="noopener">NASA EIMO Concept of Operations, NTRS 20240001402</a> (a concept, not a flown system).</p>
    <p class="note">It also echoes NASA's work on one integrated crew-health data layer (CHP-IDA / CHP-IDSP, in development): many sources, one record, actionable output. The reaction test is "like the ISS Reaction Self Test"; the weekly set is "inspired by" NASA Spaceflight Standard Measures.</p>
    <p class="fine">What Sentinel does not claim: it does not meet or implement NASA-STD-3001, EIMO or CHP-IDA, it is not the NASA Cognition battery or the Reaction Self Test, and it is not a medical device.</p>
    <h3>Credits</h3>
    <ul class="credits">
      <li>Planet textures: Solar System Scope (CC BY 4.0), based on NASA imagery.</li>
      <li>Body models: generated with MakeHuman / MPFB (CC0 base mesh).</li>
      <li>Anatomy: BodyParts3D, (c) The Database Center for Life Science (DBCLS), CC BY 4.0, grouped into 18 systems and fitted to each body.</li>
      <li>Voice: ElevenLabs (premade voices, flash model); Kokoro text-to-speech (Apache 2.0) on this laptop as the fallback.</li>
      <li>Speech recognition: Whisper (whisper-large-v3-turbo on Groq; faster-whisper base.en on this laptop offline). Brain: openai/gpt-oss-120b on Groq.</li>
      <li>Space weather: NOAA Space Weather Prediction Center (GOES proton flux, NOAA scales); storm replay from NASA DONKI.</li>
      <li>Health thresholds and facts: NASA-STD-3001, NASA Human Research Program and OCHMO briefs, CDC, AHA, ADA, MedlinePlus (see shared/SOURCES.md).</li>
      <li>NASA JSC 28913 Medical Requirements Integration Documents: all 68 in the team dataset, parsed and listed on the <a href="#" data-open-evidence>Evidence screen</a>.</li>
      <li>COSMOcare logo: the COSMOcare team.</li>
      <li>Sentinel Skin design draws on CSA Astroskin, MIT's bioadhesive ultrasound patch and NASA ocular health research (sources on the hardware screen).</li>
      <li>Libraries: three.js (MIT), GSAP, Chart.js (MIT), MediaPipe Tasks Vision (Apache 2.0). Fonts: Inter and Michroma (SIL OFL).</li>
    </ul>
    <h3>About the X-ray</h3>
    <p class="note">The X-ray is a visualisation of a reference anatomy, not your own scan. It comes from one adult male specimen (BodyParts3D), fitted to both the male and the female body. The dataset has no lung tissue, so the lungs are generated to fit the real ribcage. The readings that drive it keep their own LIVE or SIM badges.</p>
    <h3>Badges</h3>
    <div class="legend" style="color:var(--ink-2)"><span class="badge badge-live">LIVE</span><span>measured or computed now</span><span class="badge badge-sim">SIM</span><span>prepared or simulated on purpose</span><span class="badge badge-designed">DESIGNED</span><span>a design, not running</span></div>`;
}
