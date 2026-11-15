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

/** Unlock audio on a user gesture: resume the context and play one silent buffer (iOS and Android tablets
 *  keep a context suspended until something plays inside a gesture). Also keeps it unlocked: every later
 *  tap or key press resumes it, because tablets suspend it again in the background. */
export function unlockAudio() {
  const c = audioContext();
  if (!c) return null;
  try {
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b; s.connect(c.destination); s.start(0);
  } catch { /* nothing to unlock */ }
  if (!unlockAudio.bound) {
    unlockAudio.bound = true;
    const wake = () => { if (ctx && ctx.state !== "running") ctx.resume().catch(() => {}); };
    for (const ev of ["pointerdown", "keydown", "touchend"]) document.addEventListener(ev, wake, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
  }
  return c;
}

let introAudio = null;

export function setMuted(m) {
  muted = m;
  if (m) {
    stopAlarm();
    stopIntroSound(0);
  }
}
export function isMuted() { return muted; }

/** Play cinematic intro sound from the sound folder on the first page */
export function playIntroSound() {
  if (muted) return null;
  if (!introAudio) {
    introAudio = new Audio("sound/shortintro.mp3");
    introAudio.preload = "auto";
  }
  introAudio.currentTime = 0;
  const p = introAudio.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {
      // Browser blocked autoplay before gesture: play on next user tap/interaction
      const onFirstTap = () => {
        document.removeEventListener("pointerdown", onFirstTap);
        document.removeEventListener("keydown", onFirstTap);
        if (introAudio && introAudio.paused && !muted) {
          introAudio.play().catch(() => {});
        }
      };
      document.addEventListener("pointerdown", onFirstTap, { once: true, passive: true });
      document.addEventListener("keydown", onFirstTap, { once: true, passive: true });
    });
  }
  return introAudio;
}

/** Fade out intro sound when leaving the first page / starting the app */
export function stopIntroSound(fadeMs = 800) {
  if (!introAudio || introAudio.paused) return;
  if (fadeMs <= 0) {
    introAudio.pause();
    introAudio.currentTime = 0;
    return;
  }
  const startVol = introAudio.volume || 1;
  const stepTime = 50;
  const steps = Math.max(1, fadeMs / stepTime);
  const volStep = startVol / steps;
  const fade = setInterval(() => {
    if (!introAudio) {
      clearInterval(fade);
      return;
    }
    if (introAudio.volume > volStep) {
      introAudio.volume = Math.max(0, introAudio.volume - volStep);
    } else {
      introAudio.volume = 0;
      introAudio.pause();
      introAudio.currentTime = 0;
      introAudio.volume = startVol;
      clearInterval(fade);
    }
  }, stepTime);
}

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
