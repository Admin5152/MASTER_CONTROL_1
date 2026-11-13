// Voice: SpeechRecognition (wake phrase), SpeechSynthesis, and mic capture for talk time,
// pitch and speaker ID. Everything degrades to the text box when unavailable.
import { emit } from "../core/bus.js";
import { audioContext } from "../core/sound.js";
import { matchWake } from "./wake.js";
import { medianPitch, rms, talkTime } from "./pitch.js";
import { encodeWav, resample } from "./wav.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voice = {
  recognitionAvailable: !!SR,
  ttsAvailable: "speechSynthesis" in window,
  listening: false,
  speaking: false,
  micReady: false,
  status: "",
};

let rec = null;
let wantListening = false;
let awaitingUntil = 0;     // after a bare "hey sentinel", the next utterance is the command
let onCommand = () => {};
let onUtteranceAudio = () => {};

// ---------- speech synthesis ----------
let chosenVoice = null;
function pickVoice() {
  if (!voice.ttsAvailable) return null;
  const vs = speechSynthesis.getVoices();
  chosenVoice = vs.find((v) => /en[-_]GB/i.test(v.lang) && /female|libby|sonia|hazel|google uk english female/i.test(v.name))
    || vs.find((v) => /en[-_](US|GB)/i.test(v.lang) && v.localService)
    || vs.find((v) => /^en/i.test(v.lang)) || null;
  return chosenVoice;
}
if (voice.ttsAvailable) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

/** Unlock synthesis on a user gesture (tablets block it otherwise). */
export function unlockSpeech() {
  if (!voice.ttsAvailable) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

/** Speak text; resolves when finished (or after a safety timeout). */
export function speak(text, { interrupt = true } = {}) {
  return new Promise((resolve) => {
    if (!text) return resolve();
    if (!voice.ttsAvailable) {
      emit("voice:speaking-start", text);
      setTimeout(() => { emit("voice:speaking-end"); resolve(); }, Math.min(6000, 400 + text.length * 55));
      return;
    }
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (chosenVoice) u.voice = chosenVoice;
    u.rate = 1.0; u.pitch = 1.0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      voice.speaking = false;
      emit("voice:speaking-end");
      resumeRecognition();
      resolve();
    };
    u.onstart = () => { voice.speaking = true; pauseRecognition(); emit("voice:speaking-start", text); };
    u.onend = finish;
    u.onerror = finish;
    setTimeout(finish, Math.min(20000, 1500 + text.length * 90));
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() { if (voice.ttsAvailable) speechSynthesis.cancel(); }

// ---------- speech recognition ----------
export function initVoice({ onCommand: oc, onUtterance }) {
  onCommand = oc;
  onUtteranceAudio = onUtterance || (() => {});
}

function makeRec() {
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = "en-US";
  r.onstart = () => { voice.listening = true; emit("voice:listening", true); };
  r.onend = () => {
    voice.listening = false;
    emit("voice:listening", false);
    if (wantListening && !voice.speaking) setTimeout(() => { try { r.start(); } catch {} }, 250);
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      wantListening = false;
      voice.status = "Microphone permission denied: type, or use the quick buttons.";
      emit("voice:status", voice.status);
    } else if (e.error === "network") {
      wantListening = false;
      voice.status = "Speech recognition needs the internet in Chrome. Offline: type, or use the quick buttons.";
      emit("voice:status", voice.status);
    }
  };
  r.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      const text = res[0].transcript.trim();
      if (!res.isFinal) {
        markUtteranceStart();
        emit("voice:transcript", { text, final: false });
        continue;
      }
      emit("voice:transcript", { text, final: true });
      handleFinal(text);
    }
  };
  return r;
}

function handleFinal(text) {
  const w = matchWake(text);
  const audio = takeUtterance();
  if (w.woke) {
    if (audio) onUtteranceAudio(audio);
    if (w.command) { awaitingUntil = 0; onCommand(w.command, { via: "voice", heard: text }); }
    else { awaitingUntil = Date.now() + 7000; onCommand("", { via: "voice", heard: text, wakeOnly: true }); }
  } else if (Date.now() < awaitingUntil) {
    awaitingUntil = 0;
    if (audio) onUtteranceAudio(audio);
    onCommand(text, { via: "voice", heard: text });
  }
}

export function startListening() {
  if (!SR) {
    voice.status = "Speech recognition is not available in this browser: type, or use the quick buttons.";
    emit("voice:status", voice.status);
    return false;
  }
  wantListening = true;
  if (!rec) rec = makeRec();
  try { rec.start(); } catch { /* already started */ }
  return true;
}

export function stopListening() {
  wantListening = false;
  try { rec?.stop(); } catch {}
}

function pauseRecognition() { if (rec && voice.listening) { try { rec.abort(); } catch {} } }
function resumeRecognition() { if (rec && wantListening && !voice.listening) { try { rec.start(); } catch {} } }

// ---------- mic capture (Web Audio) ----------
let analyser = null;
let ring = null;      // Float32Array ring buffer, ~15 s
let ringPos = 0;
let ringRate = 48000;
let uttStartPos = null;
let lastFinalPos = 0;

export async function initMic(stream) {
  const ctx = audioContext();
  if (!ctx || !stream) return false;
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  ringRate = ctx.sampleRate;
  ring = new Float32Array(Math.round(ringRate * 15));
  // ScriptProcessor is deprecated but universally available and simple; it only copies samples.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) { ring[ringPos] = d[i]; ringPos = (ringPos + 1) % ring.length; }
  };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  voice.micReady = true;
  const buf = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    emit("voice:level", Math.min(1, rms(buf) * 8));
    requestAnimationFrame(tick);
  };
  tick();
  return true;
}

let totalWritten = 0;
function markUtteranceStart() {
  if (!ring || uttStartPos != null) return;
  // start a little before the first interim result
  uttStartPos = (ringPos - Math.round(ringRate * 1.0) + ring.length) % ring.length;
}

/** Slice the audio of the utterance just finished: from its start (or the last final) to now. */
function takeUtterance() {
  if (!ring) return null;
  const start = uttStartPos != null ? uttStartPos : lastFinalPos;
  uttStartPos = null;
  let len = (ringPos - start + ring.length) % ring.length;
  len = Math.min(len, Math.round(ringRate * 12));
  lastFinalPos = ringPos;
  if (len < ringRate * 0.4) return null;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = ring[(start + i) % ring.length];
  void totalWritten;
  return { samples: out, rate: ringRate };
}

/** Features of an utterance: talk time (s) and median pitch (Hz). */
export function features(audio) {
  const tt = talkTime(audio.samples, audio.rate);
  const p = medianPitch(audio.samples, audio.rate);
  return { talk_time: Math.round(tt * 10) / 10, pitch: p ? Math.round(p) : null };
}

export function toWav16k(audio) { return encodeWav(resample(audio.samples, audio.rate, 16000), 16000); }

/** Record a fixed-length clip (for voice enrolment). */
export async function recordClip(seconds = 10, onProgress) {
  if (!ring) throw new Error("microphone not ready");
  const startPos = ringPos;
  const t0 = Date.now();
  await new Promise((res) => {
    const iv = setInterval(() => {
      const el = (Date.now() - t0) / 1000;
      onProgress?.(Math.min(1, el / seconds));
      if (el >= seconds) { clearInterval(iv); res(); }
    }, 200);
  });
  const len = Math.min(ring.length - 1, Math.round(ringRate * seconds));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = ring[(startPos + i) % ring.length];
  return { samples: out, rate: ringRate };
}

// interim push-to-talk (replaced by the VAD capture pipeline)
export function pushToTalk() {
  if (!SR) return false;
  awaitingUntil = Date.now() + 8000;
  startListening();
  return true;
}
