import test from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, cleanLang, langInfo, isLocal, khayaCode, matchLanguageRequest } from "../../app/js/voice/languages.js";

test("languages: English plus the Khaya languages, each with a Khaya code", () => {
  assert.deepEqual(LANGUAGES.map((l) => l.code), ["en", "tw", "ee", "gaa", "fat", "dag", "yo"]);
  assert.equal(khayaCode("tw"), "twi");
  assert.equal(khayaCode("ee"), "ewe");
  assert.equal(khayaCode("yo"), "yor");
  assert.equal(langInfo("gaa").name, "Ga");
});

test("languages: unknown codes fall back to English; only English is not local", () => {
  assert.equal(cleanLang("xx"), "en");
  assert.equal(cleanLang(undefined), "en");
  assert.equal(isLocal("en"), false);
  assert.equal(isLocal("tw"), true);
  assert.equal(isLocal("dag"), true);
  assert.equal(isLocal("nonsense"), false);
});

test("languages: asking Sentinel to speak a language", () => {
  const cases = {
    "speak Ewe": "ee", "switch to Ga": "gaa", "can you answer me in Fante": "fat", "let's talk Dagbani": "dag",
    "speak Yoruba please": "yo", "respond in Twi": "tw", "speak English": "en", "switch to english now": "en",
    "Hey Sentinel, talk to me in Ewe": "ee", "in Fanti please": "fat",
  };
  for (const [text, code] of Object.entries(cases)) assert.equal(matchLanguageRequest(text), code, text);
});

test("languages: ordinary sentences do not switch language", () => {
  for (const text of ["what is the Ewe language", "how many people speak Yoruba", "check my heart", "start an EVA",
    "use a female voice", "switch to Jon", "I'm going to Ga", "show my vitals"]) {
    assert.equal(matchLanguageRequest(text), null, text);
  }
});
