// Mars Colony Farm, 3D: a realistic Mars base seen from above at an angle. Physically based materials lit
// by a sun with soft shadows plus an environment map (reflections on the glass, metal and solar cells);
// procedural regolith with surface bump, irregular rocks and pebbles, a hazy butterscotch sky. A thin-
// framed glass dome covers a 3 x 3 grid of white grow trays with red/blue LED banks and crops with curved
// leaves. Around it: the solar array (dust visibly builds up), the water tank, a habitat module, an
// antenna. Drag to turn, pinch or scroll to zoom, tap a tray. Rendered by the shared world.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MAX_PODS, podStatus, tankSize } from "./farm.js";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const GRID = 3.6;
const PLANT_SCALE = 1.8;   // crops read clearly against the trays
const DOME_R = 9.4;

// ---------- procedural textures (canvas, generated once) ----------
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }

/** Seamless noise texture pair: colour + bump. palette(n, x, y) -> [r, g, b]. */
function noiseTex(size, scale, palette, { speckle = 0 } = {}) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const b = document.createElement("canvas"); b.width = b.height = size;
  const cx = c.getContext("2d"), bx = b.getContext("2d");
  const ci = cx.createImageData(size, size), bi = bx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = (x / size) * Math.PI * 2, t = (y / size) * Math.PI * 2;      // sampled on a torus: tiles without seams
    const nx = Math.cos(a) * scale, ny = Math.sin(a) * scale, nz = Math.cos(t) * scale, nw = Math.sin(t) * scale;
    let n = fbm(nx + nz * 0.7 + 11, ny + nw * 0.7 + 7) * 0.65 + fbm(nz * 1.9 + 3, nw * 1.9 + nx * 0.3) * 0.35;
    if (speckle && hash(x * 1.3, y * 0.7) > 1 - speckle) n -= 0.25;
    const [r, g, bl] = palette(n, x, y);
    const k = (y * size + x) * 4;
    ci.data.set([r, g, bl, 255], k);
    const h = Math.max(0, Math.min(255, n * 255));
    bi.data.set([h, h, h, 255], k);
  }
  cx.putImageData(ci, 0, 0); bx.putImageData(bi, 0, 0);
  const map = new THREE.CanvasTexture(c), bump = new THREE.CanvasTexture(b);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { map, bump };
}
const mix = (a, b, k) => a + (b - a) * k;
let TEX = null;
function textures(tablet) {
  if (TEX) return TEX;
  const S = tablet ? 256 : 512;
  const regolith = noiseTex(S, 2.2, (n) => { const k = Math.max(0, Math.min(1, (n - 0.25) * 1.6)); return [mix(92, 170, k), mix(44, 92, k), mix(26, 56, k)]; }, { speckle: 0.004 });
  const pad = noiseTex(S, 3.5, (n, x, y) => {
    const seam = (x % (S / 4) < 2 || y % (S / 4) < 2) ? 0.72 : 1;
    const k = Math.max(0, Math.min(1, n)); return [mix(118, 160, k) * seam, mix(92, 124, k) * seam, mix(74, 98, k) * seam];
  });
  const medium = noiseTex(128, 9, (n) => { const k = Math.max(0, Math.min(1, n)); return [mix(120, 190, k), mix(96, 150, k), mix(70, 108, k)]; }, { speckle: 0.05 });
  const led = (() => {     // LED bank: rows of red, blue and a few white diodes on a dark board
    const c = document.createElement("canvas"); c.width = 256; c.height = 64; const x = c.getContext("2d");
    x.fillStyle = "#14161c"; x.fillRect(0, 0, 256, 64);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 24; i++) {
      const r = (i + j) % 5; x.fillStyle = r === 0 ? "#6a7dff" : r === 3 ? "#ffffff" : "#ff3a4a";
      x.beginPath(); x.arc(8 + i * 10.4, 10 + j * 14.5, 3.4, 0, Math.PI * 2); x.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const cells = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 256, 256); g.addColorStop(0, "#0d1a3a"); g.addColorStop(1, "#16285a"); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "rgba(200,210,235,.55)"; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 32); x.lineTo(256, i * 32); x.stroke(); }
    x.strokeStyle = "rgba(200,210,235,.18)"; x.lineWidth = 1;
    for (let i = 0; i < 32; i++) { x.beginPath(); x.moveTo(0, i * 8 + 4); x.lineTo(256, i * 8 + 4); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  TEX = { regolith, pad, medium, led, cells };
  return TEX;
}

// ---------- crops: curved leaves, glossy fruit ----------
function leafGeometry(curl = 0.35) {
  const g = new THREE.PlaneGeometry(1, 1, 4, 10);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const u = P.getX(i) + 0.5, v = P.getY(i) + 0.5;                  // u across, v along the leaf
    const w = Math.sin(Math.PI * Math.min(1, v * 1.05)) * (0.55 + 0.45 * (1 - v));   // leaf outline
    const x = (u - 0.5) * w;
    const z = curl * v * v + Math.abs(x) * 0.35;                     // arch along the length, cup across
    P.setXYZ(i, x, z, v);
  }
  g.computeVertexNormals();
  const col = new Float32Array(P.count * 3);                           // darker toward the stem
  for (let i = 0; i < P.count; i++) { const k = 0.55 + 0.45 * Math.min(1, P.getZ(i) * 1.4); col.set([k, k, k], i * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
const LEAF = leafGeometry(0.4), LEAF_FLAT = leafGeometry(0.12), LEAF_CURLY = leafGeometry(0.7);
const STEM = new THREE.CylinderGeometry(0.035, 0.05, 1, 8);
const BALL = new THREE.SphereGeometry(1, 20, 14);
const SHARED = new Set([LEAF, LEAF_FLAT, LEAF_CURLY, STEM, BALL]);
const leafMats = new Map();
function leafMat(color) {
  if (!leafMats.has(color)) leafMats.set(color, new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }));
  return leafMats.get(color);
}
const CROP_COL = {
  lettuce: [0x7c2236, 0x93304a, 0x6b8f3a], mizuna: [0x4f9a3a, 0x5fae45], bekana: [0x8fc25a, 0x9fd06a, 0x7fb24c],
  radish: [0x3f8a35, 0x4f9a3f], zinnia: [0x4a8a3c], pepper: [0x3d7a33, 0x4a8a3c],
};
function leaf(geo, len, wid, color, yaw, lift) {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(geo, leafMat(color));
  m.scale.set(wid, len, len);
  pivot.add(m);
  pivot.rotation.order = "YXZ";
  pivot.rotation.y = yaw;
  pivot.rotation.x = -lift;
  return pivot;
}
function rosette(g, droop, n, len, wid, cols, lift, geo = LEAF) {
  const grp = new THREE.Group();
  const count = Math.max(3, Math.round(n * (0.4 + 0.6 * g)));
  for (let i = 0; i < count; i++) {
    const inner = i >= count * 0.55;
    const yaw = i * 2.399;                                          // golden angle, like real rosettes
    const L = len * (0.45 + 0.55 * g) * (inner ? 0.7 : 1) * (0.85 + 0.15 * Math.sin(i * 1.7));
    grp.add(leaf(geo, L, wid * (0.6 + 0.4 * g), cols[i % cols.length], yaw, Math.max(0.1, (inner ? lift + 0.45 : lift) - droop)));
  }
  return grp;
}
function stem(h, color = 0x4a7a3a) { const s = new THREE.Mesh(STEM, new THREE.MeshStandardMaterial({ color, roughness: 0.6 })); s.scale.set(1, h, 1); s.position.y = h / 2; return s; }

export function buildCrop(crop, g, dry) {
  const grp = new THREE.Group();
  const droop = dry ? 0.55 : 0;
  const cols = CROP_COL[crop] || CROP_COL.lettuce;
  if (g < 0.08) { grp.add(leaf(LEAF_FLAT, 0.28, 0.12, 0x6fbf55, 0, 0.9), leaf(LEAF_FLAT, 0.28, 0.12, 0x6fbf55, Math.PI, 0.9)); return grp; }
  if (crop === "lettuce") grp.add(rosette(g, droop, 16, 1.15, 0.62, cols, 0.75, LEAF_CURLY));
  else if (crop === "bekana") grp.add(rosette(g, droop, 12, 1.1, 0.7, cols, 1.05, LEAF));
  else if (crop === "mizuna") grp.add(rosette(g, droop, 24, 1.15, 0.2, cols, 1.0, LEAF_FLAT));
  else if (crop === "radish") {
    grp.add(rosette(g, droop, 9, 0.85, 0.36, cols, 1.05, LEAF));
    if (g > 0.5) { const b = new THREE.Mesh(BALL, new THREE.MeshPhysicalMaterial({ color: 0xc21a3e, roughness: 0.3, clearcoat: 0.6 })); const r = 0.1 + 0.2 * (g - 0.5) / 0.5; b.scale.set(r, r * 0.9, r); b.position.y = r * 0.3; grp.add(b); }
  } else if (crop === "zinnia") {
    const h = 0.3 + 1.4 * g;
    grp.add(stem(h));
    [0.25, 0.5, 0.7].filter((f) => g > f * 0.7).forEach((f, i) => { const l = leaf(LEAF, 0.5, 0.22, cols[0], i * 2.4, 0.6 - droop); l.position.y = h * f; grp.add(l); });
    if (g > 0.7) {
      const k = Math.min(1, (g - 0.7) / 0.3), fl = new THREE.Group();
      const pm = new THREE.MeshStandardMaterial({ color: 0xff6a2a, roughness: 0.5, side: THREE.DoubleSide });
      for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 14; i++) {
        const p = new THREE.Mesh(LEAF_FLAT, pm); p.scale.set(0.16 * k, 0.32 * k * (ring ? 0.75 : 1), 0.32 * k);
        const piv = new THREE.Group(); piv.rotation.order = "YXZ"; piv.rotation.y = (i / 14) * Math.PI * 2 + ring * 0.2; piv.rotation.x = -(ring ? 0.7 : 0.25); piv.add(p); fl.add(piv);
      }
      const c = new THREE.Mesh(BALL, new THREE.MeshStandardMaterial({ color: 0xe8a21a, roughness: 0.8 })); c.scale.set(0.09 * k + 0.02, 0.05, 0.09 * k + 0.02); fl.add(c);
      fl.position.y = h; fl.rotation.x = droop; grp.add(fl);
    }
  } else if (crop === "pepper") {
    const h = 0.35 + 1.2 * g;
    grp.add(stem(h, 0x3d6a33));
    const levels = Math.round(4 + 6 * g);
    for (let i = 0; i < levels; i++) { const l = leaf(LEAF, 0.48, 0.24, cols[i % 2], i * 2.399, 0.45 - droop); l.position.y = h * (0.2 + 0.8 * (i / levels)); grp.add(l); }
    if (g > 0.6) {
      const ripe = g > 0.9, k = Math.min(1, (g - 0.6) / 0.4);
      const fm = new THREE.MeshPhysicalMaterial({ color: ripe ? 0xb8141a : 0x3f8a2a, roughness: 0.22, clearcoat: 0.8 });
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(BALL, fm); f.scale.set(0.07 * k + 0.02, 0.2 * k + 0.04, 0.07 * k + 0.02);
        const a = i * 2.1; f.position.set(Math.cos(a) * 0.28, h * (0.45 + i * 0.12), Math.sin(a) * 0.28); f.rotation.z = 0.2; grp.add(f);
      }
    }
  }
  return grp;
}

// ---------- scene ----------
export function createMarsBase(world) {
  const tablet = world.isTablet;
  const T = textures(tablet);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 1200);

  let envRT = null;     // a soft studio environment for reflections (glass, metal, solar cells)
  const makeEnv = () => {
    if (envRT) return;
    const pm = new THREE.PMREMGenerator(world.renderer);
    envRT = pm.fromScene(new RoomEnvironment(), 0.04);
    pm.dispose();
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.28;
  };

  // sky: butterscotch haze, brighter toward the horizon; a small sun with a blue-white glow (Mars forward scattering)
  const skyU = { top: { value: new THREE.Color(0x8a5a3c) }, hor: { value: new THREE.Color(0xd2a07a) }, sunDir: { value: new THREE.Vector3(0.4, 0.6, -0.3).normalize() }, sunCol: { value: new THREE.Color(0xfff6ea) } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vD;
      void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.45));
        float s = max(dot(normalize(vD), normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 900.0) * 4.0 + pow(s, 40.0) * 0.18) + vec3(0.55, 0.62, 0.75) * pow(s, 8.0) * 0.12;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0xc99a74, 0.0042);

  const hemi = new THREE.HemisphereLight(0xffe2c8, 0x5a2e1e, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0e0, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(tablet ? 1024 : 2048, tablet ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const shade = (m, cast = true, receive = true) => { m.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } }); return m; };

  // terrain: smooth dunes with regolith texture and bump
  const seg = tablet ? 140 : 220;
  const tg = new THREE.PlaneGeometry(700, 700, seg, seg);
  tg.rotateX(-Math.PI / 2);
  { const P = tg.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), r = Math.hypot(x, z); const k = THREE.MathUtils.smoothstep(r, 24, 70); P.setY(i, k * (fbm(x * 0.012 + 3, z * 0.012) * 16 - 6 + fbm(x * 0.06, z * 0.06) * 1.6) - 0.05 + (1 - k) * fbm(x * 0.2, z * 0.2) * 0.12); } tg.computeVertexNormals(); }
  // real ground: "Aerial Ground Rock" (Poly Haven, CC0), recoloured to Martian iron-oxide red; the
  // generated regolith stands in until the photo loads (and if it cannot load)
  const groundMat = new THREE.MeshStandardMaterial({ map: T.regolith.map, bumpMap: T.regolith.bump, bumpScale: 2.2, roughness: 0.96, metalness: 0 });
  groundMat.map.repeat.set(36, 36);
  const photo = (n, srgb) => new Promise((res) => world.loader.load(`assets/mars/${n}`, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, world.renderer.capabilities.getMaxAnisotropy()); res(t); }, undefined, () => res(null)));
  Promise.all([photo("ground_diff.jpg", true), photo("ground_nor_gl.jpg"), photo("ground_rough.jpg")]).then(([d, n, r]) => {
    if (!d) return;
    const rep_ = 46;
    for (const t of [d, n, r]) t?.repeat.set(rep_, rep_);
    Object.assign(groundMat, { map: d, bumpMap: null, normalMap: n, roughnessMap: r, roughness: 1 });
    if (n) groundMat.normalScale.set(1.4, 1.4);
    groundMat.needsUpdate = true;
    const rk = (t) => { if (!t) return null; const c = t.clone(); c.repeat.set(1.5, 1.5); c.needsUpdate = true; return c; };
    Object.assign(rockMat, { map: rk(d), bumpMap: null, normalMap: rk(n), roughnessMap: rk(r), color: new THREE.Color(0xb08a7a) });
    rockMat.needsUpdate = true;
  });
  const ground = new THREE.Mesh(tg, groundMat); ground.receiveShadow = true; scene.add(ground);

  // the landing pad: sintered-regolith tiles
  const padMap = T.pad.map.clone(), padBump = T.pad.bump.clone();
  padMap.repeat.set(4, 4); padBump.repeat.set(4, 4); padMap.needsUpdate = padBump.needsUpdate = true;
  const padMat = new THREE.MeshStandardMaterial({ map: padMap, bumpMap: padBump, bumpScale: 0.8, roughness: 0.9 });
  const pad = shade(new THREE.Mesh(new THREE.CylinderGeometry(20, 20.6, 0.5, 64), [new THREE.MeshStandardMaterial({ color: 0x8e6a52, roughness: 0.95 }), padMat, padMat]), false);
  pad.position.y = 0.25; scene.add(pad);

  // rocks and pebbles
  const rockMat = new THREE.MeshStandardMaterial({ map: T.regolith.map, bumpMap: T.regolith.bump, bumpScale: 3, roughness: 0.92, color: 0x9a7a6a });
  for (let i = 0; i < (tablet ? 30 : 60); i++) {
    const g = new THREE.IcosahedronGeometry(1, 2), P = g.attributes.position;
    for (let k = 0; k < P.count; k++) { const v = new THREE.Vector3().fromBufferAttribute(P, k); const d = 0.7 + 0.5 * fbm(v.x * 1.7 + i, v.y * 1.7 + v.z * 1.3); v.multiplyScalar(d); P.setXYZ(k, v.x, v.y * 0.7, v.z); }
    g.computeVertexNormals();
    const a = i * 2.399, r = 24 + ((i * 97) % 110), s = 0.4 + ((i * 31) % 10) / 7;
    const m = shade(new THREE.Mesh(g, rockMat)); m.scale.setScalar(s); m.position.set(Math.cos(a) * r, s * 0.15, Math.sin(a) * r); m.rotation.set(i, i * 2, i * 3); scene.add(m);
  }
  const NP = tablet ? 500 : 1400;
  const peb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.18, 0), new THREE.MeshStandardMaterial({ color: 0x5e3a2a, roughness: 1 }), NP);
  { const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(); for (let i = 0; i < NP; i++) { const a = Math.random() * Math.PI * 2, r = 21 + Math.random() * 60, s = 0.4 + Math.random() * 1.4; e.set(Math.random() * 3, Math.random() * 3, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r), q, new THREE.Vector3(s, s * 0.6, s)); peb.setMatrixAt(i, M); } }
  peb.receiveShadow = true; scene.add(peb);

  // ---- greenhouse ----
  const gh = new THREE.Group(); gh.position.y = 0.5; scene.add(gh);
  const metal = new THREE.MeshStandardMaterial({ color: 0xd6d9de, roughness: 0.32, metalness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.55, metalness: 0.05 });
  const ring = shade(new THREE.Mesh(new THREE.CylinderGeometry(DOME_R + 0.25, DOME_R + 0.45, 0.8, 64), white)); ring.position.y = 0.4; gh.add(ring);
  const floorMap = T.pad.map.clone(), floorBump = T.pad.bump.clone(); floorMap.repeat.set(5, 5); floorBump.repeat.set(5, 5); floorMap.needsUpdate = floorBump.needsUpdate = true;
  const floor = shade(new THREE.Mesh(new THREE.CylinderGeometry(DOME_R, DOME_R, 0.1, 64), new THREE.MeshStandardMaterial({ map: floorMap, bumpMap: floorBump, bumpScale: 0.4, color: 0xd9d4cc, roughness: 0.7, metalness: 0.05 })), false); floor.position.y = 0.82; gh.add(floor);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.045, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.1, depthWrite: false, side: THREE.DoubleSide }));
  glass.position.y = 0.8; glass.renderOrder = 3; gh.add(glass);
  const ribMat = metal.clone(); ribMat.transparent = true;    // the dome frame fades as the camera comes in close
  for (let k = 0; k < 12; k++) {   // thin geodesic ribs
    const a = (k / 12) * Math.PI * 2, pts = [];
    for (let j = 0; j <= 18; j++) { const t = (j / 18) * Math.PI / 2; pts.push(new THREE.Vector3(Math.cos(a) * Math.cos(t) * DOME_R, Math.sin(t) * DOME_R + 0.8, Math.sin(a) * Math.cos(t) * DOME_R)); }
    gh.add(shade(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.035, 6), ribMat), true, false));
  }
  for (const t of [0.3, 0.62, 0.98]) { const tor = shade(new THREE.Mesh(new THREE.TorusGeometry(Math.cos(t) * DOME_R, 0.035, 6, 96), ribMat), true, false); tor.rotation.x = Math.PI / 2; tor.position.y = Math.sin(t) * DOME_R + 0.8; gh.add(tor); }
  const tun = shade(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 32), white)); tun.rotation.z = Math.PI / 2; tun.position.set(DOME_R + 3, 1.6, 0); gh.add(tun);
  for (const x of [DOME_R + 0.6, DOME_R + 5.4]) { const rib = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.08, 8, 32), metal); rib.rotation.y = Math.PI / 2; rib.position.set(x, 1.6, 0); gh.add(rib); }

  // ---- grow trays ----
  const TRAY = new RoundedBoxGeometry(2.8, 0.55, 2.8, 3, 0.08);
  const SOIL = new THREE.BoxGeometry(2.5, 0.08, 2.5);
  const trayOwned = new THREE.MeshStandardMaterial({ color: 0xdcdcd8, roughness: 0.45, metalness: 0.05 });
  const trayLocked = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.6, transparent: true, opacity: 0.35 });
  const mediumMat = new THREE.MeshStandardMaterial({ map: T.medium.map, bumpMap: T.medium.bump, bumpScale: 1.2, roughness: 1 });
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const pods = [];
  for (let i = 0; i < MAX_PODS; i++) {
    const g = new THREE.Group();
    g.position.set(((i % 3) - 1) * GRID, 0.87, (Math.floor(i / 3) - 1) * GRID);
    gh.add(g);
    const legs = new THREE.Group(); g.add(legs);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), metal)); l.position.set(sx * 1.25, 0.25, sz * 1.25); legs.add(l); }
    const box = shade(new THREE.Mesh(TRAY, trayOwned)); box.position.y = 0.75; g.add(box);
    const soil = shade(new THREE.Mesh(SOIL, mediumMat), false); soil.position.y = 1.03; g.add(soil);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, roughness: 0.05, transparent: true, opacity: 0, clearcoat: 1 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 1.08; g.add(water);
    const arch = new THREE.Group(); g.add(arch);
    for (const s of [-1, 1]) { const post = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8), metal)); post.position.set(s * 1.3, 2.15, -1.3); arch.add(post); }
    const housing = shade(new THREE.Mesh(new RoundedBoxGeometry(2.7, 0.12, 0.9, 2, 0.04), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.6 }))); housing.position.set(0, 3.3, -0.85); housing.rotation.x = 0.35; arch.add(housing);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: T.led, emissiveIntensity: 2.2, roughness: 0.3 });
    const led = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 0.75), ledMat); led.position.set(0, 3.235, -0.83); led.rotation.x = Math.PI / 2 + 0.35; arch.add(led);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff4fb8, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 1.09; g.add(pool);
    const sel = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.035, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    sel.rotation.x = Math.PI / 2; sel.position.y = 0.06; sel.visible = false; g.add(sel);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.6, 3.1), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 1.8; hit.userData.pod = i; g.add(hit);
    const plantHolder = new THREE.Group(); plantHolder.position.y = 1.07; plantHolder.scale.setScalar(PLANT_SCALE); g.add(plantHolder);
    pods.push({ g, box, soil, legs, arch, led, ledMat, pool, water, sel, hit, plantHolder, key: "", plant: null, sway: Math.random() * 6, pop: 0 });
  }

  // ---- solar array ----
  const solar = new THREE.Group(); solar.position.set(-16, 0.5, -6); solar.rotation.y = 0.55; scene.add(solar);
  const cellMat = new THREE.MeshPhysicalMaterial({ map: T.cells, color: 0xffffff, roughness: 0.18, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 });
  const dustMat = new THREE.MeshStandardMaterial({ color: 0xb98060, roughness: 1, transparent: true, opacity: 0 });
  const solarHits = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const pg = new THREE.Group(); pg.position.set(c * 3.4 - 3.4, 0, r * 4.4 - 2.2); solar.add(pg);
    const post = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 10), metal)); post.position.y = 0.75; pg.add(post);
    const frame = shade(new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.08, 2.15), metal)); frame.position.y = 1.6; frame.rotation.x = -0.5; pg.add(frame);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), cellMat); panel.position.y = 1.65; panel.rotation.x = -Math.PI / 2 - 0.5; pg.add(panel);
    const dust = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), dustMat); dust.position.y = 1.66; dust.rotation.x = -Math.PI / 2 - 0.5; pg.add(dust);
    const ph = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 2.6), new THREE.MeshBasicMaterial({ visible: false })); ph.position.y = 1.4; ph.userData.solar = true; pg.add(ph); solarHits.push(ph);
  }
  // ---- water tank ----
  const tank = new THREE.Group(); tank.position.set(-5, 0.5, 14); scene.add(tank);
  const tankBody = shade(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 4.2, 48), white)); tankBody.position.y = 2.1; tank.add(tankBody);
  const tankCap = shade(new THREE.Mesh(new THREE.SphereGeometry(1.9, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), white)); tankCap.position.y = 4.2; tank.add(tankCap);
  const level = new THREE.Mesh(new THREE.CylinderGeometry(1.915, 1.915, 1, 48, 1, true, -0.5, 1.0), new THREE.MeshStandardMaterial({ color: 0x4aa8e8, emissive: 0x1f6fb0, emissiveIntensity: 0.6, roughness: 0.2 }));
  tank.add(level);
  for (const y of [0.6, 3.6]) { const b = new THREE.Mesh(new THREE.TorusGeometry(1.93, 0.05, 8, 64), metal); b.rotation.x = Math.PI / 2; b.position.y = y; tank.add(b); }
  // ---- habitat ----
  const hab = new THREE.Group(); hab.position.set(DOME_R + 8.6, 2.4, 0); scene.add(hab);
  const habBody = shade(new THREE.Mesh(new THREE.CapsuleGeometry(2.5, 7, 12, 40), white)); habBody.rotation.x = Math.PI / 2; hab.add(habBody);
  for (const z of [-2.6, 0, 2.6]) { const bnd = new THREE.Mesh(new THREE.TorusGeometry(2.51, 0.06, 8, 64), metal); bnd.position.z = z; hab.add(bnd); }
  const winMat = new THREE.MeshPhysicalMaterial({ color: 0x1a2230, emissive: 0xffc98a, emissiveIntensity: 0.15, roughness: 0.05, clearcoat: 1 });
  for (const z of [-1.3, 1.3]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), winMat); w.position.set(2.51, 0.5, z); w.rotation.y = Math.PI / 2; hab.add(w); }
  for (const z of [-3, 3]) for (const x of [-1.3, 1.3]) { const leg = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 2.2, 10), metal)); leg.position.set(x, -2.0, z); hab.add(leg); }
  // ---- antenna ----
  const ant = new THREE.Group(); ant.position.set(12, 0.5, -13); scene.add(ant);
  const pole = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 6.5, 12), metal)); pole.position.y = 3.25; ant.add(pole);
  const dish = shade(new THREE.Mesh(new THREE.SphereGeometry(1.5, 40, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide })));
  dish.position.y = 6.2; dish.rotation.x = 2.3; ant.add(dish);
  const beacon = new THREE.Mesh(BALL, new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2a2a, emissiveIntensity: 3 })); beacon.scale.setScalar(0.12); beacon.position.y = 6.6; ant.add(beacon);

  // ---- a Perseverance-style rover parked on the apron, with its tracks ----
  const rover = new THREE.Group(); rover.position.set(9, 0.02, 17); rover.rotation.y = -0.9; scene.add(rover);
  const rWhite = new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.6, metalness: 0.15 });
  const rDark = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.7, metalness: 0.4 });
  const rGold = new THREE.MeshStandardMaterial({ color: 0xb8923a, roughness: 0.35, metalness: 0.9 });
  const chassis = shade(new THREE.Mesh(new RoundedBoxGeometry(3.0, 0.9, 2.0, 2, 0.08), rWhite)); chassis.position.y = 1.45; rover.add(chassis);
  const deck = shade(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.5), rGold)); deck.position.set(-1.0, 2.1, 0); rover.add(deck);
  const rtg = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.0, 16), rDark)); rtg.rotation.z = 1.1; rtg.position.set(-1.8, 1.8, 0); rover.add(rtg);
  const mastR = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.8, 10), rWhite)); mastR.position.set(1.1, 2.8, 0.6); rover.add(mastR);
  const head = shade(new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.32, 0.4, 2, 0.05), rWhite)); head.position.set(1.15, 3.75, 0.6); rover.add(head);
  for (const z of [0.5, 0.7]) { const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.05, clearcoat: 1 })); lens.rotation.z = Math.PI / 2; lens.position.set(1.51, 3.75, z); rover.add(lens); }
  const arm = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), rWhite)); arm.rotation.z = 1.2; arm.position.set(2.1, 1.3, -0.5); rover.add(arm);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 24);
  for (const x of [-1.2, 0, 1.2]) for (const z of [-1.2, 1.2]) {
    const w = shade(new THREE.Mesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 0.45, metalness: 0.7 }))); w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, z); rover.add(w);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), rDark); strut.position.set(x, 0.95, z * 0.88); rover.add(strut);
  }
  { // wheel tracks: two darker, slightly flattened bands curving away across the regolith
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x3a1c10, roughness: 1, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const off of [-1.2, 1.2]) {
      const pts = []; for (let k = 0; k <= 40; k++) { const u = k / 40; pts.push(new THREE.Vector3(9 + Math.sin(-0.9) * -u * 2 + u * 34 + off * Math.cos(0.9) * 0.6, 0.04, 17 + u * 26 + Math.sin(u * 4) * 3 + off * 0.6)); }
      const curve = new THREE.CatmullRomCurve3(pts), g = new THREE.BufferGeometry(), V = [], I = [];
      for (let k = 0; k <= 80; k++) { const p0 = curve.getPoint(k / 80), tg_ = curve.getTangent(k / 80), side = new THREE.Vector3(-tg_.z, 0, tg_.x).normalize().multiplyScalar(0.22); V.push(p0.x + side.x, 0.05, p0.z + side.z, p0.x - side.x, 0.05, p0.z - side.z); if (k) I.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k); }
      g.setAttribute("position", new THREE.Float32BufferAttribute(V, 3)); g.setIndex(I); g.computeVertexNormals();
      const tr = new THREE.Mesh(g, trackMat); tr.receiveShadow = true; scene.add(tr);
    }
  }
  // ---- a weather mast (wind, pressure, dust: what drives the storms) ----
  const met = new THREE.Group(); met.position.set(-14, 0.5, 9); scene.add(met);
  const mp = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 4, 8), metal)); mp.position.y = 2; met.add(mp);
  const vane = new THREE.Group(); vane.position.y = 4; met.add(vane);
  for (let k = 0; k < 3; k++) { const cup = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI), white); const a = (k / 3) * Math.PI * 2; cup.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4); cup.rotation.y = -a; vane.add(cup); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), metal); rod.rotation.z = Math.PI / 2; rod.rotation.y = -a; rod.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2); vane.add(rod); }
  const metBox = shade(new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.4, 0.4, 2, 0.04), white)); metBox.position.y = 2.6; met.add(metBox);

  // ---- an astronaut walking a loop between the trays ----
  const suitW = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6 });
  const astro = new THREE.Group(); gh.add(astro);
  { const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 6, 16), suitW); torso.position.y = 1.85; astro.add(torso);
    const pack = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.6, 0.25, 2, 0.06), suitW); pack.position.set(0, 1.95, -0.3); astro.add(pack);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16), suitW); helmet.position.y = 2.55; astro.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12, -Math.PI * 0.45, Math.PI * 0.9, Math.PI * 0.3, Math.PI * 0.35), new THREE.MeshPhysicalMaterial({ color: 0xc8962e, metalness: 1, roughness: 0.1, clearcoat: 1 })); visor.position.set(0, 2.56, 0.1); astro.add(visor);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.6, 4, 10), suitW); leg.position.set(sx * 0.15, 1.05, 0); leg.name = sx < 0 ? "legL" : "legR"; astro.add(leg);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 4, 10), suitW); arm.position.set(sx * 0.42, 1.85, 0); arm.name = sx < 0 ? "armL" : "armR"; astro.add(arm); }
    astro.traverse((o) => { if (o.isMesh) o.castShadow = true; }); }
  const walkPts = [[-5.4, -5.4], [5.4, -5.4], [5.4, 5.4], [-5.4, 5.4]].map(([x, z]) => new THREE.Vector3(x, 0.82, z));
  const walk = new THREE.CatmullRomCurve3(walkPts, true, "centripetal");
  // ---- the helper drone ----
  const drone = new THREE.Group(); gh.add(drone); drone.position.set(0, 7, 0);
  { const body = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.22, 0.7, 2, 0.08), new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.35, metalness: 0.4 })); drone.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x6fd0ff, emissiveIntensity: 2 })); eye.position.set(0, -0.08, 0.32); drone.add(eye);
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) { const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 })); rotor.position.set(x, 0.14, z); rotor.name = "rotor"; drone.add(rotor); }
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = -1.2; beam.name = "beam"; drone.add(beam); }
  const droneTarget = new THREE.Vector3(0, 7, 0), droneTmp = new THREE.Vector3();
  let droneBeam = 0, droneColor = new THREE.Color(0x6fd0ff);
  /** Send the drone to a tray for an action: "water" (blue), "harvest" (gold), "plant" (green). */
  function droneTo(i, kind = "water") {
    pods[i].g.getWorldPosition(droneTmp); droneTarget.set(droneTmp.x, droneTmp.y + 3.4, droneTmp.z);
    droneColor.set(kind === "harvest" ? 0xffd34a : kind === "plant" ? 0x8fe37a : 0x6fd0ff); droneBeam = 1.4;
  }

  // ---- airborne dust and harvest sparkles ----
  const N = tablet ? 300 : 700;
  const dp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { dp[i * 3] = (Math.random() - 0.5) * 140; dp[i * 3 + 1] = Math.random() * 20; dp[i * 3 + 2] = (Math.random() - 0.5) * 140; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const airMat = new THREE.PointsMaterial({ color: 0xe9c9a6, size: 0.18, transparent: true, opacity: 0.35, depthWrite: false });
  scene.add(new THREE.Points(dg, airMat));
  const SP = 60, spPos = new Float32Array(SP * 3), spVel = new Float32Array(SP * 3);
  const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
  const spMat = new THREE.PointsMaterial({ color: 0xfff2c8, size: 0.25, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(spGeo, spMat));
  let sparkT = 0;

  // ---- camera ----
  const HOME = { yaw: 1.0, pitch: 0.95, dist: 31, target: new THREE.Vector3(0, 1.4, 0) };
  const cam = { yaw: HOME.yaw, pitch: HOME.pitch, dist: HOME.dist, tYaw: HOME.yaw, tPitch: HOME.pitch, tDist: HOME.dist, target: HOME.target.clone() };
  let W = 1, H = 1, t = 0, storm = false, inset = { right: 0, bottom: 0, top: 0 };
  const applyView = () => { camera.setViewOffset(W, H, inset.right / 2, (inset.bottom - inset.top) / 2, W, H); camera.updateProjectionMatrix(); };
  function placeCamera(k) {
    cam.yaw += (cam.tYaw - cam.yaw) * k; cam.pitch += (cam.tPitch - cam.pitch) * k; cam.dist += (cam.tDist - cam.dist) * k;
    camera.position.set(cam.target.x + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist, cam.target.y + Math.sin(cam.pitch) * cam.dist, cam.target.z + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
    camera.lookAt(cam.target);
  }

  const def = {
    scene, camera,
    resize(w, h) { W = w; H = h; camera.aspect = w / h; camera.fov = w / h < 1 ? 46 : 30; applyView(); },
    update(dt) {
      t += dt;
      placeCamera(reduced() ? 1 : 1 - Math.pow(0.002, dt));
      const fade = THREE.MathUtils.clamp((cam.dist - 26) / 26, 0.08, 1);
      ribMat.opacity = fade; ribMat.depthWrite = fade > 0.9; glass.material.opacity = 0.045 * fade;
      for (const p of pods) {
        if (p.plant) { p.plant.rotation.z = Math.sin(t * 0.9 + p.sway) * 0.02; p.plant.rotation.x = Math.cos(t * 0.7 + p.sway) * 0.015; }
        if (p.pop > 0) { p.pop = Math.max(0, p.pop - dt * 2.5); p.plantHolder.scale.setScalar(PLANT_SCALE * (1 + Math.sin(p.pop * Math.PI) * 0.14)); }
        if (p.sel.visible) p.sel.material.opacity = 0.55 + 0.35 * Math.sin(t * 4);
      }
      beacon.material.emissiveIntensity = Math.sin(t * 2.4) > 0.7 ? 5 : 0.2;
      vane.rotation.y += dt * (storm ? 9 : 1.6);
      head.rotation.y = Math.sin(t * 0.25) * 0.6;
      const P = dg.attributes.position, wind = storm ? 8 : 1.2;
      for (let i = 0; i < N; i++) { let x = P.getX(i) + wind * dt; if (x > 70) x -= 140; P.setX(i, x); }
      P.needsUpdate = true;
      if (sparkT > 0) {
        sparkT -= dt; spMat.opacity = Math.max(0, sparkT / 1.2);
        const SPp = spGeo.attributes.position;
        for (let i = 0; i < SP; i++) { spVel[i * 3 + 1] -= 5 * dt; SPp.setXYZ(i, SPp.getX(i) + spVel[i * 3] * dt, SPp.getY(i) + spVel[i * 3 + 1] * dt, SPp.getZ(i) + spVel[i * 3 + 2] * dt); }
        SPp.needsUpdate = true;
      }
      // astronaut: walks the loop, legs and arms swing
      { const u = (t * 0.018) % 1, p0 = walk.getPointAt(u), p1 = walk.getPointAt((u + 0.01) % 1);
        astro.position.copy(p0); astro.rotation.set(0, Math.atan2(p1.x - p0.x, p1.z - p0.z), 0);   // heading only: always upright
        const sw = Math.sin(t * 5.5) * 0.4;
        astro.getObjectByName("legL").rotation.x = sw; astro.getObjectByName("legR").rotation.x = -sw;
        astro.getObjectByName("armL").rotation.x = -sw * 0.8; astro.getObjectByName("armR").rotation.x = sw * 0.8;
        astro.position.y = 0.82 + Math.abs(Math.sin(t * 5.5)) * 0.05; }
      // drone: glides to its target, hovers, shines a beam during an action, then drifts home
      drone.position.lerp(droneTarget, 1 - Math.pow(0.02, dt));
      drone.position.y += Math.sin(t * 3) * 0.004;
      drone.children.forEach((c) => { if (c.name === "rotor") c.rotation.y += dt * 40; });
      droneBeam = Math.max(0, droneBeam - dt * 0.9);
      const bm = drone.getObjectByName("beam"); bm.material.opacity = Math.min(0.35, droneBeam * 0.35); bm.material.color.copy(droneColor);
      if (droneBeam <= 0) droneTarget.lerp(new THREE.Vector3(0, 7.5, 0), 1 - Math.pow(0.5, dt));
      def.onFrame?.();
    },
    onShow() {
      this._theme = world.theme;
      world.setTheme("dark", 0);
      world.setBloom(0.22);
      world.renderer.shadowMap.enabled = true;
      world.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      makeEnv();
    },
    onHide() { world.setTheme(this._theme || "dark", 0); },
    dispose() { envRT?.dispose(); scene.traverse((o) => { if ((o.isMesh || o.isPoints) && !SHARED.has(o.geometry)) o.geometry?.dispose?.(); }); },
  };

  /** Sun and sky. Afternoon by default; a storm browns the sky and thickens the haze. */
  function setSky(hours, isStorm) {
    storm = isStorm;
    const az = ((hours - 6) / 12) * Math.PI, elev = 0.75;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), -0.55).normalize();
    skyU.sunDir.value.copy(dir);
    sun.position.copy(dir).multiplyScalar(100); sun.target.position.set(0, 0, 0);
    skyU.top.value.set(isStorm ? 0x6d4a32 : 0x8a5a3c); skyU.hor.value.set(isStorm ? 0x9c7454 : 0xd2a07a);
    skyU.sunCol.value.set(0xfff6ea).multiplyScalar(isStorm ? 0.15 : 1);
    sun.intensity = isStorm ? 0.7 : 2.1; hemi.intensity = isStorm ? 0.7 : 0.5;
    scene.fog.color.set(isStorm ? 0x9a7254 : 0xc99a74); scene.fog.density = isStorm ? 0.018 : 0.0042;
    airMat.opacity = isStorm ? 0.8 : 0.35; airMat.size = isStorm ? 0.3 : 0.18;
  }

  /** Mirror the farm: crops, LEDs, thirst, locked trays, dusty panels, tank level. */
  function setFarm(f, now) {
    for (let i = 0; i < MAX_PODS; i++) {
      const v = pods[i], p = f.pods[i], st = podStatus(f, i), owned = i < f.owned;
      v.box.material = owned ? trayOwned : trayLocked;
      v.soil.visible = owned; v.arch.visible = owned; v.legs.visible = owned;
      v.box.position.y = owned ? 0.75 : 0.3;
      v.g.visible = owned || st === "buy";
      const dry = st === "thirsty";
      const key = owned && p.crop ? `${p.crop}|${Math.floor(Math.min(1, p.growth) * 12)}|${dry}` : "";
      if (key !== v.key) {
        if (v.plant) v.plantHolder.remove(v.plant);
        v.plant = key ? shade(buildCrop(p.crop, p.growth, dry), true, false) : null;
        if (v.plant) v.plantHolder.add(v.plant);
        if (v.key && key && v.key.split("|")[0] === key.split("|")[0]) v.pop = 1;
        v.key = key;
      }
      const lit = owned && p.crop && p.growth < 1 && st !== "dim";
      const boost = lit && now < f.sunlampUntil;
      v.ledMat.emissiveIntensity = lit ? (boost ? 4 : 2.2) : 0.08;
      v.pool.material.opacity = lit ? (boost ? 0.75 : 0.4) : 0;
      v.water.material.opacity = owned && p.crop && p.watered && p.growth < 1 ? 0.25 : 0;
    }
    dustMat.opacity = Math.min(0.85, f.dust * 0.95);
    const frac = Math.min(1, f.reserve / tankSize(f));
    level.scale.y = Math.max(0.05, 3.9 * frac); level.position.y = 0.15 + level.scale.y / 2;
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hits = [...pods.map((p) => p.hit), ...solarHits];
  /** What is under a screen point: {pod: i} | {solar: true} | null. */
  function pick(clientX, clientY) {
    ndc.set((clientX / W) * 2 - 1, -(clientY / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(hits, false).find((x) => x.object.userData.solar || pods[x.object.userData.pod].g.visible);
    if (!h) return null;
    return h.object.userData.solar ? { solar: true } : { pod: h.object.userData.pod };
  }
  const tmpV = new THREE.Vector3();
  function project(v) { v.project(camera); return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, behind: v.z > 1 }; }
  function podScreen(i, y = 4.3) { pods[i].g.getWorldPosition(tmpV); tmpV.y += y; return project(tmpV); }
  function solarScreen() { solar.getWorldPosition(tmpV); tmpV.y += 4.2; return project(tmpV); }
  function select(i) { pods.forEach((p, k) => { p.sel.visible = k === i; }); }
  function burst(i) {
    pods[i].g.getWorldPosition(tmpV);
    const P = spGeo.attributes.position;
    for (let k = 0; k < SP; k++) { P.setXYZ(k, tmpV.x, tmpV.y + 1.4, tmpV.z); spVel[k * 3] = (Math.random() - 0.5) * 5; spVel[k * 3 + 1] = 2.5 + Math.random() * 4; spVel[k * 3 + 2] = (Math.random() - 0.5) * 5; }
    P.needsUpdate = true; sparkT = 1.2;
  }
  function orbit(dx, dy) { cam.tYaw += dx * 0.006; cam.tPitch = Math.max(0.4, Math.min(1.25, cam.tPitch + dy * 0.004)); }
  function zoom(f) { cam.tDist = Math.max(18, Math.min(110, cam.tDist * f)); }
  /** Screen space taken by the HUD (px): the base centres itself in what is left. */
  function setInsets(v) { inset = { right: 0, bottom: 0, top: 0, ...v }; applyView(); }
  function home() { Object.assign(cam, { tYaw: HOME.yaw, tPitch: HOME.pitch, tDist: HOME.dist }); cam.target.copy(HOME.target); }

  placeCamera(1);
  return { def, setSky, setFarm, pick, podScreen, solarScreen, select, burst, orbit, zoom, home, setInsets, droneTo, get cam() { return { ...cam, pos: camera.position.toArray().map((v) => +v.toFixed(1)), fov: camera.fov, view: camera.view && { ...camera.view } }; } };
}
