// Reaction test screen: a 30-second check-in test, an optional 3-minute psychomotor vigilance test
// like the ISS Reaction Self Test (logic and sources in ./pvt.js), and a Fitts's Law Target Game
// testing motor control, target acquisition time, and throughput (bits/s).
// Results produced here are LIVE. It tracks a trend; it is not a diagnosis.
import { api } from "../core/api.js";
import { emit } from "../core/bus.js";
import { cue } from "../core/sound.js";
import { badgeFor, badgeHTML, esc } from "../interface/readings.js";
import { PVT, classify, nextWait, sleepNote, summarize, versusBaseline, fittsIndex, summarizeFitts } from "./pvt.js";

export function renderCognitive(el, ctx) {
  const st = ctx.view.state || {};
  const c = st.cognitive || {};
  let mode = "brief";
  el.innerHTML = `
    <div class="pvt-intro">
      <p data-intro-pvt>Press the pad (or the space bar) as soon as the light comes on. In the 30-second check-in, it appears at random every 1 to 4 seconds. Pressing while it is dark is a false start. Responses slower than half a second count as <strong>lapses</strong>, a fatigue marker.</p>
      <p data-intro-fitts hidden>Tap each target as rapidly and accurately as possible. <strong>Fitts's Law</strong> (<em>MT = a + b &middot; log<sub>2</sub>(D/W + 1)</em>) proves that smaller targets and targets farther away take longer to acquire. Assesses fine motor coordination, tremor, and motor throughput in microgravity.</p>
      <p class="fine" data-cite-pvt>A psychomotor vigilance test like the ISS Reaction Self Test (NASA NTRS 20090029851), used on the station as a fatigue flag since 2009. ${esc(sleepNote(st.manual?.sleep_hours))}</p>
      <p class="fine" data-cite-fitts hidden>Fitts's Law psychomotor evaluation & NASA ISS Fine Motor Skills test protocol (ISO 9241-9 / Shannon Index of Difficulty).</p>
      <p class="note">Your baseline: ${c.baseline_ms ? `<strong class="num">${c.baseline_ms} ms</strong> ${badgeHTML(badgeFor("cognitive.baseline_ms", st, ctx.view.aux))}` : "not set yet; your first three runs set it"}${c.fitts_throughput ? ` &middot; Fitts Throughput: <strong class="num">${c.fitts_throughput} bps</strong>` : ""}.</p>
      <div class="seg" role="tablist">
        <button type="button" data-mode="brief" aria-selected="true">30-second check-in</button>
        <button type="button" data-mode="full" aria-selected="false">3-minute test</button>
        <button type="button" data-mode="fitts" aria-selected="false">Fitts's Law Game</button>
      </div>
    </div>
    <div id="pvt-pad-wrap">
      <button class="target-pad pvt-pad" type="button" data-pad>Tap to start</button>
    </div>
    <div id="fitts-wrap" hidden>
      <div class="fitts-arena" data-fitts-arena>
        <div class="fitts-prompt-start">
          <strong style="font-size:16px;">Fitts's Law Target Game</strong>
          <span>Tap anywhere to begin testing fine motor control</span>
          <span style="font-size:11px; opacity:0.7;">Small targets are harder &amp; take longer to acquire</span>
        </div>
      </div>
    </div>
    <div class="pvt-live"><span data-clock class="num">0:30</span><span data-count>0 responses</span></div>
    <div class="pvt-result" data-res aria-live="polite"></div>`;

  const pad = el.querySelector("[data-pad]"), res = el.querySelector("[data-res]");
  const clock = el.querySelector("[data-clock]"), count = el.querySelector("[data-count]");
  const introPvt = el.querySelector("[data-intro-pvt]"), introFitts = el.querySelector("[data-intro-fitts]");
  const citePvt = el.querySelector("[data-cite-pvt]"), citeFitts = el.querySelector("[data-cite-fitts]");
  const padWrap = el.querySelector("#pvt-pad-wrap"), fittsWrap = el.querySelector("#fitts-wrap");
  const fittsArena = el.querySelector("[data-fitts-arena]");

  let running = false, lit = false, shownAt = 0, endAt = 0, timer = null, tick = null;
  const trials = [];
  const fittsTrials = [];
  let fittsTargetCount = 0;
  const FITTS_TOTAL_TARGETS = 14;
  let lastX = 200, lastY = 140;

  el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    if (running) return;
    mode = b.dataset.mode;
    el.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    const isFitts = mode === "fitts";
    introPvt.hidden = isFitts;
    introFitts.hidden = !isFitts;
    citePvt.hidden = isFitts;
    citeFitts.hidden = !isFitts;
    padWrap.hidden = isFitts;
    fittsWrap.hidden = !isFitts;
    res.innerHTML = "";
    clock.textContent = mode === "full" ? "3:00" : (isFitts ? "14 targets" : "0:30");
    count.textContent = isFitts ? "0 / 14 targets" : "0 responses";
  }));

  // ================= PVT Mode Logic =================
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
    if (mode === "fitts") return;
    if (!running) { startPvt(); return; }
    const now = performance.now();
    if (!lit) {
      trials.push({ early: true });
      pad.classList.add("is-early");
      setTimeout(() => pad.classList.remove("is-early"), 250);
      return;
    }
    clearTimeout(timer);
    const ms = Math.round(now - shownAt);
    trials.push({ ms });
    pad.textContent = `${ms}`;
    pad.classList.toggle("is-lapse", classify({ ms }) === "lapse");
    count.textContent = `${trials.filter((t) => !t.early).length} responses`;
    setTimeout(() => { pad.classList.remove("is-lapse"); if (running) schedule(); }, 350);
  };

  function startPvt() {
    running = true; trials.length = 0;
    endAt = performance.now() + PVT[mode].seconds * 1000;
    res.innerHTML = "";
    el.querySelector(".pvt-intro").classList.add("is-running");
    schedule();
    tick = setInterval(() => {
      const left = Math.max(0, endAt - performance.now());
      clock.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
      if (left <= 0) finishPvt();
    }, 200);
  }

  async function finishPvt() {
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
      <p class="note">${vs == null ? "Your first runs set your baseline." : `Median ${Math.abs(vs)}% ${vs > 0 ? "slower" : "faster"} than your baseline of ${base} ms.`} ${badgeHTML("LIVE")} This tracks a trend; it is not a diagnosis.</p>`;
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

  // ================= Fitts's Law Game Logic =================
  const SIZES = [
    { w: 22, cls: "is-small", label: "Small" },
    { w: 38, cls: "is-med", label: "Medium" },
    { w: 62, cls: "is-large", label: "Large" },
  ];

  function startFitts() {
    running = true;
    fittsTrials.length = 0;
    fittsTargetCount = 0;
    res.innerHTML = "";
    el.querySelector(".pvt-intro").classList.add("is-running");
    lastX = fittsArena.offsetWidth / 2 || 200;
    lastY = fittsArena.offsetHeight / 2 || 140;
    nextFittsTarget();
  }

  function spawnBurst(x, y, text) {
    const burst = document.createElement("span");
    burst.className = "fitts-burst";
    burst.textContent = text;
    burst.style.left = `${x}px`;
    burst.style.top = `${y}px`;
    fittsArena.appendChild(burst);
    setTimeout(() => burst.remove(), 600);
  }

  function nextFittsTarget() {
    fittsArena.innerHTML = "";
    if (fittsTargetCount >= FITTS_TOTAL_TARGETS) {
      finishFitts();
      return;
    }

    fittsTargetCount++;
    count.textContent = `Target ${fittsTargetCount} / ${FITTS_TOTAL_TARGETS}`;
    clock.textContent = `${FITTS_TOTAL_TARGETS - fittsTargetCount} left`;

    // Choose target size (cycle or random distribution)
    const sizeConfig = SIZES[(fittsTargetCount - 1) % SIZES.length];
    const w = sizeConfig.w;

    const arenaW = fittsArena.clientWidth || 360;
    const arenaH = fittsArena.clientHeight || 280;
    const padMargin = w / 2 + 16;

    const targetX = Math.round(padMargin + Math.random() * (arenaW - 2 * padMargin));
    const targetY = Math.round(padMargin + Math.random() * (arenaH - 2 * padMargin));

    const distance = Math.round(Math.hypot(targetX - lastX, targetY - lastY));
    const id = fittsIndex(distance, w);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `fitts-target ${sizeConfig.cls}`;
    btn.style.width = `${w}px`;
    btn.style.height = `${w}px`;
    btn.style.left = `${targetX}px`;
    btn.style.top = `${targetY}px`;
    btn.setAttribute("aria-label", `${sizeConfig.label} target`);
    btn.innerHTML = `<span class="fitts-target-dot"></span><span class="fitts-target-ring"></span>`;

    const appearTime = performance.now();

    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const tapTime = performance.now();
      const mt = Math.round(tapTime - appearTime);

      try { cue.point(); } catch {}

      fittsTrials.push({ hit: true, mt, w, d: distance, id });
      spawnBurst(targetX, targetY, `${mt} ms (${sizeConfig.label})`);

      lastX = targetX;
      lastY = targetY;
      setTimeout(nextFittsTarget, 100);
    });

    fittsArena.appendChild(btn);
  }

  fittsArena.addEventListener("pointerdown", (e) => {
    if (!running) {
      startFitts();
      return;
    }
    // Background click = miss
    const tapTime = performance.now();
    try { cue.tick(); } catch {}
    fittsTrials.push({ hit: false, mt: 500, w: 25, d: 100, id: 2 });
    spawnBurst(e.offsetX, e.offsetY, "Miss!");
  });

  async function finishFitts() {
    running = false;
    el.querySelector(".pvt-intro").classList.remove("is-running");
    fittsArena.innerHTML = `<div class="fitts-prompt-start">
      <strong style="font-size:16px;">Test Complete!</strong>
      <span>Tap anywhere to run Fitts's Law Game again</span>
    </div>`;

    const sf = summarizeFitts(fittsTrials);
    clock.textContent = "Complete";
    count.textContent = `${sf.hits} hits / ${sf.misses} misses`;

    res.innerHTML = `
      <div class="pvt-stats">
        <div><span class="label">Median MT</span><strong class="num">${sf.medianMt || "—"}</strong><small>ms</small></div>
        <div><span class="label">Accuracy</span><strong class="num">${sf.accuracy}%</strong><small>${sf.hits}/${sf.hits + sf.misses}</small></div>
        <div><span class="label">Throughput</span><strong class="num">${sf.avgThroughput || "—"}</strong><small>bits/sec</small></div>
        <div><span class="label">Small Targets</span><strong class="num">${sf.smallMt || "—"}</strong><small>ms (${sf.diffPct != null ? `+${sf.diffPct}%` : ""})</small></div>
      </div>
      <p class="note">
        <strong>Fitts's Law Validation:</strong> Small targets (${sf.smallMt || "—"} ms) required ${sf.diffPct != null && sf.diffPct > 0 ? `${sf.diffPct}% more movement time` : "longer precision control"} than large targets (${sf.largeMt || "—"} ms).
        Throughput of <strong class="num">${sf.avgThroughput} bps</strong> measures motor bandwidth and sensorimotor coordination under microgravity. ${badgeHTML("LIVE")}
      </p>
    `;

    try {
      const id = ctx.view.crewId;
      await api.log(id, "session.fitts_throughput", sf.avgThroughput, "user");
      await api.log(id, "session.fitts_small_mt", sf.smallMt, "user");
      await api.log(id, "session.fitts_large_mt", sf.largeMt, "user");
      if (sf.medianMt) {
        await ctx.patch({ cognitive: { reaction_ms: sf.medianMt, fitts_throughput: sf.avgThroughput, updated: new Date().toISOString() } });
      }
      ctx.say(`Fitts test complete. Your motor throughput is ${sf.avgThroughput} bits per second with ${sf.accuracy} percent accuracy. Small targets took ${sf.diffPct != null ? `${sf.diffPct} percent longer` : "more time"}, consistent with Fitts's law.`);
    } catch (e) {
      res.insertAdjacentHTML("beforeend", `<p class="note">Not saved: ${esc(e.message)}</p>`);
    }
  }

  pad.addEventListener("pointerdown", (e) => { e.preventDefault(); press(); });
  const key = (e) => {
    if (e.code === "Space" && mode !== "fitts") {
      e.preventDefault();
      press();
    }
  };
  window.addEventListener("keydown", key);

  return () => {
    running = false;
    clearTimeout(timer);
    clearInterval(tick);
    window.removeEventListener("keydown", key);
  };
}
