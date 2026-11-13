// The orb: hand-written canvas, no libraries.
// orb.setState('idle'|'listening'|'speaking'|'warning'), orb.setSeverity('none'|'info'|'watch'|'alert'),
// orb.drive({turbulence, hue, rate}) for Orb Calm (null to release), orb.setLevel(0..1) mic volume,
// orb.look(nx, ny) turns the core toward a direction (-1..1).
const HUES = { idle: 192, calm: 214, watch: 38, alert: 356 };
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function createOrb(canvas, { small = false } = {}) {
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, dpr = 1;
  let state = "idle";
  let severity = "none";
  let driven = null;
  let level = 0;            // mic level 0..1
  let speakEnv = 0;
  let lookX = 0, lookY = 0, lookTX = 0, lookTY = 0;
  // smoothed visual params
  let hue = HUES.idle, turb = 0.06, rate = 1;
  let t = 0, last = performance.now();
  let running = true;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width * dpr));
    h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  function targets() {
    if (driven) return { hue: driven.hue, turb: driven.turbulence, rate: driven.rate ?? 1 };
    if (state === "warning" || severity === "alert") return { hue: HUES.alert, turb: 0.32, rate: 1.8 };
    if (severity === "watch") return { hue: HUES.watch, turb: 0.18, rate: 1.3 };
    if (state === "listening") return { hue: HUES.idle, turb: 0.08 + level * 0.5, rate: 1.4 };
    if (state === "speaking") return { hue: HUES.idle - 6, turb: 0.1 + speakEnv * 0.25, rate: 1.6 };
    return { hue: HUES.idle, turb: 0.06, rate: 1 };
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const slow = reduced() ? 0.25 : 1;
    t += dt * rate * slow;
    if (state === "speaking") {
      speakEnv = 0.5 + 0.5 * Math.sin(t * 9) * Math.sin(t * 3.7 + 1) ;
    } else speakEnv *= 0.9;
    const tg = targets();
    // hue: take the short way round the circle
    let dh = ((tg.hue - hue + 540) % 360) - 180;
    hue = (hue + dh * Math.min(1, dt * 2.5) + 360) % 360;
    turb += (tg.turb * (reduced() ? 0.4 : 1) - turb) * Math.min(1, dt * 3);
    rate += (tg.rate - rate) * Math.min(1, dt * 2);
    lookX += (lookTX - lookX) * Math.min(1, dt * 4);
    lookY += (lookTY - lookY) * Math.min(1, dt * 4);
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * (small ? 0.36 : 0.3);
    const breath = 1 + 0.035 * Math.sin(t * 1.3);
    // halo
    const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
    halo.addColorStop(0, `hsla(${hue}, 95%, 60%, 0.28)`);
    halo.addColorStop(0.45, `hsla(${hue}, 95%, 50%, 0.08)`);
    halo.addColorStop(1, "hsla(0,0%,0%,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    // deformed rings
    const rings = 5;
    for (let k = 0; k < rings; k++) {
      const rr = R * breath * (0.72 + k * 0.08);
      ctx.beginPath();
      const steps = 96;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const n = Math.sin(a * 3 + t * (1.1 + k * 0.3)) * 0.5 + Math.sin(a * 5 - t * (0.7 + k * 0.2) + k) * 0.35 +
                  Math.sin(a * 7 + t * 1.9 + k * 2) * 0.15;
        const r = rr * (1 + n * turb * (0.6 + k * 0.15));
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `hsla(${hue + k * 4}, 95%, ${62 + k * 4}%, ${0.5 - k * 0.07})`;
      ctx.lineWidth = (k === 0 ? 2.2 : 1.2) * dpr;
      ctx.stroke();
    }
    // core
    const ox = cx + lookX * R * 0.35, oy = cy + lookY * R * 0.25;
    const core = ctx.createRadialGradient(ox, oy, 0, cx, cy, R * 0.85 * breath);
    core.addColorStop(0, `hsla(${hue}, 100%, 88%, 0.95)`);
    core.addColorStop(0.25, `hsla(${hue}, 95%, 62%, 0.55)`);
    core.addColorStop(1, `hsla(${hue}, 90%, 40%, 0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.85 * breath, 0, Math.PI * 2);
    ctx.fill();
    // listening ripples
    if (state === "listening" && level > 0.02) {
      for (let k = 0; k < 3; k++) {
        const p = ((t * 0.8 + k / 3) % 1);
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1 + p * (0.6 + level)), 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue}, 95%, 65%, ${(1 - p) * 0.4 * Math.min(1, level * 3)})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  requestAnimationFrame(frame);

  return {
    setState(s) { state = s; },
    getState: () => state,
    setSeverity(s) { severity = s || "none"; },
    drive(p) { driven = p ? { ...p } : null; },
    setLevel(v) { level = Math.max(0, Math.min(1, v)); },
    look(nx, ny) { lookTX = nx; lookTY = ny; },
    center() {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: Math.min(r.width, r.height) * 0.3 };
    },
    destroy() { running = false; ro.disconnect(); },
  };
}

export const ORB_HUES = HUES;
