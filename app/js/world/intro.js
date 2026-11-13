// The cinematic intro (brief section 8 item 5): the camera looks down on the solar system, real
// textures, the Sun glowing at the centre, planets revolving on faint orbit lines at different speeds.
// It sweeps in over about six seconds; then the planets dim and drift outward, a point of light
// appears at the centre and Sentinel's orb forms there. Scale and speeds are artistic.
import * as THREE from "three";

const TEX = "assets/space/";
// name, radius, orbit distance, angular speed (rad/s), texture, axial tilt
const PLANETS = [
  ["mercury", 0.22, 4.2, 0.62, "mercury.jpg", 0.0],
  ["venus", 0.38, 5.9, 0.46, "venus.jpg", 0.05],
  ["earth", 0.42, 8.0, 0.36, "earth_day.jpg", 0.41],
  ["mars", 0.3, 10.2, 0.28, "mars.jpg", 0.44],
  ["jupiter", 1.05, 14.0, 0.16, "jupiter.jpg", 0.05],
  ["saturn", 0.88, 18.6, 0.12, "saturn.jpg", 0.47],
  ["uranus", 0.6, 22.6, 0.085, "uranus.jpg", 1.7],
  ["neptune", 0.58, 26.2, 0.065, "neptune.jpg", 0.49],
];
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const glowVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const glowFrag = /* glsl */`
uniform vec3 color; uniform float amount; varying vec2 vUv;
void main() { vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float g = (exp(-r * r * 5.0) + 0.35 * exp(-r * 2.6)) * smoothstep(1.0, 0.55, r);
  gl_FragColor = vec4(color * g * amount, 1.0); }`;

export function createIntro(world) {
  const renderer = world.renderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  const loader = world.loader;
  const tex = (n, srgb = true) => { const t = loader.load(TEX + n); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); return t; };

  scene.add(new THREE.AmbientLight(0x404a60, 0.35));
  const sunLight = new THREE.PointLight(0xfff1dc, 5.5, 0, 0);
  scene.add(sunLight);

  // the Sun: bright textured sphere (blooms) plus a camera-facing glow
  const sunMat = new THREE.MeshBasicMaterial({ map: tex("sun.jpg"), color: new THREE.Color(2.2, 1.7, 1.1), transparent: true });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.9, 64, 32), sunMat);
  scene.add(sun);
  const sunGlowU = { color: { value: new THREE.Color(1.0, 0.62, 0.25) }, amount: { value: 1.0 } };
  const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShaderMaterial({ uniforms: sunGlowU, vertexShader: glowVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(sunGlow);
  // the point of light where Sentinel forms
  const sparkU = { color: { value: new THREE.Color(0.6, 0.85, 1.0) }, amount: { value: 0 } };
  const spark = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShaderMaterial({ uniforms: sparkU, vertexShader: glowVert, fragmentShader: glowFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(spark);

  const orbitMat = new THREE.LineBasicMaterial({ color: 0x9fb8e6, transparent: true, opacity: 0.16, depthWrite: false });
  const bodies = [];
  const system = new THREE.Group();
  scene.add(system);
  for (const [name, r, dist, speed, file, tilt] of PLANETS) {
    const pts = [];
    for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * dist, 0, Math.sin(a) * dist)); }
    const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), orbitMat);
    system.add(orbit);
    const mat = new THREE.MeshStandardMaterial({ map: tex(file), roughness: 1, metalness: 0, transparent: true });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), mat);
    const holder = new THREE.Group();
    holder.add(mesh);
    mesh.rotation.z = tilt;
    system.add(holder);
    const b = { name, r, dist, speed, a: Math.random() * Math.PI * 2, holder, mesh, mats: [mat], orbit };
    if (name === "saturn") {
      // ring: map the strip texture radially (u = inner -> outer)
      const inner = r * 1.25, outer = r * 2.3;
      const g = new THREE.RingGeometry(inner, outer, 128, 1);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) { const d = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (d - inner) / (outer - inner), 0.5); }
      const rm = new THREE.MeshStandardMaterial({ map: tex("saturn_ring.png"), side: THREE.DoubleSide, transparent: true, roughness: 1, depthWrite: false });
      const ring = new THREE.Mesh(g, rm);
      ring.rotation.x = -Math.PI / 2 + 0.12;
      ring.rotation.y = 0.35;
      holder.add(ring);
      b.mats.push(rm);
    }
    if (name === "earth") {
      const mm = new THREE.MeshStandardMaterial({ map: tex("moon.jpg"), roughness: 1, transparent: true });
      const moon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 12), mm);
      holder.add(moon);
      b.moon = moon; b.mats.push(mm);
    }
    bodies.push(b);
  }

  // timeline state (tweened by run())
  const tl = { spread: 1, dim: 1, sunFade: 1, camT: 0 };
  // camera path: high overhead -> a low, sweeping three-quarter view
  const camA = new THREE.Vector3(0, 70, 6), camB = new THREE.Vector3(-18, 12, 30), look = new THREE.Vector3(0, 0, 0);
  const camP = new THREE.Vector3();
  let W = 1, H = 1;

  function update(dt, t) {
    for (const b of bodies) {
      b.a += b.speed * dt * 0.6;
      const d = b.dist * tl.spread;
      b.holder.position.set(Math.cos(b.a) * d, 0, Math.sin(b.a) * d);
      b.mesh.rotation.y += dt * 0.4;
      if (b.moon) b.moon.position.set(Math.cos(t * 1.2) * 0.85, 0.05, Math.sin(t * 1.2) * 0.85);
      for (const m of b.mats) m.opacity = tl.dim;
      b.orbit.scale.setScalar(tl.spread);
    }
    orbitMat.opacity = 0.16 * tl.dim;
    sun.rotation.y += dt * 0.05;
    sunMat.opacity = tl.sunFade;
    sun.scale.setScalar(0.35 + 0.65 * tl.sunFade);
    sunGlowU.amount.value = 0.9 * tl.sunFade;
    sunLight.intensity = 5.5 * Math.max(0.2, tl.sunFade);
    const e = tl.camT * tl.camT * (3 - 2 * tl.camT);
    camP.lerpVectors(camA, camB, e);
    const orbitA = t * 0.03;
    camera.position.set(camP.x * Math.cos(orbitA) - camP.z * Math.sin(orbitA), camP.y, camP.x * Math.sin(orbitA) + camP.z * Math.cos(orbitA));
    camera.lookAt(look);
    sunGlow.quaternion.copy(camera.quaternion);
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
    return {
      skip() { tlx.progress(1); },
      get done() { return tlx.progress() >= 1; },
    };
  }

  return { scene, camera, update, resize, run, bodies };
}
