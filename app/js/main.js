// Sentinel v2 entry point: start tap, world + orb, stages, Director, dashboards, voice, polling, routines.
import { api } from "./core/api.js";
import { emit, on } from "./core/bus.js";
import { createDirector } from "./core/director.js";
import { matchIntent } from "./core/intents.js";
import { audioContext, cue, setMuted, isMuted } from "./core/sound.js";
import { createStages } from "./core/stages.js";
import { patch, pollOnce, setCrew, startPolling, view } from "./core/state.js";
import * as body from "./interface/body.js";
import { createBanner } from "./interface/banner.js";
import { createDemoPanel } from "./interface/demopanel.js";
import { createOrb } from "./interface/orb.js";
import { mountMission, renderFindings, renderMission } from "./interface/dashboard.js";
import { ZONE_NAMES, badgeHTML, esc, zoneReadings } from "./interface/readings.js";
import { closeScreen, initScreens, registerScreen } from "./interface/screens.js";
import { invalidateSparks, mountTiles, refreshSparks, renderTiles } from "./interface/tiles.js";
import { renderRace } from "./experience/race/race.js";
import { renderGreenhouse } from "./experience/greenhouse.js";
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
  const ready = () => {
    $("start-screen").classList.add("is-ready");
    if (window.gsap) window.gsap.fromTo(".intro-copy", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 1.1, ease: "power2.out" });
    else document.querySelector(".intro-copy").style.opacity = 1;
  };
  const form = () => {
    stages.setOrbMode("intro", 0);
    world.orbTo({ x: innerWidth / 2, y: innerHeight / 2, size: 0, opacity: 1 }, 0);
    const t = { x: innerWidth / 2, y: innerHeight * 0.3, size: Math.min(innerHeight * 0.27, innerWidth * 0.3, 240), opacity: 1 };
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
async function start() {
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
  await stages.go("assistant");
  world.remove("intro");
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const id = settings.get("mic");
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id ? { deviceId: { exact: id } } : {}) } });
      await voiceMod.initMic(mic);
    } catch { note("Microphone not available: type, or use the menu."); }
  }
  applyListening();
  const name = view.state?.display_name || "";
  say(`Hello${name ? ` ${name}` : ""}. I'm Sentinel. Ask me anything, or say hey Sentinel.`, { source: "local" });
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
  const ptt = settings.get("listen") === "ptt";
  if (!voiceMod.voice.micReady && !voiceMod.voice.recognitionAvailable) { $("voice-mode").textContent = "typing"; return; }
  if (ptt) { voiceMod.stopListening(); $("voice-mode").textContent = "push to talk"; }
  else if (voiceMod.startListening()) $("voice-mode").textContent = "say hey sentinel";
  $("btn-mic").classList.toggle("is-wake", !ptt);
}
ctx.applyListening = applyListening;

// ---------- app ----------
async function mountApp() {
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
  registerScreen("orb_calm", { title: "Orb Calm", orb: true, render: renderOrbCalm });
  registerScreen("race", { title: "Space race", full: true, render: renderRace });
  registerScreen("greenhouse", { title: "Greenhouse", render: renderGreenhouse });
  registerScreen("hardware", { title: "Sentinel Skin", badge: "DESIGNED", render: renderHardware });
  registerScreen("interventions", { title: "Suggestions", render: (el, c, arg) => renderMenu(el, c, arg) });
  registerScreen("earth_window", { title: "Earth window", badge: "SIM", render: renderEarth });
  registerScreen("music", { title: "Ambient sound", render: renderMusic });
  registerScreen("connection", { title: "Message a crewmate", badge: "DESIGNED", render: renderConnection });

  // the body (async; the Director waits for it when needed)
  import("./world/body3d.js").then(async ({ createBody }) => {
    const b = await createBody(world, $("body-host"), { tablet: isTablet, onZoneClick: zonePopover, model: view.state?.body_model || "male" });
    b.preload(b.model === "male" ? "female" : "male");
    world.add("body", b);
    body.setImpl(b);
    ctx.body3d = b;
    import("./world/wearable3d.js").then(({ mountWearableFigure }) => {
      ctx.wearableDispose = mountWearableFigure($("body-host"), b, world, ctx);
    }).catch((e) => console.warn("wearable model failed", e));
    $("body-loading").hidden = true;
    if (view.aux) body.setZoneStates(view.aux.assessment?.zones);
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

  const first = view.crew[0]?.crew_id;
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

// A tap on a body dot: a small card with Check and Details (team lead item 6)
function zonePopover(zone, btn) {
  document.querySelector(".zone-pop")?.remove();
  const host = $("body-host");
  const r = btn.getBoundingClientRect(), h = host.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "zone-pop card";
  const sev = view.aux?.assessment?.zones?.[zone] || "ok";
  pop.innerHTML = `<strong>${esc(ZONE_NAMES[zone])}</strong><span class="note st-${sev}">${sev === "ok" ? "Within your usual range" : sev === "alert" ? "Past the alert line" : "Worth watching"}</span>
    <div class="row"><button class="pill pill-dark" type="button" data-check>Check</button><button class="pill pill-ghost" type="button" data-details>Details</button></div>`;
  pop.style.left = `${r.left - h.left + 10}px`; pop.style.top = `${r.top - h.top + 22}px`;
  host.appendChild(pop);
  if (r.left - h.left > h.width - 240) pop.style.transform = "translate(calc(-100% - 20px), -50%)";
  pop.querySelector("[data-check]").addEventListener("click", () => { pop.remove(); director.run([{ cmd: "check_zone", zones: [zone] }]); });
  pop.querySelector("[data-details]").addEventListener("click", () => { pop.remove(); screens.zone(zone); });
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
  $("btn-xray").addEventListener("click", (e) => director.run([{ cmd: "xray", on: e.currentTarget.getAttribute("aria-pressed") !== "true" }]));
  $("btn-turn").addEventListener("click", () => ctx.body3d?.turnBy(90));
  $("btn-radlayer").addEventListener("click", (e) => director.run([{ cmd: "show_radiation", on: e.currentTarget.getAttribute("aria-pressed") !== "true" }]));
  $("btn-radinfo").addEventListener("click", () => screens.zone("whole_body"));
  $("btn-key").addEventListener("click", () => screens.open("about"));
  $("btn-cam").addEventListener("click", () => (vision.state.on ? vision.stop() : vision.start()));
  $("btn-cam-devices").addEventListener("click", () => screens.open("settings"));
  $("btn-mute").addEventListener("click", (e) => { const m = !isMuted(); setMuted(m); e.currentTarget.setAttribute("aria-pressed", String(m)); });
  $("sb-crew-name").addEventListener("click", () => director.run([{ cmd: "open_screen", name: "crew" }]));
  window.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select")) return;
    if (e.key === "h" || e.key === "H") director.run([{ cmd: "open_screen", name: "hardware" }]);
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

function pushToTalk() {
  voiceMod.stopSpeaking();
  if (voiceMod.pushToTalk()) { $("btn-mic").setAttribute("aria-pressed", "true"); cue.wake(); }
  else { note("No microphone: type your question below."); $("ask-input").focus(); }
}

function wireVoice() {
  voiceMod.initVoice({ onCommand: (text, meta) => handleCommand(text, meta), onUtterance: (audio) => onUtterance(audio) });
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
  on("voice:speaking-end", () => { orb.setState("idle"); orb.setSpeakLevel(0); stages.setOrbBig(false); });
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
function say(text, opts = {}) {
  if (!text) return Promise.resolve();
  logLine("Sentinel", text, opts.source);
  speakingSource = opts.source || "";
  // the caption follows what is being said: a queued sentence is captioned when it starts playing
  if (!opts.append || !voiceMod.voice.speaking) caption(text, opts.source);
  return voiceMod.speak(text, { interrupt: opts.append ? false : true });
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
async function handleCommand(text, meta = {}) {
  if (meta.heard) logLine("You", meta.via === "typed" ? text : meta.heard);
  if (meta.wakeOnly || !text) {
    cue.wake();
    say(`Yes${view.state?.display_name ? `, ${view.state.display_name}` : ""}?`, { source: "local" });
    return;
  }
  const firstTime = !interacted;
  interacted = true;
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
  // everything else goes to the brain (streamed: first sentence is spoken while the rest arrives)
  emit("voice:thinking", true);
  caption("Thinking…", "");
  try {
    let spoke = false, first = true;
    const r = await api.chatStream(view.crewId, text, (sentence, source) => {
      const isFirst = first;
      if (first) { emit("voice:thinking", false); first = false; }
      spoke = true;
      say(sentence, { source: source === "llm" ? "LLM" : "rules", append: !isFirst });
    });
    emit("voice:thinking", false);
    if (!spoke && r.reply) say(r.reply, { source: r.source === "llm" ? "LLM" : "rules" });
    if (r.commands?.length) { await new Promise((res) => setTimeout(res, 400)); director.run(r.commands); }
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
  const map = { breathing: "orb_calm", aurora_run: "race", earth_window: "earth_window", music: "music", connection: "connection" };
  screens.open(map[name] || "interventions");
}

// ---------- every poll ----------
function onState(v) {
  const s = v.state, aux = v.aux;
  if (!s) return;
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
  body.setZoneStates(aux?.assessment?.zones);
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
  let text = "", btn = null, sev = "info", badge = "SIM";
  if (!a.type || a.type === "none" || a.type.startsWith("flag_")) {
    const due = dueRoutine();
    if (!due) { card.hidden = true; return; }
    text = `Due now: ${due.label}`; badge = "LIVE";
    btn = [due.button, () => director.run([{ cmd: "open_screen", name: due.screen }])];
  } else {
    const readings = zoneReadings(a.zone, s, aux);
    badge = readings.some((r) => r.badge !== "LIVE") || !readings.length ? "SIM" : "LIVE";
    sev = a.severity === "alert" ? "alert" : a.severity === "watch" ? "watch" : "info";
    text = a.detail || "";
    btn = {
      offer_orb_calm: ["Start Orb Calm", () => director.run([{ cmd: "open_screen", name: "orb_calm" }])],
      offer_intervention: [INTERVENTIONS.find((i) => i.id === a.intervention)?.label || "Suggestions", () => openIntervention(a.intervention)],
      suggest_medicine: ["Health log", () => director.run([{ cmd: "open_screen", name: "health_log" }])],
      gentle_checkin: ["Log how I feel", () => director.run([{ cmd: "open_screen", name: "health_log" }])],
    }[a.type] || null;
  }
  card.hidden = false;
  card.className = `suggest is-${sev}`;
  card.innerHTML = `<span class="ac-text">${esc(text)}</span>${badgeHTML(badge)}${btn ? `<button class="pill pill-light" type="button" data-act>${esc(btn[0])}</button>` : ""}`;
  card.querySelector("[data-act]")?.addEventListener("click", btn[1]);
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
    if (!nudged.has(k)) { nudged.add(k); emit("reminder.due", { type: due.id === "vitals" || due.id === "log" ? "checkin" : "measurement", crewId: view.crewId, label: due.label }); cue.nudge(); note(`Due now: ${due.label}.`); lastActionKey = ""; }
  }
}
on("state", () => { if (lastDay == null && view.aux?.clock) lastDay = view.aux.clock.mission_day; });

boot();
emit("boot");
