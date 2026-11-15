// Daily eye check: a SANS screening aid, never a diagnosis (see brain/eyes.py).
// 1. Live, zoomed eyes from the face mesh; when the face is steady and frontal it measures ~1.5 s of frames and
//    keeps one photo of each eye. 2. Near-vision self-test. 3. Amsler grid self-test. 4. Today beside the baseline.
// The camera can follow the front of the eye (opening, puffiness, redness, symmetry); SANS itself needs an eye
// exam of the back of the eye (fundoscopy, OCT), which this says plainly.
import { api } from "../core/api.js";
import { esc } from "../interface/readings.js";

const R_EYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const L_EYE = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382];
const R_BROW = [70, 63, 105, 66, 107], L_BROW = [300, 293, 334, 296, 336];
const FRAMES = 24;

export function registerEyeCheck(registerScreen) {
  registerScreen("eyes", { title: "Daily eye check", render: renderEyes });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Measurements from one frame's landmarks, in pixels of the camera frame (ratios: distance does not matter). */
function measure(lm, vw, vh) {
  const P = (i) => ({ x: lm[i].x * vw, y: lm[i].y * vh });
  const centre = (idx) => { let x = 0, y = 0; for (const i of idx) { x += lm[i].x; y += lm[i].y; } return { x: x / idx.length * vw, y: y / idx.length * vh }; };
  const ipd = lm.length > 473 ? dist(P(468), P(473)) : dist(centre(R_EYE), centre(L_EYE));
  if (!ipd) return null;
  const apR = dist(P(159), P(145)) / (dist(P(33), P(133)) || 1);
  const apL = dist(P(386), P(374)) / (dist(P(362), P(263)) || 1);
  const width = dist(P(234), P(454));
  const yaw = Math.abs((P(1).x - (P(234).x + P(454).x) / 2) / (width || 1));
  return {
    frontal: yaw < 0.07 && apR > 0.14 && apL > 0.14,
    aperture: (apR + apL) / 2, aperture_r: apR, aperture_l: apL,
    brow_lid: (dist(P(105), P(159)) + dist(P(334), P(386))) / 2 / ipd,
    cheek_width: width / ipd,
  };
}

/** One eye, cropped from the camera frame with the brow above and the under-eye below; mirrored like a mirror. */
function eyeCrop(video, lm, eye, brow, out) {
  const vw = video.videoWidth, vh = video.videoHeight;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const i of [...eye, ...brow]) { x0 = Math.min(x0, lm[i].x); x1 = Math.max(x1, lm[i].x); y0 = Math.min(y0, lm[i].y); y1 = Math.max(y1, lm[i].y); }
  const w = (x1 - x0) * vw, h = (y1 - y0) * vh;
  const sx = x0 * vw - w * 0.2, sy = y0 * vh - h * 0.15, sw = w * 1.4, sh = Math.max(h * 1.75, sw * 0.6);
  const c = out.getContext("2d");
  c.save(); c.translate(out.width, 0); c.scale(-1, 1);
  c.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height);
  c.restore();
}

/** Redness of the white of the eye: bright pixels inside the eye outline, outside the iris. */
function redness(video, lm, eye, iris, tmp) {
  const vw = video.videoWidth, vh = video.videoHeight, c = tmp.getContext("2d", { willReadFrequently: true });
  c.clearRect(0, 0, tmp.width, tmp.height);
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const i of eye) { x0 = Math.min(x0, lm[i].x); x1 = Math.max(x1, lm[i].x); y0 = Math.min(y0, lm[i].y); y1 = Math.max(y1, lm[i].y); }
  const sx = x0 * vw, sy = y0 * vh, sw = (x1 - x0) * vw, sh = (y1 - y0) * vh;
  if (sw < 8 || sh < 3) return null;
  const k = tmp.width / sw;
  c.save(); c.beginPath();
  eye.forEach((i, n) => { const x = (lm[i].x * vw - sx) * k, y = (lm[i].y * vh - sy) * k; n ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.closePath(); c.clip();
  c.drawImage(video, sx, sy, sw, sh, 0, 0, tmp.width, sh * k);
  c.restore();
  const img = c.getImageData(0, 0, tmp.width, Math.min(tmp.height, Math.ceil(sh * k))).data;
  const ic = lm[iris] ? { x: (lm[iris].x * vw - sx) * k, y: (lm[iris].y * vh - sy) * k, r: sh * k * 0.55 } : null;
  let red = 0, n = 0;
  for (let i = 0; i < img.length; i += 4) {
    if (img[i + 3] < 250) continue;
    const p = i / 4, x = p % tmp.width, y = Math.floor(p / tmp.width);
    if (ic && Math.hypot(x - ic.x, y - ic.y) < ic.r) continue;   // the iris
    const R = img[i], G = img[i + 1], B = img[i + 2];
    if (R + G + B < 240) continue;                                  // lashes and shadow, not sclera
    red += R / (R + G + B); n++;
  }
  return n > 20 ? red / n : null;
}

/** The cleanup is returned at once, so closing the screen mid-check always stops the camera and the loop. */
function renderEyes(el, ctx) {
  const st = { stopped: false, startedHere: false, raf: 0 };
  flow(el, ctx, st);
  return () => { st.stopped = true; cancelAnimationFrame(st.raf); if (st.startedHere) { st.startedHere = false; ctx.vision?.stop(); } };
}

async function flow(el, ctx, st) {
  const v = ctx.vision;
  const camOff = () => { if (st.startedHere) { st.startedHere = false; v?.stop(); } };
  el.innerHTML = `<div class="eyecheck">
    <p class="note">A daily look at your eyes. Space can change them (SANS); a camera can follow the front of the eye, and your answers show how you see.</p>
    <div class="ec-live"><canvas data-l width="360" height="220" aria-label="Your left eye"></canvas><canvas data-r width="360" height="220" aria-label="Your right eye"></canvas></div>
    <div class="ec-caps"><span>Left eye</span><span>Right eye</span></div>
    <p class="ec-step" data-step aria-live="polite">Starting the camera…</p>
    <div class="ec-body" data-body></div>
  </div>`;
  const cl = el.querySelector("[data-l]"), cr = el.querySelector("[data-r]"), step = el.querySelector("[data-step]"), body = el.querySelector("[data-body]");
  if (!v) { step.textContent = "The camera is not available on this device."; return; }
  if (!v.state.on) { st.startedHere = true; if (!(await v.start())) { step.textContent = "No camera: the eye check needs one."; return; } }
  const tmp = document.createElement("canvas"); tmp.width = 120; tmp.height = 60;
  const frames = [];
  let shots = null;

  // 1. live zoomed eyes; measure while steady and facing the camera
  await new Promise((done) => {
    const tick = () => {
      if (st.stopped) return done();
      const lm = v.landmarks, vid = v.video;
      if (lm && vid?.videoWidth) {
        // the eye with the smaller x in the camera frame is the person's right eye
        const rFirst = lm[33].x < lm[362].x;
        const right = rFirst ? [R_EYE, R_BROW, 468] : [L_EYE, L_BROW, 473], left = rFirst ? [L_EYE, L_BROW, 473] : [R_EYE, R_BROW, 468];
        eyeCrop(vid, lm, right[0], right[1], cr); eyeCrop(vid, lm, left[0], left[1], cl);
        const m = measure(lm, vid.videoWidth, vid.videoHeight);
        if (m?.frontal) {
          const red = [redness(vid, lm, right[0], right[2], tmp), redness(vid, lm, left[0], left[2], tmp)].filter((x) => x != null);
          frames.push({ ...m, redness: red.length ? red.reduce((a, b) => a + b) / red.length : null });
          step.textContent = `Hold still and look at the camera… ${Math.round((frames.length / FRAMES) * 100)}%`;
          if (frames.length === Math.round(FRAMES / 2)) shots = { right: cr.toDataURL("image/jpeg", 0.82), left: cl.toDataURL("image/jpeg", 0.82) };
          if (frames.length >= FRAMES) return done();
        } else step.textContent = "Look straight at the camera, eyes open, in good light.";
      } else step.textContent = "Looking for your face… sit facing the camera, in good light.";
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
  });
  if (st.stopped) return;
  const metrics = {};
  for (const k of ["aperture", "aperture_l", "aperture_r", "brow_lid", "cheek_width", "redness"]) metrics[k] = median(frames.map((f) => f[k]).filter((x) => x != null));

  // 2. near vision, 3. Amsler grid
  const ask = (html) => new Promise((res) => {
    body.innerHTML = html;
    body.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => res(b.dataset.a === "yes")));
  });
  step.textContent = "Photo taken. Two quick questions.";
  const near_blur = await ask(`<h3>Close-up vision</h3><p class="note">Hold the tablet at a comfortable reading distance. Is this line sharp?</p>
    <p class="ec-near">The crew checked the hatch seal twice before the evening rest period began.</p>
    <div class="ec-ans"><button class="pill pill-light" data-a="no">Sharp</button><button class="pill pill-ghost" data-a="yes">Blurry or hard to read</button></div>`);
  if (st.stopped) return;
  const amsler_change = await ask(`<h3>Amsler grid</h3><p class="note">Cover one eye and look only at the dot, then the other eye. Are any lines wavy, blurred or missing?</p>
    <svg class="ec-grid" viewBox="0 0 200 200" aria-label="Amsler grid">${Array.from({ length: 21 }, (_, i) => `<line x1="${i * 10}" y1="0" x2="${i * 10}" y2="200"/><line x1="0" y1="${i * 10}" x2="200" y2="${i * 10}"/>`).join("")}<circle cx="100" cy="100" r="3.5"/></svg>
    <div class="ec-ans"><button class="pill pill-light" data-a="no">All straight</button><button class="pill pill-ghost" data-a="yes">Some wavy or missing</button></div>`);
  if (st.stopped) return;

  // 4. save and compare with the baseline
  body.innerHTML = `<p class="note">Comparing with your baseline…</p>`;
  let r;
  try { r = await api.eyesSave(ctx.view.crewId, { metrics, near_blur, amsler_change, images: shots || {} }); }
  catch { body.innerHTML = `<p class="note">The brain is offline: the check could not be saved.</p>`; camOff(); return; }
  camOff();   // the camera is no longer needed
  step.textContent = "";
  el.querySelector(".ec-live").hidden = true; el.querySelector(".ec-caps").hidden = true;
  const pair = (side) => `<figure><span class="label">${side === "left" ? "Left eye" : "Right eye"}</span>
    <div class="ec-pair">${r.baseline.images?.[side] ? `<img src="${r.baseline.images[side]}" alt="${side} eye, baseline"><figcaption>Baseline</figcaption>` : ""}
    ${r.latest.images?.[side] ? `<img src="${r.latest.images[side]}" alt="${side} eye, today"><figcaption>Today</figcaption>` : ""}</div></figure>`;
  const rows = Object.values(r.changes || {}).map((c) => `<li class="${c.flag ? "is-flag" : ""}"><span>${esc(c.label[0].toUpperCase() + c.label.slice(1))}</span><b>${r.building_baseline ? "baseline" : `${c.pct > 0 ? "+" : ""}${c.pct}%`}</b></li>`).join("");
  body.innerHTML = `<div class="ec-result is-${r.verdict}"><p class="ec-verdict">${esc(r.message)}</p></div>
    <div class="ec-photos">${pair("left")}${pair("right")}</div>
    ${rows ? `<ul class="ec-metrics">${rows}</ul>` : ""}
    <p class="fine">${esc(r.nasa)} This check follows the front of the eye only; it is a screening aid, not a diagnosis. Thresholds are illustrative.</p>
    <div class="ec-ans"><button class="pill pill-light" data-done>Done</button><button class="link-btn" data-forget>Delete my eye photos</button></div>`;
  body.querySelector("[data-done]").addEventListener("click", () => ctx.screens?.close?.());
  body.querySelector("[data-forget]").addEventListener("click", async (e) => { await api.eyesForget(ctx.view.crewId).catch(() => {}); e.currentTarget.textContent = "Deleted"; body.querySelector(".ec-photos").remove(); });
  ctx.say?.(r.message, { source: "local" });
}
