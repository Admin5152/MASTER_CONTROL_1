// Crew pulse (15.7, FR-49, S19): two weekly questions; team results only, only with 3+ answers, never names.
import { api } from "../core/api.js";
import { esc } from "../interface/readings.js";

export function registerPulse(registerScreen) {
  registerScreen("pulse", { title: "Crew pulse", render: renderPulse });
}

async function renderPulse(el, ctx) {
  let r;
  try { r = await api.pulse(ctx.view.crewId); } catch { el.innerHTML = `<p class="note">The brain is offline.</p>`; return; }
  const q = Object.entries(r.questions);
  el.innerHTML = `<p class="note">Two quick questions a week. Results are for the whole crew, only once ${r.min_responses} people have answered, and never with names.</p>
    ${r.answered ? `<p><b>You've answered this week.</b> You can change your answer below.</p>` : ""}
    ${q.map(([k, label]) => `<div class="pf-field"><span>${esc(label)}</span><div class="pf-tools" data-q="${k}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" aria-pressed="false">${n}</button>`).join("")}</div></div>`).join("")}
    <div class="pf-actions"><button type="button" class="pill pill-light" data-send>Send</button><span class="note" data-msg aria-live="polite"></span></div>
    <h3>Team this week</h3><p class="note" data-team>${r.shown ? q.map(([k, l]) => `${esc(l.split("?")[0])}: <b>${r.team[k]}</b> / 5`).join("<br>") : esc(r.note)}</p>`;
  const ans = {};
  el.querySelectorAll("[data-q]").forEach((g) => g.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => {
    ans[g.dataset.q] = Number(b.dataset.v);
    g.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  })));
  el.querySelector("[data-send]").addEventListener("click", async () => {
    try { await api.pulseAnswer(ctx.view.crewId, ans); renderPulse(el, ctx); } catch (e) { el.querySelector("[data-msg]").textContent = "Answer both questions, 1 to 5."; }
  });
}
