// The Greenhouse: a small SVG plant in a hydroponic pod. It grows with completed routine days and
// calm sessions, and wilts (never dies) after missed days.
import { esc } from "../interface/readings.js";
import { GREENHOUSE_MAX } from "./logic.js";

/** Plant SVG for a stage 0..8. wilt: 0..1 after a missed day. */
export function plantSVG(stage, wilt = 0) {
  const s = Math.max(0, Math.min(GREENHOUSE_MAX, stage));
  const h = 18 + s * 9;                  // stem height
  const droop = wilt * 14;
  const leaves = [];
  for (let i = 0; i < Math.min(s, 7); i++) {
    const y = 108 - (i + 1) * (h / (Math.min(s, 7) + 1));
    const side = i % 2 ? 1 : -1;
    const len = 12 + Math.min(i, 3) * 3;
    leaves.push(`<path d="M50 ${y} q ${side * len * 0.6} ${-8 + droop} ${side * len} ${droop}" fill="none" stroke="var(--ok)" stroke-width="5" stroke-linecap="round" opacity="${0.6 + 0.05 * i}"/>`);
  }
  const bloom = s >= GREENHOUSE_MAX ? `<circle cx="50" cy="${108 - h}" r="6" fill="var(--watch)"/>` : "";
  return `<svg viewBox="0 0 100 140" role="img" aria-label="Greenhouse plant, stage ${s} of ${GREENHOUSE_MAX}">
    <rect x="18" y="108" width="64" height="24" rx="4" fill="var(--bg-inset)" stroke="var(--line-dim)"/>
    <path d="M22 116 h56" stroke="var(--calm)" stroke-width="2" opacity=".6"/>
    <rect x="12" y="8" width="76" height="126" rx="10" fill="none" stroke="var(--line-dim)" stroke-dasharray="3 5"/>
    ${s === 0 ? `<circle cx="50" cy="104" r="4" fill="var(--ok)" opacity=".7"/>` : `<path d="M50 108 Q ${50 + droop * 0.5} ${108 - h / 2} ${50 + droop} ${108 - h}" stroke="var(--ok)" stroke-width="3" fill="none"/>`}
    ${leaves.join("")}${bloom}
  </svg>`;
}

export function renderGreenhouse(el, ctx) {
  const s = ctx.view.state;
  const stage = s?.engagement?.greenhouse_stage ?? 0;
  const facts = ctx.facts.facts.filter((f) => f.id.startsWith("veggie") || f.id === "isolation");
  const eng = s?.engagement || {};
  el.innerHTML = `
    <div class="cols">
      <div style="max-width:320px">${plantSVG(stage, ctx.view.wilt || 0)}</div>
      <div>
        <h3>Stage ${stage} of ${GREENHOUSE_MAX}</h3>
        <p>The plant grows one stage for each day you complete your routine (morning vitals, midday cognitive check, evening mood and sleep log) and after each completed Orb Calm session. After a missed day it wilts a little; it never dies.</p>
        <p>Streak <strong class="num">${eng.streak_days ?? 0}</strong> days · today's check-ins <strong class="num">${eng.checkins_today ?? 0}</strong> · calm levels cleared <strong class="num">${eng.calm_levels_cleared ?? 0}</strong></p>
        <h3>Why a plant</h3>
        ${facts.map((f) => `<p>${esc(f.text)} <a class="src-link" href="${esc(f.source.url)}" target="_blank" rel="noopener">${esc(f.source.title)}</a></p>`).join("")}
        <h3>Mood change per Aurora Run session</h3>
        <div data-wellbeing></div>
      </div>
    </div>`;
  let cleanup = () => {};
  import("./aurora.js").then(({ renderWellbeing }) => renderWellbeing(el.querySelector("[data-wellbeing]"), ctx.view.crewId)).then((c) => { cleanup = c || cleanup; });
  return () => cleanup();
}
