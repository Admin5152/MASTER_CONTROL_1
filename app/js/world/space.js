// Space scene: real-texture Earth (day/night blend, clouds, atmosphere), Moon on a slow orbit, Mars,
// a starfield, thin orbit lines and a solar particle stream driven by the NOAA storm level.
// Views ("assistant", "mission", "radiation") are eased camera moves; the camera also drifts a little.
import * as THREE from "three";

const TEX = "assets/space/";
const SUN = new THREE.Vector3(-1, 0.35, 0.62).normalize();
const MOON_POS = new THREE.Vector3(-4, 0, -2);
const MARS_POS = new THREE.Vector3(2.5, 1.8, -14);   // small and far, up and to the right of Earth: the destination, clear of the text

const VIEWS = {
  // fx, fy: where the planet sits on screen (fractions); r: planet radius as a fraction of screen height
  home: { target: "earth", fx: 0.5, fy: 1.62, r: 0.62, az: 0.15, el: 0.42 },
  assistant: { target: "earth", fx: 0.5, fy: 1.62, r: 0.62, az: 0.15, el: 0.42 },
  mission: { target: "earth", fx: 0.64, fy: 0.42, r: 0.27, az: 0.12, el: 0.12 },   // up and right: frames the headline, clear of the cards
  radiation: { target: "earth", fx: 0.67, fy: 0.28, r: 0.17, az: -0.25, el: 0.06 },
  calm: { target: "earth", fx: 0.5, fy: 1.75, r: 0.6, az: 0.4, el: 0.3 },
};

const earthVert = /* glsl */`
varying vec2 vUv; varying vec3 vWN; varying vec3 vVN; varying vec3 vVV;
void main() {
  vUv = uv;
  vWN = normalize(mat3(modelMatrix) * normal);
  vVN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vVV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const earthFrag = /* glsl */`
uniform sampler2D dayMap; uniform sampler2D nightMap; uniform vec3 sunDir;
varying vec2 vUv; varying vec3 vWN; varying vec3 vVN; varying vec3 vVV;
void main() {
  float d = dot(normalize(vWN), sunDir);
  float dayAmt = smoothstep(-0.18, 0.28, d);
  vec3 day = texture2D(dayMap, vUv).rgb;
  vec3 night = texture2D(nightMap, vUv).rgb;
  vec3 col = mix(night * vec3(1.6, 1.3, 0.9), day * (0.08 + 1.15 * max(d, 0.0)), dayAmt);
  float fr = pow(1.0 - max(dot(normalize(vVN), normalize(vVV)), 0.0), 2.6);
  col += vec3(0.30, 0.58, 1.0) * fr * (0.12 + 0.9 * smoothstep(-0.2, 0.6, d));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const atmoFrag = /* glsl */`
uniform vec3 sunDir; uniform vec3 tint;
varying vec2 vUv; varying vec3 vWN; varying vec3 vVN; varying vec3 vVV;
void main() {
  // back faces: dot(n, v) runs from about -0.5 at the planet's edge to 0 at the atmosphere's edge
  float rim = pow(clamp(-dot(normalize(vVN), normalize(vVV)) * 1.7, 0.0, 1.0), 2.4);
  float lit = 0.25 + 0.95 * smoothstep(-0.35, 0.5, dot(normalize(vWN), sunDir));
  gl_FragColor = vec4(tint * rim * lit * 1.6, rim * lit);
  #include <colorspace_fragment>
}`;
const particleVert = /* glsl */`
attribute float aLife; uniform float uSize; varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (1.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const particleFrag = /* glsl */`
uniform vec3 uColor; uniform float uAlpha; varying float vLife;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(uColor * (0.6 + vLife), a * uAlpha * (0.25 + vLife));
}`;

export function createSpace(world, { tablet = false } = {}) {
  const renderer = world.renderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
  const loader = new THREE.TextureLoader();
  const maxTex = renderer.capabilities.maxTextureSize;
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpuName);
  // brief: 2k Earth on tablets, 8k on the laptop (only with a real GPU; loaded after the 2k is showing)
  // the 8k texture is opt-in (?hires=1): on this laptop's shared-memory GPU it ran the GPU out of memory
  const useHi = !tablet && !software && maxTex >= 8192 && /[?&]hires=1/.test(location.search);
  const tex = (name, srgb = true) => {
    const t = loader.load(TEX + name);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };

  // light
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
  sunLight.position.copy(SUN).multiplyScalar(30);
  scene.add(sunLight, new THREE.AmbientLight(0x2a3550, 0.25));

  // Earth
  const earth = new THREE.Group();
  scene.add(earth);
  earth.rotation.z = THREE.MathUtils.degToRad(-23.4);
  const dayMap = tex("earth_day.jpg");
  const nightMap = tex("earth_night.jpg");
  const earthUniforms = { dayMap: { value: dayMap }, nightMap: { value: nightMap }, sunDir: { value: SUN.clone() } };
  if (useHi) {
    setTimeout(() => loader.load(TEX + "earth_day_8k.jpg", (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      earthUniforms.dayMap.value = t;
    }), 4000);
  }
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, tablet ? 72 : 128, tablet ? 36 : 64), new THREE.ShaderMaterial({ uniforms: earthUniforms, vertexShader: earthVert, fragmentShader: earthFrag }));
  earth.add(globe);
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, tablet ? 64 : 96, tablet ? 32 : 48),
    new THREE.MeshStandardMaterial({ alphaMap: tex("earth_clouds.jpg", false), color: 0xffffff, transparent: true, depthWrite: false, roughness: 1, metalness: 0, opacity: 0.9 }));
  earth.add(clouds);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.14, 64, 32), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: SUN.clone() }, tint: { value: new THREE.Color(0.35, 0.62, 1.0) } },
    vertexShader: earthVert, fragmentShader: atmoFrag, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(atmo);

  // Moon on a slow inclined orbit, with its orbit line
  const moonPivot = new THREE.Group();
  moonPivot.rotation.x = 0.28; moonPivot.rotation.z = -0.12;
  scene.add(moonPivot);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.27, 48, 24), new THREE.MeshStandardMaterial({ map: tex("moon.jpg"), roughness: 1 }));
  moon.position.set(3.3, 0, 0);
  moonPivot.add(moon);
  const ring = (r, opacity, segments = 256) => {
    const pts = [];
    for (let i = 0; i <= segments; i++) { const a = (i / segments) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity, depthWrite: false }));
  };
  moonPivot.add(ring(3.3, 0.22));
  const outer = ring(5.2, 0.12);
  outer.rotation.set(0.42, 0, 0.3);
  scene.add(outer);

  // Mars in the distance (and the radiation focus on Mars profiles)
  const mars = new THREE.Mesh(new THREE.SphereGeometry(0.53, 64, 32), new THREE.MeshStandardMaterial({ map: tex("mars.jpg"), roughness: 1 }));
  mars.position.copy(MARS_POS);
  mars.visible = false;  // shown on the mission and radiation views of a Mars profile
  scene.add(mars);
  const marsAtmo = new THREE.Mesh(new THREE.SphereGeometry(0.53 * 1.08, 48, 24), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: SUN.clone() }, tint: { value: new THREE.Color(1.0, 0.55, 0.35) } },
    vertexShader: earthVert, fragmentShader: atmoFrag, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  marsAtmo.position.copy(MARS_POS);
  scene.add(marsAtmo);

  const lunarGlobe = new THREE.Mesh(new THREE.SphereGeometry(0.7, 64, 32), new THREE.MeshStandardMaterial({ map: tex("moon.jpg"), roughness: 1 }));
  lunarGlobe.position.copy(MOON_POS);
  lunarGlobe.visible = false;
  scene.add(lunarGlobe);
  const locationPin = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshBasicMaterial({ color: 0x57f5db }));
  locationPin.visible = false;
  scene.add(locationPin);
  let crewLocation = null;
  function locateCrew() {
    const surface = profile === "lunar" || profile === "mars_surface";
    const valid = crewLocation && crewLocation.source !== "unknown" && Number.isFinite(crewLocation.latitude) && Number.isFinite(crewLocation.longitude);
    locationPin.visible = false; // The inline explorer owns radiation location markers.
    if (!locationPin.visible) return;
    const body = profile === "lunar" ? lunarGlobe : mars;
    const radius = profile === "lunar" ? 0.7 : 0.53;
    const lat = THREE.MathUtils.degToRad(crewLocation.latitude), lon = THREE.MathUtils.degToRad(crewLocation.longitude);
    locationPin.position.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(radius * 1.035).applyQuaternion(body.quaternion).add(body.position);
    locationPin.scale.setScalar(radius);
  }

  // solar particle stream: flows along -SUN, deflects around the planet limb
  const NP = tablet ? 600 : 1400;
  const pPos = new Float32Array(NP * 3), pLife = new Float32Array(NP), pSpeed = new Float32Array(NP);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("aLife", new THREE.BufferAttribute(pLife, 1));
  const pUni = { uSize: { value: tablet ? 26 : 34 }, uColor: { value: new THREE.Color(0.55, 0.85, 1.0) }, uAlpha: { value: 0 } };
  const particles = new THREE.Points(pGeo, new THREE.ShaderMaterial({ uniforms: pUni, vertexShader: particleVert, fragmentShader: particleFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  particles.frustumCulled = false;
  scene.add(particles);
  const flow = SUN.clone().negate();
  const basisA = new THREE.Vector3().crossVectors(flow, new THREE.Vector3(0, 1, 0)).normalize();
  const basisB = new THREE.Vector3().crossVectors(flow, basisA).normalize();
  const center = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  function spawn(i, anywhere) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 1.9;
    const back = anywhere ? -7 + Math.random() * 10 : -7 - Math.random();
    tmp.copy(center).addScaledVector(flow, back).addScaledVector(basisA, Math.cos(a) * r).addScaledVector(basisB, Math.sin(a) * r);
    pPos[i * 3] = tmp.x; pPos[i * 3 + 1] = tmp.y; pPos[i * 3 + 2] = tmp.z;
    pLife[i] = 0; pSpeed[i] = 0.6 + Math.random() * 0.8;
  }
  for (let i = 0; i < NP; i++) spawn(i, true);
  let storm = 0, stormTarget = 0, streamOn = false;

  // camera view (tweened)
  const v = { tx: 0, ty: 0, tz: 0, fx: 0.5, fy: 1.42, r: 0.52, az: 0, el: 0.32 };
  let currentView = "assistant";
  let profile = "mars_transit";
  let W = 1, H = 1;
  function targetPos(name) {
    const tgt = VIEWS[name].target === "mars" ? MARS_POS : new THREE.Vector3();
    return tgt;
  }

  function setView(name, { instant = false } = {}) {
    const def = { ...(VIEWS[name] || VIEWS.assistant) };
    if (name === "radiation" && profile.startsWith("mars")) def.target = "mars";
    if (name === "radiation" && profile === "lunar") def.target = "moon";
    lunarGlobe.visible = false;
    earth.visible = atmo.visible = name !== "radiation";
    moonPivot.visible = name !== "radiation";
    currentView = name;
    streamOn = name === "radiation";
    moonPivot.children[1].visible = outer.visible = false;   // orbit lines cut through the headline text
    mars.visible = marsAtmo.visible = profile.startsWith("mars") && name === "mission";
    const tp = def.target === "mars" ? MARS_POS : def.target === "moon" ? MOON_POS : new THREE.Vector3();
    center.copy(tp);
    const r = def.target === "mars" ? def.r : def.r;
    if (name === "radiation" && crewLocation && (profile === "lunar" || profile === "mars_surface")) {
      def.az = Math.PI / 2 + THREE.MathUtils.degToRad(crewLocation.longitude);
      def.el = THREE.MathUtils.degToRad(crewLocation.latitude);
    }
    const to = { tx: tp.x, ty: tp.y, tz: tp.z, fx: def.fx, fy: def.fy, r: def.target === "mars" ? r * (1 / 0.53) * 0.53 : r, az: def.az, el: def.el };
    to.radius = def.target === "mars" ? 0.53 : def.target === "moon" ? 0.7 : 1;
    v.radius = v.radius ?? 1;
    const g = window.gsap;
    if (instant || !g || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) Object.assign(v, to);
    else g.to(v, { ...to, duration: 1.8, ease: "power3.inOut", overwrite: true });
    for (let i = 0; i < NP; i++) spawn(i, true);
  }

  function resize(w, h) { W = w; H = h; camera.aspect = w / h; camera.updateProjectionMatrix(); }

  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  function update(dt, t) {
    earth.rotation.y += dt * 0.025;
    clouds.rotation.y += dt * 0.008;
    moonPivot.rotation.y += dt * 0.045;
    moon.rotation.y += dt * 0.02;
    if (currentView !== "radiation") mars.rotation.y += dt * 0.02;
    locateCrew();
    atmo.visible = earth.visible && world.theme !== "light";   // an additive glow reads as a grey disc on the pale sky
    // camera: distance from the planet's screen size, plus a slow drift
    const radius = v.radius ?? 1;
    const dist = radius / (2 * v.r * half);
    const az = v.az + Math.sin(t * 0.05) * 0.05;
    const el = v.el + Math.sin(t * 0.037) * 0.02;
    camera.position.set(v.tx + dist * Math.sin(az) * Math.cos(el), v.ty + dist * Math.sin(el), v.tz + dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(v.tx, v.ty, v.tz);
    camera.setViewOffset(W, H, W * (0.5 - v.fx), H * (0.5 - v.fy), W, H);
    // particles
    storm += (stormTarget - storm) * Math.min(1, dt * 1.5);
    const show = streamOn ? 1 : 0;
    pUni.uAlpha.value += ((show ? 0.35 + storm * 0.13 : 0) - pUni.uAlpha.value) * Math.min(1, dt * 2);
    if (pUni.uAlpha.value > 0.01) {
      const cHot = new THREE.Color(1.0, 0.45, 0.3), cCool = new THREE.Color(0.55, 0.85, 1.0);
      pUni.uColor.value.copy(cCool).lerp(cHot, Math.min(1, storm / 3));
      const speed = 1.4 + storm * 0.9;
      const active = Math.floor(NP * (0.35 + Math.min(1, storm / 3) * 0.65));
      const pr = (center.equals(MARS_POS) ? 0.53 : 1) * 1.28;
      for (let i = 0; i < NP; i++) {
        const k = i * 3;
        if (i >= active) { pPos[k + 1] = 9999; continue; }
        if (pPos[k + 1] > 9000) spawn(i, false);
        let x = pPos[k], y = pPos[k + 1], z = pPos[k + 2];
        const s = speed * pSpeed[i] * dt;
        x += flow.x * s; y += flow.y * s; z += flow.z * s;
        // deflect around the planet (bow-shock look)
        const dx = x - center.x, dy = y - center.y, dz = z - center.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < pr) {
          const push = (pr - d) / d;
          x += dx * push; y += dy * push; z += dz * push;
          pLife[i] = Math.min(1, pLife[i] + dt * 3);
        } else pLife[i] = Math.max(0, pLife[i] - dt * 0.8);
        pPos[k] = x; pPos[k + 1] = y; pPos[k + 2] = z;
        if ((dx * flow.x + dy * flow.y + dz * flow.z) > 4) spawn(i, false);
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.aLife.needsUpdate = true;
    }
  }

  setView("assistant", { instant: true });
  return {
    scene, camera, update, resize, setView,
    get view() { return currentView; },
    setStorm(level) { stormTarget = Math.max(0, Math.min(5, Number(level) || 0)); },
    setProfile(p) {
      const changed = p !== profile;
      profile = p || profile;
      if (changed && currentView === "radiation") setView("radiation");
    },
    setLocation(location) {
      const changed = JSON.stringify(crewLocation) !== JSON.stringify(location);
      crewLocation = location;
      if (changed && currentView === "radiation") setView("radiation");
      locateCrew();
    },
    hiRes: useHi,
    gpu: gpuName,
  };
}
