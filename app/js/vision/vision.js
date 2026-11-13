// Vision: webcam, MediaPipe Face + Pose Landmarker (vendored WASM), rPPG pulse, zone highlight.
import { emit, on } from "../core/bus.js";
import { PulseTracker } from "./rppg.js";

const isTablet = /Android|iPad|Tablet/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const ZONE_LABEL = { eyes: "eyes", head: "head", heart: "chest", lungs: "chest", whole_body: "whole body" };

export function createVision({ video, overlay, msg, badge, pulseValue, pulseQuality, canPatch, patchHr, onFallback }) {
  const ctx2d = overlay.getContext("2d");
  const sample = document.createElement("canvas");
  sample.width = 160; sample.height = 120;
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  const tracker = new PulseTracker(11);
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
  const state = { on: false, live: false, bpm: null, quality: 0, error: null };

  on("vision:point", (z) => { pointZone = z; });

  function setMsg(t) { msg.textContent = t; msg.hidden = !t; }
  function setBadge(live) { badge.className = `badge ${live ? "badge-live" : "badge-sim"}`; badge.textContent = live ? "LIVE" : "SIM"; }

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
    face = await make(mp.FaceLandmarker, "face_landmarker.task", { numFaces: 1 });
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
    try {
      await loadModels();
    } catch (e) {
      console.warn("MediaPipe failed to load", e);
      state.error = "models";
      setMsg("Face tracking could not load. Camera shown without tracking; heart rate stays SIM.");
      return true;
    }
    setMsg("Looking for a face…");
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
    onFallback?.();
  }

  function stop() {
    running = false;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    state.on = false;
    ctx2d.clearRect(0, 0, overlay.width, overlay.height);
    setMsg("Camera off. Heart rate comes from the simulator (SIM).");
    setBadge(false);
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
      let fr = null, pr = null;
      try { fr = face.detectForVideo(video, now); } catch { /* skip frame */ }
      if (poseOn && frame % poseEvery === 0) { try { pr = pose.detectForVideo(video, now); } catch {} }
      if (fr?.faceLandmarks?.length) { lastFaceLm = fr.faceLandmarks[0]; lastFace = now; }
      else if (now - lastFace > 600) lastFaceLm = null;
      if (pr?.landmarks?.length) lastPoseLm = pr.landmarks[0];
      else if (pr) lastPoseLm = null;
      draw();
      if (lastFaceLm) samplePulse(now);
      else if (now - lastFace > 3000) { tracker.reset(); }
      if (now - lastEstimate > 1000) estimate(now);
    }
    requestAnimationFrame(loop);
  }

  function samplePulse(now) {
    const w = sample.width, h = sample.height;
    sctx.drawImage(video, 0, 0, w, h);
    const img = sctx.getImageData(0, 0, w, h).data;
    const lm = lastFaceLm;
    const faceW = Math.hypot(lm[234].x - lm[454].x, lm[234].y - lm[454].y);
    const box = Math.max(2, Math.round(faceW * w * 0.09));
    let r = 0, g = 0, b = 0, n = 0;
    for (const idx of [151, 50, 280]) { // forehead, left cheek, right cheek
      const cx = Math.round(lm[idx].x * w), cy = Math.round(lm[idx].y * h);
      for (let y = cy - box; y <= cy + box; y++) {
        if (y < 0 || y >= h) continue;
        for (let x = cx - box; x <= cx + box; x++) {
          if (x < 0 || x >= w) continue;
          const i = (y * w + x) * 4;
          r += img[i]; g += img[i + 1]; b += img[i + 2]; n++;
        }
      }
    }
    if (n) tracker.push({ t: now / 1000, r: r / n, g: g / n, b: b / n });
  }

  function estimate(now) {
    lastEstimate = now;
    if (!lastFaceLm) {
      pulseValue.textContent = "—";
      pulseQuality.textContent = "no face in view";
      setMsg("Looking for a face…");
      if (state.live && now - lastGood > 5000) { state.live = false; setBadge(false); onFallback?.(); }
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
      setBadge(true);
      if (canPatch()) patchHr(state.bpm);
      emit("vision:hr", state.bpm);
    } else {
      pulseValue.textContent = "reading…";
      pulseQuality.textContent = `quality ${Math.round(e.quality * 100)}%: hold still, face the light`;
      if (state.live && now - lastGood > 5000) { state.live = false; setBadge(false); onFallback?.(); }
    }
  }

  function line(a, b, W, H) { ctx2d.moveTo(a.x * W, a.y * H); ctx2d.lineTo(b.x * W, b.y * H); }

  function draw() {
    const W = overlay.width, H = overlay.height;
    ctx2d.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const lineC = css.getPropertyValue("--line").trim();
    const alertC = css.getPropertyValue("--alert").trim();
    ctx2d.lineWidth = 1.2;
    ctx2d.shadowBlur = 8;
    ctx2d.shadowColor = lineC;
    ctx2d.strokeStyle = lineC;
    if (lastFaceLm && mp) {
      ctx2d.beginPath();
      for (const set of [mp.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, mp.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, mp.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
        mp.FaceLandmarker.FACE_LANDMARKS_LIPS, mp.FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, mp.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW]) {
        for (const c of set) line(lastFaceLm[c.start], lastFaceLm[c.end], W, H);
      }
      ctx2d.stroke();
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

  return { start, stop, state, get fps() { return fps; } };
}
