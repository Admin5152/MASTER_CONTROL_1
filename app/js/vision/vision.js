// Vision: webcam, MediaPipe Face + Pose Landmarker (vendored WASM), rPPG pulse, zone highlight.
import { emit, on } from "../core/bus.js";
import { PulseTracker } from "./rppg.js";
// Person 3 (Stage 1, FACE-1): drawFaceMesh draws the full 468-landmark tessellation + bright contours.
import { FaceSystem, drawFaceMesh, EMOTIONS, EMOTION_NOTES, EmotionWindow, faceCropBox, topEmotion } from "./face.js";
import { api } from "../core/api.js";

const isTablet = /Android|iPad|Tablet/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const ZONE_LABEL = { eyes: "eyes", head: "head", heart: "chest", lungs: "chest", whole_body: "whole body" };

export function createVision({ video, overlay, msg, badge, pulseValue, pulseQuality, canPatch, patchHr, onFallback, emotionList, emotionTop, camButton, moodOptIn }) {
  const ctx2d = overlay.getContext("2d");
  const sample = document.createElement("canvas");
  sample.width = 320; sample.height = 240;   // twice the old resolution: many more skin pixels per sample
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  const tracker = new PulseTracker(11);
  const faceSys = new FaceSystem();
  let face = null, pose = null, mp = null;
  let stream = null;
  let running = false;
  let frame = 0;
  let poseEvery = isTablet ? 3 : 2;
  let poseOn = true;
  let fps = 0, fpsCount = 0, fpsT = performance.now();
  let lastFace = 0;
  let lastEstimate = 0;
  let lastGood = 0;
  let pointZone = null;
  let lastZoneEmitted = null;
  let lastFaceLm = null, lastPoseLm = null;
  const state = { on: false, live: false, bpm: null, quality: 0, error: null, emotion: null };

  // ---- expression: one face crop a second goes to the local HSEmotion model (/api/face/emotion) ----
  const crop = document.createElement("canvas");
  crop.width = 224; crop.height = 224;
  const cctx = crop.getContext("2d");
  const EMOTION_EVERY = 1000, EMOTION_RETRY = 10000, EMOTION_FRESH = 5000;
  const emoWin = new EmotionWindow(5, 3);   // rolling mean of five replies; nothing shown before three
  let emoBusy = false, emoNext = 0, emoRun = 0, emoLast = 0, emoNote = null;
  const emoRows = {};
  if (emotionList) {
    emotionList.innerHTML = "";
    for (const name of EMOTIONS) {
      const li = document.createElement("li");
      li.className = "emotion-row";
      li.innerHTML = `<span class="emotion-name">${name}</span><span class="emotion-bar"><span class="emotion-fill"></span></span><span class="emotion-pct num">—</span>`;
      emotionList.appendChild(li);
      emoRows[name] = { li, fill: li.querySelector(".emotion-fill"), pct: li.querySelector(".emotion-pct") };
    }
  }

  function renderEmotions(scores, note) {
    const top = scores ? topEmotion(scores) : null;
    for (const name of EMOTIONS) {
      const row = emoRows[name];
      if (!row) continue;
      const pct = scores ? Math.round(scores[name] * 100) : null;
      row.fill.style.width = pct == null ? "0" : `${pct}%`;
      row.pct.textContent = pct == null ? "—" : `${pct}%`;
      row.li.classList.toggle("is-top", !!top && top.name === name);
    }
    emoNote = top ? null : note;
    if (emotionTop) emotionTop.textContent = top ? `suggests ${top.name.toLowerCase()}` : note;
  }

  /** Empty the panel and say why. With the camera on and opt-in off, the reason is always the opt-out. */
  function clearEmotions(note) {
    if (state.on && !faceSys.optInMood) note = EMOTION_NOTES.optOut;
    if (emoNote === note && !emoWin.count) return;
    emoRun++;                       // drop any reply still in flight
    emoWin.reset(); emoLast = 0; state.emotion = null;
    renderEmotions(null, note);
    refreshBadge();
  }

  /** Follow the profile's "camera mood analysis" setting (FACE-4, SF5). */
  function syncOptIn() {
    const opt = moodOptIn ? moodOptIn() !== false : true;
    if (opt === faceSys.optInMood) return;
    faceSys.setOptInMood(opt);
    if (state.on) clearEmotions(opt ? (lastFaceLm ? EMOTION_NOTES.reading : EMOTION_NOTES.noFace) : EMOTION_NOTES.optOut);
  }

  async function sampleEmotion(now) {
    if (emoBusy || now < emoNext || !faceSys.optInMood || !lastFaceLm) return;
    const box = faceCropBox(lastFaceLm, video.videoWidth, video.videoHeight);
    if (!box) return;
    emoBusy = true; emoNext = now + EMOTION_EVERY;
    const run = emoRun;
    try {
      cctx.drawImage(video, box.x, box.y, box.size, box.size, 0, 0, crop.width, crop.height);
      const blob = await new Promise((res) => crop.toBlob(res, "image/jpeg", 0.85));
      if (!blob) return;
      const r = await api.faceEmotion(blob);
      if (run !== emoRun || !running) return;
      emoWin.push(r.scores);
      emoLast = performance.now();
      if (!emoWin.ready) { renderEmotions(null, EMOTION_NOTES.reading); return; }
      const scores = emoWin.mean();
      const top = topEmotion(scores);
      state.emotion = { emotion: top.name, confidence: Math.round(top.score * 100) / 100, scores, valence: r.valence, arousal: r.arousal, source: "camera", label: "LIVE" };
      renderEmotions(scores);
      refreshBadge();
      emit("vision:emotion", state.emotion);
    } catch (e) {
      if (run !== emoRun) return;
      emoNext = performance.now() + EMOTION_RETRY;
      // 503 is the server saying the model could not load; anything else (404 from a stale server, network) is not the model
      const modelDown = e.status === 503;
      console.warn(`[sentinel vision] /api/face/emotion failed (${e.status ? "HTTP " + e.status : "network"}): ${e.message}`);
      emoWin.reset(); emoLast = 0; state.emotion = null;
      renderEmotions(null, modelDown ? EMOTION_NOTES.unavailable : EMOTION_NOTES.unreachable);
      refreshBadge();
    } finally {
      emoBusy = false;
    }
  }

  on("vision:point", (z) => { pointZone = z; });

  function setMsg(t) { msg.textContent = t; msg.hidden = !t; }
  function setBadge(live) { badge.className = `badge ${live ? "badge-live" : "badge-sim"}`; badge.textContent = live ? "LIVE" : "SIM"; }
  /** LIVE only while a reading really comes from the camera: a locked pulse, or a fresh reply window from the model. */
  function refreshBadge() {
    const emotionLive = emoWin.ready && performance.now() - emoLast < EMOTION_FRESH;
    setBadge(state.on && (state.live || emotionLive));
  }
  function setButton() { if (camButton) camButton.textContent = state.on ? "Stop camera" : "Start camera"; }
  renderEmotions(null, EMOTION_NOTES.cameraOff);

  async function loadModels() {
    if (mp) return;
    setMsg("Loading face and pose models…");
    mp = await import("../../vendor/mediapipe/vision_bundle.mjs");
    const fileset = await mp.FilesetResolver.forVisionTasks(new URL("vendor/mediapipe/wasm", document.baseURI).href);
    const opts = (model) => ({ baseOptions: { modelAssetPath: new URL(`vendor/mediapipe/models/${model}`, document.baseURI).href, delegate: "GPU" }, runningMode: "VIDEO" });
    const make = async (Cls, model, extra) => {
      try { return await Cls.createFromOptions(fileset, { ...opts(model), ...extra }); }
      catch { const o = opts(model); o.baseOptions.delegate = "CPU"; return Cls.createFromOptions(fileset, { ...o, ...extra }); }
    };
    face = await make(mp.FaceLandmarker, "face_landmarker.task", { numFaces: 1, outputFaceBlendshapes: true });
    pose = await make(mp.PoseLandmarker, "pose_landmarker_lite.task", { numPoses: 1 });
  }

  async function start() {
    if (state.on) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      fail("No camera API in this browser. Heart rate comes from the simulator (SIM).");
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (e) {
      fail(e.name === "NotAllowedError" ? "Camera permission denied. Heart rate comes from the simulator (SIM)." : "No camera found. Heart rate comes from the simulator (SIM).");
      return false;
    }
    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    try { await video.play(); } catch { /* autoplay muted should work */ }
    state.on = true;
    setButton();
    syncOptIn();
    try {
      await loadModels();
    } catch (e) {
      console.warn("MediaPipe failed to load", e);
      state.error = "models";
      setMsg("Face tracking could not load. Camera shown without tracking; heart rate stays SIM.");
      clearEmotions("face tracking unavailable");
      return true;
    }
    setMsg("Looking for a face…");
    clearEmotions(EMOTION_NOTES.noFace);
    running = true;
    requestAnimationFrame(loop);
    return true;
  }

  function fail(text) {
    state.on = false;
    state.error = text;
    setMsg(text);
    setBadge(false);
    pulseValue.textContent = "—";
    pulseQuality.textContent = "camera off";
    state.live = false;
    setButton();
    clearEmotions(EMOTION_NOTES.cameraOff);
    onFallback?.();
  }

  function stop() {
    running = false;
    overlay.parentElement?.classList.remove("is-synced");
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    state.on = false;
    state.live = false;
    setButton();
    ctx2d.clearRect(0, 0, overlay.width, overlay.height);
    setMsg("Camera off. Heart rate comes from the simulator (SIM).");
    setBadge(false);
    clearEmotions(EMOTION_NOTES.cameraOff);
    onFallback?.();
  }

  function loop() {
    if (!running) return;
    const now = performance.now();
    fpsCount++;
    if (now - fpsT > 1000) {
      fps = (fpsCount * 1000) / (now - fpsT); fpsCount = 0; fpsT = now;
      if (fps < 15 && poseOn) { poseOn = false; }        // keep face + pulse, drop pose
    }
    if (video.readyState >= 2 && video.videoWidth) {
      if (overlay.width !== video.videoWidth) { overlay.width = video.videoWidth; overlay.height = video.videoHeight; }
      frame++;
      syncOptIn();
      let fr = null, pr = null;
      try { fr = face.detectForVideo(video, now); } catch { /* skip frame */ }
      if (poseOn && frame % poseEvery === 0) { try { pr = pose.detectForVideo(video, now); } catch {} }
      if (fr?.faceLandmarks?.length) {
        lastFaceLm = fr.faceLandmarks[0];
        lastFace = now;
        if (fr.faceBlendshapes?.[0]?.categories) {
          faceSys.pushBlendshapes(fr.faceBlendshapes[0].categories, now / 1000);
        }
      }
      else if (now - lastFace > 600) lastFaceLm = null;
      if (pr?.landmarks?.length) {
        lastPoseLm = pr.landmarks[0];
        faceSys.pushPose(pr.landmarks[0], now / 1000);
      }
      else if (pr) lastPoseLm = null;
      draw(true);
      if (lastFaceLm && fr?.faceLandmarks?.length) samplePulse(now);   // only fresh landmarks: a stale mesh would sample the wrong pixels
      if (lastFaceLm) sampleEmotion(now);
      else {
        clearEmotions(EMOTION_NOTES.noFace);
        if (now - lastFace > 3000) { tracker.reset(); faceSys.reset(); }
      }
      if (now - lastEstimate > 1000) estimate(now);
    }
    requestAnimationFrame(loop);
  }

  // skin areas for the pulse (face-mesh indices): the forehead between hairline and brows, and both cheeks
  const ROIS = [
    [67, 109, 10, 338, 297, 334, 296, 336, 9, 107, 66, 105],
    [116, 117, 118, 119, 100, 142, 203, 206, 207, 187, 123],
    [345, 346, 347, 348, 329, 371, 423, 426, 427, 411, 352],
  ];
  let prevNose = null;
  function samplePulse(now) {
    const w = sample.width, h = sample.height, lm = lastFaceLm;
    // a moving head swamps the tiny colour change of the pulse: those frames are skipped (the gap is interpolated)
    const fw = Math.hypot(lm[234].x - lm[454].x, lm[234].y - lm[454].y) || 0.2;
    const nose = lm[1];
    const moved = prevNose ? Math.hypot(nose.x - prevNose.x, nose.y - prevNose.y) / fw : 0;
    prevNose = { x: nose.x, y: nose.y };
    if (moved > 0.03) { pulseHint.moving = now; return; }
    // only the skin inside the forehead and cheek outlines, which follow the face as it turns
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    sctx.clearRect(0, 0, w, h);
    sctx.save();
    sctx.beginPath();
    for (const poly of ROIS) {
      poly.forEach((i, k) => {
        const x = lm[i].x * w, y = lm[i].y * h;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (k) sctx.lineTo(x, y); else sctx.moveTo(x, y);
      });
      sctx.closePath();
    }
    sctx.clip();
    sctx.drawImage(video, 0, 0, w, h);
    sctx.restore();
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    const bw = Math.min(w, Math.ceil(x1)) - x0, bh = Math.min(h, Math.ceil(y1)) - y0;
    if (bw < 4 || bh < 4) return;
    const img = sctx.getImageData(x0, y0, bw, bh).data;
    let r = 0, g = 0, b = 0, n = 0, lum = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i + 3] < 250) continue;                        // outside the skin outlines
      const R = img[i], G = img[i + 1], B = img[i + 2], Y = 0.299 * R + 0.587 * G + 0.114 * B;
      if (Y < 25 || Y > 240) continue;                       // shadow or shine: no pulse in it
      r += R; g += G; b += B; lum += Y; n++;
    }
    if (n < 40) return;
    pulseHint.light = lum / n;
    tracker.push({ t: now / 1000, r: r / n, g: g / n, b: b / n });
  }
  const pulseHint = { moving: 0, light: 128 };

  function estimate(now) {
    lastEstimate = now;
    if (!lastFaceLm) {
      pulseValue.textContent = "—";
      pulseQuality.textContent = "no face in view";
      setMsg("Looking for a face…");
      if (state.live && now - lastGood > 5000) { state.live = false; onFallback?.(); }
      refreshBadge();
      return;
    }
    setMsg("");
    const e = tracker.estimate();
    state.quality = e.quality;
    if (e.smoothed != null) {
      state.bpm = Math.round(e.smoothed);
      state.live = true;
      lastGood = now;
      pulseValue.textContent = `about ${state.bpm} bpm`;
      pulseQuality.textContent = `quality ${Math.round(e.quality * 100)}% (${e.method})`;
      refreshBadge();
      if (canPatch()) patchHr(state.bpm, e.quality);   // the quality goes with it: the brain treats a weak signal as an estimate
      emit("vision:hr", state.bpm);
      emit("reading.added", {
        indicator: "heart_rate",
        value: state.bpm,
        source: "camera",
        label: "LIVE",
        confidence: Math.round(e.quality * 100) / 100
      });
      faceSys.emitReadings();
    } else {
      pulseValue.textContent = "reading…";
      // the tracker needs 6 s of samples before it can score anything: that is not "quality 0%"
      const coach = now - pulseHint.moving < 1500 ? "hold your head still" : pulseHint.light < 60 ? "more light on your face will help" : "";
      pulseQuality.textContent = e.method === "none" ? `gathering signal: ${coach || "hold still for a few seconds"}` : `quality ${Math.round(e.quality * 100)}%: ${coach || "hold still, face the light"}`;
      if (state.live && now - lastGood > 5000) { state.live = false; onFallback?.(); }
      refreshBadge();
    }
  }

  function line(a, b, W, H) { ctx2d.moveTo(a.x * W, a.y * H); ctx2d.lineTo(b.x * W, b.y * H); }

  function draw(withFrame = false) {
    const W = overlay.width, H = overlay.height;
    ctx2d.clearRect(0, 0, W, H);
    // the camera frame the landmarks came from, drawn underneath them on the same canvas: the <video> keeps
    // playing newer frames while the model works, which made the mesh lag behind a moving face
    if (withFrame) {
      ctx2d.filter = "saturate(0.5) brightness(0.7) contrast(1.05)";
      ctx2d.drawImage(video, 0, 0, W, H);
      ctx2d.filter = "none";
      overlay.parentElement?.classList.add("is-synced");
    }
    const css = getComputedStyle(document.documentElement);
    const lineC = css.getPropertyValue("--line").trim();
    const alertC = css.getPropertyValue("--alert").trim();
    ctx2d.lineWidth = 1.2;
    ctx2d.shadowBlur = 8;
    ctx2d.shadowColor = lineC;
    ctx2d.strokeStyle = lineC;
    // Person 3 (Stage 1, FACE-1): full tessellation + bright contours via drawFaceMesh().
    if (lastFaceLm && mp) {
      drawFaceMesh(ctx2d, lastFaceLm, mp, W, H);
    }
    if (lastPoseLm && mp) {
      ctx2d.beginPath();
      for (const c of mp.PoseLandmarker.POSE_CONNECTIONS) {
        if (c.start < 11 || c.end < 11) continue; // face handled by the face mesh
        const a = lastPoseLm[c.start], b = lastPoseLm[c.end];
        if ((a.visibility ?? 1) < 0.5 || (b.visibility ?? 1) < 0.5) continue;
        line(a, b, W, H);
      }
      ctx2d.stroke();
    }
    // zone highlight on the real person
    const z = pointZone;
    if (z) {
      let p = null, rad = 40;
      if ((z === "eyes") && lastFaceLm) {
        const a = lastFaceLm[33], b = lastFaceLm[263];
        p = { x: (a.x + b.x) / 2 * W, y: (a.y + b.y) / 2 * H }; rad = Math.hypot(a.x - b.x, a.y - b.y) * W * 0.85;
      } else if (z === "head" && lastFaceLm) {
        const a = lastFaceLm[10], b = lastFaceLm[152];
        p = { x: (a.x + b.x) / 2 * W, y: (a.y + b.y) / 2 * H }; rad = Math.hypot(a.x - b.x, a.y - b.y) * H * 0.62;
      } else if ((z === "heart" || z === "lungs") && lastPoseLm) {
        const a = lastPoseLm[11], b = lastPoseLm[12];
        p = { x: (a.x + b.x) / 2 * W, y: ((a.y + b.y) / 2 + 0.08) * H }; rad = Math.hypot(a.x - b.x, a.y - b.y) * W * 0.45;
      }
      if (p) {
        ctx2d.shadowColor = alertC; ctx2d.strokeStyle = alertC; ctx2d.lineWidth = 3;
        ctx2d.beginPath(); ctx2d.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx2d.stroke();
        ctx2d.save(); ctx2d.scale(-1, 1); // the canvas is mirrored with the video; un-mirror text
        ctx2d.fillStyle = alertC; ctx2d.font = "bold 18px sans-serif";
        ctx2d.fillText(ZONE_LABEL[z] || z, -p.x - rad, p.y - rad - 6);
        ctx2d.restore();
        if (lastZoneEmitted !== z) { lastZoneEmitted = z; emit("vision:zone", z); }
      }
    } else lastZoneEmitted = null;
    ctx2d.shadowBlur = 0;
  }

  // the eye check reads the same camera and face mesh (fresh: landmarks from the last third of a second)
  return { start, stop, state, get fps() { return fps; }, get video() { return video; }, get mp() { return mp; }, get landmarks() { return performance.now() - lastFace < 300 ? lastFaceLm : null; } };
}
