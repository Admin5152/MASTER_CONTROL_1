/**
 * Sentinel Twi Voice Hook & Controller.
 * Provides bidirectional Twi speech support powered by Khaya AI (GhanaNLP).
 *
 * Rules:
 * - Default language is "en" (English).
 * - Twi is an additional language option, NOT a replacement for ElevenLabs.
 * - Plays Twi speech via Web Audio through Sentinel's output gain & analyser (animates Voice Orb).
 * - Mutes microphone while Sentinel speaks so it never hears itself.
 * - Unmutes microphone 350ms after speaking finishes so astronaut can reply.
 * - If anything in the Twi path fails or times out (~10s), falls back to English ElevenLabs.
 * - Critical medical/safety alerts ALWAYS also play in English via ElevenLabs.
 * - Dual-language subtitles: shows both Twi and English in Twi mode.
 */

import { emit } from "../core/bus.js";
import { audioContext } from "../core/sound.js";

const STORAGE_KEY = "sentinel_voice_language";
const TIMEOUT_MS = 10000;

let twiQueue = [];
let twiPlaying = null;
let twiGen = 0;
let isPumpRunning = false;

/**
 * Get current persisted language ("en" or "tw"). Default is "en".
 */
export function getLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "en";
  } catch {
    return "en";
  }
}

/**
 * Persist language selection ("en" or "tw").
 */
export function setLanguage(lang) {
  const clean = lang === "tw" ? "tw" : "en";
  try {
    localStorage.setItem(STORAGE_KEY, clean);
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    window.language = clean;
    window.__sentinelLanguage = clean;
    globalThis.language = clean;
    window.dispatchEvent(new CustomEvent("sentinel:language-change", { detail: clean }));
  }
  return clean;
}

// Initialize global language state
if (typeof window !== "undefined") {
  window.language = getLanguage();
  window.__sentinelLanguage = window.language;
  globalThis.language = window.language;
  window.setSentinelLanguage = setLanguage;
}

/**
 * Helper to convert Base64 Data URL to ArrayBuffer for Web Audio decoding.
 */
function base64ToArrayBuffer(base64Data) {
  let b64 = base64Data;
  if (b64.includes(",")) b64 = b64.split(",")[1];
  const binaryString = atob(b64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Safe fetch helper that queries Sentinel's /api/twi endpoints.
 */
async function apiFetch(endpoint, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const candidates = [
    endpoint,
    `http://localhost:3001${endpoint}`,
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      lastError = err;
      if (err.name === "AbortError") {
        clearTimeout(timer);
        throw new Error(`Twi service timed out after ${timeoutMs}ms`);
      }
    }
  }

  clearTimeout(timer);
  throw lastError || new Error(`Failed to reach Twi API at ${endpoint}`);
}

/**
 * Detect whether a message is a critical medical or safety alert.
 */
function isCriticalAlert(text, options = {}) {
  if (options.is_critical || options.isCritical) return true;
  if (options.source === "alert" || options.source === "urgent") return true;

  const lower = (text || "").toLowerCase();
  const criticalWords = [
    "critical",
    "emergency",
    "radiation shelter",
    "solar particle",
    "hypoxia",
    "heart rate critical",
    "cabin leak",
    "suit leak",
    "decompression",
    "toxic",
    "cardiac arrest",
    "loss of consciousness",
  ];
  return criticalWords.some((word) => lower.includes(word));
}

/**
 * Render dual-language subtitles (Twi and English) in the UI.
 */
function displayDualCaption(twiText, englishText, source = "") {
  if (typeof document === "undefined") return;

  const captionEl = document.getElementById("caption");
  if (captionEl) {
    captionEl.innerHTML = `
      <div class="twi-dual-caption" style="display:flex; flex-direction:column; gap:4px;">
        <span class="twi-primary" style="font-weight:600; color:var(--text, #e2e8f0); font-size:1.05em;">${escHtml(twiText || "")}</span>
        <span class="twi-secondary" style="font-size:0.85em; opacity:0.75; color:var(--text-muted, #94a3b8); font-style:italic;">${escHtml(englishText || "")}</span>
      </div>
    `;
    captionEl.classList.add("is-caption");
  }

  // Also update transcript if available
  const transcriptEl = document.getElementById("transcript");
  if (transcriptEl && (twiText || englishText)) {
    const li = document.createElement("li");
    li.className = "sentinel twi-spoken";
    li.innerHTML = `
      <span class="who">Sentinel ${source ? `<span class="src">${escHtml(source)} [Twi]</span>` : "<span class=\"src\">[Twi]</span>"}</span>
      <span class="msg">
        <strong>${escHtml(twiText || "")}</strong><br>
        <small style="opacity:0.75; font-style:italic;">${escHtml(englishText || "")}</small>
      </span>
    `;
    transcriptEl.appendChild(li);
    while (transcriptEl.children.length > 40) transcriptEl.removeChild(transcriptEl.firstChild);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Stop any ongoing Twi speech immediately and flush the queue.
 */
export function stopSpeakingTwi() {
  twiGen++;
  twiQueue.forEach((job) => job.resolve?.());
  twiQueue = [];

  if (twiPlaying?.src) {
    try {
      twiPlaying.src.onended = null;
      twiPlaying.src.stop();
    } catch {
      // already stopped
    }
    twiPlaying = null;
  }

  if (window.__voice) window.__voice.speaking = false;
  emit("voice:speak-level", 0);
  emit("voice:speaking-end");

  if (typeof window.__resumeListening === "function") {
    try { window.__resumeListening(); } catch {}
  }
}

/**
 * Pump the Twi queue sequentially: translates & synthesizes via Khaya,
 * plays through Sentinel's Web Audio output chain, mutes mic while speaking,
 * animates Voice Orb, and unmutes mic after playback finishes.
 */
async function pumpTwi() {
  if (isPumpRunning || !twiQueue.length) return;
  isPumpRunning = true;
  const myGen = twiGen;

  try {
    while (twiQueue.length && myGen === twiGen) {
      const job = twiQueue.shift();

      if (!window.__voice?.speaking) {
        if (window.__voice) window.__voice.speaking = true;
        if (typeof window.__pauseListening === "function") {
          try { window.__pauseListening(); } catch {}
        }
        emit("voice:speaking-start", job.text);
      }

      let result = null;
      try {
        result = await job.fetchPromise;
      } catch (err) {
        console.warn("[twi] Speech fetch error:", err.message);
      }

      if (myGen !== twiGen) {
        job.resolve?.();
        return;
      }

      if (result && (result.ok || result.twi_text)) {
        const twiSpoken = result.twi_text || job.text;
        // 1. Display dual captions
        displayDualCaption(twiSpoken, job.text, job.options?.source);
        emit("voice:sentence", twiSpoken);

        // 2. Play audio buffer through Sentinel's master audio chain & analyser
        if (result.audio) {
          const ctx = (typeof window.__outChain === "function" ? window.__outChain() : null) || audioContext();
          if (ctx) {
            if (ctx.state === "suspended") {
              try { await ctx.resume(); } catch {}
            }
            if (myGen !== twiGen) {
              job.resolve?.();
              return;
            }

            try {
              const arrayBuf = base64ToArrayBuffer(result.audio);
              const audioBuffer = await ctx.decodeAudioData(arrayBuf);

              await new Promise((res) => {
                const src = ctx.createBufferSource();
                src.buffer = audioBuffer;

                let outNode = ctx.destination;
                if (typeof window.__getOutGain === "function") {
                  const g = window.__getOutGain();
                  if (g) outNode = g;
                }

                src.connect(outNode);
                twiPlaying = { src, job };

                src.onended = () => {
                  twiPlaying = null;
                  res();
                };

                if (typeof window.__startLevel === "function") {
                  try { window.__startLevel(); } catch {}
                }
                src.start(0);

                const maxDur = (audioBuffer.duration || 5) * 1000 + 2500;
                setTimeout(() => {
                  if (twiPlaying?.src === src) {
                    twiPlaying = null;
                    res();
                  }
                }, maxDur);
              });
            } catch (audioErr) {
              console.warn("[twi] Web Audio decode failed:", audioErr.message);
              // Fallback to browser SpeechSynthesis for Twi
              if (typeof window !== "undefined" && window.speechSynthesis) {
                const utt = new SpeechSynthesisUtterance(twiSpoken);
                utt.rate = 0.95;
                window.speechSynthesis.speak(utt);
              }
            }
          }
        } else if (typeof window !== "undefined" && window.speechSynthesis) {
          // Khaya TTS offline: use browser SpeechSynthesis speaking Twi text
          const utt = new SpeechSynthesisUtterance(twiSpoken);
          utt.rate = 0.95;
          window.speechSynthesis.speak(utt);
        }
      } else {
        // Fallback: display dual caption with job text
        displayDualCaption(job.text, job.text, job.options?.source);
        if (typeof job.options?.fallback === "function") {
          console.warn("[twi fallback] Falling back to ElevenLabs English voice for:", job.text);
          await job.options.fallback();
        }
      }

      // Safety requirement: Critical alerts ALWAYS also play in English via ElevenLabs
      if (job.isCritical && typeof job.options?.fallback === "function") {
        console.warn("[twi safety] Critical alert triggered: playing English ElevenLabs secondary announcement.");
        await job.options.fallback();
      }

      job.resolve?.();
    }

    if (myGen === twiGen) {
      if (window.__voice) window.__voice.speaking = false;
      emit("voice:speak-level", 0);
      emit("voice:speaking-end");

      // Unmute microphone after short room echo dissipation delay (350ms)
      setTimeout(() => {
        if (typeof window.__resumeListening === "function") {
          try { window.__resumeListening(); } catch {}
        }
      }, 350);
    }
  } finally {
    isPumpRunning = false;
  }
}

/**
 * Speak English text in Twi using Khaya AI with queuing and ElevenLabs fallback.
 *
 * @param {string} englishText - English text from Sentinel's brain or reasoning.
 * @param {object} options - { interrupt, source, fallback, is_critical }
 * @returns {Promise<void>}
 */
export function speakTwi(englishText, options = {}) {
  if (!englishText || !englishText.trim()) return Promise.resolve();

  const isInterrupt = options.interrupt !== false;
  if (isInterrupt) {
    stopSpeakingTwi();
  }

  const isCritical = isCriticalAlert(englishText, options);

  // Split into sentences for fast incremental playback if long
  const parts = String(englishText).split(/(?<=[.!?]["')\]]*)\s+(?=[A-Z0-9"'])/);
  const chunks = englishText.length < 160 ? [englishText] : parts.map((p) => p.trim()).filter(Boolean);

  return new Promise((resolve, reject) => {
    chunks.forEach((chunk, idx) => {
      const fetchPromise = apiFetch("/api/twi/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chunk,
          speaker: options.speaker || "female",
          is_critical: isCritical,
        }),
      }, TIMEOUT_MS);

      const job = {
        text: chunk,
        options,
        isCritical,
        fetchPromise,
        resolve: idx === chunks.length - 1 ? resolve : () => {},
        reject: idx === chunks.length - 1 ? reject : () => {},
      };
      twiQueue.push(job);
    });

    pumpTwi();
  });
}

/**
 * Capture microphone audio from user, send to /api/twi/listen, and return English text for Sentinel.
 *
 * @param {Blob|ArrayBuffer} audioData - recorded audio
 * @param {string} mimeType - e.g. "audio/wav" or "audio/webm"
 * @returns {Promise<{ englishText: string, twiText: string }>}
 */
export async function listenTwi(audioData, mimeType = "audio/wav") {
  let base64Audio = "";
  if (audioData instanceof Blob) {
    base64Audio = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(audioData);
    });
  } else if (audioData instanceof ArrayBuffer) {
    let binary = "";
    const bytes = new Uint8Array(audioData);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64Audio = `data:${mimeType};base64,${btoa(binary)}`;
  }

  const result = await apiFetch("/api/twi/listen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio: base64Audio,
      mimeType,
    }),
  }, TIMEOUT_MS);

  if (result && result.ok) {
    return {
      englishText: result.eng_text || "",
      twiText: result.twi_text || "",
    };
  }

  throw new Error(result?.error || "Khaya speech recognition failed");
}

if (typeof window !== "undefined") {
  window.speakTwi = speakTwi;
  window.listenTwi = listenTwi;
  window.stopSpeakingTwi = stopSpeakingTwi;
}
