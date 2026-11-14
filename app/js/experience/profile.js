// Personal health profile and wellbeing plan (Product Document section 14; FR-38, FR-39, FR-42).
// Grows over time; nothing is forced; a completeness meter shows what is empty. Stays on this device's brain.
import { api } from "../core/api.js";
import { esc } from "../interface/readings.js";
import { TOOLS } from "./support.js";

const LIST = (v) => (Array.isArray(v) ? v.join(", ") : "");
const SPLIT = (s) => String(s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

export function registerProfile(registerScreen) {
  registerScreen("profile", { title: "My health profile", render: renderProfile });
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
    <h3>You</h3>
    ${field("callsign", "Name or callsign", p.callsign, "e.g. Ace")}
    ${field("preferences.reminderTimes.checkin", "Morning check-in", p.preferences?.reminderTimes?.checkin, "08:00", "time")}
    ${field("preferences.reminderTimes.winddown", "Wind-down", p.preferences?.reminderTimes?.winddown, "21:30", "time")}
    ${field("mission.dutySchedule", "Duty and sleep schedule", p.mission?.dutySchedule, "e.g. work 08-18, sleep 22-06")}
    <h3>Health background <span class="badge badge-sim">private</span></h3>
    <p class="fine">Used to make kit suggestions safer: an allergy blocks the matching item. Write "none" if there are none; an empty answer is not the same as "none". Never sent to ground unless you choose.</p>
    ${field("health.allergies", "Allergies", LIST(p.health?.allergies), "e.g. ibuprofen, penicillin, or none")}
    ${field("health.conditions", "Ongoing conditions", LIST(p.health?.conditions), "or none")}
    ${field("health.regularMedicines", "Regular medicines", LIST(p.health?.regularMedicines), "or none")}
    ${field("health.pastKitReactions", "Past reactions to kit items", LIST(p.health?.pastKitReactions), "or none")}
    <label class="pf-check"><input type="checkbox" data-path="health.includeInDigest" ${p.health?.includeInDigest ? "checked" : ""}> Include my health background in digests to the flight surgeon</label>
    <h3>Wellbeing plan</h3>
    ${field("wellbeingPlan.earlySigns", "My early signs", LIST(p.wellbeingPlan?.earlySigns), "e.g. can't sleep, snapping at people, no appetite")}
    <div class="pf-field"><span>What helps me (in order)</span><div class="pf-tools">${Object.entries(TOOLS).map(([k, t]) => `<button type="button" data-help="${k}" aria-pressed="${(p.wellbeingPlan?.whatHelps || []).includes(k)}">${esc(t.name)}</button>`).join("")}</div></div>
    ${field("wellbeingPlan.whoToTalkTo", "Who I would talk to", p.wellbeingPlan?.whoToTalkTo, "a crewmate, the psychologist, family")}
    <label class="pf-check"><input type="checkbox" data-path="wellbeingPlan.cameraMoodAnalysis" ${p.wellbeingPlan?.cameraMoodAnalysis ? "checked" : ""}> Camera mood analysis on</label>
    <h3>Emergency and sharing</h3>
    <label class="pf-field"><span>Crew buddy (gets urgent alerts first)</span><select data-path="sharing.buddy"><option value="">Choose…</option>${crew.map((c) => `<option ${p.sharing?.buddy === c.display_name ? "selected" : ""}>${esc(c.display_name)}</option>`).join("")}</select></label>
    <label class="pf-check"><input type="checkbox" data-path="sharing.shareUrgentWithCommander" ${p.sharing?.shareUrgentWithCommander ? "checked" : ""}> Tell the commander in an urgent situation</label>
    <div class="pf-actions"><button type="button" class="pill pill-light" data-save>Save</button><button type="button" class="pill pill-ghost" data-export>Export</button><button type="button" class="pill pill-ghost" data-delete>Delete my profile</button><span class="note" data-msg aria-live="polite"></span></div>`;
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
