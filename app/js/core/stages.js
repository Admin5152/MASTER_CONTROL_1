// Stage manager (brief section 8). Stages are camera moves and cross-fades inside the one world;
// panels arrive around the subject. The orb is Sentinel: centred on home, gliding to a corner when
// Sentinel opens something, back to the centre on "go back" or a tap.
import { emit } from "./bus.js";

export const STAGES = ["assistant", "mission", "body", "vitals", "vision", "radiation"];
const SCENE = { assistant: "space", mission: "space", radiation: "space", vision: "space", vitals: "space", body: "body" };
const VIEW = { assistant: "home", mission: "mission", radiation: "radiation", vision: "calm", vitals: "calm" };
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function createStages({ world, space, orb }) {
  let current = null;
  let mode = "intro";   // intro | home | corner | calm | off
  let big = false;      // speaking or listening while in the corner
  const hit = document.getElementById("orb-hit");
  const css = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;

  function target() {
    const W = window.innerWidth, H = window.innerHeight;
    const top = css("--top-h"), dock = css("--dock-h"), g = css("--gutter") || 24;
    if (mode === "intro") return { x: W / 2, y: H / 2, size: Math.min(H * 0.3, W * 0.34, 280) };
    if (mode === "home") {
      const free = H - top - dock;
      return { x: W / 2, y: top + free * 0.43, size: Math.min(free * 0.4, W * 0.32, 280) };
    }
    if (mode === "calm") return { x: W / 2, y: H * 0.36, size: Math.min(H * 0.34, W * 0.36, 300) };   // Stillpoint: room below for the cue
    if (mode === "off") return { x: W / 2, y: H / 2, size: 0, opacity: 0 };
    // docked: the orb lives inside the bottom bar, beside the menu button, so no card can ever sit over it.
    // Its particles spread about 1.2x its size, so the size is capped by the bar's height; speaking or
    // listening makes it brighter and a little larger, but never tall enough to reach the cards above.
    const room = Math.max(40, (dock - 10) / 1.2);
    const s = Math.min(big ? 74 : 58, room);
    return { x: g + 40, y: H - dock / 2 - 2, size: s };
  }

  function placeOrb(seconds = 1.0) {
    const t = target();
    world.orbTo({ opacity: 1, ...t }, reduced() ? 0 : seconds);
  }
  // keep the tap target and caption bubble on the orb
  world.onFrame(() => {
    const o = world.orbPlace;
    const d = Math.max(44, o.size * 0.9);
    hit.style.transform = `translate(${o.x - d / 2}px, ${o.y - d / 2}px)`;
    hit.style.width = hit.style.height = `${d}px`;
    hit.hidden = o.opacity < 0.2 || mode === "intro";
  });
  window.addEventListener("resize", () => placeOrb(0));

  return {
    get current() { return current; },
    get orbMode() { return mode; },
    setOrbMode(m, seconds) { mode = m; placeOrb(seconds); },
    restoreOrb() { mode = current === "assistant" ? "home" : "corner"; placeOrb(); },
    setOrbBig(b) { if (b === big) return; big = b; if (mode === "corner") placeOrb(0.6); },
    placeOrb,
    /** Go to a stage. Resolves once the new stage is showing. */
    async go(name, { instant = false } = {}) {
      if (!STAGES.includes(name)) return;
      const prev = current;
      if (name === prev) return;
      current = name;
      document.body.dataset.stage = name;
      document.querySelectorAll(".stage").forEach((s) => s.classList.toggle("is-active", s.dataset.stage === name));
      document.querySelectorAll("#topnav [data-nav]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.nav === name)));
      document.querySelectorAll("#tabbar [data-go]").forEach((b) => (b.dataset.go === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
      if (mode !== "calm" && mode !== "off") mode = name === "assistant" ? "home" : "corner";
      placeOrb(instant ? 0 : 1.0);
      world.setClinic(name === "body" ? 1 : 0, instant ? 0 : 0.9);
      const scene = SCENE[name];
      if (world.active !== scene) await world.show(scene, { fade: !instant });
      if (scene === "space") space.setView(VIEW[name] || "home", { instant });
      emit("stage", name);
      if (!instant && !reduced()) await new Promise((r) => setTimeout(r, 420));
    },
  };
}
