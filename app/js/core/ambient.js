// A soft ambient bed for Sentinel: a slow, warm chord with faint "space air", generated with Web Audio (no files).
// It plays gently on the start screen, then sits quietly behind the app. It dips while Sentinel speaks or listens,
// steps aside for the games and tools that have their own sound, and follows the mute button.
// Browsers start sound only after a first touch, unless the app is installed on the home screen; until then it
// waits, and fades in on the first tap anywhere.
import { audioContext, isMuted } from "./sound.js";

const LEVEL = { start: 0.12, app: 0.045, off: 0 };
const DUCK = 0.25;                 // while Sentinel speaks or listens: a quarter of the level
const CHORD = [146.83, 220.0, 277.18, 329.63, 369.99];   // D3 A3 C#4 E4 F#4: a soft Dmaj9, no tension

let g = null;                      // the graph: { master, ctx }
let mode = "off", ducked = false, aside = false;

function build() {
  const ctx = audioContext();
  if (!ctx) return null;
  const master = ctx.createGain(); master.gain.value = 0;
  // a little space: a darkened feedback delay
  const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.37;
  const fb = ctx.createGain(); fb.gain.value = 0.33;
  const dark = ctx.createBiquadFilter(); dark.type = "lowpass"; dark.frequency.value = 1400;
  delay.connect(dark); dark.connect(fb); fb.connect(delay);
  const wet = ctx.createGain(); wet.gain.value = 0.35;
  delay.connect(wet); wet.connect(master);
  // the pad: each note is two slightly detuned oscillators, breathing slowly at its own pace
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 900; tone.Q.value = 0.4;
  const sweep = ctx.createOscillator(); sweep.frequency.value = 0.031;
  const sweepAmt = ctx.createGain(); sweepAmt.gain.value = 320;
  sweep.connect(sweepAmt); sweepAmt.connect(tone.frequency); sweep.start();
  tone.connect(master); tone.connect(delay);
  CHORD.forEach((f, i) => {
    const v = ctx.createGain(); v.gain.value = 0.05;
    const swell = ctx.createOscillator(); swell.frequency.value = 0.045 + i * 0.013;
    const swellAmt = ctx.createGain(); swellAmt.gain.value = 0.035;
    swell.connect(swellAmt); swellAmt.connect(v.gain); swell.start(ctx.currentTime + i * 1.7);
    for (const [type, cents] of [["sine", -4], ["triangle", 5]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = cents;
      const og = ctx.createGain(); og.gain.value = type === "sine" ? 0.6 : 0.25;
      o.connect(og); og.connect(v); o.start();
    }
    v.connect(tone);
  });
  // faint air: soft noise through a gentle band, slowly coming and going
  const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }   // brown noise
  const air = ctx.createBufferSource(); air.buffer = buf; air.loop = true;
  const band = ctx.createBiquadFilter(); band.type = "bandpass"; band.frequency.value = 520; band.Q.value = 0.6;
  const airG = ctx.createGain(); airG.gain.value = 0.18;
  const airLfo = ctx.createOscillator(); airLfo.frequency.value = 0.06;
  const airAmt = ctx.createGain(); airAmt.gain.value = 0.1;
  airLfo.connect(airAmt); airAmt.connect(airG.gain); airLfo.start();
  air.connect(band); band.connect(airG); airG.connect(master); air.start();
  master.connect(ctx.destination);
  return { ctx, master };
}

function apply(seconds = 2.5) {
  if (!g) return;
  const t = g.ctx.currentTime;
  let v = isMuted() || aside ? 0 : LEVEL[mode] || 0;
  if (ducked) v *= DUCK;
  g.master.gain.cancelScheduledValues(t);
  g.master.gain.setTargetAtTime(v, t, seconds / 3);
}

/** "start" (the start screen), "app" (quietly behind the app) or "off". */
export function setAmbient(m, seconds) {
  mode = m;
  if (m !== "off" && !g) g = build();
  apply(seconds ?? (m === "start" ? 5 : 2.5));   // the first time: a slow, gentle fade in
}
/** Dip while Sentinel speaks or listens. */
export function duckAmbient(on) { if (on === ducked) return; ducked = on; apply(on ? 0.5 : 2); }
/** Step aside for a game or tool with its own sound (Stillpoint, Slipstream, Red Harvest, Ambient sound). */
export function asideAmbient(on) { if (on === aside) return; aside = on; apply(on ? 0.8 : 3); }
/** After the mute button changes. */
export function refreshAmbient() { apply(0.6); }
