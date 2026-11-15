// The cinematic intro (brief section 8 item 5): the camera looks down on the solar system and sweeps
// in; then the planets dim and drift outward, a point of light appears at the centre and Sentinel's orb
// forms there.
// Real data: each planet starts where it really is in its orbit today (mean longitude from J2000 orbital
// elements, NASA/JPL "Approximate Positions of the Planets"; circular orbits), and the planets move at
// their real speeds relative to each other (real orbital periods). Distances and sizes are artistic so
// everything fits on screen. The Sun has animated granulation and a corona; every planet with an
// atmosphere has a glowing limb; Earth has clouds and city lights; the asteroid and Kuiper belts are there.
import * as THREE from "three";

const TEX = "assets/space/";
// name, radius, orbit distance, period (Earth years), texture, axial tilt, mean longitude at J2000 (deg),
// rate (deg/day), atmosphere colour (or null)
const PLANETS = [
  ["mercury", 0.22, 4.2, 0.2408, "mercury.jpg", 0.0, 252.25, 4.09233, null],
  ["venus", 0.38, 5.9, 0.6152, "venus.jpg", 0.05, 181.98, 1.60213, 0xffd9a0],
  ["earth", 0.42, 8.0, 1.0, "earth_day.jpg", 0.41, 100.46, 0.98561, 0x6fb2ff],
  ["mars", 0.3, 10.2, 1.8809, "mars.jpg", 0.44, 355.45, 0.52403, 0xff9a6a],
  ["jupiter", 1.05, 14.0, 11.862, "jupiter.jpg", 0.05, 34.40, 0.08309, 0xffd2a0],
  ["saturn", 0.88, 18.6, 29.457, "saturn.jpg", 0.47, 49.94, 0.03346, 0xf3e0b0],
  ["uranus", 0.6, 22.6, 84.011, "uranus.jpg", 1.7, 313.23, 0.01173, 0x9fe8ff],
  ["neptune", 0.58, 26.2, 164.79, "neptune.jpg", 0.49, 304.88, 0.00598, 0x6f8fff],
];
const EARTH_SPEED = 0.36;   // rad/s on screen; every other planet keeps its real ratio to Earth
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const glowVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const glowFrag = /* glsl */`
uniform vec3 color; uniform float amount; varying vec2 vUv;
void main() { vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float g = (exp(-r * r * 5.0) + 0.35 * exp(-r * 2.6)) * smoothstep(1.0, 0.55, r);
  gl_FragColor = vec4(color * g * amount, 1.0); }`;
// the Sun's corona: a camera-facing disc with flickering streamers
const coronaFrag = /* glsl */`
uniform float time, amount; varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = (vUv - 0.5) * 2.0; float r = length(p), a = atan(p.y, p.x);
  float streak = n(vec2(a * 6.0, time * 0.25)) * 0.6 + n(vec2(a * 17.0, time * 0.6)) * 0.4;
  float rim = smoothstep(0.28, 0.3, r);
  float c = rim * exp(-(r - 0.3) * (5.0 - streak * 2.6)) * (0.65 + streak * 0.7) + (1.0 - rim) * 0.65;   // filled centre: no hollow ring
  vec3 col = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.9, 0.7), exp(-(r - 0.3) * 6.0));
  gl_FragColor = vec4(col * c * amount * smoothstep(1.0, 0.7, r), 1.0); }`;
// orbit line that glows brightest just behind its planet
const orbitVert = `attribute float aAng; varying float vAng; void main() { vAng = aAng; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const orbitFrag = /* glsl */`
uniform float uPlanet, uDim; uniform vec3 color; varying float vAng;
void main() { float d = mod(uPlanet - vAng + 6.28318, 6.28318); float trail = exp(-d * 1.6);
  gl_FragColor = vec4(color * (0.10 + 0.75 * trail) * uDim, 1.0); }`;
const atmoVert = "varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }";
const atmoFrag = "uniform vec3 c; uniform float uDim; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(c * f * 0.75 * uDim, 1.0); }";

/** Where a planet is today in its orbit (radians), from its J2000 mean longitude. */
export function longitudeToday(L0, rate, ms = Date.now()) {
  const days = (ms - Date.UTC(2000, 0, 1, 12)) / 86400000;
  return (((L0 + rate * days) % 360) + 360) % 360 * Math.PI / 180;
}

export function createIntro(world) {
  const renderer = world.renderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  const loader = world.loader;
  const tex = (n, srgb = true) => { const t = loader.load(TEX + n); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); return t; };

  scene.add(new THREE.AmbientLight(0x404a60, 0.3));
  const sunLight = new THREE.PointLight(0xfff1dc, 5.5, 0, 0);
  scene.add(sunLight);

  // the Sun: a textured sphere with moving granulation, a soft glow and a flickering corona
  const sunU = { map: { value: tex("sun.jpg") }, time: { value: 0 }, uFade: { value: 1 } };
  const sunMat = new THREE.ShaderMaterial({ uniforms: sunU, transparent: true,
    vertexShader: "varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform sampler2D map; uniform float time, uFade; varying vec2 vUv; varying vec3 vN;
      void main(){ vec2 uv = vUv + vec2(time * 0.004, 0.0) + 0.004 * vec2(sin(vUv.y * 40.0 + time), cos(vUv.x * 40.0 - time));
        vec3 c = texture2D(map, uv).rgb * vec3(2.4, 1.75, 1.05);
        float limb = pow(max(dot(normalize(vN), vec3(0.0, 0.0, 1.0)), 0.0), 0.45);   // limb darkening
        gl_FragColor = vec4(c * (0.55 + 0.45 * limb), uFade); }` });   // fades to clear, never to a dark disc
  sunMat.depthWrite = false;
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.9, 64, 32), sunMat);
  scene.add(sun);
  const sunGlowU = { color: { value: new THREE.Color(1.0, 0.62, 0.25) }, amount: { value: 1.0 } };
  const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShaderMaterial({ uniforms: sunGlowU, vertexShader: glowVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(sunGlow);
  const coronaU = { time: { value: 0 }, amount: { value: 1 } };
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), new THREE.ShaderMaterial({ uniforms: coronaU, vertexShader: glowVert, fragmentShader: coronaFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(corona);
  // the point of light where Sentinel forms
  const sparkU = { color: { value: new THREE.Color(0.6, 0.85, 1.0) }, amount: { value: 0 } };
  const spark = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShaderMaterial({ uniforms: sparkU, vertexShader: glowVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(spark);

  const tl = { spread: 1, dim: 1, sunFade: 1, camT: 0 };
  const dimU = { value: 1 };
  const bodies = [];
  const system = new THREE.Group();
  scene.add(system);
  for (const [name, r, dist, period, file, tilt, L0, rate, atmo] of PLANETS) {
    // orbit line with a glowing trail behind the planet
    const N = 256, pos = new Float32Array((N + 1) * 3), ang = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2; pos.set([Math.cos(a) * dist, 0, Math.sin(a) * dist], i * 3); ang[i] = a; }
    const og = new THREE.BufferGeometry(); og.setAttribute("position", new THREE.BufferAttribute(pos, 3)); og.setAttribute("aAng", new THREE.BufferAttribute(ang, 1));
    const orbitU = { uPlanet: { value: 0 }, uDim: dimU, color: { value: new THREE.Color(atmo ?? 0xb8c6e0).lerp(new THREE.Color(0xffffff), 0.35) } };
    const orbit = new THREE.Line(og, new THREE.ShaderMaterial({ uniforms: orbitU, vertexShader: orbitVert, fragmentShader: orbitFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    system.add(orbit);
    const mat = new THREE.MeshStandardMaterial({ map: tex(file), roughness: 1, metalness: 0, transparent: true });
    if (name === "earth") { mat.emissiveMap = tex("earth_night.jpg"); mat.emissive = new THREE.Color(0xffd9a0); mat.emissiveIntensity = 0.7; }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), mat);
    const holder = new THREE.Group();
    holder.add(mesh);
    mesh.rotation.z = tilt;
    system.add(holder);
    const b = { name, r, dist, speed: EARTH_SPEED / period, a: -longitudeToday(L0, rate), holder, mesh, mats: [mat], orbitU };
    if (atmo) {
      const a = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 32, 16), new THREE.ShaderMaterial({ uniforms: { c: { value: new THREE.Color(atmo) }, uDim: dimU }, vertexShader: atmoVert, fragmentShader: atmoFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
      holder.add(a);
    }
    if (name === "saturn") {
      const inner = r * 1.25, outer = r * 2.3;
      const g = new THREE.RingGeometry(inner, outer, 128, 1);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (d - inner) / (outer - inner), 0.5); }
      const rm = new THREE.MeshStandardMaterial({ map: tex("saturn_ring.png"), side: THREE.DoubleSide, transparent: true, roughness: 1, depthWrite: false });
      const ring = new THREE.Mesh(g, rm);
      ring.rotation.x = -Math.PI / 2 + 0.12; ring.rotation.y = 0.35;
      holder.add(ring);
      b.mats.push(rm);
    }
    if (name === "earth") {
      const cm = new THREE.MeshStandardMaterial({ map: tex("earth_clouds.jpg"), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(r * 1.015, 48, 24), cm); clouds.rotation.z = tilt; holder.add(clouds); b.clouds = clouds; b.mats.push(cm);
      const mm = new THREE.MeshStandardMaterial({ map: tex("moon.jpg"), roughness: 1, transparent: true });
      const moon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 12), mm);
      holder.add(moon);
      b.moon = moon; b.mats.push(mm);
    }
    bodies.push(b);
  }
  // the asteroid belt (between Mars and Jupiter) and a faint Kuiper belt beyond Neptune
  const belts = [];
  for (const [n, r0, r1, size, color, op] of [[world.isTablet ? 1400 : 2600, 11.4, 12.9, 0.06, 0xc9b9a6, 0.75], [world.isTablet ? 900 : 1800, 28.5, 33, 0.05, 0x9fb0d0, 0.35]]) {
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = r0 + Math.random() * (r1 - r0); p.set([Math.cos(a) * d, (Math.random() - 0.5) * 0.35, Math.sin(a) * d], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity: op, depthWrite: false });
    const pts = new THREE.Points(g, m); system.add(pts); belts.push({ pts, m, op, speed: n > 2000 ? 0.05 : 0.01 });
  }

  // camera path: high overhead -> a low, sweeping three-quarter view
  const camA = new THREE.Vector3(0, 70, 6), camB = new THREE.Vector3(-18, 11, 29), look = new THREE.Vector3(0, 0, 0);
  const camP = new THREE.Vector3();
  let W = 1, H = 1;

  function update(dt, t) {
    for (const b of bodies) {
      b.a -= b.speed * dt * 0.6;                         // counter-clockwise seen from above, like the real system
      const d = b.dist * tl.spread;
      b.holder.position.set(Math.cos(b.a) * d, 0, Math.sin(b.a) * d);
      b.mesh.rotation.y += dt * 0.4;
      if (b.clouds) b.clouds.rotation.y += dt * 0.5;
      if (b.moon) b.moon.position.set(Math.cos(t * 1.2) * 0.85, 0.05, Math.sin(t * 1.2) * 0.85);
      for (const m of b.mats) m.opacity = m === b.clouds?.material ? 0.7 * tl.dim : tl.dim;
      b.orbitU.uPlanet.value = ((b.a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    }
    system.children.forEach((c) => { if (c.isLine) c.scale.setScalar(tl.spread); });
    dimU.value = tl.dim;
    for (const bl of belts) { bl.pts.rotation.y -= dt * bl.speed; bl.pts.scale.setScalar(tl.spread); bl.m.opacity = bl.op * tl.dim; }
    sunU.time.value = t; sunU.uFade.value = tl.sunFade;
    sun.scale.setScalar(0.35 + 0.65 * tl.sunFade);
    sunGlowU.amount.value = 0.9 * tl.sunFade;
    coronaU.time.value = t; coronaU.amount.value = 0.9 * tl.sunFade; corona.scale.copy(sun.scale);
    sunLight.intensity = 5.5 * Math.max(0.2, tl.sunFade);
    const e = tl.camT * tl.camT * (3 - 2 * tl.camT);
    camP.lerpVectors(camA, camB, e);
    const orbitA = t * 0.03;
    camera.position.set(camP.x * Math.cos(orbitA) - camP.z * Math.sin(orbitA), camP.y, camP.x * Math.sin(orbitA) + camP.z * Math.cos(orbitA));
    camera.lookAt(look);
    sunGlow.quaternion.copy(camera.quaternion);
    corona.quaternion.copy(camera.quaternion);
    spark.quaternion.copy(camera.quaternion);
  }
  function resize(w, h) { W = w; H = h; camera.aspect = w / h; camera.updateProjectionMatrix(); }

  /** Play the intro. onForm() is called when the orb should form at the centre. Returns a stop fn. */
  function run({ onForm, onDone }) {
    const g = window.gsap;
    const short = reduced();
    const tlx = g.timeline({ onComplete: () => onDone?.() });
    tlx.to(tl, { camT: 1, duration: short ? 1.2 : 6.2, ease: "sine.inOut" });
    tlx.to(tl, { spread: 2.6, dim: 0.0, duration: short ? 0.6 : 2.2, ease: "power2.in" }, short ? 0.9 : 5.4);
    tlx.to(tl, { sunFade: 0, duration: short ? 0.5 : 1.6, ease: "power2.inOut" }, short ? 1.0 : 6.0);
    tlx.to(sparkU.amount, { value: 2.2, duration: short ? 0.3 : 0.9, ease: "power2.in" }, short ? 1.1 : 6.6);
    tlx.call(() => onForm?.(), null, short ? 1.4 : 7.4);
    tlx.to(sparkU.amount, { value: 0, duration: 1.0, ease: "power2.out" }, short ? 1.4 : 7.5);
    if (!short) tlx.timeScale(1.55);   // the same choreography, quicker: Begin appears in about 5 s, not 9
    return {
      skip() { tlx.progress(1); },
      get done() { return tlx.progress() >= 1; },
    };
  }

  /** Free the intro's GPU memory once Sentinel has formed (textures, geometry). */
  function dispose() {
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { m.map?.dispose?.(); m.dispose?.(); }
    });
  }

  return { scene, camera, update, resize, run, bodies, dispose };
}
