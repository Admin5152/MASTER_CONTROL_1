// Sentinel Skin (brief section 7 item 7): the DESIGNED wearable. Each module says what it would measure,
// the real, published technology it is based on, and its source. Nothing on this screen is running.
// The body behind it shows where each module sits (chips pinned to the 3D body).
import { esc } from "../interface/readings.js";

export const MODULES = [
  { id: "shirt", zone: "lungs", name: "Base-layer smart shirt", measures: "ECG, heart rate, breathing rate and volume, blood pressure, SpO2, skin temperature, activity",
    basis: "CSA Astroskin Bio-Monitor, flown on the ISS", src: "https://asc-csa.gc.ca/eng/sciences/astroskin.asp" },
  { id: "patch", zone: "heart", name: "Ultrasound patches", measures: "Continuous internal imaging: heart chamber motion, lung surface, stomach, bladder, inferior vena cava for fluid shift",
    basis: "MIT bioadhesive ultrasound (BAUS) patch, Science 2022: organs imaged continuously for 48 hours, including during exercise. Real limitation: it needs external computing today.",
    src: "https://www.nih.gov/news-events/nih-research-matters/ultrasound-imaging-gets-small-wearable" },
  { id: "eye", zone: "head", name: "Eye module", measures: "Optic nerve sheath diameter through closed-eyelid ultrasound: an early marker linked to SANS",
    basis: "ISS crews already do ocular ultrasound; a 2022 review names a portable, reliable, non-invasive tool as an area of need. This is the gap the eye module would fill.",
    src: "https://www.nature.com/articles/s41526-022-00228-1.pdf" },
  { id: "compute", zone: "gut", name: "Pocket compute module", measures: "Processes the patches on board and links to Sentinel over Bluetooth Low Energy, so nothing waits for Earth",
    basis: "Answers the BAUS patch's need for external computing", src: "https://www.nih.gov/news-events/nih-research-matters/ultrasound-imaging-gets-small-wearable" },
];

export function renderHardware(el, ctx) {
  let open = null;
  const draw = () => {
    el.innerHTML = `<p class="note">A wearable that could scan the body internally, designed from real, published technologies. <strong>DESIGNED: none of it is running.</strong> Today Sentinel reads pulse from the webcam (LIVE) and simulates the rest (SIM).</p>
      <ol class="skin-mods">${MODULES.map((m, i) => `<li class="card ${open === m.id ? "is-open" : ""}">
        <button type="button" data-mod="${m.id}"><span class="skin-n">${i + 1}</span><span><strong>${esc(m.name)}</strong><small>${esc(m.measures)}</small></span><span class="badge badge-designed">DESIGNED</span></button>
        ${open === m.id ? `<div class="skin-more"><p><span class="label">Based on</span> ${esc(m.basis)}</p><a class="src-link" href="${m.src}" target="_blank" rel="noopener">Source</a></div>` : ""}</li>`).join("")}</ol>
      <p class="fine">Fed by SIM data in a demo, its readings would be labelled "SIM · Sentinel Skin" and never confused with live webcam data.</p>`;
    el.querySelectorAll("[data-mod]").forEach((b) => b.addEventListener("click", () => {
      open = open === b.dataset.mod ? null : b.dataset.mod;
      draw();
      const m = MODULES.find((x) => x.id === open);
      if (m) ctx.director?.run([{ cmd: "zoom_body", zone: m.zone }]);
    }));
  };
  draw();
  (async () => {
    if (ctx.stages && ctx.stages.current !== "body") await ctx.stages.go("body");
    ctx.body3d?.setChips(Object.fromEntries(MODULES.map((m, i) => [m.zone, { text: `${i + 1} ${m.name}`, badge: "DESIGNED" }])));
    ctx.skinChips = true;
  })();
  return () => { ctx.skinChips = false; ctx.body3d?.zoomReset(1.0); };
}
