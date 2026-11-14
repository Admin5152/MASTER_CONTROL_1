// node --test tests/js : the wellbeing games' pure logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as F from "../../app/js/experience/mars/farm.js";
import { PATTERNS, breathAt, calmSummary } from "../../app/js/experience/logic.js";
import * as R from "../../app/js/experience/race/logic.js";

// ---------- Mars Colony Farm ----------
test("farm: a new farm has three planters, starter coins, three orders it can eventually fill", () => {
  const f = F.createFarm(0);
  assert.equal(f.owned, 3);
  assert.equal(f.orders.length, 3);
  for (const o of f.orders) for (const c of Object.keys(o.items)) assert.ok(F.CROPS[c].lvl <= f.level, `order needs locked crop ${c}`);
});

test("farm: plant, get thirsty halfway, water, harvest two into the store", () => {
  const f = F.createFarm(0);
  assert.ok(F.plant(f, 0, "radish"));
  assert.equal(f.reserve, 5);
  let t = 0, ev = [];
  for (let k = 0; k < 40; k++) { t += 0.5; ev.push(...F.step(f, 0.5, t)); }
  assert.ok(f.pods[0].thirsty, "a crop pauses halfway until watered");
  assert.equal(f.pods[0].growth, 0.5);
  assert.ok(ev.some((e) => e.type === "thirsty"));
  assert.ok(F.water(f, 0));
  for (let k = 0; k < 40; k++) { t += 0.5; ev.push(...F.step(f, 0.5, t)); }
  assert.equal(F.podStatus(f, 0), "ready");
  const h = F.harvest(f, 0);
  assert.equal(h.n, 2);
  assert.equal(f.store.radish, 2);
  assert.ok(h.first);
  assert.equal(F.podStatus(f, 0), "empty");
});

test("farm: locked crops and unowned planters cannot be planted", () => {
  const f = F.createFarm(0);
  assert.equal(F.plant(f, 0, "pepper"), false);
  assert.equal(F.plant(f, 5, "radish"), false);
  assert.equal(F.podStatus(f, 3), "buy");
  assert.equal(F.podStatus(f, 4), "locked");
});

test("farm: filling an order pays coins and XP, takes the crops, and posts a new order", () => {
  const f = F.createFarm(0);
  const o = f.orders[0];
  for (const [c, q] of Object.entries(o.items)) f.store[c] = q;
  const coins0 = f.coins;
  const r = F.fillOrder(f, 0);
  assert.ok(r);
  assert.equal(f.coins, coins0 + o.coins);
  for (const c of Object.keys(o.items)) assert.equal(f.store[c], 0);
  assert.equal(f.orders.length, 3);
  assert.equal(F.fillOrder(f, 0) === null || F.canFill(f, f.orders[0]), true);
});

test("farm: XP levels up and unlocks crops", () => {
  const f = F.createFarm(0);
  assert.deepEqual(F.unlockedCrops(f), ["radish", "lettuce"]);
  assert.ok(F.addXp(f, F.xpForLevel(1)));
  assert.equal(f.level, 2);
  assert.ok(F.unlockedCrops(f).includes("mizuna"));
});

test("farm: coins buy planters and upgrades; LEDs speed growth; the tank grows", () => {
  const f = F.createFarm(0);
  f.coins = 1000;
  assert.ok(F.buyPlanter(f));
  assert.equal(f.owned, 4);
  const m0 = F.growMul(f, 0);
  assert.ok(F.buyUpgrade(f, "led"));
  assert.ok(F.growMul(f, 0) > m0);
  const t0 = F.tankSize(f);
  assert.ok(F.buyUpgrade(f, "tank"));
  assert.ok(F.tankSize(f) > t0);
  f.up.solar = 3;
  assert.equal(F.upgradeCost(f, "solar"), null);
});

test("farm: dust and storms cut the powered planters; cleaning restores them", () => {
  const f = F.createFarm(0);
  const clean = F.poweredSlots(f);
  f.dust = 1;
  assert.ok(F.poweredSlots(f) < clean);
  assert.ok(F.cleanPanels(f));
  assert.equal(F.poweredSlots(f), clean);
  F.startStorm(f, 0, 10);
  assert.ok(F.poweredSlots(f) < clean);
  F.step(f, 11, 11);
  assert.equal(f.storm, null);
});

test("farm: a sunlamp doubles growth for a while; calm sessions grant sunlamps once each", () => {
  const f = F.createFarm(0);
  assert.equal(F.syncSunlamps(f, 2), 2);
  assert.equal(F.syncSunlamps(f, 2), 0);
  const base = F.growMul(f, 0);
  assert.ok(F.useSunlamp(f, 0));
  assert.equal(F.growMul(f, 1), base * 2);
  assert.equal(F.growMul(f, F.SUNLAMP_S + 1), base);
});

test("farm: save and load round-trip; old saves start fresh", () => {
  const f = F.createFarm(0);
  F.plant(f, 1, "lettuce");
  const g = F.loadFarm(JSON.parse(JSON.stringify(f)), 0);
  assert.equal(g.pods[1].crop, "lettuce");
  assert.equal(F.loadFarm({ v: 1, pods: [] }, 0).v, 2);
});

test("farm: Mars time is sane", () => {
  const m = F.marsTime(Date.UTC(2026, 10, 14));
  assert.ok(m.sol > 54000 && m.sol < 55000);
  assert.ok(m.hours >= 0 && m.hours < 24);
});

// ---------- Orb Calm ----------
test("breathing patterns run at the advertised rate and volume rises then falls", () => {
  for (const p of Object.values(PATTERNS)) {
    const cyc = p.steps.reduce((a, s) => a + s[1], 0);
    assert.ok(Math.abs(60 / cyc - p.bpm) < 0.05, `${p.name}: ${60 / cyc}`);
  }
  const s = PATTERNS.sigh;
  assert.equal(breathAt(s, 0).phase, "in");
  assert.ok(breathAt(s, 2.5).volume > breathAt(s, 1).volume);
  assert.equal(breathAt(s, 4).phase, "out");
  assert.ok(breathAt(s, 8.9).volume < 0.05);
});

test("calm summary: drop and time under target", () => {
  const s = calmSummary([{ t: 0, hr: 90 }, { t: 1, hr: 90 }, { t: 2, hr: 88 }, { t: 3, hr: 80 }, { t: 4, hr: 78 }, { t: 5, hr: 78 }], 80);
  assert.ok(s.drop > 8);
  assert.equal(s.inTargetS, 3);
});

// ---------- race ----------
test("race: boost charges, burns while held, needs charge to start", () => {
  const b = R.createBoost();
  assert.equal(R.tickBoost(b, 0.1, true), R.BOOST.speedMul);
  for (let k = 0; k < 40; k++) R.tickBoost(b, 0.1, true);
  assert.equal(b.charge, 0);
  assert.equal(R.tickBoost(b, 0.1, true), 1);
  R.chargeBoost(b, 5);
  assert.equal(b.charge, 1);
});

test("race: slipstream, near miss and PB delta", () => {
  assert.ok(R.inSlipstream({ dist: 100, x: 0, y: 0 }, { dist: 105, x: 0.5, y: 0 }));
  assert.ok(!R.inSlipstream({ dist: 100, x: 0, y: 0 }, { dist: 130, x: 0, y: 0 }));
  assert.ok(R.isNearMiss(R.OBSTACLE_RADIUS + 0.5));
  assert.ok(!R.isNearMiss(R.OBSTACLE_RADIUS - 0.1));
  assert.equal(R.pbDelta([50, 50], [52, 51, 50]), -3);
  assert.equal(R.pbDelta([50], null), null);
});
