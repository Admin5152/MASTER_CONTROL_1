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
  dialog.innerHTML = `<header><div><h2>${name} explorer</h2><p>${profile === "mars_transit" ? "Destination preview / SIM sites, not current crew positions" : "SIM / fictional crew and shelter locations"}</p></div><span class="label">SURFACE OPERATIONS / SIM</span></header>
    <p class="planet-help">Drag to explore the surface. Scroll or pinch to move closer. Click a location to fly there; select a marker for details.</p>
    <div class="planet-workspace"><div class="planet-viewport"><canvas aria-label="Interactive ${name} globe"></canvas><div class="planet-tools"><button type="button" data-zoom-in aria-label="Zoom in">+</button><button type="button" data-zoom-out aria-label="Zoom out">−</button><button type="button" data-reset>Reset view</button></div></div>
    <aside><p>Green: astronauts. Amber: shelters. Red shaded area: high radiation. All SIM</p><div data-sites></div><p data-selected aria-live="polite">${surface ? "Select an astronaut or shelter." : "Orbit / transit: no surface crew or shelters are shown."}</p></aside></div>`;
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
  const texture = new THREE.TextureLoader().load(`assets/space/${moon ? "moon.jpg" : name === "Mars" ? "mars.jpg" : "earth_day.jpg"}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
  scene.add(globe, new THREE.AmbientLight(0xffffff, 2.3));
  const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(3, 2, 4); scene.add(light);
  const position = (lat, lon, radius = 1.025) => {
    const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lon);
    return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)).multiplyScalar(radius);
  };
  const markers = points.map((site) => {
    const marker = new THREE.Mesh(site.type === "Shelter" ? new THREE.OctahedronGeometry(0.027) : new THREE.SphereGeometry(0.021, 16, 12), new THREE.MeshBasicMaterial({ color: site.type === "Shelter" ? 0xffbf5a : 0x57f5db }));
    marker.position.copy(position(site.lat, site.lon)); marker.userData.site = site; scene.add(marker); return marker;
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
      vertexShader: "varying float radial; void main(){ radial=uv.x; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "varying float radial; void main(){ float edge=1.0-smoothstep(0.72,1.0,radial); vec3 color=mix(vec3(1.0,0.15,0.08),vec3(1.0,0.55,0.08),radial); gl_FragColor=vec4(color,edge*0.6); }",
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    radiationPatch.userData.site = hotspot; scene.add(radiationPatch);
  }
  const labelLayer = document.createElement("div"); labelLayer.className = "planet-marker-labels";
  dialog.querySelector(".planet-viewport").append(labelLayer);
  const labels = [...points, ...(hotspot ? [hotspot] : [])].map(site => {
    const button = document.createElement("button"); button.type = "button";
    button.className = `planet-map-marker marker-${site.type.toLowerCase()}`;
    button.textContent = `${site.type === "Astronaut" ? "●" : site.type === "Shelter" ? "◆" : "⚠"} ${site.name} / SIM`;
    button.onclick = () => select(site); labelLayer.append(button);
    return { site, button, point: position(site.lat, site.lon, 1.04) };
  });
  function reset() { Object.assign(desired, { lat: surface ? base[0] : 10, lon: surface ? base[1] : 0, altitude: 2.2 }); }
  function zoom(factor) { desired.altitude = THREE.MathUtils.clamp(desired.altitude * factor, MIN_ALTITUDE, MAX_ALTITUDE); }
  function select(site) {
    dialog.querySelector("[data-selected]").textContent = `${site.name} / ${site.type} / SIM. ${site.lat.toFixed(4)}° latitude, ${site.lon.toFixed(4)}° longitude. ${site.status}. Fictional demo location, not operational guidance.`;
    Object.assign(desired, { lat: site.lat, lon: site.lon, altitude: 0.22 });
  }
  for (const site of [...points, ...(hotspot ? [hotspot] : [])]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `${site.type === "Shelter" ? "◆" : "●"} ${site.name} / SIM`; button.onclick = () => select(site); dialog.querySelector("[data-sites]").append(button);
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
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const rect = renderer.domElement.getBoundingClientRect();
    for (const [index, { button, point }] of labels.entries()) {
      const projected = point.clone().project(camera);
      const facing = point.clone().normalize().dot(camera.position.clone().sub(point)) > 0;
      const visible = facing && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.98;
      button.hidden = !visible;
      if (visible) { button.style.left = `${(projected.x + 1) * rect.width / 2}px`; button.style.top = `${(1 - projected.y) * rect.height / 2 + (index % 2 ? 18 : -12)}px`; }
    }
    renderer.render(scene, camera);
  });
  let disposed = false;
  function close() { if (disposed) return; disposed = true; observer.disconnect(); renderer.setAnimationLoop(null); scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); texture.dispose(); renderer.dispose(); dialog.remove(); }

  return close;
}
