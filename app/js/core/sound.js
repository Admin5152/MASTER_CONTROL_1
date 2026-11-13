// Short, quiet sound cues generated with Web Audio. One AudioContext, created on the start tap.
let ctx = null;
let muted = false;
let alarmTimer = null;

export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setMuted(m) { muted = m; if (m) stopAlarm(); }
export function isMuted() { return muted; }

function tone(freq, dur = 0.12, gain = 0.05, type = "sine", when = 0) {
  if (muted) return;
  const c = audioContext();
  if (!c) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const cue = {
  tick: () => tone(1320, 0.05, 0.03, "sine"),
  wake: () => { tone(660, 0.12, 0.04); tone(990, 0.16, 0.04, "sine", 0.1); },
  point: () => { tone(520, 0.2, 0.035, "triangle"); },
  done: () => { tone(880, 0.1, 0.03); tone(1175, 0.18, 0.03, "sine", 0.09); },
  nudge: () => tone(740, 0.25, 0.03, "sine"),
};

// Alert tone: two-tone repeating until acknowledged.
export function startAlarm(level = "alert") {
  if (alarmTimer) return;
  const beat = () => {
    if (level === "alert") { tone(880, 0.22, 0.09, "square"); tone(660, 0.22, 0.09, "square", 0.25); }
    else tone(700, 0.25, 0.06, "triangle");
  };
  beat();
  alarmTimer = setInterval(beat, level === "alert" ? 1400 : 3000);
}

export function stopAlarm() {
  if (alarmTimer) clearInterval(alarmTimer);
  alarmTimer = null;
}
