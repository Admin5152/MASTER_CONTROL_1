// "Use a female voice", "switch to Lance": Sentinel's voice changes by voice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchIntent } from "../../app/js/core/intents.js";

test("asking for another voice", () => {
  assert.deepEqual((({ local, name, gender }) => ({ local, name, gender }))(matchIntent("use a female voice")), { local: "voice", name: null, gender: "female" });
  assert.equal(matchIntent("switch to a male voice").gender, "male");
  assert.equal(matchIntent("switch to Jon").name, "jon");
  assert.equal(matchIntent("use Nathaniel").name, "nathaniel");
  assert.equal(matchIntent("can you use Samara's voice").name, "samara");
  assert.equal(matchIntent("change your voice").local, "voice");
});

test("other talk about voices is not a switch", () => {
  assert.notEqual(matchIntent("how is my voice pitch")?.local, "voice");
  assert.notEqual(matchIntent("show my vitals")?.local, "voice");
});
