// Shared event bus. Events used across modules:
// voice:listening, voice:transcript, voice:speaking-start, voice:speaking-end, voice:level
// state (fresh poll), offline, online, crew:changed, vision:zone, vision:point, vision:hr
// say (text to speak), director:busy, orb:mode, action:changed
// Body model (Product Document section 7.4), dotted names as in the document:
//   body.zone.selected  { zone, crewId, region? }                    a zone or a place on the body is tapped
//   body.scan.complete  { zones_flagged[], crewId }                  the mesh scan finishes
//   symptom.logged      { zone, type, severity, onset, region, crewId }  a symptom is entered via the body
const listeners = new Map();

export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}

// Audit (INT-3, SI6): every emitted event is recorded. High-frequency meters are counted per batch;
// everything else is kept as an entry. The batch is sent by the app (see startAudit in main.js).
const NOISY = new Set(["voice:level", "voice:speak-level", "vision:hr", "state", "voice:transcript", "director:frame"]);
export const auditBuf = { events: [], counts: {} };
function auditDetail(d) {
  if (d == null || typeof d !== "object") return typeof d === "string" ? d.slice(0, 120) : d;
  const out = {};
  for (const [k, v] of Object.entries(d).slice(0, 10)) if (v == null || ["string", "number", "boolean"].includes(typeof v)) out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  return out;
}

export function emit(name, detail) {
  if (NOISY.has(name)) auditBuf.counts[name] = (auditBuf.counts[name] || 0) + 1;
  else if (auditBuf.events.length < 400) auditBuf.events.push({ t: Date.now() / 1000, event: name, detail: auditDetail(detail) });
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(detail); } catch (err) { console.warn(`[bus] ${name} handler failed`, err); }
  }
}

export function once(name, fn) {
  const off = on(name, (d) => { off(); fn(d); });
  return off;
}
