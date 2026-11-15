// Backend calls. All URLs are relative so the page works from any host.
let pairing = null;
/** Ask for the PIN shown on the Sentinel laptop; resolves true once paired. One prompt for all waiting requests. */
function pairDevice() {
  if (pairing) return pairing;
  pairing = new Promise((resolve) => {
    const el = document.createElement("section"); el.className = "pair"; el.setAttribute("role", "dialog");
    el.innerHTML = `<form class="pair-card"><h2>Pair this device</h2><p>Enter the 6-digit PIN shown on the Sentinel laptop (demo panel, or the window where Sentinel started).</p>
      <input inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required aria-label="Pairing PIN"><button class="pill pill-light">Pair</button><p class="pair-msg" aria-live="polite"></p></form>`;
    document.body.appendChild(el);
    const f = el.querySelector("form"), inp = el.querySelector("input"); inp.focus();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await fetch("../api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: inp.value }) });
      if (r.ok) { el.remove(); pairing = null; resolve(true); } else { el.querySelector(".pair-msg").textContent = "That PIN didn't match. Check the laptop."; inp.select(); }
    });
  });
  return pairing;
}

async function req(method, url, body, opts = {}) {
  const init = { method, headers: {} };
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    init.body = body;
    init.headers["Content-Type"] = "audio/wav";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["Content-Type"] = "application/json";
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout ?? 8000);
  init.signal = ctrl.signal;
  try {
    let r = await fetch(url, init);
    let data = await r.json().catch(() => ({}));
    if (r.status === 401 && data.pair && await pairDevice()) {   // this device is not paired yet: ask for the PIN once
      r = await fetch(url, { ...init, signal: undefined });
      data = await r.json().catch(() => ({}));
    }
    if (!r.ok) {
      const e = new Error(data.detail || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  health: () => req("GET", "../api/health"),
  pin: () => req("GET", "../api/pin"),
  crew: () => req("GET", "../api/crew"),
  state: (id) => req("GET", `../api/state/${id}`, undefined, { timeout: 3000 }),
  aux: (id) => req("GET", `../api/aux/${id}`, undefined, { timeout: 3000 }),
  patch: (id, patch) => req("POST", `../api/state/${id}/patch`, patch),
  history: (id, field) => req("GET", `../api/history/${id}?field=${encodeURIComponent(field)}`),
  log: (id, field, value, source = "user") => req("POST", `../api/log/${id}`, { field, value, source }),
  chat: (crew_id, transcript) => req("POST", "../api/chat", { crew_id, transcript }, { timeout: 10000 }),
  faceEmotion: (jpeg) => req("POST", "../api/face/emotion", jpeg, { timeout: 5000 }),
  identify: (wav) => req("POST", "../api/identify", wav, { timeout: 15000 }),
  enrol: (id, wav) => req("POST", `../api/enrol/${id}`, wav, { timeout: 30000 }),
  cabin: (body) => req("POST", "../api/cabin", body),
  scenario: (name, params = "") => req("POST", `../api/scenario/${name}${params}`),
  suit: (cid, body) => req("POST", `../api/suit/${cid}`, body),
  ops: (cid, body) => req("POST", `../api/ops/${cid}`, body),
  readiness: (cid) => req("GET", `../api/ops/${cid}/readiness`),
  digest: (cid, note = "") => req("POST", `../api/digest/${cid}`, { note }),
  safety: (cid, category) => req("POST", `../api/safety/${cid}`, { category }),
  profile: (cid) => req("GET", `../api/profile/${cid}`),
  auditBatch: (body) => req("POST", "../api/audit", body),
  envMatch: (text) => req("GET", `../api/environment/match?text=${encodeURIComponent(text)}`),
  envSet: (cid, body) => req("POST", `../api/environment/${cid}`, body),
  context: (cid, body) => req("POST", `../api/context/${cid}`, body),
  pulse: (cid) => req("GET", `../api/pulse?crew_id=${encodeURIComponent(cid)}`),
  pulseAnswer: (cid, body) => req("POST", `../api/pulse/${cid}`, body),
  auditList: (q = "", limit = 200) => req("GET", `../api/audit?limit=${limit}&q=${encodeURIComponent(q)}`),
  profileUpdate: (cid, patch) => req("PATCH", `../api/profile/${cid}`, patch),
  profileDelete: (cid) => req("DELETE", `../api/profile/${cid}`),
  spaceweather: () => req("GET", "../api/spaceweather"),
  clock: (hours) => req("POST", "../api/clock", { advance_hours: hours }),
  json: (path) => req("GET", path),
  ground: (id, packet) => req("POST", `../api/ground/${id}`, packet),
  skin: (id, on) => req("POST", `../api/skin/${id}`, { on }),
  groundList: (id) => req("GET", `../api/ground?crew_id=${encodeURIComponent(id)}`),
  // ---- clinic model, care, plan, alerts, wellbeing, record (Product Document parts 4 and 5) ----
  clinic: (cid) => req("GET", `../api/clinic/${cid}`),
  clinicBlock: (cid, body) => req("POST", `../api/clinic/${cid}/block`, body),
  checkin: (cid, body = {}) => req("POST", `../api/clinic/${cid}/checkin`, body),
  weekly: (cid) => req("GET", `../api/clinic/${cid}/weekly`),
  plan: (cid) => req("GET", `../api/plan/${cid}`),
  planTick: (cid) => req("POST", `../api/plan/${cid}/tick`, {}),
  planSnooze: (cid, reminder_id, minutes = 15) => req("POST", `../api/plan/${cid}/snooze`, { reminder_id, minutes }),
  planDone: (cid, reminder_id) => req("POST", `../api/plan/${cid}/complete`, { reminder_id }),
  planAdd: (cid, body) => req("POST", `../api/plan/${cid}/reminder`, body),
  planRecheck: (cid, protocol_title, recheck_after_min) => req("POST", `../api/plan/${cid}/recheck`, { protocol_title, recheck_after_min }),
  triageQuestions: (zone) => req("GET", `../api/care/triage/questions?zone=${encodeURIComponent(zone)}`),
  triage: (cid, body) => req("POST", `../api/care/triage/${cid}`, { ...body, log: true }),
  protoStart: (crew_id, protocol_id, context) => req("POST", "../api/care/protocol/start", { crew_id, protocol_id, context }),
  protoGet: (run) => req("GET", `../api/care/protocol/${run}`),
  protoStep: (run, step_num, done = true) => req("POST", `../api/care/protocol/${run}/step`, { step_num, done }),
  protoAct: (run, action, body = {}) => req("POST", `../api/care/protocol/${run}/${action}`, body),
  careLog: (cid) => req("GET", `../api/care/log/${cid}`),
  protocols: (env = "transit", mode = "routine") => req("GET", `../api/protocols?env=${env}&mode=${mode}`),
  indicator: (cid, metric) => req("GET", `../api/indicator/${cid}/${encodeURIComponent(metric)}`),
  alerts: (cid) => req("GET", `../api/alerts/${cid}`),
  alertsTick: (cid) => req("POST", `../api/alerts/${cid}/tick`, {}),
  alertsAckOpen: (cid, min_level = 3) => req("POST", `../api/alerts/${cid}/acknowledge-open`, { min_level }),
  alertAck: (id, reason) => req("POST", `../api/alerts/${id}/acknowledge`, { reason }),
  alertSnooze: (id, reason, minutes = 15) => req("POST", `../api/alerts/${id}/snooze`, { reason, minutes }),
  alertExplain: (id) => req("GET", `../api/alerts/${id}/explain`),
  alertFeedback: (id, useful, reason = "") => req("POST", `../api/alerts/${id}/feedback`, { useful, reason }),
  wb: (cid) => req("GET", `../api/wellbeing/${cid}`),
  wbToolkit: () => req("GET", "../api/wellbeing/toolkit"),
  wbSession: (cid, body) => req("POST", `../api/wellbeing/${cid}/session`, body),
  wbSpike: (cid, strength, tool) => req("POST", `../api/wellbeing/${cid}/spike`, { strength, tool }),
  cohesion: () => req("GET", "../api/wellbeing/team/cohesion"),
  journal: (cid) => req("GET", `../api/wellbeing/${cid}/journal`),
  journalAdd: (cid, body) => req("POST", `../api/wellbeing/${cid}/journal`, body),
  journalDel: (cid, id) => req("DELETE", `../api/wellbeing/${cid}/journal/${id}`),
  trendsAll: (cid, days = 7) => req("GET", `../api/trends/${cid}?days=${days}`),
  onboarding: (cid) => req("GET", `../api/onboarding/${cid}`),
  onboardingStep: (cid, step_id) => req("POST", `../api/onboarding/${cid}/step`, { step_id }),
  envProfiles: () => req("GET", "../api/environment/profiles"),
  record: (cid) => req("GET", `../api/record/${cid}`),
  baselines: (cid) => req("GET", `../api/baselines/${cid}`),
  baselinesLearn: (cid) => req("POST", `../api/baselines/${cid}/learn`, {}),
  records: (cid, type, body) => req("POST", `../api/records/${cid}/${type}`, body),
  delaySim: (cid) => req("GET", `../api/ground/${cid}/delay-simulator`),
  groundReply: (packet, instructions) => req("POST", `../api/ground/${packet}/reply`, { instructions }),
  groundConfirm: (packet, step_num) => req("POST", `../api/ground/${packet}/confirm-step`, { step_num }),
  notifications: (cid, seen = false) => req("GET", `../api/notifications/${cid}${seen ? "?seen=true" : ""}`),
  notificationsClear: (cid, id) => req("POST", `../api/notifications/${cid}/clear`, id ? { id } : {}),
  devices: (cid) => req("GET", `../api/devices/${cid}`),
  deviceSend: (cid, device, readings, sim = true) => req("POST", `../api/device/${cid}`, { device, readings, sim }),
  crewAdd: (display_name, body_model) => req("POST", "../api/crew", { display_name, body_model }),
  crewCard: (cid) => req("GET", `../api/crew/${cid}/card`),
  exercise: (cid) => req("GET", `../api/exercise/${cid}`),
  scanSave: (cid, body) => req("POST", `../api/scan/${cid}`, body),
  scans: (cid) => req("GET", `../api/scans/${cid}`),
  planMiss: (cid, reminder_id) => req("POST", `../api/plan/${cid}/miss`, { reminder_id }),
  profileConfirm: (cid) => req("POST", `../api/profile/${cid}/confirm`, {}),
  kitFilter: (crew_id) => req("POST", "../api/kit/filter", { crew_id }),
};

/** Streamed chat: calls onSentence(text, source) for each complete sentence as it arrives (NDJSON),
 *  resolves with the final {reply, commands, source}. Falls back to /api/chat if streaming fails. */
api.chatStream = async (crew_id, transcript, onSentence, context) => {
  let r;
  try {
    r = await fetch("../api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ crew_id, transcript, context }) });
  } catch (e) { r = null; console.warn(`[sentinel brain] /api/chat/stream failed: ${e.message}`); }
  if (!r || !r.ok || !r.body) {
    if (r) console.warn(`[sentinel brain] /api/chat/stream HTTP ${r.status}; trying /api/chat`);
    try { return await api.chat(crew_id, transcript); } catch (e) { console.warn(`[sentinel brain] /api/chat failed: ${e.message}`); throw e; }
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", final = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "sentence") onSentence?.(ev.text, ev.source);
      else if (ev.type === "final") final = ev;
    }
  }
  return final || { reply: "", commands: [], source: "rules" };
};
