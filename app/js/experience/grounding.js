// Grounding: the 5-4-3-2-1 sensory exercise for moments of anxiety or panic. Name 5 things you can see,
// 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste. Tap a dot for each one; the next
// sense opens when a step is done. Full screen, quiet, one step at a time. Mood before and after is logged.
import { api } from "../core/api.js";
import { cue } from "../core/sound.js";
import { moodRow, scienceDrawer } from "./science.js";
import { finishSupport, startSupport } from "./support.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STEPS = [
  { n: 5, sense: "see", prompt: "Look around the module. Name five things you can see.", hint: "A cable tie, a handrail, the light on a panel…", icon: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  { n: 4, sense: "touch", prompt: "Four things you can touch. Notice how each one feels.", hint: "The fabric of your sleeve, a cool metal rail…", icon: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.3-2.5L4 14.5a1.5 1.5 0 0 1 2.6-1.5L8 15"/>' },
  { n: 3, sense: "hear", prompt: "Three things you can hear.", hint: "The fans, your own breathing, a crewmate's voice…", icon: '<path d="M6 15a6 6 0 1 1 10.4-4.1c0 2.6-2.4 3.4-2.4 5.6a3 3 0 0 1-5.6 1.5"/><path d="M10 11a2 2 0 1 1 3 1.7"/>' },
  { n: 2, sense: "smell", prompt: "Two things you can smell.", hint: "Station air, the food packs, your sleeve…", icon: '<path d="M12 3c-2 4-5 6-5 10a5 5 0 0 0 10 0c0-4-3-6-5-10z"/>' },
  { n: 1, sense: "taste", prompt: "One thing you can taste.", hint: "Water, toothpaste, the last thing you ate…", icon: '<path d="M7 10h10l-1 9a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2zM9 10V7a3 3 0 0 1 6 0v3"/>' },
];

export function renderGrounding(el, ctx) {
  let flow = null, moodBefore = null, step = 0, count = 0, alive = true;
  const id = ctx.view.crewId;
  el.innerHTML = `<div class="gr" data-root></div>`;
  const root = el.querySelector("[data-root]");
  const drawer = scienceDrawer(root, "grounding", "Why grounding helps");

  function intro() {
    root.innerHTML = `<section class="gr-card"><p class="label">Grounding · 5-4-3-2-1</p><h1>Come back to the room</h1>
      <p class="gr-lede">When your thoughts race, your senses bring you back to the present. Five things you see, four you touch, three you hear, two you smell, one you taste. Take your time.</p>
      <p class="gr-q">How is your mood right now?</p>${moodRow("data-mb")}
      <div class="gr-actions"><button type="button" class="link-btn" data-why>Why it works</button><button type="button" class="link-btn" data-skip>Start without a mood</button></div></section>`;
    root.appendChild(drawer.el);
    root.querySelector("[data-why]").addEventListener("click", () => drawer.open());
    root.querySelectorAll("[data-mb]").forEach((b) => b.addEventListener("click", () => begin(Number(b.dataset.mb))));
    root.querySelector("[data-skip]").addEventListener("click", () => begin(null));
  }
  function begin(m) { moodBefore = m; flow = startSupport("grounding", m, "anxiety"); step = 0; count = 0; draw(); }

  function draw() {
    const s = STEPS[step];
    root.innerHTML = `<section class="gr-step">
      <ol class="gr-track">${STEPS.map((x, i) => `<li class="${i < step ? "is-done" : i === step ? "is-now" : ""}"><span>${x.n}</span><small>${esc(x.sense)}</small></li>`).join("")}</ol>
      <span class="gr-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${s.icon}</svg></span>
      <h1>${esc(s.prompt)}</h1><p class="gr-hint">${esc(s.hint)}</p>
      <div class="gr-dots">${Array.from({ length: s.n }, (_, i) => `<button type="button" data-dot="${i}" class="${i < count ? "is-on" : ""}" aria-label="Thing ${i + 1}">${i < count ? "✓" : i + 1}</button>`).join("")}</div>
      <p class="gr-say">Say each one out loud or in your head, then tap.</p>
    </section>`;
    root.appendChild(drawer.el);
    root.querySelectorAll("[data-dot]").forEach((b) => b.addEventListener("click", () => {
      if (Number(b.dataset.dot) !== count) return;
      count++; cue.tick(); navigator.vibrate?.(10);
      if (count >= s.n) {
        cue.point();
        setTimeout(() => { if (!alive) return; step++; count = 0; step >= STEPS.length ? end() : draw(); }, 650);
      }
      draw();
    }));
    window.gsap?.fromTo(root.querySelector(".gr-step h1"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" });
  }

  function end() {
    cue.done();
    root.innerHTML = `<section class="gr-card"><p class="label">Done</p><h1>Fifteen things, right here.</h1>
      <p class="gr-lede">Take one slow breath out. If the feeling comes back, you can run this again, or try Stillpoint.</p>
      <p class="gr-q">How is your mood now?</p>${moodRow("data-ma")}<p class="note" data-res></p>
      <div class="gr-actions"><button type="button" class="pill pill-ghost" data-calm>Open Stillpoint</button><button type="button" class="pill pill-light" data-close>Done</button></div></section>`;
    root.querySelector("[data-calm]").addEventListener("click", () => ctx.director.run([{ cmd: "open_screen", name: "orb_calm" }]));
    root.querySelector("[data-close]").addEventListener("click", () => ctx.screens?.close?.());
    root.querySelectorAll("[data-ma]").forEach((b) => b.addEventListener("click", async () => {
      const after = Number(b.dataset.ma);
      root.querySelectorAll("[data-ma]").forEach((x) => { x.disabled = true; x.setAttribute("aria-pressed", String(x === b)); });
      const d = finishSupport(flow, after);
      root.querySelector("[data-res]").textContent = d?.moodChange != null ? `Mood ${moodBefore} before, ${after} after (${d.moodChange >= 0 ? "+" : ""}${d.moodChange}). Saved.` : `Mood ${after}. Saved.`;
      try {
        await api.log(id, "session.grounding_mood_after", after, "user");
        if (moodBefore != null) { await api.log(id, "session.grounding_mood_before", moodBefore, "user"); await api.log(id, "session.grounding_mood_change", after - moodBefore, "user"); }
        await ctx.patch({ wellbeing: { mood_before: moodBefore, mood_after: after, last_game: "grounding", updated: new Date().toISOString() } });
      } catch { root.querySelector("[data-res]").textContent += " (could not reach the brain; not saved)"; }
    }));
  }

  intro();
  return () => { alive = false; };
}
