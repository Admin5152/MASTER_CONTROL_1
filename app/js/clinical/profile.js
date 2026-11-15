// Personal health profile and wellbeing plan (Product Document section 14; FR-38, FR-39, FR-42).
// Grows over time; nothing is forced; a completeness meter shows what is empty. Stays on this device's brain.
import { api } from "../core/api.js";
import { esc } from "../interface/readings.js";
import { TOOLS } from "../wellbeing/support.js";

const LIST = (v) => (Array.isArray(v) ? v.join(", ") : "");
const SPLIT = (s) => String(s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

// A list field as chips: pick from suggestions (search filters them), or type your own and press Enter. Less typing,
// fewer spelling variants, so an allergy matches its kit item. The hidden input keeps the value the save code reads.
const COMMON = {
  "health.allergies": ["none", "penicillin", "sulfa drugs", "aspirin", "latex", "adhesive tape", "nuts", "shellfish"],
  "health.conditions": ["none", "asthma", "migraine", "seasonal rhinitis", "high blood pressure", "diabetes", "motion sickness", "back pain", "anxiety"],
  "health.regularMedicines": ["none", "vitamin D", "antihistamine", "melatonin", "blood pressure medicine", "inhaler", "oral contraceptive"],
  "health.pastKitReactions": ["none"],
  "wellbeingPlan.earlySigns": ["can't sleep", "short temper", "no appetite", "going quiet", "headache", "low energy", "restless", "homesick", "skipping meals"],
};
function pickerHTML(path, label, values, hint) {
  return `<div class="pf-field pk" data-pick="${path}"><span>${esc(label)}</span>
    <div class="pk-sel" data-sel></div>
    <input type="search" data-pk-q placeholder="${esc(hint || "Search, or type your own and press Enter")}" aria-label="${esc(label)}: search or add" autocomplete="off">
    <div class="pk-opts" data-opts></div>
    <input type="hidden" data-path="${path}" value="${esc((values || []).join(", "))}"></div>`;
}
function wirePickers(el, kitNames) {
  el.querySelectorAll("[data-pick]").forEach((box) => {
    const path = box.dataset.pick, hidden = box.querySelector("[data-path]"), q = box.querySelector("[data-pk-q]");
    let sel = hidden.value.split(",").map((x) => x.trim()).filter(Boolean);
    const options = [...new Set([...(COMMON[path] || []), ...(/allergies|pastKitReactions|regularMedicines/.test(path) ? kitNames : [])])];
    const draw = () => {
      hidden.value = sel.join(", ");
      box.querySelector("[data-sel]").innerHTML = sel.map((v) => `<button type="button" class="pk-chip" data-rm="${esc(v)}" aria-label="Remove ${esc(v)}">${esc(v)} <b aria-hidden="true">×</b></button>`).join("") || `<span class="fine">Nothing chosen yet</span>`;
      const f = q.value.trim().toLowerCase();
      const opts = options.filter((o) => !sel.some((s) => s.toLowerCase() === o.toLowerCase()) && (!f || o.toLowerCase().includes(f))).slice(0, f ? 12 : 7);
      box.querySelector("[data-opts]").innerHTML = opts.map((o) => `<button type="button" data-add="${esc(o)}">${esc(o)}</button>`).join("") +
        (f && !options.some((o) => o.toLowerCase() === f) && !sel.some((s) => s.toLowerCase() === f) ? `<button type="button" data-add="${esc(q.value.trim())}">Add "${esc(q.value.trim())}"</button>` : "");
      box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { sel = sel.filter((v) => v !== b.dataset.rm); draw(); }));
      box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => add(b.dataset.add)));
    };
    const add = (v) => {
      v = String(v || "").trim().slice(0, 60);
      if (!v) return;
      sel = v.toLowerCase() === "none" ? ["none"] : [...sel.filter((s) => s.toLowerCase() !== "none" && s.toLowerCase() !== v.toLowerCase()), v];   // "none" stands alone
      q.value = ""; draw();
    };
    q.addEventListener("input", draw);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(q.value); } });
    draw();
  });
}

export function registerProfile(registerScreen) {
  registerScreen("profile", { title: "My health profile", wide: true, render: renderProfile });
}

async function renderProfile(el, ctx) {
  let p;
  try { p = await api.profile(ctx.view.crewId); } catch { el.innerHTML = `<p class="note">The brain is offline.</p>`; return; }
  const crew = (ctx.view.crew || []).filter((c) => c.crew_id !== ctx.view.crewId);
  const pct = Math.round((p.completeness || 0) * 100);
  const field = (path, label, value, hint = "", type = "text") => `<label class="pf-field"><span>${esc(label)}</span>
      <input type="${type}" data-path="${path}" value="${esc(value ?? "")}" placeholder="${esc(hint)}"></label>`;
  el.innerHTML = `
    <div class="pf-meter"><div class="pf-ring" style="--p:${pct}"><b>${pct}%</b></div>
      <div><strong>${pct >= 100 ? "Profile complete" : "Profile builds over time"}</strong>
      <p class="note">${p.missing?.length ? `Still empty: ${esc(p.missing.slice(0, 4).join(", "))}${p.missing.length > 4 ? "…" : ""}. Nothing is forced.` : "Everything is filled in."}</p></div></div>
    ${p.onboarding?.preloaded && !p.onboarding?.confirmed ? `<p class="note">These details were filled in for you (demo values) by the mission planner. Change anything that is wrong, then save: it becomes yours.</p>` : ""}
    <h3>You</h3>
    ${field("callsign", "Name or callsign", p.callsign, "e.g. Ace")}
    ${field("preferences.reminderTimes.checkin", "Morning check-in", p.preferences?.reminderTimes?.checkin, "08:00", "time")}
    ${field("preferences.reminderTimes.winddown", "Wind-down", p.preferences?.reminderTimes?.winddown, "21:30", "time")}
    ${field("mission.dutySchedule", "Duty and sleep schedule", p.mission?.dutySchedule, "e.g. work 08-18, sleep 22-06")}
    <h3>Health background <span class="badge badge-sim">private</span></h3>
    <p class="fine">Used to make kit suggestions safer: an allergy blocks the matching item. Write "none" if there are none; an empty answer is not the same as "none". Never sent to ground unless you choose.</p>
    ${pickerHTML("health.allergies", "Allergies", p.health?.allergies)}
    ${pickerHTML("health.conditions", "Ongoing conditions", p.health?.conditions)}
    ${pickerHTML("health.regularMedicines", "Regular medicines", p.health?.regularMedicines)}
    ${pickerHTML("health.pastKitReactions", "Past reactions to kit items", p.health?.pastKitReactions)}
    <label class="pf-check"><input type="checkbox" data-path="health.includeInDigest" ${p.health?.includeInDigest ? "checked" : ""}> Include my health background in digests to the flight surgeon</label>
    <h3>Wellbeing plan</h3>
    ${pickerHTML("wellbeingPlan.earlySigns", "My early signs", p.wellbeingPlan?.earlySigns)}
    <div class="pf-field"><span>What helps me (in order)</span><div class="pf-tools">${Object.entries(TOOLS).map(([k, t]) => `<button type="button" data-help="${k}" aria-pressed="${(p.wellbeingPlan?.whatHelps || []).includes(k)}">${esc(t.name)}</button>`).join("")}</div></div>
    ${field("wellbeingPlan.whoToTalkTo", "Who I would talk to", p.wellbeingPlan?.whoToTalkTo, "a crewmate, the psychologist, family")}
    <label class="pf-check"><input type="checkbox" data-path="wellbeingPlan.cameraMoodAnalysis" ${p.wellbeingPlan?.cameraMoodAnalysis ? "checked" : ""}> Camera mood analysis on</label>
    <h3>Emergency and sharing</h3>
    <label class="pf-field"><span>Crew buddy (gets urgent alerts first)</span><select data-path="sharing.buddy"><option value="">Choose…</option>${crew.map((c) => `<option ${p.sharing?.buddy === c.display_name ? "selected" : ""}>${esc(c.display_name)}</option>`).join("")}</select></label>
    <label class="pf-check"><input type="checkbox" data-path="sharing.shareUrgentWithCommander" ${p.sharing?.shareUrgentWithCommander ? "checked" : ""}> Tell the commander in an urgent situation</label>
    <div class="pf-actions"><button type="button" class="pill pill-light" data-save>Save</button><button type="button" class="pill pill-ghost" data-export>Export</button><button type="button" class="pill pill-ghost" data-delete>Delete my profile</button><span class="note" data-msg aria-live="polite"></span></div>`;
  wirePickers(el, (ctx.kit?.items || []).map((i) => String(i.name || "").split(" (")[0].toLowerCase()).filter(Boolean));
  const helps = [...(p.wellbeingPlan?.whatHelps || [])];
  el.querySelectorAll("[data-help]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.help, i = helps.indexOf(k);
    if (i >= 0) helps.splice(i, 1); else helps.push(k);
    b.setAttribute("aria-pressed", String(i < 0));
  }));
  const msg = el.querySelector("[data-msg]");
  el.querySelector("[data-save]").addEventListener("click", async () => {
    const patch = {};
    el.querySelectorAll("[data-path]").forEach((inp) => {
      const keys = inp.dataset.path.split("."); let o = patch;
      keys.slice(0, -1).forEach((k) => { o = o[k] ||= {}; });
      const last = keys.at(-1);
      o[last] = inp.type === "checkbox" ? inp.checked : /^(health\.(allergies|conditions|regularMedicines|pastKitReactions)|wellbeingPlan\.earlySigns)$/.test(inp.dataset.path) ? SPLIT(inp.value) : inp.value;
    });
    (patch.wellbeingPlan ||= {}).whatHelps = helps;
    try { const np = await api.profileUpdate(ctx.view.crewId, patch); ctx.view.profile = np; msg.textContent = `Saved. ${Math.round(np.completeness * 100)}% complete.`; renderProfile(el, ctx); } catch (e) { msg.textContent = `Not saved: ${e.message}`; }
  });
  el.querySelector("[data-export]").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }));
    a.download = `sentinel-profile-${ctx.view.crewId}.json`; a.click(); URL.revokeObjectURL(a.href);
  });
  el.querySelector("[data-delete]").addEventListener("click", async (e) => {
    if (e.currentTarget.dataset.armed !== "1") { e.currentTarget.dataset.armed = "1"; e.currentTarget.textContent = "Tap again to delete"; return; }
    try { await api.profileDelete(ctx.view.crewId); ctx.view.profile = null; renderProfile(el, ctx); } catch (err) { msg.textContent = err.message; }
  });
}
