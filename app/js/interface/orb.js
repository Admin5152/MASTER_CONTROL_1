// Sentinel's orb, v3: a particle form. Thousands of small lit cubes hold the shape of a sphere in a thin
// volumetric shell, on a holographic pedestal of fine rings, rendered in the shared world (bloom comes
// from the world's pass). A few particles always drift off the edge and dissolve, so it reads as alive.
// All motion runs on the GPU (one instanced draw call), so it stays smooth on a tablet.
// States shape the particles: idle breathes slowly; listening ripples with the mic level; thinking
// swirls in latitude bands; speaking sends pulse waves across the surface with the voice level;
// watch/alert tint the light and break the edges up. drive({turbulence, hue, rate, breath}) lets
// Stillpoint take over (breath 0..1 expands the form with the breath).
// API (unchanged): setState('idle'|'listening'|'thinking'|'speaking'|'warning'), getState(),
// setSeverity('none'|'info'|'watch'|'alert'), drive(d|null), setLevel(0..1), setSpeakLevel(0..1),
// look(nx, ny), center(), burst(), setOpacity(o), attach(world), update(dt, t), probe().
import * as THREE from "three";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const HUES = { idle: 208, calm: 214, watch: 36, alert: 356 };
const TABLET = /Android|iPad|Tablet/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

const particleVert = /* glsl */`
attribute vec3 aDir;      // unit direction on the sphere
attribute vec4 aSeed;     // x: shell depth 0..1, y: size, z: phase, w: drifter (0..1, > .93 drifts away)
uniform float time, uTurb, uSwirl, uSpeak, uLevel, uBreath, uPulse, uFrag, uSize;
uniform vec3 uPoint; uniform float uPush; uniform float uSmall;   // uSmall: 1 when docked small: calmer, simpler      // pointer direction in orb space, strength 0..1
uniform vec3 uHit; uniform float uScatter;     // tap point, shockwave 0..1 (decays)
varying vec3 vN; varying vec3 vW; varying float vEdge; varying float vFade; varying float vSeed; varying float vNear;

// cheap 3D value noise
float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
mat3 rotAxis(vec3 ax, float a) {
  float c = cos(a), s = sin(a), t = 1.0 - c;
  return mat3(t*ax.x*ax.x + c, t*ax.x*ax.y + s*ax.z, t*ax.x*ax.z - s*ax.y,
              t*ax.x*ax.y - s*ax.z, t*ax.y*ax.y + c, t*ax.y*ax.z + s*ax.x,
              t*ax.x*ax.z + s*ax.y, t*ax.y*ax.z - s*ax.x, t*ax.z*ax.z + c);
}
void main() {
  vec3 d = aDir;
  // thinking: latitude bands swirl at different speeds
  d = rotY(uSwirl * time * (0.6 + 1.4 * abs(d.y)) * sign(d.y + 0.001)) * d;
  // surface motion: slow breathing noise, mic ripples, speaking waves from the front
  float slow = n3(d * 2.3 + vec3(0.0, time * 0.22, time * 0.17));
  float rip = sin(dot(d, vec3(0.0, 1.0, 0.0)) * 18.0 - time * 7.0) * uLevel;
  float wave = sin(acos(clamp(d.z, -1.0, 1.0)) * 9.0 - time * 10.0) * uSpeak;
  float near = smoothstep(0.55, 1.0, dot(d, uPoint)) * uPush;                 // particles under the pointer bulge out
  float hitD = acos(clamp(dot(d, uHit), -1.0, 1.0));
  float shock = uScatter * exp(-pow((hitD - (1.0 - uScatter) * 2.6) * 3.0, 2.0)); // a ring travelling out from the tap
  float r = 1.0 - aSeed.x * 0.16 + (slow - 0.5) * (0.07 + uTurb * 0.5) + rip * 0.035 + wave * 0.05 + near * 0.16 + shock * (0.25 + aSeed.y * 0.3);
  vNear = max(near, shock);
  r *= uPulse * (1.0 + uBreath * 0.16);
  // drifters peel off the edge and fade, then reform (a looping 4-7 s life)
  float life = fract(time / (4.0 + aSeed.z * 3.0) + aSeed.z);
  float drift = smoothstep(0.93 - uFrag * 0.35, 1.0, aSeed.w) * life * (1.0 - uSmall);
  vec3 center = d * (r + drift * (0.55 + aSeed.y * 0.4)) + vec3(0.0, drift * 0.25, 0.0);
  vFade = 1.0 - drift * drift;
  // each cube tumbles a little; size varies, drifters shrink
  vec3 ax = normalize(vec3(aSeed.z - 0.5, 0.7, aSeed.y - 0.5));
  mat3 R = rotAxis(ax, time * (0.3 + aSeed.y) + aSeed.z * 6.28);
  float sz = uSize * (0.55 + aSeed.y * 0.9) * (1.0 - drift * 0.6) * (1.0 + uSmall * 1.6);
  vec3 p = center + R * (position * sz);
  vN = normalize(normalMatrix * mix(R * normal, d, uSmall * 0.85));   // small: lit like one smooth sphere
  vec4 wp = modelViewMatrix * vec4(p, 1.0);
  vW = -wp.xyz;
  vEdge = aSeed.x; vSeed = aSeed.y;
  gl_Position = projectionMatrix * wp;
}`;

const particleFrag = /* glsl */`
uniform vec3 uTint; uniform float uGlow, uOpacity, time, uSmall;
varying vec3 vN; varying vec3 vW; varying float vEdge; varying float vFade; varying float vSeed; varying float vNear;
void main() {
  vec3 n = normalize(vN), v = normalize(vW);
  vec3 L1 = normalize(vec3(-0.45, 0.8, 0.55)), L2 = normalize(vec3(0.7, -0.2, 0.4));
  float dif = max(dot(n, L1), 0.0) * 0.85 + max(dot(n, L2), 0.0) * 0.25;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float occ = mix(1.0, 0.4, vEdge);                                     // deeper particles sit in shadow
  // each particle has its own shade: deep navy -> silver -> ice, and the state's accent on the lit side
  vec3 navy = vec3(0.06, 0.10, 0.22), silver = vec3(0.46, 0.52, 0.60), ice = vec3(0.52, 0.72, 0.92);
  vec3 albedo = vSeed < 0.5 ? mix(navy, silver, vSeed * 2.0) : mix(silver, ice, (vSeed - 0.5) * 2.0);
  albedo = mix(albedo, uTint * 0.8, 0.3 + 0.25 * min(uGlow, 1.5));
  albedo = mix(albedo, mix(silver, uTint, 0.55) * 1.15, uSmall * 0.85);   // small: one even tone, no speckle
  vec3 col = albedo * (0.1 + dif * 0.85) * occ;
  col += uTint * (fres * 0.45 + uGlow * 0.18) * occ;
  float spark = step(0.993, vSeed) * pow(0.5 + 0.5 * sin(time * 2.0 + vSeed * 900.0), 8.0);   // a few particles glint
  col += vec3(0.8, 0.92, 1.0) * spark * 0.9 * (1.0 - uSmall) + uTint * vNear * 0.5;
  gl_FragColor = vec4(col * uOpacity * vFade, uOpacity * vFade);
}`;

// pedestal: concentric rings, a soft disc and a faint radial grid
const ringFrag = /* glsl */`
uniform vec3 uTint; uniform float time, uOpacity, uGlow; varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = atan(p.y, p.x);
  float rings = 0.0;
  rings += smoothstep(0.012, 0.0, abs(r - 0.94)) * 0.9;
  rings += smoothstep(0.008, 0.0, abs(r - 0.80)) * 0.55;
  rings += smoothstep(0.006, 0.0, abs(r - 0.62)) * 0.4;
  rings += smoothstep(0.005, 0.0, abs(r - 0.42)) * 0.35;
  float dash = step(0.5, fract(a * 18.0 / 6.2832 + time * 0.05));
  rings += smoothstep(0.01, 0.0, abs(r - 0.88)) * dash * 0.5;
  float spokes = smoothstep(0.004, 0.0, abs(fract(a * 36.0 / 6.2832) - 0.5) * 0.12) * smoothstep(0.95, 0.4, r) * smoothstep(0.2, 0.4, r) * 0.12;
  float sweep = pow(max(0.0, cos(a - time * 0.8)), 24.0) * smoothstep(0.95, 0.3, r) * 0.25;
  float disc = smoothstep(0.95, 0.0, r) * 0.18;
  float m = (rings + spokes + sweep) * smoothstep(1.0, 0.9, r) + disc;
  gl_FragColor = vec4(mix(vec3(0.75, 0.82, 0.9), uTint, 0.55) * m * (0.3 + 0.3 * uGlow) * uOpacity, 1.0);
}`;
const glowFrag = /* glsl */`
uniform vec3 color; uniform float amount; uniform float uOpacity; varying vec2 vUv;
void main() { vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float g = exp(-r * r * 3.6) * smoothstep(1.0, 0.45, r); gl_FragColor = vec4(color * g * amount * uOpacity, 1.0); }`;
const uvVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export function createOrb() {
  const group = new THREE.Group();
  const root = new THREE.Group();
  group.add(root);
  const op = { value: 1 };

  // ---- the particles: one instanced draw ----
  const N = TABLET ? 9000 : 20000;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = box.index; geo.attributes.position = box.attributes.position; geo.attributes.normal = box.attributes.normal;
  const dir = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    // Fibonacci sphere: even coverage, then a little jitter so it doesn't look gridded
    const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = golden * i;
    const v = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr).add(new THREE.Vector3((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03)).normalize();
    dir.set([v.x, v.y, v.z], i * 3);
    seed.set([Math.pow(Math.random(), 1.8), Math.random(), Math.random(), Math.random()], i * 4);
  }
  // shuffle the order so any prefix (fewer particles when docked small) still covers the whole sphere
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));
    for (let k = 0; k < 3; k++) { const t = dir[i * 3 + k]; dir[i * 3 + k] = dir[j * 3 + k]; dir[j * 3 + k] = t; } }
  geo.setAttribute("aDir", new THREE.InstancedBufferAttribute(dir, 3));
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = N;
  const pU = { uSmall: { value: 0 }, uPoint: { value: new THREE.Vector3(0, 0, 1) }, uPush: { value: 0 }, uHit: { value: new THREE.Vector3(0, 0, 1) }, uScatter: { value: 0 }, time: { value: 0 }, uTurb: { value: 0.05 }, uSwirl: { value: 0 }, uSpeak: { value: 0 }, uLevel: { value: 0 }, uBreath: { value: 0 }, uPulse: { value: 1 }, uFrag: { value: 0 },
    uSize: { value: TABLET ? 0.04 : 0.029 }, uTint: { value: new THREE.Color() }, uGlow: { value: 0.3 }, uOpacity: op };
  const particles = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: pU, vertexShader: particleVert, fragmentShader: particleFrag, transparent: true }));
  particles.frustumCulled = false; particles.renderOrder = 2;
  root.add(particles);

  // ---- holographic pedestal and soft light ----
  const ringU = { uTint: { value: new THREE.Color() }, time: { value: 0 }, uGlow: { value: 0.3 }, uOpacity: op };
  const ped = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.ShaderMaterial({ uniforms: ringU, vertexShader: uvVert, fragmentShader: ringFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ped.rotation.x = -Math.PI / 2 + 0.12; ped.position.y = -1.2; ped.renderOrder = 0;
  group.add(ped);
  const haloU = { color: { value: new THREE.Color() }, amount: { value: 0.12 }, uOpacity: op };
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), new THREE.ShaderMaterial({ uniforms: haloU, vertexShader: uvVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.z = -1.3; halo.renderOrder = 0;
  group.add(halo);
  const flashU = { color: { value: new THREE.Color(0.75, 0.9, 1.0) }, amount: { value: 0 }, uOpacity: op };
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.ShaderMaterial({ uniforms: flashU, vertexShader: uvVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.z = 0.8; flash.renderOrder = 5;
  group.add(flash);

  let state = "idle", severity = "none", driven = null, level = 0, speak = 0;
  let pointer = null, push = 0, scatter = 0;
  const tmpQ = new THREE.Quaternion(), pv = new THREE.Vector3();
  /** Screen point -> a direction on the orb (in the particles' own rotating frame), or null if off the orb. */
  function dirAt(x, y, reach = 1.6) {
    const o = world?.orbPlace; if (!o || o.size < 4) return null;
    const nx = (x - o.x) / (o.size / 2), ny = -(y - o.y) / (o.size / 2), r2 = nx * nx + ny * ny;
    if (r2 > reach * reach) return null;
    pv.set(nx, ny, Math.sqrt(Math.max(0, 1 - Math.min(1, r2)))).normalize();
    root.getWorldQuaternion(tmpQ); pv.applyQuaternion(tmpQ.invert());
    return { v: pv.clone(), r: Math.sqrt(r2) };
  }
  const onMove = (e) => { pointer = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onDown = (e) => { const h = dirAt(e.clientX, e.clientY, 1.05); if (h) { pU.uHit.value.copy(h.v); scatter = 1; } };
  let lookX = 0, lookY = 0, lookTX = 0, lookTY = 0, form = 0;
  const p = { hue: HUES.idle, turb: 0.05, swirl: 0, speak: 0, level: 0, breath: 0, frag: 0, glow: 0.3, sat: 0.35, spin: 0.08 };

  function targets() {
    let hue = HUES.idle, turb = 0.05, swirl = 0, glow = 0.3, frag = 0, sat = 0.35, spin = 0.08, breath = 0;
    if (state === "listening") { turb = 0.07 + level * 0.25; glow = 0.55 + level * 0.9; spin = 0.15; sat = 0.6; }
    else if (state === "thinking") { swirl = 0.9; glow = 0.6; spin = 0.12; sat = 0.55; }
    else if (state === "speaking") { glow = 0.45 + speak * 1.2; turb = 0.05 + speak * 0.1; spin = 0.1; sat = 0.55; }
    if (severity === "watch") { hue = HUES.watch; glow += 0.6; sat = 0.85; frag = 0.15; }
    if (state === "warning" || severity === "alert") { hue = HUES.alert; glow += 1.1; sat = 0.95; frag = 0.45; turb += 0.12; }
    if (driven) { hue = driven.hue; turb = 0.03 + driven.turbulence * 0.6; frag = driven.turbulence * 0.5; glow = 0.35 + driven.turbulence * 0.6; sat = 0.75; spin = 0.04 + (driven.rate ?? 1) * 0.08; breath = driven.breath ?? 0; }
    return { hue, turb, swirl, glow, frag, sat, spin, breath };
  }

  function update(dt, t) {
    const slow = reduced() ? 0.25 : 1;
    const tg = targets();
    const k = Math.min(1, dt * 2.4);
    const dh = ((tg.hue - p.hue + 540) % 360) - 180;
    p.hue = (p.hue + dh * Math.min(1, dt * 1.8) + 360) % 360;
    for (const key of ["turb", "swirl", "glow", "frag", "sat", "spin"]) p[key] += (tg[key] - p[key]) * k;
    p.breath += (tg.breath - p.breath) * Math.min(1, dt * 6);
    p.speak += ((state === "speaking" ? speak : 0) - p.speak) * Math.min(1, dt * 12);
    p.level += ((state === "listening" ? level : 0) - p.level) * Math.min(1, dt * 10);
    form = Math.min(1, form + dt * 0.8);
    lookX += (lookTX - lookX) * Math.min(1, dt * 2.5); lookY += (lookTY - lookY) * Math.min(1, dt * 2.5);
    root.rotation.y += dt * p.spin * slow; root.rotation.x = -lookY * 0.35; root.rotation.z = lookX * 0.12;
    pU.time.value = t * slow; pU.uTurb.value = p.turb; pU.uSwirl.value = p.swirl * slow; pU.uSpeak.value = p.speak; pU.uLevel.value = p.level;
    const sz = world?.orbPlace?.size ?? 300;
    pU.uSmall.value += (Math.max(0, Math.min(1, (190 - sz) / 110)) - pU.uSmall.value) * Math.min(1, dt * 4);
    ped.visible = pU.uSmall.value < 0.6;
    geo.instanceCount = pU.uSmall.value > 0.6 ? Math.round(N * 0.35) : N;   // docked small: a third of the particles is plenty
    pU.uBreath.value = p.breath; pU.uFrag.value = p.frag; pU.uGlow.value = p.glow;
    pU.uPulse.value = 0.94 + 0.06 * form + 0.008 * Math.sin(t * 1.2);
    pU.uTint.value.setHSL(p.hue / 360, p.sat, 0.6);
    ringU.uTint.value.setHSL(p.hue / 360, p.sat, 0.62); ringU.time.value = t; ringU.uGlow.value = p.glow;
    haloU.color.value.setHSL(p.hue / 360, p.sat * 0.8, 0.5); haloU.amount.value = 0.06 + p.glow * 0.08;
    if (flashU.amount.value > 0) flashU.amount.value = Math.max(0, flashU.amount.value - dt * 1.2);
    // pointer: particles near the cursor/finger bulge and light up; fades when the pointer rests or leaves
    const h = pointer && performance.now() - pointer.t < 2500 ? dirAt(pointer.x, pointer.y) : null;
    if (h) pU.uPoint.value.lerp(h.v, Math.min(1, dt * 12)).normalize();
    push += ((h && !reduced() ? Math.max(0, 1 - Math.max(0, h.r - 1) / 0.6) : 0) - push) * Math.min(1, dt * 5);
    pU.uPush.value = push;
    scatter = Math.max(0, scatter - dt * 0.9); pU.uScatter.value = reduced() ? 0 : scatter;
  }

  let world = null;
  return {
    group, update,
    attach(w) { world = w; w.setOrb(this); addEventListener("pointermove", onMove, { passive: true }); addEventListener("pointerdown", onDown, { passive: true }); },
    setOpacity(o) { op.value = o; },
    setState(s) { state = s; },
    getState: () => state,
    setSeverity(s) { severity = s || "none"; },
    drive(d) { driven = d ? { ...d } : null; },
    setLevel(v) { level = Math.max(0, Math.min(1, v)); },
    setSpeakLevel(v) { speak = Math.max(0, Math.min(1, v)); },
    look(nx, ny) { lookTX = nx; lookTY = ny; },
    /** The soft burst when the orb forms at the end of the intro: the particles gather in. */
    burst() { flashU.amount.value = 1.2; form = 0; },
    center() {
      const o = world?.orbPlace || { x: 0, y: 0, size: 0 };
      return { x: o.x, y: o.y, r: o.size / 2 };
    },
    probe: () => world?.probeOrb() ?? 0,
    destroy() { removeEventListener("pointermove", onMove); removeEventListener("pointerdown", onDown); },
  };
}

export const ORB_HUES = HUES;
