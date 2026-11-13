// The world: one WebGL renderer for the full-screen background. It renders one of two scenes:
// "space" (stars, Earth, Moon, Mars, orbit lines, solar particles) or "body" (the 3D crew body in a
// navy studio). Scenes are swapped with a cross-fade; views inside a scene are camera moves.
import * as THREE from "three";

export const isTablet = /Android|iPad|Tablet/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTablet, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const maxDpr = isTablet ? 1.25 : 1.5;
  const fpsCap = isTablet ? 30 : 60;
  let W = 1, H = 1;
  const scenes = new Map();      // name -> { scene, camera, update(dt, t), resize(w, h), onShow?, onHide? }
  let active = null;
  let paused = false;
  let last = performance.now(), lastRender = 0, t = 0;
  const stats = { frames: 0, since: performance.now(), fps: 0, msAvg: 0, ms: [] };
  const listeners = new Set();   // per-frame hooks (hotspot projection etc.)

  function resize() {
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(W, H, false);
    for (const s of scenes.values()) s.resize?.(W, H);
  }
  window.addEventListener("resize", resize);

  function frame(now) {
    requestAnimationFrame(frame);
    if (paused || document.hidden || !active) { last = now; return; }
    if (now - lastRender < 1000 / fpsCap - 2) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; lastRender = now;
    t += dt * (reduced() ? 0.3 : 1);
    const s = scenes.get(active);
    const t0 = performance.now();
    s.update?.(dt, t);
    renderer.render(s.scene, s.camera);
    for (const fn of listeners) { try { fn(s, W, H); } catch (e) { console.warn("world hook", e); } }
    const ms = performance.now() - t0;
    stats.frames++; stats.ms.push(ms); if (stats.ms.length > 120) stats.ms.shift();
    if (now - stats.since > 1000) {
      stats.fps = (stats.frames * 1000) / (now - stats.since);
      stats.msAvg = stats.ms.reduce((a, b) => a + b, 0) / stats.ms.length;
      stats.frames = 0; stats.since = now;
    }
  }

  const world = {
    renderer, THREE, isTablet,
    get size() { return { W, H }; },
    get active() { return active; },
    add(name, def) { scenes.set(name, def); def.resize?.(W, H); return def; },
    get(name) { return scenes.get(name); },
    /** Show a scene. Cross-fades the canvas when the scene changes. */
    async show(name) {
      if (name === active || !scenes.has(name)) return;
      const prev = active;
      if (prev && !reduced()) {
        canvas.classList.add("is-fading");
        await new Promise((r) => setTimeout(r, 380));
      }
      if (prev) scenes.get(prev).onHide?.();
      active = name;
      scenes.get(name).onShow?.();
      canvas.classList.remove("is-fading");
    },
    pause(p) { paused = !!p; },
    onFrame(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    stats: () => ({ fps: Math.round(stats.fps * 10) / 10, msAvg: Math.round(stats.msAvg * 100) / 100, cap: fpsCap, dpr: renderer.getPixelRatio(), active }),
    /** Mean pixel brightness of the last frame (0-255), to prove the scene is not black. */
    probe() {
      const gl = renderer.getContext();
      const w = renderer.domElement.width, h = renderer.domElement.height;
      const px = new Uint8Array(4);
      let sum = 0, n = 0;
      // render synchronously then sample a grid of points
      const s = scenes.get(active);
      renderer.render(s.scene, s.camera);
      for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
        gl.readPixels(Math.floor((w * i) / 10), Math.floor((h * j) / 10), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        sum += (px[0] + px[1] + px[2]) / 3 * (px[3] / 255); n++;
      }
      return sum / n;
    },
  };
  resize();
  requestAnimationFrame(frame);
  return world;
}
