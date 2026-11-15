import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wellbeingConcern } from "../../app/js/core/intents.js";

test("W14: urgent wellbeing phrases are caught, everyday speech is not (same cases as brain/rules/safety.py)", () => {
  const cases = JSON.parse(readFileSync(new URL("../fixtures/safety_cases.json", import.meta.url), "utf8"));
  for (const [text, cat] of cases) assert.equal(wellbeingConcern(text), cat, text);
});
