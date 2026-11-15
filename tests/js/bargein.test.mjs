// Barge-in: talking over Sentinel is understood the way a person would understand it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyInterruption as c, isEcho, isResume } from "../../app/js/voice/bargein.js";

test("asking it to stop: it goes quiet", () => {
  for (const t of ["Stop", "stop talking", "Okay, stop.", "Sentinel, be quiet", "That's enough", "never mind", "Shut up"]) assert.equal(c(t).kind, "stop", t);
});

test("asking it to wait: it holds and listens", () => {
  for (const t of ["Wait", "Wait, wait.", "Hold on", "Hang on a sec", "Sentinel", "Hey Sentinel", "Sorry, one moment", "Wait, I'm talking", "Hold up", "Excuse me", "Let me finish"]) assert.equal(c(t).kind, "hold", t);
});

test("interrupting with a new request: that request is what happens", () => {
  assert.deepEqual(c("Wait, show my vitals"), { kind: "command", rest: "show my vitals" });
  assert.deepEqual(c("Sentinel, what's my heart rate?"), { kind: "command", rest: "what's my heart rate?" });
  assert.deepEqual(c("Sorry, can you open the mission"), { kind: "command", rest: "can you open the mission" });
  assert.equal(c("Actually, start Stillpoint").kind, "command");
  assert.equal(c("Hold on, why is my sleep low?").kind, "command");   // a question is a request, not a pause
});

test("go on, continue: it picks up where it left off", () => {
  for (const t of ["Go on", "Okay, go ahead", "Continue", "Sorry, carry on", "Where were we?", "Yeah, keep going", "What were you saying"]) {
    assert.equal(c(t).kind, "resume", t);
    assert.ok(isResume(t), t);
  }
  assert.ok(!isResume("go to the mission"));
  assert.ok(!isResume("show my vitals"));
});

test("its own voice coming back through the microphone is ignored", () => {
  const said = "Your heart rate and breathing are right on baseline, and fatigue and stress are low.";
  assert.ok(isEcho("heart rate and breathing are right on baseline", said));
  assert.ok(isEcho("fatigue and stress are low", said));
  assert.ok(!isEcho("wait", said));                         // one word is never treated as echo
  assert.ok(!isEcho("hold on, I'm talking", said));
  assert.ok(!isEcho("show me my sleep instead", said));
});
