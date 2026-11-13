// Aurora Run: calm, no-fail flight game. Steer by tilt, finger drag or arrow keys.
// Hold a finger (or space) while breathing in, lift while breathing out.
import { api } from "../core/api.js";
import { badgeFor } from "../interface/readings.js";
import { moodChange, pacer, pathWidth } from "./logic.js";

const SESSION_SEC = 120;
const MAX_PARTICLES = 160;

export function renderAurora(el, ctx) {
  let moodBefore = null;
  el.innerHTML = `
    <div data-step="before">
      <h3>Before you start: how is your mood?</h3>
      <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-mb="${n}">${n}</button>`).join("")}</div>
      <p class="note">1 low, 5 good. Mood is LIVE (you enter it); it is stored so the crew can see whether the game helped.</p>
    </div>`;
  el.querySelectorAll("[data-mb]").forEach((b) => b.addEventListener("click", () => { moodBefore = Number(b.dataset.mb); play(); }));
  let cleanup = () => {};

  function play() {
    const startHr = ctx.view.state?.vitals?.heart_rate ?? null;
    const hrBadge = badgeFor("vitals.heart_rate", ctx.view.state, ctx.view.aux);
    el.innerHTML = `
      <div class="game-wrap"><canvas class="game-canvas" aria-label="Aurora Run game"></canvas></div>
      <div class="row" style="display:flex;gap:var(--s-2);align-items:center;margin-top:var(--s-2);flex-wrap:wrap">
        <button class="btn" type="button" data-tilt>Use tilt</button>
        <span class="note" data-info>Drag to steer. Hold anywhere on the right half while breathing in; lift to breathe out. Space bar works too.</span>
      </div>`;
    const canvas = el.querySelector("canvas");
    const g = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.width = Math.max(1, r.width * dpr); H = canvas.height = Math.max(1, r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    // state, all preallocated
    let x = 0.5, targetX = 0.5, holding = false, keyL = false, keyR = false, tiltX = null;
    let syncOk = 0, syncTotal = 0; // counters, no per-frame allocation
    let dim = 0, trail = 0.5, sync = 0.5;
    const px = new Float32Array(MAX_PARTICLES), py = new Float32Array(MAX_PARTICLES), pv = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) { px[i] = Math.random(); py[i] = Math.random(); pv[i] = 0.2 + Math.random() * 0.8; }
    const t0 = performance.now() / 1000;
    let last = t0, raf = 0, ended = false, pathPhase = 0;

    const onDown = (e) => {
      const r = canvas.getBoundingClientRect();
      if ((e.clientX - r.left) / r.width > 0.5) holding = true;
      else targetX = (e.clientX - r.left) / r.width;
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      if (fx <= 0.5 || !holding) targetX = Math.max(0.05, Math.min(0.95, fx));
    };
    const onUp = () => { holding = false; };
    const onKey = (e) => {
      if (e.code === "Space") { holding = e.type === "keydown"; e.preventDefault(); }
      if (e.key === "ArrowLeft") keyL = e.type === "keydown";
      if (e.key === "ArrowRight") keyR = e.type === "keydown";
    };
    const onTilt = (e) => { if (e.gamma != null) tiltX = Math.max(-30, Math.min(30, e.gamma)) / 30; };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    el.querySelector("[data-tilt]").addEventListener("click", async () => {
      try {
        if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
          const p = await DeviceOrientationEvent.requestPermission();
          if (p !== "granted") throw new Error("denied");
        }
        window.addEventListener("deviceorientation", onTilt);
        el.querySelector("[data-info]").textContent = "Tilt to steer (drag still works). Hold the right half while breathing in.";
      } catch {
        el.querySelector("[data-info]").textContent = "Tilt is not available here; drag to steer.";
      }
    });

    function frame(nowMs) {
      if (ended) return;
      const now = nowMs / 1000;
      const dt = Math.min(0.05, now - last); last = now;
      const t = now - t0;
      const p = pacer(t);
      syncTotal++; if ((p.phase === "in") === holding) syncOk++;
      sync += (((p.phase === "in") === holding ? 1 : 0) - sync) * dt * 0.8;
      const hr = ctx.view.state?.vitals?.heart_rate, base = ctx.view.state?.baseline?.heart_rate;
      const half = pathWidth(sync, hr, base) / 2; // pathWidth is the full path width as a fraction of the screen
      if (tiltX != null) targetX = 0.5 + tiltX * 0.45;
      if (keyL) targetX -= dt * 0.6;
      if (keyR) targetX += dt * 0.6;
      targetX = Math.max(0.05, Math.min(0.95, targetX));
      x += (targetX - x) * Math.min(1, dt * 4);
      pathPhase += dt * (reduced ? 0.15 : 0.5);
      const centre = 0.5 + 0.28 * Math.sin(pathPhase) * Math.cos(pathPhase * 0.37);
      const off = Math.abs(x - centre) > half;
      dim = off ? Math.min(1, dim + dt * 3) : Math.max(0, dim - dt * 1.5);
      trail += ((off ? 0.25 : 0.4 + sync * 0.6) - trail) * dt;
      draw(t, centre, half, p);
      if (t >= SESSION_SEC) { end(hr); return; }
      raf = requestAnimationFrame(frame);
    }

    function draw(t, centre, half, p) {
      g.fillStyle = "#04070d";
      g.fillRect(0, 0, W, H);
      const bright = 0.35 + sync * 0.65;
      // aurora ribbons: path edges
      for (let k = -1; k <= 1; k += 2) {
        g.beginPath();
        for (let i = 0; i <= 40; i++) {
          const yy = (i / 40) * H;
          const ph = pathPhase - (1 - i / 40) * 0.8;
          const c = 0.5 + 0.28 * Math.sin(ph) * Math.cos(ph * 0.37);
          const xx = (c + k * half) * W + Math.sin(t * 1.3 + i * 0.4) * 6 * dpr;
          if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
        }
        g.strokeStyle = `hsla(${150 + k * 20}, 90%, 60%, ${0.25 + bright * 0.6})`;
        g.lineWidth = (6 + bright * 10) * dpr;
        g.shadowBlur = 24 * dpr; g.shadowColor = `hsla(160, 90%, 60%, ${bright})`;
        g.stroke();
      }
      g.shadowBlur = 0;
      // stars
      g.fillStyle = "rgba(200,230,255,0.7)";
      for (let i = 0; i < MAX_PARTICLES; i++) {
        py[i] += pv[i] * 0.004 * (reduced ? 0.3 : 1);
        if (py[i] > 1) { py[i] = 0; px[i] = Math.random(); }
        g.fillRect(px[i] * W, py[i] * H, 1.5 * dpr, 1.5 * dpr * (1 + pv[i] * 2));
      }
      // craft + trail
      const cx = x * W, cy = H * 0.78;
      g.fillStyle = `hsla(190, 100%, 70%, ${trail * (1 - dim * 0.7)})`;
      g.fillRect(cx - 2 * dpr, cy, 4 * dpr, H * 0.2 * trail);
      g.beginPath(); g.moveTo(cx, cy - 16 * dpr); g.lineTo(cx - 10 * dpr, cy + 10 * dpr); g.lineTo(cx + 10 * dpr, cy + 10 * dpr); g.closePath();
      g.fillStyle = `hsla(190, 100%, ${85 - dim * 40}%, 1)`; g.fill();
      // pacer bar
      const by = H - 18 * dpr;
      g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(W * 0.1, by, W * 0.8, 6 * dpr);
      g.fillStyle = p.phase === "in" ? "#39d5ff" : "#4f8dff";
      const prog = p.phase === "in" ? p.frac : 1 - p.frac;
      g.fillRect(W * 0.1, by, W * 0.8 * prog, 6 * dpr);
      g.fillStyle = "#e4eef6"; g.font = `${16 * dpr}px sans-serif`;
      g.fillText(p.phase === "in" ? "breathe in (hold)" : "breathe out (lift)", W * 0.1, by - 8 * dpr);
      g.fillText(`${Math.max(0, Math.ceil(SESSION_SEC - t))} s`, W * 0.84, by - 8 * dpr);
    }

    async function end(endHr) {
      ended = true;
      cleanupInput();
      const ratio = syncTotal ? syncOk / syncTotal : 0;
      el.innerHTML = `<h3>Session complete</h3>
        <p>You breathed in time with the pacer ${Math.round(ratio * 100)}% of the session. Heart rate ${startHr != null ? `from ${Math.round(startHr)} to ${Math.round(endHr)} bpm` : "not available"} ${hrBadge === "LIVE" ? '<span class="badge badge-live">LIVE</span>' : '<span class="badge badge-sim">SIM</span>'}.</p>
        <h3>How is your mood now?</h3>
        <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-ma="${n}">${n}</button>`).join("")}</div>
        <p class="note" data-res></p>`;
      el.querySelectorAll("[data-ma]").forEach((b) => b.addEventListener("click", async () => {
        const after = Number(b.dataset.ma);
        const change = moodChange(moodBefore, after);
        await saveSession(after, change, endHr);
        el.querySelector("[data-res]").textContent = `Mood ${moodBefore} before, ${after} after (${change >= 0 ? "+" : ""}${change}). Saved to the wellbeing chart.`;
      }));
    }

    async function saveSession(after, change, endHr) {
      const id = ctx.view.crewId;
      try {
        await ctx.patch({ wellbeing: { mood_before: moodBefore, mood_after: after, last_game: "aurora_run", updated: new Date().toISOString() } });
        await api.log(id, "session.aurora_mood_before", moodBefore, "user");
        await api.log(id, "session.aurora_mood_after", after, "user");
        await api.log(id, "session.aurora_mood_change", change, "user");
        if (startHr != null) {
          const src = hrBadge === "LIVE" ? "camera" : "sim";
          await api.log(id, "session.aurora_start_hr", startHr, src);
          await api.log(id, "session.aurora_end_hr", endHr ?? startHr, src);
        }
      } catch { /* offline */ }
    }

    function cleanupInput() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("deviceorientation", onTilt);
    }
    raf = requestAnimationFrame(frame);
    cleanup = () => { ended = true; cleanupInput(); };
    ctx.view.aurora = { endNow: () => end(ctx.view.state?.vitals?.heart_rate) };
  }
  return () => cleanup();
}

/** Wellbeing chart: mood before/after per Aurora session. */
export async function renderWellbeing(host, crewId) {
  const [b, a] = await Promise.all([api.history(crewId, "session.aurora_mood_before"), api.history(crewId, "session.aurora_mood_after")]).catch(() => [{ points: [] }, { points: [] }]);
  const n = Math.min(b.points.length, a.points.length);
  if (!n) { host.innerHTML = `<p class="note">No Aurora Run sessions yet. Mood change per session appears here.</p>`; return () => {}; }
  host.innerHTML = `<div class="chart-box"><canvas role="img" aria-label="Mood before and after each session"></canvas></div>`;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const chart = new window.Chart(host.querySelector("canvas"), {
    type: "bar",
    data: { labels: Array.from({ length: n }, (_, i) => `Session ${i + 1}`),
      datasets: [{ label: "Before", data: b.points.slice(-n).map((p) => p.v), backgroundColor: css("--ink-faint") },
        { label: "After", data: a.points.slice(-n).map((p) => p.v), backgroundColor: css("--line") }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 5, ticks: { color: css("--ink-dim") }, grid: { color: css("--rule") } }, x: { ticks: { color: css("--ink-dim") }, grid: { display: false } } },
      plugins: { legend: { labels: { color: css("--ink-dim") } } } },
  });
  return () => chart.destroy();
}
