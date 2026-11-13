// The orb (ref 01): a glossy dark glass sphere with a fresnel rim, three animated light ribbons
// sweeping around it, and bloom. Its own small renderer, drawn on black and blended with
// `mix-blend-mode: screen`, so it can sit over the deep-space window or the dock porthole.
// API (kept from v1): setState('idle'|'listening'|'thinking'|'speaking'|'warning'), getState(),
// setSeverity('none'|'info'|'watch'|'alert'), drive({turbulence, hue, rate}) for Orb Calm (null releases),
// setLevel(0..1) microphone level, setSpeakLevel(0..1) TTS audio level, look(nx, ny), center(), destroy().
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const HUES = { idle: 210, calm: 214, watch: 36, alert: 356 };

const sphereVert = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const sphereFrag = /* glsl */`
uniform vec3 rimColor; uniform float intensity; uniform float time;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float f = 1.0 - max(dot(n, v), 0.0);
  float rim = pow(f, 3.0) * intensity;
  vec3 L = normalize(vec3(-0.55, 0.75, 0.55));
  float spec = pow(max(dot(reflect(-L, n), v), 0.0), 36.0) * 0.5;
  float swirl = 0.5 + 0.5 * sin(vP.y * 5.0 + time * 0.6 + sin(vP.x * 4.0 + time * 0.4) * 1.5);
  vec3 base = vec3(0.003, 0.006, 0.016) + rimColor * (0.03 + 0.035 * swirl) * smoothstep(0.2, -1.0, vP.y);
  gl_FragColor = vec4(base + rimColor * rim + vec3(spec) * (0.6 + 0.4 * intensity), 1.0);
}`;
const ribbonVert = /* glsl */`
uniform float time; uniform float turb; uniform float tight; uniform float phase;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position * tight + normal * turb * 0.09 * sin(uv.x * 22.0 + time * 3.1 + phase) ;
  p += normalize(position) * turb * 0.06 * sin(uv.x * 9.0 - time * 1.7 + phase * 2.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const ribbonFrag = /* glsl */`
uniform vec3 color; uniform float bright; uniform float time; uniform float speed; uniform float phase;
varying vec2 vUv;
void main() {
  float along = vUv.x;
  float ends = smoothstep(0.0, 0.18, along) * smoothstep(1.0, 0.62, along);
  float wave = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(along * 11.0 - time * speed + phase), 2.0);
  float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
  gl_FragColor = vec4(color * bright * ends * wave * (0.55 + 0.45 * core), 1.0);
}`;

function ribbonCurve(seed, tilt, arc = 1.7) {
  const pts = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * arc;
    const r = 1.025 + 0.035 * Math.sin(a * 3 + seed) + 0.02 * Math.sin(a * 7 + seed * 2);
    const y = Math.sin(a * 1.0 + seed) * 0.18;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  // curl the tail outward a little (the flourish in ref 01)
  const last = pts[pts.length - 1];
  pts.push(last.clone().multiplyScalar(1.07).add(new THREE.Vector3(0, -0.08, 0)));
  const curve = new THREE.CatmullRomCurve3(pts);
  const m = new THREE.Matrix4().makeRotationFromEuler(tilt);
  curve.points.forEach((p) => p.applyMatrix4(m));
  return curve;
}

export function createOrb(canvas, { tablet = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 1);
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); canvas.classList.add("is-lost"); });
  canvas.addEventListener("webglcontextrestored", () => canvas.classList.remove("is-lost"));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const dpr = Math.min(window.devicePixelRatio || 1, tablet ? 1.5 : 2);
  const fpsCap = tablet ? 30 : 60;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 6.2);
  const root = new THREE.Group();
  scene.add(root);

  const sphereU = { rimColor: { value: new THREE.Color() }, intensity: { value: 1.2 }, time: { value: 0 } };
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({ uniforms: sphereU, vertexShader: sphereVert, fragmentShader: sphereFrag }));
  root.add(sphere);

  const ribbons = [];
  const defs = [
    { seed: 0.3, tilt: new THREE.Euler(0.35, 0.2, 0.85), arc: 1.75, speed: 0.22, r: 0.016 },
    { seed: 2.1, tilt: new THREE.Euler(-0.6, 1.1, -0.35), arc: 1.45, speed: -0.17, r: 0.012 },
    { seed: 4.0, tilt: new THREE.Euler(1.25, -0.5, 0.2), arc: 1.3, speed: 0.13, r: 0.01 },
  ];
  defs.forEach((d, i) => {
    const u = { color: { value: new THREE.Color() }, bright: { value: 1 }, time: { value: 0 }, speed: { value: 1.4 }, phase: { value: i * 2.1 }, turb: { value: 0.05 }, tight: { value: 1 } };
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(ribbonCurve(d.seed, d.tilt, d.arc), 220, d.r, 8, false),
      new THREE.ShaderMaterial({ uniforms: u, vertexShader: ribbonVert, fragmentShader: ribbonFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const pivot = new THREE.Group();
    pivot.add(mesh);
    pivot.rotation.set(d.seed * 0.3, d.seed, 0);
    root.add(pivot);
    ribbons.push({ pivot, u, speed: d.speed, axis: new THREE.Vector3(Math.sin(d.seed), 1, Math.cos(d.seed)).normalize() });
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1.15, 0.65, 0.08);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let size = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const s = Math.max(64, Math.round(Math.max(r.width, r.height)));
    if (s === size) return;
    size = s;
    renderer.setPixelRatio(dpr);
    renderer.setSize(s, s, false);
    composer.setPixelRatio(dpr);
    composer.setSize(s, s);
    bloom.resolution.set(s * dpr, s * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let state = "idle", severity = "none", driven = null, level = 0, speak = 0;
  let lookX = 0, lookY = 0, lookTX = 0, lookTY = 0;
  const p = { hue: HUES.idle, rim: 1.2, bright: 1, speed: 1, tight: 1, turb: 0.05, spin: 1, pulse: 1 };
  let t = 0, last = performance.now(), lastRender = 0, running = true, visible = true;
  const tmpC = new THREE.Color();

  function targets() {
    let hue = HUES.idle, rim = 1.15, bright = 1.0, speed = 1.3, tight = 1, turb = 0.04, spin = 1;
    if (state === "listening") { rim = 1.3 + level * 1.4; bright = 1.25 + level * 2.2; speed = 2.4 + level * 4; spin = 1.8 + level * 2; turb = 0.05 + level * 0.25; }
    else if (state === "thinking") { tight = 0.965; spin = 3.2; speed = 3.2; bright = 1.2; rim = 1.25; }
    else if (state === "speaking") { rim = 1.1 + speak * 1.6; bright = 1.05 + speak * 1.8; speed = 1.8; spin = 1.3; turb = 0.04 + speak * 0.12; }
    if (severity === "watch") { hue = HUES.watch; rim += 0.2; }
    if (state === "warning" || severity === "alert") { hue = HUES.alert; rim += 0.35; spin *= 1.4; turb += 0.1; }
    if (driven) { hue = driven.hue; turb = 0.03 + driven.turbulence * 0.9; spin = 0.6 + (driven.rate ?? 1) * 1.1; speed = 1 + (driven.rate ?? 1) * 1.5; rim = 1.1 + driven.turbulence * 1.2; }
    return { hue, rim, bright, speed, tight, turb, spin };
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!visible || document.hidden) { last = now; return; }
    if (now - lastRender < 1000 / fpsCap - 2) return;
    lastRender = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const slow = reduced() ? 0.3 : 1;
    t += dt * slow;
    const tg = targets();
    const k = Math.min(1, dt * 3);
    const dh = ((tg.hue - p.hue + 540) % 360) - 180;
    p.hue = (p.hue + dh * Math.min(1, dt * 2) + 360) % 360;
    for (const key of ["rim", "bright", "speed", "tight", "turb", "spin"]) p[key] += (tg[key] - p[key]) * k;
    const pulseT = state === "speaking" ? 1 + speak * 0.07 : 1 + 0.012 * Math.sin(t * 1.4);
    p.pulse += (pulseT - p.pulse) * Math.min(1, dt * 12);
    root.scale.setScalar(p.pulse);
    lookX += (lookTX - lookX) * Math.min(1, dt * 3); lookY += (lookTY - lookY) * Math.min(1, dt * 3);
    root.rotation.y = lookX * 0.5; root.rotation.x = -lookY * 0.4;
    // colours: rim blue-white, ribbons lighter
    sphereU.rimColor.value.setHSL(p.hue / 360, 0.85, 0.58);
    sphereU.intensity.value = p.rim;
    sphereU.time.value = t;
    tmpC.setHSL(p.hue / 360, 0.95, 0.72);
    for (const r of ribbons) {
      r.pivot.rotateOnAxis(r.axis, r.speed * p.spin * dt * slow);
      r.u.time.value = t; r.u.speed.value = p.speed; r.u.bright.value = p.bright; r.u.turb.value = p.turb; r.u.tight.value = p.tight;
      r.u.color.value.copy(tmpC);
    }
    composer.render();
  }
  requestAnimationFrame(frame);

  return {
    setState(s) { state = s; },
    getState: () => state,
    setSeverity(s) { severity = s || "none"; },
    drive(d) { driven = d ? { ...d } : null; },
    setLevel(v) { level = Math.max(0, Math.min(1, v)); },
    setSpeakLevel(v) { speak = Math.max(0, Math.min(1, v)); },
    look(nx, ny) { lookTX = nx; lookTY = ny; },
    setVisible(v) { visible = !!v; },
    center() {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width * 0.31 };
    },
    /** Mean brightness of the centre of the last frame (0-255), to prove it renders. */
    probe() {
      composer.render();
      const gl = renderer.getContext();
      const w = renderer.domElement.width, px = new Uint8Array(4);
      let sum = 0, n = 0;
      for (let i = 2; i <= 8; i++) for (let j = 2; j <= 8; j++) {
        gl.readPixels(Math.floor((w * i) / 10), Math.floor((w * j) / 10), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        sum += (px[0] + px[1] + px[2]) / 3; n++;
      }
      return sum / n;
    },
    destroy() { running = false; ro.disconnect(); renderer.dispose(); },
  };
}

export const ORB_HUES = HUES;
