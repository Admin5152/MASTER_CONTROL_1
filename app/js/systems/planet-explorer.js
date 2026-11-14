import * as THREE from "three";

// All surface occupants and shelter sites in this explorer are fictional demo data.
export function mountPlanetExplorer(host, profile, crewName = "Selected astronaut") {
  const moon = profile === "lunar", surface = moon || profile.startsWith("mars");
  const name = moon ? "Moon" : profile.startsWith("mars") ? "Mars" : "Earth";
  const base = moon ? [0.6741, 23.4729] : [-4.5895, 137.4417];
  const points = surface ? [
    { name: crewName, type: "Astronaut", lat: base[0], lon: base[1], status: "Surface survey" },
    { name: "Crew member 2", type: "Astronaut", lat: base[0] + 8, lon: base[1] + 12, status: "Field traverse" },
    { name: "Crew member 3", type: "Astronaut", lat: base[0] - 12, lon: base[1] - 15, status: "At habitat" },
    { name: "Primary shelter", type: "Shelter", lat: base[0] + 3, lon: base[1] + 4, status: "Demo shelter site; capacity 6" },
    { name: "Field shelter", type: "Shelter", lat: base[0] - 15, lon: base[1] + 22, status: "Demo shelter site; capacity 3" },
  ] : [];
  const hotspot = surface ? { name: "High radiation zone", type: "Radiation", lat: base[0] + 17, lon: base[1] - 7, status: "HIGH / simulated relative intensity. Illustrative region only; not a measured surface radiation map." } : null;
  const dialog = document.createElement("section");
  dialog.className = "planet-explorer planet-inline";
  dialog.innerHTML = `<header><span class="label">Surface operations</span><h2>${name}</h2><p>${profile === "mars_transit" ? "Destination preview. Sites are simulated, not crew positions." : "Simulated crew and shelter sites."}</p></header>
    <div class="planet-workspace"><div class="planet-viewport"><canvas aria-label="Interactive ${name} globe"></canvas><div class="planet-tools"><button type="button" data-zoom-in aria-label="Zoom in">+</button><button type="button" data-zoom-out aria-label="Zoom out">−</button><button type="button" data-reset>Reset</button><span class="planet-hint">Drag to turn · scroll to zoom · tap a site</span></div></div>
    <aside><p class="planet-key"><i class="k-crew"></i>Crew <i class="k-shelter"></i>Shelter <i class="k-rad"></i>High radiation <span class="badge badge-sim">SIM</span></p><div data-sites></div><p data-selected aria-live="polite">${surface ? "Select an astronaut or shelter." : "Orbit / transit: no surface crew or shelters are shown."}</p></aside></div>`;
  host.replaceChildren(dialog);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: dialog.querySelector("canvas"), antialias: true, alpha: true }); }
  catch { dialog.querySelector("[data-selected]").textContent = "3D view unavailable."; return () => dialog.remove(); }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = null;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.0001, 30);
  const view = { lat: surface ? base[0] : 10, lon: surface ? base[1] : 0, altitude: 2.2 };
  const desired = { ...view };
  const MIN_ALTITUDE = 0.06, MAX_ALTITUDE = 5;
  renderer.domElement.style.touchAction = "none";
  const texture = new THREE.TextureLoader().load(`assets/space/${moon ? "moon.jpg" : name === "Mars" ? "mars.jpg" : "earth_day_8k.jpg"}`);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
  globe.material.roughness = 0.95; globe.material.metalness = 0;
  if (name === "Earth") {   // oceans catch the sun; a cloud layer drifts above
    globe.material.roughness = 0.75; globe.material.metalness = 0.05;
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 128, 64), new THREE.MeshStandardMaterial({ alphaMap: new THREE.TextureLoader().load("assets/space/earth_clouds.jpg"), color: 0xffffff, transparent: true, depthWrite: false, roughness: 1 }));
    scene.add(clouds); globe.userData.clouds = clouds;
  }
  if (name !== "Earth") {   // terrain relief derived from the albedo map: craters and ridges catch the low sun
    const nrm = new THREE.TextureLoader().load(`assets/space/${moon ? "moon" : "mars"}_normal.jpg`);
    globe.material.normalMap = nrm; globe.material.normalScale.set(0.7, 0.7); globe.material.needsUpdate = true;
  }
  scene.add(globe, new THREE.AmbientLight(0xffffff, moon ? 0.05 : 0.08));
  const light = new THREE.DirectionalLight(0xfff4e6, 3.4); light.position.set(-3, 0.9, -1.6);   // from behind-left: a real day-night edge across the right of the disc
  camera.add(light); scene.add(camera);   // the sun sits up and to the left of wherever you look from
  if (!moon) {
    // a thin atmosphere: brightest at the limb, gone face-on (Mars: dusty salmon, Earth: blue)
    const tint = name === "Mars" ? new THREE.Color(0xe9a27c) : new THREE.Color(0x6fb7ff);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 48), new THREE.ShaderMaterial({
      uniforms: { tint: { value: tint }, power: { value: name === "Mars" ? 0.35 : 0.8 } },
      vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
      fragmentShader: "uniform vec3 tint; uniform float power; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(tint * f * power, f * power); }",
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    }));
    scene.add(atmo);
  }
  const position = (lat, lon, radius = 1.025) => {
    const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lon);
    return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)).multiplyScalar(radius);
  };
  const pulses = [];
  const markers = points.map((site) => {
    const marker = new THREE.Mesh(site.type === "Shelter" ? new THREE.OctahedronGeometry(0.027) : new THREE.SphereGeometry(0.021, 16, 12), new THREE.MeshBasicMaterial({ color: site.type === "Shelter" ? 0xffbf5a : 0x57f5db }));
    marker.material.visible = false;   // this mesh only catches taps
    marker.position.copy(position(site.lat, site.lon)); marker.userData.site = site; scene.add(marker);
    // on the ground: a thin ring and a small beacon, lying flat on the terrain like a survey marker
    const col = site.type === "Shelter" ? 0xffbf5a : 0x57f5db;
    const pin = new THREE.Group(); pin.position.copy(position(site.lat, site.lon, 1.0015)); pin.lookAt(pin.position.clone().multiplyScalar(2));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.011, 0.014, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.0135, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.004, 20), new THREE.MeshBasicMaterial({ color: col, depthWrite: false }));
    pin.add(ring, pulse, core); scene.add(pin); pulses.push(pulse);
    return marker;
  });
  let radiationPatch = null;
  if (hotspot) {
    // Spherical cap follows the surface rather than floating as a flat disc.
    const normal = position(hotspot.lat, hotspot.lon, 1);
    const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), normal).normalize();
    const north = new THREE.Vector3().crossVectors(normal, east).normalize();
    const vertices = [], uv = [], indices = [];
    const rings = 24, segments = 96, angularRadius = THREE.MathUtils.degToRad(13);
    for (let r = 0; r <= rings; r++) {
      const angle = angularRadius * r / rings;
      for (let j = 0; j <= segments; j++) {
        const az = j / segments * Math.PI * 2;
        const point = normal.clone().multiplyScalar(Math.cos(angle)).addScaledVector(east, Math.sin(angle) * Math.cos(az)).addScaledVector(north, Math.sin(angle) * Math.sin(az)).multiplyScalar(1.003);
        vertices.push(point.x, point.y, point.z); uv.push(r / rings, j / segments);
        if (r < rings && j < segments) { const i = r * (segments + 1) + j; indices.push(i, i + segments + 1, i + 1, i + 1, i + segments + 1, i + segments + 2); }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
    radiationPatch = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      vertexShader: "varying float radial; varying vec2 vUv; void main(){ radial=uv.x; vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "varying float radial; varying vec2 vUv; float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); } float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); } void main(){ float a=vUv.y*6.2831; vec2 q=vec2(cos(a),sin(a))*radial*3.0; float w=0.6*n(q*1.7)+0.4*n(q*4.1); float heat=clamp(1.0-radial*1.15+(w-0.5)*0.55,0.0,1.0); vec3 c=mix(vec3(1.0,0.72,0.25),vec3(1.0,0.2,0.1),heat); float iso=abs(fract(heat*3.0)-0.5); float line=(1.0-smoothstep(0.0,0.06,0.5-iso))*step(0.05,heat)*0.55; float ring=(1.0-smoothstep(0.0,0.012,abs(radial-0.9)))*0.7; gl_FragColor=vec4(c, heat*0.16+line+ring); }",
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    radiationPatch.userData.site = hotspot; scene.add(radiationPatch);
  }
  const labelLayer = document.createElement("div"); labelLayer.className = "planet-marker-labels";
  dialog.querySelector(".planet-viewport").append(labelLayer);
  const labels = [...points, ...(hotspot ? [hotspot] : [])].map(site => {
    const button = document.createElement("button"); button.type = "button";
    button.className = `planet-map-marker marker-${site.type.toLowerCase()}`;
    button.innerHTML = `<i></i><span>${site.name}</span>`; button.setAttribute("aria-label", `${site.name}, ${site.type}, simulated`);
    button.onclick = () => select(site); labelLayer.append(button);
    return { site, button, point: position(site.lat, site.lon, 1.04) };
  });
  function reset() { Object.assign(desired, { lat: surface ? base[0] : 10, lon: surface ? base[1] : 0, altitude: 2.2 }); }
  function zoom(factor) { desired.altitude = THREE.MathUtils.clamp(desired.altitude * factor, MIN_ALTITUDE, MAX_ALTITUDE); }
  function select(site) {
    for (const l of labels) l.button.classList.toggle("is-on", l.site === site);
    dialog.querySelector("[data-selected]").textContent = `${site.name} · ${site.type} · ${site.lat.toFixed(2)}°, ${site.lon.toFixed(2)}° · ${site.status}. Simulated site.`;
    Object.assign(desired, { lat: site.lat, lon: site.lon, altitude: 0.22 });
  }
  for (const site of [...points, ...(hotspot ? [hotspot] : [])]) {
    const button = document.createElement("button"); button.type = "button"; button.className = `chip-${site.type.toLowerCase()}`; button.textContent = site.name; button.onclick = () => select(site); dialog.querySelector("[data-sites]").append(button);
  }
  const raycaster = new THREE.Raycaster();
  const canvas = renderer.domElement;
  const pointers = new Map();
  let down = null, moved = false, pinchDistance = null;
  function pick(x, y) {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), camera);
    return raycaster.intersectObjects([globe, ...markers, ...(radiationPatch ? [radiationPatch] : [])])[0];
  }
  function focus(point) {
    const n = point.clone().normalize();
    desired.lat = THREE.MathUtils.radToDeg(Math.asin(n.y));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(-n.z, n.x));
    desired.lon += THREE.MathUtils.euclideanModulo(lon - desired.lon + 180, 360) - 180;
  }
  canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { down = { x: e.clientX, y: e.clientY }; moved = false; }
    else { moved = true; const p = [...pointers.values()]; pinchDistance = Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y); }
  });
  canvas.addEventListener("pointermove", e => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const p = [...pointers.values()], distance = Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y);
      if (pinchDistance && distance > 0) zoom(pinchDistance / distance);
      pinchDistance = distance; moved = true; return;
    }
    if (down && Math.hypot(e.clientX-down.x, e.clientY-down.y) > 5) moved = true;
    if (!moved) return;
    const speed = Math.min(0.3, desired.altitude * 0.2);
    desired.lon -= (e.clientX - previous.x) * speed;
    desired.lat = THREE.MathUtils.clamp(desired.lat + (e.clientY - previous.y) * speed, -88, 88);
  });
  canvas.addEventListener("pointerup", e => {
    const click = pointers.size === 1 && down && !moved;
    pointers.delete(e.pointerId); pinchDistance = null;
    if (!click) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit?.object.userData.site) select(hit.object.userData.site);
    else if (hit) { focus(hit.point); zoom(0.55); }
  });
  canvas.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); moved = true; pinchDistance = null; });
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const hit = pick(e.clientX, e.clientY);
    if (e.deltaY < 0 && hit) focus(hit.point);
    zoom(Math.exp(THREE.MathUtils.clamp(e.deltaY, -100, 100) * 0.003));
  }, { passive: false });
  const viewport = dialog.querySelector(".planet-viewport");
  const observer = new ResizeObserver(() => { const w = viewport.clientWidth, h = viewport.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); observer.observe(viewport);
  dialog.querySelector("[data-zoom-in]").onclick = () => zoom(0.8);
  dialog.querySelector("[data-zoom-out]").onclick = () => zoom(1.25);
  dialog.querySelector("[data-reset]").onclick = reset;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const blend = 1 - Math.exp(-10 * Math.min(clock.getDelta(), 0.1));
    for (const key of ["lat", "lon", "altitude"]) view[key] = THREE.MathUtils.lerp(view[key], desired[key], blend);
    const normal = position(view.lat, view.lon, 1);
    camera.position.copy(normal).multiplyScalar(1 + view.altitude);
    // Look at the selected surface, always remaining above the globe.
    camera.up.set(0, 1, 0);
    camera.lookAt(normal);
    for (const marker of markers) marker.scale.setScalar(Math.max(0.12, Math.min(1, view.altitude)));
    const tp = (performance.now() / 2200) % 1;
    for (const p of pulses) { p.scale.setScalar(1 + tp * 2.4); p.material.opacity = 0.6 * (1 - tp); }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const rect = renderer.domElement.getBoundingClientRect();
    for (const [index, { button, point }] of labels.entries()) {
      const projected = point.clone().project(camera);
      const facing = point.clone().normalize().dot(camera.position.clone().sub(point)) > 0;
      const visible = facing && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.98;
      button.hidden = !visible;
      if (visible) { button.style.left = `${(projected.x + 1) * rect.width / 2}px`; button.style.top = `${(1 - projected.y) * rect.height / 2}px`; }
    }
    if (globe.userData.clouds) globe.userData.clouds.rotation.y += 0.00012;
    renderer.render(scene, camera);
  });
  let disposed = false;
  function close() { if (disposed) return; disposed = true; observer.disconnect(); renderer.setAnimationLoop(null); scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); texture.dispose(); renderer.dispose(); dialog.remove(); }

  return close;
}
