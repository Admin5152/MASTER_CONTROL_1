// "Why it works": the research behind each wellbeing activity (shared/wellbeing_science.json),
// plus the crew member's own before/after evidence from the session log.
import { api } from "../core/api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let cache = null;

export function loadScience() {
  if (!cache) cache = api.json("../shared/wellbeing_science.json").catch((e) => { cache = null; throw e; });
  return cache;
}

/** HTML for one activity's evidence. compact: the mechanism and a count only. */
export function evidenceHTML(sci, id, { compact = false } = {}) {
  const a = sci?.activities?.[id];
  if (!a) return "";
  if (compact) return `<p class="sci-mech">${esc(a.mechanism)}</p><p class="sci-count">${a.evidence.length} studies</p>`;
  return `<div class="sci">
    <p class="sci-mech">${esc(a.mechanism)}</p>
    <ol class="sci-list">${a.evidence.map((e) => `<li>
      <p class="sci-find">${esc(e.finding)}</p>
      <p class="sci-used"><span>In the game</span>${esc(e.used)}</p>
      <p class="sci-cite">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.cite)}</a>` : esc(e.cite)}</p>
    </li>`).join("")}</ol>
    <p class="sci-honest">${esc(sci.honesty)}</p>
  </div>`;
}

/** A drawer that slides over a full-screen game. Returns {open, close, el}. */
export function scienceDrawer(host, id, title = "Why it works") {
  const el = document.createElement("aside");
  el.className = "sci-drawer";
  el.hidden = true;
  el.innerHTML = `<div class="sci-drawer-head"><p class="label">The science</p><h2>${esc(title)}</h2><button type="button" class="sci-x" aria-label="Close">×</button></div><div class="sci-drawer-body"><p class="note">Loading…</p></div>`;
  host.appendChild(el);
  el.querySelector(".sci-x").addEventListener("click", () => close());
  const open = async () => {
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-on"));
    try { el.querySelector(".sci-drawer-body").innerHTML = evidenceHTML(await loadScience(), id); }
    catch { el.querySelector(".sci-drawer-body").innerHTML = `<p class="note">The evidence file could not load.</p>`; }
  };
  const close = () => { el.classList.remove("is-on"); setTimeout(() => { el.hidden = true; }, 300); };
  return { open, close, el };
}

/** Mean and count of a logged session field. */
export async function personalStat(crewId, field) {
  try {
    const r = await api.history(crewId, field);
    const v = (r.points || []).map((p) => p.v).filter((x) => Number.isFinite(x));
    if (!v.length) return { n: 0, mean: null };
    return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length };
  } catch { return { n: 0, mean: null }; }
}

/** Mood picker row (1 low .. 5 great). */
export function moodRow(attr) {
  const faces = ["Low", "Flat", "OK", "Good", "Great"];
  return `<div class="mood5">${faces.map((f, i) => `<button type="button" ${attr}="${i + 1}"><b>${i + 1}</b><small>${f}</small></button>`).join("")}</div>`;
}
