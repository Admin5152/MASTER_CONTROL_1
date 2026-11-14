// Reaction test screen: a 30-second check-in test and an optional 3-minute psychomotor vigilance test
// like the ISS Reaction Self Test (logic and sources in ./pvt.js). The median reaction time is stored in
// the state (the first three runs set the baseline, as before); lapses and false starts go to the history.
// Results produced here are LIVE. It tracks a trend; it is not a diagnosis.
import { api } from "../core/api.js";
import { emit } from "../core/bus.js";
import { badgeFor, badgeHTML, esc } from "../interface/readings.js";
import { PVT, classify, nextWait, sleepNote, summarize, versusBaseline } from "./pvt.js";

export function renderCognitive(el, ctx) {
  const st = ctx.view.state || {};
  const c = st.cognitive || {};
  let mode = "brief";
  el.innerHTML = `
    <div class="pvt-intro">
      <p>Press the pad (or the space bar) as soon as the light comes on. In the 30-second check-in, it appears at random every 1 to 4 seconds. Pressing while it is dark is a false start. Responses slower than half a second count as <strong>lapses</strong>, a fatigue marker.</p>
      <p class="fine">A psychomotor vigilance test like the ISS Reaction Self Test (NASA NTRS 20090029851), used on the station as a fatigue flag since 2009. ${esc(sleepNote(st.manual?.sleep_hours))}</p>
      <p class="note">Your baseline: ${c.baseline_ms ? `<strong class="num">${c.baseline_ms} ms</strong> ${badgeHTML(badgeFor("cognitive.baseline_ms", st, ctx.view.aux))}` : "not set yet; your first three runs set it"}.</p>
      <div class="seg" role="tablist"><button type="button" data-mode="brief" aria-selected="true">30-second check-in</button><button type="button" data-mode="full" aria-selected="false">3-minute test</button></div>
    </div>
    <button class="target-pad pvt-pad" type="button" data-pad>Tap to start</button>
    <div class="pvt-live"><span data-clock class="num">0:30</span><span data-count>0 responses</span></div>
    <div class="pvt-result" data-res aria-live="polite"></div>`;
  const pad = el.querySelector("[data-pad]"), res = el.querySelector("[data-res]");
  const clock = el.querySelector("[data-clock]"), count = el.querySelector("[data-count]");
  el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    if (running) return;
    mode = b.dataset.mode;
    el.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    clock.textContent = mode === "full" ? "3:00" : "0:30";
  }));
  let running = false, lit = false, shownAt = 0, endAt = 0, timer = null, tick = null;
  const trials = [];

  const schedule = () => {
    lit = false;
    pad.classList.remove("is-go");
    pad.textContent = "";
    timer = setTimeout(() => {
      if (!running) return;
      lit = true; shownAt = performance.now();
      pad.classList.add("is-go");
      timer = setTimeout(() => { if (lit) { trials.push({ ms: PVT.timeoutMs }); schedule(); } }, PVT.timeoutMs);
    }, nextWait(mode));
  };

  const press = () => {
    if (!running) { start(); return; }
    const now = performance.now();
    if (!lit) { trials.push({ early: true }); pad.classList.add("is-early"); setTimeout(() => pad.classList.remove("is-early"), 250); return; }
    clearTimeout(timer);
    const ms = Math.round(now - shownAt);
    trials.push({ ms });
    pad.textContent = `${ms}`;
    pad.classList.toggle("is-lapse", classify({ ms }) === "lapse");
    count.textContent = `${trials.filter((t) => !t.early).length} responses`;
    setTimeout(() => { pad.classList.remove("is-lapse"); if (running) schedule(); }, 350);
  };

  function start() {
    running = true; trials.length = 0;
    endAt = performance.now() + PVT[mode].seconds * 1000;
    res.innerHTML = "";
    el.querySelector(".pvt-intro").classList.add("is-running");
    schedule();
    tick = setInterval(() => {
      const left = Math.max(0, endAt - performance.now());
      clock.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
      if (left <= 0) finish();
    }, 200);
  }

  async function finish() {
    running = false; clearTimeout(timer); clearInterval(tick);
    pad.classList.remove("is-go"); pad.textContent = "Tap to run again";
    el.querySelector(".pvt-intro").classList.remove("is-running");
    const s = summarize(trials);
    if (!s.n) { res.innerHTML = `<p class="note">No responses recorded.</p>`; return; }
    const base = ctx.view.state?.cognitive?.baseline_ms;
    const vs = versusBaseline(s, base);
    res.innerHTML = `<div class="pvt-stats">
        <div><span class="label">Median</span><strong class="num">${s.median}</strong><small>ms</small></div>
        <div><span class="label">Mean</span><strong class="num">${s.mean}</strong><small>ms</small></div>
        <div><span class="label">Lapses</span><strong class="num">${s.lapses}</strong><small>&gt; 500 ms</small></div>
        <div><span class="label">False starts</span><strong class="num">${s.falseStarts}</strong></div>
      </div>
      <p class="note">${vs == null ? "Your first runs set your baseline." : `Median ${Math.abs(vs)}% ${vs > 0 ? "slower" : "faster"} than your baseline of ${base} ms.`} ${badgeHTML("LIVE")} This tracks a trend; it is not a diagnosis.</p>
      ${mode === "practice" ? `<p class="fine">Practice run: not saved.</p>` : ""}`;
    if (mode === "practice") return;
    try {
      const id = ctx.view.crewId;
      await api.log(id, "session.reaction_false_starts", s.falseStarts, "user");
      await api.log(id, "session.pvt_lapses", s.lapses, "user");
      await api.log(id, "session.pvt_mean_ms", s.mean, "user");
      const out = await ctx.patch({ cognitive: { reaction_ms: s.median, updated: new Date().toISOString() } });
      ctx.onCheckin?.("cognitive");
      emit("checkin.complete", { crewId: id, summary: { manual: ctx.view.state?.manual || {}, reaction_ms: s.median, lapses: s.lapses, false_starts: s.falseStarts } });
      const item = out.drift.items.find((i) => i.metric === "cognitive.reaction_ms");
      ctx.say(item ? `Reaction time is ${Math.round(item.delta_pct)} percent slower than your baseline, with ${s.lapses} lapse${s.lapses === 1 ? "" : "s"}. Worth a rest and a recheck later.`
        : `Reaction time is within your usual range, with ${s.lapses} lapse${s.lapses === 1 ? "" : "s"}.`);
    } catch (e) { res.insertAdjacentHTML("beforeend", `<p class="note">Not saved: ${esc(e.message)}</p>`); }
  }

  pad.addEventListener("pointerdown", (e) => { e.preventDefault(); press(); });
  const key = (e) => { if (e.code === "Space") { e.preventDefault(); press(); } };
  window.addEventListener("keydown", key);
  return () => { running = false; clearTimeout(timer); clearInterval(tick); window.removeEventListener("keydown", key); };
}
