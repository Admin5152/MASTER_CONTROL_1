// Stage manager: the five full stages (assistant, mission, body, vision, radiation). A stage change is a
// cross-fade of the stage plus a camera move or scene cross-fade in the world window (600-900 ms).
// The orb floats over everything: large in the assistant window, small in the dock porthole.
import { emit } from "./bus.js";

export const STAGES = ["assistant", "mission", "body", "vision", "radiation"];
const VIEW = { assistant: "assistant", mission: "mission", radiation: "radiation" };
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function createStages({ world, space, orb, orbLayer }) {
  let current = null;
  let orbMode = "start";      // start | assistant | porthole | calm | off
  let orbBig = false;         // speaking/listening on a non-assistant stage
  const tabs = document.querySelectorAll("#tabbar [data-go]");

  function orbTarget() {
    const rectOf = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    let cx, cy, D;
    if (orbMode === "start") {
      const r = rectOf(".start-inner"); if (!r) return null;
      cx = r.left + r.width / 2; cy = r.top + r.height * 0.3; D = Math.min(r.height * 0.58, 330);
    } else if (orbMode === "assistant") {
      const r = rectOf("#assist-window"); if (!r || !r.width) return null;
      cx = r.left + r.width / 2; cy = r.top + r.height * 0.36; D = Math.min(r.height * 0.66, r.width * 0.6, 400);
    } else if (orbMode === "calm") {
      const r = rectOf("#sheet"); if (!r) return null;
      cx = r.left + r.width / 2; cy = r.top + r.height * 0.4; D = Math.min(r.height * 0.72, r.width * 0.7, 440);
    } else {
      const r = rectOf("#porthole"); if (!r || !r.width) return null;
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; D = r.width * (orbBig ? 2.3 : 1.85);
    }
    return { x: cx - D / 2, y: cy - D / 2, scale: D / 360 };
  }

  function placeOrb(instant = false) {
    orbLayer.classList.toggle("is-off", orbMode === "off");
    orb.setVisible(orbMode !== "off");
    const t = orbTarget();
    if (!t) return;
    const g = window.gsap;
    if (!g || instant || reduced()) { g ? g.set(orbLayer, t) : (orbLayer.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`); return; }
    g.to(orbLayer, { ...t, duration: 0.9, ease: "power3.inOut", overwrite: true });
  }
  window.addEventListener("resize", () => placeOrb(true));

  const api = {
    get current() { return current; },
    get orbMode() { return orbMode; },
    setOrbMode(m, instant = false) { orbMode = m; placeOrb(instant); },
    restoreOrb() { orbMode = current === "assistant" ? "assistant" : "porthole"; placeOrb(); },
    setOrbBig(b) { if (b === orbBig) return; orbBig = b; if (orbMode === "porthole") placeOrb(); },
    placeOrb,
    /** Go to a stage. Resolves once the new stage is showing. */
    async go(name, { instant = false } = {}) {
      if (!STAGES.includes(name)) return;
      const prev = current;
      current = name;
      document.body.dataset.stage = name;
      document.querySelectorAll(".stage").forEach((s) => s.classList.toggle("is-active", s.dataset.stage === name));
      tabs.forEach((b) => (b.dataset.go === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
      const host = document.querySelector(`#stage-${name} [data-world-host]`);
      if (host) {
        const scene = host.dataset.worldHost;
        const sameScene = world.active === scene;
        world.pause(false);
        if (!sameScene || world.host !== host) {
          if (prev && !instant && !reduced()) { world.renderer.domElement.classList.add("is-fading"); await new Promise((r) => setTimeout(r, 260)); }
          world.attach(host);
          await world.show(scene);
          world.renderer.domElement.classList.remove("is-fading");
        }
        if (scene === "space") space.setView(VIEW[name] || "assistant", { instant: instant || !prev });
      } else {
        world.pause(true);
      }
      if (orbMode !== "calm" && orbMode !== "off") orbMode = name === "assistant" ? "assistant" : "porthole";
      placeOrb(instant || !prev);
      emit("stage", name);
      if (!instant && !reduced()) await new Promise((r) => setTimeout(r, 380));
    },
  };
  return api;
}
