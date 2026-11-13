// Screen manager: the sheet that opens over the orb and camera columns, plus the
// screens that are plain panels (zone info, health log, trends, crew).
import { api } from "../core/api.js";
import { emit } from "../core/bus.js";
import { renderTrend, METRIC_DEFS } from "./charts.js";
import { ZONE_NAMES, badgeHTML, esc, fmt, statusWord, zoneReadings } from "./readings.js";

const sheet = () => document.getElementById("sheet");
const registry = new Map(); // name -> { title, badge, wide, render(el, ctx) -> cleanup }
let cleanupFn = null;
let currentName = null;
let ctxRef = null;

export function registerScreen(name, def) { registry.set(name, def); }
export function currentScreen() { return currentName; }

export function initScreens(ctx) {
  ctxRef = ctx;
  document.getElementById("sheet-close").addEventListener("click", () => closeScreen());
  registerScreen("zone", { title: "Body system", render: renderZone });
  registerScreen("health_log", { title: "Health log", badge: "LIVE", render: renderHealthLog });
  registerScreen("trends", { title: "Trends", render: renderTrends });
  registerScreen("crew", { title: "Crew", render: renderCrew });
  return api_;
}

function show(name, arg) {
  const def = registry.get(name);
  if (!def) return;
  closeScreen(true);
  const el = sheet();
  currentName = name;
  el.hidden = false;
  el.classList.toggle("is-wide", !!def.wide);
  el.dataset.screen = name;
  document.getElementById("sheet-title").textContent = typeof def.title === "function" ? def.title(arg) : def.title;
  const badge = typeof def.badge === "function" ? def.badge(arg) : def.badge;
  document.getElementById("sheet-badge").innerHTML = badge ? badgeHTML(badge) : "";
  const body = document.getElementById("sheet-body");
  body.innerHTML = "";
  body.scrollTop = 0;
  try {
    const c = def.render(body, ctxRef, arg);
    cleanupFn = typeof c === "function" ? c : c?.then ? null : null;
    if (c?.then) c.then((fn) => { if (currentName === name && typeof fn === "function") cleanupFn = fn; });
  } catch (err) {
    console.warn("screen failed", name, err);
    body.innerHTML = `<p class="note">This screen could not load: ${esc(err.message)}</p>`;
  }
  if (window.gsap && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.gsap.fromTo(el, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" });
  }
  emit("screen:open", name);
}

export function closeScreen(silent = false) {
  if (cleanupFn) { try { cleanupFn(); } catch {} }
  cleanupFn = null;
  const was = currentName;
  currentName = null;
  sheet().hidden = true;
  document.getElementById("sheet-body").innerHTML = "";
  if (!silent && was) emit("screen:close", was);
}

const api_ = {
  open(name, arg) {
    if (name === "home") { closeScreen(); return; }
    if (name === "vision") { closeScreen(); emit("vision:open"); return; }
    show(name, arg);
  },
  chart(metric) { show("trends", metric); },
  zone(zone) { show("zone", zone); },
  intervention(name) { emit("intervention:open", name); },
  close() { closeScreen(); },
  current: () => currentName,
};

// ---------- zone panel ----------
function renderZone(el, ctx, zone) {
  document.getElementById("sheet-title").textContent = ZONE_NAMES[zone] || zone;
  const draw = () => {
    const { state, aux } = ctx.view;
    const f = ctx.facts.zones[zone] || {};
    const readings = zoneReadings(zone, state, aux);
    const sev = aux?.assessment?.zones?.[zone] || "ok";
    const rows = readings.map((r) => `<tr>
        <td>${esc(r.label)}</td>
        <td class="num"><strong>${esc(fmt(r.value, r.field))}</strong> ${esc(r.unit || "")}</td>
        <td>${badgeHTML(r.badge)}</td>
        <td class="st-${r.severity === "info" ? "watch" : r.severity}">${statusWord(r.severity)}</td>
        <td class="note">${esc(r.change || "")}</td></tr>`).join("");
    const ths = readings.flatMap((r) => (r.levels || []).map((l) => `<li>${esc(r.label)}: ${esc(l.severity)} ${l.below != null ? "below " + l.below : "above " + l.above} ${esc(r.unit || "")}.
        <span class="kind kind-${l.kind}">${esc(l.kind)}</span> ${l.source.url ? `<a class="src-link" href="${esc(l.source.url)}" target="_blank" rel="noopener">${esc(l.source.title)}</a>` : esc(l.source.title)}</li>`)).join("");
    const extra = zone === "bones"
      ? `<p>${badgeHTML("DESIGNED")} Exercise log: the wearable's accelerometer would log resistance exercise here. Not running in this build.</p>` : "";
    const rad = zone === "whole_body" ? `<p class="note">The radiation layer is shown on the body model. Effects NASA tracks: cancer risk, central nervous system and cognitive effects, cardiovascular effects, and cataracts. Because radiation cannot be felt, Sentinel asks for the cognitive check so a trend is noticed early. This is not a diagnosis.</p>
      <button class="btn" type="button" data-open="radiation">Open Radiation Watch</button>` : "";
    el.innerHTML = `
      <div class="cols">
        <div>
          <h3>What it does</h3><p>${esc(f.what || "")}</p>
          <h3>In spaceflight</h3><p>${esc(f.spaceflight || "")}</p>
          <p class="note">NASA hazard: ${esc(f.hazard || "")}. Source: <a href="${esc(f.source?.url || "")}" target="_blank" rel="noopener">${esc(f.source?.title || "")}</a></p>
          ${extra}${rad}
        </div>
        <div>
          <h3>Your readings <span class="co-sev st-${sev}">${statusWord(sev)}</span></h3>
          ${rows ? `<table class="readings"><thead><tr><th>Reading</th><th>Value</th><th>Source</th><th>Status</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="note">No readings for this area yet.</p>`}
          <h3>Thresholds and where they come from</h3>
          ${ths ? `<ul class="note">${ths}</ul>` : `<p class="note">No numeric threshold applies to this area in this build.</p>`}
          <h3>What to do next</h3><p>${esc(f.next || "")}</p>
          <p class="note">Sentinel describes change from your own baseline. It does not diagnose; anything that worries you is a question for the flight surgeon.</p>
        </div>
      </div>`;
    el.querySelector("[data-open]")?.addEventListener("click", () => api_.open("radiation"));
  };
  draw();
  const t = setInterval(() => { if (!el.contains(document.activeElement)) draw(); }, 3000);
  return () => clearInterval(t);
}

// ---------- manual health log ----------
const FIELDS = [
  { key: "bp_systolic", label: "Blood pressure, systolic", unit: "mmHg", min: 60, max: 250, step: 1,
    hint: "Cuff on the upper arm at heart level; sit strapped in so the arm is not floating.", why: "Fluid shifts toward the head in weightlessness change how the heart and vessels work." },
  { key: "bp_diastolic", label: "Blood pressure, diastolic", unit: "mmHg", min: 30, max: 150, step: 1,
    hint: "Read from the same cuff measurement.", why: "Together with systolic it shows cardiovascular load." },
  { key: "glucose_mgdl", label: "Blood glucose", unit: "mg/dL", min: 20, max: 600, step: 1,
    hint: "Finger-stick meter; wick the drop onto the strip, it will not fall in microgravity.", why: "Diet is planned months ahead; glucose shows how meals and activity are balanced." },
  { key: "temp_c", label: "Body temperature", unit: "°C", min: 33, max: 43, step: 0.1,
    hint: "Under the tongue or in the ear; the cabin is often warm, so rest five minutes first.", why: "Fever is an early sign that an infection may warrant a check." },
  { key: "sleep_hours", label: "Sleep last night", unit: "hours", min: 0, max: 16, step: 0.25,
    hint: "Count from lights-out in the sleep station, not from the schedule.", why: "Light cycles every 90 minutes in orbit; sleep loss slows reaction time." },
];

function renderHealthLog(el, ctx) {
  const m = ctx.view.state?.manual || {};
  let mood = null;
  el.innerHTML = `
    <p class="note">These readings are LIVE: you enter them. Sentinel compares them with your own usual values and the clinical reference ranges shown in each body panel.</p>
    <form class="form-grid" novalidate>
      ${FIELDS.map((f) => `<div class="field" data-key="${f.key}">
        <label for="f-${f.key}">${esc(f.label)} <span class="note">(${esc(f.unit)})</span></label>
        <input id="f-${f.key}" name="${f.key}" type="number" inputmode="decimal" min="${f.min}" max="${f.max}" step="${f.step}" placeholder="last: ${esc(fmt(m[f.key], "manual." + f.key))}">
        <span class="hint">How in microgravity: ${esc(f.hint)}</span>
        <span class="why">Why it matters: ${esc(f.why)}</span>
        <span class="err" aria-live="polite"></span></div>`).join("")}
      <div class="field" data-key="mood">
        <label>Mood today <span class="note">(1 low to 5 good)</span></label>
        <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-mood="${n}" aria-pressed="false">${n}</button>`).join("")}</div>
        <span class="hint">Tap the number that fits right now; there is no right answer.</span>
        <span class="why">Why it matters: isolation and confinement is one of NASA's five hazards.</span>
      </div>
      <div class="field" data-key="symptoms">
        <label for="f-symptoms">Symptoms</label>
        <input id="f-symptoms" type="text" placeholder="e.g. headache, nausea, dry eyes">
        <span class="hint">Separate with commas. Sentinel checks the onboard kit list (SIM) and never suggests anything not stocked.</span>
        <span class="why">Why it matters: early symptoms are easier to manage before they grow.</span>
      </div>
    </form>
    <p><button class="btn btn-primary btn-big" type="button" data-save>Save health log</button></p>
    <p class="note" data-result aria-live="polite"></p>`;
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
        wrap.querySelector(".err").textContent = `Enter a value between ${f.min} and ${f.max} ${f.unit}.`;
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
    const sym = el.querySelector("#f-symptoms").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    out.symptoms = sym;
    out.updated = new Date().toISOString();
    const result = el.querySelector("[data-result]");
    try {
      const s = await ctx.patch({ manual: out });
      ctx.onCheckin?.("log");
      const a = s.action;
      result.textContent = a.type === "none" ? "Saved. Everything is within your usual range." : `Saved. ${a.detail}`;
      ctx.say(a.type === "none" ? "Saved. Thank you." : `Saved. ${a.detail}`);
    } catch (e) {
      result.textContent = `Not saved: ${e.message}. Check the brain link at the top right.`;
    }
  });
}

// ---------- trends ----------
function renderTrends(el, ctx, metric) {
  const m = metric && METRIC_DEFS[metric] ? metric : "heart_rate";
  el.innerHTML = `<div class="quick" role="tablist">${Object.entries(METRIC_DEFS).map(([k, d]) =>
    `<button class="chip" type="button" role="tab" data-m="${k}" aria-selected="${k === m}">${esc(d.label)}</button>`).join("")}</div>
    <div data-chart style="margin-top: var(--s-3)"></div>`;
  let cleanup = () => {};
  const load = async (k) => {
    cleanup();
    el.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.m === k)));
    document.getElementById("sheet-title").textContent = `Trend: ${METRIC_DEFS[k].label}`;
    cleanup = await renderTrend(el.querySelector("[data-chart]"), ctx.view.crewId, k, ctx.view.state, ctx.thresholds);
  };
  el.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => load(b.dataset.m)));
  load(m);
  return () => cleanup();
}

// ---------- crew ----------
function renderCrew(el, ctx) {
  el.innerHTML = `<p class="note">Choose who is using Sentinel. A manual choice is badged <span class="badge badge-sim">manual</span>; a voice match is badged LIVE.</p>
    <div class="form-grid">${ctx.view.crew.map((c) => `<button class="btn btn-big" type="button" data-crew="${esc(c.crew_id)}">${esc(c.display_name)}</button>`).join("")}</div>`;
  el.querySelectorAll("[data-crew]").forEach((b) => b.addEventListener("click", () => { ctx.setCrew(b.dataset.crew, "manual"); closeScreen(); }));
}
