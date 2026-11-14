// Keeps the anatomy inside the body it is shown in. Pure (typed arrays in, typed arrays out; no three.js,
// no DOM), so it is tested with node --test and reused by app/dev/xray_check.html.
//
// The anatomy GLBs are fitted to each body offline (tools/anatomy). What is left over is small and local:
// a rib or a vertebra a centimetre proud of the skin, a vein strand that kept the arms-down pose of the
// source specimen. conformAnatomy() fixes those at load time against the body mesh that is actually on
// screen, so every system (vessels, lungs, brain, heart, eyes, gut, bones) sits inside the same silhouette:
//   1. depthMap()      front and back surface of the body per (x, y) column, rasterised from its triangles
//   2. trunkField()    the source specimen's trunk is wider and deeper than these bodies, so per 1 cm of
//                      height the trunk cross-section (ribs, spine, pelvis and the organs inside them) is
//                      scaled and shifted as one piece until it fits under the skin: organs keep their
//                      place inside the ribcage, vessels follow, arms and head are left alone
//   3. conformPoints() what is still in front of or behind the skin is pressed back under it; a vertex
//                      just outside the outline is pulled to the nearest column; anything further is "lost"
//   4. dropLost()      for vessels only: triangles with a lost vertex are removed (a stray strand reads
//                      as a defect; a bone is never cut)
// The eyes are moved as a rigid pair instead, so the globes keep their shape.
// The body is up = +y, front = +z, in metres.

/** Front/back depth of a closed mesh for every (x, y) column of `cell` metres. */
export function depthMap(pos, index, cell = 0.004) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < x0) x0 = pos[i]; if (pos[i] > x1) x1 = pos[i];
    if (pos[i + 1] < y0) y0 = pos[i + 1]; if (pos[i + 1] > y1) y1 = pos[i + 1];
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
  const zMin = new Float32Array(nx * ny).fill(Infinity), zMax = new Float32Array(nx * ny).fill(-Infinity);
  const nTri = (index ? index.length : pos.length / 3) / 3;
  for (let t = 0; t < nTri; t++) {
    const a = (index ? index[t * 3] : t * 3) * 3, b = (index ? index[t * 3 + 1] : t * 3 + 1) * 3, c = (index ? index[t * 3 + 2] : t * 3 + 2) * 3;
    // triangle in grid units (cell centres sit at integer + 0.5)
    const ax = (pos[a] - x0) / cell, ay = (pos[a + 1] - y0) / cell, bx = (pos[b] - x0) / cell, by = (pos[b + 1] - y0) / cell, cx = (pos[c] - x0) / cell, cy = (pos[c + 1] - y0) / cell;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;   // edge-on to the view: covers no column
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5)), i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5)), j1 = Math.min(ny - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
    for (let j = j0; j <= j1; j++) {
      const py = j + 0.5;
      for (let i = i0; i <= i1; i++) {
        const px = i + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * pos[a + 2] + w1 * pos[b + 2] + w2 * pos[c + 2], k = j * nx + i;
        if (z < zMin[k]) zMin[k] = z;
        if (z > zMax[k]) zMax[k] = z;
      }
    }
  }
  return { x0, y0, cell, nx, ny, zMin, zMax };
}

/** The body's depth range [back, front] at (x, y), or null outside its outline. */
export function columnAt(map, x, y) {
  const i = Math.floor((x - map.x0) / map.cell), j = Math.floor((y - map.y0) / map.cell);
  if (i < 0 || j < 0 || i >= map.nx || j >= map.ny) return null;
  const k = j * map.nx + i;
  return map.zMax[k] >= map.zMin[k] ? [map.zMin[k], map.zMax[k]] : null;
}

/**
 * Move every vertex of `pos` (in place) inside the body described by `map`.
 *   margin  how far under the skin a pressed-in vertex ends up (metres)
 *   reach   how far outside the outline a vertex may be and still count as inside it (metres)
 *   region  (x, y) => true where vertices are moved. Pressing in along the depth axis is only right
 *           where the skin faces front or back (the trunk); in an arm that points forward it would
 *           smear the bones along their own length. Outside the region nothing moves: a vertex is
 *           only tested, and flagged when it is more than `slack` in front of or behind the body.
 *   tooFar  inside the region, a vertex this far outside the skin is flagged as well as pressed in
 * Returns { moved, lost, flags }: flags[i] is 1 for a vertex that does not belong inside this body.
 */
export function conformPoints(pos, map, { margin = 0.004, reach = 0.008, slack = 0.012, tooFar = 0.03, region = null } = {}) {
  const n = pos.length / 3, flags = new Uint8Array(n);
  const { x0, y0, cell, nx, ny, zMin, zMax } = map;
  const R = Math.max(1, Math.ceil(reach / cell));
  let moved = 0, lost = 0;
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    let i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
    let k = i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1;
    let shifted = false;
    if (k < 0 || zMax[k] < zMin[k]) {
      // outside the outline: the nearest column within reach, if any
      let best = -1, bd = reach * reach, bxp = 0, byp = 0;
      for (let dj = -R; dj <= R; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -R; di <= R; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx) continue;
          const kk = jj * nx + ii;
          if (zMax[kk] < zMin[kk]) continue;
          const cxp = x0 + (ii + 0.5) * cell, cyp = y0 + (jj + 0.5) * cell;
          const d = (cxp - x) * (cxp - x) + (cyp - y) * (cyp - y);
          if (d < bd) { bd = d; best = kk; bxp = cxp; byp = cyp; }
        }
      }
      if (best < 0) { flags[v] = 1; lost++; continue; }
      k = best; x = bxp; y = byp; shifted = true;
    }
    if (region && !region(pos[v * 3], pos[v * 3 + 1])) {
      if (z < zMin[k] - slack || z > zMax[k] + slack) { flags[v] = 1; lost++; }
      continue;
    }
    if (z < zMin[k] - tooFar || z > zMax[k] + tooFar) { flags[v] = 1; lost++; }
    let lo = zMin[k] + margin, hi = zMax[k] - margin;
    if (lo > hi) lo = hi = (zMin[k] + zMax[k]) / 2;   // thinner than two margins (a fingertip): the middle
    const nz = z < lo ? lo : z > hi ? hi : z;
    if (shifted || nz !== z) { pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = nz; moved++; }
  }
  return { moved, lost, flags };
}

/** A new index without the triangles `drop(a, b, c)` rejects (vertex numbers in). Works unindexed too. */
export function filterTriangles(index, vertexCount, drop) {
  const nTri = (index ? index.length : vertexCount) / 3;
  const out = new Uint32Array(nTri * 3);
  let w = 0;
  for (let t = 0; t < nTri; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    if (drop(a, b, c)) continue;
    out[w++] = a; out[w++] = b; out[w++] = c;
  }
  return out.subarray(0, w);
}

/** Remove triangles that touch a lost vertex. */
export function dropLost(index, vertexCount, flags) {
  return filterTriangles(index, vertexCount, (a, b, c) => flags[a] || flags[b] || flags[c]);
}

/** The trunk: bones that set the cross-section and the organs that must stay inside them. */
export const TRUNK_NODES = ["ribcage", "spine", "pelvis", "heart", "lungs", "airway", "liver", "stomach", "intestines", "pancreas_spleen", "kidneys"];
/** Never reshaped by the trunk field (the head is fitted on its own; the eyes move rigidly). */
export const HEAD_NODES = ["skull", "brain", "eyes"];

function smooth(a, r) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) { s += a[k]; n++; }
    out[i] = s / n;
  }
  return out;
}

/**
 * Per-height fit of the trunk cross-section to the body. Returns bands of `step` metres from `y0`:
 * sx (width scale about the midline), sz and oz (depth: z' = z * sz + oz) and env (the trunk half-width
 * the field applies to; it fades out over `fade` beyond it so the arms are not touched).
 *   skin  tissue left between the bones and the skin surface (metres)
 */
export function trunkField(map, parts, { step = 0.01, skin = 0.012, fade = 0.05 } = {}) {
  let yLo = Infinity, yHi = -Infinity;
  for (const n of ["pelvis", "spine", "ribcage"]) {
    const p = parts[n]?.pos;
    if (!p) continue;
    for (let i = 1; i < p.length; i += 3) { if (p[i] < yLo) yLo = p[i]; if (p[i] > yHi) yHi = p[i]; }
  }
  if (!(yHi > yLo)) return null;
  const nb = Math.ceil((yHi - yLo) / step);
  const ax = new Float32Array(nb), az0 = new Float32Array(nb).fill(Infinity), az1 = new Float32Array(nb).fill(-Infinity);
  for (const n of TRUNK_NODES) {
    const p = parts[n]?.pos, idx = parts[n]?.index;
    if (!p) continue;
    const visit = (v) => {
      const b = Math.floor((p[v * 3 + 1] - yLo) / step);
      if (b < 0 || b >= nb) return;
      const x = Math.abs(p[v * 3]), z = p[v * 3 + 2];
      if (x > ax[b]) ax[b] = x;
      if (z < az0[b]) az0[b] = z;
      if (z > az1[b]) az1[b] = z;
    };
    // only vertices still used by a triangle count
    if (idx) for (let i = 0; i < idx.length; i++) visit(idx[i]); else for (let v = 0; v < p.length / 3; v++) visit(v);
  }
  const { x0, y0, cell, nx, ny, zMin, zMax } = map;
  const ic = Math.floor((0 - x0) / cell);
  const sx = new Float32Array(nb).fill(1), sz = new Float32Array(nb).fill(1), oz = new Float32Array(nb);
  const env = Float32Array.from(ax), valid = new Uint8Array(nb);
  let lastBx = 0, lastSx = 1;
  for (let b = 0; b < nb; b++) {
    const j = Math.floor((yLo + (b + 0.5) * step - y0) / cell);
    if (j < 0 || j >= ny || !(ax[b] > 0)) continue;
    const ok = (i) => i >= 0 && i < nx && zMax[j * nx + i] >= zMin[j * nx + i];
    if (!ok(ic)) continue;   // below the crotch: the legs are separate, nothing to fit against
    let r = 0, l = 0;
    while (ok(ic + r + 1)) r++;
    while (ok(ic - l - 1)) l++;
    const bx = Math.min(r, l) * cell;
    // above the armpit the outline runs on into the arm: the width is no longer the torso's, so keep
    // the scale of the last height where it was
    if (lastBx && bx > lastBx + 0.04) sx[b] = lastSx;
    // where the outline is the torso's (or the neck's) own, everything at this height moves together
    else { sx[b] = Math.min(1, Math.max(0.5, (bx - skin) / ax[b])); lastBx = bx; lastSx = sx[b]; env[b] = Math.max(ax[b], bx); }
    // depth: the body's back and front over the middle of the trunk
    const half = Math.max(2, Math.round(Math.max(0.02, 0.5 * Math.min(ax[b], bx)) / cell));
    let zb0 = Infinity, zb1 = -Infinity;
    for (let i = ic - half; i <= ic + half; i++) if (ok(i)) { const k = j * nx + i; if (zMin[k] < zb0) zb0 = zMin[k]; if (zMax[k] > zb1) zb1 = zMax[k]; }
    const La = az1[b] - az0[b], Lb = zb1 - zb0 - 2 * skin;
    if (!(La > 0) || !(Lb > 0)) continue;
    const s = Math.min(1, Math.max(0.5, Lb / La)), h = (La * s) / 2, ca = (az0[b] + az1[b]) / 2;
    const c = Math.min(Math.max(ca, zb0 + skin + h), zb1 - skin - h);
    sz[b] = s; oz[b] = c - ca * s;   // z' = c + (z - ca) * s
    valid[b] = 1;
  }
  // a 1 cm band with no anatomy in it (a gap between two ribs) takes its neighbours' fit, so the field
  // does not dip back toward "no change" between them; bands past the first and last fitted one (the
  // bottom of the pelvis below the crotch, the top of the spine) keep the fit of the nearest fitted band,
  // so a bone is never half scaled; the field eases out only beyond the trunk (below)
  const first = valid.indexOf(1), last = valid.lastIndexOf(1);
  for (let b = 0; first >= 0 && b < nb; b++) {
    if (b >= first && b <= last) continue;
    const src = b < first ? first : last;
    for (const a of [sx, sz, oz]) a[b] = a[src];
    env[b] = Math.max(env[b], env[src]);
  }
  for (let b = first + 1; first >= 0 && b < last; b++) {
    if (valid[b]) continue;
    let lo = b - 1, hi = b + 1;
    while (!valid[hi]) hi++;
    const u = (b - lo) / (hi - lo);
    for (const a of [sx, sz, oz, env]) a[b] = a[lo] + (a[hi] - a[lo]) * u;
    valid[b] = 2;   // filled: later gaps interpolate from it as from a real band
  }
  // no step between neighbouring heights (bones must stay smooth), and the field eases back to "no
  // change" over `pad` bands past each end, so a vessel that runs on into the head or a leg is not torn
  const pad = 4, N = nb + 2 * pad;
  const ease = (a, rest) => {
    const s = smooth(smooth(a, 2), 2), out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const b = i - pad;
      if (b < 0) out[i] = rest + (s[0] - rest) * ((i + 0.5) / pad);
      else if (b >= nb) out[i] = rest + (s[nb - 1] - rest) * ((N - i - 0.5) / pad);
      else out[i] = s[b];
    }
    return out;
  };
  const e = smooth(env, 3), envN = new Float32Array(N);
  for (let i = 0; i < N; i++) envN[i] = e[Math.min(nb - 1, Math.max(0, i - pad))];
  return { y0: yLo - pad * step, step, n: N, fade, sx: ease(sx, 1), sz: ease(sz, 1), oz: ease(oz, 0), env: envN };
}

/** Apply a trunk field to one part's vertices, in place. Returns how many moved. */
export function applyTrunkField(pos, f) {
  if (!f) return 0;
  let moved = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const t = (pos[i + 1] - f.y0) / f.step - 0.5;
    if (t < -0.5 || t > f.n - 0.5) continue;
    const b0 = Math.min(f.n - 1, Math.max(0, Math.floor(t))), b1 = Math.min(f.n - 1, b0 + 1), u = Math.min(1, Math.max(0, t - b0));
    const sx = f.sx[b0] + (f.sx[b1] - f.sx[b0]) * u, sz = f.sz[b0] + (f.sz[b1] - f.sz[b0]) * u, oz = f.oz[b0] + (f.oz[b1] - f.oz[b0]) * u;
    if (sx > 0.999 && sz > 0.999 && Math.abs(oz) < 1e-4) continue;
    const env = f.env[b0] + (f.env[b1] - f.env[b0]) * u + 0.01;
    const d = (Math.abs(pos[i]) - env) / f.fade;
    const w = d <= 0 ? 1 : d >= 1 ? 0 : 1 - d * d * (3 - 2 * d);
    if (w <= 0) continue;
    pos[i] *= 1 - w * (1 - sx);
    pos[i + 2] += w * (pos[i + 2] * sz + oz - pos[i + 2]);
    moved++;
  }
  return moved;
}

/**
 * One scale and shift for the whole head (skull, brain and eyes move together, so the brain stays in the
 * skull and the eyes in their sockets). Measured at forehead height, above the ears and the nose, where
 * bone lies a few millimetres under the skin: the skull is made as wide and as deep as the head there,
 * less the `scalp`. Height is left alone (the crown and the neck joint already match).
 * Returns { sx, sz, oz, y0, y1 } with z' = z * sz + oz; y0..y1 is where vessels blend from neck to head.
 */
export function headFit(map, parts, { scalp = 0.006 } = {}) {
  const sk = parts.skull?.pos;
  if (!sk || !sk.length) return null;
  let yLo = Infinity, yHi = -Infinity;
  for (let i = 1; i < sk.length; i += 3) { if (sk[i] < yLo) yLo = sk[i]; if (sk[i] > yHi) yHi = sk[i]; }
  const yf = yLo + 0.72 * (yHi - yLo), band = 0.008;
  let ax = 0, az0 = Infinity, az1 = -Infinity;
  for (let i = 0; i < sk.length; i += 3) {
    if (Math.abs(sk[i + 1] - yf) > band) continue;
    if (Math.abs(sk[i]) > ax) ax = Math.abs(sk[i]);
    if (sk[i + 2] < az0) az0 = sk[i + 2];
    if (sk[i + 2] > az1) az1 = sk[i + 2];
  }
  const { x0, y0, cell, nx, ny, zMin, zMax } = map;
  const j = Math.floor((yf - y0) / cell), ic = Math.floor((0 - x0) / cell);
  if (!(ax > 0) || j < 0 || j >= ny) return null;
  const ok = (i) => i >= 0 && i < nx && zMax[j * nx + i] >= zMin[j * nx + i];
  if (!ok(ic)) return null;
  let r = 0, l = 0;
  while (ok(ic + r + 1)) r++;
  while (ok(ic - l - 1)) l++;
  const bx = Math.min(r, l) * cell;
  let zb0 = Infinity, zb1 = -Infinity;
  for (let i = ic - 4; i <= ic + 4; i++) if (ok(i)) { const k = j * nx + i; if (zMin[k] < zb0) zb0 = zMin[k]; if (zMax[k] > zb1) zb1 = zMax[k]; }
  const lim = (v) => Math.min(1.3, Math.max(0.85, v));
  const sx = lim((bx - scalp) / ax), sz = lim((zb1 - zb0 - 2 * scalp) / (az1 - az0));
  const oz = (zb0 + zb1) / 2 - ((az0 + az1) / 2) * sz;
  return { sx, sz, oz, y0: yLo - 0.02, y1: yLo + 0.02 };
}

/** Apply a head fit in place. `blend` fades it in between h.y0 and h.y1 (for vessels that run up the neck). */
export function applyHeadFit(pos, h, blend = false) {
  if (!h) return 0;
  let moved = 0;
  for (let i = 0; i < pos.length; i += 3) {
    let w = 1;
    if (blend) {
      const t = (pos[i + 1] - h.y0) / (h.y1 - h.y0);
      if (t <= 0) continue;
      w = t >= 1 ? 1 : t * t * (3 - 2 * t);
    }
    pos[i] *= 1 + w * (h.sx - 1);
    pos[i + 2] += w * (pos[i + 2] * h.sz + h.oz - pos[i + 2]);
    moved++;
  }
  return moved;
}

/** (x, y) => true inside the trunk a field covers (its envelope plus the fade). */
export function trunkRegion(f) {
  if (!f) return () => false;
  return (x, y) => {
    const b = Math.floor((y - f.y0) / f.step);
    return b >= 0 && b < f.n && Math.abs(x) <= f.env[b] + 0.01 + f.fade;
  };
}

/** Move a part back as one rigid piece until nothing is in front of the skin (at most `max` metres). */
export function seatRigid(pos, map, { margin = 0.001, max = 0.02 } = {}) {
  let over = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const c = columnAt(map, pos[i], pos[i + 1]);
    if (c && pos[i + 2] > c[1] - margin) over = Math.max(over, pos[i + 2] - (c[1] - margin));
  }
  over = Math.min(over, max);
  if (over > 0) for (let i = 2; i < pos.length; i += 3) pos[i] -= over;
  return over;
}

/** Nodes that run down the legs and arms and follow the leg and arm fits. */
export const LEG_NODES = ["limbs", "arteries", "veins"];

/**
 * Per-height fit of each leg's bones to that leg. The source specimen's legs are set wider than these
 * bodies', so on the female body the femur and tibia sat on the outer edge of the thigh and shin. Below
 * the crotch, per `step` metres of height and per side, the leg bones' cross-section is centred on the
 * body's own leg outline and narrowed to fit it (x' = cx + (x - ca) * s); depth is only corrected where the
 * bones would leave the leg. It fades out over `blend` above the crotch, so the femur stays in the hip.
 * Hands hanging beside the thighs are left alone (|x| beyond `limit`).
 */
export function legField(map, parts, { step = 0.01, skin = 0.008, blend = 0.07 } = {}) {
  const limbs = parts.limbs?.pos, pel = parts.pelvis?.pos;
  if (!limbs || !pel) return null;
  const { x0, y0, cell, nx, ny, zMin, zMax } = map;
  const ic = Math.floor((0 - x0) / cell);
  const ok = (j, i) => i >= 0 && i < nx && j >= 0 && j < ny && zMax[j * nx + i] >= zMin[j * nx + i];
  let pelX = 0, pelLo = Infinity;
  for (let i = 0; i < pel.length; i += 3) { pelX = Math.max(pelX, Math.abs(pel[i])); pelLo = Math.min(pelLo, pel[i + 1]); }
  const limit = pelX * 1.35;
  // the crotch: going down from just above the bottom of the pelvis, the first height where the body is
  // no longer one piece at the midline
  let crotch = null;
  for (let j = Math.floor((pelLo + 0.12 - y0) / cell); j >= 0; j--) if (!ok(j, ic)) { crotch = y0 + (j + 1) * cell; break; }
  if (crotch == null) return null;
  const yTop = crotch + blend, nb = Math.ceil((yTop - y0) / step);
  const sides = {};
  for (const sg of [1, -1]) {
    const lo = new Float32Array(nb).fill(Infinity), hi = new Float32Array(nb).fill(-Infinity);
    const z0 = new Float32Array(nb).fill(Infinity), z1 = new Float32Array(nb).fill(-Infinity);
    for (let i = 0; i < limbs.length; i += 3) {
      const x = limbs[i], b = Math.floor((limbs[i + 1] - y0) / step);
      if (x * sg <= 0 || Math.abs(x) > limit || b < 0 || b >= nb) continue;
      if (x < lo[b]) lo[b] = x;
      if (x > hi[b]) hi[b] = x;
      if (limbs[i + 2] < z0[b]) z0[b] = limbs[i + 2];
      if (limbs[i + 2] > z1[b]) z1[b] = limbs[i + 2];
    }
    const cxA = new Float32Array(nb), cxB = new Float32Array(nb), sc = new Float32Array(nb).fill(1);
    const sz = new Float32Array(nb).fill(1), oz = new Float32Array(nb), valid = new Uint8Array(nb);
    for (let b = 0; b < nb; b++) {
      const yb = y0 + (b + 0.5) * step;
      if (!(hi[b] >= lo[b]) || yb > crotch) continue;
      const j = Math.floor((yb - y0) / cell);
      const ca = (lo[b] + hi[b]) / 2, wa = (hi[b] - lo[b]) / 2;
      // the run of body columns on this side nearest the bones: the leg, not a hand hanging beside it
      let best = null, run = null;
      for (let i = ic; i >= 0 && i < nx && Math.abs(x0 + i * cell) <= limit + 0.06; i += sg) {
        const inside = ok(j, i);
        if (inside) { if (!run) run = [i, i]; run[1] = i; }
        const end = !inside || i + sg < 0 || i + sg >= nx;
        if (end && run) {
          const a = x0 + Math.min(run[0], run[1]) * cell, c = x0 + (Math.max(run[0], run[1]) + 1) * cell;
          const d = ca < a ? a - ca : ca > c ? ca - c : 0;
          if (!best || d < best.d) best = { a, c, d };
          run = null;
        }
      }
      if (!best) continue;
      const cb = (best.a + best.c) / 2, wb = (best.c - best.a) / 2;
      cxA[b] = ca; cxB[b] = cb;
      sc[b] = wa > 0 ? Math.min(1, Math.max(0.6, (wb - skin) / wa)) : 1;
      // depth: the leg's back and front at its centre column; move only what would leave the leg
      const ib = Math.floor((cb - x0) / cell);
      if (ok(j, ib)) {
        const k = j * nx + ib, La = z1[b] - z0[b], Lb = zMax[k] - zMin[k] - 2 * skin;
        if (La > 0 && Lb > 0) {
          const s2 = Math.min(1, Math.max(0.6, Lb / La)), h = (La * s2) / 2, cz = (z0[b] + z1[b]) / 2;
          const c = Math.min(Math.max(cz, zMin[k] + skin + h), zMax[k] - skin - h);
          sz[b] = s2; oz[b] = c - cz * s2;
        }
      }
      valid[b] = 1;
    }
    if (valid.indexOf(1) < 0) continue;
    // gaps take their neighbours' fit; past the last fitted band (up to the crotch) the last fit holds
    for (let b = 0; b < nb; b++) {
      if (valid[b]) continue;
      let l = b - 1; while (l >= 0 && !valid[l]) l--;
      let h = b + 1; while (h < nb && !valid[h]) h++;
      for (const a of [cxA, cxB, sc, sz, oz]) a[b] = l < 0 ? a[h] : h >= nb ? a[l] : a[l] + (a[h] - a[l]) * ((b - l) / (h - l));
    }
    const sm = (a) => Float32Array.from(a, (_, b) => {
      let t = 0, c = 0;
      for (let k = Math.max(0, b - 3); k <= Math.min(nb - 1, b + 3); k++) { t += a[k]; c++; }
      return t / c;
    });
    sides[sg] = { cxA: sm(cxA), cxB: sm(cxB), s: sm(sc), sz: sm(sz), oz: sm(oz) };
  }
  return { y0, step, n: nb, crotch, yTop, limit, sides };
}

/** Apply a leg field in place. Returns how many vertices moved. */
export function applyLegField(pos, f) {
  if (!f) return 0;
  let moved = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1];
    if (y >= f.yTop || Math.abs(x) > f.limit + 0.03) continue;
    const S = f.sides[x >= 0 ? 1 : -1];
    if (!S) continue;
    const b = Math.min(f.n - 1, Math.max(0, Math.floor((y - f.y0) / f.step)));
    let w = y <= f.crotch ? 1 : 1 - (y - f.crotch) / (f.yTop - f.crotch);
    w = w * w * (3 - 2 * w);
    const d = (Math.abs(x) - f.limit) / 0.03;   // fade out toward a hand hanging beside the thigh
    if (d > 0) w *= 1 - Math.min(1, d);
    if (w <= 0) continue;
    const nxv = S.cxB[b] + (x - S.cxA[b]) * S.s[b], nz = pos[i + 2] * S.sz[b] + S.oz[b];
    pos[i] = x + w * (nxv - x);
    pos[i + 2] += w * (nz - pos[i + 2]);
    moved++;
  }
  return moved;
}

/**
 * Per-arm fit, so the hand bones sit in the hand. The specimen's arm is longer than these bodies' and its
 * hand hangs at a slightly different angle, so the finger bones ended below and in front of the body's
 * hand. For each arm, in the front view (x, y): the bone line from the shoulder pivot (the top of the
 * humerus) to the bone fingertip is turned and stretched onto the body's line from the same pivot to its
 * own fingertip; then, every `step` metres along that line, the bones' cross-section is centred on the
 * arm's (perpendicular in x, y; and in depth z) and narrowed to fit. The fit fades in from the shoulder
 * (`from`..`full`, fractions of the arm length) so the shoulder joint is not pulled apart.
 */
export function armField(map, body, parts, { step = 0.01, skin = 0.006, from = 0.12, full = 0.32 } = {}) {
  const limbs = parts.limbs?.pos;
  if (!limbs || !body?.pos) return null;
  const H = map.ny * map.cell, bp = body.pos;
  const arms = {};
  for (const sg of [1, -1]) {
    // pivot: the top of the humerus; tips: the lowest point far from the midline (the fingertip)
    let pv = null, ta = null, tb = null;
    for (let i = 0; i < limbs.length; i += 3) {
      const x = limbs[i], y = limbs[i + 1];
      if (x * sg > 0.06 * H && y > 0.62 * H && (!pv || y > pv[1])) pv = [x, y];
      if (x * sg > 0.2 * H && (!ta || y < ta[1])) ta = [x, y];
    }
    for (let i = 0; i < bp.length; i += 3) if (bp[i] * sg > 0.2 * H && (!tb || bp[i + 1] < tb[1])) tb = [bp[i], bp[i + 1]];
    if (!pv || !ta || !tb) continue;
    const La = Math.hypot(ta[0] - pv[0], ta[1] - pv[1]), Lb = Math.hypot(tb[0] - pv[0], tb[1] - pv[1]);
    if (!(La > 0.2 && Lb > 0.2)) continue;
    const aa = Math.atan2(ta[1] - pv[1], ta[0] - pv[0]), ab = Math.atan2(tb[1] - pv[1], tb[0] - pv[0]);
    const k = Lb / La, rot = ab - aa, dx = Math.cos(ab), dy = Math.sin(ab);   // body arm axis
    const nxp = -dy, nyp = dx;                                                // perpendicular in x, y
    const toAxis = (x, y) => {   // a bone point, turned and stretched onto the body's arm line: (t, u)
      const rx = x - pv[0], ry = y - pv[1];
      const cx = (rx * Math.cos(rot) - ry * Math.sin(rot)) * k, cy = (rx * Math.sin(rot) + ry * Math.cos(rot)) * k;
      return [cx * dx + cy * dy, cx * nxp + cy * nyp];
    };
    const isArm = (x, y) => {
      if (x * sg < 0.06 * H) return false;
      const [t, u] = toAxis(x, y);
      return t > 0 && t < Lb * 1.08 && Math.abs(u) < 0.12;
    };
    const nb = Math.ceil((Lb * 1.08) / step);
    const u0 = new Float32Array(nb).fill(Infinity), u1 = new Float32Array(nb).fill(-Infinity);
    const z0 = new Float32Array(nb).fill(Infinity), z1 = new Float32Array(nb).fill(-Infinity);
    for (let i = 0; i < limbs.length; i += 3) {
      if (!isArm(limbs[i], limbs[i + 1])) continue;
      const [t, u] = toAxis(limbs[i], limbs[i + 1]), b = Math.min(nb - 1, Math.floor(t / step));
      if (u < u0[b]) u0[b] = u; if (u > u1[b]) u1[b] = u;
      if (limbs[i + 2] < z0[b]) z0[b] = limbs[i + 2]; if (limbs[i + 2] > z1[b]) z1[b] = limbs[i + 2];
    }
    const cuA = new Float32Array(nb), cuB = new Float32Array(nb), su = new Float32Array(nb).fill(1);
    const czA = new Float32Array(nb), czB = new Float32Array(nb), sz = new Float32Array(nb).fill(1), valid = new Uint8Array(nb);
    const ds = map.cell * 0.5;
    for (let b = 0; b < nb; b++) {
      if (!(u1[b] >= u0[b])) continue;
      const t = (b + 0.5) * step, px = pv[0] + dx * t, py = pv[1] + dy * t;
      const ca = (u0[b] + u1[b]) / 2, wa = (u1[b] - u0[b]) / 2;
      // the body's arm across the line at this point: the run of columns nearest the bones
      let best = null, run = null;
      for (let s = -0.14; s <= 0.14 + 1e-9; s += ds) {
        const inside = !!columnAt(map, px + nxp * s, py + nyp * s);
        if (inside) { if (!run) run = [s, s]; run[1] = s; }
        if ((!inside || s + ds > 0.14) && run) {
          const d = ca < run[0] ? run[0] - ca : ca > run[1] ? ca - run[1] : 0;
          if (!best || d < best.d) best = { a: run[0], c: run[1], d };
          run = null;
        }
      }
      if (!best || best.c - best.a > 0.2) continue;   // merged with the trunk (near the shoulder)
      const cb = (best.a + best.c) / 2, wb = (best.c - best.a) / 2 + ds / 2;
      const col = columnAt(map, px + nxp * cb, py + nyp * cb);
      if (!col) continue;
      cuA[b] = ca; cuB[b] = cb;
      su[b] = wa > 0 ? Math.min(1, Math.max(0.4, (wb - skin) / wa)) : 1;
      const La2 = z1[b] - z0[b], Lb2 = col[1] - col[0] - 2 * skin;
      czA[b] = (z0[b] + z1[b]) / 2; czB[b] = (col[0] + col[1]) / 2;
      sz[b] = La2 > 0 && Lb2 > 0 ? Math.min(1, Math.max(0.4, Lb2 / La2)) : 1;
      valid[b] = 1;
    }
    if (valid.indexOf(1) < 0) continue;
    for (let b = 0; b < nb; b++) {
      if (valid[b]) continue;
      let l = b - 1; while (l >= 0 && !valid[l]) l--;
      let h = b + 1; while (h < nb && !valid[h]) h++;
      for (const a of [cuA, cuB, su, czA, czB, sz]) a[b] = l < 0 ? a[h] : h >= nb ? a[l] : a[l] + (a[h] - a[l]) * ((b - l) / (h - l));
    }
    const sm = (a) => Float32Array.from(a, (_, b) => {
      let t = 0, c = 0;
      for (let q = Math.max(0, b - 2); q <= Math.min(nb - 1, b + 2); q++) { t += a[q]; c++; }
      return t / c;
    });
    arms[sg] = { pv, Lb, dx, dy, nxp, nyp, toAxis, isArm, nb, step, from, full, cuA: sm(cuA), cuB: sm(cuB), su: sm(su), czA: sm(czA), czB: sm(czB), sz: sm(sz) };
  }
  return Object.keys(arms).length ? { arms } : null;
}

/** Apply an arm field in place. Returns how many vertices moved. */
export function applyArmField(pos, f) {
  if (!f) return 0;
  let moved = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const A = f.arms[pos[i] >= 0 ? 1 : -1];
    if (!A || !A.isArm(pos[i], pos[i + 1])) continue;
    const [t, u] = A.toAxis(pos[i], pos[i + 1]);
    const r = t / A.Lb;
    let w = r <= A.from ? 0 : r >= A.full ? 1 : (r - A.from) / (A.full - A.from);
    w = w * w * (3 - 2 * w);
    if (w <= 0) continue;
    const b = Math.min(A.nb - 1, Math.max(0, Math.floor(t / A.step)));
    const u2 = A.cuB[b] + (u - A.cuA[b]) * A.su[b];
    const z2 = A.czB[b] + (pos[i + 2] - A.czA[b]) * A.sz[b];
    const tx = A.pv[0] + A.dx * t + A.nxp * u2, ty = A.pv[1] + A.dy * t + A.nyp * u2;
    pos[i] += w * (tx - pos[i]);
    pos[i + 1] += w * (ty - pos[i + 1]);
    pos[i + 2] += w * (z2 - pos[i + 2]);
    moved++;
  }
  return moved;
}

// ---------- hands and feet: every small bone moved, whole, into the nearest finger, toe or palm ----------
// The specimen's fingers are posed differently from the bodies' (straighter, less spread), so after the
// arm fit finger bones still crossed between the body's fingers, and the feet sat slightly off. Each small
// bone (a phalanx, a carpal, a metatarsal: one connected island of the mesh) is translated as a rigid
// piece, and if it still does not fit, shrunk a little about its centre, until it lies under the skin.
// Inside/outside is judged against the nearest body vertex and its normal, which works in 3D (a finger
// seen edge-on), where the front-view depth map does not.

/** Area-weighted vertex normals of a triangle mesh. */
export function vertexNormals(pos, index) {
  const n = new Float32Array(pos.length), nTri = (index ? index.length : pos.length / 3) / 3;
  for (let t = 0; t < nTri; t++) {
    const a = (index ? index[t * 3] : t * 3) * 3, b = (index ? index[t * 3 + 1] : t * 3 + 1) * 3, c = (index ? index[t * 3 + 2] : t * 3 + 2) * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

/** Nearest-vertex lookup over the body vertices `keep` selects; signedOut(p) > 0 means outside the skin. */
export function surfaceIndex(pos, normals, keep, cell = 0.01) {
  // numeric cell keys (the body is a couple of metres across: 1024 cells a side is plenty)
  const grid = new Map(), key = (i, j, k) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  for (let v = 0; v < pos.length / 3; v++) {
    if (!keep(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])) continue;
    const k = key(Math.floor(pos[v * 3] / cell), Math.floor(pos[v * 3 + 1] / cell), Math.floor(pos[v * 3 + 2] / cell));
    (grid.get(k) || grid.set(k, []).get(k)).push(v);
  }
  function nearest(x, y, z) {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        // only the shell of this radius: the inside was searched at a smaller one
        if (r > 1 && Math.abs(i - ci) < r && Math.abs(j - cj) < r && Math.abs(k - ck) < r) continue;
        const list = grid.get(key(i, j, k));
        if (!list) continue;
        for (const v of list) {
          const d = (pos[v * 3] - x) ** 2 + (pos[v * 3 + 1] - y) ** 2 + (pos[v * 3 + 2] - z) ** 2;
          if (d < bd) { bd = d; best = v; }
        }
      }
    }
    return best;
  }
  /** How far outside the skin (metres, along the nearest normal); negative inside. NaN: no skin near. */
  function signedOut(x, y, z, out) {
    const v = nearest(x, y, z);
    if (v < 0) return NaN;
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    if (out) { out[0] = nx; out[1] = ny; out[2] = nz; }
    return (x - pos[v * 3]) * nx + (y - pos[v * 3 + 1]) * ny + (z - pos[v * 3 + 2]) * nz;
  }
  return { nearest, signedOut, size: grid.size };
}

/** Connected pieces of a mesh (vertex islands joined by triangles), as arrays of vertex numbers. */
export function islands(index, vertexCount, keepVertex) {
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const nTri = (index ? index.length : vertexCount) / 3;
  for (let t = 0; t < nTri; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    const ra = find(a), rb = find(b), rc = find(c);
    parent[rb] = ra; parent[find(rc)] = ra;
  }
  const groups = new Map();
  for (let v = 0; v < vertexCount; v++) {
    if (keepVertex && !keepVertex(v)) continue;
    const r = find(v);
    (groups.get(r) || groups.set(r, []).get(r)).push(v);
  }
  return [...groups.values()];
}

/**
 * Move each island of `pos` (only those `inRegion` selects by centroid) as a rigid piece until it is under
 * the skin by `margin`: up to `iters` steps of the mean push of its outside vertices, at most `maxMove` in
 * all; a piece still mostly outside is shrunk about its centre, never below `minScale`.
 * With `rootOf(x, y, z)` (distance from the wrist or heel) the pieces are done from the root outward, and
 * each first takes the move of the nearest piece before it (within `chain` metres), so a finger's bones
 * stay one connected chain instead of each finding its own spot.
 * Returns { pieces, moved, shrunk, out } (out: vertices still outside afterwards).
 */
export function containIslands(pos, index, surf, inRegion, { margin = 0.0025, iters = 8, maxMove = 0.035, minScale = 0.7, rootOf = null, chain = 0.045, skip = null } = {}) {
  const n = pos.length / 3;
  const centre = (vs) => {
    let x = 0, y = 0, z = 0;
    for (const v of vs) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; }
    return [x / vs.length, y / vs.length, z / vs.length];
  };
  const pieces = islands(index, n).map((vs) => ({ vs, c0: centre(vs) })).filter((p) => p.vs.length >= 3 && !(skip && skip[p.vs[0]]) && inRegion(...p.c0));
  if (rootOf) { for (const p of pieces) p.root = rootOf(...p.c0); pieces.sort((a, b) => a.root - b.root); }
  const done = [];
  const nrm = [0, 0, 0];
  let moved = 0, shrunk = 0, out = 0;
  for (const piece of pieces) {
    const vs = piece.vs;
    piece.tr = [0, 0, 0];
    // inherit the move of the piece before it in the chain (the nearest one closer to the root)
    if (rootOf) {
      let best = null, bd = chain * chain;
      for (const q of done) {
        if (q.root >= piece.root) continue;
        const d = (q.c0[0] - piece.c0[0]) ** 2 + (q.c0[1] - piece.c0[1]) ** 2 + (q.c0[2] - piece.c0[2]) ** 2;
        if (d < bd) { bd = d; best = q; }
      }
      if (best) {
        piece.tr = [...best.tr];
        for (const v of vs) { pos[v * 3] += best.tr[0]; pos[v * 3 + 1] += best.tr[1]; pos[v * 3 + 2] += best.tr[2]; }
      }
    }
    done.push(piece);
    let total = 0, scale = 1;
    for (let it = 0; it < iters; it++) {
      let px = 0, py = 0, pz = 0, k = 0;
      for (const v of vs) {
        const d = surf.signedOut(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], nrm) + margin;
        if (!(d > 0)) continue;
        px -= nrm[0] * d; py -= nrm[1] * d; pz -= nrm[2] * d; k++;
      }
      if (!k) break;
      const frac = k / vs.length;
      let mx = px / k, my = py / k, mz = pz / k;
      const len = Math.hypot(mx, my, mz), room = maxMove - total;
      if (len > room) { const f = Math.max(0, room) / len; mx *= f; my *= f; mz *= f; }
      total += Math.hypot(mx, my, mz);
      // most of it out and no more room to move: make it a little smaller instead
      const s = (frac > 0.25 && (it >= 3 || room <= 0)) ? Math.max(minScale / scale, 0.94) : 1;
      let cx = 0, cy = 0, cz = 0;
      for (const v of vs) { cx += pos[v * 3]; cy += pos[v * 3 + 1]; cz += pos[v * 3 + 2]; }
      cx /= vs.length; cy /= vs.length; cz /= vs.length;
      for (const v of vs) {
        pos[v * 3] = cx + (pos[v * 3] - cx) * s + mx;
        pos[v * 3 + 1] = cy + (pos[v * 3 + 1] - cy) * s + my;
        pos[v * 3 + 2] = cz + (pos[v * 3 + 2] - cz) * s + mz;
      }
      if (s < 1) { scale *= s; shrunk++; }
      piece.tr[0] += mx; piece.tr[1] += my; piece.tr[2] += mz;
      moved++;
    }
    for (const v of vs) if (surf.signedOut(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]) > margin) out++;
  }
  return { pieces: pieces.length, moved, shrunk, out };
}

/**
 * One bone chain in each of the five fingers, laid along that finger. The hand bones are separate pieces:
 * carpals, five metacarpals, then three phalanges per finger (two in the thumb).
 *  - Bone chains: from each fingertip bone (a large piece touching one large piece, further from the wrist
 *    than it) walk toward the wrist: three phalanges (two for the thumb), then the metacarpal.
 *  - Body fingers: sweep the hand's skin from its lowest point up, joining each vertex to its swept mesh
 *    neighbours. Each finger starts as its own piece at its tip and joins the rest at the web; the five that
 *    stay separate longest are the fingers. A finger's skin (below its web) gives its axis.
 *  - The thumb is the tip furthest from the other four, on the bones and on the body, and is paired with
 *    the thumb; the four fingers are paired by the least total distance.
 *  - Each chain is moved, turned and scaled as one piece so it runs down its finger's axis and ends just
 *    inside the tip; the bones stay joined. The metacarpal bends from the wrist (unchanged) to the knuckle
 *    (following the chain). Crumbs left by mesh decimation follow the piece they sit on.
 * Returns { report, done } where done flags the vertices placed here (the later bone-by-bone pass skips them).
 */
export function fitFingers(pos, index, bodyPos, bodyIndex, handOf, wrist, { big = 40, touch = 0.006, inset = 0.008, surf = null } = {}) {
  const n = pos.length / 3, done = new Uint8Array(n);
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const B = (v) => [bodyPos[v * 3], bodyPos[v * 3 + 1], bodyPos[v * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]), unit = (a) => mul(a, 1 / (len(a) || 1));
  const all = islands(index, n).map((vs) => {
    let c = [0, 0, 0];
    for (const v of vs) c = add(c, P(v));
    return { vs, c: mul(c, 1 / vs.length) };
  });
  const report = {};
  for (const sg of [1, -1]) {
    const W = wrist[sg];
    if (!W) continue;
    const dW = (p) => len(sub(p, W));
    // ---- bone chains ----
    const hand = all.filter((p) => p.c[0] * sg > 0 && handOf(p.c[0], p.c[1]));
    const bigs = hand.filter((p) => p.vs.length >= big);
    if (bigs.length < 15) { report[sg] = { why: "bigs", n: bigs.length }; continue; }
    for (const p of bigs) { p.s = p.vs.filter((_, i) => i % 2 === 0); p.nb = []; p.d = dW(p.c); }
    const touching = (A, B2) => {
      for (const a of A.s) for (const b of B2.s) if ((pos[a * 3] - pos[b * 3]) ** 2 + (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2 < touch * touch) return true;
      return false;
    };
    for (let i = 0; i < bigs.length; i++) for (let j = i + 1; j < bigs.length; j++) {
      if (len(sub(bigs[i].c, bigs[j].c)) > 0.08) continue;
      if (touching(bigs[i], bigs[j])) { bigs[i].nb.push(bigs[j]); bigs[j].nb.push(bigs[i]); }
    }
    const leaves = bigs.filter((p) => p.nb.length === 1 && p.d > p.nb[0].d).sort((a, b) => b.d - a.d).slice(0, 5);
    if (leaves.length !== 5) { report[sg] = { why: "leaves", n: leaves.length }; continue; }
    const farthest = (pts) => { let bi = 0, bs = -1; pts.forEach((p, i) => { let s = 0; pts.forEach((q, j) => { if (j !== i) s += len(sub(p, q)); }); if (s > bs) { bs = s; bi = i; } }); return bi; };
    const leafTip = (leaf) => { let t = null, td = -1; for (const v of leaf.vs) { const d = dW(P(v)); if (d > td) { td = d; t = P(v); } } return t; };
    const boneTips = leaves.map(leafTip), boneThumb = farthest(boneTips);
    const chains = leaves.map((leaf, i) => {
      const phal = [leaf];
      let cur = leaf;
      const nPh = i === boneThumb ? 2 : 3;
      const step = () => cur.nb.filter((q) => q.d < cur.d && !phal.includes(q)).sort((a, b) => b.d - a.d)[0];
      while (phal.length < nPh) { const nx = step(); if (!nx) break; phal.push(nx); cur = nx; }
      const meta = step() || null;
      // the knuckle: where the first phalanx meets the metacarpal (mean of its vertices nearest it)
      let K;
      if (meta) {
        const near = cur.vs.map((v) => [Math.min(...meta.s.map((m) => len(sub(P(v), P(m))))), v]).sort((a, b) => a[0] - b[0]).slice(0, 12);
        K = mul(near.reduce((s, [, v]) => add(s, P(v)), [0, 0, 0]), 1 / near.length);
      } else { let kd = Infinity; for (const v of cur.vs) { const d = dW(P(v)); if (d < kd) { kd = d; K = P(v); } } }
      return { phal, meta, K, tip: boneTips[i], thumb: i === boneThumb };
    });
    // ---- body fingers (persistence sweep over the hand's skin) ----
    const nb = bodyPos.length / 3, inH = new Uint8Array(nb);
    let cnt = 0;
    for (let v = 0; v < nb; v++) if (bodyPos[v * 3] * sg > 0 && handOf(bodyPos[v * 3], bodyPos[v * 3 + 1]) && bodyPos[v * 3 + 1] < W[1] + 0.02) { inH[v] = 1; cnt++; }
    if (cnt < 50) { report[sg] = { why: "hand skin", n: cnt }; continue; }
    const adj = new Map(), link = (u, w) => { (adj.get(u) || adj.set(u, []).get(u)).push(w); (adj.get(w) || adj.set(w, []).get(w)).push(u); };
    const nTri = (bodyIndex ? bodyIndex.length : nb) / 3;
    for (let t = 0; t < nTri; t++) {
      const tri = [0, 1, 2].map((q) => (bodyIndex ? bodyIndex[t * 3 + q] : t * 3 + q));
      for (let q = 0; q < 3; q++) if (inH[tri[q]] && inH[tri[(q + 1) % 3]]) link(tri[q], tri[(q + 1) % 3]);
    }
    const posKey = new Map();   // seams: vertices at the same position are the same skin point
    for (let v = 0; v < nb; v++) {
      if (!inH[v]) continue;
      const k = `${Math.round(bodyPos[v * 3] * 1e4)},${Math.round(bodyPos[v * 3 + 1] * 1e4)},${Math.round(bodyPos[v * 3 + 2] * 1e4)}`;
      const o = posKey.get(k);
      if (o != null) link(v, o); else posKey.set(k, v);
    }
    const order = [];
    for (let v = 0; v < nb; v++) if (inH[v]) order.push(v);
    order.sort((x, y) => bodyPos[x * 3 + 1] - bodyPos[y * 3 + 1]);
    const par = new Map(), birth = new Map(), seen = new Uint8Array(nb), born = [];
    const root = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    for (const v of order) {
      seen[v] = 1; par.set(v, v); birth.set(v, v);
      let mine = v;
      for (const u of adj.get(v) || []) {
        if (!seen[u]) continue;
        const ru = root(u), rm = root(mine);
        if (ru === rm) continue;
        const bu = birth.get(ru), bm = birth.get(rm);
        const [old, young] = bodyPos[bu * 3 + 1] <= bodyPos[bm * 3 + 1] ? [ru, rm] : [rm, ru];
        const yb = birth.get(young);
        if (yb !== v) born.push({ pers: bodyPos[v * 3 + 1] - bodyPos[yb * 3 + 1], tip: yb, webY: bodyPos[v * 3 + 1] });
        par.set(young, old);
        mine = old;
      }
    }
    born.push({ pers: Infinity, tip: birth.get(root(order[0])), webY: null });
    born.sort((x, y) => y.pers - x.pers);
    const fingers = born.slice(0, 5);
    if (fingers.length < 5) { report[sg] = { why: "body fingers", n: fingers.length }; continue; }
    const webs = fingers.filter((f) => f.webY != null).map((f) => f.webY).sort((a, b) => a - b);
    for (const f of fingers) if (f.webY == null) f.webY = webs[0];
    // each finger's skin below its web, reached from its tip; its axis (principal direction, toward the tip)
    for (const f of fingers) {
      const tipP = B(f.tip), mem = [f.tip], mark = new Set([f.tip]);
      for (let i = 0; i < mem.length; i++) for (const u of adj.get(mem[i]) || []) if (!mark.has(u) && bodyPos[u * 3 + 1] <= f.webY) { mark.add(u); mem.push(u); }
      let C = [0, 0, 0];
      for (const v of mem) C = add(C, B(v));
      C = mul(C, 1 / mem.length);
      // principal axis by power iteration on the covariance
      let D = unit(sub(tipP, C));
      for (let it = 0; it < 12; it++) {
        let nd = [0, 0, 0];
        for (const v of mem) { const d = sub(B(v), C); nd = add(nd, mul(d, dot(d, D))); }
        D = unit(nd);
      }
      if (dot(D, sub(tipP, C)) < 0) D = mul(D, -1);
      // axis points level with the tip and with the web
      f.axisTip = add(C, mul(D, dot(sub(tipP, C), D) - inset));
      let wp = -Infinity; for (const v of mem) wp = Math.max(wp, -dot(sub(B(v), C), D));
      f.axisWeb = add(C, mul(D, -wp));
      f.D = D; f.tipP = tipP; f.n = mem.length;
    }
    const bodyThumb = farthest(fingers.map((f) => f.tipP));
    // order the fingers thumb, index, middle, ring, little (by distance from the thumb tip), on both
    // the four fingers in a row along the line they spread across; the end nearer the thumb is the index
    const rank = (tipsArr, thumbI) => {
      const four = [0, 1, 2, 3, 4].filter((i) => i !== thumbI);
      let m = [0, 0, 0];
      for (const i of four) m = add(m, tipsArr[i]);
      m = mul(m, 0.25);
      // the spread line: the pair of fingertips furthest apart
      let e = null, bd = -1;
      for (const i of four) for (const j of four) { const d = len(sub(tipsArr[i], tipsArr[j])); if (d > bd) { bd = d; e = unit(sub(tipsArr[j], tipsArr[i])); } }
      const row = four.map((i) => [dot(sub(tipsArr[i], m), e), i]).sort((x, y) => x[0] - y[0]).map(([, i]) => i);
      const T = tipsArr[thumbI];
      if (len(sub(tipsArr[row[3]], T)) < len(sub(tipsArr[row[0]], T))) row.reverse();
      return [thumbI, ...row];
    };
    const bodyTips = fingers.map((f) => f.tipP);
    const rb = rank(boneTips, boneThumb), rf = rank(bodyTips, bodyThumb);
    // turn the whole hand about the wrist so its frame (wrist to the four fingertips; index to little)
    // matches the body's: the specimen's palm faces forward, these bodies' palms face the thighs
    const frame = (tipsArr, r) => {
      const m = mul(add(add(tipsArr[r[1]], tipsArr[r[2]]), add(tipsArr[r[3]], tipsArr[r[4]])), 0.25);
      const e1 = unit(sub(m, W));
      let e2 = sub(tipsArr[r[1]], tipsArr[r[4]]);
      e2 = unit(sub(e2, mul(e1, dot(e2, e1))));
      const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      return [e1, e2, e3];
    };
    const Fa = frame(boneTips, rb), Fb = frame(bodyTips, rf);
    // the frames give the direction down the hand; the roll about it (which way the palm faces) is chosen
    // by trying 12 turns and keeping the one that leaves the fewest hand bones outside the skin
    const rollAbout = (v, th) => { const k = Fb[0], c = Math.cos(th), sn = Math.sin(th), kv = dot(k, v); const kx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; return [0, 1, 2].map((q) => v[q] * c + kx[q] * sn + k[q] * kv * (1 - c)); };
    const turnAt = (th) => (p) => { const d = sub(p, W), c = [dot(d, Fa[0]), dot(d, Fa[1]), dot(d, Fa[2])]; return add(W, rollAbout(add(add(mul(Fb[0], c[0]), mul(Fb[1], c[1])), mul(Fb[2], c[2])), th)); };
    // full turn from 3 cm past the wrist, blending in from the wrist so the carpals meet the forearm
    const wTurn = (p) => { let t = dot(sub(p, W), Fa[0]) / 0.03; t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
    const blendOf = (turn) => (p) => { const w = wTurn(p); return add(p, mul(sub(turn(p), p), w)); };
    const sampleV = [];
    for (const p of hand) for (let i = 0; i < p.vs.length; i += 5) sampleV.push(p.vs[i]);
    let bestTh = 0, bestOut = Infinity;
    if (surf) for (let k = 0; k < 12; k++) {
      const th = (k * Math.PI) / 6, f = blendOf(turnAt(th));
      let out = 0;
      for (const v of sampleV) { const q = f(P(v)); if (surf.signedOut(q[0], q[1], q[2]) > 0.001) out++; }
      if (out < bestOut) { bestOut = out; bestTh = th; }
    }
    const turnW = blendOf(turnAt(bestTh));
    for (const p of hand) {
      for (const v of p.vs) { const r = turnW(P(v)); pos[v * 3] = r[0]; pos[v * 3 + 1] = r[1]; pos[v * 3 + 2] = r[2]; }
      p.c = turnW(p.c);
    }
    for (const ch of chains) { ch.K = turnW(ch.K); ch.tip = turnW(ch.tip); }
    // pair: thumb with thumb, then the four fingers by the least total distance once the hand is turned
    const fIdx = [0, 1, 2, 3, 4].filter((i) => i !== bodyThumb), cIdx = [0, 1, 2, 3, 4].filter((i) => i !== boneThumb);
    let best = null, bc = Infinity;
    const perm = (arr, q = 0) => {
      if (q === arr.length) { let c = 0; arr.forEach((fi, j) => { c += len(sub(chains[cIdx[j]].tip, fingers[fi].tipP)) ** 2; }); if (c < bc) { bc = c; best = [...arr]; } return; }
      for (let i = q; i < arr.length; i++) { [arr[q], arr[i]] = [arr[i], arr[q]]; perm(arr, q + 1); [arr[q], arr[i]] = [arr[i], arr[q]]; }
    };
    perm([...fIdx]);
    const pairs = [[boneThumb, bodyThumb], ...cIdx.map((ci, j) => [ci, best[j]])];
    const roll = Math.round((bestTh * 180) / Math.PI);
    // ---- place each chain down its finger ----
    const moves = new Map();   // piece -> (point) => new point (chains), or (point, weight) for metacarpals
    for (const [ci, fi] of pairs) {
      const ch = chains[ci], f = fingers[fi];
      const a = sub(ch.tip, ch.K), la = len(a);
      if (!(la > 0.01)) continue;
      let s, Kt, ub;
      if (true) {
        // turn and scale the chain about its own knuckle so its tip lands just inside its own fingertip (the
        // finger axes measured from the skin were not reliable enough to place the knuckles)
        // first the knuckle moves through the hand's thickness to the fingertip's depth, so the chain lies
        // in the plane of the hand instead of slanting out of it
        const nrm = Fb[2];
        Kt = add(ch.K, mul(nrm, dot(sub(f.tipP, ch.K), nrm)));
        const target = add(f.tipP, mul(unit(sub(Kt, f.tipP)), inset));
        const tb = sub(target, Kt);
        s = Math.min(1.45, Math.max(0.7, len(tb) / la)); ub = unit(tb);
      } else {
        // a finger: the knuckle goes onto the finger's axis a little above the web (the web sits about a
        // third of the way along the first phalanx), and the chain runs down the axis to just inside the tip
        const Lv = len(sub(f.axisTip, f.axisWeb));
        s = Math.min(1.35, Math.max(0.75, Lv / (0.86 * la)));
        ub = f.D;
        Kt = sub(f.axisTip, mul(ub, la * s));
      }
      const ua = unit(a), ax = [ua[1] * ub[2] - ua[2] * ub[1], ua[2] * ub[0] - ua[0] * ub[2], ua[0] * ub[1] - ua[1] * ub[0]];
      const sn = len(ax), cs = dot(ua, ub), k = sn > 1e-6 ? mul(ax, 1 / sn) : [1, 0, 0];
      const rot = (v) => { const kv = dot(k, v), kx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; return [0, 1, 2].map((q) => v[q] * cs + kx[q] * sn + k[q] * kv * (1 - cs)); };
      // stretched along the finger only; across it the bones are made a little slimmer to sit inside the
      // body's slimmer fingers (scaling them evenly made a 1.4x longer finger 1.4x thicker too)
      const sr = 0.78;
      const fn = (p) => { const d = sub(p, ch.K), da = mul(ua, dot(d, ua)), dr = sub(d, da); return add(Kt, rot(add(mul(da, s), mul(dr, sr)))); };
      for (const p of ch.phal) moves.set(p, fn);
      if (ch.meta) {
        // the metacarpal bends: unchanged at its wrist end, carried with the knuckle at its finger end
        let far = null, fd = -1;
        for (const v of ch.meta.vs) { const d = len(sub(P(v), ch.K)); if (d > fd) { fd = d; far = P(v); } }
        const axm = sub(ch.K, far), lm = dot(axm, axm) || 1, shift = sub(Kt, ch.K);
        moves.set(ch.meta, (p) => { let w = dot(sub(p, far), axm) / lm; w = Math.min(1, Math.max(0, w)); w = w * w * (3 - 2 * w); return add(p, mul(shift, w)); });
      }
      ch.fitted = { s: +s.toFixed(2), finger: fi };
    }
    const placed = [...moves.keys()];
    let moved = 0;
    for (const p of hand) {
      let fn = moves.get(p);
      if (!fn && p.vs.length < big) {
        let bp = null, bd = 0.01;
        for (const q of placed) { const d = len(sub(q.c, p.c)); if (d < bd) { bd = d; bp = q; } }
        if (bp) fn = moves.get(bp);
      }
      if (!fn) continue;
      for (const v of p.vs) { const r = fn(P(v)); pos[v * 3] = r[0]; pos[v * 3 + 1] = r[1]; pos[v * 3 + 2] = r[2]; done[v] = 1; moved++; }
    }
    report[sg] = { chains: chains.map((c) => c.phal.length + (c.meta ? 1 : 0)), thumb: { bone: boneThumb, body: bodyThumb }, order: { bone: rb, body: rf }, roll, pairs, scale: chains.map((c) => c.fitted?.s ?? null), fingerSkin: fingers.map((f) => f.n), moved };
  }
  return { report: Object.keys(report).length ? report : null, done };
}

/**
 * Stretch each foot's bones, heel to toe, to the body's own foot: the specimen's foot is shorter, so the
 * toe bones stopped two thirds of the way along the body's foot. Depth (z, toward the toes) is mapped
 * from the bone heel..toe onto the body heel..toe (less `skin`), fully below `y1` and fading out by `y2`
 * so the ankle joint is not pulled apart. Returns a function that applies it to positions in place.
 */
export function footFit(bodyPos, limbs, H, { skin = 0.006 } = {}) {
  const y1 = 0.075 * H, y2 = 0.11 * H, sides = {};
  for (const sg of [1, -1]) {
    let bh = Infinity, bt = -Infinity, ah = Infinity, at = -Infinity;
    for (let i = 0; i < bodyPos.length; i += 3) {
      const x = bodyPos[i] * sg;
      if (x > 0 && x < 0.2 * H && bodyPos[i + 1] < 0.07 * H) { bh = Math.min(bh, bodyPos[i + 2]); bt = Math.max(bt, bodyPos[i + 2]); }
    }
    for (let i = 0; i < limbs.length; i += 3) {
      const x = limbs[i] * sg;
      if (x > 0 && x < 0.2 * H && limbs[i + 1] < y1) { ah = Math.min(ah, limbs[i + 2]); at = Math.max(at, limbs[i + 2]); }
    }
    if (!(bt > bh && at > ah)) continue;
    const k = Math.min(1.6, Math.max(0.8, (bt - bh - 2 * skin) / (at - ah)));
    sides[sg] = { ah, base: bh + skin, k };
  }
  return (pos) => {
    let moved = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1], S = sides[pos[i] >= 0 ? 1 : -1];
      if (!S || y >= y2 || Math.abs(pos[i]) > 0.2 * H) continue;
      let w = y <= y1 ? 1 : 1 - (y - y1) / (y2 - y1);
      w = w * w * (3 - 2 * w);
      const z2 = S.base + (pos[i + 2] - S.ah) * S.k;
      pos[i + 2] += w * (z2 - pos[i + 2]);
      moved++;
    }
    return moved;
  };
}

/** Which nodes are cut rather than left outside: thin strands, where a stray piece reads as a defect. */
export const CUT_NODES = ["arteries", "veins", "kidneys"];   // kidneys: the group carries the (male) urethra

/**
 * Fit every anatomy part to the body. `parts` is { name: { pos: Float32Array, index: Uint32Array|null } };
 * positions are edited in place and a part's `index` is replaced when triangles are removed.
 * Returns a per-node report so the fit can be checked (tests, body3d.debug()): fitted = vertices the trunk
 * field moved, moved = vertices then pressed under the skin, lost = left outside, cut = triangles removed.
 */
export function conformAnatomy(body, parts, { cell = 0.004, margin = 0.004, reach = 0.008, skin = 0.012, trunk = true, fingers: perFinger = false } = {}) {
  const map = depthMap(body.pos, body.index, cell);
  const report = {};
  const field = trunk ? trunkField(map, parts, { skin }) : null;
  const region = trunkRegion(field);
  const head = trunk ? headFit(map, parts) : null;
  // "canal" parts of the ear were grouped with the gut by name: nothing of the intestines is above the liver
  const liver = parts.liver?.pos;
  let gutTop = Infinity;
  if (liver && liver.length) { gutTop = -Infinity; for (let i = 1; i < liver.length; i += 3) if (liver[i] > gutTop) gutTop = liver[i]; gutTop += 0.03; }
  // 1. head and trunk fits (and the stray gut pieces); 2. the legs, measured after the trunk fit moved the
  // pelvis; 3. what is still outside the skin is pressed in, or cut for thin strands
  const fitted = {}, cut = {};
  for (const [name, part] of Object.entries(parts)) {
    if (!part?.pos?.length) continue;
    const n = part.pos.length / 3;
    cut[name] = 0;
    if (name === "intestines" && Number.isFinite(gutTop)) {
      const before = (part.index ? part.index.length : n) / 3;
      const p = part.pos;
      part.index = filterTriangles(part.index, n, (a, b, c) => p[a * 3 + 1] > gutTop || p[b * 3 + 1] > gutTop || p[c * 3 + 1] > gutTop);
      cut[name] += before - part.index.length / 3;
    }
    if (HEAD_NODES.includes(name)) {
      const f = applyHeadFit(part.pos, head);
      const seated = name === "eyes" ? seatRigid(part.pos, map) : 0;
      report[name] = { verts: n, fitted: f, moved: 0, lost: 0, cut: cut[name], seated };
      continue;
    }
    fitted[name] = Math.max(applyHeadFit(part.pos, head, true), field ? applyTrunkField(part.pos, field) : 0);
  }
  const legs = trunk ? legField(map, parts) : null;
  if (legs) for (const name of LEG_NODES) if (parts[name]?.pos?.length) fitted[name] = Math.max(fitted[name] || 0, applyLegField(parts[name].pos, legs));
  // arms: measured on the bones as they are now, then applied to the bones and the vessels that run down them
  const arms = trunk ? armField(map, body, parts) : null;
  if (arms) for (const name of LEG_NODES) if (parts[name]?.pos?.length) fitted[name] = Math.max(fitted[name] || 0, applyArmField(parts[name].pos, arms));
  // hands and feet: each small bone moved whole into the nearest finger, toe or palm; vessel strands that
  // still leave the skin there are cut
  let extremities = null;
  if (trunk && parts.limbs?.pos?.length) {
    const H = map.ny * map.cell;
    const inHand = (x, y) => {
      const A = arms?.arms?.[x >= 0 ? 1 : -1];
      if (A) { if (!A.isArm(x, y)) return false; const [t] = A.toAxis(x, y); return t / A.Lb > 0.76; }
      return Math.abs(x) > 0.2 * H && y < 0.6 * H;
    };
    const inFoot = (x, y) => y < 0.075 * H && Math.abs(x) < 0.2 * H;
    const inExt = (x, y) => inHand(x, y) || inFoot(x, y);
    const surf = surfaceIndex(body.pos, vertexNormals(body.pos, body.index), (x, y) => (Math.abs(x) > 0.17 * H && y < 0.62 * H) || y < 0.1 * H);
    // feet first stretched to the body's foot length (bones and vessels together)
    const stretch = footFit(body.pos, parts.limbs.pos, H);
    for (const name of LEG_NODES) if (parts[name]?.pos?.length) stretch(parts[name].pos);
    // one bone chain in each of the five fingers (the wrist: 76% of the way down the arm line)
    const wrist = {};
    for (const sg of [1, -1]) {
      const A = arms?.arms?.[sg];
      if (!A) continue;
      const t = A.Lb * 0.76, x = A.pv[0] + A.dx * t, y = A.pv[1] + A.dy * t, col = columnAt(map, x, y);
      wrist[sg] = [x, y, col ? (col[0] + col[1]) / 2 : 0];
    }
    // experimental, off by default: one bone chain per finger (re-posing the specimen's hand in the browser
    // is not reliable yet; app/dev/xray_check.html?fingers=1 shows it)
    const fingers = perFinger ? fitFingers(parts.limbs.pos, parts.limbs.index, body.pos, body.index, inHand, wrist, { surf }) : { report: null, done: new Uint8Array(parts.limbs.pos.length / 3) };
    // the finger bones just placed are not moved again piece by piece (that pulled their joints apart)
    // then each small bone, wrist or heel outward, so fingers and toes stay connected chains
    const handRoot = (x, y) => { const A = arms?.arms?.[x >= 0 ? 1 : -1]; return A ? A.toAxis(x, y)[0] : -y; };
    const rh = containIslands(parts.limbs.pos, parts.limbs.index, surf, inHand, { rootOf: handRoot, skip: fingers.done });
    const rf = containIslands(parts.limbs.pos, parts.limbs.index, surf, inFoot, { rootOf: (x, y, z) => z });
    fitted.limbs = Math.max(fitted.limbs || 0, rh.pieces + rf.pieces);
    // how much of the finger bones placed above is outside the skin, per hand
    const outside = { 1: [0, 0], [-1]: [0, 0] };
    const lp = parts.limbs.pos;
    for (let v = 0; v < lp.length / 3; v++) {
      if (!fingers.done[v]) continue;
      const o = outside[lp[v * 3] >= 0 ? 1 : -1];
      o[1]++;
      if (surf.signedOut(lp[v * 3], lp[v * 3 + 1], lp[v * 3 + 2]) > 0.001) o[0]++;
    }
    extremities = { hands: rh, feet: rf, fingers: fingers.report, fingerBonesOutside: outside };
    for (const name of ["arteries", "veins"]) {
      const p = parts[name]?.pos;
      if (!p?.length) continue;
      const nv = p.length / 3, flag = new Uint8Array(nv);
      for (let v = 0; v < nv; v++) if (inExt(p[v * 3], p[v * 3 + 1]) && surf.signedOut(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]) > 0.002) flag[v] = 1;
      const before = (parts[name].index ? parts[name].index.length : nv) / 3;
      parts[name].index = dropLost(parts[name].index, nv, flag);
      cut[name] = (cut[name] || 0) + before - parts[name].index.length / 3;
    }
  }
  for (const [name, part] of Object.entries(parts)) {
    if (!part?.pos?.length || HEAD_NODES.includes(name)) continue;
    const n = part.pos.length / 3;
    const r = conformPoints(part.pos, map, { margin, reach, region });
    if (CUT_NODES.includes(name) && r.lost) {
      const before = (part.index ? part.index.length : n) / 3;
      part.index = dropLost(part.index, n, r.flags);
      cut[name] += before - part.index.length / 3;
    }
    report[name] = { verts: n, fitted: fitted[name] || 0, moved: r.moved, lost: r.lost, cut: cut[name] };
  }
  return { map, field, head, legs, arms, extremities, report };
}
