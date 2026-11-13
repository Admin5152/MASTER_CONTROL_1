// Cognitive check: 25-second reaction game. Tap or press space when the pad turns green.
// Median reaction time is stored; the first three runs set the baseline; false starts are excluded.
import { api } from "../core/api.js";
import { medianReaction } from "../experience/logic.js";

const DURATION = 25000;

export function renderCognitive(el, ctx) {
  const c = ctx.view.state?.cognitive || {};
  el.innerHTML = `
    <p>Tap the pad (or press the space bar) as soon as it turns green. 25 seconds. Tapping before it turns green counts as a false start and is left out.</p>
    <p class="note">Your baseline: ${c.baseline_ms ? `<strong class="num">${c.baseline_ms} ms</strong>` : "not set yet; your first three runs set it"}. Last run: ${c.reaction_ms ? `${c.reaction_ms} ms` : "none"}.</p>
    <button class="target-pad" type="button" data-pad>Tap to start</button>
    <p class="note" data-res aria-live="polite"></p>`;
  const pad = el.querySelector("[data-pad]");
  const res = el.querySelector("[data-res]");
  let running = false, armed = false, shownAt = 0, endAt = 0, timer = null;
  const trials = [];

  const schedule = () => {
    armed = false;
    pad.classList.remove("is-go");
    pad.textContent = "Wait for green…";
    timer = setTimeout(() => {
      if (!running) return;
      if (performance.now() > endAt) return finish();
      armed = true; shownAt = performance.now();
      pad.classList.add("is-go"); pad.textContent = "Tap!";
    }, 900 + Math.random() * 2200);
  };

  const press = () => {
    if (!running) { start(); return; }
    const now = performance.now();
    if (!armed) { trials.push({ falseStart: true }); res.textContent = `False start (${trials.filter((t) => t.falseStart).length}), not counted.`; clearTimeout(timer); schedule(); return; }
    trials.push({ ms: Math.round(now - shownAt) });
    res.textContent = `${Math.round(now - shownAt)} ms`;
    if (now > endAt) finish(); else schedule();
  };

  function start() {
    running = true; trials.length = 0; endAt = performance.now() + DURATION;
    res.textContent = "";
    schedule();
  }

  async function finish() {
    running = false; clearTimeout(timer);
    pad.classList.remove("is-go");
    const med = medianReaction(trials);
    const falseStarts = trials.filter((t) => t.falseStart).length;
    if (med == null) { pad.textContent = "Tap to try again"; res.textContent = "No valid taps recorded."; return; }
    pad.textContent = "Tap to run again";
    try {
      await api.log(ctx.view.crewId, "session.reaction_false_starts", falseStarts, "user");
      const s = await ctx.patch({ cognitive: { reaction_ms: med, updated: new Date().toISOString() } });
      ctx.onCheckin?.("cognitive");
      const item = s.drift.items.find((i) => i.metric === "cognitive.reaction_ms");
      const base = s.cognitive.baseline_ms;
      let msg = `Median ${med} ms from ${trials.length - falseStarts} taps; ${falseStarts} false start${falseStarts === 1 ? "" : "s"} excluded.`;
      if (item) msg += ` Reaction time ${Math.abs(Math.round(item.delta_pct))}% ${item.delta_pct > 0 ? "slower" : "faster"} than your baseline of ${base} ms.`;
      else if (base) msg += ` Within your usual range (baseline ${base} ms).`;
      res.textContent = msg + " This tracks a trend; it is not a diagnosis.";
      ctx.say(item ? `Reaction time is ${Math.round(item.delta_pct)} percent slower than your baseline. Worth a rest and a recheck later.` : "Reaction time is within your usual range.");
    } catch (e) { res.textContent = `Not saved: ${e.message}`; }
  }

  pad.addEventListener("pointerdown", (e) => { e.preventDefault(); press(); });
  const key = (e) => { if (e.code === "Space") { e.preventDefault(); press(); } };
  window.addEventListener("keydown", key);
  return () => { running = false; clearTimeout(timer); window.removeEventListener("keydown", key); };
}
