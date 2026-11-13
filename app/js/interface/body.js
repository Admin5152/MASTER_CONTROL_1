// Body model facade. Pure parts (zones, scan order) are tested with node --test; the 3D model itself
// lives in ../world/body3d.js and is registered here once loaded, so this file never imports three.js.
export const ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones"];

let impl = null;
export function setImpl(i) { impl = i; }
export function body3d() { return impl; }
export function ready() { return !!impl; }

/** Zones sorted top to bottom by anchor y (screen-style y, growing downward): the scan order. Pure. */
export function scanOrder(anchors) {
  return Object.entries(anchors).sort((a, b) => a[1].y - b[1].y).map(([z]) => z);
}

/** Anchor of a zone in screen-style coordinates: x across, y downward (y = -height in metres). */
export function anchorOf(zone) {
  const a = impl?.anchorWorld(zone);
  return a ? { x: a[0], y: -a[1], h: a[1] } : { x: 0, y: 0, h: 1 };
}

export function zoneEl(zone) { return impl?.zoneEl(zone) || document.getElementById(`zone-${zone}`); }
export function setZoneStates(zones) { impl?.setZoneStates(zones); }
export function setTarget(zone) { impl?.setTarget(zone); }
export function showRadiation(on) { impl?.showRadiation(on); }
export function radiationShown() { return !!impl?.radiationOn; }
export function screenPoint(zone) { return impl ? impl.screenPoint(zone) : { x: 0, y: 0 }; }
