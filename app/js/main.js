// Sentinel frontend entry point: start screen, wiring, polling, routines.
import { api } from "./core/api.js";
import { emit, on } from "./core/bus.js";
import { createDirector } from "./core/director.js";
import { matchIntent } from "./core/intents.js";
import { audioContext, cue, setMuted, isMuted } from "./core/sound.js";
import { patch, pollOnce, setCrew, startPolling, view } from "./core/state.js";
import * as body from "./interface/body.js";
import { createBanner } from "./interface/banner.js";
import { createDemoPanel } from "./interface/demopanel.js";
import { createOrb } from "./interface/orb.js";
import { ZONE_NAMES, badgeFor, badgeHTML, esc, zoneReadings } from "./interface/readings.js";
import { closeScreen, initScreens, registerScreen } from "./interface/screens.js";
import { invalidateSparks, mountTiles, refreshSparks, renderTiles } from "./interface/tiles.js";
import { renderAurora } from "./experience/aurora.js";
import { plantSVG, renderGreenhouse } from "./experience/greenhouse.js";
import { renderHardware } from "./experience/hardware.js";
import { INTERVENTIONS, renderConnection, renderEarth, renderMenu, renderMusic } from "./experience/interventions.js";
import { greenhouseDay, routineComplete } from "./experience/logic.js";
import { renderOrbCalm } from "./experience/orbcalm.js";
import { renderCognitive } from "./systems/cognitive.js";
import { renderRadiation } from "./systems/radiation.js";
import { createVision } from "./vision/vision.js";
import * as voiceMod from "./voice/voice.js";

const $ = (id) => document.getElementById(id);
const ctx = { view, patch, health: {}, facts: { facts: [], zones: {} }, thresholds: null, demoLines: {} };
window.sentinel = ctx; // for the browser test harness and debugging
let orb, director, banner, vision, demoPanel, screens;
let lastZone = "";
let lastActionKey = "";
let speakingQueue = Promise.resolve();

// ---------- boot (before the start tap) ----------
async function boot() {
  const startOrb = createOrb($("start-orb"), { small: true });
  ctx.startOrb = startOrb;
  try {
    [ctx.facts, ctx.thresholds, ctx.demoLines] = await Promise.all([
      api.json("../shared/facts.json"), api.json("../shared/thresholds.json"), api.json("assets/demo_lines.json"),
    ]);
  } catch (e) { console.warn("could not load shared data", e); }
  try { view.crew = await api.crew(); } catch { view.crew = []; }
  try { ctx.health = await api.health(); } catch { ctx.health = {}; }
  $("start-btn").addEventListener("click", start, { once: true });
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

// ---------- the start tap: unlock everything that needs a user gesture ----------
async function start() {
  audioContext();
  voiceMod.unlockSpeech();
  // iPad motion permission must be asked from a tap
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  } catch { /* not iPad */ }
  requestWakeLock();
  $("start-screen").hidden = true;
  $("app").hidden = false;
  ctx.startOrb?.destroy();
  await mountApp();
  // microphone
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      await voiceMod.initMic(mic);
    } catch { note("Microphone not available: type or use the quick buttons."); }
  }
  if (voiceMod.voice.recognitionAvailable) {
    voiceMod.startListening();
    $("btn-mic").setAttribute("aria-pressed", "true");
  } else {
    $("btn-mic").disabled = true;
    note("Speech recognition is not available in this browser: type or use the quick buttons.");
  }
  // camera
  vision.start();
  const name = view.state?.display_name || "";
  say(`Sentinel is ready${name ? `, ${name}` : ""}. Say hey Sentinel, or type below.`);
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      let lock = await navigator.wakeLock.request("screen");
      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible" && lock?.released !== false) { try { lock = await navigator.wakeLock.request("screen"); } catch {} }
      });
    }
  } catch { /* wake lock refused: fine */ }
}

// ---------- app ----------
async function mountApp() {
  orb = createOrb($("orb"));
  ctx.orb = orb;
  await body.mountBody($("body-host"));
  mountTiles($("vitals"), (id) => {
    const t = { dose: "radiation", storm: "radiation" }[id];
    if (t) director.run([{ cmd: "open_screen", name: t }]);
    else director.run([{ cmd: "show_chart", metric: id }]);
  });
  screens = initScreens(ctx);
  ctx.screens = screens;
  ctx.say = say;
  ctx.setCrew = (id, src) => switchCrew(id, src);
  ctx.onCheckin = onCheckin;
  ctx.openIntervention = openIntervention;
  ctx.enrol = enrol;
  ctx.onClockSkip = () => pollOnce();
  registerScreen("radiation", { title: "Radiation Watch", render: renderRadiation });
  registerScreen("cognitive", { title: "Cognitive check", badge: "LIVE", render: renderCognitive });
  registerScreen("orb_calm", { title: "Orb Calm", render: renderOrbCalm });
  registerScreen("aurora_run", { title: "Aurora Run", render: renderAurora });
  registerScreen("greenhouse", { title: "Greenhouse", render: renderGreenhouse });
  registerScreen("hardware", { title: "Wearable hardware", badge: "DESIGNED", wide: true, render: renderHardware });
  registerScreen("interventions", { title: "Suggestions", render: (el, c, arg) => renderMenu(el, c, arg) });
  registerScreen("earth_window", { title: "Earth window", badge: "SIM", render: renderEarth });
  registerScreen("music", { title: "Ambient sound", render: renderMusic });
  registerScreen("connection", { title: "Message a crewmate", badge: "DESIGNED", render: renderConnection });

  director = createDirector({ orb, screens, say: (t) => say(t), getView: () => view, facts: ctx.facts });
  ctx.director = director;
  banner = createBanner({ say });
  demoPanel = createDemoPanel(ctx);
  vision = createVision({
    video: $("cam-video"), overlay: $("cam-overlay"), msg: $("cam-msg"), badge: $("cam-badge"),
    pulseValue: $("pulse-value"), pulseQuality: $("pulse-quality"),
    canPatch: () => !view.aux?.scenario?.running && !view.hrOverride,
    patchHr: (bpm) => patch({ vitals: { heart_rate: bpm, source: "camera", sources: { heart_rate: "camera" } } }).catch(() => {}),
    onFallback: () => {
      if (view.state?.vitals?.sources?.heart_rate === "camera") patch({ vitals: { source: "sim", sources: { heart_rate: "sim" } } }).catch(() => {});
    },
  });
  ctx.vision = vision;

  wireControls();
  wireVoice();
  on("state", onState);
  on("offline", () => { document.body.classList.add("offline"); $("sb-link").textContent = "Brain offline: showing last known values"; });
  on("online", () => { document.body.classList.remove("offline"); $("sb-link").textContent = "Brain online"; });
  on("zone:open", (z) => screens.zone(z));
  on("vision:open", () => { vision.start(); $("col-cam").scrollIntoView?.({ block: "nearest" }); });
  on("intervention:open", openIntervention);
  on("crew:changed", () => { invalidateSparks(); lastZone = ""; });

  const first = view.crew[0]?.crew_id;
  if (first) setCrew(first, "manual");
  startPolling();
  setInterval(() => view.crewId && refreshSparks($("vitals"), view.crewId), 5000);
  setInterval(routineTick, 15000);
  setInterval(refreshSpaceweather, 30000);
  refreshSpaceweather();
  setInterval(() => api.health().then((h) => { ctx.health = h; }).catch(() => {}), 20000);
}

async function refreshSpaceweather() {
  try { view.spaceweather = await api.spaceweather(); } catch { /* keep last */ }
}

function wireControls() {
  $("btn-scan").addEventListener("click", () => director.run([{ cmd: "start_scan" }]));
  $("btn-radlayer").addEventListener("click", (e) => {
    const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
    director.run([{ cmd: "show_radiation", on }]);
  });
  $("btn-hardware").addEventListener("click", () => director.run([{ cmd: "open_screen", name: "hardware" }]));
  $("btn-cam").addEventListener("click", () => (vision.state.on ? vision.stop() : vision.start()));
  $("btn-mute").addEventListener("click", (e) => {
    const m = !isMuted();
    setMuted(m);
    e.currentTarget.setAttribute("aria-pressed", String(m));
  });
  $("sb-crew-name").addEventListener("click", () => director.run([{ cmd: "open_screen", name: "crew" }]));
  $("greenhouse-mini").addEventListener("click", () => director.run([{ cmd: "open_screen", name: "greenhouse" }]));
  window.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select")) return;
    if (e.key === "h" || e.key === "H") director.run([{ cmd: "open_screen", name: "hardware" }]);
    if (e.key === "Escape") { director.cancel(); closeScreen(); }
  });
  $("ask-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("ask-input").value.trim();
    if (!t) return;
    $("ask-input").value = "";
    handleCommand(t, { via: "typed", heard: t });
  });
  // typing drives the orb's listening state when there is no microphone
  let typingT = null;
  $("ask-input").addEventListener("input", () => {
    orb.setState("listening"); orb.setLevel(0.3);
    clearTimeout(typingT);
    typingT = setTimeout(() => { if (orb.getState() === "listening") orb.setState("idle"); orb.setLevel(0); }, 1200);
  });
  $("quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-say]");
    if (!b) return;
    // quick buttons go through the same wake-phrase path as speech
    import("./voice/wake.js").then(({ matchWake }) => {
      const w = matchWake(b.dataset.say);
      handleCommand(w.command, { via: "button", heard: b.textContent });
    });
  });
  $("btn-mic").addEventListener("click", (e) => {
    const onNow = e.currentTarget.getAttribute("aria-pressed") === "true";
    if (onNow) { voiceMod.stopListening(); e.currentTarget.setAttribute("aria-pressed", "false"); }
    else if (voiceMod.startListening()) e.currentTarget.setAttribute("aria-pressed", "true");
  });
}

function wireVoice() {
  voiceMod.initVoice({
    onCommand: (text, meta) => handleCommand(text, meta),
    onUtterance: (audio) => onUtterance(audio),
  });
  on("voice:transcript", ({ text, final }) => { if (!final) $("orb-caption").textContent = `“${text}”`; });
  on("voice:level", (l) => { if (orb.getState() === "listening" || voiceMod.voice.listening) orb.setLevel(l); });
  on("voice:listening", (l) => { if (!voiceMod.voice.speaking) orb.setState(l ? "listening" : "idle"); });
  on("voice:speaking-start", () => orb.setState("speaking"));
  on("voice:speaking-end", () => orb.setState(voiceMod.voice.listening ? "listening" : "idle"));
  on("voice:status", (t) => note(t));
}

// ---------- speech out ----------
function say(text, opts = {}) {
  if (!text) return Promise.resolve();
  logLine("Sentinel", text, opts.source);
  $("orb-caption").textContent = text;
  const p = voiceMod.speak(text, { interrupt: true });
  speakingQueue = p;
  return p;
}

function logLine(who, text, source) {
  const li = document.createElement("li");
  li.className = who === "Sentinel" ? "sentinel" : "you";
  li.innerHTML = `<span class="who">${esc(who)}</span><span class="msg">${esc(text)}</span>${source ? `<span class="src">${esc(source)}</span>` : ""}`;
  const ol = $("transcript");
  ol.appendChild(li);
  while (ol.children.length > 40) ol.removeChild(ol.firstChild);
  ol.scrollTop = ol.scrollHeight;
}

function note(t) { $("orb-caption").textContent = t; }

// ---------- commands ----------
async function handleCommand(text, meta = {}) {
  if (meta.heard && meta.via !== "typed") logLine("You", meta.heard);
  else if (meta.via === "typed") logLine("You", text);
  if (meta.wakeOnly || !text) {
    cue.wake();
    say(`Yes${view.state?.display_name ? `, ${view.state.display_name}` : ""}?`);
    return;
  }
  const m = matchIntent(text);
  if (m) {
    if (m.local === "stop") { voiceMod.stopSpeaking(); director.cancel(); closeScreen(); return; }
    if (m.local === "cabin") {
      const c = view.state?.cabin || {};
      say(`Cabin oxygen is ${c.oxygen_pct} percent and carbon dioxide ${c.co2_ppm} parts per million. ${c.alert ? "That is out of range and flagged to ground." : "Both are within limits."} These cabin readings are simulated.`, { source: "local" });
      return;
    }
    if (m.intent === "vision") say("Let me see you.", { source: "local" });
    director.run(m.commands);
    return;
  }
  // everything else goes to the brain
  try {
    $("orb-caption").textContent = "Thinking…";
    const r = await api.chat(view.crewId, text);
    say(r.reply, { source: r.source === "llm" ? "LLM" : "rules" });
    if (r.commands?.length) {
      await new Promise((res) => setTimeout(res, 400));
      director.run(r.commands);
    }
  } catch {
    say("The brain is offline. I can still open screens and run the scan.", { source: "local" });
  }
}

async function onUtterance(audio) {
  const f = voiceMod.features(audio);
  const p = { voice: { talk_time: f.talk_time } };
  if (f.pitch) p.voice.pitch = f.pitch;
  patch(p).catch(() => {});
  if (!ctx.health.speaker_id || !(ctx.health.voiceprints || []).length) return;
  try {
    const r = await api.identify(voiceMod.toWav16k(audio));
    if (r.crew_id) {
      const changed = r.crew_id !== view.crewId;
      switchCrew(r.crew_id, "voice");
      await patch({ identity: { confidence: r.confidence, source: "voice" } });
      if (changed) say(`Hello ${view.crew.find((c) => c.crew_id === r.crew_id)?.display_name || ""}.`);
    }
  } catch { /* identify failed: keep the current crew member */ }
}

function switchCrew(id, source) {
  if (!id) return;
  setCrew(id, source);
  if (source === "manual") patch({ identity: { source: "manual", confidence: 0 } }).catch(() => {});
}

async function enrol(id, statusEl) {
  const name = view.crew.find((c) => c.crew_id === id)?.display_name || id;
  if (!voiceMod.voice.micReady) { statusEl.textContent = "Microphone not ready."; return; }
  statusEl.textContent = `${name}: read aloud for 10 seconds, starting now…`;
  voiceMod.stopListening();
  try {
    const clip = await voiceMod.recordClip(10, (p) => { statusEl.textContent = `${name}: recording ${Math.round(p * 100)}%`; });
    statusEl.textContent = `${name}: building voiceprint…`;
    await api.enrol(id, voiceMod.toWav16k(clip));
    ctx.health = await api.health();
    statusEl.textContent = `${name} enrolled.`;
  } catch (e) {
    statusEl.textContent = `Enrolment failed: ${e.message}`;
  } finally {
    if (voiceMod.voice.recognitionAvailable) voiceMod.startListening();
    demoPanel.render();
  }
}

function openIntervention(name) {
  const map = { breathing: "orb_calm", aurora_run: "aurora_run", earth_window: "earth_window", music: "music", connection: "connection" };
  if (map[name]) screens.open(map[name]);
  else screens.open("interventions");
}

// ---------- every poll ----------
function onState(v) {
  const s = v.state, aux = v.aux;
  if (!s) return;
  // status bar
  $("sb-crew-name").textContent = s.display_name;
  const id = $("sb-identity");
  if (s.identity?.source === "voice" && v.identitySource === "voice") { id.className = "badge badge-live"; id.textContent = `voice ${Math.round((s.identity.confidence || 0) * 100)}%`; }
  else { id.className = "badge badge-sim"; id.textContent = "manual"; }
  const c = aux?.clock;
  if (c) $("sb-clock").textContent = `Day ${c.mission_day} ${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
  $("sb-o2").textContent = `O2 ${s.cabin.oxygen_pct.toFixed(1)}%`;
  $("sb-co2").textContent = `CO2 ${Math.round(s.cabin.co2_ppm)} ppm`;
  document.querySelector(".sb-cabin").classList.toggle("is-alert", !!s.cabin.alert);
  if (view.online) $("sb-link").textContent = "Brain online";
  // body, tiles, orb
  body.setZoneStates(aux?.assessment?.zones);
  if (s.radiation.storm_level >= 1) body.showRadiation(true);
  renderTiles($("vitals"), v, v.spaceweather);
  const sev = s.action?.severity || "none";
  orb.setSeverity(["flag_cabin", "flag_radiation", "flag_ground"].includes(s.action?.type) ? "alert" : sev === "watch" ? "watch" : "none");
  banner.update(s);
  renderActionCard(s, aux);
  $("greenhouse-mini").innerHTML = plantSVG(s.engagement.greenhouse_stage, view.wilt || 0);
  // Sentinel noticed something: point at it
  const z = s.action?.zone || "";
  if (z !== lastZone) {
    lastZone = z;
    if (z && z !== "cabin" && !director.busy) director.run([{ cmd: "point_to", zone: z }]);
  }
  // scripted scenario steps
  const sc = aux?.scenario;
  if (sc && sc.seq !== view.scenarioSeq) {
    const first = view.scenarioSeq === 0 && sc.seq > 0 && !sc.running && sc.step !== "reset";
    view.scenarioSeq = sc.seq;
    if (!first) runScenarioStep(sc);
  }
}

function runScenarioStep(sc) {
  if (sc.crew_id && sc.crew_id !== view.crewId) switchCrew(sc.crew_id, "manual");
  if (sc.step === "reset") { director.cancel(); closeScreen(); banner.hide(); lastZone = ""; invalidateSparks(); return; }
  if (sc.say) say(sc.say, { source: "SIM line" });
  if (sc.commands?.length) director.run(sc.commands);
}

function renderActionCard(s, aux) {
  const a = s.action || {};
  const card = $("action-card");
  const key = `${s.crew_id}|${a.type}|${a.zone}|${a.intervention}|${a.detail}`;
  if (key === lastActionKey) return;
  lastActionKey = key;
  if (!a.type || a.type === "none" || a.type.startsWith("flag_")) {
    const due = dueRoutine();
    if (due) {
      card.hidden = false;
      card.className = "action-card";
      card.innerHTML = `<div class="ac-row"><span class="ac-title">Due now: ${esc(due.label)}</span>${badgeHTML("LIVE")}</div>
        <button class="btn btn-primary" type="button" data-go>${esc(due.button)}</button>`;
      card.querySelector("[data-go]").addEventListener("click", () => director.run([{ cmd: "open_screen", name: due.screen }]));
    } else card.hidden = true;
    return;
  }
  const readings = zoneReadings(a.zone, s, aux);
  const badge = readings.some((r) => r.badge !== "LIVE") || !readings.length ? "SIM" : "LIVE";
  const btn = {
    offer_orb_calm: ["Start Orb Calm", () => director.run([{ cmd: "open_screen", name: "orb_calm" }])],
    offer_intervention: [`Open: ${INTERVENTIONS.find((i) => i.id === a.intervention)?.label || "suggestions"}`, () => openIntervention(a.intervention)],
    suggest_medicine: ["Open the health log", () => director.run([{ cmd: "open_screen", name: "health_log" }])],
    gentle_checkin: ["Log how I feel", () => director.run([{ cmd: "open_screen", name: "health_log" }])],
  }[a.type];
  const title = { offer_orb_calm: "Suggestion: Orb Calm", offer_intervention: "Suggestion", suggest_medicine: "Onboard kit (SIM list)", gentle_checkin: "Check-in" }[a.type] || a.type;
  card.hidden = false;
  card.className = `action-card is-${a.severity === "alert" ? "alert" : a.severity === "watch" ? "watch" : "info"}`;
  card.innerHTML = `<div class="ac-row"><span class="ac-title">${esc(title)}</span>${badgeHTML(badge)}<span class="note">${a.zone ? esc(ZONE_NAMES[a.zone] || a.zone) : ""}</span></div>
    <div class="ac-detail">${esc(a.detail)}</div>
    <div class="ac-row">${btn ? `<button class="btn btn-primary" type="button" data-act>${esc(btn[0])}</button>` : ""}<button class="btn btn-ghost" type="button" data-menu>Other options</button></div>`;
  card.querySelector("[data-act]")?.addEventListener("click", btn[1]);
  card.querySelector("[data-menu]").addEventListener("click", () => screens.open("interventions", a.intervention));
}

// ---------- routine prompts and the greenhouse ----------
const ROUTINE = [
  { id: "vitals", label: "morning vitals", from: 6, to: 11, screen: "health_log", button: "Log vitals" },
  { id: "cognitive", label: "midday cognitive check", from: 11, to: 16, screen: "cognitive", button: "Start the check" },
  { id: "log", label: "evening mood and sleep log", from: 18, to: 23, screen: "health_log", button: "Log mood and sleep" },
];
const nudged = new Set();

function routineKey(day) { return `sentinel:routine:${view.crewId}:${day}`; }
function routineDone(day) {
  try { return JSON.parse(localStorage.getItem(routineKey(day)) || "{}"); } catch { return {}; }
}
function setRoutineDone(day, id) {
  const d = routineDone(day);
  d[id] = true;
  try { localStorage.setItem(routineKey(day), JSON.stringify(d)); } catch { /* storage blocked */ }
}

function dueRoutine() {
  const c = view.aux?.clock;
  if (!c) return null;
  const done = routineDone(c.mission_day);
  return ROUTINE.find((r) => c.hour >= r.from && c.hour < r.to && !done[r.id]) || null;
}

async function onCheckin(kind) {
  const c = view.aux?.clock;
  if (!c || !view.state) return;
  const id = kind === "log" ? (c.hour < 14 ? "vitals" : "log") : kind;
  setRoutineDone(c.mission_day, id);
  lastActionKey = "";
  try { await patch({ engagement: { checkins_today: (view.state.engagement.checkins_today || 0) + 1 } }); } catch {}
}

let lastDay = null;
async function routineTick() {
  const c = view.aux?.clock;
  if (!c || !view.state) return;
  if (lastDay != null && c.mission_day > lastDay) {
    // the day(s) ended: grow or wilt the plant
    let stage = view.state.engagement.greenhouse_stage;
    let streak = view.state.engagement.streak_days;
    for (let d = lastDay; d < c.mission_day; d++) {
      const ok = routineComplete(routineDone(d));
      stage = greenhouseDay(stage, ok);
      streak = ok ? streak + 1 : 0;
      view.wilt = ok ? 0 : 0.6;
    }
    patch({ engagement: { greenhouse_stage: stage, streak_days: streak } }).catch(() => {});
  }
  lastDay = c.mission_day;
  const due = dueRoutine();
  if (due) {
    const k = `${c.mission_day}:${due.id}`;
    if (!nudged.has(k)) {
      nudged.add(k);
      cue.nudge();
      note(`Due now: ${due.label}.`);
      lastActionKey = "";
    }
  }
}
on("state", () => { if (lastDay == null && view.aux?.clock) lastDay = view.aux.clock.mission_day; });

boot();
emit("boot");
