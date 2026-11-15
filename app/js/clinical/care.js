// Care (Product Document sections 19, 22 W4) and mind support (section 15) in the existing side sheet.
//   care     "I don't feel well": body zone, symptom, severity, one question per screen, an urgency level,
//            the recommendation card, the protocol runner with tick boxes and timers, and the care log
//   mind     the four wellbeing dimensions against your usual, the level wording, the tools that help you,
//            the stress-spike flow, the team cohesion note
//   journal  the private journal: kept on this device only; the engine sees a count, never the text
// Sentinel supports and brings in a person; it does not diagnose, treat or counsel. Mission emergency
// procedures come first. Wording follows the do/don't table in 15.7: change from your usual, never a label.
import { api } from "../core/api.js";
import { emit, on } from "../core/bus.js";
import { pollOnce, view } from "../core/state.js";
import { cue } from "../core/sound.js";
import { ZONE_NAMES, badgeHTML, esc } from "../interface/readings.js";
import { LEVEL, levelChip, offline, taps, when, wireTaps } from "./clinic.js";

// every body area leads to steps; "zone:region" keeps the place the person named while triage uses the zone's questions
const ZONES = [["head", "Head"], ["eyes", "Eyes"], ["lungs:throat", "Throat, nose and ears"], ["chest", "Chest and heart"], ["lungs", "Breathing"], ["gut", "Stomach"],
  ["bones:hands", "Hands and arms"], ["bones:legs", "Legs and feet"], ["bones:back", "Back and neck"], ["skin", "Skin"], ["whole_body", "Whole body"]];
const ZONE_ALIAS = { heart: "chest" };
const SYMPTOMS = { head: ["headache", "dizziness", "congestion"], eyes: ["blurred vision", "dry eyes", "eye irritation"], chest: ["chest tightness", "racing heart"], lungs: ["cough", "short of breath"],
  gut: ["nausea", "motion sickness", "stomach pain"], bones: ["muscle ache", "joint pain", "back pain"], skin: ["rash", "cut or scrape", "itchy skin"], whole_body: ["fever or chills", "very tired", "unwell all over"],
  "lungs:throat": ["sore throat", "cough", "blocked nose", "ear pain"], "bones:hands": ["hand or wrist pain", "numb or tingling fingers", "swollen hand", "arm or shoulder pain"],
  "bones:legs": ["knee or ankle pain", "leg muscle ache", "swollen foot", "numb foot"], "bones:back": ["back pain", "neck pain", "stiff neck"] };
const RUN_KEY = (cid) => `sentinel:care:run:${cid}`;

// Spoken (or typed) replies while Care is open: "five", "yes", "done", "better", "still hurts", "worse".
// Each view sets the handler for the one thing it is asking; anything else falls through to normal conversation.
let voiceFn = null;
const norm = (t) => ` ${String(t || "").toLowerCase().replace(/[\u2019']/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()} `;
const NUM = { zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (t) => { const m = / (10|[0-9]) /.exec(t); if (m) return Number(m[1]); for (const [w, n] of Object.entries(NUM)) if (t.includes(` ${w} `)) return n; return null; };
const YES = / (yes|yeah|yep|yup|i do|i am|it is|it did|correct|affirmative|a bit|a little) /, NO = / (no|nope|nah|not really|i dont|i do not|it isnt|negative|none) /;
/** True if the open Care view used the reply. */
export function careReply(text) { try { return voiceFn ? !!voiceFn(norm(text)) : false; } catch { return false; } }
/** A symptom said out loud -> where to start triage: "my stomach is not well", "I have a headache". */
export function symptomFromSpeech(text, zone) {
  const t = norm(text);
  const pick = [[/ (headache|head hurts|head aches|migraine) /, "head", "headache"], [/ (dizzy|dizziness|light headed|lightheaded) /, "head", "dizziness"],
    [/ (blurry|blurred|cant see|double vision|vision) /, "eyes", "blurred vision"], [/ (dry eyes?|itchy eyes?|eyes? (is|are)? ?(sore|irritated)|sore eyes?) /, "eyes", "eye irritation"],
    [/ (nausea|nauseous|feel sick|queasy|motion sick|throw up|vomit) /, "gut", "nausea"], [/ (stomach|belly|tummy|gut|abdomen) /, "gut", "stomach pain"],
    [/ (racing heart|heart is racing|palpitations?|heart pounding) /, "chest", "racing heart"], [/ (chest) /, "chest", "chest tightness"],
    [/ (cant breathe|short of breath|breathless|hard to breathe) /, "lungs", "short of breath"], [/ (cough) /, "lungs", "cough"],
    [/ (fever|chills|feverish|burning up) /, "whole_body", "fever or chills"], [/ (rash|itchy skin) /, "skin", "rash"],
    [/ (numb|numbness|tingling|pins and needles) /, "bones", "numbness or tingling"], [/ (swollen|swelling) /, "bones", "swelling"],
    [/ (hands?|wrists?|fingers?|thumbs?) /, "bones", "hand or wrist pain"], [/ (foot|feet|toes?|ankles?|knees?|legs?|calf|thigh) /, "bones", "leg or foot pain"],
    [/ (neck) /, "bones", "neck pain"], [/ (throat) /, "lungs", "sore throat"], [/ (ears?|earache) /, "lungs", "ear pain"], [/ (nose|congested|stuffy|sneezing) /, "lungs", "blocked nose"],
    [/ (cut|scrape|bleeding|blister|bruise) /, "skin", "cut or scrape"], [/ (itchy|itching) /, "skin", "itchy skin"],
    [/ (back) /, "bones", "back pain"], [/ (knee|elbow|shoulder|joint|wrist|ankle) /, "bones", "joint pain"], [/ (muscle|leg|arm|cramp) /, "bones", "muscle ache"]]
    .find(([re]) => re.test(t));
  if (pick) return { zone: pick[1], symptom: pick[2] };
  const z = ZONE_ALIAS[zone] || zone;
  const dflt = { head: "headache", eyes: "eye irritation", chest: "chest tightness", lungs: "short of breath", gut: "stomach pain", bones: "muscle ache" }[z];
  return z && dflt ? { zone: z, symptom: dflt } : null;
}

export function registerCare(registerScreen) {
  registerScreen("care", { title: "Care", render: renderCare });
  registerScreen("mind", { title: "How you're doing", render: renderMind });
  registerScreen("journal", { title: "Private journal", badge: "on this device", render: renderJournal });
  // closed loop (15.6): every support session's before and after goes to the wellbeing engine, which ranks tools per person
  on("support.finished", (d) => {
    if (!view.crewId || !d?.tool || d.stressBefore == null || d.stressAfter == null) return;
    api.wbSession(view.crewId, { tool_id: d.tool, pre_stress: d.stressBefore, post_stress: d.stressAfter, pre_mood: d.moodBefore, post_mood: d.moodAfter }).catch(() => {});
  });
}

// ================= care =================
function renderCare(el, ctx, arg) {
  const cid = ctx.view.crewId;
  let alive = true, timerT = null;
  const stop = () => { clearInterval(timerT); timerT = null; };
  const spoken = !!arg?.voice;   // started by voice: Sentinel asks each question out loud
  const ask = (line, always = false) => { if (always || spoken) { ctx.say?.(line, { source: "local" }); ctx.expectReply?.(12000); } };
  const title = (t) => { document.getElementById("sheet-title").textContent = t; };
  const lastRun = () => { try { return localStorage.getItem(RUN_KEY(cid)); } catch { return null; } };
  const setRun = (id) => { try { if (id) localStorage.setItem(RUN_KEY(cid), id); else localStorage.removeItem(RUN_KEY(cid)); } catch { /* storage blocked */ } };

  // ---- home: three ways in ----
  async function home() {
    stop(); title("Care"); voiceFn = null;
    let run = null;
    const id = lastRun();
    if (id) { try { run = await api.protoGet(id); if (!["running", "paused"].includes(run.state)) { run = null; setRun(null); } } catch { setRun(null); } }
    if (!alive) return;
    el.innerHTML = `<p class="note">Tell Sentinel what you feel. It works out how urgent it is, gives one clear next step, and brings in the crew and ground when that is the right call. In an emergency, mission procedures come first.</p>
      ${run ? `<article class="card cl-card"><span class="label">In progress</span><h3>${esc(run.title)}</h3><p class="note">${run.steps.filter((s) => s.done).length} of ${run.steps.length} steps done${run.state === "paused" ? " · paused" : ""}.</p>
        <div class="exam-nav"><button class="pill pill-light" type="button" data-resume>Carry on</button></div></article>` : ""}
      <div class="hub"><button type="button" data-v="triage"><strong>I don't feel well</strong><span>A few questions, then what to do</span></button>
        <button type="button" data-v="library"><strong>Protocols</strong><span>The sourced step-by-step library</span></button>
        <button type="button" data-v="log"><strong>Care log</strong><span>Past symptoms, protocols, outcomes</span></button>
        <button type="button" data-v="kit"><strong>Medical kit</strong><span>What is on board, filtered for you</span></button></div>`;
    el.querySelector("[data-resume]")?.addEventListener("click", () => runner(run.run_id));
    el.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => ({ triage: () => triage({}), library, log, kit: () => ctx.screens.open("kit") })[b.dataset.v]()));
  }

  // ---- triage: zone, symptom, severity, then one question per screen (W4) ----
  async function triage(t) {
    stop(); title("I don't feel well"); voiceFn = null;
    const back = `<p><button class="link-btn" type="button" data-home>Back to Care</button></p>`;
    const wireHome = () => el.querySelector("[data-home]")?.addEventListener("click", home);
    if (!t.zone) {
      el.innerHTML = `<h3>Where is it?</h3><div class="hub">${ZONES.map(([k, n]) => `<button type="button" data-z="${k}"><strong>${esc(n)}</strong></button>`).join("")}</div>
        <p class="fine">Or point at the body: <button class="link-btn" type="button" data-point>Where does it hurt?</button></p>${back}`;
      el.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", () => { const [zone, region] = b.dataset.z.split(":"); triage({ ...t, zone, region }); }));
      el.querySelector("[data-point]").addEventListener("click", () => ctx.screens.open("symptom"));
      voiceFn = (said) => { const sy = symptomFromSpeech(said); if (!sy) return false; triage({ ...t, ...sy }); return true; };
      ask("Sorry to hear that. Where is it, and what do you feel?");
      return wireHome();
    }
    if (!t.symptom) {
      el.innerHTML = `<h3>What do you feel?</h3><div class="chips sym-row">${(SYMPTOMS[t.region ? `${t.zone}:${t.region}` : t.zone] || SYMPTOMS[t.zone] || []).map((s) => `<button type="button" class="chip sym-chip" data-s="${esc(s)}">${esc(s[0].toUpperCase() + s.slice(1))}</button>`).join("")}</div>
        <label class="pf-field"><span>Or in your own words</span><input type="text" data-own maxlength="40" placeholder="e.g. ringing in the ears"></label>
        <p><button class="pill pill-dark" type="button" data-next>Next</button></p>${back}`;
      el.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => triage({ ...t, symptom: b.dataset.s })));
      el.querySelector("[data-next]").addEventListener("click", () => { const v = el.querySelector("[data-own]").value.trim().toLowerCase(); if (v) triage({ ...t, symptom: v }); else el.querySelector("[data-own]").focus(); });
      return wireHome();
    }
    if (t.severity == null) {
      el.innerHTML = `<h3>How strong is it?</h3><p class="note">0 is barely there. 10 is the worst you can imagine.</p>${taps("sev", null, 10, 0)}${back}`;
      wireTaps(el, (_, v) => triage({ ...t, severity: v }));
      voiceFn = (said) => { const n = num(said); if (n == null) return false; triage({ ...t, severity: n }); return true; };
      ask(`Sorry to hear that. How strong is the ${t.symptom}, from zero to ten?`);
      return wireHome();
    }
    if (!t.questions) {
      let q = [];
      try { q = (await api.triageQuestions(t.zone)).questions || []; } catch { /* offline: go on without questions */ }
      if (!alive) return;
      return triage({ ...t, questions: q, answers: {}, qi: 0 });
    }
    if (t.qi < t.questions.length) {
      const q = t.questions[t.qi];
      el.innerHTML = `<p class="fine">Question ${t.qi + 1} of ${t.questions.length}</p><h3>${esc(q.text)}</h3>
        <div class="mood-row"><button type="button" data-a="1">Yes</button><button type="button" data-a="0">No</button></div>${back}`;
      const answer = (yes) => {
        const answers = { ...t.answers, [q.id]: yes };
        // a red flag skips the rest: immediate steps first
        triage({ ...t, answers, qi: yes && q.red_flag ? t.questions.length : t.qi + 1 });
      };
      el.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => answer(b.dataset.a === "1")));
      voiceFn = (said) => { if (NO.test(said)) { answer(false); return true; } if (YES.test(said)) { answer(true); return true; } return false; };
      ask(q.text);
      return wireHome();
    }
    el.innerHTML = `<p class="note">Working it out…</p>`;
    let res;
    try { res = await api.triage(cid, { zone: t.zone, symptom: t.symptom, severity: t.severity, answers: t.answers, onset: t.onset || "now" }); }
    catch (e) { el.innerHTML = `<p class="note">Triage could not finish: ${esc(e.message)}. If this feels serious, tell a crewmate now.</p>${back}`; return wireHome(); }
    if (!alive) return;
    emit("symptom.logged", { zone: t.zone, type: t.symptom, severity: t.severity, crewId: cid, via: "triage" });
    pollOnce();
    card(res);
  }

  // ---- the recommendation card (19.3): what we see, how sure, what to do, what to use, recheck, escalate if, why ----
  function card(res) {
    stop();
    const c = res.recommendation_card || {}, lvl = res.urgency, urgent = lvl >= 3;
    title(urgent ? "Urgent" : "What to do");
    const kit = res.kit;
    if (urgent) { cue.alert?.(); ctx.say?.("This needs attention now. Tell a crewmate. I've sent a priority digest to the flight surgeon.", { source: "local", interrupt: true }); }
    el.innerHTML = `<article class="card cl-card ${urgent ? "cl-urgent" : ""}">
        <span class="label">${levelChip(lvl)}${res.red_flags?.length ? " · red flag" : ""}</span>
        <h3>${esc(urgent ? "Stop what you are doing and tell a crewmate now." : c.protocol_title || res.protocol_title || "We could not match this to a protocol")}</h3>
        ${urgent ? `<p><strong>${esc(res.alerted?.buddy || "Your crew buddy")}</strong> and <strong>${esc(res.alerted?.commander || "the commander")}</strong> are alerted ${badgeHTML("SIM")}. A priority digest ${res.packet?.status === "queued (no link)" ? "is queued and leaves the moment the link returns" : "is on its way to the flight surgeon"}. Follow the mission's emergency procedure first.</p>` : ""}
        <dl class="cl-rec">
          <dt>What we see</dt><dd>${esc(res.symptom)} (${esc(ZONE_NAMES[res.zone] || res.zone)}), strength ${esc(res.severity ?? "—")} of 10.</dd>
          <dt>How sure</dt><dd>${esc(c.sure || "")}</dd>
          <dt>What to do now</dt><dd>${res.protocol_id ? "" : esc(res.detail || "")}<ol>${(c.now || []).map((s) => `<li>${esc(String(s).replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol></dd>
          <dt>What to use</dt><dd>${kit?.safety?.blocked ? `<strong>Do not use ${esc(kit.item?.name || "this item")}:</strong> ${esc(kit.safety.reason)}` : esc(c.use || "Nothing needed.")}${kit?.item?.pack && !kit?.safety?.blocked ? ` <span class="fine">${esc(kit.item.pack)}</span>` : ""}</dd>
          <dt>Recheck</dt><dd>${esc(c.recheck_minutes ? `In ${c.recheck_minutes} minutes; the reminder is set when you start the steps.` : c.recheck || "")}</dd>
          <dt>Escalate if</dt><dd>${esc(c.escalate_if || "")}</dd>
          <dt>Why it matters</dt><dd>${esc(c.why || "")}${c.source?.title ? ` <span class="fine">Source: ${c.source.url ? `<a class="src-link" href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.title)}</a>` : esc(c.source.title)}</span>` : ""}</dd>
        </dl></article>
      <div class="exam-nav">${res.protocol_id ? `<button class="pill pill-light" type="button" data-start>${urgent ? "Open the immediate steps" : "Start the steps"}</button>` : ""}
        <button class="pill ${res.protocol_id ? "pill-ghost" : "pill-light"}" type="button" data-ground>Contact the flight surgeon</button><button class="pill pill-ghost" type="button" data-done>${urgent ? "Close" : "Not now"}</button></div>
      <p class="note" data-msg aria-live="polite"></p>`;
    el.querySelector("[data-done]").addEventListener("click", () => ctx.screens.close());
    voiceFn = (said) => {
      if (/ (surgeon|ground|doctor) /.test(said)) { el.querySelector("[data-ground]")?.click(); return true; }
      if (/ (start|begin|go|yes|okay|ok|steps?) /.test(said) && el.querySelector("[data-start]")) { el.querySelector("[data-start]").click(); return true; }
      if (/ (not now|later|close|no) /.test(said)) { ctx.screens.close(); return true; }
      return false;
    };
    if (!urgent) ask(res.protocol_id ? `${LEVEL[lvl]?.[0] || "Watch"} level. I have ${(c.now || []).length || "a few"} steps for the ${res.symptom}. Say start and I'll take you through them one at a time.`
      : `I couldn't match the ${res.symptom} to a protocol, so the next step is the flight surgeon. Say surgeon and I'll send a digest.`);
    el.querySelector("[data-ground]").addEventListener("click", async (e) => { e.currentTarget.disabled = true; await ctx.sendDigest?.(`Triage: ${res.symptom}, level ${lvl}`); el.querySelector("[data-msg]").textContent = "Digest queued for the flight surgeon. Open To ground to follow it."; });
    el.querySelector("[data-start]")?.addEventListener("click", async () => {
      try {
        const run = await api.protoStart(cid, res.protocol_id, { symptom: res.symptom, zone: res.zone, level: lvl });
        setRun(run.run_id);
        if (c.recheck_minutes) api.planRecheck(cid, run.title, c.recheck_minutes).catch(() => {});
        emit("recommendation.accepted", { protocol: res.protocol_id, level: lvl, crewId: cid });
        runner(run.run_id);
      } catch (e) { el.querySelector("[data-msg]").textContent = `Could not start: ${e.message}`; }
    });
  }

  // ---- the guided runner: one step at a time. Done -> "did that help?" -> better ends it, the same moves on,
  //      worse (or the last step without relief) escalates to the flight surgeon. Touch or voice.
  const PREP = /^(confirm|retrieve|verify|check|record|recheck|note|log|locate|get|read)\b/i;   // preparation: no "did it help?" after these
  async function runner(id) {
    stop();
    let run;
    try { run = await api.protoGet(id); } catch { setRun(null); return home(); }
    if (!alive) return;
    title(run.title);
    const what = run.context?.symptom || "it";
    let timer = null;          // {step, left}
    let phase = "step";        // step | ask | final
    let asked = 0;             // the step the question is about
    let note = "";
    const cur = () => run.steps.find((x) => !x.done);
    const live = () => run.state === "running";
    const fmtT = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
    const call = async (fn) => { try { run = await fn(); return true; } catch (e) { note = e.message; draw(); return false; } };
    const speak = () => {
      if (!live()) return;
      const st = cur();
      if (phase === "ask") ask(`Did that help? Is the ${what} better, about the same, or worse?`, true);
      else if (phase === "final") ask(`That was the last step. How is the ${what} now: better, the same, or worse?`, true);
      else if (st) ask(`Step ${st.step_num}. ${st.text} Say done when you have.`, true);
    };
    async function stepDone(skipped = false) {
      const st = cur();
      if (!st || !live()) return;
      stop(); timer = null;
      if (!(await call(() => api.protoStep(id, st.step_num, true)))) return;
      emit("protocol.step", { runId: id, stepIndex: st.step_num, done: true, crewId: cid });
      asked = st.step_num;
      phase = !cur() ? "final" : !skipped && !PREP.test(st.text) ? "ask" : "step";
      draw(); speak();
    }
    async function answer(kind) {
      if (!live()) return;
      if (kind === "better") {
        if (!(await call(() => api.protoAct(id, "complete", { outcome: `Resolved after step ${asked} of ${run.steps.length}` })))) return;
        setRun(null); emit("protocol.completed", { protocol: run.protocol_id, outcome: "Resolved", crewId: cid });
        ctx.say?.(`Good. I've logged that the ${what} eased after step ${asked}. I'll check back at the recheck time.`, { source: "local" });
        ctx.showNotice?.("Saved to your care log.");
      } else if (kind === "same" && phase === "ask") {
        phase = "step"; draw(); speak(); return;
      } else {
        const why = kind === "worse" ? `Worse after step ${asked}` : "No improvement after all the steps";
        if (!(await call(() => api.protoAct(id, "escalate", { note: why })))) return;
        setRun(null); emit("protocol.escalated", { protocol: run.protocol_id, reason: why, crewId: cid });
        const p = run.packet || {};
        ctx.showNotice?.(p.status === "queued (no link)" ? "Escalated. Digest queued: it leaves when the link returns." : `Escalated and sent to ground. Arrives in about ${Math.max(1, Math.round((p.eta_s || 0) / 60))} min.`);
        ctx.say?.(`${kind === "worse" ? "Stop there." : "The steps haven't helped."} I'm escalating to the flight surgeon. ${p.status === "queued (no link)" ? "There's no link right now, so the digest goes the moment it returns." : `The digest arrives in about ${Math.max(1, Math.round((p.eta_s || 0) / 60))} minutes.`} Tell a crewmate how you feel.`, { source: "local" });
      }
      pollOnce(); draw();
    }
    const draw = () => {
      if (!alive) return;
      const done = run.steps.filter((x) => x.done).length, st = cur(), p = run.packet || {};
      const all = `<details class="more"><summary>All ${run.steps.length} steps</summary><ol class="cl-all">${run.steps.map((x) => `<li class="${x.done ? "is-done" : x === st ? "is-now" : ""}">${esc(x.text)}${x.required ? "" : " <span class=\"fine\">optional</span>"}</li>`).join("")}</ol></details>`;
      let main = "";
      if (run.state === "completed") {
        main = `<article class="card cl-card"><span class="label">Finished ${badgeHTML("LIVE")}</span><h3>${esc(run.outcome || "Resolved")}</h3>
          <p class="note">Saved to your care log. A recheck reminder is in Today; if the ${esc(what)} comes back, open Care again.</p></article>`;
      } else if (run.state === "escalated") {
        main = `<article class="card cl-card cl-urgent"><span class="label">${levelChip(2)} · escalated</span><h3>Sent to the flight surgeon</h3>
          <p>${esc(run.escalation_note || "")}. ${done} of ${run.steps.length} steps were done.</p>
          <p class="note">${p.status === "queued (no link)" ? "No link right now: the digest is queued and leaves the moment the link returns." : `The digest arrives in about ${Math.max(1, Math.round((p.eta_s || 0) / 60))} minutes; a reply cannot come back for at least ${Math.max(1, Math.round((p.reply_earliest_s || 0) / 60))}.`} ${badgeHTML("SIM")} Tell a crewmate how you feel, rest, and note any change. If it becomes severe, follow the mission's emergency procedure.</p></article>`;
      } else if (run.state === "paused") {
        main = `<article class="card cl-card"><span class="label">Paused</span><h3>${esc(st ? `Next: step ${st.step_num}` : "All steps done")}</h3><p class="note">Nothing is lost. Resume when you are ready.</p></article>`;
      } else if (phase === "ask" || phase === "final") {
        main = `<article class="card cl-card cl-step"><span class="label">${phase === "final" ? "Last step done" : `After step ${asked}`}</span>
          <h3>${phase === "final" ? `How is the ${esc(what)} now?` : `Did that help the ${esc(what)}?`}</h3>
          <div class="cl-ans"><button class="pill pill-light" type="button" data-ans="better">Better</button><button class="pill pill-ghost" type="button" data-ans="same">${phase === "final" ? "Still the same" : "About the same"}</button><button class="pill pill-ghost" type="button" data-ans="worse">Worse</button></div>
          <p class="fine">${phase === "final" ? "Better closes this. The same or worse goes to the flight surgeon." : "Better closes this. About the same moves to the next step. Worse goes to the flight surgeon."} You can also say it.</p></article>`;
      } else if (st) {
        main = `<article class="card cl-card cl-step"><span class="label">Step ${st.step_num} of ${run.steps.length}${st.required ? "" : " · optional"}</span>
          <h3>${esc(st.text)}</h3>
          ${st.timer_s ? `<p><button class="pill pill-ghost" type="button" data-timer="${st.timer_s}">${timer ? `${fmtT(timer.left)} left · stop` : `Start the ${Math.round(st.timer_s / 60)} minute timer`}</button></p>` : ""}
          <div class="cl-ans"><button class="pill pill-light" type="button" data-stepdone>Done</button>${st.required ? "" : `<button class="pill pill-ghost" type="button" data-skip>Skip</button>`}<button class="pill pill-ghost" type="button" data-ans="worse">It's getting worse</button></div>
          <p class="fine">Dosing only as the kit label or the protocol states. You can also say "done".</p></article>`;
      }
      el.innerHTML = `<div class="measures-progress"><div style="width:${(done / run.steps.length) * 100}%"></div></div>
        <p class="fine">${done} of ${run.steps.length} steps · ${esc(run.state)}${run.demo_default ? " · general supportive care: a demo default, not yet reviewed by a clinician" : ""}</p>
        ${main}${all}
        <div class="exam-nav">${live() || run.state === "paused" ? `<button class="pill pill-ghost" type="button" data-pause>${run.state === "paused" ? "Resume" : "Pause"}</button>` : `<button class="pill pill-light" type="button" data-log>Open the care log</button>`}<button class="pill pill-ghost" type="button" data-home>Back to Care</button></div>
        <p class="note" data-msg aria-live="polite">${esc(note)}</p>`;
      note = "";
      el.querySelector("[data-stepdone]")?.addEventListener("click", () => stepDone());
      el.querySelector("[data-skip]")?.addEventListener("click", () => stepDone(true));
      el.querySelectorAll("[data-ans]").forEach((b) => b.addEventListener("click", () => answer(b.dataset.ans)));
      el.querySelector("[data-timer]")?.addEventListener("click", (e) => {
        if (timer) { stop(); timer = null; return draw(); }
        timer = { left: Number(e.currentTarget.dataset.timer) };
        timerT = setInterval(() => {
          timer.left -= 1;
          if (timer.left <= 0) { stop(); timer = null; cue.nudge?.(); ctx.say?.("Timer done.", { source: "local" }); stepDone(); return; }
          const tb = el.querySelector("[data-timer]");
          if (tb) tb.textContent = `${fmtT(timer.left)} left · stop`;
        }, 1000);
        draw();
      });
      el.querySelector("[data-pause]")?.addEventListener("click", async () => { stop(); timer = null; if (await call(() => api.protoAct(id, run.state === "paused" ? "resume" : "pause"))) { draw(); speak(); } });
      el.querySelector("[data-home]")?.addEventListener("click", home);
      el.querySelector("[data-log]")?.addEventListener("click", log);
    };
    voiceFn = (said) => {
      if (!live()) return false;
      if (/ (repeat|say (it|that) again|what was (it|that)) /.test(said)) { speak(); return true; }
      if (/ (worse|getting bad|much worse|a lot worse) /.test(said)) { answer("worse"); return true; }
      if (phase === "step") {
        if (/ skip /.test(said) && cur() && !cur().required) { stepDone(true); return true; }
        if (/ (done|next|finished|did it|did that|ok|okay|complete|ready|got it|i have|yes) /.test(said)) { stepDone(); return true; }
        return false;
      }
      if (/ (not|no|nope|didnt|did not|still|same|hurts|nothing|isnt|aint) /.test(said)) { answer("same"); return true; }
      if (/ (better|helped|it worked|worked|gone|fine|good|improv\w*|easing|eased|yes|yeah|a bit|a little) /.test(said)) { answer("better"); return true; }
      return false;
    };
    if (!cur() && live()) phase = "final";
    draw(); speak();
  }

  // ---- the protocol library: sourced content only; an unsourced protocol is never shown as an instruction ----
  async function library() {
    stop(); title("Protocols"); voiceFn = null;
    const o = ctx.view.aux?.ops || {};
    let d;
    try { d = await api.protocols(o.env || "transit", o.mode || "routine"); } catch { return offline(el); }
    if (!alive) return;
    el.innerHTML = `<p class="note">Each protocol has its triggers, red flags, steps, kit item, recheck time and source. Steps shown are the variant for <strong>${esc(o.env || "transit")}</strong>, ${esc(o.mode || "routine")} mode.</p>
      ${d.protocols.map((p) => `<details class="ev-doc"><summary><b>${esc(p.title)}</b><span>${esc(ZONE_NAMES[p.zone] || p.zone || "")}</span><small>${p.verified ? "sourced" : "unverified: not shown as an instruction"}</small></summary>
        ${p.verified ? `<h4>Steps</h4><ol>${(p.steps || []).map((s) => `<li>${esc(s.text)}</li>`).join("")}</ol>` : ""}
        <h4>Escalate if</h4><ul>${(p.red_flags || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
        ${p.verified ? `<p><button class="pill pill-ghost" type="button" data-run="${esc(p.id)}">Go through these steps</button></p>` : ""}
        <p class="fine">Kit: ${esc(p.kit_item || "none")} · recheck after ${esc(p.recheck_interval_min ?? "—")} min · ${esc(p.hrp_risk || "")}. Source: ${p.source?.url ? `<a class="src-link" href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.title)}</a>` : esc(p.source?.title || "none")}</p></details>`).join("")}
      <p><button class="link-btn" type="button" data-home>Back to Care</button></p>`;
    el.querySelector("[data-home]").addEventListener("click", home);
    el.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", async () => {
      try { const run = await api.protoStart(cid, b.dataset.run, { symptom: "problem" }); setRun(run.run_id); runner(run.run_id); } catch (e) { b.textContent = e.message; }
    }));
  }

  // ---- the care log ----
  async function log() {
    stop(); title("Care log"); voiceFn = null;
    let d;
    try { d = await api.careLog(cid); } catch { return offline(el); }
    if (!alive) return;
    const sym = ctx.view.state?.manual?.symptom_log || [];
    const word = { triage: "Triage", protocol_completed: "Protocol finished", protocol_escalated: "Escalated" };
    el.innerHTML = `${d.empty ? `<p class="note">${esc(d.placeholder)}</p>` : `<ul class="ground-list">${d.entries.map((e) => `<li class="card">
        <span class="g-status ${e.type === "protocol_escalated" || e.urgency >= 3 ? "is-queued-(no-link)" : e.type === "protocol_completed" ? "is-delivered" : "is-in-transit"}">${esc(word[e.type] || e.type)}</span>
        <strong>${esc(e.protocol || e.symptom || "")}${e.symptom && e.protocol ? ` <span class="fine">for ${esc(e.symptom)}</span>` : ""}</strong>
        <small>${esc(when(e.timestamp))}${e.urgency != null ? ` · ${esc(LEVEL[e.urgency]?.[0] || "")}` : ""}${e.severity != null ? ` · strength ${e.severity}/10` : ""}${e.total_steps ? ` · ${e.steps_completed} of ${e.total_steps} steps` : ""}${e.kit_item ? ` · kit: ${esc(e.kit_item)}` : ""} · ${esc(e.outcome || "")}</small></li>`).join("")}</ul>`}
      ${sym.length ? `<h3>Symptoms you logged on the body</h3><ul class="note">${sym.filter((s) => s.type).slice(0, 10).map((s) => `<li>${esc(s.type)} (${esc(s.region || s.zone)})${s.at ? `, ${esc(new Date(s.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}` : ""}</li>`).join("")}</ul>` : ""}
      <p><button class="link-btn" type="button" data-home>Back to Care</button></p>`;
    el.querySelector("[data-home]").addEventListener("click", home);
  }

  if (arg === "log") log();
  else if (arg === "library") library();
  else if (arg?.run) runner(arg.run);
  else if (arg?.protocol) {
    const proto = arg.protocol;
    const protoId = proto.id || arg.protocol_id;
    const sev = arg.severity != null ? arg.severity : 2;
    const lvl = sev >= 3 ? 3 : 2;
    card({
      symptom: arg.symptom || proto.title,
      zone: arg.zone || proto.zone,
      severity: sev,
      urgency: lvl,
      protocol_id: protoId,
      protocol_title: proto.title,
      kit: {
        item: { name: proto.kit_item || "Convenience Pack medication", pack: "Locker MED-1" },
        safety: {}
      },
      recommendation_card: {
        protocol_title: proto.title,
        sure: "High (Deterministic NASA MRID protocol match)",
        now: (proto.steps || []).map((s) => s.text),
        use: proto.kit_item || "Convenience Pack medication",
        recheck_minutes: proto.recheck_interval_min || 45,
        escalate_if: (proto.red_flags || []).join(". "),
        why: `Grounding: ${proto.hazard || "Hostile closed environment"}. Sourced from ${proto.source?.title || "NASA Flight Medicine"}.`,
        source: proto.source
      }
    });
  }
  else if (arg && (arg.zone || arg.symptom)) triage({ zone: ZONE_ALIAS[arg.zone] || arg.zone, symptom: arg.symptom, severity: arg.severity, onset: arg.onset });
  else if (arg === "triage" || arg?.view === "triage") triage({});
  else home();
  return () => { alive = false; stop(); voiceFn = null; };
}

// ================= the four wellbeing dimensions and the support flows (section 15) =================
const TOOL_SCREEN = { orb_calm: "orb_calm", paced_breathing: "orb_calm", grounding: "grounding", earth_window: "earth_window", sound_music: "music", private_journal: "journal",
  sleep_winddown: "today", connection_nudge: "connection", greenhouse: "greenhouse", race: "race" };
const TOOL_NAME = { orb_calm: "Stillpoint (Orb Calm)", paced_breathing: "Paced breathing", grounding: "Grounding 5-4-3-2-1", earth_window: "Window to Earth", sound_music: "Sound and music",
  private_journal: "Private journal", sleep_winddown: "Sleep wind-down", connection_nudge: "Reach a crewmate", greenhouse: "Red Harvest", race: "Slipstream", home_messages: "Messages from home" };
const DIM = { mood: ["Mood", "lower than your usual"], energy: ["Energy", "lower than your usual"], stress: ["Stress", "higher than your usual"], connection: ["Connection", "quieter than your usual"] };

function renderMind(el, ctx, arg) {
  const cid = ctx.view.crewId;
  let alive = true, spike = arg === "stress" ? {} : null;
  const openTool = (id) => {
    const scr = TOOL_SCREEN[id];
    if (!scr) return;
    if (scr === "today") ctx.screens.open("today", "winddown"); else ctx.director.run([{ cmd: "open_screen", name: scr }]);
  };
  const draw = async () => {
    let w, team = null;
    try { [w, team] = await Promise.all([api.wb(cid), api.cohesion().catch(() => null)]); } catch { if (alive) offline(el); return; }
    if (!alive) return;
    const d = w.details || {};
    const line = { mood: d.mood?.self_rating != null ? `You rated it ${d.mood.self_rating} of 5${d.mood.tags?.length ? ` · ${d.mood.tags.join(", ")}` : ""}` : "No rating yet today",
      energy: `${d.energy?.sleep_hours != null ? `${d.energy.sleep_hours} h sleep` : "No sleep entry"}${d.energy?.self_rating != null ? ` · you rated it ${d.energy.self_rating} of 5` : ""}`,
      stress: d.stress?.drifting && !(d.stress?.self_rating >= 4) ? `Resting pulse is above your usual${d.stress?.self_rating != null ? ` · you rated it ${d.stress.self_rating} of 5` : ""}`
        : d.stress?.self_rating != null ? `You rated it ${d.stress.self_rating} of 5` : "No rating yet today",
      connection: d.connection?.self_rating != null ? `You rated it ${d.connection.self_rating} of 5` : d.connection?.missed_checkins ? `${d.connection.missed_checkins} check-ins missed` : "Talk time near your usual" };
    const tools = (w.tools?.length ? w.tools : (w.ranked_toolkit || []).slice(0, 3));
    el.innerHTML = `<article class="card cl-card"><span class="label">This week ${badgeHTML(w.level === 0 ? "steady" : w.level === 1 ? "check-in" : "support plan")}</span><h3>${esc(w.wording)}</h3>
        <p class="fine">Four dimensions, no single score. Sentinel says what it noticed and why; it describes change from your usual and never labels a condition.</p></article>
      <div class="cl-dims">${Object.entries(DIM).map(([k, [name, drift]]) => `<div class="card cl-dim ${w.dims?.[k] ? "is-drift" : ""}"><span class="label">${esc(name)}</span><strong>${w.dims?.[k] ? esc(drift) : "steady"}</strong><span class="fine">${esc(line[k])}</span></div>`).join("")}</div>
      ${d.energy?.readiness_note ? `<p class="note">${esc(d.energy.readiness_note)}</p>` : ""}
      ${w.psychologist_consult_offered ? `<p class="note">This has lasted several days. Would a conversation with the flight psychologist help? <button class="link-btn" type="button" data-psy>Ask for one</button></p>` : ""}
      <h3>${w.level >= 2 ? "Three that have helped before" : w.level === 1 ? "Want a short reset?" : "What helps you"}</h3>
      <div class="hub">${tools.map((t) => `<button type="button" data-tool="${esc(t)}" ${TOOL_SCREEN[t] ? "" : "disabled"}><strong>${esc(TOOL_NAME[t] || t)}</strong><span>${TOOL_SCREEN[t] ? "Mood before and after is logged" : "DESIGNED: not in this build"}</span></button>`).join("")}</div>
      ${w.level >= 2 ? `<p class="note">A chat with a crewmate often helps too. <button class="link-btn" type="button" data-tool="connection_nudge">Reach a crewmate</button></p>` : ""}
      <h3>Right now</h3>
      ${spike ? `<article class="card cl-card"><h3>${spike.res ? `Try ${esc(TOOL_NAME[spike.res.selected_tool] || "a breathing break")}` : "How strong is the stress?"}</h3>
          ${spike.res ? `<p class="note">I'll check back in about ${spike.res.recheck_in_minutes} minutes. Your choice; a "no" is fine.</p><div class="exam-nav">${spike.res.offered_tools.map((t) => `<button class="pill ${t === spike.res.selected_tool ? "pill-light" : "pill-ghost"}" type="button" data-tool="${esc(t)}">${esc(TOOL_NAME[t] || t)}</button>`).join("")}<button class="pill pill-ghost" type="button" data-nospike>Not now</button></div>`
            : `<p class="fine">1 mild to 5 very strong</p>${taps("spike", null)}`}</article>`
        : `<div class="exam-nav"><button class="pill pill-light" type="button" data-spike>I'm stressed</button><button class="pill pill-ghost" type="button" data-go="checkin">Rate mood and energy</button><button class="pill pill-ghost" type="button" data-go="journal">Private journal</button></div>`}
      <h3>Crew</h3>
      <p class="note">${esc(team?.note || team?.cohesion_note || "Talk-time balance appears here once the crew has been heard.")} <span class="fine">A gentle note, never a judgment.</span></p>
      <div class="exam-nav"><button class="pill pill-ghost" type="button" data-go="pulse">Crew pulse (2 questions)</button><button class="pill pill-ghost" type="button" data-go="profile">My wellbeing plan</button><button class="pill pill-ghost" type="button" data-go="wellbeing">Wellbeing hub</button></div>
      <p class="fine">Not therapy. If you ever feel unsafe, tell a crewmate now: Sentinel will alert your buddy and the commander.</p>`;
    el.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => openTool(b.dataset.tool)));
    el.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => ctx.screens.open(b.dataset.go)));
    el.querySelector("[data-spike]")?.addEventListener("click", () => { spike = {}; draw(); });
    el.querySelector("[data-nospike]")?.addEventListener("click", () => { spike = null; draw(); });
    el.querySelector("[data-psy]")?.addEventListener("click", async (e) => { e.currentTarget.disabled = true; await ctx.sendDigest?.("Requests a conversation with the flight psychologist"); });
    wireTaps(el, async (_, v) => {
      try {
        await ctx.patch({ manual: { stress_self: v, updated: new Date().toISOString() } });
        spike = { res: await api.wbSpike(cid, v, "orb_calm") };
        emit("support.offered", { type: "stress_spike", strength: v, crewId: cid });
      } catch { spike = null; }
      draw();
    });
  };
  draw();
  return () => { alive = false; };
}

// ================= the private journal (15.5): text stays on the device; the engine reads a count only =================
function renderJournal(el, ctx) {
  const cid = ctx.view.crewId;
  let alive = true, mood = null;
  const draw = async () => {
    let d;
    try { d = await api.journal(cid); } catch { if (alive) offline(el); return; }
    if (!alive) return;
    el.innerHTML = `<p class="note">For a hard day or a good one. Kept encrypted on this device only: it is never sent to ground, never put in a digest and never read by the anomaly engine, which sees only that an entry exists.</p>
      <div class="field"><label for="jr-text">Today</label><textarea id="jr-text" class="cl-text" rows="5" maxlength="4000" placeholder="Write, or tap the microphone on your keyboard to dictate."></textarea></div>
      <div class="pf-field"><span>Mood right now <span class="fine">optional</span></span>${taps("jm", mood)}</div>
      <p><button class="pill pill-dark" type="button" data-save>Save entry</button> <span class="note" data-msg aria-live="polite"></span></p>
      <h3>Earlier entries</h3>
      ${d.entries.length ? `<ul class="ground-list">${[...d.entries].reverse().map((e) => `<li class="card"><strong class="cl-pre">${esc(e.text)}</strong><small>${esc(when(e.timestamp))}${e.mood ? ` · mood ${e.mood}/5` : ""}</small>
        <span class="cl-acts"><button class="pill pill-ghost" type="button" data-del="${esc(e.id)}">Delete</button></span></li>`).join("")}</ul>` : `<p class="note">Nothing written yet.</p>`}`;
    wireTaps(el, (_, v) => { mood = v; });
    el.querySelector("[data-save]").addEventListener("click", async () => {
      const text = el.querySelector("#jr-text").value.trim();
      if (!text) { el.querySelector("#jr-text").focus(); return; }
      try { await api.journalAdd(cid, { text, mood }); mood = null; draw(); } catch (e) { el.querySelector("[data-msg]").textContent = `Not saved: ${e.message}`; }
    });
    el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; return; }
      try { await api.journalDel(cid, b.dataset.del); } catch { /* shown on redraw */ }
      draw();
    }));
  };
  draw();
  return () => { alive = false; };
}
