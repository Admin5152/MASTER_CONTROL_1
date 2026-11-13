// Body model: inlines app/assets/body.svg so its zone classes can be driven.
import { emit } from "../core/bus.js";

export const ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones"];
const STATE_CLASSES = ["is-ok", "is-watch", "is-alert"];
const FULL = { x: 0, y: 0, w: 400, h: 900 };

let svg = null;
let vb = { ...FULL };

export async function mountBody(host) {
  const txt = await fetch("assets/body.svg").then((r) => r.text());
  host.innerHTML = txt;
  svg = host.querySelector("svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.querySelectorAll(".zone").forEach((g) => {
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", g.querySelector("title")?.textContent || g.dataset.zone);
    g.addEventListener("click", () => emit("zone:open", g.dataset.zone));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); emit("zone:open", g.dataset.zone); }
    });
  });
  // The whole-body radiation layer is clickable when visible.
  const rad = svg.querySelector("#layer-radiation");
  if (rad) rad.addEventListener("click", () => emit("zone:open", "whole_body"));
  return svg;
}

export function bodySvg() { return svg; }

export function zoneEl(zone) { return svg?.querySelector(`#zone-${zone}`) || null; }

export function anchorOf(zone) {
  const el = zone === "whole_body" ? svg?.querySelector("#layer-radiation") : zoneEl(zone);
  const a = el?.dataset.anchor?.split(",").map(Number);
  return a ? { x: a[0], y: a[1] } : { x: 200, y: 450 };
}

/** Zones sorted top to bottom by anchor y: the scan order. Pure given anchors. */
export function scanOrder(anchors) {
  return Object.entries(anchors).sort((a, b) => a[1].y - b[1].y).map(([z]) => z);
}

export function setZoneStates(zones) {
  if (!svg) return;
  for (const z of ZONES) {
    const el = zoneEl(z);
    if (!el) continue;
    const st = zones?.[z] || "ok";
    const cls = `is-${st === "info" ? "watch" : st}`;
    if (!el.classList.contains(cls)) {
      el.classList.remove(...STATE_CLASSES);
      el.classList.add(cls);
    }
  }
}

export function setTarget(zone) {
  if (!svg) return;
  svg.querySelectorAll(".zone.is-target").forEach((g) => g.classList.remove("is-target"));
  if (zone && zone !== "whole_body") zoneEl(zone)?.classList.add("is-target");
}

export function showRadiation(on) { svg?.classList.toggle("show-radiation", !!on); }

export function screenPoint(x, y) {
  if (!svg) return { x: 0, y: 0 };
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = svg.createSVGPoint();
  p.x = x; p.y = y;
  const s = p.matrixTransform(m);
  return { x: s.x, y: s.y };
}

function applyVB() { svg?.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); }

/** Box that makes the zone fill about a third of the panel, centred on its anchor. */
export function zoomBoxFor(zone) {
  const el = zone === "whole_body" ? null : zoneEl(zone);
  const a = anchorOf(zone);
  if (!el) return { ...FULL };
  let bb;
  try { bb = el.getBBox(); } catch { bb = { width: 80, height: 80 }; }
  const size = Math.max(bb.width, bb.height, 40) * 3;
  const w = Math.min(FULL.w, size);
  const h = Math.min(FULL.h, size * (FULL.h / FULL.w) * 0.5 + size * 0.5);
  return { x: a.x - w / 2, y: a.y - h / 2, w, h };
}

export function zoomTo(box, duration, onUpdate) {
  const g = window.gsap;
  if (!g || duration === 0) {
    vb = { ...box };
    applyVB();
    onUpdate?.();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    g.to(vb, { ...box, duration, ease: "power2.inOut", overwrite: true,
      onUpdate: () => { applyVB(); onUpdate?.(); }, onComplete: resolve, onInterrupt: resolve });
  });
}

export function zoomReset(duration, onUpdate) { return zoomTo({ ...FULL }, duration, onUpdate); }
export function isZoomed() { return vb.w < FULL.w - 1; }
