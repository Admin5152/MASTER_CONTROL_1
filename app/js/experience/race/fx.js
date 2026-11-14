// Slipstream effects ("juice"): particle bursts, shockwave rings, speed streaks around the camera, an
// engine trail and trauma-based camera shake (shake = trauma^2, so small bumps barely move the view and
// big hits read clearly; it decays smoothly). Every effect scales with importance and is skipped when the
// person prefers reduced motion. Also builds the realistic asteroid and the holographic power-up beacon.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = glowTexture();

export function createFx(scene, camera) {
  // ---- particle bursts (pooled) ----
  const MAXP = 600;
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pVel = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pMax = new Float32Array(MAXP);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.35, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(pGeo, pMat); pts.frustumCulled = false; scene.add(pts);
  let pNext = 0;
  const col = new THREE.Color();
  function burst(pos, color, n = 70, speed = 9, life = 0.9) {
    if (reduced()) n = Math.min(n, 12);
    col.set(color);
    for (let k = 0; k < n; k++) {
      const i = pNext; pNext = (pNext + 1) % MAXP;
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      pPos.set([pos.x, pos.y, pos.z], i * 3); pVel.set([v.x, v.y, v.z], i * 3);
      const w = 0.7 + Math.random() * 0.3; pCol.set([col.r * w, col.g * w, col.b * w], i * 3);
      pLife[i] = pMax[i] = life * (0.6 + Math.random() * 0.4);
    }
  }

  // ---- shockwave rings ----
  const rings = [];
  const ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 64);
  function shock(pos, quat, color, size = 6) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos); m.quaternion.copy(quat); scene.add(m);
    rings.push({ m, t: 0, size });
  }

  // ---- speed streaks: thin lines in camera space, stretched by speed ----
  const NS = 140;
  const sPos = new Float32Array(NS * 6), seeds = [];
  for (let i = 0; i < NS; i++) { const a = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 5; seeds.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, z: -Math.random() * 60, s: 0.6 + Math.random() * 0.8 }); }
  const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  const sMat = new THREE.LineBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const streaks = new THREE.LineSegments(sGeo, sMat); streaks.frustumCulled = false; camera.add(streaks);
  if (!camera.parent) scene.add(camera);

  // ---- engine trail: a fading ribbon of recent positions ----
  const NT = 14;
  const tPos = new Float32Array(NT * 3), tCol = new Float32Array(NT * 3);
  const tGeo = new THREE.BufferGeometry(); tGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3)); tGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
  const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  trail.frustumCulled = false; scene.add(trail);
  const trailPts = [];
  const trailCol = new THREE.Color(0x6fd0ff), boostCol = new THREE.Color(0xff86d9);

  // ---- camera shake (trauma model) ----
  let trauma = 0, time = 0;
  const shake = new THREE.Vector3();
  function addTrauma(x) { if (!reduced()) trauma = Math.min(1, trauma + x); }

  function update(dt, { speed = 1, boost = false, emitter = null } = {}) {
    time += dt;
    // particles
    for (let i = 0; i < MAXP; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      const k = Math.max(0, pLife[i] / pMax[i]);
      pVel[i * 3] *= 0.96; pVel[i * 3 + 1] *= 0.96; pVel[i * 3 + 2] *= 0.96;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pLife[i] <= 0) { pPos[i * 3 + 1] = -1e5; continue; }
      pCol[i * 3] *= 0.5 + 0.5 * k; pCol[i * 3 + 1] *= 0.5 + 0.5 * k; pCol[i * 3 + 2] *= 0.5 + 0.5 * k;
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    // rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt;
      const k = r.t / 0.6;
      r.m.scale.setScalar(0.5 + k * r.size); r.m.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
    }
    // streaks: visible only when fast
    const sp = Math.max(0, speed - 1.05);
    sMat.opacity = reduced() ? 0 : Math.min(0.75, sp * 1.6 + (boost ? 0.35 : 0));
    const len = 1.5 + sp * 9 + (boost ? 5 : 0);
    for (let i = 0; i < NS; i++) {
      const s = seeds[i];
      s.z += dt * (40 + 140 * sp + (boost ? 120 : 0)) * s.s;
      if (s.z > 2) s.z -= 62;
      sPos.set([s.x, s.y, s.z, s.x, s.y, s.z - len * s.s], i * 6);
    }
    sGeo.attributes.position.needsUpdate = true;
    // trail
    if (emitter) {
      trailPts.unshift(emitter.clone());
      if (trailPts.length > NT) trailPts.pop();
      const c = boost ? boostCol : trailCol;
      for (let i = 0; i < NT; i++) {
        const p = trailPts[Math.min(i, trailPts.length - 1)];
        tPos.set([p.x, p.y, p.z], i * 3);
        const k = (1 - i / NT) * (0.4 + 0.6 * Math.min(1, speed));
        tCol.set([c.r * k, c.g * k, c.b * k], i * 3);
      }
      tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true;
    }
    // shake
    trauma = Math.max(0, trauma - dt * 1.4);
    const s = trauma * trauma * 0.6;
    shake.set(Math.sin(time * 47.1) * s, Math.sin(time * 39.7 + 1.3) * s, 0);
    return shake;
  }

  function dispose() {
    camera.remove(streaks);
    for (const o of [pts, trail]) scene.remove(o);
    rings.forEach((r) => scene.remove(r.m));
    [pGeo, sGeo, tGeo].forEach((g) => g.dispose());
  }
  return { burst, shock, addTrauma, update, dispose };
}

// ---------- a realistic asteroid: displaced rock with a PBR surface ----------
function fbm3(x, y, z) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 4; i++) { s += a * (Math.sin(x * 1.7 + y * 2.3) * Math.cos(y * 1.3 - z * 2.1) * Math.sin(z * 1.9 + x * 0.7)); x *= 2.1; y *= 2.1; z *= 2.1; a *= 0.5; }
  return s;
}
export function makeAsteroid(seed, rockMat, detail = 3) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail));   // shared vertices: smooth shading, no facets
  const P = g.attributes.position, v = new THREE.Vector3();
  const sx = 0.8 + ((seed * 13) % 7) / 12, sy = 0.65 + ((seed * 7) % 5) / 10;
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    let d = 1 + 0.32 * fbm3(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4 - seed);
    // a couple of craters
    for (let c = 0; c < 3; c++) { const cx = Math.sin(seed * 3.1 + c * 2), cy = Math.cos(seed * 1.7 + c * 3), cz = Math.sin(seed * 0.9 + c); const cd = v.distanceTo(new THREE.Vector3(cx, cy, cz).normalize()); if (cd < 0.45) d -= 0.12 * Math.cos((cd / 0.45) * Math.PI * 0.5); }
    v.multiplyScalar(d); P.setXYZ(i, v.x * sx, v.y * sy, v.z);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, rockMat);
}

/** A holographic beacon in a planet's colour: a vertical light beam, two spinning rings and a glow. */
export function makeBeacon(color, core) {
  const g = new THREE.Group();
  if (core) { core.scale.setScalar(0.8); g.add(core); }
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.045, 8, 64), ringMat), r2 = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.035, 8, 64), ringMat);
  g.add(r1, r2);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 14, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  g.add(beam);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(4.2); g.add(glow);
  g.userData.anim = (t) => { r1.rotation.x = t * 1.3; r1.rotation.y = t * 0.7; r2.rotation.y = -t * 1.9; r2.rotation.z = t * 0.6; glow.material.opacity = 0.65 + 0.25 * Math.sin(t * 5); beam.material.opacity = 0.08 + 0.05 * Math.sin(t * 3); };
  return g;
}

/** A speed ring to fly through: a glowing hoop with chevrons. */
export function makeBoostRing() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b2a3a, emissive: 0x6fe7ff, emissiveIntensity: 2.6, roughness: 0.3, metalness: 0.4 });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.09, 12, 64), mat));
  const inner = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.025, 6, 64), new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
  g.add(inner);
  const film = new THREE.Mesh(new THREE.CircleGeometry(1.65, 48), new THREE.MeshBasicMaterial({ color: 0x6fe7ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  g.add(film);
  g.userData.mat = mat; g.userData.film = film;
  return g;
}

/** Simple lens flare textures for the sun (generated, no files). */
export function flareTextures() {
  const mk = (size, stops) => { const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d"); const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); stops.forEach(([o, s]) => g.addColorStop(o, s)); x.fillStyle = g; x.fillRect(0, 0, size, size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  return {
    main: mk(256, [[0, "rgba(255,250,235,1)"], [0.12, "rgba(255,236,200,.9)"], [0.4, "rgba(255,190,120,.25)"], [1, "rgba(255,160,90,0)"]]),
    ghost: mk(64, [[0, "rgba(160,200,255,.0)"], [0.6, "rgba(160,200,255,.18)"], [0.8, "rgba(160,200,255,.06)"], [1, "rgba(160,200,255,0)"]]),
  };
}
