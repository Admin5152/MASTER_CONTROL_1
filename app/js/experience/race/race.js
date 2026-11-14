// Space race (brief section 7 item 4): an original racer, built in Blender (app/assets/game), flies three
// laps of a course weaving past real planets (Solar System Scope textures) against three ghost racers.
// Each planet's beacon gives its power-up: Earth shield, Mars boost, Jupiter slingshot + magnet, Saturn
// ring dash, Moon low gravity (rivals in slow motion). No fail state: an asteroid only slows you briefly.
// Rendered in the one full-screen world (no box); the HUD floats on top. Tied to health: offered as a
// boredom or stress break, mood before and after is logged (LIVE), and a calm heart rate (its own
// LIVE/SIM badge) steadies the handling a little.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { api } from "../../core/api.js";
import * as L from "./logic.js";
import { audioContext, isMuted } from "../../core/sound.js";
import { scienceDrawer } from "../science.js";
import { Lensflare, LensflareElement } from "three/addons/objects/Lensflare.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createFx, flareTextures, makeAsteroid, makeBeacon, makeBoostRing } from "./fx.js";

const PB_KEY = (id) => `sentinel.race.pb.${id}`;
function loadPB(id) { try { return JSON.parse(localStorage.getItem(PB_KEY(id)) || "null"); } catch { return null; } }
function savePB(id, pb) { try { localStorage.setItem(PB_KEY(id), JSON.stringify(pb)); } catch { /* private mode */ } }

// ---- difficulty: rival pace, how long a hit slows you, how many asteroids drift ----
const DIFF = {
  cadet: { name: "Cadet", rival: 0.95, slow: 0.0, driftEvery: 4 },
  pilot: { name: "Pilot", rival: 1.05, slow: 0.35, driftEvery: 2 },
  ace: { name: "Ace", rival: 1.13, slow: 0.7, driftEvery: 1 },
};
const SURF_LEN = 170;     // how far the planet run lasts (track units)

// ---- multiplayer: rooms on the laptop's server (brain/race_rooms.py) ----
function deviceId() {
  try { let v = localStorage.getItem("sentinel.device"); if (!v) { v = Math.random().toString(36).slice(2, 10); localStorage.setItem("sentinel.device", v); } return v; } catch { return "dev" + Math.floor(Math.random() * 1e6); }
}
async function roomCall(path, body) {
  const r = await fetch(`../api/race/room${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
  return j;
}

/** A short synthesized tone for game feedback (respects mute). */
function cueTone(freq, dur = 0.15, delay = 0, type = "sine") {
  const c = audioContext();
  if (!c || isMuted()) return;
  const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(freq, t0); o.frequency.exponentialRampToValueAtTime(freq * (type === "sawtooth" ? 0.5 : 1.5), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}

/** Engine hum: pitch follows speed, the filter opens when boosting. */
function engineSound() {
  const c = audioContext();
  if (!c || isMuted()) return { set() {}, stop() {} };
  const o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
  o.type = "sawtooth"; o2.type = "square"; o2.detune.value = 7; lp.type = "lowpass"; lp.frequency.value = 300; lp.Q.value = 4; g.gain.value = 0;
  o.connect(lp); o2.connect(lp); lp.connect(g).connect(c.destination); o.start(); o2.start();
  return {
    set(speed, boost, on) {
      const t = c.currentTime;
      o.frequency.setTargetAtTime(48 + speed * 26, t, 0.08); o2.frequency.setTargetAtTime(24 + speed * 13, t, 0.08);
      lp.frequency.setTargetAtTime(boost ? 1500 : 320 + speed * 160, t, 0.1);
      g.gain.setTargetAtTime(on ? (boost ? 0.05 : 0.028) : 0, t, 0.15);
    },
    stop() { g.gain.setTargetAtTime(0, c.currentTime, 0.2); setTimeout(() => { try { o.stop(); o2.stop(); } catch {} }, 900); },
  };
}

const TEX = "assets/space/";
const GAME = "assets/game/";
const PCOL = { earth: 0x5fb2ff, mars: 0xff7a45, jupiter: 0xffc27a, saturn: 0xf3dfa0, moon: 0xd8e2f0 };
const RIVALS = [
  { name: "Vega", speed: 24.2, hull: 0xffb8c8, accent: 0xff4f7a },
  { name: "Orion", speed: 25.0, hull: 0xd6c8ff, accent: 0x9b6bff },
  { name: "Lyra", speed: 25.7, hull: 0xbff5d4, accent: 0x3fd68c },
];
const LAPS = 3, GATES = 8, TUBE = 5.0;
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let assets = null;
const RACE_TEX = ["earth_day.jpg", "earth_clouds.jpg", "mars.jpg", "jupiter.jpg", "saturn.jpg", "saturn_ring.png", "moon.jpg"];
const texCache = new Map();
function raceTex(world, n) {
  if (!texCache.has(n)) { const t = world.loader.load(TEX + n); t.colorSpace = THREE.SRGBColorSpace; texCache.set(n, t); }
  return texCache.get(n);
}
/** Start downloading everything the course needs (models + planet textures). Safe to call often. */
export function prefetchRace(world) {
  if (world) RACE_TEX.forEach((n) => raceTex(world, n));
  return loadAssets().catch(() => null);
}

function loadAssets() {
  if (assets) return assets;
  const gl = new GLTFLoader();
  assets = Promise.all(["racer", "gate", "pickup", "asteroid"].map((n) => gl.loadAsync(`${GAME}${n}.glb`)))
    .then(([racer, gate, pickup, asteroid]) => ({ racer: racer.scene, gate: gate.scene, pickup: pickup.scene, asteroid: asteroid.scene }))
    .catch((e) => { assets = null; throw e; });
  return assets;
}

function recolor(obj, map, { ghost = false } = {}) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => {
      const c = m.clone();
      const name = (m.name || "").replace(/\.\d+$/, "");
      if (map[name] != null) { c.color?.set(map[name]); if (c.emissive && /glow|light|core/.test(name)) c.emissive.set(map[name]); }
      if (ghost) { c.transparent = true; c.opacity = 0.62; c.depthWrite = false; }
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
  return obj;
}

/** The race scene for the world. */
function createRaceScene(world, tex) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
  scene.add(new THREE.AmbientLight(0x6d7a99, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-400, 260, 300);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x0b1020, 0.35));
  { // reflections on the ships and beacons, and the sun with a lens flare
    const pm = new THREE.PMREMGenerator(world.renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;
    pm.dispose();
    const ft = flareTextures(), lf = new Lensflare();
    lf.addElement(new LensflareElement(ft.main, 420, 0, new THREE.Color(0xfff1dc)));
    for (const [size, dist] of [[60, 0.3], [90, 0.55], [140, 0.8], [70, 1.0]]) lf.addElement(new LensflareElement(ft.ghost, size, dist));
    const sunLight = new THREE.PointLight(0xffffff, 0, 1); sunLight.position.copy(sun.position).multiplyScalar(2.2); sunLight.add(lf); scene.add(sunLight);
  }

  // the course: a closed loop weaving between the planets
  const ctrl = [[0, 0, 0], [140, 18, -90], [300, -10, -60], [380, 30, 90], [300, 50, 260], [120, 10, 320], [-60, -30, 300], [-220, 0, 180], [-260, 35, 0], [-150, 10, -110]];
  const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(...p)), true, "centripetal");
  const length = curve.getLength();
  const SEG = 1200;
  const frames = curve.computeFrenetFrames(SEG, true);
  const pts = curve.getSpacedPoints(SEG);
  function frameAt(u) {
    const f = ((u % 1) + 1) % 1 * SEG, i = Math.floor(f), k = f - i, j = (i + 1) % SEG;
    const p = pts[i].clone().lerp(pts[j], k);
    const t = frames.tangents[i].clone().lerp(frames.tangents[j], k).normalize();
    // a stable "up": world up made perpendicular to the tangent (no Frenet twist)
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(t, -t.y).normalize();
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    return { p, t, up, side };
  }
  const at = (dist, x = 0, y = 0) => { const f = frameAt(dist / length); return { ...f, pos: f.p.clone().addScaledVector(f.side, x).addScaledVector(f.up, y) }; };

  // faint guide lights along the course
  const guideGeo = new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(1200));
  const guide = new THREE.LineLoop(guideGeo, new THREE.LineBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(guide);

  // planets beside the course (real textures); each has a beacon on the course for its power-up
  const planets = [];
  const pdefs = [
    { id: "earth", u: 0.1, r: 34, off: [-70, -20], file: "earth_day.jpg" },
    { id: "mars", u: 0.27, r: 18, off: [55, 10], file: "mars.jpg" },
    { id: "jupiter", u: 0.47, r: 70, off: [-130, 10], file: "jupiter.jpg" },
    { id: "saturn", u: 0.67, r: 48, off: [110, -15], file: "saturn.jpg", ring: true },
    { id: "moon", u: 0.86, r: 12, off: [-38, 14], file: "moon.jpg" },
  ];
  for (const d of pdefs) {
    const f = frameAt(d.u);
    const pos = f.p.clone().addScaledVector(f.side, d.off[0]).addScaledVector(f.up, d.off[1]);
    const m = new THREE.Mesh(new THREE.SphereGeometry(d.r, world.isTablet ? 40 : 64, world.isTablet ? 20 : 32), new THREE.MeshStandardMaterial({ map: tex(d.file), roughness: 1, metalness: 0 }));
    m.position.copy(pos);
    m.rotation.z = 0.3;
    scene.add(m);
    if (d.ring) {
      const inner = d.r * 1.25, outer = d.r * 2.25;
      const g = new THREE.RingGeometry(inner, outer, 128, 1);
      const P = g.attributes.position, UV = g.attributes.uv;
      for (let i = 0; i < P.count; i++) UV.setXY(i, (Math.hypot(P.getX(i), P.getY(i)) - inner) / (outer - inner), 0.5);
      const ring = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex("saturn_ring.png"), side: THREE.DoubleSide, transparent: true, depthWrite: false, roughness: 1 }));
      ring.rotation.x = -Math.PI / 2 + 0.35;
      m.add(ring);
    }
    if (d.id === "earth") {
      const cl = new THREE.Mesh(new THREE.SphereGeometry(d.r * 1.012, 48, 24), new THREE.MeshStandardMaterial({ map: tex("earth_clouds.jpg"), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.add(cl);
    }
    planets.push({ ...d, mesh: m, dist: d.u * length });
  }

  return { scene, camera, length, at, frameAt, planets, guide, sun, update: null, resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); } };
}

export function renderRace(el, ctx) {
  const world = ctx.world;
  const v = ctx.view;
  const hr0 = v.state?.vitals?.heart_rate ?? null, base = v.state?.baseline?.heart_rate ?? null;
  const hrBadge = v.state?.vitals?.sources?.heart_rate === "camera" ? "LIVE" : "SIM";
  const focus = L.focusBonus(hr0, base);
  prefetchRace(world);
  const pb = loadPB(v.crewId);
  let diffKey = (() => { try { return localStorage.getItem("sentinel.race.diff") || "pilot"; } catch { return "pilot"; } })();
  if (!DIFF[diffKey]) diffKey = "pilot";
  let engine = null;
  let moodBefore = null, alive = true, prevScene = world.active, raceDef = null, loopOff = null, keysOff = null;

  el.innerHTML = `<div class="race-ui">
    <section class="race-menu" data-menu>
      <p class="label">Sentinel break</p>
      <h1 class="race-title">SLIPSTREAM</h1>
      <p class="race-lede">Three laps past five worlds against three ghost racers. Fly through a planet's beacon for its power-up. Nothing can go wrong out here: an asteroid only slows you for a moment.</p>
      <ul class="race-powers">${L.PLANETS.map((p) => `<li><span class="pdot" style="--c:#${PCOL[p].toString(16).padStart(6, "0")}"></span><strong>${esc(p[0].toUpperCase() + p.slice(1))}</strong><span>${esc(L.POWERUPS[p].name)}: ${esc(L.POWERUPS[p].blurb.toLowerCase())}</span></li>`).join("")}</ul>
      <p class="race-pb">${pb ? `Personal best <strong class="num">${esc(L.fmtTime(pb.time))}</strong>` : "No personal best yet: set one"} · Hold <kbd>Space</kbd> or BOOST to burn boost. Fly through the orange portal to race the surface of Mars for coins. Charge boost through gates and cyan boost rings (chain them for a combo), in a rival's slipstream and with near misses.</p>
      <p class="race-focus">${focus > 1 ? "Your heart rate is calm: steadier handling" : "A calm heart rate steadies the handling"} <span class="badge badge-${hrBadge === "LIVE" ? "live" : "sim"}">HR ${hrBadge}</span></p>
      <div class="race-diff"><span class="label">Difficulty</span><div class="seg">${Object.entries(DIFF).map(([k, d]) => `<button type="button" data-diff="${k}" aria-pressed="${k === diffKey}">${esc(d.name)}</button>`).join("")}</div></div>
      <div class="race-mp" data-mp>
        <p class="label">Race your crew</p>
        <div class="race-mp-row"><button type="button" class="pill pill-ghost" data-mp-create>Create a room</button><span class="race-mp-or">or</span><input data-mp-code maxlength="4" placeholder="CODE" aria-label="Room code" autocomplete="off"><button type="button" class="pill pill-ghost" data-mp-join>Join</button></div>
        <p class="fine">Everyone on the same Wi-Fi as this laptop can join from their tablet or phone.</p>
      </div>
      <div class="race-lobby" data-lobby hidden></div>
      <h3 class="race-q" data-solo-q>How is your mood before you start?</h3>
      <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-mb="${n}">${n}</button>`).join("")}</div>
      <p class="fine">Mood is logged (LIVE) so you can see whether the break helped. Controls: arrow keys or WASD, Space or Shift to boost; on a tablet, drag or use tilt, and hold BOOST.</p>
      <button type="button" class="link-btn" data-why>Why a game break works</button>
    </section>
    <div class="race-hud" data-hud hidden>
      <div class="hud-left"><span class="hud-big" data-pos>1st</span><span class="hud-small" data-of>of 4</span></div>
      <div class="hud-mid"><span class="label">Lap</span><span class="hud-lap" data-lap>1 / ${LAPS}</span><span class="hud-time num" data-time>0:00.0</span></div>
      <div class="hud-right" data-power></div>
      <div class="hud-count" data-count></div>
      <div class="hud-toast" data-toast></div>
      <div class="hud-boost"><span class="label">Boost</span><span class="boost-bar"><i data-boost></i></span><span class="hud-chip" data-draft>Slipstream</span></div>
      <div class="hud-touch" data-touch><button type="button" data-tilt class="pill pill-ghost">Use tilt</button><button type="button" class="boost-btn" data-boostbtn>BOOST</button></div>
    </div>
    <section class="race-menu race-end" data-end hidden></section>
  </div>`;
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", () => {
    diffKey = b.dataset.diff; try { localStorage.setItem("sentinel.race.diff", diffKey); } catch { /* private mode */ }
    el.querySelectorAll("[data-diff]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  const drawer = scienceDrawer(el.querySelector(".race-ui"), "race", "Why Slipstream works");
  $("[data-why]").addEventListener("click", () => drawer.open());

  el.querySelectorAll("[data-mb]").forEach((b) => b.addEventListener("click", () => { moodBefore = Number(b.dataset.mb); if (lobby) return; start(); }));

  // ---- multiplayer lobby ----
  const myId = deviceId();
  const myName = (v.crew?.find((c) => c.crew_id === v.crewId)?.display_name || "Crew").split(" ")[0];
  let lobby = null, lobbyIv = 0;
  function drawLobby(room) {
    const isHost = room.host === myId;
    const lb = $("[data-lobby]");
    lb.hidden = false;
    lb.innerHTML = `<p class="label">Room</p><p class="race-code">${esc(room.code)}</p>
      <p class="fine">Others join with this code from the Slipstream menu.</p>
      <ul class="race-players">${room.players.map((p) => `<li><i style="background:${esc(p.color)}"></i>${esc(p.name)}${p.id === room.host ? " <small>host</small>" : ""}${p.id === myId ? " <small>you</small>" : ""}</li>`).join("")}</ul>
      <p class="fine">${moodBefore == null ? "Pick your mood below first." : `Mood ${moodBefore} logged.`}</p>
      ${isHost ? `<button type="button" class="pill pill-light" data-mp-start ${room.players.length < 2 || moodBefore == null ? "disabled" : ""}>Start the race</button>` : `<p class="note">Waiting for ${esc(room.players.find((p) => p.id === room.host)?.name || "the host")} to start…</p>`}
      <button type="button" class="link-btn" data-mp-leave>Leave room</button>`;
    lb.querySelector("[data-mp-start]")?.addEventListener("click", async () => { try { goRace(await roomCall(`/${room.code}/start`, { id: myId })); } catch (e) { toastMenu(e.message); } });
    lb.querySelector("[data-mp-leave]").addEventListener("click", () => leaveLobby());
  }
  const toastMenu = (m) => { const f = $("[data-mp] .fine"); if (f) f.textContent = m; };
  function enterLobby(room) {
    lobby = room;
    $("[data-mp]").hidden = true;
    drawLobby(room);
    clearInterval(lobbyIv);
    lobbyIv = setInterval(async () => {
      if (!lobby) return;
      try { const r = await roomCall(`/${lobby.code}/state`, { id: myId }); lobby = r; if (r.status === "racing" && r.start_at) goRace(r); else drawLobby(r); } catch (e) { toastMenu(e.message); leaveLobby(); }
    }, 800);
  }
  function leaveLobby() {
    if (lobby) roomCall(`/${lobby.code}/leave`, { id: myId }).catch(() => {});
    lobby = null; clearInterval(lobbyIv);
    $("[data-lobby]").hidden = true; $("[data-mp]").hidden = false;
  }
  function goRace(room) {
    clearInterval(lobbyIv);
    if (moodBefore == null) moodBefore = 3;
    const offset = room.server_time - Date.now() / 1000;
    start({ code: room.code, id: myId, startAt: room.start_at, offset, players: room.players });
  }
  $("[data-mp-create]").addEventListener("click", async () => { try { enterLobby(await roomCall("", { id: myId, name: myName })); } catch (e) { toastMenu(`Could not create a room: ${e.message}`); } });
  $("[data-mp-join]").addEventListener("click", async () => {
    const code = $("[data-mp-code]").value.trim().toUpperCase();
    if (code.length !== 4) return toastMenu("Room codes have four letters.");
    try { enterLobby(await roomCall(`/${code}/join`, { id: myId, name: myName })); } catch (e) { toastMenu(e.message === "no such room" ? `No room ${code}. Check the code.` : e.message); }
  });

  function start(mp = null) {
    return startRace(mp).catch((e) => {
      console.error("Slipstream failed to start", e);
      $("[data-menu]").innerHTML = `<p class="note">The race could not start: ${esc(e.message)}</p>`;
    });
  }
  async function startRace(mp = null) {
    clearInterval(lobbyIv);
    $("[data-menu]").innerHTML = `<p class="label">Loading the course…</p>`;
    let a;
    try { a = await loadAssets(); } catch (e) {
      $("[data-menu]").innerHTML = `<p class="note">The race could not load on this device.</p>`;
      console.warn("race assets", e);
      return;
    }
    if (!alive) return;
    const tex = (n) => raceTex(world, n);
    const R = createRaceScene(world, tex);
    // ---- ships ----
    const player = recolor(a.racer.clone(true), {});
    R.scene.add(player);
    const trail = new THREE.PointLight(0x7fd8ff, 1.5, 4, 2);   // engine glow, behind the hull so it lights the exhaust, not the ship
    player.add(trail); trail.position.set(0, 0, -2.4);
    const rivals = (mp ? [] : RIVALS).map((d, i) => {
      const m = recolor(a.racer.clone(true), { hull: d.hull, accent: d.accent, engine_glow: d.accent }, { ghost: true });
      R.scene.add(m);
      return { ...d, speed: d.speed * DIFF[diffKey].rival, mesh: m, state: L.createRacer({ name: d.name, baseSpeed: d.speed * DIFF[diffKey].rival, trackLength: R.length, laps: LAPS, gates: GATES }), phase: i * 2.1, x: 0, y: 0 };
    });
    const me = L.createRacer({ name: "you", baseSpeed: 25, trackLength: R.length, laps: LAPS, gates: GATES });
    // start grid: rivals just ahead and to the sides
    rivals.forEach((r, i) => { r.state.dist = -2 - i * 2.5; r.x = (i - 1) * 2.4; });
    // ---- gates ----
    const gates = [];
    for (let g = 0; g < GATES; g++) {
      const f = R.at((g / GATES) * R.length);
      const m = recolor(a.gate.clone(true), g === 0 ? { gate_light: 0xb8f5c8 } : {});
      m.position.copy(f.pos);
      m.lookAt(f.pos.clone().add(f.t));
      m.rotateX(Math.PI / 2);
      m.scale.setScalar(TUBE / 2.8);
      R.scene.add(m);
      gates.push(m);
    }
    // ---- power-up beacons near each planet ----
    const pickups = R.planets.map((p, i) => {
      const dist = p.dist + 12;
      const x = Math.max(-2.6, Math.min(2.6, Math.sign(p.off[0]) * 2.2)), y = (i % 2 ? 1 : -1) * 1.0;
      const core = recolor(a.pickup.clone(true), { pickup_core: PCOL[p.id], pickup_shell: PCOL[p.id] });
      core.traverse((o) => { if (o.isMesh && /shell/.test(o.material.name)) { o.material.transparent = true; o.material.opacity = 0.45; } });
      const m = makeBeacon(PCOL[p.id], core);
      const fr = R.at(dist, x, y);
      m.position.copy(fr.pos); m.up.copy(fr.up); m.lookAt(fr.pos.clone().add(fr.t));
      R.scene.add(m);
      return { planet: p.id, dist, x, y, mesh: m, back: 0 };
    });
    // ---- asteroids on the course ----
    // realistic rock: displaced geometry with a real-photo normal map (Poly Haven, CC0), some drifting across the course
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a524b, roughness: 0.92, metalness: 0.04 });
    world.loader.load("assets/mars/ground_nor_gl.jpg", (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); rockMat.normalMap = t; rockMat.normalScale.set(1.6, 1.6); rockMat.needsUpdate = true; });
    const rocks = [];
    const NR = 22;
    for (let i = 0; i < NR; i++) {
      const dist = ((i + 0.5) / NR) * R.length + 9;
      const x = ((i * 37) % 7 - 3) * 1.1, y = ((i * 53) % 5 - 2) * 0.8;
      const m = makeAsteroid(i + 1, rockMat);
      const size = 0.85 + ((i * 13) % 5) * 0.14;
      m.scale.setScalar(size);
      m.rotation.set(i, i * 2, i * 3);
      R.scene.add(m);
      const drift = i % DIFF[diffKey].driftEvery === 0 ? { ax: 2.6, ay: 1.2, f: 0.5 + (i % 4) * 0.15, ph: i } : null;   // every third asteroid drifts
      rocks.push({ dist, x0: x, y0: y, x, y, mesh: m, hit: -10, spin: new THREE.Vector3(0.2 + (i % 3) * 0.15, 0.3, 0.1), drift, r: size });
    }
    // a distant asteroid belt for depth (instanced, no collisions)
    { const N = world.isTablet ? 160 : 360, belt = new THREE.InstancedMesh(makeAsteroid(99, rockMat).geometry, rockMat, N), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let i = 0; i < N; i++) { const f = R.at(Math.random() * R.length, (Math.random() < 0.5 ? -1 : 1) * (26 + Math.random() * 50), (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 22)); const sc = 0.4 + Math.random() * 2.6; e.set(Math.random() * 6, Math.random() * 6, 0); q.setFromEuler(e); M.compose(f.pos, q, new THREE.Vector3(sc, sc * 0.8, sc)); belt.setMatrixAt(i, M); }
      R.scene.add(belt); }
    // boost rings: fly through for boost; chain them for a combo
    const rings = [];
    for (let i = 0; i < 14; i++) {
      const dist = ((i + 0.25) / 14) * R.length;
      if (R.planets.some((p) => Math.abs(p.dist + 12 - dist) < 14) || rocks.some((k) => Math.abs(k.dist - dist) < 6)) continue;
      const x = Math.sin(i * 1.9) * 2.0, y = Math.cos(i * 1.3) * 1.2;
      const m = makeBoostRing(); const fr = R.at(dist, x, y);
      m.position.copy(fr.pos); m.up.copy(fr.up); m.lookAt(fr.pos.clone().add(fr.t));
      R.scene.add(m);
      rings.push({ dist, x, y, mesh: m, lapTaken: 0 });
    }
    // ---- the portal: fly through it to warp down to the surface of Mars for a canyon run ----
    const PORTAL_D = R.length * 0.56;
    const portalU = { time: { value: 0 }, uOpen: { value: 1 } };
    const portal = new THREE.Group();
    { const fr = R.at(PORTAL_D, 0, 0); portal.position.copy(fr.pos); portal.up.copy(fr.up); portal.lookAt(fr.pos.clone().add(fr.t)); }
    portal.add(new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.16, 16, 96), new THREE.MeshStandardMaterial({ color: 0x1a0d08, emissive: 0xff7a45, emissiveIntensity: 2.4, roughness: 0.3, metalness: 0.6 })));
    portal.add(new THREE.Mesh(new THREE.CircleGeometry(3.0, 96), new THREE.ShaderMaterial({ uniforms: portalU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform float time, uOpen; varying vec2 vUv;
        void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p), a = atan(p.y, p.x);
          float sw = 0.5 + 0.5 * sin(a * 5.0 + r * 14.0 - time * 5.0);
          vec3 c = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.85, 0.6), sw) * smoothstep(1.0, 0.2, r) * (0.35 + 0.65 * sw);
          c += vec3(1.0, 0.95, 0.85) * exp(-r * r * 9.0) * 0.8;
          gl_FragColor = vec4(c * uOpen, 1.0); }` })));
    R.scene.add(portal);
    // the surface: a canyon on Mars far below the course (same scene, its own sky and haze). Real ground
    // texture (Poly Haven, CC0, recoloured), rugged rock walls, rust-red pillars rooted in the floor to weave
    // between, and a line of glowing coins that shows the racing line.
    const SO = new THREE.Vector3(0, -2600, 0);
    const surf = new THREE.Group(); surf.position.copy(SO); R.scene.add(surf);
    R.scene.fog = new THREE.FogExp2(0xc99a74, 0);          // density is raised only while on the surface
    const marsTex = { d: null, n: null };
    const texLoad = (n, srgb, rx, ry) => new Promise((res) => world.loader.load(`assets/mars/${n}`, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8; res(t); }, undefined, () => res(null)));
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xb4774f, roughness: 1 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x9c5a3a, roughness: 0.95, side: THREE.DoubleSide });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xa8603c, roughness: 0.92 });
    Promise.all([texLoad("ground_diff.jpg", true, 5, 30), texLoad("ground_nor_gl.jpg", false, 5, 30), texLoad("ground_diff.jpg", true, 3, 18), texLoad("ground_nor_gl.jpg", false, 3, 18), texLoad("ground_diff.jpg", true, 1, 3), texLoad("ground_nor_gl.jpg", false, 1, 3)]).then(([fd, fn, wd, wn, pd, pn]) => {
      if (fd) Object.assign(floorMat, { map: fd, normalMap: fn, color: new THREE.Color(0xffffff) });
      if (wd) Object.assign(wallMat, { map: wd, normalMap: wn, color: new THREE.Color(0xc8a08a) });
      if (pd) Object.assign(pillarMat, { map: pd, normalMap: pn, color: new THREE.Color(0xd6a68a) });
      for (const m of [floorMat, wallMat, pillarMat]) { if (m.normalMap) m.normalScale.set(1.5, 1.5); m.needsUpdate = true; }
      marsTex.d = fd; marsTex.n = fn;
    });
    {
      const L_ = SURF_LEN + 160;
      // sky: butterscotch haze with a small sun and its blue-white glow (Mars forward scattering)
      const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `varying vec3 vD; void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(vec3(0.84,0.64,0.47), vec3(0.50,0.33,0.22), pow(h, 0.45));
          vec3 sd = normalize(vec3(-0.35, 0.42, -1.0)); float s = max(dot(vD, sd), 0.0);
          c += vec3(1.0,0.97,0.9) * pow(s, 700.0) * 3.0 + vec3(0.6,0.7,0.85) * pow(s, 10.0) * 0.18; gl_FragColor = vec4(c, 1.0); }` }));
      sky.position.z = -SURF_LEN / 2; surf.add(sky);
      // floor: a gently uneven valley bottom
      const fg = new THREE.PlaneGeometry(26, L_, 52, 260); fg.rotateX(-Math.PI / 2);
      { const P = fg.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i); P.setY(i, -2.4 + Math.sin(z * 0.11) * 0.25 + Math.sin(x * 0.7 + z * 0.05) * 0.12 + Math.pow(Math.abs(x) / 13, 3) * 3); } fg.computeVertexNormals(); }
      const floor = new THREE.Mesh(fg, floorMat); floor.position.z = -SURF_LEN / 2; floor.receiveShadow = true; surf.add(floor);
      // walls: rugged, layered rock faces rising on both sides
      for (const side of [-1, 1]) {
        const wg = new THREE.PlaneGeometry(L_, 40, 220, 60), P = wg.attributes.position;
        for (let i = 0; i < P.count; i++) {
          const u = P.getX(i), v = P.getY(i) + 20;             // u along the canyon, v height 0..40
          const strata = Math.floor(v / 3.2) * 0.9 + Math.sin(v * 2.1 + u * 0.03) * 0.25;   // layered sediment ledges
          const rough = Math.sin(u * 0.21 + v * 0.13) * 1.6 + Math.sin(u * 0.73 - v * 0.41) * 0.7 + Math.sin(u * 2.3 + v * 1.9) * 0.25;
          P.setXYZ(i, side * (9 + v * 0.42 + strata * 0.5 + rough), v - 2.6, -u);
        }
        wg.computeVertexNormals();
        const wall = new THREE.Mesh(wg, wallMat); wall.position.z = -SURF_LEN / 2; surf.add(wall);
      }
      const sl = new THREE.DirectionalLight(0xfff0dc, 2.6); sl.position.set(-40, 50, -80); surf.add(sl); surf.add(sl.target); sl.target.position.set(0, 0, -SURF_LEN / 2);
      surf.add(new THREE.HemisphereLight(0xffd8b8, 0x6b3a26, 0.75));
      const exitP = portal.children[0].clone(); exitP.position.set(0, 0, -SURF_LEN); surf.add(exitP);
      const exitDisc = portal.children[1].clone(); exitDisc.position.set(0, 0, -SURF_LEN); surf.add(exitDisc);
    }
    // coins: small, bright, in arcs that show a line between the pillars
    const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.07, 32);
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xffd34a, emissive: 0xffa61a, emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.22 });
    const glowMap = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,220,120,.9)"); g.addColorStop(1, "rgba(255,180,60,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    const coins = [], spires = [];
    const lineX = (sd) => Math.sin(sd * 0.045) * 2.6 + Math.sin(sd * 0.11) * 0.8;     // the racing line through the canyon
    for (let sd = 16; sd < SURF_LEN - 12; sd += 3.2) {
      if (Math.floor(sd / 26) % 2 === 1 && (sd % 26) > 14) continue;                 // gaps between coin runs
      const x = lineX(sd), y = 0.2 + Math.sin(sd * 0.3) * 0.5;
      const m = new THREE.Mesh(coinGeo, coinMat); m.rotation.x = Math.PI / 2; m.position.set(x, y, -sd);
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); g.scale.setScalar(1.3); m.add(g);
      surf.add(m);
      coins.push({ s: sd, x, y, mesh: m, taken: -1 });
    }
    // pillars: hoodoos rooted in the floor, placed off the racing line so the line is the safe way through
    for (let k = 0; k < 11; k++) {
      const sd = 26 + k * 12.5, side = k % 2 ? 1 : -1, x = lineX(sd) + side * (2.1 + (k % 3) * 0.5);
      const g = new THREE.CylinderGeometry(0.55, 0.95, 7, 20, 14, false), P = g.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); const a = Math.atan2(v.z, v.x), h = v.y; const r = Math.hypot(v.x, v.z) * (1 + 0.18 * Math.sin(a * 3 + k) + 0.12 * Math.sin(h * 2.2 + k) + (Math.abs(Math.sin(h * 1.4)) > 0.92 ? 0.12 : 0)); P.setXYZ(i, Math.cos(a) * r, h, Math.sin(a) * r); }
      g.computeVertexNormals();
      const sp = new THREE.Mesh(g, pillarMat); sp.position.set(x, 1.0, -sd); sp.rotation.y = k; sp.castShadow = true; surf.add(sp);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), pillarMat); cap.scale.set(1, 0.35, 1); cap.position.set(x, 4.5, -sd); surf.add(cap);
      spires.push({ s: sd, x, y: 0, mesh: sp, hit: -10 });
    }
    // surface dust drifting across the canyon
    const sdN = 260, sdP = new Float32Array(sdN * 3);
    for (let i = 0; i < sdN; i++) sdP.set([(Math.random() - 0.5) * 22, Math.random() * 8 - 2, -Math.random() * SURF_LEN], i * 3);
    const sdG = new THREE.BufferGeometry(); sdG.setAttribute("position", new THREE.BufferAttribute(sdP, 3));
    const surfDust = new THREE.Points(sdG, new THREE.PointsMaterial({ color: 0xf0d2b0, size: 0.08, transparent: true, opacity: 0.6, depthWrite: false })); surf.add(surfDust);
    let surfFrom = null, coinCount = 0, portalLap = 0;
    function enterSurface() {
      surfFrom = me.dist; portalLap = L.lapOf(me);
      R.scene.fog.density = 0.016;
      flash("fx-warp");
      coins.forEach((c) => { c.taken = -1; c.mesh.visible = true; });
      el.querySelector(".race-ui").style.setProperty("--fx", "#ff9a5a");
      fovKick = 22; fx.addTrauma(0.3); cueTone(220, 0.5, 0, "sine"); cueTone(440, 0.4, 0.15);
      toast("Warp: the surface of Mars. Grab the coins!", "#ffb070");
    }
    function exitSurface() {
      surfFrom = null; R.scene.fog.density = 0; flash("fx-warp"); fovKick = 16; cueTone(660, 0.3); cueTone(990, 0.3, 0.1);
      toast(`Back to orbit · ${coinCount} coins`, "#ffd84a");
    }
    function placeSurf(obj, sd, x, y, bank = 0) {
      const pos = new THREE.Vector3(SO.x + x, SO.y + y, SO.z - sd);
      obj.position.copy(pos); obj.up.set(0, 1, 0); obj.lookAt(pos.x, pos.y, pos.z - 1); obj.rotateZ(bank);
      return { pos, p: pos, t: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), side: new THREE.Vector3(1, 0, 0) };
    }
    const fx = createFx(R.scene, R.camera);
    let combo = 0, fovKick = 0;
    const flash = (cls) => { const u = el.querySelector(".race-ui"); u.classList.remove("fx-hit", "fx-pick", "fx-ring", "fx-warp"); void u.offsetWidth; u.classList.add(cls); };

    // ---- input ----
    const input = { x: 0, y: 0, keys: new Set(), drag: null, tilt: null, boost: false };
    const kd = (e) => {
      const k = e.key.toLowerCase();
      if (k === " " || k === "shift") { input.keys.add(k); e.preventDefault(); e.stopPropagation(); return; }
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(k)) { input.keys.add(k); e.preventDefault(); e.stopPropagation(); }
    };
    const ku = (e) => input.keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", kd, true);
    window.addEventListener("keyup", ku, true);
    const hud = $("[data-hud]");
    const pd = (e) => { if (e.target.closest("button")) return; input.drag = { x0: e.clientX, y0: e.clientY, x: 0, y: 0 }; hud.setPointerCapture?.(e.pointerId); };
    const pm = (e) => { if (!input.drag) return; input.drag.x = Math.max(-1, Math.min(1, (e.clientX - input.drag.x0) / 90)); input.drag.y = Math.max(-1, Math.min(1, (e.clientY - input.drag.y0) / 90)); };
    const pu = () => { input.drag = null; };
    hud.addEventListener("pointerdown", pd); hud.addEventListener("pointermove", pm); hud.addEventListener("pointerup", pu); hud.addEventListener("pointercancel", pu);
    const orient = (e) => { if (e.gamma == null) return; input.tilt = { x: Math.max(-1, Math.min(1, e.gamma / 25)), y: Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 25)) }; };
    const bb = $("[data-boostbtn]");
    bb.addEventListener("pointerdown", (e) => { input.boost = true; bb.setPointerCapture?.(e.pointerId); });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((n) => bb.addEventListener(n, () => { input.boost = false; }));
    $("[data-tilt]").addEventListener("click", async () => {
      try { if (typeof DeviceOrientationEvent?.requestPermission === "function") await DeviceOrientationEvent.requestPermission(); } catch { /* denied */ }
      window.addEventListener("deviceorientation", orient);
      $("[data-tilt]").textContent = "Tilt on";
    });
    keysOff = () => {
      window.removeEventListener("keydown", kd, true); window.removeEventListener("keyup", ku, true);
      window.removeEventListener("deviceorientation", orient);
    };

    // ---- the loop (runs inside the world's frame) ----
    const boost = L.createBoost();
    let draftOn = false;
    engine = engineSound();
    let t = mp ? Date.now() / 1000 + mp.offset - mp.startAt : -3.2, px = 0, py = 0, vx = 0, vy = 0, finishedAt = null, lastCount = null;
    // crewmates' ships (multiplayer): recoloured racers with name tags, smoothed toward the last known state
    const remote = new Map();
    const tagLayer = document.createElement("div"); tagLayer.className = "race-tags"; $("[data-hud]").appendChild(tagLayer);
    function remoteFor(p) {
      if (remote.has(p.id)) return remote.get(p.id);
      const c = parseInt(p.color.slice(1), 16);
      const mesh = recolor(a.racer.clone(true), { hull: 0xe8eef8, accent: c, engine_glow: c }, { ghost: true });
      R.scene.add(mesh);
      const tag = document.createElement("span"); tag.className = "race-tag"; tag.textContent = p.name; tag.style.setProperty("--c", p.color); tagLayer.appendChild(tag);
      const o = { id: p.id, name: p.name, mesh, tag, dist: p.dist, x: p.x, y: p.y, tdist: p.dist, tx: p.x, ty: p.y, finished: p.finished, lap: p.lap };
      remote.set(p.id, o);
      return o;
    }
    let syncBusy = false, syncT = 0;
    function sync() {
      if (!mp || syncBusy) return;
      syncBusy = true;
      roomCall(`/${mp.code}/state`, { id: mp.id, dist: me.dist, x: px, y: py, lap: L.lapOf(me), finished: me.finished ?? undefined })
        .then((room) => {
          const seen = new Set();
          for (const p of room.players) {
            if (p.id === mp.id) continue;
            const o = remoteFor(p); seen.add(p.id);
            Object.assign(o, { tdist: p.dist, tx: p.x, ty: p.y, finished: p.finished, lap: p.lap });
          }
          for (const [id, o] of remote) if (!seen.has(id)) { R.scene.remove(o.mesh); o.tag.remove(); remote.delete(id); }
        })
        .catch(() => {})
        .finally(() => { syncBusy = false; });
    }
    const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let toastT = 0;
    const toast = (msg, color) => { const tt = $("[data-toast]"); tt.textContent = msg; tt.style.setProperty("--c", color || "#cfe9ff"); tt.classList.remove("is-on"); void tt.offsetWidth; tt.classList.add("is-on"); toastT = 1.6; };
    function place(obj, dist, x, y, bank = 0) {
      const f = R.at(dist, x, y);
      obj.position.copy(f.pos);
      obj.up.copy(f.up);
      obj.lookAt(tmp.copy(f.pos).add(f.t));
      obj.rotateZ(bank);
      return f;
    }
    raceDef = {
      scene: R.scene, camera: R.camera, resize: R.resize,
      dispose() { fx.dispose(); },
      // the race is always in deep space with gentle bloom, whatever the app theme (a pale sky washed it out)
      onShow() { this._theme = world.theme; world.setTheme("dark", 0); world.setBloom(0.42); },
      onHide() { world.setTheme(this._theme || "dark", 0); },
      update(dt) {
        dt = Math.min(dt, 0.05);
        t += dt;
        // countdown
        if (t < 0) {
          const n = Math.ceil(-t);
          if (n !== lastCount) { lastCount = n; $("[data-count]").textContent = n; $("[data-count]").classList.remove("is-on"); void $("[data-count]").offsetWidth; $("[data-count]").classList.add("is-on"); }
        } else if (lastCount !== 0) { lastCount = 0; $("[data-count]").textContent = "GO"; setTimeout(() => { if ($("[data-count]")) $("[data-count]").textContent = ""; }, 700); }
        const racing = t >= 0 && me.finished == null;
        // steering: keys, drag or tilt; a calm heart rate steadies the handling
        let ix = 0, iy = 0;
        if (input.keys.has("arrowleft") || input.keys.has("a")) ix -= 1;
        if (input.keys.has("arrowright") || input.keys.has("d")) ix += 1;
        if (input.keys.has("arrowup") || input.keys.has("w")) iy += 1;
        if (input.keys.has("arrowdown") || input.keys.has("s")) iy -= 1;
        if (input.drag) { ix += input.drag.x; iy -= input.drag.y; }
        if (input.tilt) { ix += input.tilt.x; iy -= input.tilt.y; }
        const accel = 26 * focus, damp = Math.pow(0.02 / focus, dt);
        vx = (vx + ix * accel * dt) * damp; vy = (vy + iy * accel * dt) * damp;
        px += vx * dt; py += vy * dt;
        const r = Math.hypot(px, py);
        if (r > TUBE - 0.6) { px *= (TUBE - 0.6) / r; py *= (TUBE - 0.6) / r; vx *= 0.5; vy *= 0.5; }
        // boost and slipstream
        const held = racing && (input.boost || input.keys.has(" ") || input.keys.has("shift"));
        const boostMul = racing ? L.tickBoost(boost, dt, held) : 1;
        draftOn = racing && rivals.some((rv) => L.inSlipstream({ dist: me.dist, x: px, y: py }, { dist: rv.state.dist, x: rv.x, y: rv.y }));
        if (draftOn) { L.chargeBoost(boost, L.BOOST.draftPerS * dt); boost.draftS += dt; }
        if (racing) {
          for (const ev of L.advance(me, dt, t, { throttle: boostMul * (draftOn ? L.BOOST.draftMul : 1) })) {
            if (ev.type === "lap" && ev.lap < LAPS) {
              const dl = L.pbDelta(me.lapTimes, pb?.laps);
              toast(`Lap ${ev.lap + 1} of ${LAPS}${dl != null ? ` · ${dl <= 0 ? "" : "+"}${dl.toFixed(1)} s vs PB` : ""}`, dl != null && dl > 0 ? "#ffd28a" : "#b8f5c8");
            }
            if (ev.type === "gate") L.chargeBoost(boost, L.BOOST.gate);
            if (ev.type === "gate") { const g = gates[ev.gate]; g.scale.setScalar((TUBE / 2.8) * 1.08); setTimeout(() => g.scale.setScalar(TUBE / 2.8), 180); }
            if (ev.type === "finish") finish();
          }
          const scale = L.rivalTimeScale(me, t);
          for (const rv of rivals) {
            rv.state.baseSpeed = rv.speed + Math.sin(t * 0.35 + rv.phase) * 1.2;
            L.advance(rv.state, dt, t, { scale });
          }
          // the portal and the planet run
          const d = me.dist % R.length;
          if (surfFrom == null && portalLap !== L.lapOf(me) && Math.abs(d - PORTAL_D) < 1.6 && Math.hypot(px, py) < 2.9) enterSurface();
          if (surfFrom != null) {
            const sd = me.dist - surfFrom;
            for (const c of coins) {
              if (c.taken >= 0 || Math.abs(sd - c.s) > 0.9 || Math.hypot(px - c.x, py - c.y) > 1.1) continue;
              c.taken = t; c.mesh.visible = false; coinCount++;
              L.chargeBoost(boost, 0.06);
              fx.burst(c.mesh.getWorldPosition(new THREE.Vector3()), 0xffd84a, 24, 6, 0.5);
              cueTone(1046 + (coinCount % 5) * 110, 0.09);
            }
            for (const k of spires) {
              if (t - k.hit < 1.2 || Math.abs(sd - k.s) > 1.1 || Math.abs(px - k.x) > 1.15) continue;
              k.hit = t;
              const absorbed = L.hitObstacle(me, t) === "absorbed";
              if (!absorbed) me.slowUntil += DIFF[diffKey].slow;
              fx.burst(player.position, absorbed ? 0x5fb2ff : 0xffa05a, 90, 9, 0.7); fx.addTrauma(absorbed ? 0.3 : 0.8);
              flash(absorbed ? "fx-pick" : "fx-hit"); cueTone(absorbed ? 520 : 140, 0.25, 0, absorbed ? "sine" : "sawtooth");
              toast(absorbed ? "Shield held" : "Rock! Slowed", absorbed ? "#5fb2ff" : "#ffb070");
            }
            if (sd > SURF_LEN) exitSurface();
          }
          for (const p of pickups) {
            if (t < p.back || surfFrom != null) continue;
            const dd = Math.abs(d - p.dist);
            if (dd < 2.2 && Math.hypot(px - p.x, py - p.y) < L.pickupRadius(me, t)) {
              const def = L.activate(me, p.planet, t);
              p.back = t + 8;
              toast(`${p.planet[0].toUpperCase() + p.planet.slice(1)}: ${def.name}`, `#${PCOL[p.planet].toString(16).padStart(6, "0")}`);
              fx.burst(p.mesh.position, PCOL[p.planet], 140, 12, 1.1);
              fx.shock(p.mesh.position, player.quaternion, PCOL[p.planet], 9);
              fx.addTrauma(0.25); fovKick = 12; flash("fx-pick");
              el.querySelector(".race-ui").style.setProperty("--fx", `#${PCOL[p.planet].toString(16).padStart(6, "0")}`);
              cueTone(880, 0.12); cueTone(1320, 0.18, 0.08);
            }
          }
          for (const k of rocks) {
            if (t - k.hit < 1.5 || surfFrom != null) continue;
            const lat = Math.hypot(px - k.x, py - k.y);
            if (Math.abs(d - k.dist) < 1.4 && lat < L.OBSTACLE_RADIUS) {
              k.hit = t;
              const absorbed = L.hitObstacle(me, t) === "absorbed";
              if (!absorbed) me.slowUntil += DIFF[diffKey].slow;
              toast(absorbed ? "Shield held" : "Hit! Slowed for a second", absorbed ? "#5fb2ff" : "#ffb070");
              fx.burst(player.position, absorbed ? 0x5fb2ff : 0xffa05a, absorbed ? 90 : 120, 10, 0.8);
              if (absorbed) fx.shock(player.position, player.quaternion, 0x5fb2ff, 5);
              fx.addTrauma(absorbed ? 0.35 : 0.85); flash(absorbed ? "fx-pick" : "fx-hit");
              navigator.vibrate?.(absorbed ? 20 : [40, 30, 60]);
              cueTone(absorbed ? 520 : 140, 0.25, 0, absorbed ? "sine" : "sawtooth");
              combo = 0;
            } else if (Math.abs(d - k.dist) < 0.8 && L.isNearMiss(lat) && t - (k.near ?? -10) > 3) {
              k.near = t; boost.nearMisses++;
              L.chargeBoost(boost, L.BOOST.nearMiss);
              toast("Near miss: boost charged", "#6fd0ff");
              fx.burst(k.mesh.position, 0x9fe8ff, 30, 6, 0.5);
            }
          }
          for (const r of rings) {
            const lapNow = L.lapOf(me);
            if (r.lapTaken === lapNow || surfFrom != null) continue;
            const dd = d - r.dist;
            if (Math.abs(dd) < 1.2 && Math.hypot(px - r.x, py - r.y) < 1.8) {
              r.lapTaken = lapNow; combo++;
              L.chargeBoost(boost, 0.22 + Math.min(0.2, combo * 0.04));
              fx.burst(r.mesh.position, 0x6fe7ff, 50, 8, 0.6); fx.shock(r.mesh.position, r.mesh.quaternion, 0x9ff3ff, 3.5);
              fovKick = Math.max(fovKick, 6); flash("fx-ring");
              toast(combo > 1 ? `Ring ×${combo}` : "Boost ring", "#6fe7ff");
              cueTone(660 + Math.min(8, combo) * 80, 0.1);
            } else if (dd > 2 && dd < 6 && r.lapTaken !== lapNow && r.missLap !== lapNow) { r.missLap = lapNow; if (combo > 1) toast("Combo lost", "#9aa6bf"); combo = 0; }
          }
        }
        // place everything
        const speedM = L.speedMultiplier(me, Math.max(0, t));
        const f = surfFrom != null ? placeSurf(player, me.dist - surfFrom, px, py, -vx * 0.09) : place(player, me.dist, px, py, -vx * 0.09);
        portalU.time.value = t; portal.rotation.z += dt * 0.6;
        if (surfFrom != null) {
          for (const c of coins) if (c.mesh.visible) c.mesh.rotation.z += dt * 3;
          const DP = surfDust.geometry.attributes.position; for (let i = 0; i < DP.count; i++) { let x = DP.getX(i) + dt * 2.2; if (x > 11) x -= 22; DP.setX(i, x); } DP.needsUpdate = true;
        }
        rivals.forEach((rv, i) => {
          rv.x = Math.sin(t * 0.6 + rv.phase) * 2.2 + (i - 1) * 0.8; rv.y = Math.cos(t * 0.45 + rv.phase) * 1.2;
          place(rv.mesh, rv.state.dist, rv.x, rv.y, Math.cos(t * 0.6 + rv.phase) * 0.25);
          // ghosts fade out near the camera so they never fill the screen
          const near = rv.mesh.position.distanceTo(R.camera.position);
          const op = 0.62 * Math.min(1, Math.max(0, (near - 4) / 8));
          if (Math.abs((rv.op ?? -1) - op) > 0.02) { rv.op = op; rv.mesh.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.opacity = op; }); } }); rv.mesh.visible = op > 0.03; }
        });
        for (const p of pickups) {
          p.mesh.visible = t >= p.back;
          p.mesh.userData.anim?.(t);
          const s = 1 + 0.06 * Math.sin(t * 4);
          p.mesh.scale.setScalar(s * (L.isActive(me, "jupiter", t) ? 1.25 : 1));
        }
        for (const k of rocks) {
          if (k.drift) { k.x = k.x0 + Math.sin(t * k.drift.f + k.drift.ph) * k.drift.ax; k.y = k.y0 + Math.cos(t * k.drift.f * 0.8 + k.drift.ph) * k.drift.ay; }
          k.mesh.position.copy(R.at(k.dist, k.x, k.y).pos);
          k.mesh.rotation.x += dt * k.spin.x; k.mesh.rotation.y += dt * k.spin.y; k.mesh.rotation.z += dt * k.spin.z;
        }
        const lapNow = L.lapOf(me);
        for (const r of rings) {
          const taken = r.lapTaken === lapNow;
          r.mesh.userData.mat.emissiveIntensity = taken ? 0.3 : 2.2 + Math.sin(t * 6 + r.dist) * 0.6;
          r.mesh.userData.film.material.opacity = taken ? 0 : 0.07;
          r.mesh.rotation.z += dt * (taken ? 0.2 : 0.8);
        }
        for (const pl of R.planets) pl.mesh.rotation.y += dt * 0.04;
        trail.intensity = 1 + speedM * 0.8 * boostMul;
        engine?.set(speedM * boostMul, boost.active, t > -3 && me.finished == null);
        $("[data-boost]").style.transform = `scaleX(${boost.charge.toFixed(3)})`;
        $("[data-draft]").classList.toggle("is-on", draftOn);
        el.querySelector(".race-ui").classList.toggle("is-boost", boost.active);
        // chase camera: behind and above, smoothed; FOV opens with speed
        const back = 7.5, up = 2.4;
        tmp.copy(player.position).addScaledVector(f.t, -back).addScaledVector(f.up, up);
        const k = reduced() ? 1 : 1 - Math.pow(0.0008, dt);
        if (camPos.lengthSq() === 0) camPos.copy(tmp);
        camPos.lerp(tmp, k);
        camLook.lerp(tmp.copy(player.position).addScaledVector(f.t, 6), camLook.lengthSq() === 0 ? 1 : k);
        const shakeV = fx.update(dt, { speed: speedM * boostMul, boost: boost.active, emitter: tmp.copy(player.position).addScaledVector(f.t, -1.3) });
        R.camera.position.copy(camPos).addScaledVector(f.side, shakeV.x).addScaledVector(f.up, shakeV.y);
        R.camera.up.copy(f.up);
        R.camera.lookAt(camLook);
        fovKick = Math.max(0, fovKick - dt * 22);
        const fov = 62 + (speedM * boostMul - 1) * 14 + fovKick;
        if (Math.abs(R.camera.fov - fov) > 0.05) { R.camera.fov += (fov - R.camera.fov) * Math.min(1, dt * 4); R.camera.updateProjectionMatrix(); }
        // HUD
        if (mp) {
          syncT += dt; if (syncT > 0.1) { syncT = 0; sync(); }
          const tv = new THREE.Vector3();
          for (const o of remote.values()) {
            const k = 1 - Math.pow(0.002, dt);
            o.dist += (o.tdist - o.dist) * k; o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
            place(o.mesh, o.dist, o.x, o.y, 0);
            tv.copy(o.mesh.position).addScaledVector(R.camera.up, 1.4).project(R.camera);
            const on = tv.z < 1 && Math.abs(tv.x) < 1.1 && Math.abs(tv.y) < 1.1;
            o.tag.style.visibility = on ? "visible" : "hidden";
            if (on) o.tag.style.transform = `translate(${((tv.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-tv.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
          }
        }
        const field = mp ? [me, ...[...remote.values()].map((o) => ({ name: o.id, dist: o.dist, finished: o.finished }))] : [me, ...rivals.map((r) => r.state)];
        const order = L.standings(field);
        $("[data-of]").textContent = `of ${field.length}`;
        const pos = order.indexOf("you") + 1;
        $("[data-pos]").textContent = L.ordinal(pos);
        $("[data-lap]").textContent = `${L.lapOf(me)} / ${LAPS}`;
        $("[data-time]").textContent = L.fmtTime(Math.max(0, me.finished ?? t));
        const eff = L.activeEffects(me, Math.max(0, t));
        const powerHtml = eff.map((e) => `<div class="hud-power" style="--c:#${PCOL[e.planet].toString(16).padStart(6, "0")}"><span>${esc(e.name)}</span><i style="transform:scaleX(${Math.max(0, e.fraction).toFixed(3)})"></i></div>`).join("");
        const pw = $("[data-power]");
        if (pw.dataset.h !== powerHtml.replace(/scaleX\([^)]*\)/g, "")) { pw.innerHTML = powerHtml; pw.dataset.h = powerHtml.replace(/scaleX\([^)]*\)/g, ""); }
        else pw.querySelectorAll("i").forEach((iEl, n) => { iEl.style.transform = `scaleX(${Math.max(0, eff[n]?.fraction ?? 0).toFixed(3)})`; });
        if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("[data-toast]").classList.remove("is-on"); }
        if (finishedAt != null && t - finishedAt > 1.2 && !$("[data-end]").dataset.shown) showEnd(pos);
      },
    };
    function finish() { finishedAt = t; toast("Finish", "#b8f5c8"); }

    let startedAt = performance.now();
    function showEnd(pos) {
      const end = $("[data-end]");
      end.dataset.shown = "1";
      const minutes = (performance.now() - startedAt) / 60000;
      engine?.set(0, false, false);
      const isPB = !pb || me.finished < pb.time;
      if (isPB) savePB(v.crewId, { time: me.finished, laps: me.lapTimes, at: new Date().toISOString() });
      const pbLine = isPB ? (pb ? `New personal best, ${esc((pb.time - me.finished).toFixed(1))} s faster.` : "First personal best set.") : `Personal best ${esc(L.fmtTime(pb.time))} (${esc((me.finished - pb.time).toFixed(1))} s off).`;
      end.innerHTML = `<p class="label">Race complete</p>
        <h1 class="race-title">${esc(L.ordinal(pos))} of ${mp ? remote.size + 1 : 4}</h1>
        ${mp ? `<p class="race-lede">${[...remote.values()].sort((a, b) => (a.finished ?? 1e9) - (b.finished ?? 1e9)).map((o) => `${esc(o.name)}: ${o.finished != null ? esc(L.fmtTime(o.finished)) : "still racing"}`).join(" · ")}</p>` : ""}
        <p class="race-lede">Time ${esc(L.fmtTime(me.finished))}. Laps ${me.lapTimes.map((x) => esc(L.fmtTime(x))).join(" · ")}. Coins ${coinCount}, power-ups ${me.pickups}, boosts ${boost.used}, near misses ${boost.nearMisses}, asteroids ${me.hits} (${me.absorbed} shielded).</p>
        <p class="race-pbline${isPB ? " is-pb" : ""}">${pbLine}</p>
        <h3 class="race-q">How is your mood now?</h3>
        <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-ma="${n}">${n}</button>`).join("")}</div>
        <p class="note" data-res></p>
        <div class="race-actions"><button class="pill pill-light" type="button" data-again>Race again</button></div>`;
      end.hidden = false;
      $("[data-hud]").hidden = true;
      window.gsap?.fromTo(end, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" });
      end.querySelectorAll("[data-ma]").forEach((b) => b.addEventListener("click", async () => {
        const after = Number(b.dataset.ma);
        const s = L.raceSession({ moodBefore, moodAfter: after, time: me.finished, position: pos, minutes });
        end.querySelector("[data-res]").textContent = `Mood ${moodBefore} before, ${after} after (${s.mood_change >= 0 ? "+" : ""}${s.mood_change}). Saved to the wellbeing log.`;
        end.querySelectorAll("[data-ma]").forEach((x) => { x.disabled = true; x.setAttribute("aria-pressed", String(x === b)); });
        const id = v.crewId;
        try {
          await ctx.patch({ wellbeing: { mood_before: moodBefore, mood_after: after, last_game: "space_race", updated: new Date().toISOString() } });
          await api.log(id, "session.race_mood_before", moodBefore, "user");
          await api.log(id, "session.race_mood_after", after, "user");
          await api.log(id, "session.race_mood_change", s.mood_change, "user");
          await api.log(id, "session.race_time_s", s.time_s, "user");
          await api.log(id, "session.race_position", pos, "user");
          await api.log(id, "session.race_minutes", s.minutes, "user");
          await api.log(id, "session.race_boosts", boost.used, "user");
          if (isPB) await api.log(id, "session.race_pb_s", s.time_s, "user");
        } catch { end.querySelector("[data-res]").textContent += " (could not reach the brain; not saved)"; }
      }));
      end.querySelector("[data-again]").addEventListener("click", () => ctx.screens?.open("race"));
    }

    world.add("race", raceDef);
    // pre-compile shaders, but never wait more than 1.5 s for it (a slow or failing compile must not block the start)
    try { if (world.renderer.compileAsync) await Promise.race([world.renderer.compileAsync(R.scene, R.camera), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { console.warn("race precompile", e); }
    if (!alive) return;
    // no cross-fade: a fade waits on frames, and frames are slow while the GPU uploads the course (it took ~11 s)
    await world.show("race", { fade: false });
    if (!alive) return;
    startedAt = performance.now();
    $("[data-menu]").hidden = true;
    hud.hidden = false;
    ctx.raceDebug = { me, rivals, pickups, remote, mp, get t() { return t; }, place(x, y) { px = x; py = y; vx = vy = 0; } };
  }

  return () => {
    alive = false;
    clearInterval(lobbyIv);
    if (lobby) roomCall(`/${lobby.code}/leave`, { id: myId }).catch(() => {});
    engine?.stop();
    keysOff?.();
    loopOff?.();
    ctx.raceDebug = null;
    if (world.active === "race") {
      const back = prevScene && prevScene !== "race" ? prevScene : "space";
      world.show(back, { fade: false }).then(() => world.remove("race"));
    } else world.remove("race");
  };
}
