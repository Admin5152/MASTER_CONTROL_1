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
  const guideGeo = new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(600));
  const guide = new THREE.Points(guideGeo, new THREE.PointsMaterial({ color: 0x7fd8ff, size: 0.35, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
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
  let moodBefore = null, alive = true, prevScene = world.active, raceDef = null, loopOff = null, keysOff = null;

  el.innerHTML = `<div class="race-ui">
    <section class="race-menu" data-menu>
      <p class="label">Sentinel break</p>
      <h1 class="race-title">SPACE RACE</h1>
      <p class="race-lede">Three laps past five worlds against three ghost racers. Fly through a planet's beacon for its power-up. Nothing can go wrong out here: an asteroid only slows you for a moment.</p>
      <ul class="race-powers">${L.PLANETS.map((p) => `<li><span class="pdot" style="--c:#${PCOL[p].toString(16).padStart(6, "0")}"></span><strong>${esc(p[0].toUpperCase() + p.slice(1))}</strong><span>${esc(L.POWERUPS[p].name)}: ${esc(L.POWERUPS[p].blurb.toLowerCase())}</span></li>`).join("")}</ul>
      <p class="race-focus">${focus > 1 ? "Your heart rate is calm: steadier handling" : "A calm heart rate steadies the handling"} <span class="badge badge-${hrBadge === "LIVE" ? "live" : "sim"}">HR ${hrBadge}</span></p>
      <h3 class="race-q">How is your mood before you start?</h3>
      <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-mb="${n}">${n}</button>`).join("")}</div>
      <p class="fine">Mood is logged (LIVE) so you can see whether the break helped. Controls: arrow keys or WASD; on a tablet, drag or use tilt.</p>
    </section>
    <div class="race-hud" data-hud hidden>
      <div class="hud-left"><span class="hud-big" data-pos>1st</span><span class="hud-small" data-of>of 4</span></div>
      <div class="hud-mid"><span class="label">Lap</span><span class="hud-lap" data-lap>1 / ${LAPS}</span><span class="hud-time num" data-time>0:00.0</span></div>
      <div class="hud-right" data-power></div>
      <div class="hud-count" data-count></div>
      <div class="hud-toast" data-toast></div>
      <div class="hud-touch" data-touch><button type="button" data-tilt class="pill pill-ghost">Use tilt</button></div>
    </div>
    <section class="race-menu race-end" data-end hidden></section>
  </div>`;
  const $ = (s) => el.querySelector(s);

  el.querySelectorAll("[data-mb]").forEach((b) => b.addEventListener("click", () => { moodBefore = Number(b.dataset.mb); start(); }));

  async function start() {
    $("[data-menu]").innerHTML = `<p class="label">Loading the course…</p>`;
    let a;
    try { a = await loadAssets(); } catch (e) {
      $("[data-menu]").innerHTML = `<p class="note">The race could not load on this device.</p>`;
      console.warn("race assets", e);
      return;
    }
    if (!alive) return;
    const tex = (n) => { const t = world.loader.load(TEX + n); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const R = createRaceScene(world, tex);
    // ---- ships ----
    const player = recolor(a.racer.clone(true), {});
    R.scene.add(player);
    const trail = new THREE.PointLight(0x7fd8ff, 6, 6, 2);
    player.add(trail); trail.position.set(0, 0, -0.9);
    const rivals = RIVALS.map((d, i) => {
      const m = recolor(a.racer.clone(true), { hull: d.hull, accent: d.accent, engine_glow: d.accent }, { ghost: true });
      R.scene.add(m);
      return { ...d, mesh: m, state: L.createRacer({ name: d.name, baseSpeed: d.speed, trackLength: R.length, laps: LAPS, gates: GATES }), phase: i * 2.1, x: 0, y: 0 };
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
      const m = recolor(a.pickup.clone(true), { pickup_core: PCOL[p.id], pickup_shell: PCOL[p.id] });
      m.traverse((o) => { if (o.isMesh && /shell/.test(o.material.name)) { o.material.transparent = true; o.material.opacity = 0.45; } });
      m.position.copy(R.at(dist, x, y).pos);
      R.scene.add(m);
      return { planet: p.id, dist, x, y, mesh: m, back: 0 };
    });
    // ---- asteroids on the course ----
    const rocks = [];
    for (let i = 0; i < 16; i++) {
      const dist = ((i + 0.5) / 16) * R.length + 9;
      const x = ((i * 37) % 7 - 3) * 1.2, y = ((i * 53) % 5 - 2) * 0.9;
      const m = a.asteroid.clone(true);
      m.position.copy(R.at(dist, x, y).pos);
      m.scale.setScalar(0.9 + ((i * 13) % 5) * 0.12);
      m.rotation.set(i, i * 2, i * 3);
      R.scene.add(m);
      rocks.push({ dist, x, y, mesh: m, hit: -10 });
    }

    // ---- input ----
    const input = { x: 0, y: 0, keys: new Set(), drag: null, tilt: null };
    const kd = (e) => {
      const k = e.key.toLowerCase();
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
    let t = -3.2, px = 0, py = 0, vx = 0, vy = 0, finishedAt = null, lastCount = null;
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
        if (racing) {
          for (const ev of L.advance(me, dt, t)) {
            if (ev.type === "lap" && ev.lap < LAPS) toast(`Lap ${ev.lap + 1} of ${LAPS}`, "#b8f5c8");
            if (ev.type === "gate") { const g = gates[ev.gate]; g.scale.setScalar((TUBE / 2.8) * 1.08); setTimeout(() => g.scale.setScalar(TUBE / 2.8), 180); }
            if (ev.type === "finish") finish();
          }
          const scale = L.rivalTimeScale(me, t);
          for (const rv of rivals) {
            rv.state.baseSpeed = rv.speed + Math.sin(t * 0.35 + rv.phase) * 1.2;
            L.advance(rv.state, dt, t, { scale });
          }
          // pickups and asteroids near the player's distance on this lap
          const d = me.dist % R.length;
          for (const p of pickups) {
            if (t < p.back) continue;
            const dd = Math.abs(d - p.dist);
            if (dd < 2.2 && Math.hypot(px - p.x, py - p.y) < L.pickupRadius(me, t)) {
              const def = L.activate(me, p.planet, t);
              p.back = t + 8;
              toast(`${p.planet[0].toUpperCase() + p.planet.slice(1)}: ${def.name}`, `#${PCOL[p.planet].toString(16).padStart(6, "0")}`);
            }
          }
          for (const k of rocks) {
            if (t - k.hit < 1.5) continue;
            if (Math.abs(d - k.dist) < 1.4 && Math.hypot(px - k.x, py - k.y) < L.OBSTACLE_RADIUS) {
              k.hit = t;
              toast(L.hitObstacle(me, t) === "absorbed" ? "Shield held" : "Bump: slowed for a second", "#ffd28a");
            }
          }
        }
        // place everything
        const speedM = L.speedMultiplier(me, Math.max(0, t));
        const f = place(player, me.dist, px, py, -vx * 0.09);
        rivals.forEach((rv, i) => {
          rv.x = Math.sin(t * 0.6 + rv.phase) * 2.2 + (i - 1) * 0.8; rv.y = Math.cos(t * 0.45 + rv.phase) * 1.2;
          place(rv.mesh, rv.state.dist, rv.x, rv.y, Math.cos(t * 0.6 + rv.phase) * 0.25);
        });
        for (const p of pickups) {
          p.mesh.visible = t >= p.back;
          p.mesh.rotation.y += dt * 1.6;
          const s = 1 + 0.08 * Math.sin(t * 4);
          p.mesh.scale.setScalar(s * (L.isActive(me, "jupiter", t) ? 1.25 : 1));
        }
        for (const k of rocks) { k.mesh.rotation.x += dt * 0.3; k.mesh.rotation.y += dt * 0.2; }
        for (const pl of R.planets) pl.mesh.rotation.y += dt * 0.04;
        trail.intensity = 4 + speedM * 4;
        // chase camera: behind and above, smoothed; FOV opens with speed
        const back = 7.5, up = 2.4;
        tmp.copy(player.position).addScaledVector(f.t, -back).addScaledVector(f.up, up);
        const k = reduced() ? 1 : 1 - Math.pow(0.0008, dt);
        if (camPos.lengthSq() === 0) camPos.copy(tmp);
        camPos.lerp(tmp, k);
        camLook.lerp(tmp.copy(player.position).addScaledVector(f.t, 6), camLook.lengthSq() === 0 ? 1 : k);
        R.camera.position.copy(camPos);
        R.camera.up.copy(f.up);
        R.camera.lookAt(camLook);
        const fov = 62 + (speedM - 1) * 14;
        if (Math.abs(R.camera.fov - fov) > 0.05) { R.camera.fov += (fov - R.camera.fov) * Math.min(1, dt * 4); R.camera.updateProjectionMatrix(); }
        // HUD
        const order = L.standings([me, ...rivals.map((r) => r.state)]);
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
      end.innerHTML = `<p class="label">Race complete</p>
        <h1 class="race-title">${esc(L.ordinal(pos))} of 4</h1>
        <p class="race-lede">Time ${esc(L.fmtTime(me.finished))}. Laps ${me.lapTimes.map((x) => esc(L.fmtTime(x))).join(" · ")}. Power-ups ${me.pickups}, asteroids ${me.hits} (${me.absorbed} shielded).</p>
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
        } catch { end.querySelector("[data-res]").textContent += " (could not reach the brain; not saved)"; }
      }));
      end.querySelector("[data-again]").addEventListener("click", () => ctx.screens?.open("race"));
    }

    world.add("race", raceDef);
    await world.show("race");
    if (!alive) return;
    startedAt = performance.now();
    $("[data-menu]").hidden = true;
    hud.hidden = false;
    ctx.raceDebug = { me, rivals, pickups, get t() { return t; } };
  }

  return () => {
    alive = false;
    keysOff?.();
    loopOff?.();
    ctx.raceDebug = null;
    if (world.active === "race") {
      const back = prevScene && prevScene !== "race" ? prevScene : "space";
      world.show(back).then(() => world.remove("race"));
    } else world.remove("race");
  };
}
