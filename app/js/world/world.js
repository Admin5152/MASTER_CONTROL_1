// The world (brief section 8): ONE full-screen three.js canvas behind the whole app. Every frame it
// composites three layers with one renderer and one bloom pass:
//   1. the sky: a deep-space gradient and the real starfield (follows the content camera's rotation)
//   2. the content scene: the intro solar system, space (Earth, Moon, Mars) or the body studio
//   3. Sentinel's orb, placed anywhere on screen in pixels
// Screens are camera moves and cross-fades inside this one world. Nothing 3D is drawn in a card.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export const isTablet = /Android|iPad|Tablet/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const skyVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const skyFrag = /* glsl */`
uniform float uClinic; uniform float uFade; uniform float uLight; varying vec2 vUv;
void main() {
  vec2 p = vUv - vec2(0.62, 0.78);
  float d = length(p * vec2(1.0, 1.3));
  vec3 space = mix(vec3(0.03, 0.06, 0.12), vec3(0.008, 0.011, 0.022), smoothstep(0.0, 0.95, d));
  vec2 q = vUv - vec2(0.5, 0.48);
  float e = length(q * vec2(1.2, 1.0));
  vec3 clinic = mix(vec3(0.11, 0.15, 0.24), vec3(0.03, 0.045, 0.085), smoothstep(0.0, 0.75, e));
  // Clinical light: soft white to pale blue-grey (refs 12-16)
  vec3 light = mix(vec3(0.96, 0.975, 0.99), vec3(0.83, 0.87, 0.92), smoothstep(0.0, 1.1, length((vUv - vec2(0.45, 0.62)) * vec2(1.0, 1.25))));
  vec3 dark = mix(space, clinic, uClinic) * uFade;
  // the X-ray dims uFade: in the light theme it also takes the sky to near-black, as in refs 09-11
  gl_FragColor = vec4(mix(dark, light, uLight * smoothstep(0.25, 1.0, uFade)), 1.0);
}`;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTablet, alpha: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Shader error checks read each program's status synchronously, which blocks on every link and defeats
  // parallel compilation (3.6 s of a 5.8 s stall opening Red Harvest). Errors still show with ?debug.
  renderer.debug.checkShaderErrors = /[?&]debug/.test(location.search);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); canvas.classList.add("is-lost"); });
  canvas.addEventListener("webglcontextrestored", () => canvas.classList.remove("is-lost"));
  const maxDpr = isTablet ? 1.25 : 1.5;
  const fpsCap = isTablet ? 30 : 60;
  const loader = new THREE.TextureLoader();
  let W = 1, H = 1;

  // ---- 1. sky: gradient + starfield ----
  const skyScene = new THREE.Scene();
  const skyCam = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const skyU = { uClinic: { value: 0 }, uFade: { value: 1 }, uLight: { value: 0 } };   // the intro is always in space; main.js applies the saved theme after Begin
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: skyVert, fragmentShader: skyFrag, depthWrite: false, depthTest: false }));
  sky.frustumCulled = false; sky.renderOrder = -10;
  skyScene.add(sky);
  const starTex = loader.load("assets/space/stars.jpg"); starTex.colorSpace = THREE.SRGBColorSpace;
  const starMat = new THREE.MeshBasicMaterial({ map: starTex, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0.85 });
  const starSphere = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), starMat);
  starSphere.renderOrder = -9;
  skyScene.add(starSphere);
  const nStar = isTablet ? 300 : 700;
  const sp = new Float32Array(nStar * 3), ss = new Float32Array(nStar);
  for (let i = 0; i < nStar; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(120); sp.set([v.x, v.y, v.z], i * 3); ss[i] = Math.random(); }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const starPts = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xe4ecff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false }));
  starPts.renderOrder = -8;
  skyScene.add(starPts);

  // ---- 3. orb layer ----
  const orbScene = new THREE.Scene();
  const orbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  orbCam.position.set(0, 0, 6.2);
  const orbHalf = 6.2 * Math.tan(THREE.MathUtils.degToRad(15));
  const orbPlace = { x: 0.5, y: 0.5, size: 0, opacity: 1 };     // x, y in px; size = sphere diameter in px
  let orbObj = null;

  // ---- composer ----
  const composer = new EffectComposer(renderer);
  const skyPass = new RenderPass(skyScene, skyCam);
  const mainPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  mainPass.clear = false; mainPass.clearDepth = true;
  const orbPass = new RenderPass(orbScene, orbCam);
  orbPass.clear = false; orbPass.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.78);
  composer.addPass(skyPass); composer.addPass(mainPass); composer.addPass(orbPass); composer.addPass(bloom); composer.addPass(new OutputPass());

  const scenes = new Map();
  let active = null;
  let paused = false, last = performance.now(), lastRender = 0, t = 0;
  const stats = { frames: 0, since: performance.now(), fps: 0, ms: [], msAvg: 0 };
  const hooks = new Set();

  // Automatic resolution: when frames run slow for 1.5 s the render resolution steps down; after 8 s of
  // headroom it steps back up. If stepping up made it slow again, that level becomes the ceiling.
  let quality = 1, qCap = 1, qSlow = 0, qFast = 0, qEma = 16.7, qLastRaf = 0, qRaised = false;
  function autoQuality(now) {
    const d = now - qLastRaf; qLastRaf = now;
    if (d <= 0 || d > 250) { qSlow = qFast = 0; return; }           // tab was hidden or a one-off stall
    qEma = qEma * 0.9 + d * 0.1;
    if (qEma > 23) { qSlow += d; qFast = 0; } else if (qEma < 17.6) { qFast += d; qSlow = 0; } else { qSlow = qFast = 0; }
    if (qSlow > 1500 && quality > 0.56) {
      if (qRaised) qCap = Math.max(0.55, quality - 0.15);
      quality = Math.max(0.55, quality - 0.15); qSlow = 0; qRaised = false; qEma = 16.7; resize();
    } else if (qFast > 8000 && quality < qCap - 0.01) {
      quality = Math.min(qCap, quality + 0.15); qFast = 0; qRaised = true; qEma = 16.7; resize();
    }
  }

  function resize() {
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, maxDpr) * quality);
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    composer.setPixelRatio(dpr); composer.setSize(W, H);
    bloom.resolution.set(W * dpr * (isTablet ? 0.5 : 0.75), H * dpr * (isTablet ? 0.5 : 0.75));
    skyCam.aspect = W / H; skyCam.updateProjectionMatrix();
    orbCam.aspect = W / H; orbCam.updateProjectionMatrix();
    for (const s of scenes.values()) s.resize?.(W, H);
  }
  window.addEventListener("resize", resize);

  function placeOrbCam() {
    // put the orb's centre at (x, y) px with the requested diameter
    orbCam.setViewOffset(W, H, W * 0.5 - orbPlace.x, H * 0.5 - orbPlace.y, W, H);
    if (orbObj) {
      const s = Math.max(0.0001, (orbPlace.size / H) * orbHalf);
      orbObj.group.scale.setScalar(s);
      orbObj.group.visible = orbPlace.size > 1 && orbPlace.opacity > 0.01;
      orbObj.setOpacity?.(orbPlace.opacity);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (paused || document.hidden || !active) { last = now; qLastRaf = 0; return; }
    autoQuality(now);
    if (now - lastRender < 1000 / fpsCap - 2) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; lastRender = now;
    t += dt * (reduced() ? 0.35 : 1);
    const s = scenes.get(active);
    const t0 = performance.now();
    s.update?.(dt, t);
    mainPass.scene = s.scene; mainPass.camera = s.camera;
    skyCam.quaternion.copy(s.camera.quaternion);
    starPts.material.opacity = (0.6 + 0.15 * Math.sin(t * 0.7)) * (1 - skyU.uClinic.value * 0.85) * (1 - skyU.uLight.value);
    starMat.opacity = 0.5 * (1 - skyU.uClinic.value) * (1 - skyU.uLight.value);
    orbObj?.update(dt, t);
    placeOrbCam();
    composer.render(dt);
    for (const fn of hooks) { try { fn(s, W, H); } catch (e) { console.warn("world hook", e); } }
    const ms = performance.now() - t0;
    stats.frames++; stats.ms.push(ms); if (stats.ms.length > 120) stats.ms.shift();
    if (now - stats.since > 1000) {
      stats.fps = (stats.frames * 1000) / (now - stats.since);
      stats.msAvg = stats.ms.reduce((a, b) => a + b, 0) / stats.ms.length;
      stats.frames = 0; stats.since = now;
    }
  }

  const world = {
    renderer, THREE, isTablet, loader,
    get size() { return { W, H }; },
    get active() { return active; },
    add(name, def) { scenes.set(name, def); def.resize?.(W, H); return def; },
    get(name) { return scenes.get(name); },
    remove(name) { const s = scenes.get(name); if (!s || name === active) return; scenes.delete(name); s.dispose?.(); },
    /** Show a content scene, cross-fading through the sky. */
    async show(name, { fade = true } = {}) {
      if (name === active || !scenes.has(name)) return;
      const prev = active;
      const g = window.gsap;
      if (prev && fade && g && !reduced()) await new Promise((r) => g.to(canvas, { opacity: 0, duration: 0.35, ease: "power2.in", onComplete: r }));
      if (prev) scenes.get(prev).onHide?.();
      active = name;
      scenes.get(name).onShow?.();
      if (prev && fade && g && !reduced()) g.to(canvas, { opacity: 1, duration: 0.55, ease: "power2.out" });
      else canvas.style.opacity = "1";
    },
    /** 0 = deep space sky, 1 = the body screen's navy studio glow. */
    setClinic(v, seconds = 0.9) {
      const g = window.gsap;
      if (!g || reduced()) skyU.uClinic.value = v;
      else g.to(skyU.uClinic, { value: v, duration: seconds, ease: "power2.inOut", overwrite: true });
    },
    setOrb(obj) { orbObj = obj; orbScene.add(obj.group); },
    /** Move the orb: centre (x, y) in px and sphere diameter in px; eased. */
    orbTo({ x, y, size, opacity = 1 }, seconds = 0.9, ease = "power3.inOut") {
      const g = window.gsap;
      const to = { x, y, size, opacity };
      if (!g || reduced() || seconds === 0) { Object.assign(orbPlace, to); return Promise.resolve(); }
      return new Promise((r) => g.to(orbPlace, { ...to, duration: seconds, ease, overwrite: true, onComplete: r, onInterrupt: r }));
    },
    get orbPlace() { return { ...orbPlace }; },
    /** Compile a scene's shaders in the background, exactly as the composer will draw it (into its offscreen
     *  target: a different target changes the shader and wastes the compile). Resolves when ready. */
    async compileAsync(scene, camera) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(composer.readBuffer);
      let job;
      try { job = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera)); }
      finally { renderer.setRenderTarget(prev); }
      return job;
    },
    setBloom(strength) { bloom.strength = strength; bloom.enabled = strength > 0.001; },   // a zero-strength bloom is skipped, not drawn
    get bloomBase() { return skyU.uLight.value > 0.5 ? 0 : 0.85; },
    /** 1 = the full sky, 0 = black: the X-ray reads on near-black (refs 09-11). Set every frame by the body. */
    setSkyFade(v) { skyU.uFade.value = v; },
    /** "dark" (space, the default) or "light" (Clinical light). Eased. */
    setTheme(theme, seconds = 0.6) {
      const v = theme === "light" ? 1 : 0;
      const g = window.gsap;
      if (!g || reduced()) skyU.uLight.value = v; else g.to(skyU.uLight, { value: v, duration: seconds, overwrite: true });
      bloom.strength = v ? 0 : 0.85;   // a pale sky would bloom over everything
    },
    get theme() { return skyU.uLight.value > 0.5 ? "light" : "dark"; },
    pause(p) { paused = !!p; },
    onFrame(fn) { hooks.add(fn); return () => hooks.delete(fn); },
    stats: () => ({ fps: Math.round(stats.fps * 10) / 10, msAvg: Math.round(stats.msAvg * 100) / 100, cap: fpsCap, dpr: renderer.getPixelRatio(), quality, active }),
    /** Mean brightness (0-255) of a 9x9 grid of the next frame, to prove the world is not black. */
    probe() {
      const gl = renderer.getContext();
      const w = renderer.domElement.width, h = renderer.domElement.height, px = new Uint8Array(4);
      composer.render(0);
      let sum = 0, n = 0;
      for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
        gl.readPixels(Math.floor((w * i) / 10), Math.floor((h * j) / 10), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        sum += (px[0] + px[1] + px[2]) / 3; n++;
      }
      return sum / n;
    },
    /** Brightness at the orb's centre, to prove the orb renders. */
    probeOrb() {
      const gl = renderer.getContext(), px = new Uint8Array(4), dpr = renderer.getPixelRatio();
      composer.render(0);
      let sum = 0, n = 0;
      const r = orbPlace.size * 0.48 * dpr;
      for (let a = 0; a < 16; a++) {
        const x = Math.round(orbPlace.x * dpr + Math.cos(a / 16 * Math.PI * 2) * r), y = Math.round((H - orbPlace.y) * dpr + Math.sin(a / 16 * Math.PI * 2) * r);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); sum += (px[0] + px[1] + px[2]) / 3; n++;
      }
      return sum / n;
    },
  };
  resize();
  requestAnimationFrame(frame);
  return world;
}
