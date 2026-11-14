// Orb Calm: the signature feature. Pick a researched breathing pattern and a length, follow the orb as it
// fills and empties with your breath, and watch your heart rate (camera LIVE or simulator SIM) come down.
// Feedback on every channel: the orb's size and colour, a rising and falling tone, and a short vibration
// at each turn of the breath (tablets and phones). Mood before and after is logged with the heart rate.
import { api } from "../core/api.js";
import { audioContext, cue, isMuted } from "../core/sound.js";
import { badgeFor, badgeHTML } from "../interface/readings.js";
import { CALM_HOLD_SEC, PATTERNS, PHASE_WORD, breathAt, calmSummary, createCalm, greenhouseCalm, updateCalm } from "./logic.js";
import { moodRow, scienceDrawer } from "./science.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PREF = "sentinel.calm.pref";
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
function loadPref() { try { return JSON.parse(localStorage.getItem(PREF) || "{}"); } catch { return {}; } }
function savePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* private mode */ } }

/** A soft tone that rises with the in-breath and falls with the out-breath. */
function breathTone() {
  const c = audioContext();
  if (!c || isMuted()) return { set() {}, stop() {} };
  const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
  o.type = "sine"; o2.type = "triangle"; lp.type = "lowpass"; lp.frequency.value = 700;
  g.gain.value = 0;
  o.connect(lp); o2.connect(lp); lp.connect(g).connect(c.destination);
  o.start(); o2.start();
  return {
    set(volume, phase) {
      const t = c.currentTime, f = 174.6 * Math.pow(2, volume * 7 / 12);   // F3 rising a fifth as the lungs fill
      o.frequency.setTargetAtTime(f, t, 0.12); o2.frequency.setTargetAtTime(f * 1.5, t, 0.12);
      const level = phase === "hold" || phase === "rest" ? 0.012 : 0.03 + volume * 0.02;
      g.gain.setTargetAtTime(level, t, 0.25);
    },
    stop() { const t = c.currentTime; g.gain.setTargetAtTime(0, t, 0.3); setTimeout(() => { try { o.stop(); o2.stop(); } catch {} }, 1500); },
  };
}

function spark(samples, target, w = 280, h = 64) {
  const v = samples.filter((s) => Number.isFinite(s.hr));
  if (v.length < 2) return "";
  const t0 = v[0].t, t1 = v[v.length - 1].t || t0 + 1;
  const lo = Math.min(target, ...v.map((s) => s.hr)) - 3, hi = Math.max(...v.map((s) => s.hr)) + 3;
  const X = (t) => ((t - t0) / Math.max(1, t1 - t0)) * w, Y = (hr) => h - ((hr - lo) / Math.max(1, hi - lo)) * h;
  const pts = v.map((s) => `${X(s.t).toFixed(1)},${Y(s.hr).toFixed(1)}`).join(" ");
  return `<svg class="calm-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Heart rate during the session">
    <line x1="0" x2="${w}" y1="${Y(target).toFixed(1)}" y2="${Y(target).toFixed(1)}" class="calm-spark-target"/>
    <polyline points="${pts}" class="calm-spark-line"/></svg>`;
}

export function renderOrbCalm(el, ctx) {
  const pref = { pattern: "sigh", minutes: 3, sound: true, ...loadPref() };
  let alive = true, cleanupRun = () => {};
  el.innerHTML = `<div class="calm2" data-root></div>`;
  const root = el.querySelector("[data-root]");
  const drawer = scienceDrawer(root, "orb_calm", "Why Stillpoint works");

  function setup() {
    root.innerHTML = `<section class="calm-setup">
      <p class="label">Stillpoint</p>
      <h1 class="calm-h">Breathe with the orb</h1>
      <p class="calm-lede">Choose a pattern. The orb fills as you breathe in and empties as you breathe out, and settles from red to blue as your heart rate comes down.</p>
      <div class="calm-patterns">${Object.entries(PATTERNS).map(([k, p]) => `<button type="button" class="calm-pat" data-pat="${k}" aria-pressed="${k === pref.pattern}">
        <span class="calm-pat-top"><strong>${esc(p.name)}</strong><span class="num">${p.bpm} / min</span></span>
        <span class="calm-pat-steps">${p.steps.map(([ph, s]) => `<i style="flex:${s}" class="ph-${ph}">${s % 1 ? s.toFixed(1) : s}</i>`).join("")}</span>
        <small>${esc(p.blurb)}</small></button>`).join("")}</div>
      <div class="calm-row"><span class="label">Length</span><div class="seg">${[1, 3, 5].map((m) => `<button type="button" data-min="${m}" aria-pressed="${m === pref.minutes}">${m} min</button>`).join("")}</div>
        <label class="calm-sound"><input type="checkbox" data-sound ${pref.sound ? "checked" : ""}> Sound guide</label></div>
      <p class="calm-q">How is your mood right now?</p>
      ${moodRow("data-mb")}
      <div class="calm-actions"><button type="button" class="link-btn" data-why>Why it works</button><button type="button" class="link-btn" data-skip>Start without a mood</button></div>
    </section>`;
    root.querySelectorAll("[data-pat]").forEach((b) => b.addEventListener("click", () => {
      pref.pattern = b.dataset.pat; savePref(pref);
      root.querySelectorAll("[data-pat]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    root.querySelectorAll("[data-min]").forEach((b) => b.addEventListener("click", () => {
      pref.minutes = Number(b.dataset.min); savePref(pref);
      root.querySelectorAll("[data-min]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    root.querySelector("[data-sound]").addEventListener("change", (e) => { pref.sound = e.target.checked; savePref(pref); });
    root.querySelector("[data-why]").addEventListener("click", () => drawer.open());
    root.querySelectorAll("[data-mb]").forEach((b) => b.addEventListener("click", () => run(Number(b.dataset.mb))));
    root.querySelector("[data-skip]").addEventListener("click", () => run(null));
    root.appendChild(drawer.el);
  }

  function run(moodBefore) {
    const pattern = PATTERNS[pref.pattern] || PATTERNS.sigh;
    const total = pref.minutes * 60;
    const s0 = ctx.view.state;
    const startHr = s0?.vitals?.heart_rate ?? 80;
    const base = s0?.baseline?.heart_rate ?? null;
    const session = createCalm(startHr, base, performance.now() / 1000);
    const samples = [{ t: 0, hr: startHr }];
    root.innerHTML = `<section class="calm-run">
      <div class="calm-field">
        <svg class="calm-ring" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="94" class="calm-ring-bg"/>
          <circle cx="100" cy="100" r="94" class="calm-ring-fg" data-prog pathLength="1"/>
        </svg>
        <div class="calm-halo" data-halo></div>
      </div>
      <p class="pacer" data-word aria-live="off">Breathe in</p>
      <p class="pacer-count num" data-count></p>
      <div class="calm-stats">
        <span>Heart rate <strong class="num" data-hr>${Math.round(startHr)}</strong> bpm <span data-badge></span></span>
        <span>Target <strong class="num">${Math.round(session.target)}</strong> or lower</span>
        <span data-hold>Hold under target for ${CALM_HOLD_SEC} s to clear the level</span>
      </div>
      <div class="calm-live" data-spark></div>
      <div class="calm-actions"><span class="note" data-left></span><button type="button" class="link-btn" data-end>End now</button></div>
    </section>`;
    root.appendChild(drawer.el);
    const $ = (s) => root.querySelector(s);
    // the session uses Sentinel's own orb, centred, with nothing else on screen
    const orb = ctx.orb;
    root.classList.add("is-run");
    ctx.stages?.setOrbMode("calm", 0.9);
    let visual = { turbulence: 0.4, hue: 356, rate: 1 };
    const tone = pref.sound ? breathTone() : { set() {}, stop() {} };
    const t0 = performance.now() / 1000;
    let raf = 0, lastPhase = "", cleared = false, ended = false;
    const frame = () => {
      if (!alive || ended) return;
      const el_t = performance.now() / 1000 - t0;
      const b = breathAt(pattern, el_t);
      if (b.phase !== lastPhase) {
        lastPhase = b.phase;
        $("[data-word]").textContent = PHASE_WORD[b.phase];
        navigator.vibrate?.(b.phase === "in" ? 28 : b.phase === "out" ? [14, 60, 14] : 8);
      }
      $("[data-count]").textContent = Math.ceil(b.left);
      const k = reduced() ? 0.5 : b.volume;
      orb?.drive({ ...visual, breath: k });
      const op = ctx.world?.orbPlace;          // keep the progress ring centred on the orb
      if (op) { const d = op.size * 1.55, fld = $(".calm-field"); fld.style.width = fld.style.height = `${d}px`; fld.style.transform = `translate(${op.x - d / 2}px, ${op.y - d / 2}px)`; }
      $("[data-halo]").style.transform = `scale(${(0.7 + 0.6 * k).toFixed(3)})`;
      $("[data-halo]").style.opacity = (0.25 + 0.55 * k).toFixed(3);
      $("[data-prog]").style.strokeDashoffset = (1 - Math.min(1, el_t / total)).toFixed(4);
      const left = Math.max(0, total - el_t);
      $("[data-left]").textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")} left`;
      tone.set(b.volume, b.phase);
      if (el_t >= total) return finish();
      raf = requestAnimationFrame(frame);
    };
    frame();
    const step = () => {
      const s = ctx.view.state;
      if (!s || ended) return;
      const hr = s.vitals.heart_rate;
      const t = performance.now() / 1000;
      samples.push({ t: t - t0, hr });
      const r = updateCalm(session, hr, t);
      visual = r.visual;
      $("[data-hr]").textContent = Math.round(hr);
      $("[data-badge]").innerHTML = badgeHTML(badgeFor("vitals.heart_rate", s, ctx.view.aux));
      $("[data-hold]").textContent = cleared ? "Level cleared. Keep going to the end." : r.holdSec > 0 ? `Under target: ${Math.floor(r.holdSec)} of ${CALM_HOLD_SEC} s` : `Hold under target for ${CALM_HOLD_SEC} s to clear the level`;
      root.querySelector(".calm-field").dataset.phase = r.phase;
      $("[data-spark]").innerHTML = spark(samples, session.target);
      if (r.cleared && !cleared) {
        cleared = true;
        cue.done();
        navigator.vibrate?.([20, 50, 20, 50, 40]);
        const eng = s.engagement;
        ctx.patch({ engagement: { calm_levels_cleared: eng.calm_levels_cleared + 1, greenhouse_stage: greenhouseCalm(eng.greenhouse_stage) } }).catch(() => {});
      }
    };
    const iv = setInterval(step, 1000);
    step();
    $("[data-end]").addEventListener("click", () => finish());
    cleanupRun = () => { ended = true; clearInterval(iv); cancelAnimationFrame(raf); tone.stop(); orb?.drive(null); ctx.stages?.setOrbMode("off", 0.5); root.classList.remove("is-run"); };

    async function finish() {
      if (ended) return;
      const minutes = (performance.now() / 1000 - t0) / 60;
      cleanupRun();
      cleanupRun = () => {};
      const sum = calmSummary(samples, session.target);
      const s = ctx.view.state;
      const src = s && badgeFor("vitals.heart_rate", s, ctx.view.aux) === "LIVE" ? "camera" : "sim";
      root.innerHTML = `<section class="calm-end">
        <p class="label">Session complete · ${esc(pattern.name)}</p>
        <h1 class="calm-h">${sum.drop != null && sum.drop >= 1 ? `Heart rate down ${Math.round(sum.drop)} bpm` : "Session complete"}</h1>
        <div class="calm-end-stats">
          <div><span class="label">Start</span><strong class="num">${Math.round(sum.start ?? startHr)}</strong><small>bpm</small></div>
          <div><span class="label">End</span><strong class="num">${Math.round(sum.end ?? startHr)}</strong><small>bpm</small></div>
          <div><span class="label">Lowest</span><strong class="num">${Math.round(sum.min ?? startHr)}</strong><small>bpm</small></div>
          <div><span class="label">Under target</span><strong class="num">${sum.inTargetS}</strong><small>s</small></div>
        </div>
        ${spark(samples, session.target, 520, 110)}
        <p class="note">Heart rate ${badgeHTML(src === "camera" ? "LIVE" : "SIM")} ${src === "camera" ? "from the camera pulse." : "from the simulator: the drop shows how the session works, not your body."} ${cleared ? "Level cleared: the greenhouse earned an overdrive credit." : ""}</p>
        <p class="calm-q">How is your mood now?</p>
        ${moodRow("data-ma")}
        <p class="note" data-res></p>
        <div class="calm-actions"><button type="button" class="link-btn" data-why>Why it works</button><button type="button" class="pill pill-light" data-again>Breathe again</button></div>
      </section>`;
      root.appendChild(drawer.el);
      root.querySelector("[data-why]").addEventListener("click", () => drawer.open());
      root.querySelector("[data-again]").addEventListener("click", () => setup());
      const id = ctx.view.crewId;
      api.log(id, "session.calm_start_hr", session.startHr, src).catch(() => {});
      api.log(id, "session.calm_end_hr", sum.end ?? session.endHr, src).catch(() => {});
      api.log(id, "session.calm_minutes", Math.round(minutes * 10) / 10, "user").catch(() => {});
      if (session.recoverySec != null) api.log(id, "session.calm_recovery_s", session.recoverySec, src).catch(() => {});
      ctx.say?.(sum.drop != null && sum.drop >= 1 ? `Nicely done. Your heart rate came down ${Math.round(sum.drop)} beats a minute.` : "Session complete. Well done for taking the time.");
      root.querySelectorAll("[data-ma]").forEach((b) => b.addEventListener("click", async () => {
        const after = Number(b.dataset.ma);
        root.querySelectorAll("[data-ma]").forEach((x) => { x.disabled = true; x.setAttribute("aria-pressed", String(x === b)); });
        const change = moodBefore != null ? after - moodBefore : null;
        root.querySelector("[data-res]").textContent = change != null ? `Mood ${moodBefore} before, ${after} after (${change >= 0 ? "+" : ""}${change}). Saved.` : `Mood ${after}. Saved.`;
        try {
          await api.log(id, "session.calm_mood_after", after, "user");
          if (moodBefore != null) { await api.log(id, "session.calm_mood_before", moodBefore, "user"); await api.log(id, "session.calm_mood_change", change, "user"); }
          await ctx.patch({ wellbeing: { mood_before: moodBefore, mood_after: after, last_game: "orb_calm", updated: new Date().toISOString() } });
        } catch { root.querySelector("[data-res]").textContent += " (could not reach the brain; not saved)"; }
      }));
    }
  }

  setup();
  return () => { alive = false; cleanupRun(); };
}
