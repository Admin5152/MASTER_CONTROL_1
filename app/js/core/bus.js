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

export function emit(name, detail) {
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
