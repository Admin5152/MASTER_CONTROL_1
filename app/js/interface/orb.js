// Sentinel's orb (ref 01), rendered directly in the full-screen world (no frame, no backdrop):
// a dark glossy glass sphere with a bright fresnel rim, an inner luminous core, three light ribbons
// wrapping it, a soft halo and a pool of light beneath it so it sits in space. Bloom comes from the
// world's single bloom pass. Motion is eased; the speaking pulse follows the real TTS audio level.
// API (kept from v1): setState('idle'|'listening'|'thinking'|'speaking'|'warning'), getState(),
// setSeverity('none'|'info'|'watch'|'alert'), drive({turbulence, hue, rate}) for Orb Calm (null releases),
// setLevel(0..1) mic level, setSpeakLevel(0..1) TTS level, look(nx, ny), center(), burst().
import * as THREE from "three";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const HUES = { idle: 208, calm: 214, watch: 36, alert: 356 };

const vert = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const glassFrag = /* glsl */`
uniform vec3 rimColor; uniform float intensity; uniform float time; uniform float uOpacity;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float ndv = max(dot(n, v), 0.0);
  float f = 1.0 - ndv;
  float rim = pow(f, 4.2) * intensity * 2.4 + pow(f, 1.6) * 0.05 * intensity;
  // two studio highlights for a glossy, weighty read
  vec3 L1 = normalize(vec3(-0.5, 0.78, 0.45));
  vec3 L2 = normalize(vec3(0.7, -0.35, 0.6));
  float spec = pow(max(dot(reflect(-L1, n), v), 0.0), 140.0) * 0.75 + pow(max(dot(reflect(-L2, n), v), 0.0), 40.0) * 0.04;
  // inner body: near-black glass with a faint cool gradient toward the lower right (ref 01)
  float lower = smoothstep(0.6, -0.9, vP.y) * smoothstep(-0.8, 0.9, vP.x);
  float swirl = 0.5 + 0.5 * sin(vP.y * 4.0 + time * 0.5 + sin(vP.x * 3.0 - time * 0.3) * 1.4);
  vec3 body = vec3(0.002, 0.004, 0.01) + rimColor * (0.008 + 0.045 * lower * (0.6 + 0.4 * swirl));
  vec3 col = body + rimColor * rim + vec3(0.85, 0.92, 1.0) * spec;
  gl_FragColor = vec4(col * uOpacity, uOpacity);
}`;
const coreFrag = /* glsl */`
uniform vec3 color; uniform float amount; uniform float uOpacity;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  float c = pow(max(dot(normalize(vN), normalize(vV)), 0.0), 2.5);
  gl_FragColor = vec4(color * c * amount * uOpacity, 1.0);
}`;
const ribbonVert = /* glsl */`
uniform float time; uniform float turb; uniform float tight; uniform float phase;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position * tight + normal * turb * 0.09 * sin(uv.x * 22.0 + time * 3.1 + phase);
  p += normalize(position) * turb * 0.06 * sin(uv.x * 9.0 - time * 1.7 + phase * 2.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const ribbonFrag = /* glsl */`
uniform vec3 color; uniform float bright; uniform float time; uniform float speed; uniform float phase; uniform float uOpacity;
varying vec2 vUv;
void main() {
  float along = vUv.x;
  float ends = smoothstep(0.0, 0.2, along) * smoothstep(1.0, 0.6, along);
  float wave = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(along * 10.0 - time * speed + phase), 2.0);
  gl_FragColor = vec4(color * bright * ends * wave * uOpacity, 1.0);
}`;
const glowFrag = /* glsl */`
uniform vec3 color; uniform float amount; uniform float uOpacity; varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float g = exp(-r * r * 3.6) * smoothstep(1.0, 0.45, r);
  gl_FragColor = vec4(color * g * amount * uOpacity, 1.0);
}`;
const uvVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function ribbonCurve(seed, tilt, arc) {
  const pts = [];
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * arc;
    const r = 1.03 + 0.03 * Math.sin(a * 3 + seed) + 0.018 * Math.sin(a * 7 + seed * 2);
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a + seed) * 0.16, Math.sin(a) * r));
  }
  const last = pts[pts.length - 1];
  pts.push(last.clone().multiplyScalar(1.08).add(new THREE.Vector3(0, -0.1, 0)));
  const m = new THREE.Matrix4().makeRotationFromEuler(tilt);
  pts.forEach((p) => p.applyMatrix4(m));
  return new THREE.CatmullRomCurve3(pts);
}

export function createOrb() {
  const group = new THREE.Group();
  const root = new THREE.Group();
  group.add(root);
  const add = (m) => { m.renderOrder = 1; root.add(m); return m; };
  const op = { value: 1 };

  const glassU = { rimColor: { value: new THREE.Color() }, intensity: { value: 1.2 }, time: { value: 0 }, uOpacity: op };
  const glass = add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({ uniforms: glassU, vertexShader: vert, fragmentShader: glassFrag, transparent: true })));
  const coreU = { color: { value: new THREE.Color() }, amount: { value: 0.25 }, uOpacity: op };
  const core = add(new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 32), new THREE.ShaderMaterial({ uniforms: coreU, vertexShader: vert, fragmentShader: coreFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  core.position.set(0.12, -0.18, 0.2);
  core.renderOrder = 2;

  const ribbons = [];
  [{ seed: 0.3, tilt: new THREE.Euler(0.35, 0.2, 0.85), arc: 1.75, speed: 0.2, r: 0.017 },
   { seed: 2.1, tilt: new THREE.Euler(-0.6, 1.1, -0.35), arc: 1.45, speed: -0.15, r: 0.013 },
   { seed: 4.0, tilt: new THREE.Euler(1.25, -0.5, 0.2), arc: 1.3, speed: 0.12, r: 0.01 }].forEach((d, i) => {
    const u = { color: { value: new THREE.Color() }, bright: { value: 1 }, time: { value: 0 }, speed: { value: 1.4 }, phase: { value: i * 2.1 }, turb: { value: 0.04 }, tight: { value: 1 }, uOpacity: op };
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(ribbonCurve(d.seed, d.tilt, d.arc), 240, d.r, 8, false),
      new THREE.ShaderMaterial({ uniforms: u, vertexShader: ribbonVert, fragmentShader: ribbonFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.renderOrder = 3;
    const pivot = new THREE.Group();
    pivot.add(mesh);
    pivot.rotation.set(d.seed * 0.3, d.seed, 0);
    root.add(pivot);
    ribbons.push({ pivot, u, speed: d.speed, axis: new THREE.Vector3(Math.sin(d.seed), 1, Math.cos(d.seed)).normalize() });
  });

  const haloU = { color: { value: new THREE.Color() }, amount: { value: 0.16 }, uOpacity: op };
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.ShaderMaterial({ uniforms: haloU, vertexShader: uvVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.z = -1.2; halo.renderOrder = 0;
  group.add(halo);
  const poolU = { color: { value: new THREE.Color() }, amount: { value: 0.32 }, uOpacity: op };
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.ShaderMaterial({ uniforms: poolU, vertexShader: uvVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.position.set(0, -1.45, 0); pool.rotation.x = -Math.PI / 2 + 0.22; pool.scale.set(1, 0.42, 1);
  group.add(pool);
  const flashU = { color: { value: new THREE.Color(0.75, 0.9, 1.0) }, amount: { value: 0 }, uOpacity: op };
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.ShaderMaterial({ uniforms: flashU, vertexShader: uvVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.z = 0.8; flash.renderOrder = 5;
  group.add(flash);

  let state = "idle", severity = "none", driven = null, level = 0, speak = 0;
  let lookX = 0, lookY = 0, lookTX = 0, lookTY = 0;
  const p = { hue: HUES.idle, rim: 1.15, bright: 1, speed: 1.3, tight: 1, turb: 0.04, spin: 1, pulse: 1, core: 0.25 };
  const c = new THREE.Color();

  function targets() {
    let hue = HUES.idle, rim = 1.15, bright = 1.0, speed = 1.3, tight = 1, turb = 0.035, spin = 1, core = 0.22;
    if (state === "listening") { rim = 1.3 + level * 1.2; bright = 1.25 + level * 2; speed = 2.4 + level * 3.5; spin = 1.8 + level * 1.8; turb = 0.05 + level * 0.2; core = 0.32 + level * 0.4; }
    else if (state === "thinking") { tight = 0.965; spin = 3.0; speed = 3.0; bright = 1.2; rim = 1.25; core = 0.35; }
    else if (state === "speaking") { rim = 1.15 + speak * 1.4; bright = 1.05 + speak * 1.6; speed = 1.8; spin = 1.3; turb = 0.04 + speak * 0.1; core = 0.3 + speak * 0.6; }
    if (severity === "watch") { hue = HUES.watch; rim += 0.2; }
    if (state === "warning" || severity === "alert") { hue = HUES.alert; rim += 0.3; spin *= 1.3; turb += 0.08; }
    if (driven) { hue = driven.hue; turb = 0.03 + driven.turbulence * 0.8; spin = 0.6 + (driven.rate ?? 1) * 1.1; speed = 1 + (driven.rate ?? 1) * 1.4; rim = 1.1 + driven.turbulence * 1.1; core = 0.25 + driven.turbulence * 0.3; }
    return { hue, rim, bright, speed, tight, turb, spin, core };
  }

  function update(dt, t) {
    const slow = reduced() ? 0.3 : 1;
    const tg = targets();
    const k = Math.min(1, dt * 2.6);      // eased, never stepped
    const dh = ((tg.hue - p.hue + 540) % 360) - 180;
    p.hue = (p.hue + dh * Math.min(1, dt * 1.8) + 360) % 360;
    for (const key of ["rim", "bright", "speed", "tight", "turb", "spin", "core"]) p[key] += (tg[key] - p[key]) * k;
    const pulseT = state === "speaking" ? 1 + speak * 0.055 : 1 + 0.01 * Math.sin(t * 1.3);
    p.pulse += (pulseT - p.pulse) * Math.min(1, dt * 10);
    root.scale.setScalar(p.pulse);
    lookX += (lookTX - lookX) * Math.min(1, dt * 2.5); lookY += (lookTY - lookY) * Math.min(1, dt * 2.5);
    root.rotation.y = lookX * 0.5; root.rotation.x = -lookY * 0.4;
    glassU.rimColor.value.setHSL(p.hue / 360, 0.85, 0.56);
    glassU.intensity.value = p.rim; glassU.time.value = t;
    coreU.color.value.setHSL(p.hue / 360, 0.9, 0.55); coreU.amount.value = p.core * 0.55;
    haloU.color.value.setHSL(p.hue / 360, 0.9, 0.45); haloU.amount.value = 0.1 + p.core * 0.18;
    poolU.color.value.setHSL(p.hue / 360, 0.85, 0.55); poolU.amount.value = 0.22 + p.core * 0.3;
    c.setHSL(p.hue / 360, 0.95, 0.66);
    for (const r of ribbons) {
      r.pivot.rotateOnAxis(r.axis, r.speed * p.spin * dt * slow);
      r.u.time.value = t; r.u.speed.value = p.speed; r.u.bright.value = p.bright; r.u.turb.value = p.turb; r.u.tight.value = p.tight;
      r.u.color.value.copy(c);
    }
    if (flashU.amount.value > 0) flashU.amount.value = Math.max(0, flashU.amount.value - dt * 1.2);
  }

  let world = null;
  return {
    group, update,
    attach(w) { world = w; w.setOrb(this); },
    setOpacity(o) { op.value = o; },
    setState(s) { state = s; },
    getState: () => state,
    setSeverity(s) { severity = s || "none"; },
    drive(d) { driven = d ? { ...d } : null; },
    setLevel(v) { level = Math.max(0, Math.min(1, v)); },
    setSpeakLevel(v) { speak = Math.max(0, Math.min(1, v)); },
    look(nx, ny) { lookTX = nx; lookTY = ny; },
    /** The soft burst when the orb forms at the end of the intro. */
    burst() { flashU.amount.value = 1.6; },
    center() {
      const o = world?.orbPlace || { x: 0, y: 0, size: 0 };
      return { x: o.x, y: o.y, r: o.size / 2 };
    },
    probe: () => world?.probeOrb() ?? 0,
  };
}

export const ORB_HUES = HUES;
