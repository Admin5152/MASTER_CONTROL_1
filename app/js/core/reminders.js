// Adaptive reminders (FR-21, Product Document section 20). Pure: no DOM, tested with node --test.
// - Snooze: each reminder can be put off twice a day, 30 mission-minutes each; then it stays until done.
// - Quiet: the sleep block (default 22:00 to 06:00 mission time) and EVA / rest modes hold routine reminders.
// - Gentle escalation: a reminder still open two hours after it started, with both snoozes used, gets one
//   spoken nudge; never a stream of them.

export const MAX_SNOOZES = 2;
export const SNOOZE_H = 0.5;
export const ESCALATE_AFTER_H = 2;

/** Hour as a number (14.5 = 14:30). */
const at = (clock) => (clock?.hour ?? 0) + (clock?.minute ?? 0) / 60;

export function inQuietHours(clock, sleep = { from: 22, to: 6 }) {
  const h = at(clock);
  return sleep.from > sleep.to ? h >= sleep.from || h < sleep.to : h >= sleep.from && h < sleep.to;
}

/** The reminder that is due now, honouring snoozes and quiet hours; null if none. */
export function dueNow(routine, clock, done = {}, snoozes = {}, { paused = false, sleep } = {}) {
  if (!clock || paused || inQuietHours(clock, sleep)) return null;
  const h = at(clock);
  return routine.find((r) => h >= r.from && h < r.to && !done[r.id] && !(snoozes[r.id]?.until > h)) || null;
}

export function canSnooze(id, snoozes = {}) { return (snoozes[id]?.count || 0) < MAX_SNOOZES; }

/** A new snoozes object with `id` put off by SNOOZE_H; unchanged if the limit is reached. */
export function snooze(id, clock, snoozes = {}) {
  if (!canSnooze(id, snoozes)) return snoozes;
  const n = (snoozes[id]?.count || 0) + 1;
  return { ...snoozes, [id]: { count: n, until: at(clock) + SNOOZE_H } };
}

/** True once: the reminder has been open ESCALATE_AFTER_H and cannot be snoozed again. */
export function shouldEscalate(r, clock, done = {}, snoozes = {}, escalated = {}) {
  if (!r || done[r.id] || escalated[r.id]) return false;
  return at(clock) - r.from >= ESCALATE_AFTER_H && !canSnooze(r.id, snoozes);
}
