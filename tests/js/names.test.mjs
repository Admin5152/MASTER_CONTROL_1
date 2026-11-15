// "I'm Eliah" is found however speech recognition spells it (Eliah is said "Aleah").
import { test } from "node:test";
import assert from "node:assert/strict";
import { crewFromSpeech, soundKey } from "../../app/js/core/intents.js";

const crew = [["james", "Eliah"], ["amara", "Annie"], ["kenji", "Seth"], ["sad", "Sad"], ["stan", "Stanley"], ["gad", "Gadiel"]].map(([crew_id, display_name]) => ({ crew_id, display_name }));

test("what Whisper actually wrote for 'I'm Eliah' finds Eliah", () => {
  for (const t of ["Amelia.", "Sentinel, Italia", "Sentinel, it's Elyia.", "I'm Aleah", "I'm Alia", "It's Aliya", "This is Alea", "my name is Eliah", "I'm Elijah"]) {
    assert.equal(crewFromSpeech(t.replace(/^sentinel,?\s*/i, ""), crew, { bare: true }), "james", t);
  }
});

test("the other crew still match, and everyday words do not", () => {
  assert.equal(crewFromSpeech("I'm Annie", crew), "amara");
  assert.equal(crewFromSpeech("this is Gadiel", crew), "gad");
  assert.equal(crewFromSpeech("I'm Stanley", crew), "stan");
  assert.equal(crewFromSpeech("I'm sad", crew), null);          // a feeling, not Sad
  assert.equal(crewFromSpeech("I'm okay", crew), null);
  assert.equal(crewFromSpeech("I'm alive", crew), null);
  assert.equal(crewFromSpeech("I'm all set", crew), null);
});

test("names sound alike only when they really do", () => {
  assert.equal(soundKey("Eliah"), soundKey("Aleah"));
  assert.equal(soundKey("Elyia"), soundKey("Eliah"));
  assert.notEqual(soundKey("Annie"), soundKey("Eliah"));
});
