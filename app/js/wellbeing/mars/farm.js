// Mars Colony Farm: pure game logic (no DOM), tested with node --test.
// The loop (the Hay Day pattern): plant -> tend (crops get thirsty halfway) -> harvest into the store ->
// fill crew ORDERS for coins and XP -> level up to unlock crops -> spend coins on more planters and on
// upgrades (LEDs grow faster, a bigger water tank, more solar panels). Dust settles on the solar array and
// must be cleaned (as NASA's rovers needed); dust storms halve the power for a while. Nothing ever dies or
// is lost. Sunlamp boosts come from looking after yourself (an Orb Calm session, a daily check-in): a game
// reward for self-care, not a claim that breathing grows plants. Every crop has really been grown in space.

export const MAX_PODS = 9;
export const START_PODS = 3;
export const POD_WATTS = 120;
export const WATER_COST = 1;            // litres to sow, and again to water a thirsty crop
export const RECOVER_PER_S = 1 / 8;     // the water recovery system: one litre every 8 s
export const DUST_PER_S = 1 / 240;      // solar panels lose efficiency as dust settles
export const SUNLAMP_S = 45;
export const OFFLINE_CAP_S = 2 * 3600;

/** grow = seconds to harvest; lvl = level that unlocks it; coins/xp = value per item in an order. */
export const CROPS = {
  radish: { name: "Radish", variety: "Cherry Belle", grow: 20, lvl: 1, coins: 4, xp: 2, color: "#d8264f",
    fact: "Cherry Belle radishes were harvested in NASA's Advanced Plant Habitat on the ISS in 2020 (Plant Habitat-02)." },
  lettuce: { name: "Red romaine", variety: "Outredgeous", grow: 35, lvl: 1, coins: 7, xp: 3, color: "#a3354f",
    fact: "In August 2015 ISS crew ate Outredgeous red romaine grown in the Veggie unit: NASA astronauts' first taste of space-grown lettuce." },
  mizuna: { name: "Mizuna", variety: "mustard greens", grow: 30, lvl: 2, coins: 6, xp: 3, color: "#6cc25a",
    fact: "Mizuna mustard was grown in Veggie for the VEG-04 study, which also asked the crew how the plants made them feel." },
  bekana: { name: "Chinese cabbage", variety: "Tokyo Bekana", grow: 45, lvl: 3, coins: 10, xp: 5, color: "#a8d86a",
    fact: "Tokyo Bekana Chinese cabbage was grown and eaten on the ISS in the VEG-03 series." },
  zinnia: { name: "Zinnia", variety: "flowers", grow: 60, lvl: 4, coins: 14, xp: 7, color: "#ff8a3d",
    fact: "Zinnias flowered on the ISS in January 2016 after the crew nursed them back from mould." },
  pepper: { name: "Chile pepper", variety: "Española Improved", grow: 90, lvl: 5, coins: 22, xp: 11, color: "#d8261f",
    fact: "Española Improved chile peppers were grown in the Advanced Plant Habitat in 2021; the crew made tacos with them." },
};
export const CROP_IDS = Object.keys(CROPS);

/** Upgrades: three levels each. */
export const UPGRADES = {
  led: { name: "Grow LEDs", blurb: "Crops grow faster", cost: [40, 120, 300], effect: (l) => 1 + 0.25 * l },
  tank: { name: "Water tank", blurb: "Holds more water", cost: [30, 90, 220], effect: (l) => 6 + 4 * l },
  solar: { name: "Solar array", blurb: "Powers more planters", cost: [50, 140, 320], effect: (l) => 3 + 2 * l },
};
export const POD_COST = [0, 0, 0, 25, 50, 90, 150, 240, 360];   // price of planter n (the first three are free)

const CREW = ["Eliah", "Seth", "Sad", "Stanley", "Annie", "Gadiel"];
const DISHES = [["salad", 2], ["stir-fry", 3], ["soup", 3], ["tacos", 2], ["snack", 1], ["bouquet", 1]];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const emptyPod = () => ({ crop: null, growth: 0, thirsty: false, watered: false });

// ---------------- stations: three real sites, each with its own climate ----------------
/** Real landing sites. lon/lat in degrees (east positive); temperatures are an approximate typical sol
 *  (from the rover/lander weather stations); solar, water and dust are game multipliers based on each site's
 *  real situation. */
export const STATIONS = {
  jezero: { name: "Jezero Crater", where: "18.4° N, 77.5° E · Perseverance", lat: 18.4, lon: 77.5, tAvg: -50, tAmp: 30, solar: 1.0, water: 1.0, dust: 1.0, cost: 0, lvl: 1,
    fact: "An ancient lake delta. Perseverance's MOXIE made oxygen from the Martian CO₂ air here (2021 to 2023)." },
  gale: { name: "Gale Crater", where: "4.6° S, 137.4° E · Curiosity", lat: -4.6, lon: 137.4, tAvg: -45, tAmp: 45, solar: 1.15, water: 0.7, dust: 1.2, cost: 120, lvl: 3,
    fact: "Near the equator: the most sunlight, but very dry. Curiosity's REMS station has logged its weather since 2012." },
  utopia: { name: "Utopia Planitia", where: "47.6° N, 134.3° E · Viking 2", lat: 47.6, lon: 134.3, tAvg: -75, tAmp: 30, solar: 0.8, water: 2.0, dust: 0.8, cost: 260, lvl: 5,
    fact: "Cold and far north, with less sunlight, but radar on NASA's MRO found buried ice here holding about as much water as Lake Superior." },
};
export const STATION_IDS = Object.keys(STATIONS);
const STATION_FIELDS = ["pods", "owned", "up", "reserve", "dust", "storm", "climate", "last"];
const freshStation = (now) => ({ pods: Array.from({ length: MAX_PODS }, () => ({ crop: null, growth: 0, thirsty: false, watered: false })), owned: START_PODS, up: { led: 0, tank: 0, solar: 0 }, reserve: 6, dust: 0, storm: null, climate: { heat: 20, co2: 400 }, last: now });
export const station = (f) => STATIONS[f.active] || STATIONS.jezero;

export function canBuildStation(f, id) { const st = STATIONS[id]; return !!st && !f.stations[id] && id !== f.active && f.level >= st.lvl && f.coins >= st.cost; }
export function buildStation(f, id, now = 0) {
  if (!canBuildStation(f, id)) return false;
  f.coins -= STATIONS[id].cost;
  f.stations[id] = freshStation(now);
  return true;
}
/** Move to another built station: park this one, load that one and catch it up on the time away. */
export function switchStation(f, id, now = 0) {
  if (id === f.active || !f.stations[id]) return null;
  const park = {}; for (const k of STATION_FIELDS) park[k] = f[k];
  f.stations[f.active] = park;
  Object.assign(f, f.stations[id]); delete f.stations[id];
  f.active = id;
  return catchUp(f, now);
}
export function builtStations(f) { return [f.active, ...Object.keys(f.stations)].sort((a, b) => STATION_IDS.indexOf(a) - STATION_IDS.indexOf(b)); }

// ---------------- climate: real plant science ----------------
/** Local hour at the station (Mars local mean solar time = MTC + east longitude / 15). */
export function localHour(f, ms) { return ((marsTime(ms).hours + station(f).lon / 15) % 24 + 24) % 24; }
/** Outside air temperature now (°C): coldest just before dawn, warmest early afternoon. */
export function outsideTemp(f, ms) { const st = station(f), h = localHour(f, ms); return st.tAvg + st.tAmp * Math.cos((2 * Math.PI * (h - 14)) / 24); }
/** The pressurised dome holds heat and gains it from the sun: what it reaches with no heater. */
export function passiveTemp(f, ms) { return outsideTemp(f, ms) + 80 + 14 * daylight(localHour(f, ms)); }
/** Inside temperature: the heater lifts it to the setpoint; vents cool it down to the setpoint. */
export function insideTemp(f, ms) { return f.climate.heat; }
/** Power slots the climate system takes: heating (one per 20 °C lifted) and the CO₂ compressor. */
export function climateLoad(f, ms) {
  const lift = Math.max(0, f.climate.heat - passiveTemp(f, ms));
  return Math.ceil(lift / 20 - 1e-9) + (f.climate.co2 > 800 ? 1 : 0);
}
/** Cardinal-temperature growth response (Yan & Hunt 1999 beta function): 0 at 2 °C and 34 °C, 1 at 22 °C. */
export function tempFactor(T, Tmin = 2, Topt = 22, Tmax = 34) {
  if (T <= Tmin || T >= Tmax) return 0;
  return ((T - Tmin) / (Topt - Tmin)) * Math.pow((Tmax - T) / (Tmax - Topt), (Tmax - Topt) / (Topt - Tmin));
}
/** CO₂ enrichment: C3 crops grow up to about 30 % faster at 1000 to 1200 ppm than at 400 ppm (FACE and
 *  greenhouse studies); no further gain above 1200. Mars air is 95 % CO₂, so enrichment is cheap there. */
export function co2Factor(ppm) { return 1 + 0.3 * Math.max(0, Math.min(1, (ppm - 400) / 800)); }
export function climateFactor(f, ms) { return tempFactor(insideTemp(f, ms)) * co2Factor(f.climate.co2); }
export function setClimate(f, { heat, co2 }) {
  if (heat != null) f.climate.heat = Math.max(5, Math.min(32, Math.round(heat)));
  if (co2 != null) f.climate.co2 = Math.max(400, Math.min(1500, Math.round(co2 / 50) * 50));
}

export function xpForLevel(level) { return Math.round(16 * Math.pow(level, 1.45)); }

export function unlockedCrops(f) { return CROP_IDS.filter((k) => CROPS[k].lvl <= f.level); }

/** A seeded random generator so orders are reproducible in tests. */
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

export function createFarm(now = 0, seed = 7) {
  const f = {
    v: 3, active: "jezero", stations: {}, climate: { heat: 20, co2: 400 },
    last: now, seed, level: 1, xp: 0, coins: 20, pods: Array.from({ length: MAX_PODS }, emptyPod), owned: START_PODS,
    up: { led: 0, tank: 0, solar: 0 }, reserve: 6, dust: 0, storm: null, sunlampUntil: -1, sunlamps: 1, sunlampSeen: 0,
    store: {}, orders: [], ordersDone: 0, harvests: 0, firsts: [], nextOrderAt: 0,
  };
  while (f.orders.length < 3) f.orders.push(makeOrder(f));
  return f;
}

export function loadFarm(data, now = 0) {
  if (data && data.v === 2) data = { ...data, v: 3, active: "jezero", stations: {}, climate: { heat: 20, co2: 400 } };   // older saves become the Jezero station
  if (!data || data.v !== 3 || !Array.isArray(data.pods) || data.pods.length !== MAX_PODS) return createFarm(now, (now | 0) || 7);
  const f = { ...createFarm(now), ...data };
  f.pods = data.pods.map((p) => ({ ...emptyPod(), ...p, crop: CROPS[p?.crop] ? p.crop : null }));
  f.up = { led: 0, tank: 0, solar: 0, ...data.up };
  f.store = { ...data.store };
  f.climate = { heat: 20, co2: 400, ...data.climate };
  f.stations = { ...data.stations };
  if (!STATIONS[f.active]) f.active = "jezero";
  return f;
}

export function tankSize(f) { return UPGRADES.tank.effect(f.up.tank); }
export function growMul(f, now) { return UPGRADES.led.effect(f.up.led) * (now < f.sunlampUntil ? 2 : 1); }
/** How many planters the solar array can light right now (dust and storms cut it). */
export function poweredSlots(f) {
  let n = Math.round(UPGRADES.solar.effect(f.up.solar) * station(f).solar);
  n -= climateLoad(f, (f.last || 0) * 1000);
  n -= f.dust >= 0.9 ? 2 : f.dust >= 0.5 ? 1 : 0;      // dust costs a slot at 50 %, another at 90 %
  if (f.storm) n = Math.ceil(n / 2);
  return Math.max(1, n);
}
/** The planters in use, in order; only the first poweredSlots of them have light. */
export function isPowered(f, i) {
  const active = f.pods.map((p, k) => ({ p, k })).filter(({ p, k }) => k < f.owned && p.crop && p.growth < 1).map(({ k }) => k);
  const idx = active.indexOf(i);
  return idx === -1 || idx < poweredSlots(f);
}

// ---------------- orders ----------------
export function makeOrder(f) {
  const r = rng(f.seed + f.ordersDone * 97 + f.orders.length * 13 + f.level * 7);
  const crops = unlockedCrops(f);
  const [dish, n] = DISHES[Math.floor(r() * DISHES.length)];
  const kinds = Math.min(crops.length, dish === "bouquet" ? 1 : 1 + Math.floor(r() * Math.min(2, crops.length)));
  const pool = dish === "bouquet" && crops.includes("zinnia") ? ["zinnia"] : crops.filter((c) => c !== "zinnia" || dish === "bouquet");
  const items = {};
  for (let k = 0; k < kinds; k++) {
    const c = pool[Math.floor(r() * pool.length)];
    items[c] = (items[c] || 0) + Math.max(1, Math.round(n / kinds + r() * Math.min(2, f.level / 2)));
  }
  let coins = 0, xp = 0;
  for (const [c, q] of Object.entries(items)) { coins += CROPS[c].coins * q; xp += CROPS[c].xp * q; }
  return { id: `${f.ordersDone}-${f.orders.length}-${Math.floor(r() * 1e6)}`, who: CREW[Math.floor(r() * CREW.length)], dish: dish === "bouquet" && !items.zinnia ? "snack" : dish, items, coins: Math.round(coins * 1.25), xp };
}

export function canFill(f, order) { return Object.entries(order.items).every(([c, q]) => (f.store[c] || 0) >= q); }

/** Deliver an order: take the crops, pay coins and XP. Returns {coins, xp, levelUp} or null. */
export function fillOrder(f, idx, now = 0) {
  const o = f.orders[idx];
  if (!o || !canFill(f, o)) return null;
  for (const [c, q] of Object.entries(o.items)) f.store[c] -= q;
  f.coins += o.coins;
  const lv = addXp(f, o.xp);
  f.ordersDone++;
  f.orders.splice(idx, 1);
  f.orders.push(makeOrder(f));
  return { coins: o.coins, xp: o.xp, levelUp: lv, unlocked: lv ? CROP_IDS.filter((k) => CROPS[k].lvl === f.level) : [] };
}

/** Swap an order you don't want for a new one. */
export function skipOrder(f, idx) {
  if (!f.orders[idx]) return false;
  f.ordersDone++;
  f.orders.splice(idx, 1, makeOrder(f));
  return true;
}

export function addXp(f, n) {
  f.xp += n;
  let up = false;
  while (f.xp >= xpForLevel(f.level)) { f.xp -= xpForLevel(f.level); f.level++; up = true; }
  return up;
}

// ---------------- planters ----------------
export function plant(f, i, crop) {
  const p = f.pods[i];
  if (!p || i >= f.owned || p.crop || !CROPS[crop] || CROPS[crop].lvl > f.level || f.reserve < WATER_COST) return false;
  f.reserve -= WATER_COST;
  f.pods[i] = { crop, growth: 0, thirsty: false, watered: false };
  return true;
}

export function water(f, i) {
  const p = f.pods[i];
  if (!p?.thirsty || f.reserve < WATER_COST) return false;
  f.reserve -= WATER_COST;
  p.thirsty = false; p.watered = true;
  return true;
}

export function harvest(f, i) {
  const p = f.pods[i];
  if (!p?.crop || p.growth < 1) return null;
  const c = CROPS[p.crop];
  f.store[p.crop] = (f.store[p.crop] || 0) + 2;    // each planter yields two
  const first = !f.firsts.includes(p.crop);
  if (first) f.firsts.push(p.crop);
  f.harvests++;
  const levelUp = addXp(f, 1);
  const out = { crop: p.crop, n: 2, first, levelUp, fact: c.fact };
  f.pods[i] = emptyPod();
  return out;
}

export function buyPlanter(f) {
  if (f.owned >= MAX_PODS) return false;
  const cost = POD_COST[f.owned];
  if (f.coins < cost) return false;
  f.coins -= cost; f.owned++;
  return true;
}
export function nextPlanterCost(f) { return f.owned >= MAX_PODS ? null : POD_COST[f.owned]; }

export function upgradeCost(f, k) { const l = f.up[k]; return l >= 3 ? null : UPGRADES[k].cost[l]; }
export function buyUpgrade(f, k) {
  const c = upgradeCost(f, k);
  if (c == null || f.coins < c) return false;
  f.coins -= c; f.up[k]++;
  if (k === "tank") f.reserve = Math.min(tankSize(f), f.reserve + 4);
  return true;
}

export function cleanPanels(f) { if (f.dust < 0.05) return false; f.dust = 0; return true; }
export function startStorm(f, now, seconds = 40) { f.storm = { until: now + seconds }; }

export function useSunlamp(f, now) {
  if (f.sunlamps < 1 || now < f.sunlampUntil) return false;
  f.sunlamps--; f.sunlampUntil = now + SUNLAMP_S;
  return true;
}
/** Sunlamps from self-care: one per new Orb Calm session (monotonic counter from the state). */
export function syncSunlamps(f, calmCount) {
  if (calmCount > f.sunlampSeen) { const n = calmCount - f.sunlampSeen; f.sunlamps += n; f.sunlampSeen = calmCount; return n; }
  f.sunlampSeen = Math.max(f.sunlampSeen, calmCount);
  return 0;
}

// ---------------- time ----------------
/** Advance by dt seconds ending at now. Crops pause when thirsty or unpowered (they never die). */
export function step(f, dt, now) {
  if (dt <= 0) return [];
  const ev = [];
  if (f.storm && now >= f.storm.until) { f.storm = null; ev.push({ type: "storm_end" }); }
  f.reserve = Math.min(tankSize(f), f.reserve + RECOVER_PER_S * station(f).water * dt);
  const dust0 = f.dust;
  f.dust = clamp01(f.dust + DUST_PER_S * station(f).dust * dt * (f.storm ? 4 : 1));
  if (dust0 < 0.5 && f.dust >= 0.5) ev.push({ type: "dusty" });
  const mul = growMul(f, now) * climateFactor(f, now * 1000);
  f.pods.forEach((p, i) => {
    if (i >= f.owned || !p.crop || p.growth >= 1 || p.thirsty) return;
    const rate = (isPowered(f, i) ? 1 : 0.2) * mul / CROPS[p.crop].grow;
    const before = p.growth;
    p.growth = clamp01(p.growth + rate * dt);
    if (!p.watered && before < 0.5 && p.growth >= 0.5) { p.growth = 0.5; p.thirsty = true; ev.push({ type: "thirsty", pod: i, crop: p.crop }); }
    if (before < 1 && p.growth >= 1) ev.push({ type: "ready", pod: i, crop: p.crop });
  });
  f.last = now;
  return ev;
}

export function catchUp(f, now) {
  const gap = Math.min(OFFLINE_CAP_S, Math.max(0, now - f.last));
  const ev = [];
  let t = now - gap;
  while (t < now) { const dt = Math.min(5, now - t); t += dt; ev.push(...step(f, dt, t)); }
  f.last = now;
  return ev;
}

export function podStatus(f, i) {
  if (i >= f.owned) return i === f.owned ? "buy" : "locked";
  const p = f.pods[i];
  if (!p.crop) return "empty";
  if (p.growth >= 1) return "ready";
  if (p.thirsty) return "thirsty";
  return isPowered(f, i) ? "growing" : "dim";
}

export function secondsLeft(f, i, now) {
  const p = f.pods[i];
  if (!p?.crop || p.growth >= 1) return 0;
  const cf = climateFactor(f, now * 1000);
  if (cf <= 0) return Infinity;
  return Math.ceil(((1 - p.growth) * CROPS[p.crop].grow) / (growMul(f, now) * cf) / (isPowered(f, i) ? 1 : 0.2));
}

// ---------------- Mars time ----------------
/** Mars Coordinated Time from a Unix time in ms (the NASA GISS Mars24 algorithm, simplified). */
export function marsTime(ms) {
  const jdTT = ms / 86400000 + 2440587.5 + 69.184 / 86400;
  const msd = (jdTT - 2405522.0028779) / 1.0274912517;
  const mtc = ((msd % 1) + 1) % 1 * 24;
  const h = Math.floor(mtc), m = Math.floor((mtc - h) * 60);
  return { sol: Math.floor(msd), hours: mtc, label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}
export function daylight(hours) { const x = (hours - 6) / 12; return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x); }
