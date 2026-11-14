// A clearly simulated 3D concept model of Sentinel Skin, shown beside the reference body.
// This is illustrative geometry only: it is not connected hardware or a sensor reading.
import * as THREE from "three";

function roundedPanel(width, height, radius, depth, material) {
  const x = -width / 2, y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y); shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.018, bevelThickness: 0.014, curveSegments: 8 });
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

function wovenTexture(repeatX, repeatY) {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128;
  const g = canvas.getContext("2d");
  g.fillStyle = "#181d25"; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 4) {
    g.fillStyle = i % 8 === 0 ? "rgba(220,230,245,.055)" : "rgba(0,0,0,.13)";
    g.fillRect(i, 0, 1, 128); g.fillRect(0, i, 128, 1);
    g.fillStyle = "rgba(255,255,255,.025)"; g.fillRect(i + 1, 1, 1, 126);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

function makeWatch(parent) {
  const figure = new THREE.Group();
  parent.add(figure);
  figure.rotation.x = -0.08;
  figure.rotation.y = -0.22; // Start with the glass face and crown visible.

  const strapMat = new THREE.MeshStandardMaterial({ color: 0x42647a, map: wovenTexture(1.5, 7), roughness: 0.82, metalness: 0.02 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xb4c4cf, roughness: 0.24, metalness: 0.72 });
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x263340, roughness: 0.25, metalness: 0.62 });
  const blackCeramic = new THREE.MeshStandardMaterial({ color: 0x080c11, roughness: 0.22, metalness: 0.28 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x78f4e7, emissive: 0x12b8a7, emissiveIntensity: 1.35, roughness: 0.22, metalness: 0.3 });
  const quiet = new THREE.MeshStandardMaterial({ color: 0x69b7d1, emissive: 0x12627b, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.42 });

  // Continuous black loop band, shaped in depth so the watch reads like a product render without an arm.
  const strapShape = new THREE.Shape();
  strapShape.absellipse(0.34, 0, 0.7, 1.08, 0, Math.PI * 2, false, 0);
  const strapOpening = new THREE.Path();
  strapOpening.absellipse(0.34, 0, 0.56, 0.91, 0, Math.PI * 2, true, 0);
  strapShape.holes.push(strapOpening);
  const strapGeometry = new THREE.ExtrudeGeometry(strapShape, { depth: 0.38, bevelEnabled: true, bevelSegments: 4, bevelSize: 0.018, bevelThickness: 0.018, curveSegments: 48 });
  strapGeometry.rotateY(Math.PI / 2); strapGeometry.translate(-0.19, 0, 0);
  figure.add(new THREE.Mesh(strapGeometry, strapMat));
  // Adjustment slots on the lower section of the band.
  const slotMat = new THREE.MeshBasicMaterial({ color: 0x05080b });
  for (const [y, z] of [[-0.43, 0.235], [-0.55, 0.19], [-0.67, 0.135], [-0.78, 0.075]]) {
    const slot = new THREE.Mesh(roundedPanel(0.09, 0.042, 0.02, 0.008, slotMat));
    slot.position.set(0, y, z); figure.add(slot);
  }

  // CanvasTexture is mapped onto the existing inset display mesh. Data is refreshed from ctx.view below.
  const face = document.createElement("canvas"); face.width = 512; face.height = 640;
  const g = face.getContext("2d");
  g.scale(2, 2);
  if (typeof g.roundRect !== "function") {
    g.roundRect = function (x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      this.moveTo(x + radius, y); this.arcTo(x + w, y, x + w, y + h, radius);
      this.arcTo(x + w, y + h, x, y + h, radius); this.arcTo(x, y + h, x, y, radius);
      this.arcTo(x, y, x + w, y, radius); this.closePath();
    };
  }
  const display = new THREE.CanvasTexture(face); display.colorSpace = THREE.SRGBColorSpace;
  const glassMat = new THREE.MeshBasicMaterial({ map: display, transparent: true, toneMapped: false });

  // Rounded polished housing, fine bezel, and inset touchscreen glass.
  const housing = new THREE.Mesh(roundedPanel(0.66, 0.8, 0.15, 0.15, caseMat));
  housing.position.set(0, 0.02, 0.28); figure.add(housing);
  const rearPlate = new THREE.Mesh(roundedPanel(0.59, 0.72, 0.13, 0.012, blackCeramic));
  rearPlate.rotation.y = Math.PI; rearPlate.position.set(0, 0.02, 0.265); figure.add(rearPlate);
  const bezel = new THREE.Mesh(roundedPanel(0.6, 0.74, 0.125, 0.024, edgeMat));
  bezel.position.set(0, 0.02, 0.432); figure.add(bezel);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.65), glassMat);
  glass.position.set(0, 0.02, 0.46); figure.add(glass);
  const reflection = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.65), new THREE.MeshPhysicalMaterial({
    color: 0xb9e9ff, transparent: true, opacity: 0.055, roughness: 0.12, metalness: 0.18,
    clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false,
  }));
  reflection.position.set(0, 0.02, 0.461); figure.add(reflection);

  for (const y of [-0.47, 0.47]) {
    const lug = new THREE.Mesh(roundedPanel(0.35, 0.105, 0.045, 0.105, edgeMat));
    lug.position.set(0, y, 0.30); figure.add(lug);
  }

  // Physical side controls and a hint of the optical sensor cluster under the case.
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.1, 24), edgeMat);
  crown.rotation.z = Math.PI / 2; crown.position.set(0.37, 0.12, 0.34); figure.add(crown);
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.007, 8, 32), blackCeramic);
  crownRing.rotation.y = Math.PI / 2; crownRing.position.set(0.423, 0.12, 0.34); figure.add(crownRing);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.08, 20), caseMat);
  button.rotation.z = Math.PI / 2; button.position.set(0.365, -0.14, 0.34); figure.add(button);
  const sensorRing = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.035, 40), edgeMat);
  sensorRing.rotation.x = Math.PI / 2; sensorRing.position.set(0, 0.02, 0.255); figure.add(sensorRing);
  const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 40), glow);
  sensor.rotation.x = Math.PI / 2; sensor.position.set(0, 0.02, 0.231); figure.add(sensor);
  for (let i = 0; i < 4; i++) {
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), quiet);
    const a = i * Math.PI / 2;
    led.position.set(Math.cos(a) * 0.065, 0.02 + Math.sin(a) * 0.065, 0.232); figure.add(led);
  }
  return { figure, glow, face, display };
}

function makeChestHub(parent) {
  const unit = new THREE.Group();
  parent.add(unit);
  const fabric = new THREE.MeshStandardMaterial({ color: 0x3c596c, map: wovenTexture(2, 5), roughness: 0.88, metalness: 0.04 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xa4b6c5, roughness: 0.3, metalness: 0.72 });
  const shell = new THREE.MeshStandardMaterial({ color: 0x253341, roughness: 0.22, metalness: 0.58 });
  const groove = new THREE.MeshBasicMaterial({ color: 0x080b12 });
  const stitch = new THREE.MeshStandardMaterial({ color: 0x7790a0, roughness: 0.9 });
  const violet = new THREE.MeshStandardMaterial({ color: 0x70e9e3, emissive: 0x0b9d9b, emissiveIntensity: 1.45, roughness: 0.22, metalness: 0.26 });
  const strapL = new THREE.Mesh(roundedPanel(0.16, 0.78, 0.075, 0.055, fabric));
  strapL.rotation.z = -0.29; strapL.position.set(-0.22, 0.1, -0.08); unit.add(strapL);
  const strapR = strapL.clone(); strapR.rotation.z = 0.29; strapR.position.x = 0.22; unit.add(strapR);
  const diagL = new THREE.Mesh(roundedPanel(0.125, 0.73, 0.055, 0.04, fabric));
  diagL.rotation.z = -0.72; diagL.position.set(-0.25, -0.12, 0.015); unit.add(diagL);
  const diagR = diagL.clone(); diagR.rotation.z = 0.72; diagR.position.x = 0.25; unit.add(diagR);
  const cross = new THREE.Mesh(roundedPanel(0.72, 0.14, 0.065, 0.07, fabric));
  cross.position.set(0, -0.23, -0.025); unit.add(cross);
  // Compact adjusters and short stitch marks make the webbing read as a sewn harness.
  for (const x of [-0.25, 0.25]) {
    const buckle = new THREE.Mesh(roundedPanel(0.2, 0.095, 0.03, 0.045, trim));
    buckle.position.set(x, 0.37, 0.01); unit.add(buckle);
    const bar = new THREE.Mesh(roundedPanel(0.025, 0.07, 0.01, 0.012, shell));
    bar.position.set(x, 0.37, 0.062); unit.add(bar);
    for (const y of [-0.18, 0, 0.18, 0.52]) {
      const seam = new THREE.Mesh(roundedPanel(0.012, 0.045, 0.005, 0.005, stitch));
      seam.position.set(x + (x < 0 ? -0.045 : 0.045), y, 0.022); unit.add(seam);
    }
  }
  const rim = new THREE.Mesh(shieldPanel(0.76, 0.72, 0.11, trim));
  rim.position.z = 0.01; unit.add(rim);
  const hub = new THREE.Mesh(shieldPanel(0.68, 0.65, 0.12, shell));
  hub.position.set(0, 0.015, 0.12); unit.add(hub);
  const inset = new THREE.Mesh(roundedPanel(0.45, 0.29, 0.09, 0.012, new THREE.MeshBasicMaterial({ color: 0x090c14 })));
  inset.position.set(0, 0.095, 0.245); unit.add(inset);
  const labelCanvas = document.createElement("canvas"); labelCanvas.width = 384; labelCanvas.height = 96;
  const labelCtx = labelCanvas.getContext("2d");
  labelCtx.fillStyle = "#dbe5f2"; labelCtx.font = "600 42px system-ui, sans-serif"; labelCtx.textAlign = "center"; labelCtx.fillText("SpaceWear", 192, 62);
  const labelTexture = new THREE.CanvasTexture(labelCanvas); labelTexture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.075), new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, toneMapped: false }));
  label.position.set(0, 0.17, 0.259); unit.add(label);
  for (const x of [-0.17, 0.17]) {
    const light = new THREE.Mesh(roundedPanel(0.028, 0.15, 0.012, 0.012, violet));
    light.position.set(x, -0.015, 0.26); unit.add(light);
  }
  const status = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), violet);
  status.position.set(0, 0.23, 0.26); unit.add(status);
  for (const x of [-0.22, -0.11, 0, 0.11, 0.22]) {
    const vent = new THREE.Mesh(roundedPanel(0.065, 0.009, 0.004, 0.004, groove));
    vent.position.set(x, -0.17, 0.26); unit.add(vent);
  }
  for (const x of [-0.28, 0.28]) for (const y of [-0.23, 0.27]) {
    const screw = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), trim);
    screw.position.set(x, y, 0.265); unit.add(screw);
  }
  for (const x of [-0.30, 0.30]) {
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 20), trim);
    port.rotation.z = Math.PI / 2; port.position.set(x, -0.12, 0.12); unit.add(port);
  }
  // Inner-facing biometric contact pads sit against the suit side of the harness.
  for (const [x, y] of [[-0.24, 0.38], [0.24, 0.38], [-0.25, -0.21], [0.25, -0.21]]) {
    const contact = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 20), violet);
    contact.rotation.x = Math.PI / 2; contact.position.set(x, y, -0.13); unit.add(contact);
  }
  unit.scale.setScalar(0.68);
  unit.rotation.y = -0.12;
  return unit;
}

function makePatchSensor(parent) {
  const patch = new THREE.Group();
  parent.add(patch);
  const pad = new THREE.MeshStandardMaterial({ color: 0x202631, roughness: 0.88, metalness: 0.02 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x728092, roughness: 0.32, metalness: 0.68 });
  const center = new THREE.MeshStandardMaterial({ color: 0x293648, roughness: 0.2, metalness: 0.32, emissive: 0x12304a, emissiveIntensity: 0.45 });
  const adhesive = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.045, 48), pad);
  adhesive.rotation.x = Math.PI / 2; patch.add(adhesive);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.205, 0.095, 48), rim);
  shell.rotation.x = Math.PI / 2; shell.position.z = 0.045; patch.add(shell);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.125, 32, 24), center);
  dome.scale.z = 0.28; dome.position.z = 0.105; patch.add(dome);
  const led = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 8, 40), new THREE.MeshBasicMaterial({ color: 0x62d7ff }));
  patch.add(led);
  patch.scale.setScalar(1.0);
  patch.rotation.y = -0.18;
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

export function mountWearableFigure(host, body3d, world, ctx) {
  const panel = host.querySelector("#wearable-host");
  if (!panel) return () => {};
  panel.innerHTML = `<header class="wearable-head"><div><span class="wearable-kicker">SPACEWEAR</span><small class="wearable-subhead">CREW HEALTH SYSTEMS</small></div><span class="badge badge-designed">CONCEPT</span></header>
    <div class="wearable-viewer"><canvas aria-label="Three rotatable SpaceWear product models: chest module, health watch, and biometric patch"></canvas>
      <button class="wearable-part-label chest-label" data-part="chest" type="button" aria-label="Open chest module details"><b>01</b><span>CHEST MODULE</span><small>Biometric hub / harness</small></button>
      <button class="wearable-part-label wrist-label" data-part="wrist" type="button" aria-label="Open wrist module details"><b>02</b><span>WRIST MODULE</span><small>Health display / controls</small></button>
      <button class="wearable-part-label patch-label" data-part="patch" type="button" aria-label="Open patch sensor details"><b>03</b><span>PATCH SENSOR</span><small>Contact / hydration node</small></button>
      <div class="wearable-detail-head" hidden><button class="wearable-back" type="button" data-back>← All wearables</button><strong data-detail-title></strong><small data-detail-copy></small></div>
      <span class="wearable-hint">Drag a module to inspect</span></div>
    <div class="wearable-copy"><strong>SpaceWear monitoring suite</strong><small>Concept hardware · SIM values are identified on the watch display.</small></div>`;
  const canvas = panel.querySelector("canvas");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch (error) {
    console.warn("wearable model could not start", error);
    panel.classList.add("wearable-unavailable");
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x050912, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xb9d8ff, 0x10131d, 1.35));
  const key = new THREE.DirectionalLight(0xfff5e8, 3.0); key.position.set(2.4, 3.0, 4.0); scene.add(key);
  const fill = new THREE.DirectionalLight(0x91a9ca, 1.4); fill.position.set(-3, 1.0, 2.0); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x8956ff, 2.1); rim.position.set(-2.2, 2.0, -2.5); scene.add(rim);
  const sceneRoot = new THREE.Group(); scene.add(sceneRoot);
  const chest = makeChestHub(sceneRoot);
  const { figure: wrist, face, display } = makeWatch(sceneRoot);
  const patchSensor = makePatchSensor(sceneRoot);
  const parts = [
    { id: "chest", object: chest, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 30), top: 0, height: 0.34 },
    { id: "wrist", object: wrist, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 30), top: 0.34, height: 0.47 },
    { id: "patch", object: patchSensor, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 30), top: 0.81, height: 0.19 },
  ];
  for (const part of parts) part.object.visible = false;
  let drag = null, selectedPart = null;
  const viewer = panel.querySelector(".wearable-viewer");
  const detailHead = viewer.querySelector(".wearable-detail-head");
  const hint = viewer.querySelector(".wearable-hint");
  const partDetails = {
    chest: ["SPACEWEAR CHEST MODULE", "Harness-mounted biometric hub · CONCEPT"],
    wrist: ["SPACEWEAR WRIST MODULE", "Interactive health display · sensor sources labeled on screen"],
    patch: ["SPACEWEAR PATCH SENSOR", "Skin-contact sensor concept · readings not connected"],
  };
  const showPart = (id = null) => {
    selectedPart = id;
    panel.classList.toggle("is-device-detail", !!id);
    viewer.querySelectorAll("[data-part]").forEach((b) => { b.hidden = !!id; });
    detailHead.hidden = !id;
    hint.textContent = id ? "Drag to rotate · click back to return" : "Click a device for details · drag to rotate";
    if (id) {
      detailHead.querySelector("[data-detail-title]").textContent = partDetails[id][0];
      detailHead.querySelector("[data-detail-copy]").textContent = partDetails[id][1];
    }
    resize();
  };
  viewer.querySelectorAll("[data-part]").forEach((b) => b.addEventListener("click", () => showPart(b.dataset.part)));
  const backButton = viewer.querySelector("[data-back]");
  const restoreAllWearables = (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    showPart(null);
    // Repaint immediately so the full lineup returns even if the animation loop is paused.
    renderParts();
  };
  backButton.addEventListener("pointerdown", restoreAllWearables);
  backButton.addEventListener("click", (event) => {
    // Pointer activation is handled on pointerdown; preserve keyboard activation too.
    if (event.detail === 0) restoreAllWearables(event);
  });
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    renderer.setSize(r.width, r.height, false);
    for (const part of parts) fitPartCamera(part, r.width / Math.max(40, r.height * (selectedPart ? 1 : part.height)));
    const w = world.size;
    const hostRect = host.getBoundingClientRect();
    const bodyRect = { left: hostRect.left, top: hostRect.top, width: Math.max(120, r.left - hostRect.left - 12), height: hostRect.height };
    body3d.setFrameRect(bodyRect);
    body3d.resize(w.W, w.H);
  };
  const ro = new ResizeObserver(resize); ro.observe(panel); resize();
  const stopBodyDrag = (e) => e.stopPropagation();
  ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"].forEach((name) => canvas.addEventListener(name, stopBodyDrag, { passive: name === "wheel" }));
  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const part = selectedPart ? parts.find((p) => p.id === selectedPart) : parts.find((p) => y >= p.top && y < p.top + p.height) || parts[1];
    drag = { x: e.clientX, y: e.clientY, az: part.object.rotation.y, part, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.moved = true;
    if (!drag.moved) return;
    drag.part.object.rotation.y = clamp(drag.az + (e.clientX - drag.x) * 0.008, -0.86, 0.86);
  });
  const finish = (e) => {
    if (drag && !drag.moved && !selectedPart) showPart(drag.part.id);
    drag = null;
  };
  canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish);

  const startDay = new Date().setHours(0, 0, 0, 0);
  let raf = 0, lastPaint = 0, activitySteps = 6482, activityCalories = 286;
  // Paint once immediately; previously the first texture update waited for the animation loop.
  try {
    paintDashboard(face.getContext("2d"), ctx?.view?.state, 0, activitySteps, activityCalories, !!ctx?.view?.online);
  } catch (error) {
    console.warn("watch dashboard could not draw on startup", error);
    const g = face.getContext("2d");
    g.setTransform(2, 0, 0, 2, 0, 0); g.fillStyle = "#050a11"; g.fillRect(0, 0, 256, 320);
    g.fillStyle = "#f5fbff"; g.font = "700 13px system-ui"; g.fillText("SENTINEL WATCH", 22, 42);
    g.fillStyle = "#ffbd65"; g.font = "600 9px system-ui"; g.fillText("SIMULATED READINGS", 22, 62);
  }
  display.needsUpdate = true;
  const renderParts = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    renderer.setScissorTest(true);
    const visibleParts = selectedPart ? parts.filter((part) => part.id === selectedPart) : parts;
    for (const part of visibleParts) {
      const top = selectedPart ? 0 : part.top;
      const sectionHeight = selectedPart ? 1 : part.height;
      const yTop = rect.height * top;
      const height = rect.height * sectionHeight;
      const yBottom = rect.height - yTop - height;
      renderer.setViewport(0, yBottom, rect.width, height);
      renderer.setScissor(0, yBottom, rect.width, height);
      renderer.clear(true, true, true);
      for (const p of parts) p.object.visible = p === part;
      renderer.render(scene, part.camera);
    }
    renderer.setScissorTest(false);
    for (const p of parts) p.object.visible = false;
  };
  renderParts();
  const draw = (now) => {
    raf = requestAnimationFrame(draw);
    const active = document.body.dataset.stage === "body" && !document.hidden;
    if (!active) return;
    if (now - lastPaint > 120) {
      // Activity values are an adapter seam: replace these fallbacks with API, socket, or sensor fields later.
      const elapsedMinutes = Math.max(0, (Date.now() - startDay) / 60000);
      const stepTarget = Math.min(12000, 6482 + Math.floor(elapsedMinutes * 2.1));
      const calorieTarget = Math.min(900, 286 + Math.floor(elapsedMinutes * 0.28));
      activitySteps += (stepTarget - activitySteps) * 0.2;
      activityCalories += (calorieTarget - activityCalories) * 0.2;
      try {
        paintDashboard(face.getContext("2d"), ctx?.view?.state, now, activitySteps, activityCalories, !!ctx?.view?.online);
      } catch (error) {
        console.warn("watch dashboard could not draw", error);
        const g = face.getContext("2d");
        g.setTransform(2, 0, 0, 2, 0, 0); g.fillStyle = "#050a11"; g.fillRect(0, 0, 256, 320);
        g.fillStyle = "#f5fbff"; g.font = "700 13px system-ui"; g.fillText("SENTINEL WATCH", 22, 42);
        g.fillStyle = "#ffbd65"; g.font = "600 9px system-ui"; g.fillText("SIMULATED READINGS", 22, 62);
      }
      display.needsUpdate = true;
      lastPaint = now;
    }
    renderParts();
  };
  raf = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(raf); ro.disconnect();
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
    body3d.setFrameRect(null);
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
  const distance = radius / Math.sin(Math.min(vertical, horizontal) * 0.5) * 1.18;
  camera.position.set(center.x + 0.04, center.y + 0.025, center.z + distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}
