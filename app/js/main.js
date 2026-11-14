// Sentinel v2 entry point: start tap, world + orb, stages, Director, dashboards, voice, polling, routines.
import { api } from "./core/api.js";
import { emit, on } from "./core/bus.js";
import { createDirector } from "./core/director.js";
import { crewFromSpeech, matchIntent, wellbeingConcern } from "./core/intents.js";
import { audioContext, cue, setMuted, isMuted } from "./core/sound.js";
import { createStages } from "./core/stages.js";
import { patch, pollOnce, setCrew, startPolling, view } from "./core/state.js";
import * as body from "./interface/body.js";
import { createBanner } from "./interface/banner.js";
import { createDemoPanel } from "./interface/demopanel.js";
import { createOrb } from "./interface/orb.js";
import { mountMission, renderFindings, renderMission } from "./interface/dashboard.js";
import { ZONE_NAMES, badgeHTML, esc, statusHTML, statusKey, zoneReadings } from "./interface/readings.js";
import { closeScreen, initScreens, registerScreen } from "./interface/screens.js";
import { invalidateSparks, mountTiles, refreshSparks, renderTiles } from "./interface/tiles.js";
import { renderRace } from "./experience/race/race.js";
import { renderGreenhouse } from "./experience/mars/greenhouse.js";
import { renderWellbeing } from "./experience/wellbeing.js";
import { renderGrounding } from "./experience/grounding.js";
import { renderHardware } from "./experience/hardware.js";
import { INTERVENTIONS, renderConnection, renderEarth, renderMenu, renderMusic } from "./experience/interventions.js";
import { greenhouseDay, routineComplete } from "./experience/logic.js";
import { renderOrbCalm } from "./experience/orbcalm.js";
import { renderCognitive } from "./systems/cognitive.js";
import { renderRadiation } from "./systems/radiation.js";
import { createVision } from "./vision/vision.js";
import { CameraLog } from "./systems/face.js";
import * as voiceMod from "./voice/voice.js";
import { createWorld, isTablet } from "./world/world.js";
import { createSpace } from "./world/space.js";
import { createIntro } from "./world/intro.js";
import { TILES } from "./interface/tiles.js";
import { chipText, defaultSystem, mountBodyPanels, render as renderBodyPanels, selectSystem } from "./interface/bodypanel.js";
import { mountVitals, renderVitals } from "./interface/vitals.js";
import { registerMissionMed } from "./experience/missionmed.js";
import { registerProfile } from "./experience/profile.js";
import * as reminders from "./core/reminders.js";
import { registerSymptom } from "./systems/symptom.js";
import { REGION_NAMES, REGION_ZONE, regionOf, zoneStatuses } from "./interface/body.js";

const $ = (id) => document.getElementById(id);

// ---------- settings (per browser; a convenience, never required) ----------
const settings = {
  get(k) { try { return localStorage.getItem(`sentinel:${k}`) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(`sentinel:${k}`, v); } catch { /* storage blocked */ } },
};
const ctx = { view, patch, settings, health: {}, facts: { facts: [], zones: {} }, thresholds: null, demoLines: {} };
window.sentinel = ctx; // for the browser test harness and debugging
let orb, director, banner, vision, demoPanel, screens, world, space, stages;
let lastZone = null;   // null until the first state: Sentinel does not jump to the body on start
let lastActionKey = "";
let interacted = false;
let captionTimer = null;

// ---------- boot: the cinematic intro (brief section 8 item 5) ----------
let intro = null, introRun = null;
async function boot() {
  world = createWorld($("world"));
  orb = createOrb();
  orb.attach(world);
  ctx.orb = orb;
  space = world.add("space", createSpace(world, { tablet: isTablet }));
  intro = world.add("intro", createIntro(world));
  ctx.world = world; ctx.space = space;
  stages = createStages({ world, space, orb });
  ctx.stages = stages;
  world.orbTo({ x: innerWidth / 2, y: innerHeight / 2, size: 0, opacity: 0 }, 0);
  await world.show("intro", { fade: false });
  // the orb and the welcome form one centred group: title and Begin sit just under the orb's pedestal
  const introOrb = () => { const size = Math.min(innerHeight * 0.3, innerWidth * 0.34, 260); return { x: innerWidth / 2, y: innerHeight * 0.5 - size * 0.04 - 87, size, opacity: 1 }; };   // orb + title + button centred as one group
  const placeCopy = () => { const o = introOrb(); document.querySelector(".intro-copy").style.top = `${Math.round(o.y + o.size * 0.78 + 24)}px`; };
  placeCopy();
  addEventListener("resize", placeCopy);
  const ready = () => {
    $("start-screen").classList.add("is-ready");
    const copy = document.querySelector(".intro-copy"), h = $("intro-hello"), btn = $("start-btn");
    if (!h.dataset.split) {   // letters rise in one by one
      h.dataset.split = "1"; h.setAttribute("aria-label", h.textContent);
      h.innerHTML = [...h.textContent].map((ch) => `<span class="ch" aria-hidden="true">${ch === " " ? "&nbsp;" : ch}</span>`).join("");
    }
    const g = window.gsap;
    if (!g || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { copy.style.opacity = 1; btn.classList.add("is-live"); return; }
    g.set(copy, { opacity: 1 });
    g.fromTo(h.querySelectorAll(".ch"), { opacity: 0, y: 26, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.9, stagger: 0.035, ease: "expo.out" });
    g.fromTo(btn, { opacity: 0, y: 18, scale: 0.86 }, { opacity: 1, y: 0, scale: 1, duration: 0.9, delay: 0.55, ease: "back.out(1.7)", onComplete: () => btn.classList.add("is-live") });
  };
  const form = () => {
    stages.setOrbMode("intro", 0);
    world.orbTo({ x: innerWidth / 2, y: innerHeight / 2, size: 0, opacity: 1 }, 0);
    const t = introOrb();
    orb.burst();
    world.orbTo(t, 1.6, "expo.out");
    setTimeout(ready, 900);
  };
  const go = () => { introRun = intro.run({ onForm: form, onDone: () => {} }); };
  if (window.gsap) go(); else window.addEventListener("load", go, { once: true });
  // a tap anywhere (except on the greeting) skips the intro
  $("start-screen").addEventListener("click", (e) => {
    if (e.target.closest(".intro-copy")) return;
    if (introRun && !$("start-screen").classList.contains("is-ready")) introRun.skip();
  });
  try {
    [ctx.facts, ctx.thresholds, ctx.demoLines, ctx.kit] = await Promise.all([
      api.json("../shared/facts.json"), api.json("../shared/thresholds.json"), api.json("assets/demo_lines.json"), api.json("../shared/med_kit.json"),
    ]);
  } catch (e) { console.warn("could not load shared data", e); }
  try { view.crew = await api.crew(); } catch { view.crew = []; }
  try { ctx.health = await api.health(); } catch { ctx.health = {}; }
  $("start-btn").addEventListener("click", start, { once: true });
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

// ---------- the Begin tap: unlock everything that needs a user gesture ----------
// One Sentinel at a time: a second tab on the same device would hear the same words and answer in a second voice.
// The newest tab wins; older ones go quiet (no listening, no speech) and say so, and can take over with a tap.
let sleeping = false;
const instanceId = Math.random().toString(36).slice(2);
const tabs = "BroadcastChannel" in window ? new BroadcastChannel("sentinel-instance") : null;
function goQuiet() {
  if (sleeping) return;
  sleeping = true;
  voiceMod.stopSpeaking(); voiceMod.stopListening();
  const el = document.createElement("div"); el.id = "elsewhere"; el.className = "elsewhere";
  el.innerHTML = `<p>Sentinel is open in another tab, so this one is quiet.</p><button type="button" class="pill pill-light">Use this tab</button>`;
  el.querySelector("button").addEventListener("click", () => { el.remove(); sleeping = false; tabs?.postMessage({ type: "active", id: instanceId }); applyListening(); });
  document.body.appendChild(el);
}
tabs?.addEventListener("message", (e) => { if (e.data?.type === "active" && e.data.id !== instanceId && document.getElementById("app") && !$("app").hidden) goQuiet(); });

async function start() {
  tabs?.postMessage({ type: "active", id: instanceId });   // any other open Sentinel goes quiet
  audioContext();
  voiceMod.unlockSpeech();
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  } catch { /* not iPad */ }
  requestWakeLock();
  introRun?.skip();
  const g = window.gsap;
  if (g && !matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise((r) => g.to("#start-screen", { opacity: 0, duration: 0.5, onComplete: r }));
  $("start-screen").hidden = true;
  $("app").hidden = false;
  await mountApp();
  if (settings.get("theme") === "light") ctx.setTheme("light");
  ctx.setGlove(settings.get("glove") === "on");
  await stages.go("assistant");
  world.remove("intro");
  fetch("../api/warm", { method: "POST" }).catch(() => {});   // open the brain and voice connections before the first word
  openWho();   // straight away: choosing who you are never waits on the microphone prompt
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const id = settings.get("mic");
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id ? { deviceId: { exact: id } } : {}) } });
      await voiceMod.initMic(mic);
    } catch { note("Microphone not available: type, or use the menu."); }
  }
  applyListening();
}

// ---------- "Who's here?": pick your name by tap or by saying it ----------
let choosing = false;
function openWho() {
  let last = null; try { last = localStorage.getItem("sentinel.crew"); } catch { /* private mode */ }
  const el = document.createElement("section");
  el.id = "who"; el.className = "who"; el.setAttribute("aria-label", "Who is here?");
  el.innerHTML = `<div class="who-card"><p class="label">Crew</p><h2>Who's here?</h2>
    <p class="who-sub">Tap your name, or say it: "I'm ${esc(view.crew[0]?.display_name || "Eliah")}".</p>
    <div class="who-grid">${view.crew.map((c) => `<button type="button" data-who="${esc(c.crew_id)}" class="${c.crew_id === last ? "is-last" : ""}"><span>${esc(c.display_name[0])}</span><b>${esc(c.display_name)}</b>${c.crew_id === last ? "<small>last time</small>" : ""}</button>`).join("")}</div></div>`;
  document.body.appendChild(el);
  choosing = true;
  el.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", () => chooseCrew(b.dataset.who)));
  if (window.gsap) {
    window.gsap.fromTo(el.querySelector(".who-card"), { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" });
    window.gsap.fromTo(el.querySelectorAll("[data-who]"), { opacity: 0, y: 16, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.05, delay: 0.15, ease: "back.out(1.6)" });
  }
  say("Who's here? Tap your name, or say it.", { source: "local" });
}
function chooseCrew(id) {
  const c = view.crew.find((x) => x.crew_id === id);
  if (!c) return;
  switchCrew(id, "manual");
  try { localStorage.setItem("sentinel.crew", id); } catch { /* private mode */ }
  const was = choosing; choosing = false;
  const el = document.getElementById("who");
  if (el) { el.classList.add("is-out"); setTimeout(() => el.remove(), 400); }
  say(was ? `Hello ${c.display_name}. I'm Sentinel. Ask me anything, or say hey Sentinel.` : `Hello ${c.display_name}.`, { source: "local" });
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

function applyListening() {
  if (sleeping) return;   // another tab is the live one
  const ptt = settings.get("listen") === "ptt";
  if (!voiceMod.voice.micReady && !voiceMod.voice.recognitionAvailable) { $("voice-mode").textContent = "typing"; return; }
  if (ptt) { voiceMod.stopListening(); $("voice-mode").textContent = "push to talk"; }
  else if (voiceMod.startListening()) $("voice-mode").textContent = "say hey sentinel";
  $("btn-mic").classList.toggle("is-wake", !ptt);
}
ctx.applyListening = applyListening;

// ---------- app ----------
async function mountApp() {
  // SpaceWear, the 3D hardware prototypes, live on Vitals beside the readings they produce (loaded once, off the critical path)
  import("./world/wearable3d.js").then(({ mountWearableFigure }) => { ctx.wearableDispose = mountWearableFigure($("wearable-host"), ctx); })
    .catch((e) => console.warn("wearable model failed", e));
  mountTiles($("vitals"), (id) => {
    const t = { dose: "radiation", storm: "radiation" }[id];
    if (t) director.run([{ cmd: "open_screen", name: t }]);
    else director.run([{ cmd: "show_chart", metric: id }]);
  });
  mountMission($("mission-cards"), (card) => {
    const to = { crew: "crew", cabin: "cabin", radiation: "radiation", greenhouse: "greenhouse" }[card];
    if (to) return director.run([{ cmd: "open_screen", name: to }]);
    if (card === "checkin") director.run([{ cmd: "open_screen", name: (dueRoutine() || nextRoutine() || ROUTINE[0]).screen }]);
  });
  screens = initScreens(ctx);
  ctx.screens = screens;
  ctx.say = say;
  ctx.setVoice = (v) => voiceMod.setVoice(v);
  ctx.testVoice = () => voiceMod.testVoice();
  ctx.voiceState = () => ({ ...voiceMod.voice, ctx: audioContext()?.state });
  // Glove mode (BODY-8): every control on the body screen grows to a glove-sized target
  ctx.setGlove = (on) => {
    if (on) document.documentElement.dataset.glove = "on"; else delete document.documentElement.dataset.glove;
    settings.set("glove", on ? "on" : "off");
  };
  ctx.on = on;   // the browser checks listen for body.zone.selected, body.scan.complete, symptom.logged
  ctx.setTheme = (t) => {
    const light = t === "light";
    if (light) document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
    settings.set("theme", light ? "light" : "dark");
    world.setTheme(light ? "light" : "dark");
  };
  voiceMod.setVoice(settings.get("voice") || "river");
  ctx.setCrew = (id, src) => switchCrew(id, src);
  ctx.onCheckin = onCheckin;
  ctx.openIntervention = openIntervention;
  ctx.enrol = enrol;
  ctx.onClockSkip = () => pollOnce();
  ctx.homeStage = () => (interacted ? "mission" : "assistant");
  ctx.onDeviceChange = (k) => { if (k === "camera" && vision.state.on) { vision.stop(); vision.start(); } };
  registerScreen("cognitive", { title: "Reaction test", badge: "LIVE", render: renderCognitive });
  registerMissionMed(registerScreen);
  registerProfile(registerScreen);
  registerSymptom(registerScreen);
  registerScreen("orb_calm", { title: "Stillpoint", full: true, render: renderOrbCalm });
  registerScreen("race", { title: "Slipstream", full: true, render: renderRace });
  registerScreen("greenhouse", { title: "Red Harvest", full: true, render: renderGreenhouse });
  registerScreen("wellbeing", { title: "Wellbeing", full: true, render: renderWellbeing });
  registerScreen("grounding", { title: "Grounding", full: true, render: renderGrounding });
  registerScreen("hardware", { title: "Sentinel Skin", badge: "DESIGNED", render: renderHardware });
  registerScreen("interventions", { title: "Suggestions", render: (el, c, arg) => renderMenu(el, c, arg) });
  registerScreen("earth_window", { title: "Earth window", badge: "SIM", render: renderEarth });
  registerScreen("music", { title: "Ambient sound", render: renderMusic });
  registerScreen("connection", { title: "Message a crewmate", badge: "DESIGNED", render: renderConnection });

  // the body (async; the Director waits for it when needed)
  import("./world/body3d.js").then(async ({ createBody }) => {
    const b = await createBody(world, $("body-host"), { tablet: isTablet, onZoneClick: zonePopover, onBodyClick: bodyTap, regionOf, model: view.state?.body_model || "male" });
    b.preload(b.model === "male" ? "female" : "male");
    world.add("body", b);
    body.setImpl(b);
    ctx.body3d = b;
    $("body-loading").hidden = true;
    if (view.aux) body.setZoneStates(zoneStatuses(view.aux.assessment?.zones));
    if (stages.current === "body") world.show("body");
  }).catch((e) => { console.warn("body model failed", e); $("body-loading").textContent = "The 3D body could not load on this device."; });

  director = createDirector({ orb, screens, stages, say: (t, o) => say(t, o), getView: () => view, facts: ctx.facts, onFrame: (fn) => world.onFrame(fn) });
  ctx.director = director;
  mountBodyPanels({ rail: $("sys-rail"), panel: $("sys-panel"), insights: $("insights"), director, screens, getView: () => view, facts: ctx.facts, kit: ctx.kit });
  mountVitals(ctx);
  banner = createBanner({ say });
  demoPanel = createDemoPanel(ctx);
  vision = createVision({
    video: $("cam-video"), overlay: $("cam-overlay"), msg: $("cam-msg"), badge: $("cam-badge"),
    pulseValue: $("pulse-value"), pulseQuality: $("pulse-quality"), arc: $("pulse-arc"), stage: $("stage-vision"),
    emotionList: $("emotion-list"), emotionTop: $("emotion-top"), camButton: $("btn-cam"),
    moodOptIn: () => settings.get(`mood_optin:${view.crewId}`) !== "off",
    deviceId: () => settings.get("camera"),
    canPatch: () => !view.aux?.scenario?.running && !view.hrOverride,
    patchHr: (bpm) => patch({ vitals: { heart_rate: bpm, source: "camera", sources: { heart_rate: "camera" } } }).catch(() => {}),
    onFallback: () => {
      const src = view.state?.vitals?.sources || {};
      const back = {};
      if (src.heart_rate === "camera") back.heart_rate = "sim";
      if (src.breathing_rate === "camera" && !vision.state.on) back.breathing_rate = "sim";   // breathing does not depend on the pulse lock
      if (Object.keys(back).length) patch({ vitals: { ...(back.heart_rate ? { source: "sim" } : {}), sources: back } }).catch(() => {});
      if (!vision.state.on) camLog.reset();
      showCamLog();
    },
  });
  ctx.vision = vision;
  // Face scan -> the crew member's record: breathing rate and expression are written to the state like the pulse is.
  const camLog = new CameraLog();
  const showCamLog = () => {
    const el = $("cam-log"); if (!el) return;
    const text = vision.state.on ? camLog.summary(view.state) : "";
    el.textContent = text ? `Saved to ${view.state?.display_name || "this crew member"}'s record: ${text}` : "Nothing saved to the record yet.";
  };
  const logCamera = (p) => {
    if (!p || view.aux?.scenario?.running) return;
    patch(p).then(showCamLog).catch((e) => { camLog.reset(); console.warn(`[sentinel vision] camera reading not saved: ${e.message}`); });
  };
  on("reading.added", (r) => logCamera(camLog.fromReading(r, performance.now())));
  on("vision:emotion", (e) => logCamera(camLog.fromEmotion(e, performance.now())));
  on("vision:hr", showCamLog);
  on("crew:changed", () => { camLog.reset(); showCamLog(); });
  renderRadiation($("radiation-host"), ctx);
  registerScreen("readings", { title: "All readings", render: renderAllReadings });

  wireControls();
  wireVoice();
  on("state", onState);
  on("offline", () => { document.body.classList.add("offline"); $("sb-link").textContent = "Brain offline: last known values"; $("sb-link").title = "Brain offline: showing last known values"; });
  on("online", () => { document.body.classList.remove("offline"); $("sb-link").textContent = "Brain online"; $("sb-link").title = "Brain online"; });
  on("zone:open", (z) => screens.zone(z));
  on("screen:open", () => { placeSubtitle(); setTimeout(placeSubtitle, 650); });
  on("screen:close", () => setTimeout(placeSubtitle, 50));
  on("body:zone", (z) => selectSystem(z));   // the right panel follows what Sentinel is checking or pointing at
  on("vision:open", () => vision.start());
  on("intervention:open", openIntervention);
  on("crew:changed", () => { invalidateSparks(); lastZone = null; });
  let bodySeen = false;
  on("stage", (name) => {
    if (name === "vision" && !vision.state.on) vision.start();
    if (name === "body" && !bodySeen) { bodySeen = true; selectSystem(defaultSystem(view)); }
    if (name === "vitals") renderVitals(view);
    closeMenus();
  });

  let first = view.crew[0]?.crew_id;
  try { const last = localStorage.getItem("sentinel.crew"); if (view.crew.some((c) => c.crew_id === last)) first = last; } catch { /* private mode */ }
  if (first) setCrew(first, "manual");
  startPolling();
  setInterval(() => view.crewId && refreshSparks($("vitals"), view.crewId), 5000);
  setTimeout(() => view.crewId && refreshSparks($("vitals"), view.crewId), 1200);
  setInterval(routineTick, 15000);
  setInterval(refreshSpaceweather, 30000);
  refreshSpaceweather();
  setInterval(() => api.health().then((h) => { ctx.health = h; }).catch(() => {}), 20000);
}

async function refreshSpaceweather() {
  try {
    view.spaceweather = await api.spaceweather();
    space.setStorm(view.spaceweather.scenario ? view.spaceweather.scenario.level : view.spaceweather.level);
  } catch { /* keep last */ }
}

// A tap on the body itself (BODY-1, BODY-6): in pointing mode it answers "where does it hurt?";
// otherwise it selects the zone that place reports to and offers Check, Details and Log a symptom.
function bodyTap({ region, x, y, pointing }) {
  // the person's tap wins over an automatic pointing or check that is still running
  if (director.busy) director.cancel();
  const zone = REGION_ZONE[region] || "bones";
  emit("body.zone.selected", { zone, crewId: view.crewId, region });
  if (pointing) { screens.open("symptom", region); return; }
  selectSystem(zone);
  zonePopover(zone, { x, y }, region);
}

// A tap on a body dot or a place on the body: a small card with Check, Details and Log a symptom
function zonePopover(zone, at, region) {
  document.querySelector(".zone-pop")?.remove();
  const host = $("body-host");
  const dot = typeof at.getBoundingClientRect === "function";
  const r = dot ? at.getBoundingClientRect() : { left: at.x, top: at.y }, h = host.getBoundingClientRect();
  if (dot) emit("body.zone.selected", { zone, crewId: view.crewId });
  const pop = document.createElement("div");
  pop.className = "zone-pop card";
  const sev = statusKey(view.aux?.assessment?.zones?.[zone] || "ok");
  pop.innerHTML = `<strong>${esc(region ? `${REGION_NAMES[region]} · ${ZONE_NAMES[zone]}` : ZONE_NAMES[zone])}</strong>
    <span class="zp-status st-${sev}">${statusHTML(sev)}<span class="note">${sev === "ok" ? "Within your usual range" : sev === "alert" ? "Past the alert line" : "Worth watching"}</span></span>
    <div class="row"><button class="pill pill-dark" type="button" data-check>Check</button><button class="pill pill-ghost" type="button" data-details>Details</button>${region ? `<button class="pill pill-ghost" type="button" data-hurt>Log a symptom</button>` : ""}</div>`;
  pop.style.left = `${r.left - h.left + 10}px`; pop.style.top = `${r.top - h.top + 22}px`;
  host.appendChild(pop);
  if (r.left - h.left > h.width - (region ? 340 : 240)) pop.style.transform = "translate(calc(-100% - 20px), -50%)";
  // keep the card inside the 3D area: a dot near the head would otherwise put it under the top bar
  const pr = pop.getBoundingClientRect(), pad = 8;
  const dy = pr.top < h.top + pad ? h.top + pad - pr.top : pr.bottom > h.bottom - pad ? h.bottom - pad - pr.bottom : 0;
  if (dy) pop.style.top = `${parseFloat(pop.style.top) + dy}px`;
  pop.querySelector("[data-check]").addEventListener("click", () => { pop.remove(); director.run([{ cmd: "check_zone", zones: [zone] }]); });
  pop.querySelector("[data-details]").addEventListener("click", () => { pop.remove(); screens.zone(zone); });
  pop.querySelector("[data-hurt]")?.addEventListener("click", () => { pop.remove(); screens.open("symptom", region); });
  setTimeout(() => document.addEventListener("pointerdown", function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("pointerdown", off); } }), 0);
}

function wireControls() {
  document.querySelectorAll("#tabbar [data-go]").forEach((b) => b.addEventListener("click", () => {
    const go = b.dataset.go;
    closeMenus();
    if (go === "settings" || go === "about") { screens.open(go); return; }
    closeScreen();
    director.run([{ cmd: "open_screen", name: go }]);
  }));
  $("btn-menu").addEventListener("click", () => toggleMenu("menu", "btn-menu"));
  $("topnav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-nav]");
    if (!b) return;
    closeMenus();
    if (b.dataset.nav === "wellbeing") {
      screens.open("wellbeing");
      document.querySelectorAll("#topnav [data-nav]").forEach((x) => x.setAttribute("aria-current", String(x === b)));
      return;
    }
    closeScreen();
    director.run([{ cmd: "open_screen", name: b.dataset.nav }]);
  });
  $("btn-zoom-in").addEventListener("click", () => ctx.body3d?.zoomBy(0.75));
  $("btn-zoom-out").addEventListener("click", () => ctx.body3d?.zoomBy(1.33));
  $("btn-zoom-fit").addEventListener("click", () => director.run([{ cmd: "zoom_body", zone: "reset" }]));
  $("btn-convo").addEventListener("click", () => toggleMenu("convo", "btn-convo"));
  $("btn-all").addEventListener("click", () => screens.open("readings"));
  $("btn-scan").addEventListener("click", () => director.run([{ cmd: "start_scan" }]));
  $("btn-hurt").addEventListener("click", () => screens.open("symptom"));
  $("btn-xray").addEventListener("click", (e) => director.run([{ cmd: "xray", on: e.currentTarget.getAttribute("aria-pressed") !== "true" }]));
  $("btn-turn").addEventListener("click", () => ctx.body3d?.turnBy(90));
  $("btn-radlayer").addEventListener("click", (e) => director.run([{ cmd: "show_radiation", on: e.currentTarget.getAttribute("aria-pressed") !== "true" }]));
  $("btn-radinfo").addEventListener("click", () => screens.zone("whole_body"));
  $("btn-key").addEventListener("click", () => screens.open("about"));
  $("btn-cam").addEventListener("click", () => (vision.state.on ? vision.stop() : vision.start()));
  $("btn-cam-devices").addEventListener("click", () => screens.open("settings"));
  // full screen: the button, F, or by voice; the icon follows the real state (Esc and swipe-down exit too)
  $("btn-fullscreen").addEventListener("click", () => toggleFullscreen());
  document.addEventListener("fullscreenchange", syncFullscreen); document.addEventListener("webkitfullscreenchange", syncFullscreen);
  $("btn-mute").addEventListener("click", (e) => { const m = !isMuted(); setMuted(m); e.currentTarget.setAttribute("aria-pressed", String(m)); });
  $("sb-crew-name").addEventListener("click", () => director.run([{ cmd: "open_screen", name: "crew" }]));
  window.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select")) return;
    if (e.key === "h" || e.key === "H") director.run([{ cmd: "open_screen", name: "hardware" }]);
    if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey) toggleFullscreen();
    if (e.key === "Escape") { director.cancel(); closeScreen(); closeMenus(); }
  });
  $("ask-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("ask-input").value.trim();
    if (!t) return;
    $("ask-input").value = "";
    handleCommand(t, { via: "typed", heard: t });
  });
  let typingT = null;
  $("ask-input").addEventListener("input", () => {
    if (orb.getState() === "idle") orb.setState("listening");
    orb.setLevel(0.25);
    clearTimeout(typingT);
    typingT = setTimeout(() => { if (orb.getState() === "listening" && !voiceMod.voice.capturing) orb.setState("idle"); orb.setLevel(0); }, 1200);
  });
  $("quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-say]");
    if (!b) return;
    closeMenus();
    import("./voice/wake.js").then(({ matchWake }) => handleCommand(matchWake(b.dataset.say).command, { via: "button", heard: b.textContent }));
  });
  $("btn-mic").addEventListener("click", pushToTalk);
  // tapping the orb: in the corner it brings everything back to Sentinel; at the centre it listens
  $("orb-hit").addEventListener("click", () => {
    if (stages.orbMode === "calm") return;
    if (stages.current !== "assistant" || screens.current()) { director.cancel(); closeScreen(); closeMenus(); stages.go("assistant"); return; }
    pushToTalk();
  });
}

function toggleMenu(id, btn) {
  const el = $(id), open = el.hidden;
  closeMenus();
  if (!open) return;
  el.hidden = false;
  $(btn).setAttribute("aria-expanded", "true");
  window.gsap?.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
}
function closeMenus() {
  for (const [id, b] of [["menu", "btn-menu"], ["convo", "btn-convo"]]) { $(id).hidden = true; $(b).setAttribute("aria-expanded", "false"); }
}
ctx.closeMenus = closeMenus;

function renderAllReadings(el) {
  el.innerHTML = `<p class="note">Every reading Sentinel tracks, with where it came from. Tap one for its trend.</p>
    <div class="all-tiles" style="margin-top:var(--s-4)">${TILES.map((t) => `<button class="card vcard tile" type="button" data-tile="${t.id}"><span class="tile-label">${esc(t.label)}</span>
      <span class="tile-meta"><span class="tile-badge"></span><span class="tile-status">—</span></span><span><span class="tile-value num">—</span><span class="tile-unit">${esc(t.unit)}</span></span></button>`).join("")}</div>`;
  const draw = () => renderTiles(el, view, view.spaceweather);
  draw();
  el.querySelectorAll("[data-tile]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.tile;
    director.run([id === "dose" || id === "storm" ? { cmd: "open_screen", name: "radiation" } : { cmd: "show_chart", metric: id }]);
  }));
  const t = setInterval(draw, 1500);
  return () => clearInterval(t);
}

const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function syncFullscreen() { const on = !!fsEl(); $("btn-fullscreen").setAttribute("aria-pressed", String(on)); $("btn-fullscreen").setAttribute("aria-label", on ? "Exit full screen" : "Full screen"); document.body.classList.toggle("is-fs", on); }
/** Enter or leave full screen. Browsers allow entering only from a tap or key press, so a spoken request asks for one tap. */
async function toggleFullscreen(want) {
  const on = !!fsEl(), go = want ?? !on;
  if (go === on) return true;
  try {
    if (go) { const el = document.documentElement; await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.()); }
    else await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.());
    return true;
  } catch {
    if (go) { $("btn-fullscreen").classList.add("is-hint"); setTimeout(() => $("btn-fullscreen").classList.remove("is-hint"), 4000); }
    return false;
  }
}
ctx.toggleFullscreen = toggleFullscreen;

function pushToTalk() {
  voiceMod.stopSpeaking();
  if (voiceMod.pushToTalk()) { $("btn-mic").setAttribute("aria-pressed", "true"); cue.wake(); }
  else { note("No microphone: type your question below."); $("ask-input").focus(); }
}

function wireVoice() {
  voiceMod.initVoice({ onCommand: (text, meta) => handleCommand(text, meta), onUtterance: (audio) => onUtterance(audio) });
  voiceMod.setOpenMic(() => choosing);   // "Who's here?": just say your name, no wake phrase and no tap
  on("voice:open", () => { $("btn-mic").classList.add("is-open"); clearTimeout(wireVoice.t); wireVoice.t = setTimeout(() => $("btn-mic").classList.remove("is-open"), 8000); });
  on("voice:transcript", ({ text, final }) => { if (!final && text) caption(`“${text}”`, ""); });
  on("voice:level", (l) => { if (orb.getState() === "listening") orb.setLevel(l); });
  on("voice:speak-level", (l) => orb.setSpeakLevel(l));
  on("voice:capture", (onNow) => {
    $("btn-mic").setAttribute("aria-pressed", String(!!onNow));
    if (onNow) { orb.setState("listening"); stages.setOrbBig(true); }
    else if (orb.getState() === "listening") { orb.setState("idle"); stages.setOrbBig(false); }
  });
  on("voice:thinking", (t) => { if (t) orb.setState("thinking"); else if (orb.getState() === "thinking") orb.setState("idle"); });
  on("voice:speaking-start", () => { orb.setState("speaking"); stages.setOrbBig(true); });
  on("voice:speaking-end", () => { answering = false; orb.setState("idle"); orb.setSpeakLevel(0); stages.setOrbBig(false); });
  on("voice:status", (t) => note(t));
  on("voice:notice", (t) => showNotice(t));
  on("voice:sentence", (t) => caption(t, speakingSource));
}

// ---------- captions and speech out ----------
function caption(text, source) {
  clearTimeout(captionTimer);
  const onAssistant = stages.current === "assistant" || !stages.current;
  const c = $("orb-caption"), b = $("bubble");
  if (onAssistant) {
    b.hidden = true;
    c.textContent = text;
    c.classList.add("is-caption");
    $("orb-source").textContent = source && source !== "local" ? `Answered by ${source}` : "";
  } else {
    // a reserved subtitle lane at the top of the centre column: never over a panel or a control
    b.innerHTML = `${esc(text)}${source ? `<span class="src">${esc(source)}</span>` : ""}`;
    b.hidden = false;
    b.classList.add("is-subtitle");
    placeSubtitle();
  }
  captionTimer = setTimeout(resetCaption, Math.min(16000, 5000 + text.length * 70));
}
/** The subtitle lane: centred over the 3D area that is actually visible, never over an open sheet. */
function placeSubtitle() {
  const b = $("bubble");
  if (b.hidden || !b.classList.contains("is-subtitle")) return;
  const host = stages.current === "body" ? $("body-host").getBoundingClientRect() : null;
  let left = host && host.width > 50 ? host.left : 0, right = host && host.width > 50 ? host.right : window.innerWidth;
  const sh = $("sheet");
  if (!sh.hidden && !sh.classList.contains("is-full") && !sh.classList.contains("is-orb")) {
    const r = sh.getBoundingClientRect();
    if (r.left > window.innerWidth * 0.3) right = Math.min(right, r.left - 12);   // a right sheet: use the area beside it
    else { b.classList.add("is-tucked"); return; }                                  // a wide sheet leaves no room: speech and the log carry it
  }
  b.classList.remove("is-tucked");
  if (right - left < 240) { b.classList.add("is-tucked"); return; }
  b.style.left = `${(left + right) / 2}px`;
  b.style.maxWidth = `${Math.min(560, right - left - 8)}px`;
  b.style.right = "auto"; b.style.bottom = "auto"; b.style.top = "";
}
ctx.placeSubtitle = placeSubtitle;

function resetCaption() {
  if (voiceMod.voice.speaking) { captionTimer = setTimeout(resetCaption, 2000); return; }
  $("bubble").hidden = true;
  const c = $("orb-caption");
  c.classList.remove("is-caption");
  c.textContent = "How can I help you today?";
  $("orb-source").textContent = "";
}

let speakingSource = "";
let answering = false;   // a streamed answer is being spoken
function say(text, opts = {}) {
  if (!text) return Promise.resolve();
  logLine("Sentinel", text, opts.source);
  speakingSource = opts.source || "";
  // the caption follows what is being said: a queued sentence is captioned when it starts playing
  if (!opts.append || !voiceMod.voice.speaking) caption(text, opts.source);
  if (sleeping) return Promise.resolve();   // the quiet tab never speaks
  // during a spoken answer, anything else (a screen's narration) is queued after it, never cut into it
  const append = opts.append || (answering && opts.source !== "LLM" && opts.source !== "rules" && !opts.interrupt);
  return voiceMod.speak(text, { interrupt: !append });
}

function logLine(who, text, source) {
  const li = document.createElement("li");
  li.className = who === "Sentinel" ? "sentinel" : "you";
  li.innerHTML = `<span class="who">${esc(who)}${source ? `<span class="src">${esc(source)}</span>` : ""}</span><span class="msg">${esc(text)}</span>`;
  const ol = $("transcript");
  ol.appendChild(li);
  while (ol.children.length > 40) ol.removeChild(ol.firstChild);
  ol.scrollTop = ol.scrollHeight;
}

function note(t) { caption(t, ""); }

/** A small, visible, self-clearing notice (voice or brain trouble). The reason is in the console. */
let noticeT = null;
function showNotice(text) {
  const n = $("notice");
  n.textContent = text;
  n.hidden = false;
  window.gsap?.fromTo(n, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.3 });
  clearTimeout(noticeT);
  noticeT = setTimeout(() => { n.hidden = true; }, 6000);
}
ctx.showNotice = showNotice;

// ---------- commands ----------
// ---------- W14 urgent wellbeing concern: fixed lines, people brought in, grounding open ----------
let safetyOn = false;
const earlyNoted = new Set();   // an early sign is answered once per session
const SAFETY_FIRST = "I'm here. Please call a crewmate now. I'm letting them know.";
async function safetyFlow(category) {
  safetyOn = true;
  voiceMod.stopSpeaking(); director.cancel?.();
  say(SAFETY_FIRST, { source: "safety", interrupt: true });
  let who = { buddy: "your crewmate", commander: "the commander", lines: [] };
  try { who = await api.safety(view.crewId, category); } catch { /* offline: the words and the screen still stand */ }
  let el = document.getElementById("safety");
  if (!el) { el = document.createElement("section"); el.id = "safety"; el.className = "safety"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
  el.innerHTML = `<div class="safety-card">
      <p class="safety-big">I'm here.</p>
      <p>Please call a crewmate now. ${esc(who.buddy)} and the commander, ${esc(who.commander)}, are being told, and a priority message is going to the flight surgeon.</p>
      <div class="safety-actions"><button type="button" class="pill pill-light" data-call>Call ${esc(who.buddy)} now</button><button type="button" class="pill pill-ghost" data-ground>Breathe with me</button><button type="button" class="pill pill-ghost" data-with>Someone is with me</button></div>
      <p class="fine">Crew alerts and the message to ground are simulated in this build (SIM). This wording is a draft for clinician review.</p></div>`;
  el.hidden = false;
  el.querySelector("[data-call]").addEventListener("click", (e) => { e.currentTarget.textContent = `Calling ${who.buddy}… (SIM)`; });
  el.querySelector("[data-ground]").addEventListener("click", () => { screens.open("grounding"); el.querySelector(".safety-card").classList.add("is-small"); });
  el.querySelector("[data-with]").addEventListener("click", () => { el.hidden = true; safetyOn = false; screens.open("grounding"); });
  setTimeout(() => { if (safetyOn) say(`You're not alone. ${who.buddy} and the commander are being told. Let's breathe together.`, { source: "safety", append: true }); }, 400);
}

async function handleCommand(text, meta = {}) {
  answering = false;   // a new request outranks the last answer
  const concernCat = text ? wellbeingConcern(text) : null;
  if (concernCat) { if (meta.heard) logLine("You", meta.heard); await safetyFlow(concernCat); return; }
  if (text && view.profile?.wellbeingPlan?.earlySigns?.length) {
    const t = text.toLowerCase();
    const sign = view.profile.wellbeingPlan.earlySigns.find((s) => s.length > 3 && t.includes(s.toLowerCase()));
    const tool = (view.profile.wellbeingPlan.whatHelps || [])[0];
    if (sign && !earlyNoted.has(sign)) {
      earlyNoted.add(sign);
      if (meta.heard) logLine("You", meta.heard);
      say(`You listed "${sign}" as one of your early signs, so I'm taking it seriously.${tool ? ` What usually helps you is ${({ orb_calm: "Stillpoint", race: "Slipstream", greenhouse: "Red Harvest", grounding: "grounding" })[tool] || tool}. Want to start it?` : " Want to talk it through, or try a breathing break?"}`, { source: "local" });
      if (tool) director.run([{ cmd: "open_screen", name: "wellbeing" }]);
      if (meta.via === "voice" && settings.get("listen") !== "ptt") voiceMod.expectReply(9000);   // a yes needs no wake word
      return;
    }
  }
  if (safetyOn && text) {   // during the safety flow: only fixed lines, never a generated reply
    if (meta.heard) logLine("You", meta.heard);
    say("I'm here with you. Is a crewmate with you now?", { source: "safety" });
    return;
  }
  if (meta.heard) logLine("You", meta.via === "typed" ? text : meta.heard);
  if (meta.wakeOnly || !text) {
    // instant: a chime and the orb leaning in, no spoken "yes?" to wait through. The next thing said is the command.
    voiceMod.stopSpeaking();
    cue.wake();
    caption(choosing ? "Who's here? Say your name." : "I'm listening.", "");
    orb.setState("listening"); stages.setOrbBig(true);
    voiceMod.expectReply(8000);
    return;
  }
  const firstTime = !interacted;
  interacted = true;
  const who = crewFromSpeech(text, view.crew, { bare: choosing });
  if (who && (choosing || who !== view.crewId)) { chooseCrew(who); return; }
  if (who) { say(`You're signed in as ${view.state?.display_name || "you"}. Say another name to switch.`, { source: "local" }); return; }
  if (choosing && meta.via === "voice") {   // heard something while the chooser is up that is not a name: stay put, say how
    caption(`I heard “${text}”. Say a name: ${view.crew.map((c) => c.display_name).join(", ")}.`, "");
    return;
  }
  // conversation: after Sentinel answers a spoken request, the next thing said needs no wake phrase
  const followUp = () => { if (meta.via === "voice" && settings.get("listen") !== "ptt") voiceMod.expectReply(9000); };
  const m = matchIntent(text, { wearOpen: stages.current === "vitals" });
  if (m) {
    if (m.local === "stop") { voiceMod.stopSpeaking(); director.cancel(); closeScreen(); return; }
    if (m.local === "digest") { await sendDigest(); followUp(); return; }
    if (m.local === "snooze") { if (dueRoutine()) snoozeDue(); else say("There's nothing to snooze right now.", { source: "local" }); return; }
    if (m.local === "mode") { await setMode(m.mode); followUp(); return; }
    if (m.local === "blackout") {
      try { const o = await api.ops(view.crewId, { blackout_min: m.minutes }); if (view.aux) view.aux.ops = o; renderOps(o); } catch (e) { showNotice(e.message); }
      say(m.minutes ? "Simulating a comms blackout for 15 minutes. I'll keep working on board, and anything for ground waits in the queue." : "The link to ground is back. Queued messages are on their way, urgent first.", { source: "local" });
      followUp(); return;
    }
    if (m.local === "readiness") {
      try { const r = await api.readiness(view.crewId); say(r.summary.replace(/;/g, ",") + ".", { source: "local" }); } catch (e) { showNotice(e.message); }
      followUp(); return;
    }
    if (m.local === "fullscreen") {
      const ok = await toggleFullscreen(m.on);
      say(ok ? (m.on ? "Full screen." : "Leaving full screen.") : "Tap the full-screen button at the top right; the browser needs a tap for that.", { source: "local" });
      return;
    }
    if (m.local === "cabin") {
      const c = view.state?.cabin || {};
      say(`Cabin oxygen is ${c.oxygen_pct} percent and carbon dioxide ${c.co2_ppm} parts per million. ${c.alert ? "That is out of range and flagged to ground." : "Both are within limits."} These cabin readings are simulated.`, { source: "local" });
      followUp();
      return;
    }
    if (m.commands?.[0]?.cmd === "suit") { await suitCommand(m.commands[0]); followUp(); return; }
    if (m.intent === "vision") say("Let me see you.", { source: "local" });
    else if (m.commands?.[0]?.cmd === "wearable") {
      const w = m.commands[0], P = { chest: "the chest hub", wrist: "the watch", patch: "the patch" };
      const line = { open: `Here's ${P[w.part] || "the SpaceWear hardware"}.`, explode: "Exploded view.", assemble: "Back together.", zoom_in: "Closer.",
        alert: { sos: "Simulating a manual SOS.", radiation: "Simulating a radiation alert: three long pulses.", health: "Simulating a health warning.", normal: "All clear." }[w.kind], zoom_out: "Zooming out.", turn: w.direction === "back" ? "Turning it around." : `Turning it ${w.direction || "right"}.`, reset: "Reset.", close: "Hardware closed." }[w.action];
      if (line) say(line, { source: "local" });
    }
    else if (m.commands?.[0]?.cmd === "open_screen") {
      // a short spoken confirmation, so a voice command never happens in silence (cached after the first time)
      const NAMES = { vitals: "your vitals", mission: "the mission", body: "your body", radiation: "radiation watch", wellbeing: "wellbeing",
        orb_calm: "Stillpoint", race: "Slipstream", greenhouse: "Red Harvest", grounding: "grounding", settings: "settings", about: "the credits",
        trends: "your trends", health_log: "the health log", cognitive: "the reaction test", symptom: "the symptom map", crew: "the crew",
        hardware: "the hardware", vision: "the camera", cabin: "the cabin", interventions: "what helps you", exam: "the health exam",
        measures: "weekly measures", ground: "messages to ground", evidence: "the NASA evidence", profile: "your health profile" };
      const n = m.commands[0].name;
      if (NAMES[n]) say(`${["race", "greenhouse", "orb_calm", "grounding", "cognitive", "exam"].includes(n) ? "Starting" : "Opening"} ${NAMES[n]}.`, { source: "local" });
    }
    director.run(m.commands);
    followUp();
    return;
  }
  // everything else goes to the brain (streamed: first sentence is spoken while the rest arrives)
  emit("voice:thinking", true);
  caption("Thinking…", "");
  try {
    let spoke = false, first = true;
    answering = true;
    const r = await api.chatStream(view.crewId, text, (sentence, source) => {
      const isFirst = first;
      if (first) { emit("voice:thinking", false); first = false; }
      spoke = true;
      say(sentence, { source: source === "llm" ? "LLM" : "rules", append: !isFirst });
    }, { screen: screens.current?.() || "", view: stages.current, theme: document.documentElement.dataset.theme === "light" ? "light" : "dark" });
    // commands for the app itself (theme, who is here); the rest go to the director
    for (const c of r.commands || []) {
      if (c.cmd === "set_theme") ctx.setTheme?.(c.theme);
      if (c.cmd === "suit") suitCommand(c);
      if (c.cmd === "switch_crew") { const m = view.crew.find((x) => x.display_name.toLowerCase() === String(c.name).toLowerCase()); if (m && m.crew_id !== view.crewId) switchCrew(m.crew_id, "manual"); }
    }
    r.commands = (r.commands || []).filter((c) => c.cmd !== "set_theme" && c.cmd !== "switch_crew" && c.cmd !== "suit");
    emit("voice:thinking", false);
    if (!spoke && r.reply) say(r.reply, { source: r.source === "llm" ? "LLM" : "rules" });
    followUp();
    if (r.commands?.length) director.run(r.commands);   // straight away: the screen moves while Sentinel is still speaking
    else if (firstTime && stages.current === "assistant") setTimeout(() => { if (!director.busy && stages.current === "assistant" && !voiceMod.voice.capturing) stages.go("mission"); }, 9000);
  } catch {
    emit("voice:thinking", false);
    showNotice("Brain unavailable, using local answers");
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
      if (changed) say(`Hello ${view.crew.find((c) => c.crew_id === r.crew_id)?.display_name || ""}.`, { source: "local" });
    }
  } catch { /* identify failed: keep the current crew member */ }
}

function switchCrew(id, source) {
  if (!id) return;
  setCrew(id, source);
  api.profile(id).then((p) => { view.profile = p; }).catch(() => {});
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
    applyListening();
    demoPanel.render();
  }
}

function openIntervention(name) {
  const map = { breathing: "orb_calm", aurora_run: "race", grounding: "grounding", greenhouse: "greenhouse", earth_window: "earth_window", music: "music", connection: "connection" };
  screens.open(map[name] || "interventions");
}

// ---------- suit integrity (SIM): the twin goes red where the suit is leaking ----------
let suitShown = null, suitAnnounced = 0, suitLabelLoop = false;
const SUIT_WORD = { watch: "Suit pressure dropping", breach: "Suit breach" };
function updateSuit(suit) {
  const bad = suit && suit.mode === "eva" && (suit.integrity === "watch" || suit.integrity === "breach");
  const key = bad ? `${suit.region}:${suit.integrity}` : "";
  const banner = $("suit-alert");
  ctx.body3d?.setBreach?.(bad ? suit.region : null, bad ? suit.integrity : undefined);
  if (!bad) {
    if (suitShown) { banner.hidden = true; $("suit-tag").hidden = true; suitShown = null; ctx.wearCmd?.({ cmd: "wearable", action: "alert", kind: "normal" }); }
    $("sb-suit").hidden = !(suit && suit.mode === "eva");
    if (suit?.mode === "eva") $("sb-suit").textContent = `EVA · suit ${suit.pressure_psi} psi`;
    return;
  }
  $("sb-suit").hidden = false; $("sb-suit").textContent = `EVA · suit ${suit.pressure_psi} psi`;
  banner.hidden = false;
  banner.className = `suit-alert is-${suit.integrity}`;
  banner.innerHTML = `<div class="sa-head"><span class="sa-dot"></span><b>${SUIT_WORD[suit.integrity]}: ${esc(suit.region_label)}</b><span class="badge badge-sim">SIM</span></div>
    <p class="sa-read"><span>${suit.pressure_psi} <small>psi</small></span><span>${suit.pressure_rate_psi_min} <small>psi/min</small></span><span>O₂ ${suit.o2_flow_lb_hr} <small>lb/hr</small></span><span>CO₂ ${suit.co2_mmhg} <small>mmHg</small></span></p>
    <ol>${(suit.steps || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
    <p class="fine">Illustrative steps; the mission's EVA procedures and your cue card come first.</p>`;
  $("suit-tag").textContent = suit.region_label;
  if (suitShown !== key) {
    suitShown = key;
    if (suit.incident !== suitAnnounced || suit.integrity === "breach") {
      const first = suit.incident !== suitAnnounced;
      suitAnnounced = suit.incident;
      if (stages.current !== "body") stages.go("body");
      ctx.wearCmd?.({ cmd: "wearable", action: "alert", kind: "suit" });
      cue.nudge?.();
      say(suit.integrity === "breach"
        ? `Suit breach in your ${suit.region_label}. Stop work and tell your partner. Pressure is ${suit.pressure_psi} psi and falling. Check the ${suit.region_label}, then head back to the airlock.`
        : first ? `Your suit is losing pressure slowly, near the ${suit.region_label}. ${suit.pressure_psi} psi. Check it now.` : "", { source: "local", interrupt: true });
    }
  }
  if (!suitLabelLoop) {   // the label rides on the red patch of the twin
    suitLabelLoop = true;
    world.onFrame(() => {
      const tag = $("suit-tag"), p = suitShown && stages.current === "body" ? ctx.body3d?.breachScreen?.() : null;
      tag.hidden = !p || p.behind;
      if (p && !p.behind) tag.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    });
  }
}
async function suitCommand(c) {
  try {
    const st = await api.suit(view.crewId, { action: c.action, region: c.region, text: c.text, size: c.size });
    if (view.aux) view.aux.suit = st;
    updateSuit(st);
    if (c.action === "eva") say(`EVA started. ${st.readiness ? st.readiness.summary.replace(/;/g, ",") + "." : ""} I'm watching your suit, and routine reminders are paused.`, { source: "local" });
    if (c.action === "iva") say("Welcome back. Recovery check: drink some water, log anything that hurts or feels off, and I'll look at your pulse again in ten minutes. Reminders are back on.", { source: "local" });
    if (c.action === "seal") say("Leak sealed. Suit pressure is holding.", { source: "local" });
  } catch (e) { showNotice(`Suit link: ${e.message}`); }
}

ctx.suitCommand = suitCommand;

// ---------- mission operations: mode, the link to ground, the digest ----------
let lastComms = "";
function renderOps(o) {
  if (!o) return;
  const el = $("sb-comms"), c = o.comms || {};
  el.hidden = false;
  el.className = `badge sb-comms is-${c.status}`;
  el.textContent = c.status === "blackout" ? `No link · ${Math.ceil(c.minutes_left)} min` : c.status === "delayed" ? `Ground · ${c.one_way_min} min delay` : "Ground · live";
  el.title = c.note || "Link to ground (SIM)";
  if (lastComms && lastComms !== c.status) showNotice(c.status === "blackout" ? "Link to ground lost (SIM). Sentinel carries on; messages wait in the queue." : c.status === "live" || c.status === "delayed" ? "Link to ground restored (SIM). Queued messages are on their way." : "");
  lastComms = c.status;
  const md = $("sb-mode");
  md.hidden = o.mode === "routine" || o.mode === "eva";
  md.textContent = o.mode === "rest" ? "Rest · urgent only" : o.mode === "contingency" ? "Contingency" : o.mode;
}
async function setMode(mode) {
  try { const o = await api.ops(view.crewId, { mode }); if (view.aux) view.aux.ops = o; renderOps(o); } catch (e) { showNotice(e.message); return; }
  say(mode === "rest" ? "Rest mode. Routine reminders are off; only urgent and cabin alerts will reach you. Sleep well." : mode === "routine" ? "Good morning. Routine mode, reminders are back on." : "Contingency mode. Short steps only; tell me what's happening.", { source: "local" });
}
async function sendDigest(note = "") {
  try {
    const d = await api.digest(view.crewId, note);
    const p = d.packet || {};
    say(p.status === "queued (no link)"
      ? `Digest ready, priority ${d.priority.toLowerCase()}. There's no link right now, so it's queued and goes out the moment the link returns.`
      : `Digest sent to the flight surgeon, priority ${d.priority.toLowerCase()}. It arrives in about ${Math.max(1, Math.round((p.eta_s || 0) / 60))} minutes; a reply can't come back for at least ${Math.max(1, Math.round((p.reply_earliest_s || 0) / 60))}.`, { source: "local" });
  } catch (e) { showNotice(`Digest: ${e.message}`); }
}
ctx.sendDigest = sendDigest; ctx.setMode = setMode;

// ---------- every poll ----------
function onState(v) {
  const s = v.state, aux = v.aux;
  if (!s) return;
  updateSuit(aux?.suit);
  renderOps(aux?.ops);
  $("sb-crew-name").textContent = s.display_name;
  $("greet-hello").textContent = `Hello ${s.display_name}`;
  const id = $("sb-identity");
  if (s.identity?.source === "voice" && v.identitySource === "voice") { id.className = "badge badge-live"; id.textContent = `voice ${Math.round((s.identity.confidence || 0) * 100)}%`; }
  else { id.className = "badge badge-sim"; id.textContent = "manual"; }
  const c = aux?.clock;
  if (c) $("sb-clock").textContent = `Day ${c.mission_day} · ${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
  $("sb-o2").textContent = `O2 ${s.cabin.oxygen_pct.toFixed(1)}%`;
  $("sb-co2").textContent = `CO2 ${Math.round(s.cabin.co2_ppm)} ppm`;
  $("sb-cabin-word").textContent = s.cabin.alert ? "Cabin alert" : "Cabin nominal";
  const sw = v.spaceweather;
  $("sb-rad").textContent = `Radiation S${s.radiation.storm_level}`;
  const rb = sw?.scenario ? "SIM" : sw?.source === "live" ? "LIVE" : "SNAPSHOT";
  if ($("sb-rad-badge").dataset.k !== rb) { $("sb-rad-badge").innerHTML = badgeHTML(rb); $("sb-rad-badge").dataset.k = rb; }
  document.querySelector(".sb-cabin").classList.toggle("is-alert", !!s.cabin.alert);
  if (view.online) $("sb-link").textContent = "Brain online";
  // a zone shows the worst of its indicators (BODY-2): the brain's verdict, never better than the readings
  body.setZoneStates(zoneStatuses(aux?.assessment?.zones, Object.fromEntries(body.ZONES.map((z) => [z, zoneReadings(z, s, aux)]))));
  if (s.radiation.storm_level >= 1 && !body.radiationShown()) body.showRadiation(true);
  $("btn-radinfo").hidden = !body.radiationShown();
  renderTiles(document.getElementById("app"), v, v.spaceweather);
  renderMission($("mission-cards"), v, { spaceweather: v.spaceweather, due: dueRoutine(), nextRoutine: nextRoutine(), wilt: view.wilt || 0 });
  renderFindings($("findings"), $("findings-status"), v, (z) => director.run([{ cmd: "check_zone", zones: [z] }]));
  renderBodyPanels();
  if (stages.current === "vitals") renderVitals(v);
  // chips: in an organ view only that organ's chip; otherwise heart, lungs and sleep (Sentinel Skin sets its own)
  if (!ctx.skinChips) ctx.body3d?.setChips(ctx.organZone ? Object.fromEntries([[ctx.organZone, chipText(ctx.organZone, v)]].filter(([, c]) => c)) : Object.fromEntries(["heart", "lungs", "head"].map((z) => [z, chipText(z, v)]).filter(([, c]) => c)));
  space.setProfile(s.radiation.mission_profile);
  const sev = s.action?.severity || "none";
  orb.setSeverity(["flag_cabin", "flag_radiation", "flag_ground"].includes(s.action?.type) ? "alert" : sev === "watch" ? "watch" : "none");
  banner.update(s, aux);
  renderActionCard(s, aux);
  // Sentinel noticed something: point at it
  const z = s.action?.zone || "";
  if (ctx.body3d && s.body_model && ctx.body3d.model !== s.body_model) ctx.body3d.setModel(s.body_model).catch((e) => console.warn("body model switch failed", e));
  if (lastZone === null) lastZone = z;   // on start or a crew switch, Sentinel mentions it rather than taking over the screen
  else if (z !== lastZone) {
    lastZone = z;
    if (z && z !== "cabin" && !director.busy && !document.querySelector("#sheet.is-full:not([hidden])")) director.run([{ cmd: "point_to", zone: z }]);
  }
  const sc = aux?.scenario;
  if (sc && sc.seq !== view.scenarioSeq) {
    const first = view.scenarioSeq === 0 && sc.seq > 0 && !sc.running && sc.step !== "reset";
    view.scenarioSeq = sc.seq;
    if (!first) runScenarioStep(sc);
  }
}

function runScenarioStep(sc) {
  if (sc.crew_id && sc.crew_id !== view.crewId) switchCrew(sc.crew_id, "manual");
  if (sc.step === "reset") { director.cancel(); closeScreen(); banner.hide(); lastZone = null; invalidateSparks(); return; }
  if (sc.say) say(sc.say, { source: "SIM line" });
  if (sc.commands?.length) director.run(sc.commands);
}

function renderActionCard(s, aux) {
  const a = s.action || {};
  const card = $("action-card");
  const key = `${s.crew_id}|${a.type}|${a.zone}|${a.intervention}|${a.detail}`;
  if (key === lastActionKey) return;
  lastActionKey = key;
  let text = "", btn = null, sev = "info", badge = "SIM", snoozeBtn = false;
  if (!a.type || a.type === "none" || a.type.startsWith("flag_")) {
    const due = dueRoutine();
    if (!due) { card.hidden = true; return; }
    text = `Due now: ${due.label}`; badge = "LIVE";
    btn = [due.button, () => director.run([{ cmd: "open_screen", name: due.screen }])];
    snoozeBtn = reminders.canSnooze(due.id, snoozesFor(view.aux.clock.mission_day));
  } else {
    const readings = zoneReadings(a.zone, s, aux);
    badge = readings.some((r) => r.badge !== "LIVE") || !readings.length ? "SIM" : "LIVE";
    sev = a.severity === "alert" ? "alert" : a.severity === "watch" ? "watch" : "info";
    text = a.detail || "";
    btn = {
      offer_orb_calm: ["Start Stillpoint", () => director.run([{ cmd: "open_screen", name: "orb_calm" }])],
      offer_intervention: [INTERVENTIONS.find((i) => i.id === a.intervention)?.label || "Suggestions", () => openIntervention(a.intervention)],
      suggest_medicine: ["Health log", () => director.run([{ cmd: "open_screen", name: "health_log" }])],
      gentle_checkin: ["Log how I feel", () => director.run([{ cmd: "open_screen", name: "health_log" }])],
    }[a.type] || null;
  }
  card.hidden = false;
  card.className = `suggest is-${sev}`;
  card.innerHTML = `<span class="ac-text">${esc(text)}</span>${badgeHTML(badge)}${btn ? `<button class="pill pill-light" type="button" data-act>${esc(btn[0])}</button>` : ""}${snoozeBtn ? `<button class="pill pill-ghost" type="button" data-snooze>Snooze 30 min</button>` : ""}`;
  card.querySelector("[data-act]")?.addEventListener("click", btn[1]);
  card.querySelector("[data-snooze]")?.addEventListener("click", snoozeDue);
}

// ---------- routine prompts and the greenhouse ----------
const ROUTINE = [
  { id: "vitals", label: "morning vitals", from: 6, to: 11, screen: "health_log", button: "Log vitals" },
  { id: "exercise", label: "exercise log", from: 10, to: 13, screen: "health_log", button: "Log exercise" },
  { id: "cognitive", label: "midday cognitive check", from: 11, to: 16, screen: "cognitive", button: "Start the check" },
  { id: "hydration", label: "hydration and meals", from: 13, to: 18, screen: "health_log", button: "Log fluids" },
  { id: "log", label: "evening mood and sleep log", from: 18, to: 23, screen: "health_log", button: "Log mood and sleep" },
  { id: "winddown", label: "sleep wind-down", from: 20, to: 23, screen: "health_log", button: "Log sleep" },
];
const nudged = new Set();
function routineKey(day) { return `sentinel:routine:${view.crewId}:${day}`; }
function routineDone(day) { try { return JSON.parse(localStorage.getItem(routineKey(day)) || "{}"); } catch { return {}; } }
function snoozesFor(day) { try { return JSON.parse(localStorage.getItem(`${routineKey(day)}:snooze`) || "{}"); } catch { return {}; } }
function saveSnoozes(day, s) { try { localStorage.setItem(`${routineKey(day)}:snooze`, JSON.stringify(s)); } catch { /* storage blocked */ } }
const escalated = {};
/** The sleep block from the profile's reminder times (wind-down hour to check-in hour), else 22 to 6. */
function sleepBlock() {
  const t = view.profile?.preferences?.reminderTimes || {};
  const h = (x, d) => { const m = /^(\d{1,2}):(\d{2})/.exec(x || ""); return m ? Number(m[1]) + Number(m[2]) / 60 : d; };
  return { from: Math.max(20, Math.ceil(h(t.winddown, 21.5) + 0.5)), to: Math.floor(h(t.checkin, 8)) - 2 };
}
function setRoutineDone(day, id) {
  const d = routineDone(day);
  d[id] = true;
  try { localStorage.setItem(routineKey(day), JSON.stringify(d)); } catch { /* storage blocked */ }
}
function dueRoutine() {
  const c = view.aux?.clock;
  if (!c) return null;
  return reminders.dueNow(ROUTINE, c, routineDone(c.mission_day), snoozesFor(c.mission_day), { paused: !!view.aux?.ops?.reminders_paused, sleep: sleepBlock() });
}
function snoozeDue() {
  const c = view.aux?.clock, due = dueRoutine();
  if (!c || !due) return;
  const s = snoozesFor(c.mission_day);
  if (!reminders.canSnooze(due.id, s)) { say(`I can't snooze the ${due.label} again; it's been put off twice. It only takes a minute.`, { source: "local" }); return; }
  const n = reminders.snooze(due.id, c, s);
  saveSnoozes(c.mission_day, n);
  lastActionKey = "";
  note(`Snoozed: ${due.label}, back in 30 minutes (${reminders.MAX_SNOOZES - n[due.id].count} snooze${reminders.MAX_SNOOZES - n[due.id].count === 1 ? "" : "s"} left).`);
}
ctx.snoozeDue = snoozeDue;
function nextRoutine() {
  const c = view.aux?.clock;
  if (!c) return null;
  const done = routineDone(c.mission_day);
  return ROUTINE.find((r) => r.from > c.hour && !done[r.id]) || null;
}
async function onCheckin(kind, entries = {}) {
  const c = view.aux?.clock;
  if (!c || !view.state) return;
  const id = kind === "log" ? (c.hour < 14 ? "vitals" : "log") : kind;
  setRoutineDone(c.mission_day, id);
  if (entries.exercise_minutes != null) setRoutineDone(c.mission_day, "exercise");
  if (entries.hydration_ml != null) setRoutineDone(c.mission_day, "hydration");
  if (entries.sleep_hours != null) setRoutineDone(c.mission_day, "winddown");
  lastActionKey = "";
  try { await patch({ engagement: { checkins_today: (view.state.engagement.checkins_today || 0) + 1 } }); } catch {}
}
let lastDay = null;
async function routineTick() {
  if (view.aux?.ops?.reminders_paused) return;   // EVA or rest: routine reminders wait (section 12.2)
  const c = view.aux?.clock;
  if (!c || !view.state) return;
  if (lastDay != null && c.mission_day > lastDay) {
    let stage = view.state.engagement.greenhouse_stage;
    let streak = view.state.engagement.streak_days;
    let missed = view.state.engagement.missed_checkins || 0;
    for (let d = lastDay; d < c.mission_day; d++) {
      const done = routineDone(d);
      const ok = routineComplete(done);
      if (!done.vitals) missed++;
      if (!done.log) missed++;
      stage = greenhouseDay(stage, ok);
      streak = ok ? streak + 1 : 0;
      view.wilt = ok ? 0 : 0.6;
    }
    patch({ engagement: { greenhouse_stage: stage, streak_days: streak, missed_checkins: missed } }).catch(() => {});
    if (missed > (view.state.engagement.missed_checkins || 0)) {
      cue.nudge();
      note("A health check-in was missed. When you have a moment, log your vitals or mood and sleep.");
    }
  }
  lastDay = c.mission_day;
  const due = dueRoutine();
  if (due) {
    const k = `${c.mission_day}:${due.id}`;
    const sz = snoozesFor(c.mission_day);
    if (reminders.shouldEscalate(due, c, routineDone(c.mission_day), sz, escalated)) {
      escalated[due.id] = true;
      say(`Gentle reminder: your ${due.label} is still open. It takes about a minute; want to do it now?`, { source: "local", append: true });
    }
    if (!nudged.has(k)) { nudged.add(k); emit("reminder.due", { type: due.id === "vitals" || due.id === "log" ? "checkin" : "measurement", crewId: view.crewId, label: due.label }); cue.nudge(); note(`Due now: ${due.label}.`); lastActionKey = ""; }
  }
}
on("state", () => { if (lastDay == null && view.aux?.clock) lastDay = view.aux.clock.mission_day; });

boot();
emit("boot");
