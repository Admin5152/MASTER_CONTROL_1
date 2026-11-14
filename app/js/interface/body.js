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

// ---------- zone status and pointing (Product Document section 7: BODY-1, BODY-2, BODY-6). Pure. ----------
const RANK = { ok: 0, none: 0, info: 1, watch: 2, alert: 3 };

/** The colour a zone shows: the worst of its indicators (info counts as watch). "ok" when it has none. */
export function worstSeverity(severities) {
  let worst = "ok";
  for (const s of severities || []) if ((RANK[s] || 0) > RANK[worst]) worst = s === "info" ? "watch" : s;
  return worst;
}

/** Zone -> status for every body zone: the brain's own verdict, never better than the readings shown for it. */
export function zoneStatuses(assessed, readingsByZone = {}) {
  const out = {};
  for (const z of ZONES) out[z] = worstSeverity([assessed?.[z] || "ok", ...(readingsByZone[z] || []).map((r) => r.severity)]);
  return out;
}

/** Places a person can point at on the body, and the health zone whose indicators each one opens. */
export const REGIONS = ["head", "eyes", "neck", "chest", "abdomen", "back", "arms", "hands", "legs", "feet"];
export const REGION_NAMES = { head: "Head", eyes: "Eyes", neck: "Neck", chest: "Chest", abdomen: "Abdomen", back: "Back",
  arms: "Arm", hands: "Hand", legs: "Leg", feet: "Foot" };
export const REGION_ZONE = { head: "head", eyes: "eyes", neck: "bones", chest: "heart", abdomen: "gut", back: "bones",
  arms: "bones", hands: "bones", legs: "bones", feet: "bones" };

/**
 * Which region a point on the body surface belongs to. Pure: `p` is {x, y, z, back} in metres (x across,
 * y up, z toward the front; back = the surface there faces backward) and `lm` the landmarks of the loaded
 * model (body3d derives them from its own geometry, so both bodies work):
 *   height, chinY, eyeY, eyeHalf (half the height of the eye band), shoulderY (top of the ribcage),
 *   waistY (bottom of the ribcage), hipY (the crotch), ankleY, trunkHalf (trunk half-width), handX (|x|
 *   beyond which an arm is the hand).
 */
export function regionOf(p, lm) {
  const ax = Math.abs(p.x);
  if (p.y >= lm.chinY) {
    if (!p.back && Math.abs(p.y - lm.eyeY) <= lm.eyeHalf && ax <= lm.height * 0.04) return "eyes";
    return "head";
  }
  // below the crotch the legs are near the midline; the hands hang further out at the same height
  if (p.y < lm.hipY && ax < lm.height * 0.15) return p.y < lm.ankleY ? "feet" : "legs";
  if (ax > lm.trunkHalf) return ax >= lm.handX ? "hands" : "arms";
  if (p.y >= lm.shoulderY) return "neck";
  if (p.back) return "back";
  return p.y >= lm.waistY ? "chest" : "abdomen";
}

export function regionAt(x, y) { return impl?.regionAt ? impl.regionAt(x, y) : null; }
export function setPointing(on) { impl?.setPointing?.(on); }
