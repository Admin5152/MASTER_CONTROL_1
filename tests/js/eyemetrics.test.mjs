// Eye measurements: blink counting and smooth pursuit, on synthetic signals with known answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blinks, pursuit } from "../../app/js/vision/eyemetrics.js";

const series = (seconds, fs, f) => Array.from({ length: Math.round(seconds * fs) }, (_, i) => f(i / fs));

test("counts complete and incomplete blinks and the rate a minute", () => {
  // 30 s at 30 fps, eyes open at 0.30; full blinks at 2, 6, 10, 14, 18, 22 s and half blinks at 26, 28 s
  const full = [2, 6, 10, 14, 18, 22], half = [26, 28];
  const s = series(30, 30, (t) => ({ t, open: full.some((b) => Math.abs(t - b) < 0.08) ? 0.05 : half.some((b) => Math.abs(t - b) < 0.08) ? 0.19 : 0.30 }));
  const b = blinks(s);
  assert.equal(b.count, 8);
  assert.equal(b.incomplete, 2);
  assert.ok(Math.abs(b.rate - 16) < 0.6, `rate ${b.rate}`);
});

test("closing the eyes on purpose is not a blink", () => {
  const s = series(10, 30, (t) => ({ t, open: t > 3 && t < 5 ? 0.04 : 0.3 }));
  assert.equal(blinks(s).count, 0);
});

test("eyes that follow the dot closely, a little late, score high with the right lag", () => {
  const s = series(12, 30, (t) => ({ t, dot: Math.sin(2 * Math.PI * 0.35 * t), iris: 0.5 + 0.18 * Math.sin(2 * Math.PI * 0.35 * (t - 0.15)) }));
  const p = pursuit(s);
  assert.ok(p.corr > 0.98, `corr ${p.corr}`);
  assert.ok(Math.abs(p.lag_ms - 150) <= 40, `lag ${p.lag_ms}`);
});

test("eyes that wander score low", () => {
  let x = 0.5, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const s = series(12, 30, (t) => ({ t, dot: Math.sin(2 * Math.PI * 0.35 * t), iris: (x += rnd() * 0.02) }));
  assert.ok(pursuit(s).corr < 0.6);
});
