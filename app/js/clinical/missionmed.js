// Mission medicine screens grounded in how NASA monitors crews (design/NASA_MONITORING_RESEARCH.md):
//   exam      guided Periodic-Health-Status-style exam, step by step by voice and screen, ending in a
//             one-page ground packet (NASA-STD-3001 in-mission preventive care; CHP-IDSP PHS scenarios)
//   ground    store-and-forward queue to ground with the one-way delay (SIM transport; EIMO ConOps)
//   measures  weekly checklist inspired by NASA Spaceflight Standard Measures (NTRS 20180002943)
//   wellbeing the wellbeing hub: mood after breaks, the reaction test, games, the greenhouse
//   organ     an organ detail view: the real anatomy, lit, isolated, with its readings and care strategy
// Sentinel never claims compliance with NASA standards: these are "designed around" and "inspired by".
import { api } from "../core/api.js";
import { emit } from "../core/bus.js";
import { badgeFor, badgeHTML, esc, fmt, statusWord, zoneReadings, ZONE_NAMES } from "../interface/readings.js";
import { gradientCss, rangeBar } from "../interface/ranges.js";

const SRC = {
  phs: { t: "NASA-STD-3001: health and medical care (periodic health status)", u: "https://nasa.gov/reference/3-0-health-and-medical-care" },
  eimo: { t: "NASA EIMO Concept of Operations (NTRS 20240001402)", u: "https://ntrs.nasa.gov/citations/20240001402" },
  ssm: { t: "NASA Spaceflight Standard Measures (NTRS 20180002943)", u: "https://ntrs.nasa.gov/api/citations/20180002943/downloads/20180002943.pdf" },
  rst: { t: "ISS Reaction Self Test (NTRS 20090029851)", u: "https://ntrs.nasa.gov/citations/20090029851" },
  sleep: { t: "Sleep and performance in 24 ISS astronauts (PMC8919197)", u: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8919197" },
};
const cite = (k) => `<a class="src-link" href="${SRC[k].u}" target="_blank" rel="noopener">${esc(SRC[k].t)}</a>`;
const BAR_COL = { ok: "#7fe0a6", info: "#ffc35c", watch: "#ffc35c", alert: "#ff5468" };

export function registerMissionMed(registerScreen) {
  registerScreen("exam", { title: "Guided health exam", badge: "LIVE", render: renderExam });
  registerScreen("ground", { title: "Messages to ground", badge: "SIM", render: renderGround });
  registerScreen("measures", { title: "Weekly standard measures", render: renderMeasures });
  registerScreen("organ", { title: (z) => `${ZONE_NAMES[z] || "Organ"}`, badge: "DESIGNED", render: renderOrgan });
}

// ---------------- guided exam ----------------
const EXAM = [
  { id: "hr", title: "Resting heart rate", say: "First, your resting heart rate. Sit still and look at the camera for about fifteen seconds, or skip to use the current reading.", kind: "hr" },
  { id: "bp", title: "Blood pressure", say: "Now take your blood pressure with the cuff and enter both numbers.", kind: "bp" },
  { id: "temp", title: "Temperature", say: "Enter your temperature.", kind: "temp" },
  { id: "eyes", title: "Eyes", say: "Two questions about your eyes. Any change in near vision, or headaches on waking?", kind: "eyes" },
  { id: "symptoms", title: "Symptoms", say: "Any symptoms today? Tap all that apply.", kind: "symptoms" },
  { id: "rt", title: "Reaction", say: "Last, a short reaction check. You can run the full three minute test now, or later.", kind: "rt" },
];
const SYMPTOMS = ["headache", "nausea", "back pain", "congestion", "dry eyes", "insomnia", "none"];

function renderExam(el, ctx) {
  const s = ctx.view.state;
  const ans = { hr: s?.vitals?.heart_rate, hrSource: s?.vitals?.sources?.heart_rate || "sim", bpS: s?.manual?.bp_systolic, bpD: s?.manual?.bp_diastolic, temp: s?.manual?.temp_c, eyes: {}, symptoms: [] };
  let i = 0;
  const step = () => {
    const st = EXAM[i];
    el.innerHTML = `<p class="fine">A periodic health check like the one crews run on the station, designed around ${cite("phs")}. Sentinel guides; you decide. Not a diagnosis.</p>
      <ol class="exam-steps">${EXAM.map((e, n) => `<li class="${n < i ? "is-done" : n === i ? "is-now" : ""}">${esc(e.title)}</li>`).join("")}</ol>
      <section class="exam-step card"><h3>${i + 1}. ${esc(st.title)}</h3><p class="note">${esc(st.say)}</p><div data-body></div></section>
      <div class="exam-nav"><button class="pill pill-ghost" type="button" data-back ${i ? "" : "disabled"}>Back</button><button class="pill pill-light" type="button" data-next>${i === EXAM.length - 1 ? "Finish and build the ground packet" : "Next"}</button></div>`;
    const body = el.querySelector("[data-body]");
    if (st.kind === "hr") {
      body.innerHTML = `<p class="exam-big"><strong class="num">${ans.hr != null ? Math.round(ans.hr) : "—"}</strong> bpm ${badgeHTML(ans.hrSource === "camera" ? "LIVE" : "SIM")}</p>
        <button class="pill pill-ghost" type="button" data-cam>Measure with the camera</button>`;
      body.querySelector("[data-cam]").addEventListener("click", () => ctx.director.run([{ cmd: "open_screen", name: "vision" }]));
    } else if (st.kind === "bp") {
      body.innerHTML = `<div class="exam-inputs"><label>Systolic <input type="number" inputmode="numeric" min="70" max="220" data-s value="${ans.bpS ?? ""}"></label><label>Diastolic <input type="number" inputmode="numeric" min="40" max="140" data-d value="${ans.bpD ?? ""}"></label><span>mmHg</span></div>`;
    } else if (st.kind === "temp") {
      body.innerHTML = `<div class="exam-inputs"><label>Temperature <input type="number" inputmode="decimal" step="0.1" min="34" max="42" data-t value="${ans.temp ?? ""}"></label><span>°C</span></div>`;
    } else if (st.kind === "eyes") {
      body.innerHTML = ["Change in near vision", "Headache on waking"].map((q, n) => `<div class="exam-q"><span>${q}</span><div class="seg">${["No", "Yes"].map((a) => `<button type="button" data-eq="${n}" data-a="${a}" aria-selected="${ans.eyes[n] === a}">${a}</button>`).join("")}</div></div>`).join("") +
        `<p class="fine">Spaceflight can change the eye (SANS); crews are screened in flight. A yes here is worth a check with the flight surgeon.</p>`;
      body.querySelectorAll("[data-eq]").forEach((b) => b.addEventListener("click", () => { ans.eyes[b.dataset.eq] = b.dataset.a; step(); }));
    } else if (st.kind === "symptoms") {
      body.innerHTML = `<div class="chips">${SYMPTOMS.map((x) => `<button type="button" class="chip" data-sym="${x}" aria-pressed="${ans.symptoms.includes(x)}">${x}</button>`).join("")}</div>`;
      body.querySelectorAll("[data-sym]").forEach((b) => b.addEventListener("click", () => {
        const x = b.dataset.sym;
        if (x === "none") ans.symptoms = ["none"];
        else { ans.symptoms = ans.symptoms.filter((y) => y !== "none"); ans.symptoms = ans.symptoms.includes(x) ? ans.symptoms.filter((y) => y !== x) : [...ans.symptoms, x]; }
        step();
      }));
    } else if (st.kind === "rt") {
      const c = s?.cognitive || {};
      body.innerHTML = `<p class="exam-big"><strong class="num">${c.reaction_ms ?? "—"}</strong> ms median ${badgeHTML(badgeFor("cognitive.reaction_ms", s, ctx.view.aux))} <span class="fine">baseline ${c.baseline_ms ?? "—"} ms</span></p>
        <button class="pill pill-ghost" type="button" data-rt>Run the 3-minute reaction test</button><p class="fine">${cite("rst")}</p>`;
      body.querySelector("[data-rt]").addEventListener("click", () => ctx.screens.open("cognitive"));
    }
    ctx.say(st.say, { source: "local" });
    el.querySelector("[data-back]").addEventListener("click", () => { i = Math.max(0, i - 1); step(); });
    el.querySelector("[data-next]").addEventListener("click", async () => {
      const v = (q) => { const x = el.querySelector(q); return x && x.value !== "" ? Number(x.value) : null; };
      if (st.kind === "bp") { ans.bpS = v("[data-s]") ?? ans.bpS; ans.bpD = v("[data-d]") ?? ans.bpD; }
      if (st.kind === "temp") ans.temp = v("[data-t]") ?? ans.temp;
      if (i < EXAM.length - 1) { i++; step(); return; }
      await finish();
    });
  };
  async function finish() {
    const p = {};
    if (ans.bpS != null && ans.bpS >= 70 && ans.bpS <= 220) p.bp_systolic = ans.bpS;
    if (ans.bpD != null && ans.bpD >= 40 && ans.bpD <= 140) p.bp_diastolic = ans.bpD;
    if (ans.temp != null && ans.temp >= 34 && ans.temp <= 42) p.temp_c = ans.temp;
    const syms = ans.symptoms.filter((x) => x !== "none");
    if (syms.length) p.symptoms = syms;
    let state = ctx.view.state;
    try { if (Object.keys(p).length) state = await ctx.patch({ manual: { ...p, updated: new Date().toISOString() } }); } catch { /* keep going: the packet still lists what was entered */ }
    const zones = ctx.view.aux?.assessment?.zones || {};
    const flagged = Object.entries(zones).filter(([z, sv]) => sv !== "ok" && z !== "cabin").map(([z, sv]) => `${ZONE_NAMES[z]} (${statusWord(sv).toLowerCase()})`);
    const packet = {
      crew: state.display_name, mission_day: ctx.view.aux?.clock?.mission_day, heart_rate: ans.hr != null ? Math.round(ans.hr) : null, heart_rate_source: ans.hrSource,
      bp: ans.bpS != null ? `${ans.bpS}/${ans.bpD ?? "?"}` : null, temp_c: ans.temp, eyes: { near_vision_change: ans.eyes[0] || "not answered", waking_headache: ans.eyes[1] || "not answered" },
      symptoms: syms, reaction_median_ms: state.cognitive?.reaction_ms, reaction_baseline_ms: state.cognitive?.baseline_ms,
      drift: state.drift?.note || "No change from baseline flagged.", flagged, action: state.action?.detail || "", note: "Change from the crew member's own baseline; not a diagnosis.",
    };
    el.innerHTML = `<article class="packet card">
        <header><span class="label">Ground packet</span><span class="fine">Mission day ${esc(packet.mission_day ?? "—")} · ${esc(new Date().toLocaleString())}</span></header>
        <h3>${esc(packet.crew)}: periodic health check</h3>
        <dl>
          <dt>Heart rate</dt><dd>${esc(packet.heart_rate ?? "—")} bpm ${badgeHTML(packet.heart_rate_source === "camera" ? "LIVE" : "SIM")}</dd>
          <dt>Blood pressure</dt><dd>${esc(packet.bp ?? "not taken")} ${packet.bp ? badgeHTML("LIVE") : ""}</dd>
          <dt>Temperature</dt><dd>${esc(packet.temp_c ?? "not taken")}${packet.temp_c ? " °C " + badgeHTML("LIVE") : ""}</dd>
          <dt>Eyes</dt><dd>near vision change: ${esc(packet.eyes.near_vision_change)}; headache on waking: ${esc(packet.eyes.waking_headache)}</dd>
          <dt>Symptoms</dt><dd>${esc(syms.join(", ") || "none")}</dd>
          <dt>Reaction</dt><dd>${esc(packet.reaction_median_ms ?? "—")} ms median (baseline ${esc(packet.reaction_baseline_ms ?? "—")} ms)</dd>
          <dt>Change from baseline</dt><dd>${esc(packet.drift)}</dd>
          <dt>Areas flagged</dt><dd>${esc(flagged.join(", ") || "none")}</dd>
        </dl>
        <p class="fine">${esc(packet.note)}</p>
      </article>
      <div class="exam-nav"><button class="pill pill-light" type="button" data-send>Send to ground (store and forward)</button><button class="pill pill-ghost" type="button" data-again>Run again</button></div>
      <p class="note" data-sent></p>`;
    el.querySelector("[data-again]").addEventListener("click", () => { i = 0; step(); });
    el.querySelector("[data-send]").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await api.ground(ctx.view.crewId, { kind: "exam", title: `Periodic health check, day ${packet.mission_day ?? ""}`, body: packet });
        el.querySelector("[data-sent]").innerHTML = `Queued for ground. One-way delay ${(r.one_way_s / 60).toFixed(1)} min ${badgeHTML("SIM")}: it arrives in about ${Math.round(r.eta_s / 60)} minutes; a reply cannot come sooner than ${Math.round(r.reply_earliest_s / 60)} minutes. <button class="link-btn" type="button" data-q>Open the queue</button>`;
        el.querySelector("[data-q]").addEventListener("click", () => ctx.screens.open("ground"));
        ctx.say("The exam summary is queued for the flight surgeon. With the delay, a reply will take at least half an hour.", { source: "local" });
      } catch (err) { el.querySelector("[data-sent]").textContent = `Not queued: ${err.message}`; }
    });
    ctx.say(flagged.length ? `Exam complete. ${flagged.length} area${flagged.length > 1 ? "s" : ""} changed from your baseline. I've built a summary for ground.` : "Exam complete. Everything is within your usual range. I've built a summary for ground.", { source: "local" });
  }
  step();
  return () => {};
}

// ---------------- ground queue ----------------
function renderGround(el, ctx) {
  const draw = async () => {
    let d;
    let sim = null;
    try { d = await api.groundList(ctx.view.crewId); } catch { el.innerHTML = `<p class="note">The brain is offline.</p>`; return; }
    try { sim = await api.delaySim(ctx.view.crewId); } catch { /* optional */ }
    if (el.contains(document.activeElement) && document.activeElement !== document.body && el.dataset.drawn) return;   // do not redraw under a finger
    el.dataset.drawn = "1";
    const gv = sim?.ground_view, ov = sim?.onboard_view;
    el.innerHTML = `<p class="note">On a Mars transit, help is minutes away each way, so findings are packaged on board and reviewed later: store and forward. One-way delay now <strong>${d.one_way_min} min</strong> ${badgeHTML("SIM")}. ${cite("eimo")}</p>
      <ul class="ground-list">${d.packets.length ? d.packets.map((p) => `<li class="card">
        <span class="g-status is-${p.status.replace(/ /g, "-")}">${esc(p.status)}</span>
        <strong>${esc(p.title)}</strong>${p.priority && p.priority !== "ROUTINE" ? `<span class="g-prio is-${esc(p.priority)}">${esc(p.priority)}</span>` : ""}
        ${p.kind === "digest" && p.body?.text ? `<details><summary class="fine">Read the digest</summary><pre class="g-digest">${esc(p.body.text)}</pre></details>` : ""}
        <small>${esc(new Date(p.sent * 1000).toLocaleString())} · ${p.status === "queued (no link)" ? "waiting for the link" : p.status === "in transit" ? `arrives in ${Math.ceil(p.eta_s / 60)} min` : p.reply_earliest_s > 0 ? `reply at the earliest in ${Math.ceil(p.reply_earliest_s / 60)} min` : "reply window open"}</small>
        ${p.reply ? `<div class="g-reply"><span class="label">Reply from ${esc(p.reply.author)}</span>
          <span class="fine">Asked ${esc(new Date(p.reply.sent_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))} · reply is ${Math.max(0, Math.round((Date.now() / 1000 - p.reply.received_at) / 60))} min old${Date.now() / 1000 - p.reply.received_at > 3600 ? " · check it still applies" : ""}</span>
          <ol>${p.reply.instructions.map((s) => `<li>${esc(s.text)} ${s.confirmed ? `<span class="fine">confirmed</span>` : `<button class="pill pill-ghost" type="button" data-confirm="${esc(p.id)}" data-n="${s.step_num}">Confirm</button>`}</li>`).join("")}</ol>
          ${p.reply.all_confirmed ? `<span class="fine">Every step confirmed and logged.</span>` : ""}</div>`
          : (p.status !== "queued (no link)" && p.status !== "queued" && p.status !== "in transit" ? `<button class="link-btn" type="button" data-simreply="${esc(p.id)}">Demo: simulate the surgeon's reply (SIM)</button>` : "")}
        ${badgeHTML("SIM")}</li>`).join("") : `<li class="note">Nothing sent yet. The guided exam builds a packet; a flag from the rules engine can too.</li>`}</ul>
      <div class="exam-nav"><button class="pill pill-light" type="button" data-digest>Send a digest to the flight surgeon</button><button class="pill pill-ghost" type="button" data-exam>Start a guided exam</button></div>
      ${sim ? `<h3>Delay simulator ${badgeHTML("SIM")}</h3><div class="cabin-big two">
        <div class="card rcard"><span class="label">What ground sees</span><strong>${esc(gv.last_received || "")}</strong><p class="fine">${gv.link_status === "blackout" ? "No link" : `${esc(gv.stale_by_min)} min behind`} · next update in ${Math.floor((gv.countdown_s || 0) / 60)}:${String(Math.round(gv.countdown_s || 0) % 60).padStart(2, "0")}</p></div>
        <div class="card rcard"><span class="label">What Sentinel did just now</span>${(ov.recent_actions || []).slice(0, 4).map((a) => `<p class="fine"><span class="g-prio is-${a.tag === "escalated" ? "URGENT" : "ROUTINE"}">${esc(a.tag)}</span> ${esc(a.time || "")} ${esc(a.detail)}</p>`).join("")}</div></div>` : ""}`;
    el.querySelectorAll("[data-confirm]").forEach((b) => b.addEventListener("click", async () => { try { await api.groundConfirm(b.dataset.confirm, Number(b.dataset.n)); } catch { /* shown on redraw */ } el.dataset.drawn = ""; b.blur(); draw(); }));
    el.querySelectorAll("[data-simreply]").forEach((b) => b.addEventListener("click", async () => {
      try { await api.groundReply(b.dataset.simreply, ["Rest for 30 minutes and drink 500 mL of water.", "Re-measure and log the reading in the health log.", "Send a follow-up digest if there is no change."]); } catch { /* shown on redraw */ }
      el.dataset.drawn = ""; b.blur(); draw();
    }));
    el.querySelector("[data-exam]").addEventListener("click", () => ctx.screens.open("exam"));
    el.querySelector("[data-digest]").addEventListener("click", async () => { await ctx.sendDigest?.(); draw(); });
  };
  draw();
  const t = setInterval(draw, 5000);
  return () => clearInterval(t);
}

// ---------------- weekly standard measures ----------------
const MEASURES = [
  { id: "rt", label: "Reaction test (3 min)", screen: "cognitive" },
  { id: "mood", label: "Mood and sleep log", screen: "health_log" },
  { id: "sts", label: "Sit-to-stand: five times, timed", timer: "session.sit_to_stand_s" },
  { id: "tw", label: "Tandem walk: ten steps heel to toe, timed", timer: "session.tandem_walk_s" },
  { id: "exam", label: "Guided health exam", screen: "exam" },
];
function renderMeasures(el, ctx) {
  const key = `sentinel:measures:${ctx.view.crewId}:${Math.floor((ctx.view.aux?.clock?.mission_day || 0) / 7)}`;
  const done = (() => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(key, JSON.stringify(done)); } catch { /* storage blocked */ } };
  let timing = null;
  const draw = () => {
    const n = MEASURES.filter((m) => done[m.id]).length;
    el.innerHTML = `<p class="note">A short weekly set, inspired by ${cite("ssm")}: the same few measures every week, so a change shows early. Functional tests are timed here; results are LIVE.</p>
      <div class="measures-progress"><div style="width:${(n / MEASURES.length) * 100}%"></div></div><p class="fine">${n} of ${MEASURES.length} this week</p>
      <ul class="measures">${MEASURES.map((m) => `<li class="card ${done[m.id] ? "is-done" : ""}"><span class="m-check">${done[m.id] ? "✓" : ""}</span><span class="m-label">${esc(m.label)}${done[m.id]?.s ? `<small>${done[m.id].s} s</small>` : ""}</span>
        ${m.timer ? `<button class="pill pill-ghost" type="button" data-time="${m.id}">${timing?.id === m.id ? "Stop" : "Start timer"}</button>` : `<button class="pill pill-ghost" type="button" data-open="${m.screen}" data-id="${m.id}">Open</button>`}</li>`).join("")}</ul>
      <p class="fine" data-timer></p>`;
    el.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => { done[b.dataset.id] = { at: Date.now() }; save(); ctx.screens.open(b.dataset.open); }));
    el.querySelectorAll("[data-time]").forEach((b) => b.addEventListener("click", async () => {
      const m = MEASURES.find((x) => x.id === b.dataset.time);
      if (!timing) { timing = { id: m.id, t0: performance.now() }; draw(); tick(); return; }
      const sec = Math.round((performance.now() - timing.t0) / 100) / 10;
      timing = null;
      done[m.id] = { at: Date.now(), s: sec }; save();
      try { await api.log(ctx.view.crewId, m.timer, sec, "user"); } catch { /* offline: kept locally */ }
      draw();
    }));
  };
  const tick = () => { if (!timing) return; const t = el.querySelector("[data-timer]"); if (t) t.textContent = `${((performance.now() - timing.t0) / 1000).toFixed(1)} s`; requestAnimationFrame(tick); };
  draw();
  return () => { timing = null; };
}

// ---------------- organ detail view ----------------
// The organ view shows the zone's whole group of parts (body3d ZONE_NODES: lungs with the airway, the gut
// with stomach, liver and pancreas, the skeleton for bones), and the picture in this box is rendered from
// those same parts, so the box and the 3D organ always agree.
const ORGAN_ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones"];
function renderOrgan(el, ctx, zone = "heart") {
  if (!ORGAN_ZONES.includes(zone)) zone = "heart";
  const img = { head: "brain" }[zone] || zone;
  const picture = () => ctx.body3d?.snapshot?.(zone) || `assets/organs/${img}.png`;
  emit("body:zone", zone);   // the rail and the system panel follow the organ on screen
  const draw = () => {
    const v = ctx.view;
    const rs = zoneReadings(zone, v.state, v.aux).filter((r) => r.value != null).slice(0, 4);
    const sev = v.aux?.assessment?.zones?.[zone] || "ok";
    const z = ctx.facts?.zones?.[zone] || {};
    el.innerHTML = `<div class="organ-head"><img src="${picture()}" alt=""><div><span class="sev-chip is-${sev === "info" ? "watch" : sev}">${esc(statusWord(sev))}</span><p class="note">${esc(z.what || "")}</p></div></div>
      <div class="organ-turn"><button class="pill pill-ghost" type="button" data-turn="-90">Turn left</button><button class="pill pill-ghost" type="button" data-turn="90">Turn right</button><button class="pill pill-ghost" type="button" data-zin>Closer</button></div>
      <div class="mcards">${rs.map((r) => {
        const b = r.levels ? rangeBar(r.levels, r.value) : null;
        return `<div class="mcard"><span class="mcard-top"><span class="mcard-label">${esc(r.label)}</span>${badgeHTML(r.badge)}</span>
          <span class="mcard-val"><strong class="num">${esc(fmt(r.value, r.field))}</strong><small>${esc(r.unit || "")}</small><em class="st-${r.severity}">${esc(statusWord(r.severity))}</em></span>
          ${b ? `<div class="rbar" style="background:${gradientCss(b.stops, BAR_COL)}"><i style="left:${(b.pos * 100).toFixed(1)}%"></i></div>` : ""}
          <span class="mcard-change">${esc(r.change || "")}</span></div>`;
      }).join("") || `<p class="note">No sensor on this organ yet. The Sentinel Skin wearable (DESIGNED) would add one.</p>`}</div>
      <p class="note">${esc(z.spaceflight || "")}</p>
      <p class="note"><strong>Next:</strong> ${esc(z.next || "")}</p>
      <p class="fine">The organ is a reference anatomy (BodyParts3D, CC BY 4.0) fitted to this body, not your own scan.${zone === "lungs" ? " The lungs are a fitted approximation." : ""}${zone === "eyes" ? " The iris, pupil and vessels are drawn on the eyeball: an illustration, not an image of your eye." : ""}</p>
      <div class="exam-nav"><button class="pill pill-light" type="button" data-check>Check with Sentinel</button></div>`;
    el.querySelectorAll("[data-turn]").forEach((b) => b.addEventListener("click", () => ctx.body3d?.turnBy(Number(b.dataset.turn))));
    el.querySelector("[data-zin]").addEventListener("click", () => ctx.body3d?.zoomBy(0.7));
    el.querySelector("[data-check]").addEventListener("click", () => { ctx.screens.close(); ctx.director.run([{ cmd: "check_zone", zones: [zone] }]); });
  };
  (async () => {
    if (ctx.stages.current !== "body") await ctx.stages.go("body");
    for (let k = 0; k < 40 && !ctx.body3d; k++) await new Promise((r) => setTimeout(r, 150));
    const b = ctx.body3d;
    if (!b) return;
    // the organ sits in the 3D area left of this sheet, never under it
    const switching = b.style === "real";   // from another organ: go straight there
    if (!switching) await new Promise((r) => setTimeout(r, 80));
    const host = document.getElementById("body-host").getBoundingClientRect();
    const sheetLeft = document.getElementById("sheet").getBoundingClientRect().left;
    b.setFrameRect({ left: host.left, top: host.top, width: Math.max(200, Math.min(host.right, sheetLeft - 16) - host.left), height: host.height });
    ctx.organZone = zone;
    document.body.dataset.organ = zone;   // only this organ's dot and chip stay visible
    b.setStyle("real");
    await b.isolate(zone, switching ? 0.6 : 1.2);
    const im = el.querySelector(".organ-head img");
    if (im) im.src = picture();
  })();
  draw();
  const t = setInterval(draw, 4000);
  return () => {
    clearInterval(t);
    const b = ctx.body3d;
    ctx.organZone = null;
    delete document.body.dataset.organ;
    // another organ is opening: no trip back to the whole body in between, it moves straight there
    if (ctx.nextScreen === "organ") return;
    if (b) { b.setFrameRect(null); b.setStyle("radiograph"); b.focus(null); b.setStyle("radiograph"); b.setXray(false, 0.8); b.zoomReset(1.0); }
  };
}
