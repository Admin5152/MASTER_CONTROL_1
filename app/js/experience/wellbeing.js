// Wellbeing hub (full screen): three games on 3D cards, each a small live scene (a breathing glass orb,
// a racer streaking past planets, a Mars greenhouse with growing plants). Cards tilt toward the pointer.
// The research sits behind "Why it works"; the crew member's own logged results sit on each card.
import { evidenceHTML, loadScience, personalStat, scienceDrawer } from "./science.js";
import { prefetchRace } from "./race/race.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x).toFixed(1);
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// real frames from each game (captured from the running 3D scenes), with a slow camera drift
const SCENE = {
  orb_calm: `<div class="sc-shot"><img src="assets/wellbeing/stillpoint.jpg" alt="" loading="lazy"></div>`,
  race: `<div class="sc-shot"><img src="assets/wellbeing/slipstream.jpg" alt="" loading="lazy"></div>`,
  greenhouse: `<div class="sc-shot"><img src="assets/wellbeing/red-harvest.jpg" alt="" loading="lazy"></div>`,
};

const GAMES = [
  { id: "orb_calm", title: "Stillpoint", tag: "Breathe", sub: "Paced breathing with live heart-rate feedback.", time: "1–5 min", hue: "#7fb6ff" },
  { id: "race", title: "Slipstream", tag: "Race", sub: "Race through space, warp down to Earth, Mars, the Moon and Jupiter.", time: "3 min", hue: "#c9bcff" },
  { id: "greenhouse", title: "Red Harvest", tag: "Grow", sub: "Grow real space crops, fill the crew's orders, build your base.", time: "any time", hue: "#ff9a6b" },
];

async function results(id, crewId) {
  if (id === "orb_calm") {
    const [m, a, b] = await Promise.all([personalStat(crewId, "session.calm_mood_change"), personalStat(crewId, "session.calm_start_hr"), personalStat(crewId, "session.calm_end_hr")]);
    if (a.n && b.n) return `${sign(b.mean - a.mean)} bpm avg · ${a.n} session${a.n > 1 ? "s" : ""}${m.n ? ` · mood ${sign(m.mean)}` : ""}`;
    return m.n ? `mood ${sign(m.mean)} avg` : null;
  }
  if (id === "race") {
    const m = await personalStat(crewId, "session.race_mood_change");
    let pb = null;
    try { pb = JSON.parse(localStorage.getItem(`sentinel.race.pb.${crewId}`) || "null"); } catch { /* none */ }
    const parts = [];
    if (pb?.time) { const mm = Math.floor(pb.time / 60); parts.push(`best ${mm}:${(pb.time - mm * 60).toFixed(1).padStart(4, "0")}`); }
    if (m.n) parts.push(`mood ${sign(m.mean)} avg`);
    return parts.join(" · ") || null;
  }
  if (id === "greenhouse") {
    const m = await personalStat(crewId, "session.greenhouse_mood_change");
    let farm = null;
    try { farm = JSON.parse(localStorage.getItem(`sentinel.mars.v2.${crewId}`) || "null"); } catch { /* none */ }
    const parts = [];
    if (farm?.level) parts.push(`level ${farm.level} · ${farm.ordersDone || 0} orders`);
    if (m.n) parts.push(`mood ${sign(m.mean)} avg`);
    return parts.join(" · ") || null;
  }
  return null;
}

export function renderWellbeing(el, ctx) {
  const crewId = ctx.view.crewId;
  const name = ctx.view.crew?.find((c) => c.crew_id === crewId)?.display_name || "";
  el.innerHTML = `<div class="wb2">
    <header class="wb2-head">
      <p class="label">Wellbeing</p>
      <h1>${name ? `Take a break, ${esc(name.split(" ")[0])}.` : "Take a break."}</h1>
      <p class="wb2-lede">Three short breaks, each built on published research. Your mood before and after is logged, so you can see what works for you.</p>
    </header>
    <div class="wb2-cards">${GAMES.map((g, i) => `<article class="wb2-card" data-game="${g.id}" style="--hue:${g.hue};--i:${i}">
      <div class="wb2-tilt">
        <button type="button" class="wb2-scene" data-go="${g.id}" aria-label="Play ${esc(g.title)}">${SCENE[g.id]}</button>
        <div class="wb2-body">
          <div class="wb2-row"><span class="wb2-tag">${esc(g.tag)}</span><span class="wb2-time">${esc(g.time)}</span></div>
          <h2>${esc(g.title)}</h2>
          <p>${esc(g.sub)}</p>
          <p class="wb2-you" data-you hidden></p>
          <div class="wb2-actions">
            <button type="button" class="wb2-play" data-go="${g.id}">Play<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg></button>
            <button type="button" class="wb2-why" data-why="${g.id}"><span data-n>Why it works</span></button>
          </div>
        </div>
      </div>
    </article>`).join("")}</div>
    <nav class="wb2-more" aria-label="More for the mind">
      ${[["cognitive", "Reaction test"], ["measures", "Weekly measures"], ["exam", "Guided exam"], ["ground", "Message ground"], ["interventions", "Suggestions"]].map(([k, t]) => `<button type="button" data-go="${k}">${esc(t)}</button>`).join("")}
    </nav>
  </div>`;
  const root = el.querySelector(".wb2");
  const drawers = Object.fromEntries(GAMES.map((g) => [g.id, scienceDrawer(root, g.id, `Why ${g.title} works`)]));
  el.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => ctx.director.run([{ cmd: "open_screen", name: b.dataset.go }])));
  el.querySelectorAll("[data-why]").forEach((b) => b.addEventListener("click", () => drawers[b.dataset.why].open()));

  // 3D tilt toward the pointer
  const offs = [];
  if (!reduced()) el.querySelectorAll(".wb2-card").forEach((card) => {
    const tilt = card.querySelector(".wb2-tilt");
    const move = (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.transform = `rotateY(${(x * 10).toFixed(2)}deg) rotateX(${(-y * 8).toFixed(2)}deg) translateZ(0)`;
      card.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
      card.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
    };
    const leave = () => { tilt.style.transform = ""; };
    card.addEventListener("pointermove", move); card.addEventListener("pointerleave", leave);
    offs.push(() => { card.removeEventListener("pointermove", move); card.removeEventListener("pointerleave", leave); });
  });

  // entrance
  if (window.gsap && !reduced()) {
    window.gsap.fromTo(el.querySelectorAll(".wb2-head > *"), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power3.out" });
    window.gsap.fromTo(el.querySelectorAll(".wb2-card"), { opacity: 0, y: 60, rotateX: 18 }, { opacity: 1, y: 0, rotateX: 0, duration: 1.1, stagger: 0.12, delay: 0.15, ease: "expo.out", clearProps: "transform" });
    window.gsap.fromTo(el.querySelectorAll(".wb2-more button"), { opacity: 0 }, { opacity: 1, duration: 0.6, stagger: 0.04, delay: 0.6 });
  }

  setTimeout(() => prefetchRace(ctx.world), 600);   // the course is usually ready before Play is pressed
  let alive = true;
  loadScience().then((sci) => {
    if (!alive) return;
    for (const g of GAMES) {
      const n = sci.activities?.[g.id]?.evidence?.length;
      if (n) el.querySelector(`[data-why="${g.id}"] [data-n]`).textContent = `Why it works · ${n} studies`;
    }
  }).catch(() => {});
  for (const g of GAMES) results(g.id, crewId).then((r) => {
    if (!alive || !r) return;
    const y = el.querySelector(`[data-game="${g.id}"] [data-you]`);
    y.innerHTML = `<span class="label">You</span>${esc(r)}`; y.hidden = false;
  });
  void evidenceHTML;
  // the hub is opaque: stop drawing the 3D world underneath it (frees the GPU, keeps animations smooth)
  const pauseT = setTimeout(() => ctx.world?.pause(true), 700);
  return () => { alive = false; clearTimeout(pauseT); ctx.world?.pause(false); offs.forEach((f) => f()); };
}
