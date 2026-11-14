import test from "node:test";
import assert from "node:assert/strict";
import { dueNow, snooze, canSnooze, shouldEscalate, inQuietHours, MAX_SNOOZES } from "../../app/js/core/reminders.js";

const R = [{ id: "vitals", label: "morning vitals", from: 6, to: 11 }, { id: "log", label: "evening log", from: 18, to: 23 }];
const C = (hour, minute = 0) => ({ hour, minute, mission_day: 1 });

test("reminders: due in its window, held in quiet hours and when paused", () => {
  assert.equal(dueNow(R, C(7), {}, {})?.id, "vitals");
  assert.equal(dueNow(R, C(7), { vitals: true }, {}), null);
  assert.equal(dueNow(R, C(22, 30), {}, {}), null);           // sleep block
  assert.equal(dueNow(R, C(19), {}, {}, { paused: true }), null);   // EVA or rest
  assert.ok(inQuietHours(C(3)) && !inQuietHours(C(12)));
});

test("reminders: snoozed twice at most, 30 minutes each", () => {
  let s = snooze("vitals", C(7), {});
  assert.equal(dueNow(R, C(7, 10), {}, s), null);
  assert.equal(dueNow(R, C(7, 31), {}, s)?.id, "vitals");
  s = snooze("vitals", C(7, 31), s);
  assert.ok(!canSnooze("vitals", s) && s.vitals.count === MAX_SNOOZES);
  assert.deepEqual(snooze("vitals", C(8), s), s);               // the limit holds
});

test("reminders: one gentle escalation after two hours with no snoozes left", () => {
  const s = { vitals: { count: 2, until: 7 } };
  assert.ok(!shouldEscalate(R[0], C(7), {}, s));
  assert.ok(shouldEscalate(R[0], C(8, 5), {}, s));
  assert.ok(!shouldEscalate(R[0], C(8, 5), {}, s, { vitals: true }));   // once
  assert.ok(!shouldEscalate(R[0], C(9), {}, {}));               // snoozes still left: no nagging
});
