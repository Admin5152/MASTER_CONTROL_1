// Demo panel (D key, three-finger tap, or the corner button). Everything it drives is SIM.
import { api } from "../core/api.js";
import { esc } from "./readings.js";

export function createDemoPanel(ctx) {
  const el = document.getElementById("demo-panel");
  const scenarios = [["full_demo", "Full demo (90 s)"], ["tired_crew", "Tired crew"], ["calm_down", "Calm down"], ["cabin_dip", "Cabin O2 dip"], ["solar_storm", "Solar storm"], ["reset", "Reset"]];

  function render() {
    const v = ctx.view;
    const h = ctx.health || {};
    el.innerHTML = `
      <h2>Demo panel <span class="badge badge-sim">SIM</span> <button class="pill pill-ghost" type="button" data-close style="margin-left:auto">Close</button></h2>
      <p class="note">Everything set here is simulated and shows a SIM badge on the main screen.</p>
      <h3>Tablet URL</h3><p class="demo-url">${esc(h.tablet_url || "—")}</p>
      <h3>Tablet pairing PIN</h3><p class="demo-url" data-pin>…</p>
      <h3>Subsystems</h3>
      <p class="note">LLM: ${h.llm ? `on (${esc(h.llm_model)})` : "off, rules replies"} · Speaker ID: ${h.speaker_id ? `on (${(h.voiceprints || []).length} enrolled)` : "off, manual selector"} · Space weather: ${esc(h.spaceweather || "—")}</p>
      <h3>Crew member</h3>
      <select data-crew>${v.crew.map((c) => `<option value="${esc(c.crew_id)}" ${c.crew_id === v.crewId ? "selected" : ""}>${esc(c.display_name)}</option>`).join("")}</select>
      <h3>Scenarios</h3>
      <div class="row">${scenarios.map(([k, l]) => `<button class="pill pill-ghost" type="button" data-scn="${k}">${esc(l)}</button>`).join("")}</div>
      <h3>EVA suit <span class="badge badge-sim">SIM</span></h3>
      <div class="row"><button class="pill pill-ghost" type="button" data-suit="eva">Start EVA</button><button class="pill pill-ghost" type="button" data-suit="leak" data-region="left_glove">Leak: left glove</button><button class="pill pill-ghost" type="button" data-suit="leak" data-region="helmet">Leak: helmet</button><button class="pill pill-ghost" type="button" data-suit="leak" data-region="right_leg" data-size="slow">Slow leak: right leg</button><button class="pill pill-ghost" type="button" data-suit="seal">Seal</button><button class="pill pill-ghost" type="button" data-suit="iva">End EVA</button></div>
      <h3>Link to ground and mode <span class="badge badge-sim">SIM</span></h3>
      <div class="row"><button class="pill pill-ghost" type="button" data-blackout="15">Comms blackout 15 min</button><button class="pill pill-ghost" type="button" data-blackout="0">Link back</button><button class="pill pill-ghost" type="button" data-mode="rest">Rest mode</button><button class="pill pill-ghost" type="button" data-mode="routine">Routine</button><button class="pill pill-ghost" type="button" data-mode="contingency">Contingency</button><button class="pill pill-ghost" type="button" data-send-digest>Send digest</button></div>
      <h3>Cabin oxygen <span class="num" data-o2v></span>%</h3>
      <input type="range" min="15" max="23" step="0.1" data-o2>
      <h3>Cabin CO2 <span class="num" data-co2v></span> ppm</h3>
      <input type="range" min="300" max="8000" step="50" data-co2>
      <h3>Heart-rate override <span class="num" data-hrv></span> bpm</h3>
      <input type="range" min="45" max="150" step="1" data-hr>
      <div class="row"><button class="pill pill-ghost" type="button" data-hrapply>Apply heart rate</button><button class="pill pill-ghost" type="button" data-hrrelease>Release to camera</button></div>
      <h3>Mission clock</h3>
      <div class="row"><button class="pill pill-ghost" type="button" data-skip="3">+3 hours</button><button class="pill pill-ghost" type="button" data-skip="24">+1 day</button></div>
      <h3>Voice enrolment ${h.speaker_id ? "" : '<span class="note">(speaker ID not installed)</span>'}</h3>
      <p class="note">Each person reads aloud for 10 seconds. Voiceprints stay on this laptop.</p>
      <div class="row">${v.crew.map((c) => `<button class="pill pill-ghost" type="button" data-enrol="${esc(c.crew_id)}" ${h.speaker_id ? "" : "disabled"}>${esc(c.display_name)}${(h.voiceprints || []).includes(c.crew_id) ? " ✓" : ""}</button>`).join("")}</div>
      <p class="note" data-enrolst aria-live="polite"></p>`;
    const s = v.state;
    const o2 = el.querySelector("[data-o2]"), co2 = el.querySelector("[data-co2]"), hr = el.querySelector("[data-hr]");
    o2.value = s?.cabin?.oxygen_pct ?? 20.9; co2.value = s?.cabin?.co2_ppm ?? 600; hr.value = s?.vitals?.heart_rate ?? 70;
    const sync = () => {
      el.querySelector("[data-o2v]").textContent = Number(o2.value).toFixed(1);
      el.querySelector("[data-co2v]").textContent = co2.value;
      el.querySelector("[data-hrv]").textContent = hr.value;
    };
    sync();
    o2.addEventListener("input", sync); co2.addEventListener("input", sync); hr.addEventListener("input", sync);
    o2.addEventListener("change", () => api.cabin({ oxygen_pct: Number(o2.value) }));
    co2.addEventListener("change", () => api.cabin({ co2_ppm: Number(co2.value) }));
    el.querySelector("[data-hrapply]").addEventListener("click", () => {
      ctx.view.hrOverride = true;
      ctx.patch({ vitals: { heart_rate: Number(hr.value), source: "sim", sources: { heart_rate: "sim" } } });
    });
    el.querySelector("[data-hrrelease]").addEventListener("click", () => { ctx.view.hrOverride = false; });
    el.querySelector("[data-close]").addEventListener("click", toggle);
    el.querySelector("[data-crew]").addEventListener("change", (e) => ctx.setCrew(e.target.value, "manual"));
    api.pin().then((r) => { const p = el.querySelector("[data-pin]"); if (p) p.textContent = r.pin; }).catch(() => {});
    el.querySelectorAll("[data-blackout]").forEach((b) => b.addEventListener("click", () => api.ops(ctx.view.crewId, { blackout_min: Number(b.dataset.blackout) }).catch(() => {})));
    el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => ctx.setMode?.(b.dataset.mode)));
    el.querySelector("[data-send-digest]")?.addEventListener("click", () => ctx.sendDigest?.());
    el.querySelectorAll("[data-suit]").forEach((b) => b.addEventListener("click", () => ctx.suitCommand?.({ action: b.dataset.suit, region: b.dataset.region, size: b.dataset.size })));
    el.querySelectorAll("[data-scn]").forEach((b) => b.addEventListener("click", async () => {
      const name = b.dataset.scn;
      try { await api.scenario(name, name === "full_demo" || name === "tired_crew" || name === "calm_down" ? "" : ""); } catch (e) { alertNote(e.message); }
    }));
    el.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", async () => { await api.clock(Number(b.dataset.skip)); ctx.onClockSkip?.(); }));
    el.querySelectorAll("[data-enrol]").forEach((b) => b.addEventListener("click", () => ctx.enrol(b.dataset.enrol, el.querySelector("[data-enrolst]"))));
  }

  function alertNote(t) { const n = el.querySelector("[data-enrolst]"); if (n) n.textContent = t; }

  function toggle() {
    el.hidden = !el.hidden;
    if (!el.hidden) render();
  }

  document.getElementById("btn-demo").addEventListener("click", toggle);
  document.getElementById("corner-demo")?.addEventListener("click", toggle);
  window.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select")) return;
    if (e.key === "d" || e.key === "D") toggle();
  });
  // three-finger tap
  window.addEventListener("touchstart", (e) => { if (e.touches.length === 3) { e.preventDefault(); toggle(); } }, { passive: false });
  return { toggle, render, get open() { return !el.hidden; } };
}
