// Orb Calm: the signature feature. Heart rate from state (camera LIVE or simulator SIM).
import { api } from "../core/api.js";
import { cue } from "../core/sound.js";
import { createOrb } from "../interface/orb.js";
import { badgeFor, badgeHTML } from "../interface/readings.js";
import { createCalm, greenhouseCalm, pacer, updateCalm } from "./logic.js";

export function renderOrbCalm(el, ctx) {
  const s0 = ctx.view.state;
  const startHr = s0?.vitals?.heart_rate ?? 80;
  const base = s0?.baseline?.heart_rate ?? null;
  const session = createCalm(startHr, base, performance.now() / 1000);
  el.innerHTML = `
    <div class="calm-stage">
      <canvas class="calm-orb" aria-hidden="true"></canvas>
      <p class="pacer" aria-live="off">Breathe in</p>
      <div class="calm-stats">
        <span>Heart rate <strong class="num" data-hr>${Math.round(startHr)}</strong> bpm <span data-badge></span></span>
        <span>Start <strong class="num">${Math.round(startHr)}</strong></span>
        <span>Target <strong class="num">${Math.round(session.target)}</strong> or lower</span>
        <span data-hold>Hold below target for 10 s</span>
      </div>
      <p class="note" data-phase>The orb is red and turbulent at your starting heart rate. Follow the pacer: in for 4, out for 6.</p>
    </div>`;
  const orb = createOrb(el.querySelector(".calm-orb"), { small: true });
  const pacerEl = el.querySelector(".pacer");
  let raf = 0;
  let done = false;
  const t0 = performance.now() / 1000;
  const tick = () => {
    const t = performance.now() / 1000;
    const p = pacer(t - t0);
    pacerEl.textContent = p.phase === "in" ? `Breathe in… ${Math.ceil(4 - p.frac * 4)}` : `Breathe out… ${Math.ceil(6 - p.frac * 6)}`;
    raf = requestAnimationFrame(tick);
  };
  tick();
  const step = () => {
    const s = ctx.view.state;
    if (!s || done) return;
    const hr = s.vitals.heart_rate;
    const r = updateCalm(session, hr, performance.now() / 1000);
    orb.drive(r.visual);
    el.querySelector("[data-hr]").textContent = Math.round(hr);
    el.querySelector("[data-badge]").innerHTML = badgeHTML(badgeFor("vitals.heart_rate", s, ctx.view.aux));
    el.querySelector("[data-hold]").textContent = r.holdSec > 0 ? `Holding ${Math.floor(r.holdSec)} of 10 s` : "Hold below target for 10 s";
    el.querySelector("[data-phase]").textContent = { red: "Red: at or above your starting heart rate.", amber: "Amber: settling. Keep the slow out-breath.", blue: "Blue: at your target. Stay here." }[r.phase];
    if (r.cleared && !done) {
      done = true;
      cue.done();
      finish(r);
    }
  };
  const iv = setInterval(step, 500);
  step();

  async function finish(r) {
    const s = ctx.view.state;
    const eng = s.engagement;
    const id = ctx.view.crewId;
    const src = badgeFor("vitals.heart_rate", s, ctx.view.aux) === "LIVE" ? "camera" : "sim";
    try {
      await api.log(id, "session.calm_start_hr", session.startHr, src);
      await api.log(id, "session.calm_end_hr", session.endHr, src);
      await api.log(id, "session.calm_recovery_s", r.recoverySec, src);
      await ctx.patch({ engagement: { calm_levels_cleared: eng.calm_levels_cleared + 1, greenhouse_stage: greenhouseCalm(eng.greenhouse_stage) } });
    } catch { /* offline: the session still counts on screen */ }
    el.querySelector("[data-phase]").innerHTML = `Level cleared. Heart rate from ${Math.round(session.startHr)} to ${Math.round(session.endHr)} in ${r.recoverySec} s. The greenhouse grew one stage.`;
    ctx.say(`Level cleared. Your heart rate came down from ${Math.round(session.startHr)} to ${Math.round(session.endHr)}. Well done.`);
  }

  return () => { clearInterval(iv); cancelAnimationFrame(raf); orb.destroy(); };
}
