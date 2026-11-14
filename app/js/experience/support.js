// Support flows (Product Document v5, section 10.5): every wellbeing tool reports when it starts and
// finishes, with mood before and after, so Sentinel can learn what helps each crew member.
// Events on the bus: support.started, support.finished, intervention_log.added.
// Mood is the 1-5 scale the tools ask for; stress is reported as its inverse (6 - mood) for the
// fields the spec names, and marked derived.
import { api } from "../core/api.js";
import { emit } from "../core/bus.js";

/** The tools that are ranked, and the logged field holding each one's mood change. */
export const TOOLS = {
  orb_calm: { name: "Stillpoint", field: "session.calm_mood_change", screen: "orb_calm" },
  race: { name: "Slipstream", field: "session.race_mood_change", screen: "race" },
  greenhouse: { name: "Red Harvest", field: "session.greenhouse_mood_change", screen: "greenhouse" },
  grounding: { name: "Grounding", field: "session.grounding_mood_change", screen: "grounding" },
};

let seq = 0;
const stress = (mood) => (mood == null ? null : 6 - mood);

/** Start a flow. Returns the flow to pass to finishSupport. */
export function startSupport(tool, moodBefore, type = "break") {
  const flow = { flowId: `${tool}-${Date.now().toString(36)}-${++seq}`, type, tool, moodBefore, t0: performance.now() };
  emit("support.started", { flowId: flow.flowId, type, tool, moodBefore, stressBefore: stress(moodBefore), stressDerived: true });
  return flow;
}

/** Finish a flow with the mood after. Emits the events; the caller logs its own session fields. */
export function finishSupport(flow, moodAfter, extra = {}) {
  if (!flow || flow.done) return null;
  flow.done = true;
  const minutes = Math.round(((performance.now() - flow.t0) / 60000) * 10) / 10;
  const change = flow.moodBefore != null && moodAfter != null ? moodAfter - flow.moodBefore : null;
  const detail = { flowId: flow.flowId, type: flow.type, tool: flow.tool, moodBefore: flow.moodBefore, moodAfter, moodChange: change,
    stressBefore: stress(flow.moodBefore), stressAfter: stress(moodAfter), stressDerived: true, minutes, ...extra };
  emit("support.finished", detail);
  emit("intervention_log.added", { type: flow.tool, stress_before: detail.stressBefore, stress_after: detail.stressAfter, recovery_s: extra.recovery_s ?? null, mood_change: change });
  return detail;
}

/** Rank the tools by this person's own average mood change (most helpful first). Tools with fewer than
 *  two sessions come after the ranked ones, so one lucky session does not top the list. */
export async function rankTools(crewId) {
  const rows = await Promise.all(Object.entries(TOOLS).map(async ([id, t]) => {
    let v = [];
    try { v = ((await api.history(crewId, t.field)).points || []).map((p) => p.v).filter(Number.isFinite); } catch { /* offline */ }
    return { id, name: t.name, screen: t.screen, n: v.length, mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
  }));
  return rankRows(rows);
}

/** Pure ordering (tested). */
export function rankRows(rows) {
  const ranked = rows.filter((r) => r.n >= 2).sort((a, b) => b.mean - a.mean || b.n - a.n);
  const rest = rows.filter((r) => r.n < 2).sort((a, b) => b.n - a.n);
  return [...ranked, ...rest];
}
