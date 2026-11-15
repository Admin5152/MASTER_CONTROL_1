// Daily eye check (see brain/eyes.py): how the eyes blink, open and follow, and how the person sees.
// 1. Relax and look at the camera (12 s): the face mesh, zoomed on the eyes, measures blinking, eyelid opening and
//    left/right evenness; a close-up of the eye area with the mesh drawn on it is kept with the check.
// 2. Follow the dot (12 s): the irises are tracked against a moving dot (smooth pursuit).
// 3. Near vision and 4. the Amsler grid (self-tests NASA uses). 5. Today against the person's own baseline.
// It cannot see inside the eye; SANS needs an eye exam, and the result says so when it matters.
import { api } from "../core/api.js";
import { esc } from "../interface/readings.js";
import { eyeOpening, irisPosition, blinks, pursuit } from "../vision/eyemetrics.js";

const R_EYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const L_EYE = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382];
const BROWS = [70, 63, 105, 66, 107, 300, 293, 334, 296, 336];
const RELAX_S = 12, FOLLOW_S = 12;

export function registerEyeCheck(registerScreen) {
  registerScreen("eyes", { title: "Daily eye check", render: renderEyes });
}

/** The eye area of the frame (both eyes, brows to under-eye), with the face mesh drawn on it, mirrored like a mirror. */
function drawEyeMesh(cv, video, lm, mp) {
  const vw = video.videoWidth, vh = video.videoHeight, c = cv.getContext("2d");
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const i of [...R_EYE, ...L_EYE, ...BROWS]) { x0 = Math.min(x0, lm[i].x); x1 = Math.max(x1, lm[i].x); y0 = Math.min(y0, lm[i].y); y1 = Math.max(y1, lm[i].y); }
  const w = x1 - x0, h = y1 - y0;
  const bx = x0 - w * 0.12, bw = w * 1.24;
  const bh = Math.max(h * 1.9, (bw * vw * cv.height) / (cv.width * vh)), by = y0 - h * 0.25;
  const X = (p) => cv.width - ((p.x - bx) / bw) * cv.width, Y = (p) => ((p.y - by) / bh) * cv.height;
  c.save(); c.translate(cv.width, 0); c.scale(-1, 1);
  c.filter = "saturate(0.6) brightness(0.85)";
  c.drawImage(video, bx * vw, by * vh, bw * vw, bh * vh, 0, 0, cv.width, cv.height);
  c.filter = "none";
  c.restore();
  const inBox = (p) => p.x >= bx && p.x <= bx + bw && p.y >= by && p.y <= by + bh;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--assist").trim() || "#6fd0ff";
  // the mesh around the eyes
  const T = mp?.FaceLandmarker?.FACE_LANDMARKS_TESSELATION;
  if (T) {
    c.strokeStyle = accent; c.globalAlpha = 0.35; c.lineWidth = 1; c.beginPath();
    for (const e of T) { const a = lm[e.start], b = lm[e.end]; if (inBox(a) && inBox(b)) { c.moveTo(X(a), Y(a)); c.lineTo(X(b), Y(b)); } }
    c.stroke();
  }
  // eyelids, brighter
  c.globalAlpha = 0.95; c.lineWidth = 2; c.beginPath();
  for (const eye of [R_EYE, L_EYE]) { eye.forEach((i, k) => (k ? c.lineTo(X(lm[i]), Y(lm[i])) : c.moveTo(X(lm[i]), Y(lm[i])))); c.closePath(); }
  c.stroke();
  // irises
  if (lm.length > 477) for (const [ctr, edge] of [[468, 469], [473, 474]]) {
    const r = Math.hypot(X(lm[edge]) - X(lm[ctr]), Y(lm[edge]) - Y(lm[ctr]));
    c.beginPath(); c.arc(X(lm[ctr]), Y(lm[ctr]), r, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(X(lm[ctr]), Y(lm[ctr]), 2, 0, Math.PI * 2); c.fillStyle = accent; c.fill();
  }
  c.globalAlpha = 1;
}

function renderEyes(el, ctx) {
  const st = { stopped: false, startedHere: false, raf: 0, overlay: null };
  flow(el, ctx, st);
  return () => { st.stopped = true; cancelAnimationFrame(st.raf); st.overlay?.remove(); if (st.startedHere) { st.startedHere = false; ctx.vision?.stop(); } };
}

/** Run a phase for `seconds`, calling onFrame(lm, t) for each new set of landmarks (returning true ends the phase
 *  early); resolves "done", "early" or false when the screen was closed. */
function phase(v, st, seconds, onFrame, onTick) {
  return new Promise((done) => {
    const t0 = performance.now();
    let last = null;
    const tick = () => {
      if (st.stopped) return done(false);
      const t = (performance.now() - t0) / 1000;
      onTick?.(t);
      const lm = v.landmarks;
      if (lm && lm !== last && v.video?.videoWidth) { last = lm; if (onFrame(lm, t) === true) return done("early"); }
      if (t >= seconds) return done("done");
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
  });
}

async function flow(el, ctx, st) {
  const v = ctx.vision;
  const camOff = () => { if (st.startedHere) { st.startedHere = false; v?.stop(); } };
  el.innerHTML = `<div class="eyecheck">
    <p class="note">A one-minute daily check of how your eyes blink, open and follow, and how you see up close.</p>
    <canvas class="ec-mesh" data-mesh width="720" height="300" aria-label="Your eyes, with the face mesh"></canvas>
    <p class="ec-step" data-step aria-live="polite">Starting the camera…</p>
    <div class="ec-body" data-body></div>
  </div>`;
  const mesh = el.querySelector("[data-mesh]"), step = el.querySelector("[data-step]"), body = el.querySelector("[data-body]");
  if (!v) { step.textContent = "The camera is not available on this device."; return; }
  if (!v.state.on) { st.startedHere = true; if (!(await v.start())) { step.textContent = "No camera: the eye check needs one."; return; } }

  // wait for a face
  step.textContent = "Looking for your face… sit facing the camera, in good light.";
  const found = await phase(v, st, 20, () => true);
  if (!found) return;
  if (found !== "early") { step.textContent = "No face found. Sit facing the camera in good light, then open the eye check again."; camOff(); return; }
  // 1. relax and look at the camera: blinking, eyelid opening, evenness; the mesh close-up
  const openings = [];
  let snapshot = "";
  if (!(await phase(v, st, RELAX_S, (lm, t) => {
    drawEyeMesh(mesh, v.video, lm, v.mp);
    const o = eyeOpening(lm, v.video.videoWidth, v.video.videoHeight);
    openings.push({ t, open: o.mean, r: o.right, l: o.left });
    if (!snapshot && t > RELAX_S / 2 && o.mean > 0.15) snapshot = mesh.toDataURL("image/jpeg", 0.85);
  }, (t) => { step.textContent = `Relax and look at the camera. Blink as you normally would… ${Math.max(0, Math.ceil(RELAX_S - t))}`; }))) return;
  const b = blinks(openings);
  const openFrames = openings.filter((o) => o.open > (b.open || 0) * 0.8);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const aperture = median(openFrames.map((o) => o.open));
  const asymmetry = median(openFrames.map((o) => Math.abs(o.r - o.l) / ((o.r + o.l) / 2 || 1)));

  // 2. follow the dot: smooth pursuit
  const ov = document.createElement("div");
  ov.className = "ec-follow"; ov.innerHTML = `<p>Follow the dot with your eyes. Keep your head still.</p><span class="ec-dot"></span>`;
  document.body.appendChild(ov); st.overlay = ov;
  const dot = ov.querySelector(".ec-dot");
  const track = [];
  const ok = await phase(v, st, FOLLOW_S, (lm, t) => {
    const o = eyeOpening(lm, v.video.videoWidth, v.video.videoHeight).mean;
    track.push({ t, dot: Math.sin(2 * Math.PI * 0.35 * t), iris: irisPosition(lm), blink: aperture ? o < aperture * 0.7 : false });
  }, (t) => { dot.style.transform = `translateX(${Math.sin(2 * Math.PI * 0.35 * t) * 38}vw)`; });
  ov.remove(); st.overlay = null;
  if (!ok) return;
  const p = pursuit(track);
  camOff();
  step.textContent = "Two quick questions.";

  // 3. near vision, 4. Amsler grid
  const ask = (html) => new Promise((res) => {
    body.innerHTML = html;
    body.querySelectorAll("[data-a]").forEach((x) => x.addEventListener("click", () => res(x.dataset.a === "yes")));
  });
  const near_blur = await ask(`<h3>Close-up vision</h3><p class="note">Hold the tablet at a comfortable reading distance. Is this line sharp?</p>
    <p class="ec-near">The crew checked the hatch seal twice before the evening rest period began.</p>
    <div class="ec-ans"><button class="pill pill-light" data-a="no">Sharp</button><button class="pill pill-ghost" data-a="yes">Blurry or hard to read</button></div>`);
  if (st.stopped) return;
  const amsler_change = await ask(`<h3>Amsler grid</h3><p class="note">Cover one eye and look only at the dot, then the other eye. Are any lines wavy, blurred or missing?</p>
    <svg class="ec-grid" viewBox="0 0 200 200" aria-label="Amsler grid">${Array.from({ length: 21 }, (_, i) => `<line x1="${i * 10}" y1="0" x2="${i * 10}" y2="200"/><line x1="0" y1="${i * 10}" x2="200" y2="${i * 10}"/>`).join("")}<circle cx="100" cy="100" r="3.5"/></svg>
    <div class="ec-ans"><button class="pill pill-light" data-a="no">All straight</button><button class="pill pill-ghost" data-a="yes">Some wavy or missing</button></div>`);
  if (st.stopped) return;

  // 5. save, then today against the baseline
  body.innerHTML = `<p class="note">Comparing with your baseline…</p>`;
  const metrics = { blink_rate: b.rate, incomplete: b.incompleteShare, aperture, asymmetry, pursuit: p.corr, lag_ms: p.lag_ms };
  let r;
  try { r = await api.eyesSave(ctx.view.crewId, { metrics, near_blur, amsler_change, snapshot }); }
  catch { body.innerHTML = `<p class="note">The brain is offline: the check could not be saved.</p>`; return; }
  step.textContent = ""; mesh.hidden = true;
  const fmt = (k, x) => (x == null ? "—" : k === "blink_rate" ? `${x.toFixed(0)} a minute` : k === "pursuit" ? `${Math.round(x * 100)}%` : x.toFixed(2));
  const rows = Object.entries(r.changes || {}).map(([k, c]) => `<li class="${c.flag ? "is-flag" : ""}"><span>${esc(c.label[0].toUpperCase() + c.label.slice(1))}</span><b>${fmt(k, c.value)}${r.building_baseline ? "" : ` <small>${c.pct > 0 ? "+" : ""}${c.pct}%</small>`}</b></li>`).join("");
  const snap = (s, label) => (s ? `<figure><img src="${s}" alt="Eyes with the face mesh, ${label}"><figcaption>${label}</figcaption></figure>` : "");
  body.innerHTML = `<div class="ec-result is-${r.verdict}"><p class="ec-verdict">${esc(r.message)}</p></div>
    <div class="ec-snaps">${r.checks > 1 ? snap(r.baseline.snapshot, "Baseline") : ""}${snap(r.latest.snapshot, "Today")}</div>
    ${rows ? `<ul class="ec-metrics">${rows}</ul>` : ""}
    <p class="fine">${r.incomplete != null ? `Incomplete blinks ${Math.round(r.incomplete * 100)}% · ` : ""}${r.lag_ms != null ? `eyes trail the dot by ${r.lag_ms} ms · ` : ""}near vision ${near_blur ? "blurry" : "sharp"} · grid ${amsler_change ? "wavy" : "straight"}</p>
    <p class="fine">${esc(r.nasa)} A screening aid, not a diagnosis; thresholds are illustrative.</p>
    <div class="ec-ans"><button class="pill pill-light" data-done>Done</button><button class="link-btn" data-forget>Delete my eye checks</button></div>`;
  body.querySelector("[data-done]").addEventListener("click", () => ctx.screens?.close?.());
  body.querySelector("[data-forget]").addEventListener("click", async (e) => { await api.eyesForget(ctx.view.crewId).catch(() => {}); e.currentTarget.textContent = "Deleted"; body.querySelector(".ec-snaps")?.remove(); });
  ctx.say?.(r.message, { source: "local" });
}
