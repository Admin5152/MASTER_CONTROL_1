// Sentinel Skin (DESIGNED wearable, SIM data in the demo). The backend's systems/skin.py produces
// simulated module readings per zone when the demo panel turns the source on; they arrive in
// aux.skin and are always badged "SIM · Sentinel Skin", never LIVE.
// mountUltrasound draws a looping, echo-style picture on canvas: it illustrates what the patch would
// show and carries a SIM badge in its caption. It is not an image of anyone.

export function skinReadings(zone, skin) {
  if (!skin?.on) return [];
  return (skin.zones?.[zone] || []).map((r) => ({ ...r, badge: "SIM · Sentinel Skin", kind: r.kind || "demo_placeholder" }));
}

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function speckle(w, h, seed = 7) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < w * h; i++) {
    const v = Math.pow(rnd(), 3) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Draw a looping ultrasound-style view into the [data-us] block. Returns a cleanup function. */
export function mountUltrasound(block, zone, skin) {
  if (!block) return null;
  const cv = block.querySelector("canvas");
  const g = cv.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  const W = (cv.width = Math.max(200, r.width * dpr)), H = (cv.height = Math.max(90, r.height * dpr));
  const noise = speckle(160, 80, zone.length * 13);
  const hr = skin?.heart_rate || 70;
  const z = skin?.zones?.[zone] || [];
  const onsd = z.find((x) => x.field === "skin.onsd_mm");
  let raf = 0;
  const t0 = performance.now();
  const apex = { x: W / 2, y: -H * 0.25 };
  function sector() {
    g.beginPath();
    g.moveTo(apex.x, apex.y);
    g.arc(apex.x, apex.y, H * 1.25, Math.PI * 0.5 + 0.62, Math.PI * 0.5 - 0.62, true);
    g.closePath();
  }
  function frame(now) {
    const t = (now - t0) / 1000 * (reduced() ? 0.2 : 1);
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.save();
    sector(); g.clip();
    g.globalAlpha = 0.55; g.drawImage(noise, (t * 6) % 20 - 20, 0, W + 40, H);
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(230,230,230,0.85)"; g.fillStyle = "rgba(0,0,0,0.85)";
    if (zone === "heart") {
      const beat = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (hr / 60));
      const s = 0.82 + 0.18 * beat;
      for (const [cx, cy, rx, ry] of [[0.42, 0.52, 0.12, 0.22], [0.6, 0.55, 0.1, 0.2], [0.44, 0.83, 0.1, 0.1], [0.58, 0.85, 0.09, 0.09]]) {
        g.beginPath(); g.ellipse(cx * W, cy * H, rx * W * s, ry * H * s, 0, 0, Math.PI * 2); g.fill();
        g.lineWidth = 3 * dpr; g.stroke();
      }
    } else if (zone === "lungs") {
      g.lineWidth = 3 * dpr;
      const slide = Math.sin(t * 1.6) * 6 * dpr;
      g.beginPath(); g.moveTo(0, H * 0.35); g.lineTo(W, H * 0.35); g.stroke();       // pleural line
      g.globalAlpha = 0.4;
      for (const y of [0.6, 0.85]) { g.beginPath(); g.moveTo(slide, H * y); g.lineTo(W + slide, H * y); g.stroke(); } // A-lines
      g.globalAlpha = 1;
      for (const x of [0.3, 0.5, 0.7]) { g.beginPath(); g.ellipse(x * W, H * 0.22, 16 * dpr, 10 * dpr, 0, 0, Math.PI * 2); g.fill(); } // ribs' shadows
    } else if (zone === "eyes") {
      g.beginPath(); g.arc(W / 2, H * 0.42, H * 0.32, 0, Math.PI * 2); g.fill(); g.lineWidth = 2 * dpr; g.stroke();
      const w = (onsd?.value || 5) / 5 * W * 0.07;
      g.fillStyle = "rgba(0,0,0,0.9)";
      g.fillRect(W / 2 - w / 2, H * 0.72, w, H * 0.35);
      // caliper 3 mm behind the globe (where ONSD is measured)
      g.strokeStyle = "#ffd36b"; g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.moveTo(W / 2 - w / 2, H * 0.84); g.lineTo(W / 2 + w / 2, H * 0.84); g.stroke();
      for (const x of [W / 2 - w / 2, W / 2 + w / 2]) { g.beginPath(); g.moveTo(x, H * 0.8); g.lineTo(x, H * 0.88); g.stroke(); }
    } else {
      const br = 0.5 + 0.5 * Math.sin(t * 1.3);
      g.beginPath(); g.ellipse(W / 2, H * 0.6, W * 0.16, H * (0.14 + 0.05 * br), 0, 0, Math.PI * 2); g.fill(); g.lineWidth = 2 * dpr; g.stroke();
    }
    g.restore();
    g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 1; sector(); g.stroke();
    if (onsd && zone === "eyes") {
      g.fillStyle = "#ffd36b"; g.font = `${11 * dpr}px Inter, sans-serif`;
      g.fillText(`ONSD ${onsd.value.toFixed(1)} mm`, W * 0.62, H * 0.9);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
