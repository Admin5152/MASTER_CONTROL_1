// Voice (brief sections 4.1, 4.2, 9.5).
// Listening: the microphone runs through Web Audio; a VAD (./vad.js) cuts each utterance (max 15 s),
// which is posted as 16 kHz WAV to /api/stt (Groq Whisper, or local Whisper on the laptop). A transcript
// that starts with the wake phrase is a command; tapping the orb or the mic makes the next utterance a
// command with no wake phrase (push-to-talk, the reliable path on stage). Browser SpeechRecognition is
// only the last fallback, when /api/stt keeps failing. Talk time, pitch and speaker ID use the same audio.
// Speaking: each sentence is fetched from /api/tts (ElevenLabs -> Kokoro) while the previous one plays,
// played through Web Audio so the orb follows the real audio level; browser speech is the last fallback.
// Listening pauses while Sentinel speaks so it never hears itself.
import { emit } from "../core/bus.js";
import { audioContext, unlockAudio } from "../core/sound.js";
import { matchWake } from "./wake.js";
import { matchIntent } from "../core/intents.js";
import { medianPitch, rms, talkTime } from "./pitch.js";
import { encodeWav, resample } from "./wav.js";
import { createVad } from "./vad.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voice = {
  recognitionAvailable: true,     // server STT; the browser recogniser is only a fallback
  ttsAvailable: true,
  listening: false,               // the VAD is armed (wake mode or push-to-talk)
  speaking: false,
  micReady: false,
  capturing: false,               // an utterance is being recorded right now
  status: "",
  sttSource: "",
  ttsSource: "",
  playing: false,                 // a Web Audio source is playing Sentinel's voice right now
  lastError: "",
};

/** A small visible notice when the voice fails, at most once every 30 s; the reason goes to the console. */
let lastNotice = 0;
function voiceProblem(what, detail) {
  voice.lastError = `${what}: ${detail}`;
  console.warn(`[sentinel voice] ${what}: ${detail}`);
  if (Date.now() - lastNotice > 30000) {
    lastNotice = Date.now();
    emit("voice:notice", "Voice unavailable, showing text");
  }
}

let onCommand = () => {};
let onUtteranceAudio = () => {};
let voiceId = "river";
export function setVoice(id) { voiceId = id || "river"; }
export function initVoice({ onCommand: oc, onUtterance }) {
  onCommand = oc;
  onUtteranceAudio = onUtterance || (() => {});
}

// ======================= speaking =======================
let outGain = null, outAnalyser = null, levelLoop = 0;
function outChain() {
  const ctx = audioContext();
  if (!ctx) return null;
  if (!outGain) {
    outGain = ctx.createGain();
    outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = 512;
    outGain.connect(outAnalyser); outAnalyser.connect(ctx.destination);
  }
  return ctx;
}
function startLevel() {
  if (levelLoop) return;
  const buf = new Float32Array(512);
  let smooth = 0;
  const tick = () => {
    if (!voice.speaking) { levelLoop = 0; emit("voice:speak-level", 0); return; }
    outAnalyser.getFloatTimeDomainData(buf);
    const l = Math.min(1, rms(buf) * 5);
    smooth += (l - smooth) * (l > smooth ? 0.5 : 0.15);
    emit("voice:speak-level", smooth);
    levelLoop = requestAnimationFrame(tick);
  };
  levelLoop = requestAnimationFrame(tick);
}

let queue = [];          // [{text, audio: Promise<AudioBuffer|null>, resolve}]
let playing = null;      // {src, job}
let gen = 0;
let browserVoice = null;
function pickBrowserVoice() {
  if (!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices();
  browserVoice = vs.find((v) => /en[-_](US|GB)/i.test(v.lang) && /natural|aria|jenny|libby|sonia|google/i.test(v.name)) || vs.find((v) => /^en/i.test(v.lang)) || null;
  return browserVoice;
}
if ("speechSynthesis" in window) { pickBrowserVoice(); speechSynthesis.onvoiceschanged = pickBrowserVoice; }

/** Unlock audio and browser speech on a user gesture (tablets block both otherwise). */
export function unlockSpeech() {
  unlockAudio();
  outChain();
  try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* no browser speech */ }
}

/** One /api/tts request, decoded. Throws with the HTTP status or the decode error so the caller can log it. */
async function ttsOnce(text, engine) {
  const ctx = outChain();
  if (!ctx) throw new Error("no Web Audio");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch("../api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: voiceId, engine }), signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const source = r.headers.get("X-TTS-Source") || engine;
    const buf = await ctx.decodeAudioData(await r.arrayBuffer());
    return { buf, source };
  } finally { clearTimeout(t); }
}

/** The voice comes from the server (ElevenLabs); null means it failed
 *  (the caller then uses browser speech as the last resort). Every failure is logged with its status. */
async function fetchAudio(text, myGen) {
  for (const engine of ["auto"]) {   // the server speaks with ElevenLabs
    if (myGen !== gen) return null;
    try {
      const { buf, source } = await ttsOnce(text, engine);
      voice.ttsSource = source;
      emit("voice:engine", source);
      return buf;
    } catch (e) {
      voiceProblem(`/api/tts (${engine})`, e.name === "AbortError" ? "timed out" : e.message);
    }
  }
  return null;
}

function browserSay(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return setTimeout(resolve, Math.min(6000, 400 + text.length * 55));
    const u = new SpeechSynthesisUtterance(text);
    if (browserVoice) u.voice = browserVoice;
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, Math.min(20000, 1500 + text.length * 90));
    voice.ttsSource = "browser";
    speechSynthesis.speak(u);
  });
}

/** Plays the queue one sentence at a time. The lock is taken before any await, so a sentence that arrives
 *  while the first one's audio is still downloading waits its turn instead of starting a second player
 *  (that race made streamed replies speak over themselves). An interrupt (gen++) retires the old loop. */
let pumpGen = -1;
async function pump() {
  if (pumpGen === gen || !queue.length) return;
  const myGen = gen;
  pumpGen = myGen;
  try {
    while (queue.length && myGen === gen) {
      const job = queue.shift();
      if (!voice.speaking) {
        voice.speaking = true;
        // a reply window that was already open moves to after this speech, so talking never eats it
        if (Date.now() < awaitingUntil) { pendingReply = Math.max(pendingReply, 9000); awaitingUntil = 0; }
        pauseListening();
        emit("voice:speaking-start", job.text);
      }
      const buffer = await job.audio;
      if (myGen !== gen) { job.resolve(); return; }
      emit("voice:sentence", job.text);
      if (buffer) {
        const ctx = outChain();
        if (ctx.state === "suspended") { try { await ctx.resume(); } catch { /* ignore */ } }
        if (myGen !== gen) { job.resolve(); return; }
        await new Promise((res) => {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(outGain);
          playing = { src, job };
          voice.playing = true;
          src.onended = () => { voice.playing = false; res(); };
          startLevel();
          src.start();
          // a context that is still suspended plays nothing and never ends: say so and fall through to text
          setTimeout(() => { if (ctx.state !== "running" && playing?.src === src) { voiceProblem("audio output", `AudioContext ${ctx.state}`); voice.playing = false; res(); } }, 1500);
        });
      } else {
        playing = { src: null, job };
        emit("voice:speak-level", 0.35);
        emit("voice:engine", "browser");
        await browserSay(job.text);
      }
      playing = null;
      job.resolve();
    }
    if (myGen === gen) finishSpeaking();
  } finally {
    if (pumpGen === myGen) pumpGen = -1;
  }
}

function finishSpeaking() {
  if (!voice.speaking) return;
  voice.speaking = false;
  emit("voice:speak-level", 0);
  emit("voice:speaking-end");
  setTimeout(resumeListening, 350);   // let the room's echo die down first
}

/** Speak a sentence (or a short reply). With interrupt=false it queues after what is playing. */
export function speak(text, { interrupt = true } = {}) {
  if (!text) return Promise.resolve();
  if (interrupt) stopSpeaking();
  return new Promise((resolve) => {
    const myGen = gen;
    const parts = String(text).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
    // short replies go as one request; long ones by sentence so speech starts sooner
    const chunks = text.length < 160 ? [text] : parts.map((p) => p.trim()).filter(Boolean);
    chunks.forEach((c, i) => {
      const job = { text: c, audio: fetchAudio(c, myGen), resolve: i === chunks.length - 1 ? resolve : () => {} };
      queue.push(job);
    });
    pump();
  });
}

export function stopSpeaking() {
  gen++; pendingReply = 0;
  const q = queue; queue = [];
  q.forEach((j) => j.resolve());
  if (playing?.src) { try { playing.src.onended = null; playing.src.stop(); } catch { /* already stopped */ } }
  voice.playing = false;
  if (playing) { playing.job.resolve(); playing = null; }
  try { speechSynthesis.cancel(); } catch { /* no browser speech */ }
  finishSpeaking();
}

// ======================= listening =======================
let analyser = null;
let ring = null, ringPos = 0, ringRate = 48000, written = 0;
let vad = null, vadCount = 0;   // vadCount: samples the VAD has seen (it only sees audio while listening is armed)
let uttStart = null;
let wake = false;              // always-on wake-phrase mode
let pttUntil = 0;              // push-to-talk window: the next utterance is a command
let awaitingUntil = 0;         // after a bare "hey sentinel"
let paused = false;
let pendingReply = 0;          // a reply window to open as soon as Sentinel stops speaking
let openMic = () => false;     // while this is true every utterance is a command (the "Who's here?" chooser)
/** While fn() is true, every utterance is taken as a command: no wake phrase, no tap. */
export function setOpenMic(fn) { openMic = typeof fn === "function" ? fn : () => false; }
/** Conversation: the next utterance within `ms` is a command with no wake phrase. If Sentinel is speaking,
 *  the window opens when it stops (so its own speech never eats the window). */
export function expectReply(ms = 8000) {
  if (voice.speaking) { pendingReply = ms; return; }
  pendingReply = 0; paused = false;
  awaitingUntil = Date.now() + ms;
  emit("voice:open", ms);
}
let sttFails = 0;
let rec = null;                // browser SpeechRecognition fallback

export async function initMic(stream) {
  const ctx = audioContext();
  if (!ctx || !stream) return false;
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  ringRate = ctx.sampleRate;
  ring = new Float32Array(Math.round(ringRate * 18));
  vad = createVad(ringRate);
  // ScriptProcessor is deprecated but universally available (Android Chrome included); it only copies samples.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) { ring[ringPos] = d[i]; ringPos = (ringPos + 1) % ring.length; }
    written += d.length;
    if (!paused && (wake || Date.now() < pttUntil || Date.now() < awaitingUntil || openMic())) { vadCount += d.length; onVad(vad.push(d)); }
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

function onVad(events) {
  for (const e of events) {
    if (e.type === "start") {
      uttStart = written - (vadCount - e.at) - Math.round(ringRate * 0.25);   // 250 ms pre-roll
      voice.capturing = true;
      emit("voice:capture", true);
    } else if (e.type === "end" || e.type === "drop") {
      voice.capturing = false;
      emit("voice:capture", false);
      if (e.type === "end") {
        const end = Math.min(written, written - (vadCount - e.to) + Math.round(ringRate * 0.2));
        const audio = slice(uttStart ?? written - (vadCount - e.from), end);
        if (audio) transcribe(audio);
      }
      uttStart = null;
    }
  }
}

/** Samples from absolute position `from` to `to` (both counted since the mic started). */
function slice(from, to) {
  const len = Math.min(to - from, ring.length - 1, Math.round(ringRate * 15.5));
  if (len < ringRate * 0.3) return null;
  const out = new Float32Array(len);
  const start = (ringPos - (written - (to - len)) % ring.length + ring.length * 2) % ring.length;
  for (let i = 0; i < len; i++) out[i] = ring[(start + i) % ring.length];
  return { samples: out, rate: ringRate };
}

async function transcribe(audio) {
  const ptt = Date.now() < pttUntil, awaiting = Date.now() < awaitingUntil;
  pttUntil = 0;
  emit("voice:thinking", true);
  let text = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch("../api/stt", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: toWav16k(audio), signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`stt ${r.status}`);
    const d = await r.json();
    text = (d.text || "").trim();
    voice.sttSource = d.source;
    sttFails = 0;
  } catch {
    emit("voice:thinking", false);
    if (++sttFails >= 2 && SR) { useBrowserRecognition(); return; }
    voice.status = "I couldn't hear that clearly. Try again, or type.";
    emit("voice:status", voice.status);
    return;
  }
  emit("voice:thinking", false);
  if (!text || /^[\s.,!?-]*$/.test(text) || /^(thank you|thanks for watching|you)\.?$/i.test(text)) return;   // Whisper's silence hallucinations
  handleText(text, audio, { ptt, awaiting });
}

/** An unmistakable command ("do a full body scan", "open my vitals", "explode it"): acted on without the wake
 *  phrase. Questions and conversation still need "Sentinel" first, so talk in the room is not answered. */
function isClearCommand(text) {
  const m = matchIntent(text);
  if (!m || !m.commands?.length) return false;
  if (m.intent === "clarify" || m.intent === "point") return false;   // "heart", "my eyes": too easy to say in passing
  return String(text).trim().split(/\s+/).length <= 12;
}

function handleText(text, audio, { ptt = false, awaiting = false } = {}) {
  emit("voice:transcript", { text, final: true });
  const w = matchWake(text);
  if (w.woke) {
    if (audio) onUtteranceAudio(audio);
    if (w.command) {
      awaitingUntil = 0;
      emit("voice.command", { text: w.command, speakerId: null, confidence: 0.95 });
      onCommand(w.command, { via: "voice", heard: text });
    }
    else { awaitingUntil = Date.now() + 8000; emit("voice:open", 8000); onCommand("", { via: "voice", heard: text, wakeOnly: true }); }
  } else if (ptt || awaiting || Date.now() < awaitingUntil || openMic() || isClearCommand(text)) {
    const open = !(ptt || awaiting || Date.now() < awaitingUntil);
    awaitingUntil = 0;
    if (audio) onUtteranceAudio(audio);
    emit("voice.command", { text, speakerId: null, confidence: 0.95 });
    onCommand(text, { via: "voice", heard: text, open });
  }
}

/** Always-on listening for the wake phrase. */
export function startListening() {
  if (!voice.micReady) {
    if (SR) return useBrowserRecognition();
    voice.status = "No microphone: type, or use the menu.";
    emit("voice:status", voice.status);
    return false;
  }
  wake = true;
  voice.listening = true;
  emit("voice:listening", true);
  emit("voice.listening", { active: true });
  return true;
}

export function stopListening() {
  wake = false;
  voice.listening = false;
  try { rec?.stop(); } catch { /* not running */ }
  emit("voice:listening", false);
  emit("voice.listening", { active: false });
}

function pauseListening() { paused = true; vad?.reset(); if (voice.capturing) { voice.capturing = false; emit("voice:capture", false); } try { rec?.abort(); } catch { /* none */ } }
function resumeListening() { paused = false; if (pendingReply) { awaitingUntil = Date.now() + pendingReply; emit("voice:open", pendingReply); pendingReply = 0; } if (rec && wake) { try { rec.start(); } catch { /* running */ } } }

/** Push-to-talk: the next utterance (within 8 s) is a command, no wake phrase needed. */
export function pushToTalk() {
  if (!voice.micReady) {
    if (!SR) return false;
    useBrowserRecognition();
    awaitingUntil = Date.now() + 8000;
    return true;
  }
  stopSpeaking();
  paused = false;
  vad?.reset();
  pttUntil = Date.now() + 8000;
  emit("voice:capture", true);
  setTimeout(() => { if (!voice.capturing && Date.now() >= pttUntil - 50) emit("voice:capture", false); }, 8100);
  return true;
}

// ---- last fallback: the browser recogniser (needs Google's servers in Chrome) ----
function useBrowserRecognition() {
  if (!SR) return false;
  if (!rec) {
    rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    rec.onend = () => { if (wake && !voice.speaking) setTimeout(() => { try { rec.start(); } catch { /* running */ } }, 250); };
    rec.onerror = (e) => {
      if (["not-allowed", "service-not-allowed", "network"].includes(e.error)) {
        wake = false;
        voice.status = e.error === "network" ? "Speech recognition is offline: type, or use the menu." : "Microphone permission denied: type, or use the menu.";
        emit("voice:status", voice.status);
      }
    };
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i], text = res[0].transcript.trim();
        if (!res.isFinal) { emit("voice:transcript", { text, final: false }); continue; }
        voice.sttSource = "browser";
        handleText(text, null);
      }
    };
  }
  wake = true;
  voice.listening = true;
  try { rec.start(); } catch { /* running */ }
  voice.status = "Using the browser's speech recognition.";
  return true;
}

// ---- features for talk time, pitch and speaker ID ----
export function features(audio) {
  const tt = talkTime(audio.samples, audio.rate);
  const p = medianPitch(audio.samples, audio.rate);
  return { talk_time: Math.round(tt * 10) / 10, pitch: p ? Math.round(p) : null };
}

export function toWav16k(audio) { return encodeWav(resample(audio.samples, audio.rate, 16000), 16000); }

/** Record a fixed-length clip (voice enrolment). */
export async function recordClip(seconds = 10, onProgress) {
  if (!ring) throw new Error("microphone not ready");
  const from = written, t0 = Date.now();
  await new Promise((res) => {
    const iv = setInterval(() => {
      const el = (Date.now() - t0) / 1000;
      onProgress?.(Math.min(1, el / seconds));
      if (el >= seconds) { clearInterval(iv); res(); }
    }, 200);
  });
  return slice(from, written) || { samples: new Float32Array(0), rate: ringRate };
}

/** Settings: speak one short (cached) line and report which engine played it. */
export async function testVoice() {
  stopSpeaking();
  const myGen = gen;
  const buf = await fetchAudio("Voice check. This is Sentinel.", myGen);
  if (!buf) { await speak("Voice check. This is Sentinel."); return { engine: "browser", ok: "speechSynthesis" in window }; }
  const engine = voice.ttsSource;
  await new Promise((resolve) => { queue.push({ text: "Voice check. This is Sentinel.", audio: Promise.resolve(buf), resolve }); pump(); });
  return { engine, ok: true };
}
