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

/** Which nodes are cut rather than left outside: thin strands, where a stray piece reads as a defect. */
export const CUT_NODES = ["arteries", "veins", "kidneys"];   // kidneys: the group carries the (male) urethra

/**
 * Fit every anatomy part to the body. `parts` is { name: { pos: Float32Array, index: Uint32Array|null } };
 * positions are edited in place and a part's `index` is replaced when triangles are removed.
 * Returns a per-node report so the fit can be checked (tests, body3d.debug()): fitted = vertices the trunk
 * field moved, moved = vertices then pressed under the skin, lost = left outside, cut = triangles removed.
 */
export function conformAnatomy(body, parts, { cell = 0.004, margin = 0.004, reach = 0.008, skin = 0.012, trunk = true } = {}) {
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
  return { map, field, head, legs, arms, report };
}
