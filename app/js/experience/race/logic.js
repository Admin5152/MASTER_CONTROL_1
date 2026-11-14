// Space race: pure game logic (no DOM, no three.js), tested with node --test.
// The player and the ghost racers move along a closed track by distance; lateral position is handled
// by the renderer. Each planet's beacon gives its own power-up (brief section 7 item 4).

/** Power-ups by planet. seconds = how long the effect lasts. */
export const POWERUPS = {
  earth: { name: "Shield", seconds: 6, shield: true, blurb: "Asteroids bounce off" },
  mars: { name: "Boost", seconds: 3, speedMul: 1.6, blurb: "A burst of speed" },
  jupiter: { name: "Slingshot", seconds: 6, magnet: 7, speedMul: 1.25, speedSeconds: 2, blurb: "A gravity kick, then pickups are pulled in" },
  saturn: { name: "Ring dash", seconds: 0.8, speedMul: 2.6, blurb: "A short dash" },
  moon: { name: "Low gravity", seconds: 5, rivalsScale: 0.6, blurb: "Everyone else drifts in slow motion" },
};
export const PLANETS = Object.keys(POWERUPS);
export const HIT_SLOW = { seconds: 1.0, speedMul: 0.6 };
export const PICKUP_RADIUS = 1.7;
export const OBSTACLE_RADIUS = 1.6;

/** A calm heart rate (at or below the person's baseline) steadies the handling a little. */
export function focusBonus(hr, baseline) {
  if (hr == null || baseline == null || !(baseline > 0)) return 1;
  return hr <= baseline ? 1.15 : hr <= baseline * 1.1 ? 1.05 : 1;
}

export function createRacer({ name = "you", baseSpeed = 25, trackLength = 1000, laps = 3, gates = 8 } = {}) {
  return { name, baseSpeed, trackLength, laps, gates, dist: 0, effects: {}, slowUntil: -1, splits: [], lapTimes: [], finished: null, lastGate: 0, hits: 0, absorbed: 0, pickups: 0 };
}

/** Start a power-up at time t. Returns the power-up definition. */
export function activate(r, planet, t) {
  const p = POWERUPS[planet];
  if (!p) return null;
  r.effects[planet] = { start: t, until: t + p.seconds };
  r.pickups++;
  return p;
}

export function isActive(r, planet, t) {
  const e = r.effects[planet];
  return !!e && t >= e.start && t < e.until;
}

/** Active power-ups at time t, with seconds left: [{planet, name, left, fraction}]. */
export function activeEffects(r, t) {
  return Object.entries(r.effects).filter(([p]) => isActive(r, p, t)).map(([p, e]) => ({
    planet: p, name: POWERUPS[p].name, left: e.until - t, fraction: (e.until - t) / POWERUPS[p].seconds,
  }));
}

export function speedMultiplier(r, t) {
  let m = 1;
  for (const [p, e] of Object.entries(r.effects)) {
    if (!isActive(r, p, t)) continue;
    const def = POWERUPS[p];
    if (!def.speedMul) continue;
    if (def.speedSeconds && t - e.start > def.speedSeconds) continue;
    m *= def.speedMul;
  }
  if (t < r.slowUntil) m *= HIT_SLOW.speedMul;
  return m;
}

/** Time scale applied to the rivals by the player's power-ups (Moon: slow motion). */
export function rivalTimeScale(r, t) {
  return isActive(r, "moon", t) ? POWERUPS.moon.rivalsScale : 1;
}

export function pickupRadius(r, t) {
  return isActive(r, "jupiter", t) ? POWERUPS.jupiter.magnet : PICKUP_RADIUS;
}

/** An asteroid hit: the shield absorbs it, otherwise a short slow-down. Never a crash or a game over. */
export function hitObstacle(r, t) {
  if (isActive(r, "earth", t)) { r.absorbed++; return "absorbed"; }
  r.slowUntil = t + HIT_SLOW.seconds;
  r.hits++;
  return "slowed";
}

/** Move a racer forward. Returns events: {type: "gate", gate, lap, time} | {type: "lap", lap, time} | {type: "finish", time}. */
export function advance(r, dt, t, { scale = 1, focus = 1, throttle = 1 } = {}) {
  const events = [];
  if (r.finished != null) return events;
  const before = r.dist;
  r.dist += r.baseSpeed * speedMultiplier(r, t) * scale * throttle * dt;   // focus only steadies the handling (renderer)
  const L = r.trackLength, gateLen = L / r.gates;
  const g0 = Math.floor(before / gateLen), g1 = Math.floor(r.dist / gateLen);
  for (let g = g0 + 1; g <= g1; g++) {
    const lap = Math.ceil(g / r.gates - 1e-9);          // the lap this gate belongs to (the line closes it)
    const atLine = g % r.gates === 0;
    const frac = (g * gateLen - before) / Math.max(1e-9, r.dist - before);
    const time = t - dt + dt * frac;                     // the moment the gate was crossed, inside this step
    r.splits.push({ gate: g % r.gates, lap, time });
    events.push({ type: "gate", gate: g % r.gates, lap, time });
    if (atLine) {
      const prev = r.lapTimes.reduce((a, b) => a + b, 0);
      r.lapTimes.push(time - prev);
      events.push({ type: "lap", lap, time });
      if (lap >= r.laps) { r.finished = time; r.dist = L * r.laps; events.push({ type: "finish", time }); break; }
    }
  }
  return events;
}

export function lapOf(r) { return Math.min(r.laps, Math.floor(r.dist / r.trackLength) + 1); }

/** Positions: finished racers by finish time, then everyone else by distance. Returns names, first place first. */
export function standings(racers) {
  return [...racers].sort((a, b) => {
    if (a.finished != null && b.finished != null) return a.finished - b.finished;
    if (a.finished != null) return -1;
    if (b.finished != null) return 1;
    return b.dist - a.dist;
  }).map((r) => r.name);
}

export function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

/** Session record for the wellbeing log (mood is LIVE: entered by the person). */
export function raceSession({ moodBefore, moodAfter, time, position, minutes }) {
  const change = moodBefore != null && moodAfter != null ? moodAfter - moodBefore : null;
  return { mood_before: moodBefore, mood_after: moodAfter, mood_change: change, time_s: Math.round(time * 10) / 10, position, minutes: Math.round(minutes * 10) / 10 };
}

export function fmtTime(s) {
  if (s == null || !Number.isFinite(s)) return "0:00.0";
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

// ---------------- Boost, slipstream, near misses ----------------
/** Boost charges from clean flying: each gate, time in a rival's slipstream, and near misses. */
export const BOOST = { max: 1, start: 0.35, gate: 0.18, draftPerS: 0.3, nearMiss: 0.15, burnPerS: 0.5, speedMul: 1.45, draftMul: 1.08 };

export function createBoost() { return { charge: BOOST.start, active: false, used: 0, nearMisses: 0, draftS: 0 }; }

export function chargeBoost(b, amount) { b.charge = Math.min(BOOST.max, b.charge + amount); return b.charge; }

/** Burn boost while held. Returns the speed multiplier for this frame. A burst needs a little charge to start. */
export function tickBoost(b, dt, held) {
  if (held && b.charge > (b.active ? 0 : 0.08)) {
    if (!b.active) b.used++;
    b.active = true;
    b.charge = Math.max(0, b.charge - BOOST.burnPerS * dt);
  } else b.active = false;
  if (b.charge <= 0) b.active = false;
  return b.active ? BOOST.speedMul : 1;
}

/** In a rival's slipstream: close behind it (by track distance) and lined up with it. */
export function inSlipstream(me, rival) {
  const gap = rival.dist - me.dist;
  return gap > 1.5 && gap < 14 && Math.hypot(me.x - rival.x, me.y - rival.y) < 2.6;
}

/** A near miss: passing an asteroid just outside the hit radius. */
export function isNearMiss(lateral) { return lateral >= OBSTACLE_RADIUS && lateral < OBSTACLE_RADIUS + 1.3; }

/** Compare cumulative lap times with a personal best: seconds ahead (negative) or behind (positive). */
export function pbDelta(lapTimes, pbLaps) {
  if (!pbLaps?.length || !lapTimes.length || lapTimes.length > pbLaps.length) return null;
  const sum = (a, n) => a.slice(0, n).reduce((x, y) => x + y, 0);
  return Math.round((sum(lapTimes, lapTimes.length) - sum(pbLaps, lapTimes.length)) * 10) / 10;
}
