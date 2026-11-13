// The body studio (refs 03-07): human.glb in matte slate blue on navy with key and rim light and a soft
// floor shadow; an X-ray mode (translucent fresnel shell with glowing procedural organs); measurement
// rings; the MESH SCAN (the body's own triangle mesh drawn as glowing lines sweeps head to feet while
// the solid surface dissolves into mesh, then resolves into X-ray); turn and zoom by drag/pinch (damped)
// and by Sentinel (eased camera moves); and DOM hotspots projected onto the body every frame.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Anchors on the body surface (where the red dot sits) and organ centres, in metres (GLB space:
// feet at y=0, ~1.89 m tall, facing +z, subject's left = +x). Measured from the mesh cross-sections.
export const ANCHORS = {
  head: [0.0, 1.835, 0.11], eyes: [0.032, 1.758, 0.152], lungs: [-0.085, 1.385, 0.14],
  heart: [0.05, 1.325, 0.145], gut: [0.0, 1.14, 0.14], bones: [0.135, 0.72, 0.075], whole_body: [-0.2, 1.0, 0.1],
};
// best view per zone for Sentinel's moves: azimuth (rad, 0 = front, + = toward subject's left), distance, target y
export const ZONE_VIEWS = {
  head: { az: -0.55, dist: 1.05, y: 1.76 }, eyes: { az: 0.0, dist: 0.75, y: 1.75 }, lungs: { az: -0.3, dist: 1.35, y: 1.34 },
  heart: { az: 0.35, dist: 1.2, y: 1.32 }, gut: { az: 0.15, dist: 1.35, y: 1.12 }, bones: { az: 0.55, dist: 2.0, y: 0.78 },
  whole_body: { az: 0.0, dist: 4.4, y: 0.98 },
};
// vertical span of each zone for focused zone scans
export const ZONE_SPAN = {
  head: [1.9, 1.66], eyes: [1.8, 1.72], lungs: [1.5, 1.2], heart: [1.42, 1.22], gut: [1.25, 0.98], bones: [0.98, 0.35], whole_body: [1.95, 0.0],
};
const NAMED = { front: 0, left: -Math.PI / 2, right: Math.PI / 2, back: Math.PI };
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const C = { slate: 0x66738f, ok: new THREE.Color(0.55, 0.82, 1.0), watch: new THREE.Color(1.0, 0.7, 0.28), alert: new THREE.Color(1.0, 0.22, 0.28), xray: new THREE.Color(0.55, 0.78, 1.0), wire: new THREE.Color(0.45, 0.85, 1.0), rad: new THREE.Color(1.0, 0.62, 0.25) };

const fresVert = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = viewMatrix * wp;
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
// X-ray shell: visible where the scan has passed, or everywhere when uXray = 1
const shellFrag = /* glsl */`
uniform vec3 color; uniform float uXray; uniform float uTop; uniform float uScan; uniform float uPower; uniform float uBase;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float passed = step(uScan, vY) * step(vY, uTop);
  float a = max(uXray, passed);
  if (a < 0.01) discard;
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
  gl_FragColor = vec4(color * (uBase + f * 1.1) * a, 1.0);
}`;
const organFrag = /* glsl */`
uniform vec3 color; uniform float uAlpha; uniform float uPulse;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
  gl_FragColor = vec4(color * (0.32 + f * 1.2) * uAlpha * uPulse, 1.0);
}`;
const wireVert = /* glsl */`
varying float vY;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const wireFrag = /* glsl */`
uniform vec3 color; uniform float uTop; uniform float uScan; uniform float uFade; uniform float uOn;
varying float vY;
void main() {
  if (uOn < 0.01) discard;
  float band = exp(-pow((vY - uScan) / 0.035, 2.0));
  float passed = step(uScan, vY) * step(vY, uTop + 0.02);
  float a = (band * 1.6 + passed * 0.4 * uFade) * uOn;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color * a, 1.0);
}`;

function floorShadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(0,0,0,0.6)"); gr.addColorStop(0.45, "rgba(0,0,0,0.28)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function ellipse(rx, rz, seg = 96) {
  const pts = [];
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz)); }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

export async function createBody(world, host, { tablet = false, onZoneClick } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  const target = new THREE.Vector3(0, 0.98, 0);

  // lights: soft studio key, cool rims, sky/ground fill
  scene.add(new THREE.HemisphereLight(0x9aa9c6, 0x0d1424, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(1.6, 3.2, 3.6); scene.add(key);
  const rimL = new THREE.DirectionalLight(0x8fb4ff, 2.4); rimL.position.set(-3, 2.2, -2.6); scene.add(rimL);
  const rimR = new THREE.DirectionalLight(0x9fc0ff, 1.6); rimR.position.set(3, 1.6, -2.4); scene.add(rimR);
  const fill = new THREE.DirectionalLight(0x6f86b8, 0.5); fill.position.set(-2, 0.5, 3); scene.add(fill);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ map: floorShadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002;
  scene.add(shadow);

  // ---- the body ----
  const gltf = await new GLTFLoader().loadAsync("assets/body3d/human.glb");
  let geom = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !geom) geom = o.geometry; });
  if (!geom) throw new Error("no mesh in human.glb");
  if (!geom.attributes.normal) geom.computeVertexNormals();
  const U = { uTop: { value: 2.0 }, uScan: { value: 3.0 }, uXray: { value: 0 } };
  const clayMat = new THREE.MeshStandardMaterial({ color: C.slate, roughness: 0.6, metalness: 0.05 });
  clayMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTop = U.uTop; sh.uniforms.uScan = U.uScan;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vWY;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vWY; uniform float uTop; uniform float uScan;")
      .replace("void main() {", "void main() {\n  if (vWY > uScan && vWY < uTop) discard;");
  };
  const clay = new THREE.Mesh(geom, clayMat);
  scene.add(clay);
  const shellU = { color: { value: C.xray.clone() }, uXray: U.uXray, uTop: U.uTop, uScan: U.uScan, uPower: { value: 2.2 }, uBase: { value: 0.035 } };
  const shell = new THREE.Mesh(geom, new THREE.ShaderMaterial({ uniforms: shellU, vertexShader: fresVert, fragmentShader: shellFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  shell.renderOrder = 2;
  scene.add(shell);
  const wireU = { color: { value: C.wire.clone() }, uTop: U.uTop, uScan: U.uScan, uFade: { value: 1 }, uOn: { value: 0 } };
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geom), new THREE.ShaderMaterial({ uniforms: wireU, vertexShader: wireVert, fragmentShader: wireFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  wire.renderOrder = 3;
  scene.add(wire);
  const radU = { color: { value: C.rad.clone() }, uXray: { value: 0 }, uTop: { value: -1 }, uScan: { value: 3 }, uPower: { value: 1.4 }, uBase: { value: 0.05 } };
  const radShell = new THREE.Mesh(geom, new THREE.ShaderMaterial({ uniforms: radU, vertexShader: fresVert, fragmentShader: shellFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  radShell.scale.setScalar(1.012); radShell.position.y = -0.01; radShell.renderOrder = 4; radShell.visible = false;
  scene.add(radShell);

  // ---- organs (procedural, placed by hand against the GLB's proportions) ----
  const organs = {};
  const organGroup = new THREE.Group();
  organGroup.renderOrder = 1;
  scene.add(organGroup);
  function organ(zone, geo, pos, scale = [1, 1, 1], rot = [0, 0, 0]) {
    const u = { color: { value: C.ok.clone() }, uAlpha: { value: 0 }, uPulse: { value: 1 } };
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: fresVert, fragmentShader: organFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(...pos); m.scale.set(...scale); m.rotation.set(...rot);
    organGroup.add(m);
    (organs[zone] ||= []).push(m);
    return m;
  }
  const sph = (r, w = 32, h = 20) => new THREE.SphereGeometry(r, w, h);
  organ("head", sph(0.078, 40, 28), [0, 1.8, 0.045], [1, 0.82, 1.18]);
  organ("eyes", sph(0.014), [0.032, 1.757, 0.128]);
  organ("eyes", sph(0.014), [-0.032, 1.757, 0.128]);
  organ("lungs", sph(0.072, 32, 24), [-0.078, 1.36, 0.022], [0.82, 1.6, 0.92], [0, 0, 0.08]);
  organ("lungs", sph(0.072, 32, 24), [0.082, 1.36, 0.022], [0.78, 1.55, 0.92], [0, 0, -0.08]);
  organ("heart", sph(0.044, 32, 24), [0.03, 1.325, 0.07], [0.95, 1.18, 0.9], [0, 0, 0.45]);
  organ("gut", sph(0.068, 32, 24), [0.03, 1.165, 0.05], [1.45, 0.85, 0.8], [0, 0, -0.2]);
  organ("gut", new THREE.TorusGeometry(0.062, 0.026, 12, 36), [0, 1.04, 0.05], [1.1, 0.9, 1], [Math.PI / 2.3, 0, 0]);
  for (let i = 0; i < 24; i++) {
    const y = 0.99 + i * 0.027;
    organ("bones", new THREE.BoxGeometry(0.03, 0.017, 0.026), [0, y, -0.045 + Math.sin((i / 23) * Math.PI) * -0.012]);
  }
  for (const s of [-1, 1]) {
    const femur = organ("bones", new THREE.CapsuleGeometry(0.019, 0.4, 6, 12), [s * 0.125, 0.71, 0.02]);
    femur.rotation.z = s * 0.06;
    organ("bones", new THREE.CapsuleGeometry(0.015, 0.36, 6, 12), [s * 0.15, 0.3, 0.0]).rotation.z = s * -0.02;
  }

  // ---- measurement rings (ref 04) ----
  const rings = {};
  const ringGroup = new THREE.Group();
  scene.add(ringGroup);
  function ringAt(name, rx, rz, pos, rotZ = 0) {
    const l = new THREE.Line(ellipse(rx, rz), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
    l.position.set(...pos); l.rotation.z = rotZ;
    ringGroup.add(l);
    (rings[name] ||= []).push(l);
  }
  ringAt("head", 0.1, 0.12, [0, 1.76, 0.055]);
  ringAt("chest", 0.205, 0.14, [0, 1.37, 0.034]);
  ringAt("waist", 0.172, 0.125, [0, 1.1, 0.03]);
  ringAt("arms", 0.068, 0.062, [-0.392, 1.3, 0.03], -0.66);
  ringAt("arms", 0.068, 0.062, [0.392, 1.3, 0.03], 0.66);
  ringAt("thighs", 0.078, 0.08, [-0.135, 0.7, 0.025]);
  ringAt("thighs", 0.078, 0.08, [0.135, 0.7, 0.025]);
  const ZONE_RING = { head: "head", eyes: "head", lungs: "chest", heart: "chest", gut: "waist", bones: "thighs", whole_body: null };
  let activeRing = null;

  // ---- camera, controls ----
  const controls = new OrbitControls(camera, host);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 0.6; controls.maxDistance = 6.5;
  controls.minPolarAngle = Math.PI * 0.32; controls.maxPolarAngle = Math.PI * 0.58;
  controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8;
  controls.target.copy(target);
  const cam = { az: 0, el: 0.06, dist: 4.4, ty: 0.98, tx: 0, tz: 0 };
  function applyCam() {
    camera.position.set(cam.tx + cam.dist * Math.sin(cam.az) * Math.cos(cam.el), cam.ty + cam.dist * Math.sin(cam.el), cam.tz + cam.dist * Math.cos(cam.az) * Math.cos(cam.el));
    controls.target.set(cam.tx, cam.ty, cam.tz);
    camera.lookAt(controls.target);
  }
  function readCam() {
    const off = camera.position.clone().sub(controls.target);
    cam.dist = off.length(); cam.az = Math.atan2(off.x, off.z); cam.el = Math.asin(THREE.MathUtils.clamp(off.y / cam.dist, -1, 1));
    cam.tx = controls.target.x; cam.ty = controls.target.y; cam.tz = controls.target.z;
  }
  let W = 1, H = 1;
  let homeDist = 4.4;
  // the body is framed in the free area between the panels (#body-host), inside the full-screen world
  let hostR = { left: 0, top: 0, width: 1, height: 1 };
  function readHost() {
    const r = host.getBoundingClientRect();
    if (r.width > 10 && r.height > 10) hostR = r;
  }
  function fitDist() {
    readHost();
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const needH = (2.2 * H) / (2 * half * hostR.height);
    const needW = (1.45 * W) / (2 * half * camera.aspect * hostR.width);
    return Math.max(needH, needW);
  }
  function frameOffset() {
    camera.setViewOffset(W, H, W / 2 - (hostR.left + hostR.width / 2), H / 2 - (hostR.top + hostR.height / 2) + hostR.height * 0.02, W, H);
  }
  function resize(w, h) {
    W = w; H = h; camera.aspect = w / h; camera.updateProjectionMatrix();
    const wasHome = Math.abs(cam.dist - homeDist) < 0.05;
    homeDist = fitDist();
    controls.maxDistance = homeDist * 1.4;
    frameOffset();
    if (wasHome || !moved) { cam.dist = homeDist; applyCam(); }
  }
  let moved = false;
  controls.addEventListener("start", () => { moved = true; killTween(); });
  applyCam();

  let camTween = null;
  function killTween() { camTween?.kill(); camTween = null; controls.enabled = true; }
  /** Ease the camera to {az, dist, y}. Never snaps (unless reduced motion). */
  function moveCam(to, seconds = 1.2) {
    readCam();
    killTween();
    // shortest way round
    let daz = ((to.az ?? cam.az) - cam.az) % (Math.PI * 2);
    if (daz > Math.PI) daz -= Math.PI * 2; if (daz < -Math.PI) daz += Math.PI * 2;
    const dest = { az: cam.az + daz, dist: to.dist ?? cam.dist, el: to.el ?? 0.06, ty: to.y ?? cam.ty, tx: to.x ?? 0, tz: to.z ?? 0 };
    const g = window.gsap;
    if (!g || reduced() || seconds === 0) { Object.assign(cam, dest); applyCam(); return Promise.resolve(); }
    controls.enabled = false;
    return new Promise((res) => {
      camTween = g.to(cam, { ...dest, duration: seconds, ease: "power3.inOut", onUpdate: applyCam, onComplete: () => { controls.enabled = true; camTween = null; res(); }, onInterrupt: res });
    });
  }

  // ---- hotspots ----
  const hot = {};
  const ZLABEL = { head: "Brain and cognition", eyes: "Eyes and vision", heart: "Heart and circulation", lungs: "Lungs and breathing", gut: "Digestion and nutrition", bones: "Bones and muscles" };
  const hotLayer = document.getElementById("hotspots");
  for (const z of Object.keys(ZLABEL)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "zone is-ok"; b.id = `zone-${z}`; b.dataset.zone = z;
    b.setAttribute("aria-label", ZLABEL[z]);
    b.innerHTML = `<span class="zdot"></span><span class="zname">${ZLABEL[z]}</span>`;
    b.addEventListener("click", (e) => { e.stopPropagation(); onZoneClick?.(z, b); });
    hotLayer.appendChild(b);
    hot[z] = b;
  }
  const v3 = new THREE.Vector3(), out = new THREE.Vector3(), toCam = new THREE.Vector3();
  function project(zone) {
    const a = ANCHORS[zone];
    v3.set(a[0], a[1], a[2]).project(camera);
    return { x: (v3.x + 1) / 2 * W, y: (1 - v3.y) / 2 * H, z: v3.z };
  }
  function facing(zone) {
    const a = ANCHORS[zone];
    out.set(a[0], 0, a[2] - 0.02).normalize();
    toCam.set(camera.position.x - a[0], 0, camera.position.z - a[2]).normalize();
    return out.dot(toCam) > -0.05;
  }
  function updateHotspots() {
    for (const z in hot) {
      const p = project(z);
      const el = hot[z];
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      const vis = facing(z) && p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20;
      el.classList.toggle("is-hidden", !vis);
    }
  }

  // ---- state ----
  const zoneSev = {};
  let target_ = null, xrayOn = false, pulseT = 0, radOn = false;
  function organColor(z) {
    const s = zoneSev[z] || "ok";
    return s === "alert" ? C.alert : s === "watch" || s === "info" ? C.watch : C.ok;
  }
  let hostCheck = 0;
  function update(dt, t) {
    if ((hostCheck += dt) > 0.5) { hostCheck = 0; const before = hostR.width + hostR.height + hostR.left; readHost(); if (hostR.width + hostR.height + hostR.left !== before) { resize(W, H); } }
    frameOffset();
    if (controls.enabled) controls.update();
    pulseT += dt;
    const xa = U.uXray.value;
    clay.visible = xa < 0.98;
    for (const z in organs) {
      const col = organColor(z);
      const isT = z === target_;
      for (const m of organs[z]) {
        m.material.uniforms.color.value.lerp(col, Math.min(1, dt * 4));
        const want = Math.max(xa, wireU.uOn.value * 0.6) * (isT ? 1.25 : 0.85);
        m.material.uniforms.uAlpha.value += (want - m.material.uniforms.uAlpha.value) * Math.min(1, dt * 4);
        m.material.uniforms.uPulse.value = isT ? 1 + 0.35 * Math.sin(pulseT * 5) : 1;
        m.visible = m.material.uniforms.uAlpha.value > 0.01;
      }
    }
    for (const name in rings) for (const l of rings[name]) {
      const act = name === activeRing;
      const op = act ? 0.95 : xa > 0.5 ? 0.08 : 0.22;
      l.material.opacity += (op - l.material.opacity) * Math.min(1, dt * 5);
      l.material.color.lerp(act ? new THREE.Color(0x6fd0ff) : new THREE.Color(0xffffff), Math.min(1, dt * 5));
    }
    if (radOn) { radU.uXray.value = 0.55 + 0.25 * Math.sin(t * 2.2); }
    updateHotspots();
  }

  const api = {
    scene, camera, update, resize,
    hotspots: hot,
    zoneEl: (z) => hot[z] || null,
    anchorWorld: (z) => ANCHORS[z],
    /** viewport coordinates of a zone's anchor */
    screenPoint(z) {
      const p = project(z);
      return { x: p.x, y: p.y };
    },
    setZoneStates(zones) {
      for (const z of Object.keys(ZLABEL)) {
        const st = zones?.[z] || "ok";
        zoneSev[z] = st;
        const cls = `is-${st === "info" ? "watch" : st}`;
        const el = hot[z];
        if (!el.classList.contains(cls)) { el.classList.remove("is-ok", "is-watch", "is-alert"); el.classList.add(cls); }
      }
    },
    setTarget(z) {
      target_ = z && z !== "whole_body" ? z : null;
      for (const k in hot) hot[k].classList.toggle("is-target", k === target_);
      activeRing = z ? ZONE_RING[z] : null;
    },
    setRing(name) { activeRing = name; },
    showRadiation(on) { radOn = !!on; radShell.visible = radOn; if (!on) radU.uXray.value = 0; },
    get radiationOn() { return radOn; },
    /** X-ray on or off, eased. */
    setXray(on, seconds = 0.8) {
      xrayOn = !!on;
      const g = window.gsap;
      if (!g || reduced() || seconds === 0) { U.uXray.value = on ? 1 : 0; return Promise.resolve(); }
      return new Promise((res) => g.to(U.uXray, { value: on ? 1 : 0, duration: seconds, ease: "power2.inOut", overwrite: true, onComplete: res, onInterrupt: res }));
    },
    get xray() { return xrayOn; },
    /** Start a mesh scan over [top, bottom] (metres). The band then moves with sweepTo(). */
    beginScan(top = 1.95) { U.uTop.value = top; U.uScan.value = top + 0.04; wireU.uOn.value = 1; wireU.uFade.value = 1; },
    sweepTo(y, seconds) {
      const g = window.gsap;
      if (!g || reduced() || !seconds) { U.uScan.value = y; return Promise.resolve(); }
      return new Promise((res) => g.to(U.uScan, { value: y, duration: seconds, ease: "none", overwrite: true, onComplete: res, onInterrupt: res }));
    },
    get scanY() { return U.uScan.value; },
    /** End the scan: the mesh resolves into the X-ray view. */
    async endScan(toXray = true, seconds = 0.9) {
      const g = window.gsap;
      if (toXray) { xrayOn = true; }
      if (!g || reduced()) { U.uXray.value = toXray ? 1 : U.uXray.value; wireU.uOn.value = 0; U.uScan.value = 3; return; }
      await Promise.all([
        new Promise((r) => g.to(U.uXray, { value: toXray ? 1 : U.uXray.value, duration: seconds, ease: "power2.inOut", onComplete: r })),
        new Promise((r) => g.to(wireU.uOn, { value: 0, duration: seconds * 1.3, ease: "power2.in", onComplete: r })),
      ]);
      U.uScan.value = 3; U.uTop.value = 2;
    },
    cancelScan() { window.gsap?.killTweensOf(U.uScan); wireU.uOn.value = 0; U.uScan.value = 3; U.uTop.value = 2; },
    get scanning() { return wireU.uOn.value > 0.01; },
    /** Turn the body: a named view (front|back|left|right) or an angle in degrees. */
    rotate(viewOrDeg, seconds = 1.2) {
      const az = typeof viewOrDeg === "number" ? THREE.MathUtils.degToRad(viewOrDeg) : NAMED[viewOrDeg] ?? 0;
      readCam();
      return moveCam({ az, dist: cam.dist, y: cam.ty, x: cam.tx, z: cam.tz, el: cam.el }, seconds);
    },
    turnBy(deg, seconds = 1.0) { readCam(); return moveCam({ az: cam.az + THREE.MathUtils.degToRad(deg), dist: cam.dist, y: cam.ty, x: cam.tx, z: cam.tz, el: cam.el }, seconds); },
    /** Zoom to a zone's best view, or reset to the whole body. */
    zoomTo(zone, seconds = 1.3) {
      if (!zone || zone === "reset" || zone === "whole_body") return api.zoomReset(seconds);
      const v = ZONE_VIEWS[zone];
      const a = ANCHORS[zone];
      return moveCam({ az: v.az, dist: v.dist, y: v.y, x: a[0] * 0.6, z: 0.02, el: 0.05 }, seconds);
    },
    zoomReset(seconds = 1.1) { moved = false; return moveCam({ az: 0, dist: homeDist, y: 0.98, x: 0, z: 0, el: 0.06 }, seconds); },
    isZoomed: () => cam.dist < homeDist * 0.8 || Math.abs(cam.dist - homeDist) > 0.3,
    get view() { readCam(); return { az: THREE.MathUtils.radToDeg(cam.az), dist: cam.dist, home: homeDist }; },
    controls,
    organs,
  };
  return api;
}
