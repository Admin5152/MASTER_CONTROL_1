// Procedural SVG art for the Mars Greenhouse crops. plantArt(crop, growth 0..1, {dry, health}) -> <g>.
// viewBox 0 0 100 100, the pod's grow medium sits at y = 86. Pure string building: no DOM.

const GROUND = 86;
const ease = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 2);
const r1 = (n) => Math.round(n * 10) / 10;

function leafPath(len, wid) {
  // a leaf pointing up from the origin
  return `M0 0 C ${r1(-wid)} ${r1(-len * 0.35)} ${r1(-wid * 0.7)} ${r1(-len * 0.85)} 0 ${r1(-len)} C ${r1(wid * 0.7)} ${r1(-len * 0.85)} ${r1(wid)} ${r1(-len * 0.35)} 0 0Z`;
}

function rosette(g, droop, { n, len, wid, cols, spread = 70, vein = true }) {
  const out = [];
  const count = Math.max(2, Math.round(n * (0.35 + 0.65 * g)));
  for (let i = 0; i < count; i++) {
    const k = count === 1 ? 0.5 : i / (count - 1);
    const ang = (k - 0.5) * spread * 2 * (0.5 + 0.5 * g);
    const a = ang + Math.sign(ang || 1) * droop * 35;
    const L = len * (0.45 + 0.55 * g) * (0.8 + 0.2 * Math.sin(i * 2.3 + 1));
    const c = cols[i % cols.length];
    out.push(`<g transform="translate(50 ${GROUND}) rotate(${r1(a)})"><path d="${leafPath(L, wid * (0.5 + 0.5 * g))}" fill="${c}"/>${vein ? `<path d="M0 0 L0 ${r1(-L * 0.85)}" stroke="rgba(255,255,255,.18)" stroke-width=".8"/>` : ""}</g>`);
  }
  return out.join("");
}

function stem(h, droop, col = "#5fae5a", w = 2.4) {
  const tipX = 50 + droop * 14;
  return { svg: `<path d="M50 ${GROUND} Q ${r1(50 + droop * 4)} ${r1(GROUND - h * 0.6)} ${r1(tipX)} ${r1(GROUND - h)}" stroke="${col}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`, tip: [tipX, GROUND - h] };
}

const ART = {
  lettuce(g, d) {
    return rosette(g, d, { n: 9, len: 34, wid: 13, cols: ["#7a2a3e", "#a3354f", "#5f8f3e", "#8e2f47"], spread: 75 });
  },
  mizuna(g, d) {
    const out = [];
    const n = Math.round(6 + 10 * g);
    for (let i = 0; i < n; i++) {
      const a = ((i / (n - 1)) - 0.5) * 120 + d * 40 * Math.sign(i - n / 2 || 1);
      const L = (14 + 26 * g) * (0.75 + 0.25 * Math.sin(i * 1.7));
      // a thin stalk with small serrated lobes
      const lobes = [0.45, 0.65, 0.85].map((f, j) => `<path d="M0 ${r1(-L * f)} l ${j % 2 ? 4 : -4} -3 l ${j % 2 ? -3 : 3} -1z" fill="#6cc25a"/>`).join("");
      out.push(`<g transform="translate(50 ${GROUND}) rotate(${r1(a)})"><path d="M0 0 L0 ${r1(-L)}" stroke="#7fd36b" stroke-width="1.6"/>${g > 0.25 ? lobes : ""}</g>`);
    }
    return out.join("");
  },
  bekana(g, d) {
    return rosette(g, d, { n: 8, len: 32, wid: 16, cols: ["#a8d86a", "#8cc753", "#bfe381"], spread: 65 });
  },
  radish(g, d) {
    const bulb = g > 0.55 ? `<ellipse cx="50" cy="${GROUND - 1}" rx="${r1(3 + 6 * ease((g - 0.55) / 0.45))}" ry="${r1(3 + 5 * ease((g - 0.55) / 0.45))}" fill="#d8264f"/><path d="M50 ${GROUND + 4} l0 6" stroke="#f3d2da" stroke-width="1"/>` : "";
    return bulb + rosette(g, d, { n: 6, len: 26, wid: 9, cols: ["#4f9d43", "#62b552"], spread: 55 });
  },
  zinnia(g, d) {
    const s = stem(10 + 46 * g, d);
    const leaves = [0.3, 0.55].filter((f) => g > f * 0.8).map((f, i) => `<g transform="translate(${r1(50 + d * 14 * f)} ${r1(GROUND - (10 + 46 * g) * f)}) rotate(${i % 2 ? 60 + d * 30 : -60 - d * 30})"><path d="${leafPath(12, 5)}" fill="#5aa64c"/></g>`).join("");
    let flower = "";
    if (g > 0.72) {
      const k = ease((g - 0.72) / 0.28), [x, y] = s.tip;
      const petals = Array.from({ length: 12 }, (_, i) => `<ellipse cx="${r1(x)}" cy="${r1(y - 5 * k)}" rx="${r1(2 * k)}" ry="${r1(5.5 * k)}" fill="${i % 2 ? "#ff7b39" : "#ff9a52"}" transform="rotate(${i * 30} ${r1(x)} ${r1(y)})"/>`).join("");
      flower = `${petals}<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(2.6 * k)}" fill="#ffd35a"/>`;
    } else if (g > 0.5) flower = `<circle cx="${r1(s.tip[0])}" cy="${r1(s.tip[1])}" r="2.2" fill="#7bbf5a"/>`;
    return s.svg + leaves + flower;
  },
  pepper(g, d) {
    const h = 12 + 44 * g;
    const s = stem(h, d, "#4e8f43", 3);
    const branches = [0.35, 0.55, 0.75, 0.9].filter((f) => g > f * 0.7).map((f, i) => {
      const x = 50 + d * 14 * f, y = GROUND - h * f, side = i % 2 ? 1 : -1;
      return `<g transform="translate(${r1(x)} ${r1(y)}) rotate(${side * (55 + d * 30)})"><path d="${leafPath(13, 6)}" fill="${i % 2 ? "#4f9d43" : "#5fb14f"}"/></g>`;
    }).join("");
    const fruit = g > 0.62 ? [0.42, 0.62].map((f, i) => {
      const k = ease((g - 0.62) / 0.38), x = 50 + d * 14 * f + (i ? 7 : -7), y = GROUND - h * f + 4;
      const col = g > 0.9 ? "#d8261f" : "#4fa83a";
      return `<path d="M${r1(x)} ${r1(y)} q ${r1(3 * k)} ${r1(6 * k)} 0 ${r1(13 * k)} q ${r1(-3 * k)} ${r1(-7 * k)} 0 ${r1(-13 * k)}z" fill="${col}"/>`;
    }).join("") : "";
    return s.svg + branches + fruit;
  },
};

/** SVG group for a crop at a growth stage. */
export function plantArt(crop, growth, { dry = false, health = 1 } = {}) {
  if (!crop || !ART[crop]) return "";
  const g = Math.max(0.04, Math.min(1, growth));
  const droop = dry ? 0.7 : Math.max(0, (1 - health) * 0.6);
  const sat = dry ? "saturate(.55) brightness(.85)" : "none";
  if (g < 0.08) return `<g><path d="M50 ${GROUND} q -3 -6 -6 -7 M50 ${GROUND} q 3 -6 6 -7" stroke="#7fd36b" stroke-width="2" fill="none" stroke-linecap="round"/></g>`;
  return `<g style="filter:${sat}">${ART[crop](g, droop)}</g>`;
}

/** A small icon of the mature crop for the seed picker. */
export function cropIcon(crop) {
  return `<svg viewBox="10 20 80 76" aria-hidden="true">${plantArt(crop, 1)}<rect x="22" y="86" width="56" height="6" rx="3" fill="#3a2a26"/></svg>`;
}
