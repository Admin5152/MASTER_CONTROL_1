// The body studio (refs 03-04, 09-11). A MakeHuman body (male or female) in matte slate blue on navy,
// and inside it the real anatomy fitted to that body (BodyParts3D, 18 named systems). Three looks:
//   solid       the clay body (refs 03-04)
//   radiograph  bones bright, soft tissue faint, no colour: what an X-ray looks like (ref 10)
//   anatomy     coloured systems; a checked zone in full colour and everything else dimmed (refs 09, 11)
// The MESH SCAN draws the body's own triangle mesh as a glowing band sweeping down while the solid
// surface dissolves and the X-ray shows through where the band has passed. Turn and zoom by drag/pinch
// (damped) and by Sentinel (eased). Anchors, rings, scan spans and camera framings are all derived from
// the loaded model's own geometry, so the 1.60 m female and the 1.89 m male both frame correctly.
// The X-ray is a visualisation of a reference anatomy, never the crew member's own scan.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { conformAnatomy } from "./fit.js";

export const BONES = ["skull", "spine", "ribcage", "shoulders", "pelvis", "limbs"];
export const ORGANS = ["brain", "eyes", "heart", "lungs", "airway", "liver", "stomach", "intestines", "pancreas_spleen", "kidneys", "arteries", "veins"];
export const NODES = [...BONES, ...ORGANS];
/** Zone -> anatomy nodes lit when that zone is checked (brief section 9 item 2). */
export const ZONE_NODES = {
  head: ["brain"], eyes: ["eyes"], heart: ["heart"], lungs: ["lungs", "airway"],
  gut: ["stomach", "intestines", "liver", "pancreas_spleen"], bones: BONES, whole_body: null,
};
/** Named groups a person can ask to isolate ("show my blood vessels"). */
export const PART_GROUPS = { vessels: ["arteries", "veins"], bones: BONES, skeleton: BONES, organs: ORGANS.filter((n) => n !== "arteries" && n !== "veins") };
const COL = {
  brain: "#ff8fa6", eyes: "#8fe3ff", heart: "#ff2e4a", lungs: "#5fb2ff", airway: "#9fd6ff", liver: "#b4503f", stomach: "#ff9a5c",
  intestines: "#ffb877", pancreas_spleen: "#d9826a", kidneys: "#d65a4c", arteries: "#ff2a40", veins: "#2f63ff",
};
const REAL = {
  heart: "#861822", lungs: "#7fa9e6", airway: "#cf9393", brain: "#d6a7ad", eyes: "#e9eef2", liver: "#6f2119", stomach: "#d88a7c",
  intestines: "#e3a58c", pancreas_spleen: "#b26464", kidneys: "#8c302b", arteries: "#c4212f", veins: "#2b52c4", bone: "#e8dec6",
};
const NAMED = { front: 0, left: -Math.PI / 2, right: Math.PI / 2, back: Math.PI };
// best viewing angle per zone (rad, 0 = front, + = toward the subject's left) and the height of body to frame (fraction of stature)
const ZONE_VIEW = { head: [-0.42, 0.2], eyes: [0, 0.17], heart: [0.28, 0.24], lungs: [-0.2, 0.3], gut: [0.12, 0.3], bones: [0.38, 0.62], whole_body: [0, 1] };
const ZLABEL = { head: "Brain and cognition", eyes: "Eyes and vision", heart: "Heart and circulation", lungs: "Lungs and breathing", gut: "Digestion and nutrition", bones: "Bones and muscles" };
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const C = { slate: 0x66738f, wire: new THREE.Color(0.45, 0.85, 1.0), rad: new THREE.Color(1.0, 0.62, 0.25) };

// ---- the reference X-ray shader (app/dev/xray_check.html), plus the scan reveal ----
const xrayVert = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = viewMatrix * wp;
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const xrayFrag = /* glsl */`
uniform vec3 c; uniform float p; uniform float b; uniform float k; uniform float vis;
uniform float uAmt; uniform float uTop; uniform float uScan; uniform float uFade; uniform float uGain;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float passed = step(uScan, vY) * step(vY, uTop);
  float show = max(uAmt, passed) * vis * uFade;
  if (show < 0.004) discard;
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), p);
  float a = clamp(b + k * f, 0.0, 1.0) * show;
  gl_FragColor = vec4(c * (0.55 + 0.9 * f) * uGain, a);
}`;
const wireVert = /* glsl */`
varying float vY;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const wireFrag = /* glsl */`
uniform vec3 color; uniform float uTop; uniform float uScan; uniform float uOn; uniform float uBand;
varying float vY;
void main() {
  if (uOn < 0.01) discard;
  float band = exp(-pow((vY - uScan) / uBand, 2.0));
  // the surface just above the band has dissolved into mesh; the mesh fades out as the X-ray takes over
  float trail = step(uScan, vY) * step(vY, uTop + 0.02) * 0.32 * exp(-(vY - uScan) / (uBand * 10.0));
  float ahead = exp(-max(0.0, uScan - vY) / (uBand * 2.0)) * step(vY, uScan) * 0.35;
  float a = (band * 1.5 + trail + ahead) * uOn;
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

/** Bounding box and vertex centroid of a geometry, optionally limited by a filter on (x, y, z). */
function stats(geom, keep) {
  const p = geom.attributes.position;
  const box = new THREE.Box3();
  const sum = new THREE.Vector3();
  let n = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (keep && !keep(v.x, v.y, v.z)) continue;
    box.expandByPoint(v); sum.add(v); n++;
  }
  return { box, c: n ? sum.divideScalar(n) : box.getCenter(new THREE.Vector3()), n };
}

/** Press the anatomy inside this body (./fit.js) and return the per-node report. Never fatal. */
function fitAnatomy(geom, parts) {
  const plain = (a) => a && a.array instanceof Float32Array && a.itemSize === 3 && !a.isInterleavedBufferAttribute;
  try {
    if (!plain(geom.attributes.position)) return null;
    const fp = {};
    for (const [n, g] of Object.entries(parts)) if (plain(g.attributes.position)) fp[n] = { pos: g.attributes.position.array, index: g.index ? g.index.array : null };
    const { report } = conformAnatomy({ pos: geom.attributes.position.array, index: geom.index ? geom.index.array : null }, fp);
    for (const [n, r] of Object.entries(report)) {
      const g = parts[n];
      if (r.cut) g.setIndex(new THREE.BufferAttribute(fp[n].index, 1));
      if (r.moved || r.fitted) { g.attributes.position.needsUpdate = true; g.computeVertexNormals(); }
      if (r.moved || r.fitted || r.cut) { g.computeBoundingBox(); g.computeBoundingSphere(); }
    }
    return report;
  } catch (e) { console.warn("anatomy fit skipped", e); return null; }
}

const draco = new DRACOLoader().setDecoderPath("vendor/three/jsm/libs/draco/gltf/");
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = {};
/** Load (once) the body and its fitted anatomy for "male" or "female". */
function loadModel(sex) {
  if (cache[sex]) return cache[sex];
  const bodyFile = sex === "female" ? "human_female.glb" : "human.glb";
  cache[sex] = Promise.all([loader.loadAsync(`assets/body3d/${bodyFile}`), loader.loadAsync(`assets/body3d/anatomy_${sex}.glb`)])
    .then(([b, a]) => {
      let geom = null;
      b.scene.traverse((o) => { if (o.isMesh && !geom) geom = o.geometry; });
      if (!geom) throw new Error(`no mesh in ${bodyFile}`);
      if (!geom.attributes.normal) geom.computeVertexNormals();
      const parts = {};
      a.scene.traverse((o) => { if (o.isMesh && NODES.includes(o.name)) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); parts[o.name] = o.geometry; } });
      return { sex, geom, parts, fit: fitAnatomy(geom, parts), wire: new THREE.WireframeGeometry(geom) };
    })
    .catch((e) => { delete cache[sex]; throw e; });
  return cache[sex];
}

const ST_WORD = { ok: "Normal", watch: "Watch", alert: "Alert" };
const ST_ICON = {
  ok: '<path d="M7.5 12.5l3 3 6-6.5"/>',
  watch: '<path d="M12 4l9 16H3z"/><path d="M12 10.5v4M12 17v.3"/>',
  alert: '<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z"/><path d="M12 7.5v6M12 16.3v.4"/>',
};

export async function createBody(world, host, { tablet = false, onZoneClick, onBodyClick, regionOf, model = "male" } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);

  // lights: soft studio key, cool rims, sky/ground fill (refs 03-04)
  scene.add(new THREE.HemisphereLight(0x9aa9c6, 0x0d1424, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(1.6, 3.2, 3.6); scene.add(key);
  const rimL = new THREE.DirectionalLight(0x8fb4ff, 2.4); rimL.position.set(-3, 2.2, -2.6); scene.add(rimL);
  const rimR = new THREE.DirectionalLight(0x9fc0ff, 1.6); rimR.position.set(3, 1.6, -2.4); scene.add(rimR);
  const fill = new THREE.DirectionalLight(0x6f86b8, 0.5); fill.position.set(-2, 0.5, 3); scene.add(fill);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ map: floorShadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002;
  scene.add(shadow);

  // shared uniforms: uAmt = how much X-ray (0 solid .. 1 X-ray), uTop/uScan = the scan band, uFade = model cross-fade
  const U = { uTop: { value: 2.2 }, uScan: { value: 3.0 }, uAmt: { value: 0 }, uFade: { value: 1 }, uGain: { value: 0.72 } };

  const clayMat = new THREE.MeshStandardMaterial({ color: C.slate, roughness: 0.6, metalness: 0.05 });
  clayMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTop = U.uTop; sh.uniforms.uScan = U.uScan;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vWY;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vWY; uniform float uTop; uniform float uScan;")
      .replace("void main() {", "void main() {\n  if (vWY > uScan && vWY < uTop) discard;");
  };

  function xrayMat(col, p, b, k, additive) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { c: { value: new THREE.Color(col) }, p: { value: p }, b: { value: b }, k: { value: k }, vis: { value: 1 }, ...U },
      vertexShader: xrayVert, fragmentShader: xrayFrag,
    });
  }

  const root = new THREE.Group();
  scene.add(root);
  clayMat.transparent = true;   // always: it cross-fades with the X-ray (update) and between models
  const clay = new THREE.Mesh(new THREE.BufferGeometry(), clayMat);
  root.add(clay);
  const skinMat = xrayMat("#4f9dff", 2.0, 0.02, 0.35, true);
  const skin = new THREE.Mesh(clay.geometry, skinMat);
  skin.renderOrder = 10;
  root.add(skin);
  const wireU = { color: { value: C.wire.clone() }, uTop: U.uTop, uScan: U.uScan, uOn: { value: 0 }, uBand: { value: 0.03 } };
  const wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ uniforms: wireU, vertexShader: wireVert, fragmentShader: wireFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  wire.renderOrder = 11;
  root.add(wire);
  const radMat = xrayMat("#ff9e40", 1.4, 0.05, 0.6, true);
  radMat.uniforms.uAmt = { value: 0 };   // its own amount: the radiation layer is independent of the X-ray
  const radShell = new THREE.Mesh(clay.geometry, radMat);
  radShell.scale.setScalar(1.012); radShell.renderOrder = 12; radShell.visible = false;
  root.add(radShell);

  // ---- suit breach: the part of the twin under a leaking suit region glows red and pulses ----
  const breachU = { uT: { value: 0 }, uC: { value: new THREE.Color("#ff2b2b") }, uOp: { value: 0 } };
  const breachMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: breachU,   // light added on top: it reads on both bodies and in X-ray
    vertexShader: "attribute float aB; varying float vB; varying vec3 vN; varying vec3 vV; void main(){ vB = aB; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
    fragmentShader: "uniform float uT; uniform vec3 uC; uniform float uOp; varying float vB; varying vec3 vN; varying vec3 vV; void main(){ if (vB < 0.02) discard; float f = pow(1.0 - abs(dot(vN, vV)), 1.4); float pulse = 0.62 + 0.38 * sin(uT * 5.0); gl_FragColor = vec4(uC * (0.95 + 0.8 * f), vB * (0.62 + 0.38 * f) * pulse * uOp); }",
  });
  const breachShell = new THREE.Mesh(clay.geometry, breachMat);
  breachShell.scale.setScalar(1.016); breachShell.renderOrder = 26; breachShell.visible = false;
  root.add(breachShell);
  let breach = null;   // { region, severity, centre: Vector3 }
  /** Which suit region a body point is under (the same landmarks "where does it hurt?" uses). Person's left is +x. */
  function suitRegionOf(x, y, z, lm, zMid) {
    const ax = Math.abs(x), side = x > 0 ? "left" : "right";
    if (y >= lm.shoulderY) return "helmet";
    if (y < lm.hipY && ax < lm.height * 0.15) return y < lm.ankleY ? `${side}_boot` : `${side}_leg`;
    if (ax > lm.trunkHalf) return ax >= lm.handX ? `${side}_glove` : `${side}_arm`;
    return z < zMid ? "backpack" : "torso";
  }
  function paintBreach() {
    const g = clay.geometry, pos = g.attributes.position;
    if (!pos || !M.landmarks) return;
    const n = pos.count, a = new Float32Array(n), lm = M.landmarks;
    let zs = 0, zc = 0;
    for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y > lm.hipY && y < lm.shoulderY && Math.abs(pos.getX(i)) < lm.trunkHalf) { zs += pos.getZ(i); zc++; } }
    const zMid = zc ? zs / zc : 0;
    const centre = new THREE.Vector3(); let hits = 0;
    if (breach) for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (suitRegionOf(x, y, z, lm, zMid) === breach.region) { a[i] = 1; centre.add(new THREE.Vector3(x, y, z)); hits++; }
    }
    g.setAttribute("aB", new THREE.BufferAttribute(a, 1));
    if (breach) breach.centre = hits ? centre.divideScalar(hits) : new THREE.Vector3(0, lm.height * 0.5, 0);
  }

  // the 18 anatomy nodes; each has its own material whose look eases toward a target every frame
  const anat = new THREE.Group();
  root.add(anat);
  const nodes = {};
  for (const n of NODES) {
    const bone = BONES.includes(n);
    const m = new THREE.Mesh(new THREE.BufferGeometry(), xrayMat(bone ? "#dfe9ff" : COL[n], 1.4, 0.1, 0.45, bone));
    m.name = n;
    m.renderOrder = bone ? 5 : 1;
    anat.add(m);
    nodes[n] = { mesh: m, xm: m.material, u: m.material.uniforms, t: { c: new THREE.Color(), p: 1.4, b: 0.1, k: 0.45, vis: 1, add: bone } };
    // "realistic" look for organ views (brief section 10 item 3): lit PBR with a soft sheen for a tissue rim
    const rc = REAL[n] || (bone ? REAL.bone : "#c98a80");
    const rm = new THREE.MeshPhysicalMaterial({ color: rc, roughness: bone ? 0.62 : 0.46, metalness: 0, sheen: bone ? 0.1 : 0.55,
      sheenColor: new THREE.Color(rc).lerp(new THREE.Color(1, 1, 1), 0.35), sheenRoughness: 0.5, clearcoat: bone ? 0.05 : 0.35, clearcoatRoughness: 0.4 });
    // tissue depth: a soft fresnel rim (light scattering at grazing angles), and on the heart the great
    // vessels (the top of the organ) in a lighter vessel colour, as in ref 13
    rm.userData.u = { uRim: { value: new THREE.Color(rc).lerp(new THREE.Color(1, 0.85, 0.85), 0.55).multiplyScalar(bone ? 0.15 : 0.45) },
      uTopY: { value: 0 }, uSpan: { value: 1 }, uVessel: { value: new THREE.Color("#c4636a") }, uVesselAmt: { value: n === "heart" ? 1 : 0 } };
    rm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, rm.userData.u);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vWY2;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWY2 = (modelMatrix * vec4(transformed, 1.0)).y;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vWY2; uniform vec3 uRim; uniform float uTopY; uniform float uSpan; uniform vec3 uVessel; uniform float uVesselAmt;")
        .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, uVessel, uVesselAmt * smoothstep(uTopY - uSpan * 0.42, uTopY - uSpan * 0.12, vWY2));")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  float rimF = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.6);\n  totalEmissiveRadiance += uRim * rimF;");
    };
    nodes[n].rm = rm;
  }

  // ---- the realistic eye: used whenever the eyes are the focus (organ view, Eyes, an eye check) ----
  // BodyParts3D gives the eyeball's shape only. The surface is painted per pixel from the direction out of
  // each eye's centre (the body faces +z): a black pupil, an iris with radial fibres, crypts, a collarette
  // and a dark limbal ring, then a white sclera that warms toward the back, with fine red vessels that run
  // forward and fade out before the iris. A clear coat gives the wet cornea its highlight. Illustration of
  // a reference eye, not the crew member's own.
  const eyeU = { uEyeA: { value: new THREE.Vector3(0.03, 1.7, 0.1) }, uEyeB: { value: new THREE.Vector3(-0.03, 1.7, 0.1) } };
  const eyeMat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
  eyeMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, eyeU);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vEyeP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEyeP = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vEyeP; uniform vec3 uEyeA; uniform vec3 uEyeB;
float eh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float en(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(eh(i), eh(i + vec2(1.0, 0.0)), f.x), mix(eh(i + vec2(0.0, 1.0)), eh(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 eyeColor(vec3 p) {
  vec3 c = p.x >= 0.0 ? uEyeA : uEyeB;
  vec3 d = normalize(p - c);
  float th = acos(clamp(d.z, -1.0, 1.0));          // 0 at the centre of the pupil
  float ph = atan(d.y, d.x) + (p.x >= 0.0 ? 0.0 : 1.7);
  const float IR = 0.42, PR = 0.15;
  // sclera, warmer toward the back and the corners
  vec3 col = vec3(0.93, 0.90, 0.86);
  col = mix(col, vec3(0.94, 0.77, 0.72), smoothstep(0.9, 2.3, th) * 0.6);
  // vessels: wandering lines that run forward and fade out before the iris
  float w = en(vec2(ph * 3.0, th * 4.0)) * 2.0;
  float v1 = abs(sin(ph * 11.0 + w * 2.2 + th * 1.6));
  float v2 = abs(sin(ph * 23.0 - w * 3.1 + th * 4.2));
  float veins = smoothstep(0.10, 0.0, v1) * 0.9 + smoothstep(0.06, 0.0, v2) * 0.55;
  veins *= smoothstep(IR + 0.1, IR + 0.8, th) * smoothstep(0.25, 0.65, en(vec2(ph * 5.0, th * 9.0)));
  col = mix(col, vec3(0.70, 0.10, 0.12), clamp(veins, 0.0, 0.85));
  // iris
  float r = th / IR, rp = PR / IR;
  vec3 inner = vec3(0.68, 0.47, 0.18), outer = vec3(0.30, 0.19, 0.09);
  vec3 iris = mix(inner, outer, smoothstep(0.35, 0.95, r));
  float fib = en(vec2(ph * 38.0, r * 2.0)) * 0.6 + en(vec2(ph * 90.0, r * 6.0)) * 0.4;
  iris *= 0.6 + 0.8 * fib;
  iris *= 1.0 - 0.35 * smoothstep(0.45, 0.62, en(vec2(ph * 14.0, r * 7.0)));                  // crypts
  iris = mix(iris, inner * 1.3, 0.55 * smoothstep(rp, rp + 0.08, r) * smoothstep(rp + 0.3, rp + 0.12, r));   // collarette
  iris = mix(iris, vec3(0.05, 0.035, 0.03), smoothstep(0.8, 1.0, r));                          // limbal ring
  col = mix(iris, col, smoothstep(0.98, 1.06, r));
  // pupil
  col = mix(vec3(0.008), col, smoothstep(rp - 0.03, rp + 0.03, r));
  return col;
}`).replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb = pow(eyeColor(vEyeP), vec3(2.2));");
  };
  /** The eye material is used for the eyes when they are the focus. */
  const eyeFocus = () => style === "real" || (style === "anatomy" && lit && lit.length === 1 && lit[0] === "eyes");

  // ---- organ pictures: the details box shows the same 3D organ as the organ view, rendered once ----
  let snapR = null;
  const snapCache = {};
  /** A PNG data URL of a zone's organ (the same parts and materials the organ view shows), or null. */
  function snapshot(zone, size = 256) {
    const names = ZONE_NODES[zone];
    if (!names || !current) return null;
    const ck = `${current.sex}:${zone}`;
    if (ck in snapCache) return snapCache[ck];
    try {
      if (!snapR) {
        snapR = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        snapR.setPixelRatio(1); snapR.setSize(size, size, false); snapR.setClearColor(0x000000, 0);
        snapR.outputColorSpace = THREE.SRGBColorSpace; snapR.toneMapping = THREE.ACESFilmicToneMapping;
      }
      const sc = new THREE.Scene();
      // the organ-view lighting (retarget, style "real")
      sc.add(new THREE.HemisphereLight(0x9aa9c6, 0x0d1424, 0.95));
      for (const [col, i, p] of [[0xffffff, 1.05, key.position], [0x8fb4ff, 1.6, rimL.position], [0x9fc0ff, 1.6, rimR.position], [0x6f86b8, 0.95, fill.position]]) {
        const l = new THREE.DirectionalLight(col, i); l.position.copy(p); sc.add(l);
      }
      const box = new THREE.Box3();
      for (const n of names) {
        const g = current.parts[n];
        if (!g) continue;
        sc.add(new THREE.Mesh(g, n === "eyes" ? eyeMat : nodes[n].rm));
        g.computeBoundingBox(); box.union(g.boundingBox);
      }
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const cam2 = new THREE.PerspectiveCamera(30, 1, 0.01, 30);
      const r = Math.max(s.x, s.y) / 2;
      cam2.position.set(c.x, c.y, c.z + (r / Math.tan(THREE.MathUtils.degToRad(15))) * 1.15 + s.z / 2);
      cam2.lookAt(c);
      snapR.render(sc, cam2);
      snapCache[ck] = snapR.domElement.toDataURL("image/png");
    } catch (e) { console.warn("organ picture failed", e); snapCache[ck] = null; }
    return snapCache[ck];
  }

  // ---- measurement rings (ref 04), placed from slices of the loaded body ----
  const ringGroup = new THREE.Group();
  root.add(ringGroup);
  let rings = {};
  const ZONE_RING = { head: "head", eyes: "head", lungs: "chest", heart: "chest", gut: "waist", bones: "thighs", whole_body: null };
  let activeRing = null;

  // ---- per-model geometry facts (filled by applyModel) ----
  let M = null;                 // { sex, height, top, anchors, spans, centroids }
  const anchors = {};
  const spans = {};

  function sliceRing(geom, y, keep) {
    const s = stats(geom, (x, yy, z) => Math.abs(yy - y) < 0.012 && keep(x, z));
    if (s.n < 6) return null;
    const c = s.box.getCenter(new THREE.Vector3()), sz = s.box.getSize(new THREE.Vector3());
    return { x: c.x, y, z: c.z, rx: sz.x / 2 * 1.06 + 0.004, rz: sz.z / 2 * 1.08 + 0.004 };
  }

  const ray = new THREE.Raycaster();
  /** Put a point on the body surface: cast from the zone's viewing direction toward an inner point. */
  function surfacePoint(inner, az, bodyMesh) {
    const dir = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
    const from = inner.clone().addScaledVector(dir, 1.2);
    ray.set(from, dir.clone().negate());
    const hit = ray.intersectObject(bodyMesh, false)[0];
    return hit ? hit.point.clone().addScaledVector(dir, 0.006) : inner.clone().addScaledVector(dir, 0.12);
  }

  function applyModel(m) {
    clay.geometry = skin.geometry = radShell.geometry = breachShell.geometry = m.geom;
    wire.geometry = m.wire;
    for (const n of NODES) {
      nodes[n].mesh.geometry = m.parts[n] || new THREE.BufferGeometry(); nodes[n].mesh.visible = !!m.parts[n];
      if (m.parts[n]) { m.parts[n].computeBoundingBox(); const bb = m.parts[n].boundingBox; nodes[n].rm.userData.u.uTopY.value = bb.max.y; nodes[n].rm.userData.u.uSpan.value = bb.max.y - bb.min.y; }
    }
    m.geom.computeBoundingBox();
    const bb = m.geom.boundingBox, h = bb.max.y - bb.min.y;
    const P = (n, keep) => (m.parts[n] ? stats(m.parts[n], keep) : { box: new THREE.Box3(new THREE.Vector3(0, h * 0.5, 0), new THREE.Vector3(0, h * 0.5, 0)), c: new THREE.Vector3(0, h * 0.5, 0.05), n: 0 });
    const brain = P("brain"), eyes = P("eyes"), heart = P("heart"), lungR = P("lungs", (x) => x < 0), lungs = P("lungs"), skull = P("skull");
    // each eyeball's centre, for the realistic eye (the iris faces +z from it)
    if (m.parts.eyes) for (const [u, keep] of [[eyeU.uEyeA, (x) => x >= 0], [eyeU.uEyeB, (x) => x < 0]]) {
      const e = stats(m.parts.eyes, keep);
      if (e.n) e.box.getCenter(u.value);
    }
    const gutY0 = P("intestines").box.min.y, liver = P("liver"), ribs = P("ribcage"), pelvis = P("pelvis");
    const intest = P("intestines", (x, y) => y < pelvis.box.max.y + h * 0.06);
    const knee = P("limbs", (x, y) => x > 0.02 && y > h * 0.25 && y < h * 0.3);
    const inner = {
      head: brain.c, eyes: eyes.c, heart: heart.c, lungs: lungR.c,
      gut: new THREE.Vector3(intest.c.x, (intest.c.y + liver.c.y) / 2, intest.c.z), bones: knee.c,
      whole_body: new THREE.Vector3(ribs.box.min.x * 0.8, (ribs.box.min.y + ribs.box.max.y) / 2, 0.05),
    };
    for (const z of Object.keys(inner)) {
      const az = ZONE_VIEW[z][0];
      const p = surfacePoint(inner[z], z === "whole_body" ? -1.2 : az, clay);
      anchors[z] = [p.x, p.y, p.z];
    }
    const pad = h * 0.015;
    Object.assign(spans, {
      head: [skull.box.max.y + pad, skull.box.min.y], eyes: [eyes.box.max.y + pad * 2, eyes.box.min.y - pad * 2],
      heart: [heart.box.max.y + pad, heart.box.min.y - pad], lungs: [lungs.box.max.y + pad, lungs.box.min.y - pad],
      gut: [liver.box.max.y + pad, gutY0 - pad], bones: [bb.max.y + pad, bb.min.y - 0.02], whole_body: [bb.max.y + pad, bb.min.y - 0.02],
    });
    M = { sex: m.sex, height: h, top: bb.max.y + 0.03, inner };
    // landmarks for pointing ("where does it hurt?"), from this model's own anatomy
    M.landmarks = {
      height: h, chinY: skull.box.min.y, eyeY: eyes.c.y, eyeHalf: Math.max(0.018, (eyes.box.max.y - eyes.box.min.y) * 0.9),
      shoulderY: ribs.box.max.y, waistY: ribs.box.min.y, hipY: Math.min(pelvis.box.min.y, h * 0.5), ankleY: h * 0.05,
      trunkHalf: ribs.box.max.x + 0.045, handX: bb.max.x - h * 0.07,
    };
    // rings: head at the eyes, chest across the lungs, waist above the pelvis, both thighs
    ringGroup.clear();
    rings = {};
    const torsoW = ribs.box.max.x + 0.02;
    const add = (name, r) => {
      if (!r) return;
      const l = new THREE.Line(ellipse(r.rx, r.rz), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
      l.position.set(r.x, r.y, r.z);
      ringGroup.add(l);
      (rings[name] ||= []).push(l);
    };
    add("head", sliceRing(m.geom, eyes.c.y + 0.01, () => true));
    add("chest", sliceRing(m.geom, (lungs.box.min.y + lungs.box.max.y) / 2, (x) => Math.abs(x) < torsoW));
    add("waist", sliceRing(m.geom, pelvis.box.max.y + h * 0.035, (x) => Math.abs(x) < torsoW));
    for (const s of [-1, 1]) add("thighs", sliceRing(m.geom, h * 0.38, (x) => x * s > 0.01 && x * s < torsoW));
    shadow.scale.setScalar(h / 1.89);
    for (const k in hot) placeHot(k);
    resize(W, H);
    if (breach) { breach.centre = null; paintBreach(); }
  }

  // ---- camera, controls ----
  const controls = new OrbitControls(camera, host);
  // The body tools, zoom buttons and the zone card sit inside the host. OrbitControls captures the pointer
  // on every press there, so the release (and the click) went to the host and those buttons never fired.
  // A press that starts on a control does not start an orbit; it is handed back on release.
  const UI = "button, a, input, select, textarea, label, .card, .zone-pop, .body-tools, .body-zoom";
  let heldOff = false;
  host.addEventListener("pointerdown", (e) => {
    if (controls.enabled && e.target !== host && e.target.closest?.(UI)) { controls.enabled = false; heldOff = true; }
  }, true);
  const release = () => { if (heldOff) { heldOff = false; if (!camTween) controls.enabled = true; } };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 0.45; controls.maxDistance = 6.5;
  controls.minPolarAngle = Math.PI * 0.3; controls.maxPolarAngle = Math.PI * 0.6;
  controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8;
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
  let frameRect = null;   // an override: the free 3D area when a sheet covers part of the host (organ view)
  function readHost() {
    if (frameRect) { hostR = frameRect; return; }
    const r = host.getBoundingClientRect();
    if (r.width > 10 && r.height > 10) hostR = r;
  }
  /** Distance at which `frameH` metres of body (and `frameW` across) fill the host area. */
  function distFor(frameH, frameW) {
    readHost();
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const needH = (frameH * H) / (2 * half * hostR.height);
    const needW = (frameW * W) / (2 * half * camera.aspect * hostR.width);
    return Math.max(needH, needW);
  }
  const homeY = () => (M ? M.height * 0.52 : 0.98);
  function fitDist() { const h = M?.height || 1.89; return distFor(h * 1.14, h * 0.78); }
  function frameOffset() {
    camera.setViewOffset(W, H, W / 2 - (hostR.left + hostR.width / 2), H / 2 - (hostR.top + hostR.height / 2) + hostR.height * 0.02, W, H);
  }
  let moved = false;
  function resize(w, h) {
    W = w; H = h; camera.aspect = w / h; camera.updateProjectionMatrix();
    const wasHome = Math.abs(cam.dist - homeDist) < 0.05;
    homeDist = fitDist();
    controls.maxDistance = homeDist * 1.4;
    frameOffset();
    if (wasHome || !moved) { cam.dist = homeDist; cam.ty = homeY(); applyCam(); }
  }
  controls.addEventListener("start", () => { moved = true; killTween(); });
  applyCam();

  let camTween = null;
  function killTween() { camTween?.kill(); camTween = null; controls.enabled = true; }
  /** Ease the camera to {az, dist, y, x, z, el}. Never snaps (unless reduced motion). */
  function moveCam(to, seconds = 1.2) {
    readCam();
    killTween();
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

  // ---- hotspots (DOM, projected every frame) ----
  const hot = {};
  const hotLayer = document.getElementById("hotspots");
  for (const z of Object.keys(ZLABEL)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "zone is-ok"; b.id = `zone-${z}`; b.dataset.zone = z;
    b.setAttribute("aria-label", ZLABEL[z]);
    b.innerHTML = `<span class="zdot"><svg viewBox="0 0 24 24" aria-hidden="true">${ST_ICON.ok}</svg></span><span class="zstat">${ST_WORD.ok}</span><span class="zname">${ZLABEL[z]}</span><span class="zchip" hidden></span>`;
    b.addEventListener("click", (e) => { e.stopPropagation(); onZoneClick?.(z, b); });
    hotLayer.appendChild(b);
    hot[z] = b;
  }
  function placeHot() { /* positions are projected every frame */ }
  const v3 = new THREE.Vector3(), out = new THREE.Vector3(), toCam = new THREE.Vector3();
  function project(zone) {
    const a = anchors[zone] || [0, 1, 0];
    v3.set(a[0], a[1], a[2]).project(camera);
    return { x: (v3.x + 1) / 2 * W, y: (1 - v3.y) / 2 * H, z: v3.z };
  }
  function facing(zone) {
    const a = anchors[zone];
    if (!a || !M) return false;
    const c = M.inner[zone];
    out.set(a[0] - c.x, 0, a[2] - c.z).normalize();
    toCam.set(camera.position.x - a[0], 0, camera.position.z - a[2]).normalize();
    return out.dot(toCam) > -0.1;
  }
  function updateHotspots() {
    for (const z in hot) {
      const p = project(z);
      const el = hot[z];
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      // only inside the visible 3D area: never under the rail, a sheet or the screen edge
      const m = 10, L = hostR.left + m, R = hostR.left + hostR.width - m, T = hostR.top + m, B = hostR.top + hostR.height - m;
      const vis = U.uFade.value > 0.5 && facing(z) && p.x > L && p.x < R && p.y > T && p.y < B;
      el.classList.toggle("is-hidden", !vis);
      // the chip goes on the side with room (about 150 px); prefer the outer side of the body
      if (el.classList.contains("has-chip")) {
        const outerLeft = (anchors[z]?.[0] ?? 0) < -0.02;
        const roomL = p.x - L, roomR = R - p.x;
        el.classList.toggle("chip-left", roomR < 150 ? true : roomL < 150 ? false : outerLeft);
      }
    }
  }

  // ---- pointing: a tap on the body itself names the region under the finger (BODY-1, BODY-6) ----
  const tapRay = new THREE.Raycaster(), ndc = new THREE.Vector2(), nrm = new THREE.Vector3();
  function regionAt(clientX, clientY) {
    if (!M || !regionOf) return null;
    ndc.set((clientX / W) * 2 - 1, -((clientY / H) * 2 - 1));
    tapRay.setFromCamera(ndc, camera);
    const hit = tapRay.intersectObject(clay, false)[0];
    if (!hit) return null;
    const back = hit.face ? nrm.copy(hit.face.normal).z < -0.25 : false;
    const p = { x: hit.point.x, y: hit.point.y, z: hit.point.z, back };
    return { region: regionOf(p, M.landmarks), point: [p.x, p.y, p.z], back };
  }
  let pointing = false, down = null;
  host.addEventListener("pointerdown", (e) => { down = e.isPrimary !== false ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
  host.addEventListener("pointerup", (e) => {
    const d = down; down = null;
    // a tap, not a drag to turn the body, and not on a control laid over the 3D area
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return;
    if (e.target.closest?.("button, a, input, select, .card, .zone-pop")) return;
    const r = regionAt(e.clientX, e.clientY);
    if (r) onBodyClick?.({ ...r, x: e.clientX, y: e.clientY, pointing });
  });

  // ---- looks ----
  let style = "radiograph";       // radiograph | anatomy | real
  let lit = null;                 // array of node names in full colour, or null for all
  const tmpC = new THREE.Color();
  function retarget() {
    const real = style === "real";
    for (const n of NODES) {
      const t = nodes[n].t, bone = BONES.includes(n), node = nodes[n];
      const want = n === "eyes" && eyeFocus() ? eyeMat : real ? node.rm : node.xm;
      if (node.mesh.material !== want) node.mesh.material = want;
      const on = !lit || lit.includes(n);
      // a focused organ draws after the bones, so the ribs or the skull glow behind it, not over it
      node.mesh.renderOrder = real ? 0 : bone ? 5 : lit && on ? 8 : 1;
      node.mesh.visible = !real || !lit || lit.includes(n);
      if (real) continue;
      // blending never changes: bones add light (X-ray glow), organs blend normally. Switching mode while
      // an organ fades in or out made it pop for a frame.
      if (style === "radiograph") {
        if (bone) Object.assign(t, { p: 1.2, b: 0.3, k: 0.55, vis: 1, add: true }), t.c.set("#eef5ff");
        else Object.assign(t, { p: 2.0, b: 0.015, k: 0.1, vis: n === "arteries" || n === "veins" ? 0 : 1, add: false }), t.c.set("#7f95ad");
      } else {
        // with an organ in focus the bones step right back, or the ribcage washes over the heart
        const organFocus = lit && lit.some((x) => !BONES.includes(x));
        if (bone) Object.assign(t, { p: 1.3, b: on ? (lit ? 0.16 : 0.1) : organFocus ? 0.012 : 0.04, k: on ? (lit ? 0.6 : 0.45) : organFocus ? 0.07 : 0.2, vis: 1, add: true }), t.c.set("#dfe9ff");
        else Object.assign(t, { p: 1.6, b: on ? (lit ? 0.7 : 0.55) : 0.03, k: on ? 0.45 : 0.1, vis: 1, add: false }), t.c.set(COL[n]);
      }
    }
    const radio = style === "radiograph";
    skinMat.uniforms.c.value.set(radio ? "#9fb9d6" : "#4f9dff");
    skinMat.uniforms.vis.value = real ? 0 : 1;   // an organ view shows the organ alone (refs 13-14)
    // a softer key and a warmer fill for the lit organ views; the studio set-up otherwise
    key.intensity = real ? 1.05 : 1.7; fill.intensity = real ? 0.95 : 0.5; rimL.intensity = real ? 1.6 : 2.4;
  }
  retarget();

  // ---- state ----
  const zoneSev = {};
  let targetZone = null, xrayOn = false, radOn = false, pulseT = 0;
  let hostCheck = 0;
  function update(dt, t) {
    if ((hostCheck += dt) > 0.5) { hostCheck = 0; const before = hostR.width + hostR.height + hostR.left; readHost(); if (hostR.width + hostR.height + hostR.left !== before) resize(W, H); }
    frameOffset();
    if (controls.enabled) controls.update();
    pulseT += dt;
    const xa = U.uAmt.value;
    // The solid body cross-fades with the X-ray. It used to stay opaque, hiding everything inside it,
    // until the X-ray was 98% in and then vanish in one frame: a flash on every check, tap and toggle.
    // While the X-ray shows through it draws after the anatomy (which writes no depth), so it is a veil
    // over it; during a mesh scan it stays first so the scan band draws over it.
    const scanning = wireU.uOn.value > 0.01;
    const clayA = (1 - xa * xa * (3 - 2 * xa)) * U.uFade.value;
    clay.visible = clayA > 0.01;
    clayMat.opacity = clayA;
    clay.renderOrder = xa > 0.004 && !scanning ? 20 : 0;
    const k = Math.min(1, dt * 3.2);
    const pulse = targetZone && (zoneSev[targetZone] === "alert" || zoneSev[targetZone] === "watch") ? 0.18 * (0.5 + 0.5 * Math.sin(pulseT * 4.2)) : 0;
    const anyX = xa > 0.004 || wireU.uOn.value > 0.01;
    anat.visible = anyX;
    skin.visible = anyX;
    for (const n of NODES) {
      const { u, t: tg, mesh } = nodes[n];
      if (mesh.material !== nodes[n].xm) continue;   // realistic material: lit by the scene, nothing to ease
      u.c.value.lerp(tg.c, k);
      u.p.value += (tg.p - u.p.value) * k;
      u.b.value += (tg.b - u.b.value) * k;
      const litNow = lit && lit.includes(n);
      u.k.value += (tg.k + (litNow ? pulse : 0) - u.k.value) * k;
      u.vis.value += (tg.vis - u.vis.value) * k;
      const blend = tg.add ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (mesh.material.blending !== blend) mesh.material.blending = blend;   // fixed per node (retarget)
    }
    ringGroup.visible = style !== "real";
    for (const name in rings) for (const l of rings[name]) {
      const act = name === activeRing;
      const op = (act ? 0.95 : xa > 0.5 ? 0.06 : 0.2) * U.uFade.value;
      l.material.opacity += (op - l.material.opacity) * Math.min(1, dt * 5);
      l.material.color.lerp(tmpC.set(act ? 0x6fd0ff : 0xffffff), Math.min(1, dt * 5));
    }
    if (radOn) radMat.uniforms.uAmt.value = 0.55 + 0.25 * Math.sin(t * 2.2);
    breachU.uT.value = t;
    breachU.uOp.value += ((breach ? (breach.severity === "breach" ? 1 : 0.7) : 0) - breachU.uOp.value) * Math.min(1, dt * 4);
    breachU.uC.value.set(breach?.severity === "watch" ? "#ffb02e" : "#ff2b2b");
    breachShell.visible = breachU.uOp.value > 0.01;
    // X-ray reads on near-black with little bloom; the solid body keeps the navy studio
    const xv = style === "real" ? 0 : Math.max(xa, wireU.uOn.value * 0.6);   // organ views keep the theme's own backdrop
    world.setSkyFade(1 - 0.82 * xv);
    world.setBloom(world.bloomBase * (1 - 0.72 * xv));
    updateHotspots();
  }

  // ---- load the first model ----
  let current = await loadModel(model === "female" ? "female" : "male");
  applyModel(current);
  let switching = null;

  const api = {
    scene, camera, update, resize,
    onHide() { world.setSkyFade(1); world.setBloom(world.bloomBase); },
    hotspots: hot,
    zoneEl: (z) => hot[z] || null,
    anchorWorld: (z) => anchors[z],
    get model() { return current.sex; },
    get height() { return M.height; },
    get top() { return M.top; },
    zoneSpan: (z) => spans[z] || spans.whole_body,
    snapshot,
    regionAt,
    get landmarks() { return { ...M.landmarks }; },
    /** Pointing mode: the next tap on the body is an answer to "where does it hurt?". */
    setPointing(on) { pointing = !!on; host.classList.toggle("is-pointing-mode", pointing); },
    get pointing() { return pointing; },
    screenPoint(z) { const p = project(z); return { x: p.x, y: p.y }; },
    /** Suit breach on the twin: region ("left_glove", "helmet", ...) glows red; null clears it. */
    setBreach(region, severity = "breach") {
      const was = breach?.region;
      breach = region ? { region, severity } : null;
      if (region !== was || !breach?.centre) paintBreach();
    },
    /** Where the breach is on screen (for its label), or null. */
    breachScreen() {
      if (!breach?.centre) return null;
      const v = breach.centre.clone(); root.localToWorld(v); v.project(camera);   // same mapping as the zone hotspots
      return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, behind: v.z > 1 };
    },
    setZoneStates(zones) {
      for (const z of Object.keys(ZLABEL)) {
        const st = zones?.[z] || "ok";
        zoneSev[z] = st;
        const key = st === "alert" ? "alert" : st === "watch" || st === "info" ? "watch" : "ok";
        const cls = `is-${key}`;
        const el = hot[z];
        if (!el.classList.contains(cls) || !el.dataset.st) {
          el.classList.remove("is-ok", "is-watch", "is-alert"); el.classList.add(cls);
          // colour, icon and word together (BODY-7): the shape and the word change with the status
          el.dataset.st = key;
          el.querySelector(".zdot svg").innerHTML = ST_ICON[key];
          el.querySelector(".zstat").textContent = ST_WORD[key];
          el.setAttribute("aria-label", `${ZLABEL[z]}: ${ST_WORD[key]}`);
        }
      }
    },
    setTarget(z) {
      targetZone = z && z !== "whole_body" ? z : null;
      for (const k in hot) hot[k].classList.toggle("is-target", k === targetZone);
      activeRing = z ? ZONE_RING[z] : null;
    },
    setRing(name) { activeRing = name; },
    /** Data chips pinned to the body (ref 14): {zone: {text, badge}}; a missing zone hides its chip. */
    setChips(map) {
      for (const z in hot) {
        const c = hot[z].querySelector(".zchip"), v = map?.[z];
        const key = v ? `${v.text}|${v.badge}` : "";
        if (c.dataset.k === key) continue;
        c.dataset.k = key;
        c.hidden = !v;
        if (v) c.innerHTML = `${v.text}<em>${v.badge}</em>`;
        hot[z].classList.toggle("has-chip", !!v);
        // side is chosen every frame in updateHotspots (outer side of the body, or wherever there is room)
      }
    },
    /** Frame inside this screen rect {left, top, width, height} (px) instead of the host; null restores. */
    setFrameRect(rect) { frameRect = rect && rect.width > 40 && rect.height > 40 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null; readHost(); frameOffset(); if (!rect) controls.minDistance = 0.45; },
    zoomBy(f, seconds = 0.5) { readCam(); return moveCam({ az: cam.az, dist: Math.min(controls.maxDistance, Math.max(controls.minDistance, cam.dist * f)), y: cam.ty, x: cam.tx, z: cam.tz, el: cam.el }, seconds); },
    showRadiation(on) { radOn = !!on; radShell.visible = radOn; if (!on) radMat.uniforms.uAmt.value = 0; },
    get radiationOn() { return radOn; },
    /** X-ray on or off, eased. Optional style: "radiograph" | "anatomy". */
    setXray(on, seconds = 0.8, xstyle) {
      xrayOn = !!on;
      if (xstyle) api.setStyle(xstyle);
      const g = window.gsap;
      if (!g || reduced() || seconds === 0) { U.uAmt.value = on ? 1 : 0; return Promise.resolve(); }
      return new Promise((res) => g.to(U.uAmt, { value: on ? 1 : 0, duration: seconds, ease: "power2.inOut", overwrite: true, onComplete: res, onInterrupt: res }));
    },
    get xray() { return xrayOn; },
    get style() { return style; },
    get lit() { return lit ? [...lit] : null; },
    setStyle(s) { style = s === "anatomy" || s === "real" ? s : "radiograph"; retarget(); },
    /** Anatomy with only these nodes (or a zone's nodes) in full colour; null lights everything. */
    focus(zoneOrNodes) {
      if (!zoneOrNodes) lit = null;
      else if (Array.isArray(zoneOrNodes)) lit = zoneOrNodes.filter((n) => NODES.includes(n));
      else if (zoneOrNodes in ZONE_NODES) lit = ZONE_NODES[zoneOrNodes] ? [...ZONE_NODES[zoneOrNodes]] : null;
      else if (zoneOrNodes in PART_GROUPS) lit = [...PART_GROUPS[zoneOrNodes]];
      else if (NODES.includes(zoneOrNodes)) lit = [zoneOrNodes];
      else lit = null;
      style = style === "real" ? "real" : "anatomy";
      retarget();
    },
    /** Frame a node (or group) in X-ray anatomy, everything else dimmed. */
    async isolate(part, seconds = 1.2) {
      api.focus(part);
      const names = lit || NODES;
      const box = new THREE.Box3();
      for (const n of names) { const g = current.parts[n]; if (g) { g.computeBoundingBox(); box.union(g.boundingBox); } }
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const real = style === "real";
      let dist, tx = c.x * 0.5, tz = 0;
      if (real) {
        // organ view: fit the bounding sphere in the free area with about 15% margin, centred on the organ
        const r = s.length() / 2;
        dist = distFor(2 * r * 1.3, 2 * r * 1.3) + r * 0.5;
        tx = c.x; tz = c.z;
        controls.minDistance = Math.min(0.45, dist * 0.5);
      } else {
        // a small organ (the heart, the eyes) is framed with some of its surroundings, so it reads as a
        // part of the body; framed tight, the camera sat inside the ribcage and the ribs filled the view
        dist = Math.max(distFor(Math.max(s.y * 1.4, M.height * 0.17), Math.max(s.x * 1.5, 0.26)), controls.minDistance);
      }
      await Promise.all([api.setXray(true, reduced() ? 0 : 0.8), moveCam({ az: 0, dist: Math.min(dist, homeDist), y: c.y, x: tx, z: tz, el: 0.04 }, reduced() ? 0 : seconds)]);
    },
    /** Start a mesh scan from `top` (metres). The band then moves with sweepTo(). */
    beginScan(top) {
      const t0 = top ?? M.top;
      api.setStyle("radiograph");
      U.uTop.value = t0; U.uScan.value = t0 + 0.04; wireU.uOn.value = 1;
      wireU.uBand.value = Math.max(0.012, M.height * 0.016);
    },
    sweepTo(y, seconds) {
      const g = window.gsap;
      if (!g || reduced() || !seconds) { U.uScan.value = y; return Promise.resolve(); }
      return new Promise((res) => g.to(U.uScan, { value: y, duration: seconds, ease: "none", overwrite: true, onComplete: res, onInterrupt: res }));
    },
    get scanY() { return U.uScan.value; },
    /** End the scan: the mesh resolves into the X-ray (radiograph). */
    async endScan(toXray = true, seconds = 0.9) {
      const g = window.gsap;
      if (toXray) xrayOn = true;
      if (!g || reduced()) { if (toXray) U.uAmt.value = 1; wireU.uOn.value = 0; U.uScan.value = 3; U.uTop.value = 2.2; return; }
      await Promise.all([
        new Promise((r) => g.to(U.uAmt, { value: toXray ? 1 : U.uAmt.value, duration: seconds, ease: "power2.inOut", onComplete: r, onInterrupt: r })),
        new Promise((r) => g.to(wireU.uOn, { value: 0, duration: seconds * 1.3, ease: "power2.in", onComplete: r, onInterrupt: r })),
      ]);
      U.uScan.value = 3; U.uTop.value = 2.2;
    },
    cancelScan() { window.gsap?.killTweensOf(U.uScan); wireU.uOn.value = 0; U.uScan.value = 3; U.uTop.value = 2.2; },
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
      const [az, frac] = ZONE_VIEW[zone] || ZONE_VIEW.whole_body;
      const c = M.inner[zone];
      const dist = Math.max(controls.minDistance, distFor(M.height * frac, M.height * frac * 0.9));
      return moveCam({ az, dist, y: c.y, x: c.x * 0.6, z: c.z * 0.5, el: 0.05 }, seconds);
    },
    zoomReset(seconds = 1.1) { moved = false; return moveCam({ az: 0, dist: homeDist, y: homeY(), x: 0, z: 0, el: 0.06 }, seconds); },
    isZoomed: () => cam.dist < homeDist * 0.8 || Math.abs(cam.dist - homeDist) > 0.3,
    get view() { readCam(); return { az: THREE.MathUtils.radToDeg(cam.az), dist: cam.dist, home: homeDist }; },
    /** Switch to the male or female body and anatomy with a cross-fade. */
    async setModel(sex) {
      sex = sex === "female" ? "female" : "male";
      if (sex === current.sex) return switching || undefined;
      const job = (async () => {
        const next = await loadModel(sex);
        const g = window.gsap;
        const fade = (v, s) => (g && !reduced() ? new Promise((r) => g.to(U.uFade, { value: v, duration: s, ease: "power2.inOut", onComplete: r, onInterrupt: r })) : (U.uFade.value = v, Promise.resolve()));
        await fade(0, 0.45);
        current = next;
        applyModel(next);
        if (!moved) { cam.dist = homeDist; cam.ty = homeY(); applyCam(); }
        await fade(1, 0.6);
      })();
      switching = job;
      try { await job; } finally { if (switching === job) switching = null; }
    },
    preload(sex) { loadModel(sex).catch(() => {}); },
    controls,
    nodes: Object.fromEntries(NODES.map((n) => [n, nodes[n].mesh])),
    debug: () => ({ anchors: { ...anchors }, spans: { ...spans }, height: M.height, model: current.sex, style, lit, amt: U.uAmt.value, fit: current.fit }),
  };
  return api;
}
