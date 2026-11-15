// The clinic model on screen (Product Document parts 4 and 5): a day with Sentinel, the guided daily check-in,
// environment and mode, first run, the saved record and the personal baseline, the weekly review, one
// reading in detail, and the alert list with "Why this?". Every screen opens in the existing side sheet and
// is built from the components the rest of the app uses (cards, pills, chips, the mood row, the measures list).
// Sentinel supports and explains; it does not diagnose. Mission emergency procedures always come first.
import { api } from "../core/api.js";
import { emit } from "../core/bus.js";
import { pollOnce } from "../core/state.js";
import { FIELD_LABELS, badgeHTML, esc, fmt, statusHTML, statusIcon, statusKey } from "../interface/readings.js";

// ---------- shared helpers (also used by care.js) ----------
export const offline = (el) => { el.innerHTML = `<p class="note">The brain is offline. Check the link at the top right.</p>`; };
export const when = (t) => new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
/** A row of large number buttons (no sliders: usable with gloves). */
export const taps = (name, cur, to = 5, from = 1) => `<div class="mood-row${to - from > 5 ? " cl-wrap" : ""}" data-taps="${name}">${
  Array.from({ length: to - from + 1 }, (_, i) => i + from).map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${v}</button>`).join("")}</div>`;
export function wireTaps(el, onPick) {
  el.querySelectorAll("[data-taps]").forEach((g) => g.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => {
    g.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    onPick(g.dataset.taps, Number(b.dataset.v));
  })));
}
export const LEVEL = { 0: ["Normal", "ok"], 1: ["Watch", "watch"], 2: ["Act", "watch"], 3: ["Urgent", "alert"] };
/** Level as icon plus word (never colour alone): Normal, Watch, Act, Urgent. */
export const levelChip = (n) => `<span class="st-cell st-${LEVEL[n]?.[1] || "ok"}">${statusIcon(n >= 3 ? "alert" : n >= 1 ? "watch" : "ok")}<span class="st-word">${esc(LEVEL[n]?.[0] || "Normal")}</span></span>`;
const fieldName = (f) => FIELD_LABELS[f]?.[0] || f.split(".").pop().replace(/_/g, " ");
const fieldUnit = (f) => FIELD_LABELS[f]?.[1] || "";
const go = (ctx, name, arg) => ctx.screens.open(name, arg);

export const MOOD_TAGS = ["tired", "irritable", "anxious", "lonely", "motivated"];

export function registerClinic(registerScreen) {
  registerScreen("today", { title: "Today with Sentinel", render: renderToday });
  registerScreen("checkin", { title: "Daily check-in", badge: "LIVE", render: renderCheckin });
  registerScreen("environment", { title: "Environment and mode", render: renderEnvironment });
  registerScreen("onboarding", { title: "First run", render: renderOnboarding });
  registerScreen("record", { title: "My saved record", render: renderRecord });
  registerScreen("weekly", { title: "Weekly review", render: renderWeekly });
  registerScreen("indicator", { title: "Reading", render: renderIndicator });
  registerScreen("alerts", { title: "Alerts", render: renderAlerts });
  registerScreen("kit", { title: "Medical kit", badge: "SIM", render: renderKit });
  registerScreen("datasets", { title: "NASA research datasets", badge: "NLSP", render: renderDatasets });
}

// ================= a day with Sentinel (12.1, 12.2) and today's reminders (section 20) =================
const REMINDER_OPEN = { checkin: "checkin", measurement: "health_log", hydration: "health_log", mood: "mind", recheck: "care", treatment_timer: "care", kit_check: "kit" };
const STATE_WORD = { scheduled: "later today", due: "due now", done: "done", snoozed: "snoozed", missed: "missed", past: "not done" };

function renderToday(el, ctx, arg) {
  const cid = ctx.view.crewId;
  let alive = true, openQuick = typeof arg === "string" ? arg : "", msg = "";
  const pick = { sleep: null, mood: null, minutes: null, wmood: null };
  const draw = async () => {
    let c, p;
    try { await api.planTick(cid).catch(() => {}); [c, p] = await Promise.all([api.clinic(cid), api.plan(cid)]); } catch { if (alive) offline(el); return; }
    if (!alive) return;
    const o = c.ops || {}, b = c.day_block || {}, m = c.clinical_mode_info || {};
    const main = { morning_checkin: ["Start the daily check-in", "checkin"], wake: ["Log sleep and mood", "#wake"], exercise: ["Log the exercise session", "#exercise"],
      evening_winddown: ["Start the wind-down", "#winddown"], night_sleep: ["Start rest mode", "!rest"], eva_sortie: ["EVA readiness check", "!eva"],
      symptom_triage: ["Start triage", "care"] }[b.id] || ["Daily check-in", "checkin"];
    const rems = p.today_reminders || [];
    el.innerHTML = `
      <article class="card cl-card">
        <span class="label">Now · ${esc(b.label || "Routine")}${b.context ? ` · ${esc(b.context)}` : ""}</span>
        <h3>${esc(m.title || c.clinical_mode)} mode</h3>
        <p class="note">${esc(m.description || "")}</p>
        ${b.description ? `<p>${esc(b.description)}</p>` : ""}
        <div class="exam-nav"><button class="pill pill-light" type="button" data-main="${main[1]}">${esc(main[0])}</button><button class="pill pill-ghost" type="button" data-open="care">I don't feel well</button></div>
        <p class="note" data-eva></p>
      </article>
      <p class="fine">Environment: <strong>${esc(o.env || "")}</strong> · mode: <strong>${esc(o.mode || "routine")}</strong>${o.reminders_paused ? " · routine reminders paused" : ""}. ${esc(o.comms?.note || "")}
        Escalation: ${esc(o.escalation_policy || "")}. <button class="link-btn" type="button" data-open="environment">Change</button></p>
      <h3>Quick logs</h3>
      <details class="more" data-q="wake"${openQuick === "wake" ? " open" : ""}><summary>Wake: hours slept and mood (two taps)</summary>
        <p class="fine">Hours slept</p><div class="mood-row cl-wrap" data-taps="sleep">${[4, 5, 6, 6.5, 7, 7.5, 8, 9].map((v) => `<button type="button" data-v="${v}" aria-pressed="${pick.sleep === v}">${v}</button>`).join("")}</div>
        <p class="fine">Mood, 1 low to 5 good</p>${taps("mood", pick.mood)}
        <p><button class="pill pill-dark" type="button" data-save="wake">Save</button></p></details>
      <details class="more" data-q="exercise"${openQuick === "exercise" ? " open" : ""}><summary>Exercise session</summary>
        <p class="fine">Active minutes. For the next half hour a raised pulse and breathing rate are expected and not flagged.</p>
        <div class="mood-row cl-wrap" data-taps="minutes">${[15, 30, 45, 60, 90, 120].map((v) => `<button type="button" data-v="${v}" aria-pressed="${pick.minutes === v}">${v}</button>`).join("")}</div>
        <p><button class="pill pill-dark" type="button" data-save="exercise">Save</button></p></details>
      <details class="more" data-q="winddown"${openQuick === "winddown" ? " open" : ""}><summary>Evening wind-down and mood check</summary>
        <p class="fine">Mood this evening, 1 low to 5 good</p>${taps("wmood", pick.wmood)}
        <p><button class="pill pill-dark" type="button" data-save="winddown">Save</button></p></details>
      <p class="note" data-msg aria-live="polite">${esc(msg)}</p>
      <h3>Today's reminders <span class="fine">${esc(p.template_title || "")} · sleep block ${esc(p.sleep_block || "")}</span></h3>
      ${p.has_conflicts ? `<p class="note"><strong>Conflicts:</strong> ${p.conflicts.map((x) => esc(x.description || `${x.title || "A reminder"} falls in the sleep block`)).join("; ")}</p>` : ""}
      <ul class="measures">${rems.map((r) => {
        const act = r.type !== "duty" && r.state !== "done";
        const opn = REMINDER_OPEN[r.type] || (r.type === "exercise" ? "#exercise" : r.type === "sleep_winddown" ? "#winddown" : "");
        return `<li class="card ${r.state === "done" ? "is-done" : ""}"><span class="m-check">${r.state === "done" ? "✓" : ""}</span>
          <span class="m-label">${esc(r.title)}<small><span class="num">${esc(r.time || "")}</span> · ${esc(STATE_WORD[r.state] || r.state)}${r.snooze_count ? ` · snoozed ${r.snooze_count}×` : ""}${r.type === "recheck" || r.type === "treatment_timer" ? " · from a protocol" : ""}</small></span>
          <span class="cl-acts">${act && opn ? `<button class="pill pill-ghost" type="button" data-ropen="${opn}">Open</button>` : ""}${act ? `<button class="pill pill-ghost" type="button" data-done="${esc(r.id)}">Done</button>` : ""}${act && (r.state === "due" || r.state === "snoozed") && (r.snooze_count || 0) < 2 ? `<button class="pill pill-ghost" type="button" data-snooze="${esc(r.id)}">Snooze</button>` : ""}</span></li>`;
      }).join("")}</ul>
      <details class="more"><summary>Add a reminder</summary>
        <label class="pf-field"><span>What</span><input type="text" data-rt maxlength="80" placeholder="e.g. Blood pressure recheck"></label>
        <label class="pf-field"><span>When (mission time)</span><input type="time" data-rw value="15:00"></label>
        <p><button class="pill pill-dark" type="button" data-add>Add</button></p></details>
      <div class="exam-nav"><button class="pill pill-ghost" type="button" data-open="weekly">Weekly review</button><button class="pill pill-ghost" type="button" data-open="alerts">Alerts</button><button class="pill pill-ghost" type="button" data-open="record">My saved record</button></div>`;
    wireTaps(el, (k, v) => { pick[k] = v; });
    el.querySelectorAll("[data-open]").forEach((x) => x.addEventListener("click", () => go(ctx, x.dataset.open)));
    const quick = (k) => { openQuick = k; const d = el.querySelector(`[data-q="${k}"]`); if (d) { d.open = true; d.scrollIntoView({ block: "center", behavior: "smooth" }); } };
    const target = (t) => { if (t.startsWith("#")) quick(t.slice(1)); else go(ctx, t); };
    el.querySelector("[data-main]").addEventListener("click", async (e) => {
      const t = e.currentTarget.dataset.main;
      if (t === "!rest") { await ctx.setMode?.("rest"); msg = "Rest mode: only urgent and cabin alerts will reach you."; return draw(); }
      if (t === "!eva") {
        try {
          const r = (await api.clinicBlock(cid, { block: "eva_sortie" })).readiness || {};
          el.querySelector("[data-eva]").innerHTML = `<strong>${r.ready ? "Ready for the EVA." : "Not ready: check these first."}</strong> ${badgeHTML("SIM")}<br>${(r.items || []).map((i) => `${i.ok ? "✓" : "!"} ${esc(i.check)}: ${esc(i.detail)}`).join("<br>")}`;
        } catch (err) { el.querySelector("[data-eva]").textContent = err.message; }
        return;
      }
      target(t);
    });
    el.querySelectorAll("[data-ropen]").forEach((x) => x.addEventListener("click", () => target(x.dataset.ropen)));
    el.querySelectorAll("[data-done]").forEach((x) => x.addEventListener("click", async () => { try { await api.planDone(cid, x.dataset.done); ctx.routineDone?.(x.dataset.done); msg = "Marked done."; } catch (e) { msg = e.message; } draw(); }));
    el.querySelectorAll("[data-snooze]").forEach((x) => x.addEventListener("click", async () => { try { await api.planSnooze(cid, x.dataset.snooze, 15); msg = "Snoozed for 15 minutes."; } catch (e) { msg = e.message; } draw(); }));
    el.querySelector("[data-add]").addEventListener("click", async () => {
      const title = el.querySelector("[data-rt]").value.trim();
      if (!title) { el.querySelector("[data-rt]").focus(); return; }
      try { await api.planAdd(cid, { title, time: el.querySelector("[data-rw]").value || "12:00", type: "measurement" }); msg = "Reminder added."; } catch (e) { msg = e.message; }
      draw();
    });
    el.querySelectorAll("[data-save]").forEach((x) => x.addEventListener("click", async () => {
      const k = x.dataset.save;
      try {
        if (k === "wake") {
          if (pick.sleep == null || pick.mood == null) { msg = "Tap the hours slept and your mood."; return draw(); }
          const r = await api.clinicBlock(cid, { block: "wake", sleep_hours: pick.sleep, mood: pick.mood });
          emit("reading.added", { indicator: "sleep_hours", value: pick.sleep, source: "manual", label: "MANUAL", confidence: 1 });
          msg = `${r.summary} Saved to your record.`; ctx.onCheckin?.("log", { sleep_hours: pick.sleep });
        } else if (k === "exercise") {
          if (pick.minutes == null) { msg = "Tap the minutes."; return draw(); }
          const r = await api.clinicBlock(cid, { block: "exercise", minutes: pick.minutes });
          msg = `${r.summary} Saved to your record.`; ctx.onCheckin?.("exercise", { exercise_minutes: pick.minutes });
        } else {
          const r = await api.clinicBlock(cid, { block: "evening_winddown", mood: pick.wmood });
          msg = r.recommendation || "Wind-down logged.";
          if (r.calm_recommended) { msg += " Stillpoint is a good fit tonight."; setTimeout(() => ctx.say?.("Your stress is up this evening. Want to try Stillpoint before sleep?", { source: "local" }), 0); }
        }
        openQuick = ""; pollOnce();
      } catch (e) { msg = `Not saved: ${e.message}`; }
      draw();
    }));
  };
  draw();
  return () => { alive = false; };
}

// ================= the guided daily check-in (W2): scan, typed entries, taps, reaction test, summary =================
const CK_STEPS = ["Scan", "Entries", "Mood and energy", "Reaction", "Summary"];
const CK_VITALS = [["heart_rate", "Heart rate", "bpm", 30, 220], ["breathing_rate", "Breathing rate", "/min", 4, 60], ["spo2", "SpO2", "%", 70, 100]];
const CK_MANUAL = [["bp_systolic", "Systolic pressure", "mmHg", 60, 250], ["bp_diastolic", "Diastolic pressure", "mmHg", 30, 150], ["glucose_mgdl", "Blood glucose", "mg/dL", 20, 600],
  ["temp_c", "Temperature", "°C", 33, 43], ["sleep_hours", "Sleep last night", "hours", 0, 16]];
const CK_TAPS = [["mood", "Mood", "1 low to 5 good"], ["energy_self", "Energy", "1 drained to 5 full"], ["stress_self", "Stress", "1 calm to 5 very stressed"], ["connection_self", "Connection with the crew", "1 distant to 5 close"]];

function renderCheckin(el, ctx) {
  const cid = ctx.view.crewId, key = `sentinel:checkin:${cid}`;
  let alive = true;
  // resumable: an interrupted check-in (the camera, the reaction test, a call) picks up where it stopped
  let st = { i: 0, vit: {}, man: {}, tap: {}, tags: [], t0: Date.now() };
  try { const saved = JSON.parse(sessionStorage.getItem(key) || "null"); if (saved && Date.now() - saved.t0 < 3600e3) st = saved; } catch { /* storage blocked */ }
  const keep = () => { try { sessionStorage.setItem(key, JSON.stringify(st)); } catch { /* storage blocked */ } };
  emit("checkin.started", { crewId: cid });
  const numRow = (group, [k, label, unit, min, max], cur) => `<label>${esc(label)} <input type="number" inputmode="decimal" step="any" min="${min}" max="${max}" data-g="${group}" data-k="${k}" value="${cur ?? ""}"> <span class="fine">${esc(unit)}</span></label>`;
  const collect = () => {
    let bad = "";
    el.querySelectorAll("input[data-g]").forEach((inp) => {
      const tgt = st[inp.dataset.g], raw = inp.value.trim();
      if (raw === "") { delete tgt[inp.dataset.k]; return; }
      const v = Number(raw);
      if (!Number.isFinite(v) || v < Number(inp.min) || v > Number(inp.max)) { bad = `${inp.closest("label").textContent.trim().split("  ")[0]}: enter a value between ${inp.min} and ${inp.max}, or remeasure.`; return; }
      tgt[inp.dataset.k] = v;
    });
    if (!bad && st.man.bp_systolic != null && st.man.bp_diastolic != null && st.man.bp_diastolic >= st.man.bp_systolic) bad = "Diastolic must be lower than systolic. Remeasure if unsure.";
    return bad;
  };
  const draw = () => {
    if (!alive) return;
    const s = ctx.view.state || {}, i = st.i;
    const head = `<p class="fine">About two minutes. Everything you enter is saved to your record and compared with your own usual values. Not a diagnosis.</p>
      <ol class="exam-steps">${CK_STEPS.map((t, n) => `<li class="${n < i ? "is-done" : n === i ? "is-now" : ""}">${esc(t)}</li>`).join("")}</ol>`;
    const nav = (next = "Next") => `<p class="note" data-err aria-live="polite"></p><div class="exam-nav"><button class="pill pill-ghost" type="button" data-back ${i ? "" : "disabled"}>Back</button><button class="pill pill-light" type="button" data-next>${next}</button></div>`;
    if (i === 0) {
      const src = s.vitals?.sources?.heart_rate, live = src === "camera" || src === "sensor";
      el.innerHTML = `${head}<section class="exam-step card"><h3>1. Scan</h3>
        <p class="exam-big"><strong class="num">${s.vitals?.heart_rate != null ? Math.round(s.vitals.heart_rate) : "—"}</strong> bpm ${badgeHTML(live ? "LIVE" : src === "manual" ? "MANUAL" : "SIM")}${ctx.view.aux?.extras?.hr_estimate ? ` <span class="fine">low confidence: shown as an estimate</span>` : ""}</p>
        <button class="pill pill-ghost" type="button" data-cam>Measure with the camera (30 seconds)</button>
        <p class="fine">Camera not available, or you have a device reading? Type it here instead.</p>
        <div class="exam-inputs">${CK_VITALS.map((f) => numRow("vit", f, st.vit[f[0]])).join("")}</div></section>${nav()}`;
      el.querySelector("[data-cam]").addEventListener("click", () => { collect(); keep(); ctx.screens.open("vision"); ctx.showNotice?.("Check-in paused. Open Daily check-in again to carry on."); });
    } else if (i === 1) {
      el.innerHTML = `${head}<section class="exam-step card"><h3>2. Typed entries</h3><p class="note">From the cuff, the meter and the thermometer. Leave blank what you did not measure.</p>
        <div class="exam-inputs">${CK_MANUAL.map((f) => numRow("man", f, st.man[f[0]])).join("")}</div></section>${nav()}`;
    } else if (i === 2) {
      el.innerHTML = `${head}<section class="exam-step card"><h3>3. Mood and energy</h3>
        ${CK_TAPS.map(([k, label, hint]) => `<div class="pf-field"><span>${esc(label)} <span class="fine">${esc(hint)}</span></span>${taps(k, st.tap[k])}</div>`).join("")}
        <div class="pf-field"><span>Anything that fits today? <span class="fine">optional, for context only</span></span><div class="pf-tools">${MOOD_TAGS.map((t) => `<button type="button" data-tag="${t}" aria-pressed="${st.tags.includes(t)}">${t}</button>`).join("")}</div></div></section>${nav()}`;
      wireTaps(el, (k, v) => { st.tap[k] = v; keep(); });
      el.querySelectorAll("[data-tag]").forEach((b) => b.addEventListener("click", () => {
        const t = b.dataset.tag, n = st.tags.indexOf(t);
        if (n >= 0) st.tags.splice(n, 1); else st.tags.push(t);
        b.setAttribute("aria-pressed", String(n < 0)); keep();
      }));
    } else if (i === 3) {
      const c = s.cognitive || {};
      el.innerHTML = `${head}<section class="exam-step card"><h3>4. Reaction test</h3>
        <p class="exam-big"><strong class="num">${c.reaction_ms ?? "—"}</strong> ms <span class="fine">your usual ${c.baseline_ms ?? "—"} ms</span></p>
        <button class="pill pill-ghost" type="button" data-rt>Run the reaction test now</button>
        <p class="fine">Skip it if you have run it today; the last result is used.</p></section>${nav("Finish")}`;
      el.querySelector("[data-rt]").addEventListener("click", () => { keep(); ctx.screens.open("cognitive"); ctx.showNotice?.("Check-in paused. Open Daily check-in again to finish."); });
    }
    el.querySelector("[data-back]")?.addEventListener("click", () => { collect(); st.i = Math.max(0, i - 1); keep(); draw(); });
    el.querySelector("[data-next]")?.addEventListener("click", () => {
      const bad = collect();
      if (bad) { el.querySelector("[data-err]").textContent = bad; return; }
      st.i = i + 1; keep();
      if (st.i === 4) finish(); else draw();
    });
  };
  async function finish() {
    el.innerHTML = `<p class="note">Saving your check-in…</p>`;
    try {
      const patch = {};
      if (Object.keys(st.vit).length) patch.vitals = { ...st.vit, sources: Object.fromEntries(Object.keys(st.vit).map((k) => [k, "manual"])) };
      const man = { ...st.man, ...st.tap };
      if (Object.keys(man).length || st.tags.length) patch.manual = { ...man, mood_tags: st.tags, updated: new Date().toISOString() };
      if (Object.keys(patch).length) await ctx.patch(patch);
      for (const [k, v] of Object.entries({ ...st.vit, ...man })) emit("reading.added", { indicator: k, value: v, source: "manual", label: "MANUAL", confidence: 1 });
      const r = await api.checkin(cid, {});
      ctx.onCheckin?.("vitals", st.man);
      api.planDone(cid, "rem_checkin").catch(() => {});
      try { sessionStorage.removeItem(key); } catch { /* storage blocked */ }
      await pollOnce();
      if (!alive) return;
      const s = ctx.view.state || {}, abs = ctx.view.aux?.assessment?.absolute || [];
      const drift = Object.fromEntries((s.drift?.items || []).map((d) => [d.metric, d]));
      const rows = abs.filter((a) => a.value != null).map((a) => {
        const sev = a.severity !== "ok" ? a.severity : drift[a.metric]?.severity || "ok";
        return `<tr><td>${esc(a.label)}</td><td class="num"><strong>${esc(fmt(a.value, a.metric))}</strong> ${esc(a.unit || "")}</td><td class="st-cell st-${statusKey(sev)}">${statusHTML(sev)}</td></tr>`;
      }).join("");
      const flagged = s.action?.type && s.action.type !== "none";
      const n = Object.keys(st.vit).length + Object.keys(man).length;
      el.innerHTML = `<ol class="exam-steps">${CK_STEPS.map((t) => `<li class="is-done">${esc(t)}</li>`).join("")}</ol>
        <article class="card cl-card"><span class="label">Check-in complete ${badgeHTML("LIVE")}</span>
          <h3>${esc(flagged ? s.action.detail : "You're steady. Ready for the day.")}</h3>
          <p class="note">${n} entr${n === 1 ? "y" : "ies"} saved to your record. Baseline: ${esc(r.calibration_status || "calibrating")}.</p></article>
        <table class="readings"><thead><tr><th>Reading</th><th>Value</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
        ${r.next_question_prompt ? (PROFILE_PATH[r.next_question]
          ? `<div class="field"><label for="ck-pq">One profile question: ${esc(r.next_question_prompt)}</label><input id="ck-pq" type="text" placeholder="Answer, or leave it for later">
             <p><button class="pill pill-ghost" type="button" data-pq>Save answer</button> <span class="note" data-pqmsg aria-live="polite"></span></p></div>`
          : `<p class="note">One profile question when you have a moment: ${esc(r.next_question_prompt)} <button class="link-btn" type="button" data-open="profile">Answer</button></p>`) : ""}
        <div class="exam-nav">${flagged ? `<button class="pill pill-light" type="button" data-open="alerts">See what to do</button>` : ""}<button class="pill pill-ghost" type="button" data-open="record">My saved record</button><button class="pill ${flagged ? "pill-ghost" : "pill-light"}" type="button" data-close>Done</button></div>`;
      el.querySelectorAll("[data-open]").forEach((x) => x.addEventListener("click", () => go(ctx, x.dataset.open)));
      el.querySelector("[data-close]").addEventListener("click", () => ctx.screens.close());
      el.querySelector("[data-pq]")?.addEventListener("click", async () => {
        const v = el.querySelector("#ck-pq").value.trim(), [path, isList] = PROFILE_PATH[r.next_question];
        if (!v) { el.querySelector("#ck-pq").focus(); return; }
        const patch = {}; let o = patch;
        path.split(".").slice(0, -1).forEach((k) => { o = o[k] = {}; });
        o[path.split(".").at(-1)] = isList ? v.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : v;
        try { const np = await api.profileUpdate(cid, patch); ctx.view.profile = np; el.querySelector("[data-pqmsg]").textContent = `Saved. Profile ${Math.round(np.completeness * 100)}% complete.`; el.querySelector("[data-pq]").disabled = true; }
        catch (e) { el.querySelector("[data-pqmsg]").textContent = `Not saved: ${e.message}`; }
      });
      ctx.say?.(flagged ? `Check-in saved. ${s.action.detail}` : "Check-in saved. You're steady.", { source: "local" });
    } catch (e) {
      st.i = 3; keep();
      el.innerHTML = `<p class="note">Not saved: ${esc(e.message)}. Your answers are kept on this screen. <button class="link-btn" type="button" data-retry>Try again</button></p>`;
      el.querySelector("[data-retry]").addEventListener("click", draw);
    }
  }
  if (st.i >= 4) st.i = 3;
  draw();
  return () => { alive = false; };
}

/** The profile question asked at a check-in -> where its answer is stored (and whether it is a list). */
const PROFILE_PATH = { "Name or callsign": ["callsign", false], "Duty and sleep schedule": ["mission.dutySchedule", false], "Allergies": ["health.allergies", true],
  "Ongoing conditions": ["health.conditions", true], "Regular medicines": ["health.regularMedicines", true], "Past reactions to kit items": ["health.pastKitReactions", true],
  "My early signs": ["wellbeingPlan.earlySigns", true], "Who I would talk to": ["wellbeingPlan.whoToTalkTo", false] };

// ================= environment and mode (section 13, W8): always confirm before switching =================
async function renderEnvironment(el, ctx) {
  const cid = ctx.view.crewId;
  let data;
  try { data = await api.envProfiles(); } catch { offline(el); return; }
  let pending = null, done = null;
  const draw = () => {
    const o = ctx.view.aux?.ops || {}, x = ctx.view.aux?.extras || {};
    const envs = Object.entries(data.environments || {});
    el.innerHTML = `<p class="note">Where you are changes the ranges, the kit, the reminders and how fast Sentinel brings in ground. It never switches on its own, and it asks before it does.</p>
      ${x.settling_in ? `<p class="note"><strong>Settling in:</strong> ${x.settling_days_left} day${x.settling_days_left === 1 ? "" : "s"} left. Small changes from your usual are treated as adjusting; air, range limits and red flags still alert at full strength.</p>` : ""}
      ${done ? `<article class="card cl-card"><span class="label">Switched</span><h3>${esc(done.environment || done.to)}</h3><ul class="note">${(done.changes || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul></article>` : ""}
      <h3>Environment</h3>
      <div class="hub">${envs.map(([k, e]) => `<button type="button" data-env="${esc(k)}" aria-pressed="${o.env === k || o.env === e.id}"><strong>${esc(e.label || k)}${o.env === k ? " · now" : ""}</strong><span>${esc(e.in_plain_words || "")}</span>
        <span>Watches harder: ${esc(e.watches_harder || "")}</span><span>${esc(e.escalation_policy?.default_escalation || "")}${e.escalation_policy?.wait_tolerance_min != null ? ` · can wait about ${e.escalation_policy.wait_tolerance_min} min for ground (SIM)` : ""}</span></button>`).join("")}</div>
      ${pending ? `<article class="card cl-card" data-confirm><h3>Switch to ${esc(pending.label)}?</h3><p class="note">Ranges, kit, reminders and what I advise will update. No answer means no change.</p>
        <div class="exam-nav"><button class="pill pill-light" type="button" data-yes>Yes, switch</button><button class="pill pill-ghost" type="button" data-no>No</button></div></article>` : ""}
      <h3>Mode</h3>
      <div class="hub">${Object.entries(data.modes || {}).map(([k, m]) => `<button type="button" data-mode="${esc(k)}"><strong>${esc(m.label || k)}${o.mode === k ? " · now" : ""}</strong><span>${esc(typeof m === "string" ? m : m.changes || m.what_changes || m.description || "")}</span></button>`).join("")}</div>
      <p class="fine">Delay and wait-tolerance numbers are labelled SIM values for the demo; real ones come from mission documents.</p><p class="note" data-msg aria-live="polite"></p>`;
    el.querySelectorAll("[data-env]").forEach((b) => b.addEventListener("click", () => {
      const e = data.environments[b.dataset.env];
      pending = { key: b.dataset.env, label: e.label || b.dataset.env, profile: e.profile }; done = null; draw();
      el.querySelector("[data-confirm]")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }));
    el.querySelector("[data-no]")?.addEventListener("click", () => { pending = null; draw(); });
    el.querySelector("[data-yes]")?.addEventListener("click", async () => {
      try { done = await api.envSet(cid, { profile: pending.profile }); pending = null; await pollOnce(); ctx.say?.(`Done. For the next ${done.settling_days_left || 3} days I'll treat small changes as you settling in, and I'll still alert on air and safety limits.`, { source: "local" }); }
      catch (e) { pending = null; done = null; draw(); el.querySelector("[data-msg]").textContent = e.message; return; }
      draw();
    });
    el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", async () => {
      const k = b.dataset.mode;
      if (k === "eva") await ctx.suitCommand?.({ action: "eva" }); else { if (o.mode === "eva") await ctx.suitCommand?.({ action: "iva" }); await ctx.setMode?.(k); }
      await pollOnce(); draw();
    }));
  };
  draw();
}

// ================= first run and calibration (W1): resumable =================
const OB_OPEN = { consent: ["Review what is tracked and who sees it", "profile"], kit_confirm: ["See the kit list", "kit"], voice_enroll: ["Choose crew and enrol a voice", "crew"], baseline_calib: ["Do the first check-in", "checkin"] };
async function renderOnboarding(el, ctx) {
  const cid = ctx.view.crewId;
  const draw = async () => {
    let o, p;
    try { [o, p] = await Promise.all([api.onboarding(cid), api.profile(cid)]); } catch { offline(el); return; }
    const done = new Set(o.completed_steps || []);
    el.innerHTML = `<p class="note">A few short steps, in any order, and you can stop and come back. Sentinel tracks only what changes a status, a recommendation or a reminder. Your health background stays on this device unless you choose to share it.</p>
      <div class="measures-progress"><div style="width:${(done.size / o.steps.length) * 100}%"></div></div>
      <p class="fine">${done.size} of ${o.steps.length} done · profile ${Math.round((p.completeness || 0) * 100)}% · ${esc(p.calibration?.status_text || "")}</p>
      <ul class="measures">${o.steps.map((s) => `<li class="card ${done.has(s.id) ? "is-done" : ""}"><span class="m-check">${done.has(s.id) ? "✓" : ""}</span>
        <span class="m-label">${esc(s.title)}<small>${s.required ? "needed" : "optional"}${o.resumable_step === s.id ? " · next" : ""}</small></span>
        <span class="cl-acts"><button class="pill pill-ghost" type="button" data-go="${OB_OPEN[s.id]?.[1] || "profile"}">${esc(OB_OPEN[s.id]?.[0] || "Open")}</button>${done.has(s.id) ? "" : `<button class="pill pill-ghost" type="button" data-step="${esc(s.id)}">${s.id === "consent" ? "I agree" : "Done"}</button>`}</span></li>`).join("")}</ul>
      <div class="exam-nav"><button class="pill pill-ghost" type="button" data-go="environment">Choose the environment</button><button class="pill pill-ghost" type="button" data-go="profile">My health profile</button></div>
      ${p.onboarding?.preloaded && !p.onboarding?.confirmed ? `<article class="card cl-card"><span class="label">Preloaded for you</span><h3>Your profile was filled in by ${esc(String(p.onboarding.preloadedBy || "the flight surgeon").replace(/_/g, " "))}</h3>
        <p class="note">Look it over in My health profile, change anything that is wrong, then confirm it is yours.</p><div class="exam-nav"><button class="pill pill-light" type="button" data-confirm>Confirm it</button></div></article>` : ""}
      ${o.completed ? `<p class="note"><strong>Setup complete.</strong> Baselines finish calibrating over the first week of check-ins.</p>` : ""}`;
    el.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(ctx, b.dataset.go)));
    el.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", async () => { try { await api.onboardingStep(cid, b.dataset.step); } catch { /* shown on redraw */ } draw(); }));
    el.querySelector("[data-confirm]")?.addEventListener("click", async () => { try { await api.profileConfirm(cid); } catch { /* shown on redraw */ } draw(); });
  };
  draw();
}

// ================= my saved record and the personal baseline (17, 19.2) =================
async function renderRecord(el, ctx) {
  const cid = ctx.view.crewId;
  let msg = "";
  const draw = async () => {
    let r, b, sc = { scans: [] };
    try { [r, b] = await Promise.all([api.record(cid), api.baselines(cid)]); } catch { offline(el); return; }
    try { sc = await api.scans(cid); } catch { /* optional */ }
    const fields = Object.entries(r.fields).filter(([f]) => !f.startsWith("session.") && !f.startsWith("state.")).sort((a, z) => z[1].entered - a[1].entered || a[0].localeCompare(z[0]));
    const total = fields.reduce((n, [, v]) => n + v.entered, 0);
    el.innerHTML = `<p class="note">Everything you type, tap or measure is stored on this device (${esc(r.file)}) and survives a restart. Counts below: readings you entered or Sentinel measured, out of all stored points (the rest is the SIM history that seeds the charts).</p>
      <article class="card cl-card"><span class="label">Stored for you</span><h3><span class="num">${total}</span> entered or measured reading${total === 1 ? "" : "s"}</h3>
        <p class="note">${r.symptoms.length} symptom${r.symptoms.length === 1 ? "" : "s"} in the log${Object.keys(r.records).length ? ` · ${Object.entries(r.records).map(([k, n]) => `${n} ${esc(k.replace(/_/g, " "))}`).join(" · ")}` : ""}${r.persisted ? "" : " · this run is not saving to disk (test mode)"}</p></article>
      <table class="readings"><thead><tr><th>Reading</th><th>Latest</th><th>Entered</th><th>My normal</th><th>Model</th></tr></thead><tbody>${fields.map(([f, v]) => {
        const m = b.indicators[f];
        return `<tr data-f="${esc(f)}" class="cl-rowlink"><td>${esc(fieldName(f))}</td><td class="num"><strong>${esc(fmt(v.last, f))}</strong> ${esc(fieldUnit(f))} ${badgeHTML(v.last_label === "MANUAL" ? "MANUAL" : v.last_label)}<br><span class="fine">${esc(when(v.last_t))}</span></td>
          <td class="num">${v.entered} of ${v.count}</td><td class="num">${m ? `${esc(fmt(m.median, f))} ± ${esc(fmt(m.spread, f))}` : "—"}</td><td class="fine">${esc(m?.stage || "—")}</td></tr>`;
      }).join("")}</tbody></table>
      <h3>Scans</h3>
      ${sc.scans.length ? `<ul class="note">${sc.scans.slice(0, 8).map((x) => `<li>${esc(when(x.t))}: ${x.kind === "body" ? `full body scan, ${x.zones_flagged?.length ? `flagged ${esc(x.zones_flagged.join(", "))}` : "nothing flagged"}`
        : `face scan (${x.seconds || 15} s)${x.heart_rate != null ? `, pulse ${x.heart_rate} bpm at ${Math.round((x.confidence || 0) * 100)}% quality` : ""}${x.breathing_rate != null ? `, breathing ${x.breathing_rate}/min` : ""}${x.emotion ? `, expression ${esc(x.emotion)}` : ""}`} ${badgeHTML(x.label || "LIVE")}</li>`).join("")}</ul>`
        : `<p class="note">No scan saved yet. The face scan runs for 15 seconds and saves its result here; a full body scan is kept too.</p>`}
      <h3>How Sentinel learns your normal</h3>
      <p class="note">${esc(b.method)}. Post-exercise and low-confidence readings are left out. ${esc(b.note)} It only moves your personal baseline: range limits, cabin air and red flags never change.</p>
      <div class="exam-nav"><button class="pill pill-light" type="button" data-learn>Re-learn my normal from my record</button><button class="pill pill-ghost" type="button" data-open="health_log">Add readings</button><button class="pill pill-ghost" type="button" data-open="trends">Trends</button></div>
      <p class="note" data-msg aria-live="polite">${esc(msg)}${b.learned_at ? ` Last learned ${esc(when(b.learned_at))}.` : ""}</p>`;
    el.querySelectorAll("[data-open]").forEach((x) => x.addEventListener("click", () => go(ctx, x.dataset.open)));
    el.querySelectorAll("[data-f]").forEach((x) => x.addEventListener("click", () => go(ctx, "indicator", x.dataset.f)));
    el.querySelector("[data-learn]").addEventListener("click", async () => {
      try {
        const out = await api.baselinesLearn(cid);
        const ch = Object.entries(out.applied);
        msg = ch.length ? `Updated: ${ch.map(([k, v]) => `${k.replace(/_/g, " ")} ${v.from} → ${v.to}`).join("; ")}.` : "Nothing to update yet: baselines need at least seven usable readings.";
        pollOnce();
      } catch (e) { msg = e.message; }
      draw();
    });
  };
  draw();
}

// ================= weekly review (W9): the astronaut chooses what to share =================
async function renderWeekly(el, ctx) {
  const cid = ctx.view.crewId;
  let w, t, log;
  try { [w, t, log] = await Promise.all([api.weekly(cid), api.trendsAll(cid, 7), api.careLog(cid)]); } catch { offline(el); return; }
  const names = { sleep: ["Sleep", "h"], heart_rate: ["Heart rate", "bpm"], mood: ["Mood", "/5"], reaction: ["Reaction time", "ms"] };
  el.innerHTML = `<p class="note">The last seven days: trends, what you did and what is still open. Nothing here leaves the device unless you send it.</p>
    <article class="card cl-card"><span class="label">Adherence</span><h3><span class="num">${w.adherence_pct}%</span> of routine check-ins</h3></article>
    ${t.has_enough_data ? "" : `<p class="note">Not enough data yet for a full week: fewer than three days of readings.</p>`}
    <table class="readings"><thead><tr><th>Reading</th><th>Average</th><th>Low</th><th>High</th><th>Days</th></tr></thead><tbody>${Object.entries(w.stats || {}).map(([k, s]) =>
      `<tr><td>${esc(names[k]?.[0] || k)}</td><td class="num"><strong>${esc(s.mean ?? "—")}</strong> ${esc(names[k]?.[1] || "")}</td><td class="num">${esc(s.min ?? "—")}</td><td class="num">${esc(s.max ?? "—")}</td><td class="num">${esc(s.count ?? 0)}</td></tr>`).join("")}</tbody></table>
    <h3>Sleep and reaction time, side by side</h3>
    ${t.sleep_vs_reaction?.length ? `<table class="readings"><thead><tr><th>Day</th><th>Sleep</th><th>Reaction</th></tr></thead><tbody>${t.sleep_vs_reaction.map((d) => `<tr><td>${d.day_index}</td><td class="num">${esc(d.sleep_hours)} h</td><td class="num">${esc(d.reaction_ms)} ms</td></tr>`).join("")}</tbody></table>` : `<p class="note">No paired days yet.</p>`}
    <h3>Care this week</h3>
    ${log.empty ? `<p class="note">${esc(log.placeholder)}</p>` : `<ul class="note">${log.entries.slice(0, 6).map((e) => `<li>${esc(when(e.timestamp))}: ${esc(e.protocol || e.symptom || e.type)}, ${esc(e.outcome || "")}</li>`).join("")}</ul>`}
    <details class="more"><summary>The summary that would be shared</summary><pre class="g-digest">${esc(w.summary_text || "")}</pre></details>
    <div class="exam-nav"><button class="pill pill-light" type="button" data-share>Share this with the flight surgeon</button><button class="pill pill-ghost" type="button" data-open="trends">Open the charts</button><button class="pill pill-ghost" type="button" data-open="mind">Wellbeing dimensions</button></div>
    <p class="note" data-msg aria-live="polite"></p>`;
  el.querySelectorAll("[data-open]").forEach((x) => x.addEventListener("click", () => go(ctx, x.dataset.open)));
  el.querySelector("[data-share]").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api.ground(cid, { kind: "weekly", title: "Weekly review", body: { text: w.summary_text } });
      el.querySelector("[data-msg]").innerHTML = `Queued for ground (text only, no video or images). It arrives in about ${Math.max(1, Math.round((r.eta_s || 0) / 60))} minutes ${badgeHTML("SIM")}.`;
    } catch (err) { el.querySelector("[data-msg]").textContent = `Not queued: ${err.message}`; e.currentTarget.disabled = false; }
  });
}

// ================= one reading in detail (16.1): value, status, how to measure, why, what to do, source =================
const CHART_OF = { "vitals.heart_rate": "heart_rate", "vitals.breathing_rate": "breathing_rate", "vitals.spo2": "spo2", "manual.bp_systolic": "bp", "manual.glucose_mgdl": "glucose",
  "manual.temp_c": "temp", "manual.sleep_hours": "sleep", "manual.sleep_quality": "sleep_quality", "manual.exercise_minutes": "exercise", "manual.hydration_ml": "hydration",
  "manual.mood": "mood", "cognitive.reaction_ms": "reaction", "voice.talk_time": "talk_time", "voice.pitch": "pitch", "cabin.oxygen_pct": "o2", "cabin.co2_ppm": "co2" };
async function renderIndicator(el, ctx, metric = "vitals.heart_rate") {
  const cid = ctx.view.crewId;
  let d, b;
  try { [d, b] = await Promise.all([api.indicator(cid, metric), api.baselines(cid)]); } catch { offline(el); return; }
  document.getElementById("sheet-title").textContent = fieldName(metric).replace(/^./, (c) => c.toUpperCase());
  const m = b.indicators[metric], f = d.facts || {};
  const src = ctx.view.aux?.assessment?.provenance?.[metric];
  const label = d.is_estimate ? "SIM" : src === "sim" || !src ? "SIM" : src === "user" || src === "manual" ? "MANUAL" : "LIVE";
  el.innerHTML = `<article class="card cl-card"><span class="label">Now ${badgeHTML(label)}${d.is_estimate ? ` <span class="fine">low confidence: an estimate</span>` : ""}</span>
      <p class="exam-big"><strong class="num">${esc(fmt(d.value, metric))}</strong> ${esc(d.unit || fieldUnit(metric))}</p>
      <p><span class="st-cell st-${statusKey(d.status)}">${statusHTML(d.status)}</span></p>
      <p class="note">${m ? `Your normal: ${esc(fmt(m.median, metric))} ± ${esc(fmt(m.spread, metric))} (${esc(m.stage)}; ${m.entered} entered of ${m.count} stored).` : "No baseline yet: only reference ranges apply while calibrating."}</p></article>
    <h3>How to measure</h3><p>${esc(f.how_to_measure || "")}</p>
    <h3>Why it matters</h3><p>${esc(f.why_it_matters || "")}</p>
    <h3>What to do</h3><p>${esc(f.what_to_do || "")}</p>
    ${DATA_GROUP[metric] ? `<p class="note">NASA has published human research datasets on this. <button class="link-btn" type="button" data-ds="${DATA_GROUP[metric]}">See the ${DATA_GROUP[metric]} datasets</button></p>` : ""}
    <p class="fine">Source: ${esc(f.source_mrid || "")}${f.group ? ` · signal group: ${esc(f.group)}` : ""}${f.worse_when ? ` · worse when ${esc(f.worse_when)}` : ""}. A self-check aid, never a diagnosis.</p>
    <div class="exam-nav">${CHART_OF[metric] ? `<button class="pill pill-light" type="button" data-chart>See the trend</button>` : ""}<button class="pill pill-ghost" type="button" data-open="health_log">Enter a reading</button><button class="pill pill-ghost" type="button" data-open="record">My saved record</button></div>`;
  el.querySelector("[data-chart]")?.addEventListener("click", () => ctx.screens.chart(CHART_OF[metric]));
  el.querySelector("[data-ds]")?.addEventListener("click", (e) => go(ctx, "datasets", { group: e.currentTarget.dataset.ds }));
  el.querySelectorAll("[data-open]").forEach((x) => x.addEventListener("click", () => go(ctx, x.dataset.open)));
}

const DATA_GROUP = { "vitals.heart_rate": "cardio", "manual.bp_systolic": "cardio", "manual.bp_diastolic": "cardio", "vitals.spo2": "respiratory", "vitals.breathing_rate": "respiratory",
  "cabin.co2_ppm": "respiratory", "cabin.oxygen_pct": "respiratory", "manual.sleep_hours": "sleep", "manual.sleep_quality": "sleep", "cognitive.reaction_ms": "cognitive",
  "manual.mood": "mood", "manual.stress_self": "mood", "manual.connection_self": "mood", "manual.glucose_mgdl": "nutrition", "manual.hydration_ml": "nutrition",
  "manual.exercise_minutes": "activity", "radiation.cumulative_msv": "radiation" };
const GROUP_NAME = { sleep: "Sleep", cardio: "Heart and circulation", cognitive: "Reaction and cognition", mood: "Mood and behaviour", vision: "Eyes and vision",
  musculoskeletal: "Bone and muscle", nutrition: "Nutrition", radiation: "Radiation", respiratory: "Breathing and air", activity: "Exercise" };

// ================= NASA Life Sciences Portal: published human research datasets behind what Sentinel tracks (section 26) =================
async function renderDatasets(el, ctx, arg) {
  el.innerHTML = `<p class="note">Loading the catalogue…</p>`;
  let d = ctx.nlsp;
  if (!d) { try { d = ctx.nlsp = await (await fetch("../shared/nlsp_catalog.json")).json(); } catch { el.innerHTML = `<p class="note">The dataset catalogue is not on this device. Run tools/nlsp_fetch.py once with a connection.</p>`; return; } }
  let group = arg?.group || "", shown = 40;
  el.innerHTML = `<p class="note">${d.kept} human research datasets from the NASA Life Sciences Portal that touch something Sentinel tracks, out of ${d.index_total} in its index (fetched ${esc(d.fetched)}). They are context and citations for the ranges and protocols. They are not training data: Sentinel's detection is rules and statistics over each person's own readings.</p>
    <div class="ev-tools"><input type="search" data-q placeholder="Search: sleep latency, blood pressure, bone density…" aria-label="Search the datasets">
    <div class="ev-chips" role="tablist"><button type="button" data-g="" aria-pressed="${!group}">All</button>${Object.entries(GROUP_NAME).map(([k, v]) => `<button type="button" data-g="${k}" aria-pressed="${group === k}">${v} · ${d.by_group[k] || 0}</button>`).join("")}</div></div>
    <p class="fine" data-count></p><div class="ev-list" data-list></div><p><button class="pill pill-ghost" type="button" data-more hidden>Show more</button></p>`;
  const q = el.querySelector("[data-q]"), list = el.querySelector("[data-list]");
  const draw = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = d.datasets.filter((x) => (!group || x.groups.includes(group)) && words.every((w) => `${x.title} ${x.experiment} ${x.parameters.join(" ")} ${x.description} ${x.mission.join(" ")}`.toLowerCase().includes(w)));
    el.querySelector("[data-count]").textContent = `${rows.length} dataset${rows.length === 1 ? "" : "s"}`;
    list.innerHTML = rows.slice(0, shown).map((x) => `<details class="ev-doc"><summary><b>${esc(x.title)}</b><span>${esc(x.experiment)}</span><small>${esc(x.mission.join(", "))}${x.program ? ` · ${esc(x.program)}` : ""} · ${x.groups.map((g) => GROUP_NAME[g] || g).join(" · ")}</small></summary>
      <p>${esc(x.description)}</p>${x.parameters.length ? `<h4>Measured</h4><p>${esc(x.parameters.join(", "))}</p>` : ""}
      <p class="fine">${esc(x.processing || "")}${x.released ? ` · released ${esc(x.released)}` : ""} · catalogue ${esc(x.catalog || "")}. <a class="src-link" href="${esc(x.url)}" target="_blank" rel="noopener">Open on the NASA portal</a> (needs a connection; some files need a data request).</p></details>`).join("") || `<p class="note">No dataset matches.</p>`;
    el.querySelector("[data-more]").hidden = rows.length <= shown;
  };
  q.addEventListener("input", () => { shown = 40; draw(); });
  el.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => { group = b.dataset.g; shown = 40; el.querySelectorAll("[data-g]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  el.querySelector("[data-more]").addEventListener("click", () => { shown += 40; draw(); });
  draw();
}

// ================= alerts: lifecycle, "Why this?", feedback, snooze with a reason (19.4, 19.5) =================
const SNOOZE_REASONS = ["Busy with a task", "Already handled", "Will check after rest"];
function renderAlerts(el, ctx) {
  const cid = ctx.view.crewId;
  let alive = true, msg = "";
  const why = {};
  const draw = async () => {
    let d;
    try { d = await api.alerts(cid); } catch { if (alive) offline(el); return; }
    if (!alive) return;
    const s = ctx.view.state || {}, a = s.action || {};
    const list = [...d.alerts].sort((x, y) => y.created_at - x.created_at);
    const open = (x) => !["resolved", "expired"].includes(x.state);
    el.innerHTML = `<p class="note">One alert per cause, with a cool-down so it does not repeat. Each keeps the readings, the rule and the source that raised it. Urgent alerts cannot be snoozed.</p>
      ${a.type && a.type !== "none" ? `<article class="card cl-card"><span class="label">Right now</span><h3>${esc(a.detail || "")}</h3>
        <div class="exam-nav"><button class="pill pill-light" type="button" data-open="care">Work out what to do</button>${a.zone ? `<button class="pill pill-ghost" type="button" data-zone="${esc(a.zone)}">See the readings</button>` : ""}</div></article>`
        : `<article class="card cl-card"><span class="label">Right now</span><h3>Nothing needs your attention.</h3></article>`}
      <p class="note" data-msg aria-live="polite">${esc(msg)}</p>
      <ul class="ground-list">${list.length ? list.map((x) => `<li class="card cl-alert">
        <span class="g-status ${x.level >= 3 ? "is-queued-(no-link)" : open(x) ? "is-awaiting-reply" : "is-delivered"}">${esc(x.state)}</span>
        <strong>${levelChip(x.level)} · ${esc(x.title)}</strong>
        <small>${esc(when(x.created_at))}${x.snooze_count ? ` · snoozed ${x.snooze_count}×` : ""}${x.dismiss_reason ? ` · ${esc(x.dismiss_reason)}` : ""}</small>
        ${why[x.alert_id] ? `<pre class="g-digest">${esc(why[x.alert_id])}</pre>` : ""}
        <span class="cl-acts"><button class="pill pill-ghost" type="button" data-why="${x.alert_id}">Why this?</button>
          ${open(x) && x.state !== "acknowledged" ? `<button class="pill pill-ghost" type="button" data-ack="${x.alert_id}">Got it</button>` : ""}
          ${open(x) && x.level < 3 ? `<select class="cl-select" data-snz="${x.alert_id}" aria-label="Snooze with a reason"><option value="">Snooze…</option>${SNOOZE_REASONS.map((r) => `<option>${esc(r)}</option>`).join("")}</select>` : ""}
          <button class="pill pill-ghost" type="button" data-fb="${x.alert_id}" data-u="1">Useful</button><button class="pill pill-ghost" type="button" data-fb="${x.alert_id}" data-u="0">Not useful</button></span></li>`).join("")
        : `<li class="note">No alerts yet. When a reading leaves its range or moves from your usual, it appears here with its reason.</li>`}</ul>`;
    el.querySelectorAll("[data-open]").forEach((x) => x.addEventListener("click", () => go(ctx, x.dataset.open, a.zone ? { zone: a.zone } : undefined)));
    el.querySelector("[data-zone]")?.addEventListener("click", (e) => ctx.screens.zone(e.currentTarget.dataset.zone));
    el.querySelectorAll("[data-why]").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.why;
      if (why[id]) { delete why[id]; return draw(); }
      try { const x = await api.alertExplain(id); why[id] = x.plain_language.replace(/vitals\.|manual\.|cognitive\.|voice\.|cabin\./g, "").replace(/_/g, " "); } catch (e) { msg = e.message; }
      draw();
    }));
    el.querySelectorAll("[data-ack]").forEach((b) => b.addEventListener("click", async () => { try { await api.alertAck(b.dataset.ack, "Seen"); msg = "Acknowledged."; } catch (e) { msg = e.message; } draw(); }));
    el.querySelectorAll("[data-snz]").forEach((sel) => sel.addEventListener("change", async () => {
      if (!sel.value) return;
      try { await api.alertSnooze(sel.dataset.snz, sel.value); msg = "Snoozed for 15 minutes."; } catch (e) { msg = e.message; }
      draw();
    }));
    el.querySelectorAll("[data-fb]").forEach((b) => b.addEventListener("click", async () => {
      try {
        const r = await api.alertFeedback(b.dataset.fb, b.dataset.u === "1");
        msg = b.dataset.u === "1" ? "Thanks. Noted as useful." : `Thanks. This rule is now a little less sensitive (${Math.round(r.sensitivity_adjustment * 100)}%), and never below the safe limits.`;
      } catch (e) { msg = e.message; }
      draw();
    }));
  };
  draw();
  const t = setInterval(() => { if (!el.contains(document.activeElement) || document.activeElement === document.body) draw(); }, 8000);
  return () => { alive = false; clearInterval(t); };
}

// ================= the kit, filtered by the profile (19.5, 14.4) =================
async function renderKit(el, ctx) {
  let k;
  try { k = await api.kitFilter(ctx.view.crewId); } catch { offline(el); return; }
  const item = (i) => `<li><strong>${esc(i.name || i.item?.name || i.id)}</strong> <span class="fine">${esc(i.pack || i.item?.pack || "")}</span>${i.reason ? `<br><span class="note">Blocked: ${esc(i.reason)}</span>` : ""}${i.note ? `<br><span class="note">${esc(i.note)}</span>` : ""}</li>`;
  el.innerHTML = `<p class="note">The active kit list (SIM). Sentinel only ever suggests items that are on it, with dosing as the kit label states. Your profile filters it: an allergy or a past reaction blocks the matching item.</p>
    ${(k.notes || []).length ? `<p class="note">${k.notes.map((n) => esc(typeof n === "string" ? n : n.note || n.text || "")).join("<br>")}</p>` : ""}
    ${(k.blocked || []).length ? `<h3>Blocked for you</h3><ul class="note">${k.blocked.map(item).join("")}</ul>` : ""}
    <h3>Available</h3><ul class="note">${(k.allowed || []).map(item).join("")}</ul>
    <div class="exam-nav"><button class="pill pill-ghost" type="button" data-open="profile">Edit my health background</button></div>`;
  el.querySelector("[data-open]").addEventListener("click", () => go(ctx, "profile"));
}
