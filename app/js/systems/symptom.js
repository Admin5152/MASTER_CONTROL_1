// "Where does it hurt?" (Product Document section 7, BODY-6). The crew member points at the 3D body;
// this sheet then asks what they feel, how strong it is and when it started, saves it to their state
// (LIVE: they entered it) and emits symptom.logged. Sentinel never diagnoses: the entry is a report
// in the crew member's own words, and any kit suggestion comes from the rules engine with its caveat.
import { api } from "../core/api.js";
import { emit } from "../core/bus.js";
import { REGION_NAMES, REGIONS, setPointing } from "../interface/body.js";
import { ZONE_NAMES, badgeHTML, esc } from "../interface/readings.js";
import { ONSETS, SEVERITIES, SKIN_SYMPTOMS, buildSymptom, describeSymptom, symptomPatch, symptomsFor, zoneFor } from "./symptomlog.js";

export function registerSymptom(registerScreen) {
  registerScreen("symptom", { title: (r) => (REGIONS.includes(r) ? `Symptom: ${REGION_NAMES[r].toLowerCase()}` : "Where does it hurt?"), badge: "LIVE", render: renderSymptom });
}

function renderSymptom(el, ctx, region) {
  if (!REGIONS.includes(region)) return renderPick(el, ctx);
  const pick = { type: null, severity: null, onset: "now" };
  const chips = (name, items, cur) => items.map(([v, label, hint]) => `<button type="button" class="chip sym-chip" data-${name}="${esc(v)}" aria-pressed="${String(v) === String(cur)}"${hint ? ` title="${esc(hint)}"` : ""}>${esc(label)}</button>`).join("");
  const draw = () => {
    const zone = zoneFor(region, pick.type);
    const skin = SKIN_SYMPTOMS.includes(pick.type);
    const mrid = ctx.facts?.zones?.whole_body?.mrids?.[0];
    el.innerHTML = `
      <p class="note">You pointed at your <strong>${esc(REGION_NAMES[region].toLowerCase())}</strong>. This goes into your record as you describe it. It is not a diagnosis.
        <button class="link-btn" type="button" data-repick>Point somewhere else</button></p>
      <h3>What do you feel?</h3>
      <div class="chips sym-row" role="group" aria-label="Symptom">${chips("type", symptomsFor(region).map((s) => [s, s[0].toUpperCase() + s.slice(1)]), pick.type)}</div>
      <h3>How strong is it?</h3>
      <div class="chips sym-row" role="group" aria-label="Severity">${chips("severity", SEVERITIES.map((s) => [s.value, `${s.value} · ${s.word}`, s.hint]), pick.severity)}</div>
      <h3>When did it start?</h3>
      <div class="chips sym-row" role="group" aria-label="Onset">${chips("onset", ONSETS.map((o) => [o.value, o.word]), pick.onset)}</div>
      ${skin ? `<p class="note sym-photo">Photograph the area now and again as it heals, so the change can be followed.${mrid ? ` <span class="fine">Source: ${esc(mrid.id)} ${esc(mrid.title)}.</span>` : ""}</p>` : ""}
      <p class="fine">Shows under ${esc(ZONE_NAMES[zone] || zone)}.</p>
      <p><button class="pill pill-dark pill-block" type="button" data-save ${pick.type && pick.severity ? "" : "disabled"}>Log this symptom</button></p>
      <p class="note" data-result aria-live="polite"></p>`;
    el.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { pick.type = b.dataset.type; draw(); }));
    el.querySelectorAll("[data-severity]").forEach((b) => b.addEventListener("click", () => { pick.severity = Number(b.dataset.severity); draw(); }));
    el.querySelectorAll("[data-onset]").forEach((b) => b.addEventListener("click", () => { pick.onset = b.dataset.onset; draw(); }));
    el.querySelector("[data-repick]").addEventListener("click", () => ctx.screens.open("symptom"));
    el.querySelector("[data-save]").addEventListener("click", save);
  };
  async function save() {
    const result = el.querySelector("[data-result]");
    let entry;
    try { entry = buildSymptom({ region, ...pick }); } catch (e) { result.textContent = e.message; return; }
    el.querySelector("[data-save]").disabled = true;
    try {
      const s = await ctx.patch(symptomPatch(ctx.view.state?.manual, entry));
      emit("symptom.logged", { zone: entry.zone, type: entry.type, severity: entry.severity, onset: entry.onset, region: entry.region, crewId: ctx.view.crewId });
      ctx.onCheckin?.("log");
      const a = s.action || {};
      const kit = a.type === "suggest_medicine" && a.detail ? a.detail : "";
      const severe = entry.severity === 3;
      el.innerHTML = `<article class="card sym-done">
          <span class="label">Logged ${badgeHTML("LIVE")}</span>
          <h3>${esc(describeSymptom(entry))}</h3>
          ${kit ? `<p>${esc(kit)} ${badgeHTML("SIM")}</p>` : `<p class="note">Nothing in the onboard kit list is mapped to this. It is in your record for the flight surgeon.</p>`}
          ${severe ? `<p class="note"><strong>Severe:</strong> tell the crew medical officer now, and send this to ground.</p>` : ""}
        </article>
        <div class="exam-nav">
          <button class="pill ${severe ? "pill-light" : "pill-ghost"}" type="button" data-ground>Send to ground (store and forward)</button>
          <button class="pill pill-ghost" type="button" data-more>Log another</button>
          <button class="pill ${severe ? "pill-ghost" : "pill-light"}" type="button" data-done>Done</button>
        </div>
        <p class="note" data-sent aria-live="polite"></p>`;
      el.querySelector("[data-done]").addEventListener("click", () => ctx.screens.close());
      el.querySelector("[data-more]").addEventListener("click", () => ctx.screens.open("symptom"));
      el.querySelector("[data-ground]").addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await api.ground(ctx.view.crewId, { kind: "symptom", title: `Symptom: ${describeSymptom(entry)}`, body: entry });
          el.querySelector("[data-sent]").innerHTML = `Queued for ground. It arrives in about ${Math.round(r.eta_s / 60)} minutes ${badgeHTML("SIM")}.`;
        } catch (err) { el.querySelector("[data-sent]").textContent = `Not queued: ${err.message}`; }
      });
      ctx.say(kit ? `Logged. ${kit}` : severe ? "Logged. Please tell the crew medical officer." : "Logged. It is in your record.", { source: "local" });
    } catch (e) {
      result.textContent = `Not saved: ${e.message}. Check the brain link at the top right.`;
      el.querySelector("[data-save]").disabled = false;
    }
  }
  draw();
  return () => {};
}

/** No region yet: ask the crew member to point at the body, with a list as the fallback (no 3D, or gloves). */
function renderPick(el, ctx) {
  el.innerHTML = `<p class="note">Tap the place on the body. Turn it with a drag if it is on your back.</p>
    <h3>Or choose it here</h3>
    <div class="chips sym-row">${REGIONS.map((r) => `<button type="button" class="chip sym-chip" data-region="${r}">${esc(REGION_NAMES[r])}</button>`).join("")}</div>
    <p class="fine">This is a report in your own words, not a diagnosis.</p>`;
  el.querySelectorAll("[data-region]").forEach((b) => b.addEventListener("click", () => ctx.screens.open("symptom", b.dataset.region)));
  let live = true;
  (async () => {
    if (ctx.stages.current !== "body") await ctx.stages.go("body");
    if (live) setPointing(true);
  })();
  return () => { live = false; setPointing(false); };
}
