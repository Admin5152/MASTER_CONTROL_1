// Screen manager. Stages (assistant, mission, body, vision, radiation) go through the stage manager;
// everything else opens in the side sheet so detail is one tap away and the stage stays in view.
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
  registerScreen("zone", { title: "Body system", render: renderZone });
  registerScreen("health_log", { title: "Health log", badge: "LIVE", render: renderHealthLog });
  registerScreen("trends", { title: "Trends", render: renderTrends });
  registerScreen("crew", { title: "Crew", render: renderCrew });
  registerScreen("more", { title: "More", render: renderHub });
  registerScreen("cabin", { title: "Cabin air", badge: "SIM", render: renderCabin });
  registerScreen("settings", { title: "Settings", render: renderSettings });
  registerScreen("about", { title: "About and credits", render: renderAbout });
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
  const draw = () => {
    const { state, aux } = ctx.view;
    const f = ctx.facts.zones[zone] || {};
    const readings = zoneReadings(zone, state, aux);
    const sev = aux?.assessment?.zones?.[zone] || "ok";
    const rows = readings.map((r) => `<tr>
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
    el.innerHTML = `
      <h3>Your readings <span class="co-sev st-cell st-${statusKey(sev)}">${statusHTML(sev)}</span></h3>
      ${rows ? `<table class="readings"><thead><tr><th>Reading</th><th>Value</th><th>Source</th><th>Status</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="note">No readings for this area yet.</p>`}
      <p style="margin-top:var(--s-4)" class="zone-acts"><button class="pill pill-dark" type="button" data-check>Check this area</button> <button class="pill pill-ghost" type="button" data-hurt>Log a symptom</button></p>
      ${f.how_to_measure ? `<h3>How to measure</h3><p data-how>${esc(f.how_to_measure)}</p>` : ""}
      ${f.why_it_matters ? `<h3>Why it matters</h3><p data-why>${esc(f.why_it_matters)}</p>` : ""}
      ${f.mrids?.length ? `<p class="fine mrids" data-mrids>Source: ${esc(ctx.facts.mrid_source?.title || "NASA MRIDs")}: ${f.mrids.map((m) => `<span class="mrid" title="${esc(m.file)}">${esc(m.id)} ${esc(m.title)}</span>`).join("; ")}. Designed around these requirements, not an implementation of them.</p>` : ""}
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
    el.querySelector("[data-hurt]")?.addEventListener("click", () => api_.open("symptom"));
  };
  draw();
  const t = setInterval(() => { if (!el.contains(document.activeElement) && !el.querySelector("details[open]")) draw(); }, 3000);
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
        <input id="f-${f.key}" name="${f.key}" type="number" inputmode="decimal" min="${f.min}" max="${f.max}" step="${f.step}" placeholder="last: ${esc(fmt(m[f.key], "manual." + f.key))}${badgeFor("manual." + f.key, ctx.view.state, ctx.view.aux) === "LIVE" ? " (LIVE)" : " (SIM)"}">
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
    <p><button class="pill pill-dark pill-block" type="button" data-save>Save health log</button></p>
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
  el.innerHTML = `<div class="quick" style="display:flex;flex-wrap:wrap;position:static" role="tablist">${Object.entries(METRIC_DEFS).map(([k, d]) =>
    `<button class="chip" type="button" role="tab" data-m="${k}" aria-selected="${k === m}">${esc(d.label)}</button>`).join("")}</div>
    <div data-chart style="margin-top: var(--s-4)"></div>`;
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
    <div class="hub" style="margin-top:var(--s-4)">${ctx.view.crew.map((c) => `<button type="button" data-crew="${esc(c.crew_id)}"><strong>${esc(c.display_name)}</strong><span>${c.crew_id === ctx.view.crewId ? "Using Sentinel now" : "Switch to"}</span></button>`).join("")}</div>`;
  el.querySelectorAll("[data-crew]").forEach((b) => b.addEventListener("click", () => { ctx.setCrew(b.dataset.crew, "manual"); closeScreen(); }));
}

// ---------- the More hub: everything else, grouped ----------
function renderHub(el, ctx) {
  const groups = [
    ["Check-ins", [["health_log", "Health log", "Blood pressure, glucose, temperature, sleep, mood"], ["cognitive", "Cognitive check", "25-second reaction test"], ["trends", "Trends", "Every reading over time"]]],
    ["Wellbeing", [["orb_calm", "Stillpoint", "A breathing game, tracked by heart rate"], ["race", "Slipstream", "Race past the planets; boost and draft"], ["greenhouse", "Red Harvest", "Farm on Mars: grow crops, fill crew orders"], ["wellbeing", "Wellbeing hub", "Stillpoint, Slipstream, Red Harvest and the science"], ["interventions", "Suggestions", "What Sentinel recommends now"]]],
    ["Crew and ship", [["crew", "Crew", "Who is using Sentinel"], ["cabin", "Cabin air", "Oxygen and carbon dioxide (SIM)"], ["hardware", "Sentinel Skin", "The wearable design (DESIGNED)"], ["settings", "Settings", "Theme, camera, microphone, voice"], ["about", "About and credits", "Sources and licences"]]],
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
  return () => clearInterval(t);
}

// ---------- settings: theme, camera, microphone, voice ----------
function renderSettings(el, ctx) {
  const st = ctx.settings;
  el.innerHTML = `
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
    <h3>Sentinel's voice</h3><div class="field"><select data-voice></select><span class="hint" data-voice-note></span></div>
    <p style="margin-top:var(--s-3)"><button class="pill pill-ghost" type="button" data-test-voice>Test voice</button> <span class="note" data-voice-res aria-live="polite"></span></p>
    <h3>Listening</h3>
    <div class="mood-row"><button type="button" data-listen="wake" aria-pressed="${st.get("listen") !== "ptt"}">Wake phrase</button><button type="button" data-listen="ptt" aria-pressed="${st.get("listen") === "ptt"}">Push to talk only</button></div>
    <p class="hint fine">Wake phrase: say "Hey Sentinel" any time. Push to talk: tap the microphone or the orb, then speak.</p>`;
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
      sel.innerHTML = (v.elevenlabs.length ? `<optgroup label="ElevenLabs">${v.elevenlabs.map(opt).join("")}</optgroup>` : "") +
        (v.kokoro.length ? `<optgroup label="On this laptop (Kokoro)">${v.kokoro.map(opt).join("")}</optgroup>` : "");
      if (!sel.options.length) sel.innerHTML = "<option>Browser voice</option>";
      sel.value = st.get("voice") || v.default;
      el.querySelector("[data-voice-note]").textContent = v.elevenlabs.length
        ? "ElevenLabs speaks first; Kokoro on this laptop takes over offline; the browser voice is the last resort."
        : "Kokoro runs on this laptop; the browser voice is the fallback.";
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

function renderAbout(el) {
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
      <li>Sentinel Skin design draws on CSA Astroskin, MIT's bioadhesive ultrasound patch and NASA ocular health research (sources on the hardware screen).</li>
      <li>Libraries: three.js (MIT), GSAP, Chart.js (MIT), MediaPipe Tasks Vision (Apache 2.0). Fonts: Inter and Michroma (SIL OFL).</li>
    </ul>
    <h3>About the X-ray</h3>
    <p class="note">The X-ray is a visualisation of a reference anatomy, not your own scan. It comes from one adult male specimen (BodyParts3D), fitted to both the male and the female body. The dataset has no lung tissue, so the lungs are generated to fit the real ribcage. The readings that drive it keep their own LIVE or SIM badges.</p>
    <h3>Badges</h3>
    <div class="legend" style="color:var(--ink-2)"><span class="badge badge-live">LIVE</span><span>measured or computed now</span><span class="badge badge-sim">SIM</span><span>prepared or simulated on purpose</span><span class="badge badge-designed">DESIGNED</span><span>a design, not running</span></div>`;
}
