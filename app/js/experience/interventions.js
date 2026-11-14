// Intervention menu: breathing (Orb Calm), Aurora Run, Earth window, music, connection nudge.
import { audioContext, isMuted } from "../core/sound.js";
import { esc } from "../interface/readings.js";

export const INTERVENTIONS = [
  { id: "breathing", label: "Stillpoint (breathing)", why: "Slow breathing guided by the orb, tracked against your heart rate." },
  { id: "aurora_run", label: "Slipstream (racing)", why: "A three-lap race past five worlds: a short break from boredom or stress, with your mood logged before and after." },
  { id: "earth_window", label: "Earth window", why: "A slow view of home. A short break for tired eyes and mind." },
  { id: "music", label: "Ambient sound", why: "A generated ambient pad to wind down." },
  { id: "connection", label: "Message a crewmate", why: "Isolation is one of NASA's five hazards; a short message helps." },
];

export function renderMenu(el, ctx, chosen) {
  const sel = chosen || ctx.view.state?.action?.intervention || "";
  el.innerHTML = `<p class="note">Sentinel's rules choose a suggestion from your current state${sel ? `: <strong>${esc(INTERVENTIONS.find((i) => i.id === sel)?.label || sel)}</strong>` : ""}. You can pick any of them.</p>
    <div class="form-grid">${INTERVENTIONS.map((i) => `<button class="pill pill-block ${i.id === sel ? "pill-dark" : "pill-ghost"}" type="button" data-iv="${i.id}">${esc(i.label)}</button><p class="note">${esc(i.why)}</p>`).join("")}</div>`;
  el.querySelectorAll("[data-iv]").forEach((b) => b.addEventListener("click", () => ctx.openIntervention(b.dataset.iv)));
}

export function renderEarth(el) {
  el.innerHTML = `<div class="earth" role="img" aria-label="Slow animated view of Earth"></div>
    <p class="note" style="text-align:center;margin-top:var(--s-4)">An illustrated window, drawn with CSS. Look at it for a minute and let your eyes rest on the far edge.</p>`;
}

export function renderMusic(el) {
  el.innerHTML = `<p>A soft ambient pad generated in the browser. It fades in and out slowly.</p>
    <p><button class="pill pill-dark pill-block" type="button" data-play>Play</button></p>
    <p class="note" data-st>${isMuted() ? "Sound cues are muted; this player still plays when you press it." : ""}</p>`;
  let nodes = null;
  const btn = el.querySelector("[data-play]");
  const stop = () => {
    if (!nodes) return;
    const c = audioContext();
    nodes.master.gain.cancelScheduledValues(c.currentTime);
    nodes.master.gain.setTargetAtTime(0, c.currentTime, 0.6);
    const n = nodes; nodes = null;
    setTimeout(() => n.oscs.forEach((o) => { try { o.stop(); } catch {} }), 2500);
    btn.textContent = "Play";
  };
  btn.addEventListener("click", () => {
    if (nodes) return stop();
    const c = audioContext();
    if (!c) { el.querySelector("[data-st]").textContent = "Web Audio is not available."; return; }
    const master = c.createGain(); master.gain.value = 0;
    const filter = c.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 900;
    master.connect(filter).connect(c.destination);
    const oscs = [];
    [130.81, 164.81, 196.0, 246.94].forEach((f, i) => {
      const o = c.createOscillator(); o.type = i % 2 ? "sine" : "triangle"; o.frequency.value = f;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03;
      const lg = c.createGain(); lg.gain.value = 3; lfo.connect(lg).connect(o.detune);
      const g = c.createGain(); g.gain.value = 0.06;
      o.connect(g).connect(master); o.start(); lfo.start(); oscs.push(o, lfo);
    });
    master.gain.setTargetAtTime(0.5, c.currentTime, 2);
    nodes = { master, oscs };
    btn.textContent = "Stop";
  });
  return stop;
}

export function renderConnection(el, ctx) {
  const others = ctx.view.crew.filter((c) => c.crew_id !== ctx.view.crewId);
  el.innerHTML = `<p>Isolation and confinement is one of NASA's five hazards. A two-line message to a crewmate is a small, real countermeasure.</p>
    <div class="field"><label for="msg-to">To</label><select id="msg-to">${others.map((c) => `<option value="${esc(c.crew_id)}">${esc(c.display_name)}</option>`).join("")}</select></div>
    <div class="field" style="margin-top:var(--s-3)"><label for="msg-text">Message</label><input id="msg-text" type="text" placeholder="Fancy a coffee at the window after shift?"></div>
    <p style="margin-top:var(--s-3)"><button class="pill pill-dark pill-block" type="button" data-send>Send</button></p>
    <p class="note" data-st>Messages stay on this laptop in the demo; crew messaging is DESIGNED, not built.</p>`;
  el.querySelector("[data-send]").addEventListener("click", () => {
    const to = el.querySelector("#msg-to");
    el.querySelector("[data-st]").textContent = `Noted for ${to.options[to.selectedIndex]?.text || "your crewmate"}. Crew messaging is DESIGNED, not built: nothing was sent.`;
  });
}
