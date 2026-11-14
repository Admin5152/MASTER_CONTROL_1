// A clearly simulated 3D concept model of Sentinel Skin, shown beside the reference body.
// This is illustrative geometry only: it is not connected hardware or a sensor reading.
import * as THREE from "three";
import { on } from "../core/bus.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

function roundedPanel(width, height, radius, depth, material) {
  const x = -width / 2, y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y); shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 6, steps: 1, bevelSize: Math.min(0.018, width * 0.18, height * 0.18), bevelThickness: Math.min(0.014, depth * 0.6 + 0.004), curveSegments: 16 });
}

function shieldPanel(width, height, depth, material) {
  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.38, height * 0.5);
  shape.lineTo(width * 0.38, height * 0.5);
  shape.quadraticCurveTo(width * 0.49, height * 0.5, width * 0.49, height * 0.36);
  shape.lineTo(width * 0.43, -height * 0.12);
  shape.quadraticCurveTo(width * 0.39, -height * 0.33, 0, -height * 0.5);
  shape.quadraticCurveTo(-width * 0.39, -height * 0.33, -width * 0.43, -height * 0.12);
  shape.lineTo(-width * 0.49, height * 0.36);
  shape.quadraticCurveTo(-width * 0.49, height * 0.5, -width * 0.38, height * 0.5);
  const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 5, steps: 1, bevelSize: 0.018, bevelThickness: 0.016, curveSegments: 12 });
  geom.computeVertexNormals();
  return geom;
}

// ---------- product models: built to read like studio renders (reflections come from a room environment) ----------

/** A rounded rectangle extruded with a deep, smooth bevel: the body of a device. */
function roundedSlab(w, h, r, depth, bevel = 0.04, segs = 10) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSegments: segs, bevelSize: bevel, bevelThickness: bevel, curveSegments: 28 });
  g.translate(0, 0, -depth / 2); g.computeVertexNormals();
  return g;
}

/** A strap: a rounded-rectangle cross-section swept along a curve. */
function strap(points, width, thick) {
  const curve = new THREE.CatmullRomCurve3(points);
  const s = new THREE.Shape(), r = thick / 2;
  s.moveTo(-width / 2 + r, -r); s.lineTo(width / 2 - r, -r); s.absarc(width / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
  s.lineTo(-width / 2 + r, r); s.absarc(-width / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5);
  const g = new THREE.ExtrudeGeometry(s, { steps: 80, bevelEnabled: false, extrudePath: curve, curveSegments: 10 });
  g.computeVertexNormals();
  return g;
}

function fabricTexture(color = "#3d4954", line = "rgba(255,255,255,.07)") {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 3) { g.fillStyle = i % 6 ? "rgba(0,0,0,.10)" : line; g.fillRect(0, i, 256, 1); }
  for (let i = 0; i < 256; i += 8) { g.fillStyle = "rgba(255,255,255,.025)"; g.fillRect(i, 0, 1, 256); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function makeWatch(parent) {
  const figure = new THREE.Group(); parent.add(figure);
  figure.rotation.set(-0.12, -0.38, 0);
  const titanium = new THREE.MeshPhysicalMaterial({ color: 0x1f2227, metalness: 0.75, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.15 });
  const darkTi = new THREE.MeshPhysicalMaterial({ color: 0x3a3f45, metalness: 1, roughness: 0.35 });
  const silicone = new THREE.MeshPhysicalMaterial({ color: 0x141619, roughness: 0.6, metalness: 0, sheen: 0.5, sheenColor: new THREE.Color(0x4a4f57), sheenRoughness: 0.7 });
  const glassBlack = new THREE.MeshPhysicalMaterial({ color: 0x020304, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0x9b6bff, emissiveIntensity: 2.0, roughness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x0a2a1c, emissive: 0x29ff8a, emissiveIntensity: 1.6, roughness: 0.3 });

  // case, then the black glass front, then the lit screen just above it
  const body = new THREE.Mesh(roundedSlab(0.5, 0.6, 0.13, 0.16, 0.045), titanium); figure.add(body);
  const front = new THREE.Mesh(roundedSlab(0.5, 0.6, 0.12, 0.012, 0.012, 6), glassBlack); front.position.z = 0.135; figure.add(front);
  const face = document.createElement("canvas"); face.width = 512; face.height = 640;
  const g = face.getContext("2d"); g.scale(2, 2);
  if (typeof g.roundRect !== "function") {
    g.roundRect = function (x, y, w, h, r) { const q = Math.min(r, w / 2, h / 2); this.moveTo(x + q, y); this.arcTo(x + w, y, x + w, y + h, q); this.arcTo(x + w, y + h, x, y + h, q); this.arcTo(x, y + h, x, y, q); this.arcTo(x, y, x + w, y, q); this.closePath(); };
  }
  const display = new THREE.CanvasTexture(face); display.colorSpace = THREE.SRGBColorSpace; display.anisotropy = 4;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.55), new THREE.MeshBasicMaterial({ map: display, transparent: true, toneMapped: false }));
  screen.position.z = 0.156; figure.add(screen);
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.57), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, roughness: 0.05, metalness: 0, clearcoat: 1, depthWrite: false }));
  sheen.position.z = 0.158; figure.add(sheen);
  // the violet edge light round the screen
  const edge = new THREE.Shape(), hole = new THREE.Path();
  const rr = (o, w, h, r) => { const x = -w / 2, y = -h / 2; o.moveTo(x + r, y); o.lineTo(x + w - r, y); o.absarc(x + w - r, y + r, r, -Math.PI / 2, 0); o.lineTo(x + w, y + h - r); o.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2); o.lineTo(x + r, y + h); o.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI); o.lineTo(x, y + r); o.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5); };
  rr(edge, 0.47, 0.58, 0.1); rr(hole, 0.455, 0.565, 0.093); edge.holes.push(hole);
  const glowRing = new THREE.Mesh(new THREE.ShapeGeometry(edge, 24), accent); glowRing.position.z = 0.1575; figure.add(glowRing);
  figure.userData.leds = [accent];
  // digital crown (knurled), side button, orange action ring
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 36, 1), darkTi);
  crown.rotation.z = Math.PI / 2; crown.position.set(0.3, 0.1, 0.02); figure.add(crown);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.006, 10, 36), accent); ring.rotation.y = Math.PI / 2; ring.position.set(0.335, 0.1, 0.02); figure.add(ring);
  const button = new THREE.Mesh(roundedSlab(0.03, 0.12, 0.014, 0.03, 0.008, 4), titanium); button.position.set(0.285, -0.1, 0.02); button.rotation.y = Math.PI / 2; figure.add(button);
  // optical sensor on the back: a dark glass dome with green LEDs
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), glassBlack);
  dome.rotation.x = -Math.PI / 2; dome.scale.set(1, 1, 0.22); dome.position.z = -0.115; figure.add(dome);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const led = new THREE.Mesh(new THREE.CircleGeometry(0.014, 16), glow); led.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.148); led.rotation.y = Math.PI; figure.add(led); }
  // the sport band: two silicone straps that leave the lugs and curve back round the wrist
  const up = strap([new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(0, 0.52, -0.06), new THREE.Vector3(0, 0.66, -0.3), new THREE.Vector3(0, 0.6, -0.58)], 0.4, 0.055);
  const down = strap([new THREE.Vector3(0, -0.28, 0), new THREE.Vector3(0, -0.52, -0.06), new THREE.Vector3(0, -0.66, -0.3), new THREE.Vector3(0, -0.6, -0.58)], 0.4, 0.055);
  figure.add(new THREE.Mesh(up, silicone), new THREE.Mesh(down, silicone));
  for (const y of [-0.5, -0.4]) { const hole = new THREE.Mesh(new THREE.CircleGeometry(0.018, 18), new THREE.MeshBasicMaterial({ color: 0x07090b })); hole.position.set(0, y - 0.04, -0.045); hole.rotation.x = 0.35; figure.add(hole); }
  return { figure, glow, face, display };
}

function makeChestHub(parent) {
  const unit = new THREE.Group(); parent.add(unit);
  unit.rotation.set(-0.12, -0.32, 0);
  const shell = new THREE.MeshPhysicalMaterial({ color: 0x0c0d0f, metalness: 0.1, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  const face = new THREE.MeshPhysicalMaterial({ color: 0x131518, metalness: 0.05, roughness: 0.62, clearcoat: 0.2 });
  const metal = new THREE.MeshPhysicalMaterial({ color: 0x5a5f66, metalness: 0.95, roughness: 0.3 });
  const fabric = new THREE.MeshPhysicalMaterial({ map: fabricTexture("#2a2d31", "rgba(255,255,255,.05)"), roughness: 0.9, sheen: 0.7, sheenColor: new THREE.Color(0x5b636c), sheenRoughness: 0.6 });
  fabric.map.repeat.set(1, 6);
  const edgeFabric = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.85 });
  const violet = new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0x9b6bff, emissiveIntensity: 2.2, roughness: 0.25 });
  unit.userData.leds = [violet];
  // the hub: an angular, chamfered body, wider at the shoulders, with a raised face plate
  const hubShape = (k) => { const s = new THREE.Shape(); const P = [[-0.34, 0.2], [-0.22, 0.32], [0.22, 0.32], [0.34, 0.2], [0.3, -0.19], [0.13, -0.33], [-0.13, -0.33], [-0.3, -0.19]].map(([x, y]) => [x * k, y * k]); s.moveTo(...P[0]); P.slice(1).forEach((p) => s.lineTo(...p)); s.closePath(); return s; };
  const body = new THREE.ExtrudeGeometry(hubShape(1), { depth: 0.1, bevelEnabled: true, bevelSegments: 8, bevelSize: 0.035, bevelThickness: 0.035, curveSegments: 4 });
  body.translate(0, 0, -0.05); body.computeVertexNormals();
  unit.add(new THREE.Mesh(body, shell));
  const plate = new THREE.ExtrudeGeometry(hubShape(0.84), { depth: 0.012, bevelEnabled: true, bevelSegments: 4, bevelSize: 0.012, bevelThickness: 0.01, curveSegments: 4 });
  const facePlate = new THREE.Mesh(plate, face); facePlate.position.z = 0.085; unit.add(facePlate);
  // wordmark, light bars low on each side, a status light at the top
  const lc = document.createElement("canvas"); lc.width = 512; lc.height = 128;
  const lg = lc.getContext("2d"); lg.fillStyle = "#e6e9ee"; lg.font = "600 58px Inter, system-ui, sans-serif"; lg.textAlign = "center"; lg.fillText("SpaceWear", 256, 82);
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 4;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.065), new THREE.MeshBasicMaterial({ map: lt, transparent: true, toneMapped: false }));
  label.position.set(0, 0.13, 0.11); unit.add(label);
  for (const s of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.15, 6, 12), violet);
    bar.position.set(s * 0.215, -0.07, 0.108); bar.rotation.z = s * 0.2; unit.add(bar);
  }
  const status = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.05, 4, 10), violet); status.rotation.z = Math.PI / 2; status.position.set(0, 0.235, 0.108); unit.add(status);
  // modular ports on the sides: metal sockets for the spacecraft feeds
  for (const s of [-1, 1]) for (const y of [0.04, -0.06]) {
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 24), metal);
    port.rotation.z = Math.PI / 2; port.position.set(s * 0.355, y, 0); unit.add(port);
  }
  // the harness: padded straps over the shoulders and round the sides, with buckles and haptic pods
  for (const s of [-1, 1]) {
    const shoulder = strap([new THREE.Vector3(s * 0.2, 0.3, -0.02), new THREE.Vector3(s * 0.26, 0.6, -0.06), new THREE.Vector3(s * 0.3, 0.86, -0.22), new THREE.Vector3(s * 0.3, 0.9, -0.5)], 0.045, 0.15);
    unit.add(new THREE.Mesh(shoulder, fabric));
    const side = strap([new THREE.Vector3(s * 0.33, 0.0, -0.02), new THREE.Vector3(s * 0.55, 0.0, -0.1), new THREE.Vector3(s * 0.72, -0.02, -0.32), new THREE.Vector3(s * 0.78, -0.03, -0.6)], 0.13, 0.04);
    unit.add(new THREE.Mesh(side, fabric));
    const buckle = new THREE.Mesh(roundedPanel(0.17, 0.05, 0.02, 0.025), metal); buckle.position.set(s * 0.255, 0.56, -0.02); buckle.rotation.z = s * -0.2; unit.add(buckle);
    const pod = new THREE.Mesh(roundedPanel(0.12, 0.085, 0.035, 0.035), shell); pod.position.set(s * 0.29, 0.76, -0.1); pod.rotation.set(-0.5, 0, s * -0.1); unit.add(pod);
    const podLed = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), violet); podLed.position.set(s * 0.29, 0.775, -0.05); podLed.rotation.x = -0.5; unit.add(podLed);
    const edge = new THREE.Mesh(roundedPanel(0.03, 0.2, 0.01, 0.05), edgeFabric); edge.position.set(s * 0.37, 0.0, -0.03); unit.add(edge);
  }
  unit.scale.setScalar(0.82);
  return unit;
}

function makePatchSensor(parent) {
  const patch = new THREE.Group(); parent.add(patch);
  patch.rotation.set(0.18, -0.35, 0);
  const body = new THREE.MeshPhysicalMaterial({ color: 0x16181c, roughness: 0.38, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const bezel = new THREE.MeshPhysicalMaterial({ color: 0x2a2d33, metalness: 0.9, roughness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1220, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.38, depthWrite: false });
  const lensGlow = new THREE.MeshBasicMaterial({ color: 0xdff1ff, toneMapped: false });
  const ringGlow = new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0x9b6bff, emissiveIntensity: 1.6 });
  // a soft round puck: a capsule profile turned about its axis
  const prof = [];
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + i / 16 * Math.PI; prof.push(new THREE.Vector2(0.3 + Math.cos(a) * 0.07, Math.sin(a) * 0.07)); }
  prof.unshift(new THREE.Vector2(0, -0.07)); prof.push(new THREE.Vector2(0, 0.07));
  const puck = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), body); puck.rotation.x = Math.PI / 2; patch.add(puck);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 20, 72), bezel); rim.position.z = 0.07; patch.add(rim);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.15, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  lens.rotation.x = Math.PI / 2; lens.scale.y = 0.35; lens.position.z = 0.068; patch.add(lens);
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.05, 40), lensGlow); core.position.z = 0.125; patch.add(core);
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(200,232,255,.95)"); r.addColorStop(0.35, "rgba(120,190,255,.45)"); r.addColorStop(1, "rgba(80,140,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const bloom = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  bloom.position.z = 0.127; patch.add(bloom);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.09, 48), new THREE.MeshBasicMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.5, toneMapped: false })); halo.position.z = 0.124; patch.add(halo);
  const status = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.006, 8, 96), ringGlow); status.position.z = 0.0; patch.add(status);
  patch.userData.leds = [ringGlow];
  return patch;
}

const SIM = { heart_rate: 78, spo2: 98, temp_c: 36.8, breathing_rate: 16, stress: 35 };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rounded = (g, x, y, w, h, r, fill, stroke = null) => {
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = fill; g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 0.7; g.stroke(); }
};

function reading(value, fallback, unit, source) {
  const valid = value != null && Number.isFinite(Number(value)) && Number(value) > 0;
  const label = !valid || !source || source === "sim" ? "SIM" : source === "manual" || source === "user" ? "MANUAL" : "LIVE";
  return { value: valid ? Number(value) : fallback, label, unit };
}

const smoothed = new Map();
function smoothValue(key, target) {
  const previous = smoothed.get(key);
  const next = previous == null ? target : previous + (target - previous) * 0.2;
  smoothed.set(key, next);
  return next;
}

function paintDashboard(g, state, time, steps, calories, connected) {
  const W = 256, H = 320, s = state || {};
  const vitals = s.vitals || {}, manual = s.manual || {}, wellbeing = s.state || {};
  const hr = reading(smoothValue("hr", reading(vitals.heart_rate, SIM.heart_rate, "BPM", vitals.sources?.heart_rate).value), SIM.heart_rate, "BPM", vitals.sources?.heart_rate);
  const spo2 = reading(smoothValue("spo2", reading(vitals.spo2, SIM.spo2, "%", vitals.sources?.spo2).value), SIM.spo2, "%", vitals.sources?.spo2);
  const hasTemp = manual.temp_c != null && Number.isFinite(Number(manual.temp_c)) && Number(manual.temp_c) > 0;
  const temp = reading(smoothValue("temp", hasTemp ? Number(manual.temp_c) : SIM.temp_c), SIM.temp_c, "°C", hasTemp ? "manual" : "sim");
  const resp = reading(smoothValue("resp", reading(vitals.breathing_rate, SIM.breathing_rate, "/MIN", vitals.sources?.breathing_rate).value), SIM.breathing_rate, "/MIN", vitals.sources?.breathing_rate);
  const hasStress = wellbeing.stress != null && Number.isFinite(Number(wellbeing.stress));
  const stressVal = Math.round(smoothValue("stress", hasStress ? clamp(Number(wellbeing.stress) * 100, 0, 100) : SIM.stress));
  const stressSource = "SIM";
  const alertSeverity = s.action?.severity === "alert" || s.cabin?.alert ? "alert" : s.action?.severity === "watch" ? "watch" : "ok";
  const now = new Date();
  g.clearRect(0, 0, W, H);
  g.save();
  g.beginPath(); g.roundRect(0, 0, W, H, 25); g.clip();
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#050a11"); bg.addColorStop(0.55, "#07111d"); bg.addColorStop(1, "#05080d");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const ambient = g.createRadialGradient(55, 96, 5, 60, 110, 155); ambient.addColorStop(0, "rgba(10,125,168,.20)"); ambient.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = ambient; g.fillRect(0, 50, W, 150);

  // Status bar: time/date, connection, and battery.
  g.textAlign = "left"; g.fillStyle = "#f5fbff"; g.font = "700 23px system-ui, sans-serif";
  g.fillText(new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now), 16, 29);
  g.fillStyle = "#95a6b8"; g.font = "600 8px system-ui, sans-serif";
  g.fillText(new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(now).toUpperCase(), 17, 43);
  // Connection glyph.
  g.strokeStyle = connected ? "#59e0a4" : "#75879a"; g.lineWidth = 1.5; g.beginPath();
  g.moveTo(190, 13); g.lineTo(198, 21); g.lineTo(190, 29); g.lineTo(190, 13); g.moveTo(186, 17); g.lineTo(194, 25); g.moveTo(194, 17); g.lineTo(186, 25); g.stroke();
  g.fillStyle = connected ? "#74eab5" : "#9aa9b8"; g.font = "600 7px system-ui, sans-serif"; g.fillText(connected ? "LINK" : "OFF", 183, 39);
  rounded(g, 220, 13, 20, 10, 2, "#182432", "#6e8297");
  rounded(g, 222, 15, 14, 6, 1, "#59e0a4"); g.fillStyle = "#91a2b5"; g.fillRect(240, 16, 2, 4);
  rounded(g, 16, 52, 94, 12, 6,
    alertSeverity === "alert" ? "rgba(255,73,91,.18)" : alertSeverity === "watch" ? "rgba(255,184,75,.16)" : "rgba(183,122,255,.13)",
    alertSeverity === "alert" ? "rgba(255,73,91,.5)" : alertSeverity === "watch" ? "rgba(255,184,75,.4)" : "rgba(183,122,255,.3)");
  g.fillStyle = alertSeverity === "alert" ? "#ff6878" : alertSeverity === "watch" ? "#ffc45e" : "#c7a0ff";
  g.font = "700 6px system-ui, sans-serif";
  g.fillText(alertSeverity === "alert" ? "SPACEWEAR / ALERT" : alertSeverity === "watch" ? "SPACEWEAR / CAUTION" : "SPACEWEAR / SIM DATA", 21, 60);
  g.strokeStyle = "rgba(142,164,188,.19)"; g.lineWidth = 0.7; g.beginPath(); g.moveTo(16, 70); g.lineTo(240, 70); g.stroke();

  // Heart-rate hero and a softly glowing pulse trace.
  const heart = 0.5 + 0.5 * Math.sin(time / 520);
  g.save(); g.translate(24, 89); g.scale(0.78 + heart * 0.10, 0.78 + heart * 0.10);
  g.beginPath(); g.moveTo(0, 8); g.bezierCurveTo(-15, -3, -10, -12, -3, -10); g.bezierCurveTo(1, -9, 3, -5, 4, -3); g.bezierCurveTo(10, -15, 22, -8, 18, 1); g.bezierCurveTo(16, 7, 9, 12, 4, 17); g.closePath();
  g.shadowColor = "#ff5367"; g.shadowBlur = 7 + heart * 8; g.fillStyle = "#ff5367"; g.fill(); g.restore();
  g.fillStyle = "#91a6ba"; g.font = "700 8px system-ui, sans-serif"; g.fillText("HEART RATE", 42, 84);
  g.fillStyle = "#f5fbff"; g.font = "700 32px system-ui, sans-serif"; g.fillText(String(Math.round(hr.value)), 40, 116);
  g.fillStyle = "#83a0b9"; g.font = "600 8px system-ui, sans-serif"; g.fillText("BPM", 91, 114);
  g.fillStyle = hr.label === "LIVE" ? "#59e0a4" : "#ffbd65"; g.font = "700 6px system-ui, sans-serif"; g.fillText(hr.label, 202, 83);

  // ECG trace, clipped to a small inset and animated with the watch frame.
  rounded(g, 15, 126, 226, 22, 7, "rgba(10,25,39,.78)", "rgba(83,165,190,.16)");
  g.save(); g.beginPath(); g.roundRect(17, 128, 222, 18, 5); g.clip();
  g.shadowColor = "#47d9f4"; g.shadowBlur = 5; g.strokeStyle = "#53dcf5"; g.lineWidth = 1.35; g.beginPath();
  for (let x = 0; x <= 220; x += 2) {
    const q = ((x / 220 * 2 + time / 1300) % 1 + 1) % 1;
    const spike = Math.exp(-((q - 0.63) ** 2) / 0.00055);
    const pre = Math.exp(-((q - 0.53) ** 2) / 0.003) * 2;
    const y = 137 - pre + spike * 8 - Math.exp(-((q - 0.68) ** 2) / 0.003) * 2;
    if (x === 0) g.moveTo(17 + x, y); else g.lineTo(17 + x, y);
  }
  g.stroke(); g.restore(); g.restore();

  // Compact oxygen and temperature tiles.
  rounded(g, 15, 155, 109, 45, 9, "rgba(11,28,43,.88)", "rgba(67,183,229,.25)");
  rounded(g, 132, 155, 109, 45, 9, "rgba(20,22,35,.92)", "rgba(164,104,233,.24)");
  g.fillStyle = "#55d7ff"; g.font = "700 7px system-ui, sans-serif"; g.fillText("SpO₂", 23, 168);
  g.fillStyle = "#f3faff"; g.font = "700 18px system-ui, sans-serif"; g.fillText(`${Math.round(spo2.value)}%`, 22, 190);
  g.fillStyle = spo2.label === "LIVE" ? "#59e0a4" : "#ffbd65"; g.font = "700 6px system-ui, sans-serif"; g.textAlign = "right"; g.fillText(spo2.label, 116, 168);
  g.textAlign = "left"; g.fillStyle = "#c28cff"; g.font = "700 7px system-ui, sans-serif"; g.fillText("TEMPERATURE", 140, 168);
  g.fillStyle = "#f3faff"; g.font = "700 18px system-ui, sans-serif"; g.fillText(`${Number(temp.value).toFixed(1)}°`, 140, 190);
  g.fillStyle = temp.label === "LIVE" ? "#59e0a4" : "#ffbd65"; g.font = "700 6px system-ui, sans-serif"; g.textAlign = "right"; g.fillText(temp.label, 233, 168);
  g.textAlign = "left";

  // Stress gauge.
  rounded(g, 15, 207, 226, 32, 8, "rgba(15,22,31,.9)", "rgba(149,168,190,.16)");
  g.fillStyle = "#aab9c9"; g.font = "700 7px system-ui, sans-serif"; g.fillText("STRESS", 23, 220);
  g.fillStyle = "#f1f6fb"; g.font = "700 12px system-ui, sans-serif"; g.fillText(`${stressVal}%`, 23, 233);
  const gx = 84, gy = 226, gw = 144;
  rounded(g, gx, gy - 4, gw, 6, 3, "#202a36");
  const grad = g.createLinearGradient(gx, 0, gx + gw, 0); grad.addColorStop(0, "#43d69d"); grad.addColorStop(0.55, "#ffc45e"); grad.addColorStop(1, "#ff586b");
  rounded(g, gx, gy - 4, gw * stressVal / 100, 6, 3, grad);
  g.fillStyle = "#ffbd65"; g.font = "700 6px system-ui, sans-serif"; g.textAlign = "right"; g.fillText(stressSource, 233, 218); g.textAlign = "left";

  // Activity and respiratory rate in a three-column footer.
  const cards = [
    { x: 15, color: "#57dca3", label: "STEPS · SIM", value: Number(steps).toLocaleString(), unit: "today" },
    { x: 92, color: "#ff9b57", label: "KCAL · SIM", value: String(Math.round(calories)), unit: "burned" },
    { x: 169, color: "#55caff", label: `BREATHS · ${resp.label}`, value: String(Math.round(resp.value)), unit: " /min" },
  ];
  for (const c of cards) {
    rounded(g, c.x, 246, 72, 48, 8, "rgba(11,20,30,.94)", "rgba(132,155,178,.14)");
    g.fillStyle = c.color; g.font = "700 6px system-ui, sans-serif"; g.fillText(c.label, c.x + 7, 257);
    g.fillStyle = "#f5f9fc"; g.font = "700 12px system-ui, sans-serif"; g.fillText(c.value, c.x + 7, 274);
    g.fillStyle = "#8395a8"; g.font = "600 6px system-ui, sans-serif"; g.fillText(c.unit, c.x + 7, 286);
  }
  g.fillStyle = "rgba(195,216,235,.19)"; g.fillRect(22, 306, 212, 0.6);
  const sheen = g.createLinearGradient(0, 0, W, H); sheen.addColorStop(0, "rgba(255,255,255,.09)"); sheen.addColorStop(0.20, "rgba(255,255,255,0)"); sheen.addColorStop(1, "rgba(125,210,255,.025)");
  g.fillStyle = sheen; g.fillRect(0, 0, W, H);
  g.restore();
}

// What each device measures, and where the number on screen comes from.
const DEVICES = {
  chest: { name: "Chest hub", title: "SpaceWear chest hub", copy: "Processing, communications and spacecraft integration, on a sensor harness: heart rate and ECG, SpO₂ and respiration from the straps, haptic modules on the shoulders, modular ports for radiation, O₂, CO₂ and pressure feeds.",
    rows: (s) => [["Heart rate", s.vitals?.heart_rate, "bpm", s.vitals?.sources?.heart_rate], ["Breathing", s.vitals?.breathing_rate, "/min", s.vitals?.sources?.breathing_rate], ["Skin temp", s.manual?.temp_c, "°C", s.manual?.temp_c != null ? "manual" : null]] },
  wrist: { name: "Wrist module", title: "SpaceWear wrist module", copy: "Quick status, acknowledging alerts and secondary haptics: optical pulse and SpO₂, and Sentinel's warnings on the wrist.",
    rows: (s) => [["SpO₂", s.vitals?.spo2, "%", s.vitals?.sources?.spo2], ["Heart rate", s.vitals?.heart_rate, "bpm", s.vitals?.sources?.heart_rate], ["Sleep", s.manual?.sleep_hours, "h", s.manual?.sleep_hours != null ? "manual" : null]] },
  patch: { name: "Patch sensor", title: "SpaceWear patch sensor", copy: "Optional skin-contact sensor for skin temperature, hydration and sweat. A concept: no patch is connected in this build.",
    rows: (s) => [["Hydration", s.manual?.hydration_ml, "ml", s.manual?.hydration_ml != null ? "manual" : null], ["Skin temp", s.manual?.temp_c, "°C", s.manual?.temp_c != null ? "manual" : null]] },
};
// vibration and light patterns for each alert (ms on, ms off, ...), after the AEGIS-1 design
export const ALERTS = {
  normal: { name: "Normal", color: 0x9b6bff, pattern: [], note: "All clear: the status light glows steady." },
  health: { name: "Health warning", color: 0xffb02e, pattern: [180, 140, 180, 900], title: "Health warning", sub: "Check your heart rate", note: "Two short pulses, repeating: a vital sign is outside your range." },
  radiation: { name: "Radiation alert", color: 0xff4b2e, pattern: [650, 300, 650, 300, 650, 1100], title: "High radiation", sub: "Seek shielding", note: "Three long pulses: the radiation system reports an alert condition." },
  suit: { name: "Suit pressure", color: 0xff2b2b, pattern: [110, 70, 110, 70, 110, 70, 110, 450], title: "Suit pressure", sub: "Return to the airlock", note: "Rapid pulses, repeating: the suit is losing pressure." },
  sos: { name: "Manual SOS", color: 0xff2244, pattern: [140, 110, 140, 110, 140, 320, 420, 140, 420, 140, 420, 320, 140, 110, 140, 110, 140, 900], title: "SOS sent", sub: "Crew and ground notified", note: "S-O-S in Morse: the astronaut pressed the emergency button." },
};
const patternOn = (pat, ms) => { const total = pat.reduce((a, b) => a + b, 0); if (!total) return false; let t = ms % total; for (let i = 0; i < pat.length; i++) { if (t < pat[i]) return i % 2 === 0; t -= pat[i]; } return false; };
function paintAlert(g, a, on) {
  const W = 256, H = 320; g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, H);
  g.save(); g.beginPath(); g.roundRect(0, 0, W, H, 25); g.clip();
  g.fillStyle = "#07090d"; g.fillRect(0, 0, W, H);
  const c = "#" + a.color.toString(16).padStart(6, "0");
  g.fillStyle = c; g.globalAlpha = on ? 0.28 : 0.12; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
  g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 70); g.lineTo(158, 122); g.lineTo(98, 122); g.closePath(); g.stroke();
  g.fillStyle = c; g.font = "700 26px system-ui"; g.textAlign = "center"; g.fillText("!", 128, 115);
  g.fillStyle = "#fff"; g.font = "700 24px system-ui"; g.fillText(a.title, 128, 170);
  g.fillStyle = "#cfd6e0"; g.font = "600 13px system-ui"; g.fillText(a.sub, 128, 196);
  g.fillStyle = c; g.font = "700 9px system-ui"; g.fillText("SPACEWEAR · SIMULATED ALERT", 128, 290);
  g.restore();
}

const fmt = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v) >= 100 ? String(Math.round(v)) : String(Math.round(Number(v) * 10) / 10));
const srcBadge = (v, src) => (v == null ? `<span class="badge badge-designed">NO SENSOR</span>` : src === "manual" || src === "user" ? `<span class="badge badge-sim">MANUAL</span>` : src && src !== "sim" ? `<span class="badge badge-live">LIVE</span>` : `<span class="badge badge-sim">SIM</span>`);

export function mountWearableFigure(panel, ctx) {
  if (!panel) return () => {};
  panel.innerHTML = `<header class="wear-head"><div><span class="wear-kicker">SpaceWear</span><small>The hardware that reads these vitals</small></div>
      <span class="badge badge-designed">Concept</span></header>
    <div class="wear-tabs" role="tablist">${Object.entries(DEVICES).map(([id, d]) => `<button type="button" role="tab" data-part="${id}">${d.name}</button>`).join("")}</div>
    <div class="wear-body"><div class="wear-viewer"><canvas aria-label="SpaceWear device model: drag to turn"></canvas><span class="wear-hint">Drag to turn · say "explode it"</span></div>
    <div class="wear-info"><strong data-title></strong><p data-copy></p><ul class="wear-rows" data-rows></ul>
      <div class="wear-alerts"><span class="label">Alert test</span><div class="wear-alert-row">${Object.entries(ALERTS).map(([k, a]) => `<button type="button" data-alert="${k}" class="al-${k}">${a.name}</button>`).join("")}</div><p class="fine" data-alert-note>Illustrative patterns. On a tablet that supports it, the device itself vibrates.</p></div></div></div>`;
  const canvas = panel.querySelector("canvas");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch (error) {
    console.warn("wearable model could not start", error);
    panel.hidden = true;
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x050912, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;   // studio reflections for metal and glass
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfff3e6, 1.6); key.position.set(2.2, 3.2, 3.0); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.4); rim.position.set(-2.6, 1.6, -2.4); scene.add(rim);
  const sceneRoot = new THREE.Group(); scene.add(sceneRoot);
  const chest = makeChestHub(sceneRoot);
  const { figure: wrist, face, display } = makeWatch(sceneRoot);
  const patchSensor = makePatchSensor(sceneRoot);
  const parts = [
    { id: "chest", object: chest, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 30), base: chest.rotation.y },
    { id: "wrist", object: wrist, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 30), base: wrist.rotation.y },
    { id: "patch", object: patchSensor, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 30), base: patchSensor.rotation.y },
  ];
  for (const part of parts) {
    part.object.visible = false;
    const box = new THREE.Box3();
    part.object.children.forEach((ch) => { if (!ch.userData.noExplode) box.expandByPoint(ch.position); });
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const spread = Math.max(size.x, size.y, 0.3);
    part.pieces = part.object.children.filter((ch) => !ch.userData.noExplode).map((ch) => {
      const d = ch.position.clone().sub(c);
      // apart in the plane, and much further apart in depth so the layers (glass, bezel, case, sensor) separate
      const off = new THREE.Vector3(d.x * 0.3, d.y * 0.3, d.z * 5.5);
      if (off.length() < spread * 0.08) off.z += (d.z >= 0 ? 1 : -1) * spread * 0.18;
      return { obj: ch, base: ch.position.clone(), off };
    });
  }
  let open = false, current = parts[1], drag = null, spinT = 0, idleAt = 0;
  let explode = 0, explodeTo = 0, zoom = 1, zoomTo = 1, turnTo = null, tiltTo = 0;
  let alert = null, alertT0 = 0, alertTimer = 0;
  const setAlert = (kind) => {
    clearTimeout(alertTimer);
    const a = ALERTS[kind] || ALERTS.normal;
    alert = kind && kind !== "normal" ? a : null; alertT0 = performance.now();
    panel.querySelectorAll("[data-alert]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.alert === (kind || "normal"))));
    panel.querySelector("[data-alert-note]").textContent = a.note;
    try { navigator.vibrate?.(alert ? [...a.pattern, ...a.pattern] : 0); } catch { /* no vibration motor */ }
    if (alert) { if (current.id !== "wrist" && kind !== "sos") select("wrist"); alertTimer = setTimeout(() => setAlert("normal"), 9000); }
    for (const p of parts) for (const m of p.object.userData.leds || []) m.emissive.setHex(a.color);
  };

  const info = panel.querySelector(".wear-info");
  const renderInfo = () => {
    const d = DEVICES[current.id], st = ctx?.view?.state || {};
    info.querySelector("[data-title]").textContent = d.title;
    info.querySelector("[data-copy]").textContent = d.copy;
    info.querySelector("[data-rows]").innerHTML = d.rows(st).map(([label, v, unit, src]) =>
      `<li><span>${label}</span><b>${fmt(v)}<small>${v == null ? "" : unit}</small></b>${srcBadge(v, src)}</li>`).join("");
  };
  const select = (id) => {
    current = parts.find((p) => p.id === id) || parts[1];
    panel.querySelectorAll("[data-part]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.part === current.id)));
    current.object.rotation.y = current.base; spinT = 0; turnTo = null;
    for (const p of parts) for (const pc of p.pieces) pc.obj.position.copy(pc.base);
    explode = explodeTo = 0; zoom = zoomTo = 1; tiltTo = 0;
    renderInfo(); resize(); paint();
    window.gsap?.fromTo(canvas, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.45, ease: "power2.out" });
  };
  panel.querySelectorAll("[data-part]").forEach((b) => b.addEventListener("click", () => select(b.dataset.part)));
  panel.querySelectorAll("[data-alert]").forEach((b) => b.addEventListener("click", () => setAlert(b.dataset.alert)));

  const resize = () => {
    if (!open) return;
    const r = canvas.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    renderer.setSize(r.width, r.height, false);
    fitPartCamera(current, r.width / r.height);
  };
  // on Vitals the card is always there; "open" means the Vitals screen is showing
  const setOpen = () => { open = true; requestAnimationFrame(() => { resize(); renderInfo(); paint(); }); };
  const ro = new ResizeObserver(resize); ro.observe(panel);
  const stopBodyDrag = (e) => e.stopPropagation();
  ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"].forEach((name) => canvas.addEventListener(name, stopBodyDrag, { passive: name === "wheel" }));
  canvas.addEventListener("pointerdown", (e) => { turnTo = null; drag = { x: e.clientX, az: current.object.rotation.y }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (drag) current.object.rotation.y = drag.az + (e.clientX - drag.x) * 0.01; });
  const finish = () => { if (drag) { drag = null; idleAt = performance.now(); spinT = Math.asin(clamp((current.object.rotation.y - current.base) / 0.55, -1, 1)) / 0.5; } };
  canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish);

  const startDay = new Date().setHours(0, 0, 0, 0);
  let raf = 0, lastPaint = 0, lastInfo = 0, last = performance.now(), activitySteps = 6482, activityCalories = 286;
  const paintFace = (now) => {
    try {
      paintDashboard(face.getContext("2d"), ctx?.view?.state, now, activitySteps, activityCalories, !!ctx?.view?.online);
    } catch (error) {
      console.warn("watch dashboard could not draw", error);
      const g = face.getContext("2d");
      g.setTransform(2, 0, 0, 2, 0, 0); g.fillStyle = "#050a11"; g.fillRect(0, 0, 256, 320);
      g.fillStyle = "#f5fbff"; g.font = "700 13px system-ui"; g.fillText("SENTINEL WATCH", 22, 42);
    }
    display.needsUpdate = true;
  };
  paintFace(0);
  const paint = () => {
    const rect = canvas.getBoundingClientRect();
    if (!open || rect.width < 10 || rect.height < 10) return;
    for (const p of parts) p.object.visible = p === current;
    renderer.render(scene, current.camera);
  };
  const draw = (now) => {
    raf = requestAnimationFrame(draw);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (document.body.dataset.stage !== "vitals" || document.hidden) return;
    const vr = panel.getBoundingClientRect();
    if (vr.bottom < 0 || vr.top > innerHeight) return;   // scrolled out of view: nothing to draw
    // a slow turntable sway, paused while dragged and for two seconds after
    const k = 1 - Math.exp(-dt * 7);
    if (alert) {
      const on = patternOn(alert.pattern, now - alertT0);
      for (const m of current.object.userData.leds || []) m.emissiveIntensity = on ? 3.2 : 0.4;
      current.object.position.x = on ? Math.sin(now * 0.9) * 0.008 : 0;   // the motor buzzing
      if (current.id === "wrist") { paintAlert(face.getContext("2d"), alert, on); display.needsUpdate = true; lastPaint = now; }
    } else { current.object.position.x = 0; for (const m of current.object.userData.leds || []) m.emissiveIntensity = 2.1; }
    explode += (explodeTo - explode) * k; zoom += (zoomTo - zoom) * k;
    for (const pc of current.pieces) pc.obj.position.copy(pc.base).addScaledVector(pc.off, explode);
    if (current.fit) current.camera.position.set(current.fit.c.x + 0.04, current.fit.c.y + 0.025, current.fit.c.z + current.fit.d * zoom);
    if (current.tilt0 == null) current.tilt0 = current.object.rotation.x;
    current.object.rotation.x += (current.tilt0 + tiltTo - current.object.rotation.x) * k;
    if (turnTo != null && !drag) { current.object.rotation.y += (turnTo - current.object.rotation.y) * k; idleAt = now; }
    if (!drag && turnTo == null && now - idleAt > 2000 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      spinT += dt; current.object.rotation.y = current.base + Math.sin(spinT * 0.5) * 0.55;
    }
    if (!alert && current.id === "wrist" && now - lastPaint > 120) {
      const elapsedMinutes = Math.max(0, (Date.now() - startDay) / 60000);
      activitySteps += (Math.min(12000, 6482 + Math.floor(elapsedMinutes * 2.1)) - activitySteps) * 0.2;
      activityCalories += (Math.min(900, 286 + Math.floor(elapsedMinutes * 0.28)) - activityCalories) * 0.2;
      paintFace(now); lastPaint = now;
    }
    if (now - lastInfo > 2000) { renderInfo(); lastInfo = now; }
    paint();
  };
  raf = requestAnimationFrame(draw);
  const onWear = (c) => {
    if (c.action === "close") return;
    if (c.action === "alert") { panel.scrollIntoView({ behavior: "smooth", block: "center" }); setAlert(c.kind); return; }
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    if (c.part && c.part !== current.id) select(c.part);
    const y = current.object.rotation.y;
    switch (c.action) {
      case "explode": explodeTo = 1; zoomTo = Math.max(zoomTo, 1.3); turnTo = current.base + 1.05; tiltTo = -0.32; break;
      case "assemble": explodeTo = 0; zoomTo = 1; turnTo = current.base; tiltTo = 0; break;
      case "zoom_in": zoomTo = Math.max(0.42, zoomTo * 0.7); break;
      case "zoom_out": zoomTo = Math.min(2.2, zoomTo * 1.4); break;
      case "turn": turnTo = c.direction === "back" ? y + Math.PI : c.direction === "front" ? current.base : c.direction === "left" ? y - Math.PI / 3 : y + Math.PI / 3; break;
      case "reset": explodeTo = 0; zoomTo = 1; turnTo = current.base; tiltTo = 0; break;
      default: break;
    }
  };
  const offCmd = on("wear:cmd", onWear);
  if (ctx) ctx.wearCmd = (c) => { if (c?.action === "alert") setAlert(c.kind); else onWear(c); };
  select("wrist");
  setOpen();
  setAlert("normal");
  return () => {
    cancelAnimationFrame(raf); ro.disconnect(); offCmd?.();
    ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"].forEach((name) => canvas.removeEventListener(name, stopBodyDrag));
    renderer.dispose();
    const textures = new Set();
    scene.traverse((obj) => {
      obj.geometry?.dispose?.();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.filter(Boolean).forEach((m) => {
        [m.map, m.emissiveMap].filter(Boolean).forEach((t) => textures.add(t));
        m.dispose();
      });
    });
    textures.forEach((t) => t.dispose());
    panel.innerHTML = "";
  };
}

function fitPartCamera(part, aspect) {
  const camera = part.camera;
  camera.aspect = aspect;
  part.object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(part.object);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(0.25, bounds.getSize(new THREE.Vector3()).length() * 0.5);
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical * 0.5) * aspect);
  const distance = radius / Math.sin(Math.min(vertical, horizontal) * 0.5) * 0.86;
  camera.position.set(center.x + 0.04, center.y + 0.025, center.z + distance);
  part.fit = { c: center.clone(), d: distance };
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}
