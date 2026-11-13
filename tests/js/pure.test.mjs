// node --test tests/js
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchWake } from "../../app/js/voice/wake.js";
import { estimatePitch, medianPitch, talkTime } from "../../app/js/voice/pitch.js";
import { encodeWav, resample } from "../../app/js/voice/wav.js";
import { estimateBpm, PulseTracker } from "../../app/js/vision/rppg.js";
import { matchIntent } from "../../app/js/core/intents.js";
import { validateCommands } from "../../app/js/core/commands.js";
import { createCalm, updateCalm, pathWidth, breathSync, moodChange, sessionSummary, greenhouseDay, greenhouseCalm, medianReaction, pacer } from "../../app/js/experience/logic.js";
import { scanOrder } from "../../app/js/interface/body.js";

// deterministic PRNG
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

// ---------- voice ----------
test("pitch estimator: 220 Hz tone gives 220 +/- 5", () => {
  const sr = 16000;
  const x = Float32Array.from({ length: sr * 0.5 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr));
  const p = estimatePitch(x, sr);
  assert.ok(Math.abs(p - 220) <= 5, `got ${p}`);
  const m = medianPitch(x, sr);
  assert.ok(Math.abs(m - 220) <= 5, `median got ${m}`);
});

test("pitch estimator: other tones and silence", () => {
  const sr = 16000;
  for (const f of [110, 150, 300]) {
    const x = Float32Array.from({ length: 4000 }, (_, i) => 0.4 * Math.sin((2 * Math.PI * f * i) / sr) + 0.2 * Math.sin((2 * Math.PI * 2 * f * i) / sr));
    const p = estimatePitch(x, sr);
    assert.ok(Math.abs(p - f) <= f * 0.03, `${f}: got ${p}`);
  }
  assert.equal(estimatePitch(new Float32Array(4000), sr), null);
});

test("talk time counts voiced seconds only", () => {
  const sr = 16000;
  const x = new Float32Array(sr * 3);
  for (let i = sr; i < sr * 2; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / sr);
  const t = talkTime(x, sr);
  assert.ok(Math.abs(t - 1.0) < 0.1, `got ${t}`);
});

test("wake phrase matcher: positives", () => {
  const cases = [
    ["hey sentinel", ""], ["Hey Sentinel, how am I doing?", "how am i doing"], ["a sentinel let me see you", "let me see you"],
    ["hey centinel start orb calm", "start orb calm"], ["hey sentinal how is the cabin", "how is the cabin"],
    ["Hey, Sentinel. Stop.", "stop"], ["hi sentinel", ""], ["okay sentinel show me my heart", "show me my heart"],
    ["hey sent in el run a full scan", "run a full scan"], ["um hey sentinel log my health", "log my health"],
  ];
  for (const [text, cmd] of cases) {
    const r = matchWake(text);
    assert.equal(r.woke, true, text);
    assert.equal(r.command, cmd, text);
  }
});

test("wake phrase matcher: negatives", () => {
  for (const text of ["", "sentinel", "the sentinel is on duty", "hey there", "hey sam how are you", "I said hello sentinel",
    "send it now", "a centimetre", "hey", "how am I doing"]) {
    assert.equal(matchWake(text).woke, false, text);
  }
});

test("wav encoder writes a valid 16 kHz mono header", () => {
  const x = resample(new Float32Array(48000).fill(0.25), 48000, 16000);
  assert.equal(x.length, 16000);
  const buf = encodeWav(x, 16000);
  const v = new DataView(buf);
  assert.equal(buf.byteLength, 44 + 32000);
  assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), "RIFF");
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getInt16(44, true), Math.round(0.25 * 0x7fff));
});

// ---------- vision ----------
function synthRgb({ seconds = 11, fps = 30, hz = 1.2, amp = 1, noise = 0.3, seed = 1, pulse = true }) {
  const r = rng(seed);
  const out = [];
  let t = 0;
  while (t < seconds) {
    const p = pulse ? Math.sin(2 * Math.PI * hz * t) : 0;
    const drift = 3 * Math.sin(2 * Math.PI * 0.05 * t); // slow light change
    out.push({ t, r: 150 + drift + 0.25 * amp * p + noise * gauss(r), g: 110 + drift + 0.5 * amp * p + noise * gauss(r), b: 90 + drift + 0.12 * amp * p + noise * gauss(r) });
    t += 1 / fps + (r() - 0.5) * 0.012; // +/- 6 ms jitter
  }
  return out;
}

test("rPPG: 1.2 Hz pulse with noise and jitter gives 72 +/- 3 bpm", () => {
  for (const seed of [1, 2, 3]) {
    const e = estimateBpm(synthRgb({ seed }));
    assert.ok(e.bpm != null, `seed ${seed}: no estimate (quality ${e.quality})`);
    assert.ok(Math.abs(e.bpm - 72) <= 3, `seed ${seed}: got ${e.bpm}`);
    assert.ok(e.quality >= 0.35);
  }
});

test("rPPG: pure noise gives low quality and no number", () => {
  for (const seed of [4, 5, 6, 7]) {
    const e = estimateBpm(synthRgb({ seed, pulse: false, noise: 1.0 }));
    assert.equal(e.bpm, null, `seed ${seed}: got ${e.bpm} q ${e.quality}`);
    assert.ok(e.quality < 0.35);
  }
});

test("rPPG tracker keeps a window and smooths", () => {
  const tr = new PulseTracker(11);
  for (const s of synthRgb({ seconds: 20, seed: 9 })) tr.push(s);
  assert.ok(tr.samples[tr.samples.length - 1].t - tr.samples[0].t <= 11.05);
  const e = tr.estimate();
  assert.ok(Math.abs(e.smoothed - 72) <= 3);
});

// ---------- director ----------
test("intent matcher maps 24 phrases to the right commands", () => {
  const table = [
    ["show me my heart", [{ cmd: "point_to", zone: "heart" }]],
    ["what's wrong with my eyes", [{ cmd: "point_to", zone: "eyes" }]],
    ["show me my chest", [{ cmd: "point_to", zone: "lungs" }]],
    ["how is my brain", [{ cmd: "point_to", zone: "head" }]],
    ["look at my head", [{ cmd: "point_to", zone: "head" }]],
    ["check my stomach", [{ cmd: "point_to", zone: "gut" }]],
    ["show me my legs", [{ cmd: "point_to", zone: "bones" }]],
    ["what is wrong with my muscles", [{ cmd: "point_to", zone: "bones" }]],
    ["show my lungs", [{ cmd: "point_to", zone: "lungs" }]],
    ["open radiation", [{ cmd: "open_screen", name: "radiation" }]],
    ["show me the space weather", [{ cmd: "open_screen", name: "radiation" }]],
    ["show my heart rate trend", [{ cmd: "show_chart", metric: "heart_rate" }]],
    ["glucose history", [{ cmd: "show_chart", metric: "glucose" }]],
    ["show my blood pressure chart", [{ cmd: "show_chart", metric: "bp" }]],
    ["run a full scan", [{ cmd: "start_scan" }]],
    ["scan me", [{ cmd: "start_scan" }]],
    ["open the health log", [{ cmd: "open_screen", name: "health_log" }]],
    ["log my health", [{ cmd: "open_screen", name: "health_log" }]],
    ["go back", [{ cmd: "close" }]],
    ["start orb calm", [{ cmd: "open_screen", name: "orb_calm" }]],
    ["show me the hardware", [{ cmd: "open_screen", name: "hardware" }]],
    ["let me see you", [{ cmd: "open_screen", name: "vision" }, { cmd: "start_scan" }]],
    ["start the cognitive check", [{ cmd: "open_screen", name: "cognitive" }]],
    ["play aurora run", [{ cmd: "open_screen", name: "aurora_run" }]],
    ["open the greenhouse", [{ cmd: "open_screen", name: "greenhouse" }]],
    ["show the radiation layer", [{ cmd: "show_radiation", on: true }]],
  ];
  assert.ok(table.length >= 20);
  for (const [phrase, cmds] of table) {
    const r = matchIntent(phrase);
    assert.ok(r, `no match for "${phrase}"`);
    assert.deepEqual(r.commands, cmds, phrase);
  }
  assert.equal(matchIntent("how is the cabin").local, "cabin");
  assert.equal(matchIntent("stop").local, "stop");
});

test("intent matcher rejects unrelated phrases", () => {
  for (const p of ["how am I doing", "tell me a joke", "what time is it on earth", "I feel tired today", "thank you", "who won the football", ""]) {
    assert.equal(matchIntent(p), null, p);
  }
});

test("command validator drops unknown commands and zones and keeps valid ones", () => {
  const out = validateCommands([
    { cmd: "point_to", zone: "eyes" }, { cmd: "launch" }, { cmd: "point_to", zone: "tail" },
    { cmd: "open_screen", name: "settings" }, { cmd: "open_screen", name: "radiation" }, null, "close",
  ]);
  assert.deepEqual(out, [{ cmd: "point_to", zone: "eyes" }, { cmd: "open_screen", name: "radiation" }]);
  assert.equal(validateCommands([{ cmd: "close" }, { cmd: "close" }, { cmd: "close" }, { cmd: "close" }]).length, 3);
  assert.deepEqual(validateCommands("nope"), []);
});

test("scan order is top to bottom", () => {
  const anchors = { bones: { x: 200, y: 455 }, heart: { x: 218, y: 268 }, head: { x: 200, y: 56 }, gut: { x: 200, y: 372 }, eyes: { x: 200, y: 92 }, lungs: { x: 160, y: 240 } };
  assert.deepEqual(scanOrder(anchors), ["head", "eyes", "lungs", "heart", "gut", "bones"]);
});

// ---------- experience ----------
test("Orb Calm: 96 -> 70 over 40 s goes red to blue and clears with a recovery time", () => {
  const s = createCalm(96, null, 0);
  const phases = [];
  let last;
  for (let t = 0; t <= 40; t += 0.5) {
    const hr = 96 - (26 * t) / 40;
    last = updateCalm(s, hr, t);
    if (!phases.includes(last.phase)) phases.push(last.phase);
  }
  assert.deepEqual(phases, ["red", "amber", "blue"]);
  assert.equal(last.cleared, true);
  assert.ok(last.recoverySec > 0 && last.recoverySec <= 40, `recovery ${last.recoverySec}`);
  assert.ok(last.visual.hue > 200 && last.visual.hue < 230, "ends calm blue");
});

test("Orb Calm: target is baseline or start minus 10%, whichever is lower", () => {
  assert.equal(createCalm(100, 70).target, 70);
  assert.equal(createCalm(100, 95).target, 90);
});

test("Orb Calm: no clear without a 10 s hold", () => {
  const s = createCalm(90, null, 0);
  let r;
  for (let t = 0; t < 9; t += 0.5) r = updateCalm(s, 70, t);
  assert.equal(r.cleared, false);
  r = updateCalm(s, 70, 10.1);
  assert.equal(r.cleared, true);
});

test("Aurora: path is wider for in-time breathing", () => {
  const inTime = [], outTime = [];
  for (let t = 0; t < 20; t += 0.1) {
    const ph = pacer(t).phase;
    inTime.push({ phase: ph, holding: ph === "in" });
    outTime.push({ phase: ph, holding: ph !== "in" });
  }
  assert.ok(pathWidth(breathSync(inTime)) > pathWidth(breathSync(outTime)));
  assert.ok(pathWidth(1, 60, 70) > pathWidth(1, 80, 70));
});

test("Aurora: mood 2 before and 4 after records +2", () => {
  assert.equal(moodChange(2, 4), 2);
  assert.equal(sessionSummary({ moodBefore: 2, moodAfter: 4 }).mood_change, 2);
});

test("Greenhouse: grows on a completed day, wilts at most one, never below zero", () => {
  assert.equal(greenhouseDay(2, true), 3);
  assert.equal(greenhouseDay(3, false), 2);
  assert.equal(greenhouseDay(0, false), 0);
  let s = 1;
  for (let i = 0; i < 5; i++) s = greenhouseDay(s, false);
  assert.equal(s, 0);
  assert.equal(greenhouseCalm(2), 3);
  assert.equal(greenhouseDay(8, true), 8);
});

test("cognitive check: median excludes false starts", () => {
  assert.equal(medianReaction([{ ms: 300 }, { ms: 50, falseStart: true }, { ms: 340 }, { ms: 320 }]), 320);
  assert.equal(medianReaction([{ falseStart: true }]), null);
});
