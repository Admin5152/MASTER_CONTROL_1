/**
 * Khaya AI (GhanaNLP) integration for Sentinel.
 * Provides Twi ASR (speech-to-text), Neural Machine Translation, and TTS (text-to-speech).
 *
 * Security rules:
 * - KHAYA_KEY and KHAYA_KEY_SECONDARY are loaded from environment variables (.env).
 * - Keys are NEVER logged, printed, or exposed to the client.
 * - On 401/403 errors, automatically retries once with the secondary key.
 * - On 400 errors, logs response `error.details` (names the exact bad field) without logging secrets.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Zero-dependency .env loader: services/twi/.env, then the project's .env
function loadLocalEnv() {
  const envPaths = [
    path.resolve(__dirname, ".env"),
    path.resolve(__dirname, "../../.env"),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf-8");
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }
}
loadLocalEnv();

const KHAYA_BASE_URL = "https://translation-api.ghananlp.org";
const DEFAULT_TIMEOUT_MS = 10000;

// Disk cache directory for fixed phrases and generated TTS audio
const CACHE_DIR = path.resolve(__dirname, "../../data/twi_tts_cache");
if (!fs.existsSync(CACHE_DIR)) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (err) {
    console.warn("[khaya] Failed to create TTS cache directory:", err.message);
  }
}

// In-memory cache for fast lookups
const memoryCache = new Map();

// The Khaya plan has a call allowance per key. When it runs out Khaya answers 403 "Out of call volume quota.
// Quota will be replenished in 1.00:33:17" (days.hh:mm:ss). Such a key rests until then: no call is made with it,
// so Sentinel falls back at once instead of spending seconds on a refusal for every sentence.
const resting = { primary: 0, secondary: 0 };

function keyFor(slot) {
  return (slot === "secondary" ? process.env.KHAYA_KEY_SECONDARY : process.env.KHAYA_KEY) || "";
}

function parseReplenish(msg) {
  const m = /replenished in (?:(\d+)\.)?(\d+):(\d+):(\d+)/i.exec(msg || "");
  if (!m) return 15 * 60 * 1000;
  const [d, h, mi, se] = [m[1] || 0, m[2], m[3], m[4]].map(Number);
  return (((d * 24 + h) * 60 + mi) * 60 + se) * 1000;
}

/** When Twi voice is available again (ms since epoch), or 0 if a key can be used now. */
function restingUntil() {
  const now = Date.now();
  const usable = ["primary", "secondary"].filter((k) => keyFor(k) && resting[k] <= now);
  if (usable.length) return 0;
  const times = ["primary", "secondary"].filter((k) => keyFor(k)).map((k) => resting[k]);
  return times.length ? Math.min(...times) : 0;
}

class KhayaQuotaError extends Error {
  constructor(until) {
    super(`Khaya call allowance used up; available again ${new Date(until).toISOString()}`);
    this.quota = true;
    this.until = until;
  }
}

/**
 * Execute an HTTP request to the Khaya API. Uses the primary key, then the secondary if the primary is refused or
 * resting. Throws KhayaQuotaError at once when both keys are resting.
 */
async function khayaFetch(endpoint, options = {}, isBinary = false, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const slots = ["primary", "secondary"].filter((k) => keyFor(k));
  if (!slots.length) throw new Error("Khaya API key is missing. Set KHAYA_KEY in .env");
  const url = endpoint.startsWith("http") ? endpoint : `${KHAYA_BASE_URL}${endpoint}`;
  let lastErr = null;

  for (const slot of slots) {
    if (resting[slot] > Date.now()) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), "Ocp-Apim-Subscription-Key": keyFor(slot) },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") throw new Error(`Khaya operation on ${endpoint} timed out after ${timeoutMs}ms`);
      throw err;
    }
    clearTimeout(timeout);

    if (response.status === 401 || response.status === 403) {
      const text = await response.text().catch(() => "");
      if (/quota/i.test(text)) {
        resting[slot] = Date.now() + parseReplenish(text);
        console.warn(`[khaya] ${slot} key: call allowance used up, resting until ${new Date(resting[slot]).toLocaleString()}`);
      } else {
        resting[slot] = Date.now() + 30 * 60 * 1000;   // a refused key: try again in half an hour
        console.warn(`[khaya] ${slot} key refused (${response.status}); resting 30 min`);
      }
      lastErr = new Error(`Khaya refused the ${slot} key (${response.status}): ${text.slice(0, 120)}`);
      continue;
    }

    if (response.status === 400) {
      let errDetails = "Bad Request (400)";
      try {
        const errJson = await response.json();
        errDetails = JSON.stringify(errJson.error?.details || errJson.details || errJson);
      } catch {
        // not json
      }
      console.error(`[khaya] 400 Client Error on ${endpoint}:`, errDetails);
      throw new Error(`Khaya 400 validation error: ${errDetails}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Khaya API error ${response.status}: ${text.slice(0, 200)}`);
    }

    if (isBinary) return Buffer.from(await response.arrayBuffer());
    return await response.json();
  }

  const until = restingUntil();
  if (until) throw new KhayaQuotaError(until);
  throw lastErr || new Error("Khaya unavailable");
}

// Translations are cached in memory and on disk: Sentinel repeats many lines, and every call counts against the quota.
const TRANSLATION_FILE = path.join(CACHE_DIR, "translations.json");
let translationCache = {};
try {
  translationCache = JSON.parse(fs.readFileSync(TRANSLATION_FILE, "utf-8"));
} catch {
  translationCache = {};
}
let translationSaveTimer = null;
function saveTranslations() {
  clearTimeout(translationSaveTimer);
  translationSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(TRANSLATION_FILE, JSON.stringify(translationCache)); } catch {}
  }, 500);
}

/**
 * Health check: verify "twi" availability in ASR v3, Translation v2, and TTS v2.
 */
let healthCache = null;   // { at, result }: the check costs three calls, so it runs at most every 30 minutes

async function checkHealth() {
  const until = restingUntil();
  if (until) {
    return { ok: false, resting_until: new Date(until).toISOString(), twi_supported: { asr: false, translation: false, tts: false },
             details: { reason: "Khaya call allowance used up" } };
  }
  if (healthCache && Date.now() - healthCache.at < 30 * 60 * 1000) return healthCache.result;
  const result = {
    ok: false,
    twi_supported: {
      asr: false,
      translation: false,
      tts: false,
    },
    details: {},
  };

  try {
    // 1. ASR languages
    const asrData = await khayaFetch("/asr/v3/languages", { method: "GET" });
    const asrLangs = asrData.languages || [];
    const hasTwiAsr = asrLangs.some((l) => (typeof l === "string" ? l === "twi" : (l.code === "twi" || l.code === "tw")));
    result.twi_supported.asr = hasTwiAsr;
    result.details.asr_languages = asrLangs.map((l) => (typeof l === "string" ? l : `${l.name} (${l.code})`));
  } catch (err) {
    result.details.asr_error = err.message;
  }

  try {
    // 2. Translation languages
    const transData = await khayaFetch("/v2/languages", { method: "GET" });
    const transLangs = transData.languages || transData;
    const hasTwiTrans = Boolean(transLangs && (transLangs.twi || "twi" in transLangs));
    result.twi_supported.translation = hasTwiTrans;
    result.details.translation_languages = transLangs;
  } catch (err) {
    result.details.translation_error = err.message;
  }

  try {
    // 3. TTS speakers
    const ttsData = await khayaFetch("/tts/v2/speakers", { method: "GET" });
    const speakers = ttsData.speakers || ttsData;
    result.details.tts_speakers = speakers;
    result.twi_supported.tts = true; // Multilingual speakers support Twi
  } catch (err) {
    result.details.tts_error = err.message;
  }

  result.ok = result.twi_supported.asr && result.twi_supported.translation && result.twi_supported.tts;
  if (restingUntil()) result.resting_until = new Date(restingUntil()).toISOString();
  else healthCache = { at: Date.now(), result };
  return result;
}

/**
 * Translate text between English and Twi (or other supported languages).
 *
 * Confirmed working schema:
 * POST /v2/translate
 * Body: { text: "...", source_language: "eng", target_language: "twi" }
 * (Also accepts legacy: { in: "...", lang: "eng-twi" })
 *
 * @param {string} text - text to translate
 * @param {string} sourceLanguage - e.g. "eng" or "twi"
 * @param {string} targetLanguage - e.g. "twi" or "eng"
 * @returns {Promise<string>} translated text
 */
async function translate(text, sourceLanguage = "eng", targetLanguage = "twi") {
  if (!text || typeof text !== "string" || !text.trim()) {
    return "";
  }

  const cleanText = text.trim();

  // Normalize language codes to ISO 639-3 ("eng", "twi")
  const src = sourceLanguage === "en" ? "eng" : sourceLanguage === "tw" ? "twi" : sourceLanguage;
  const tgt = targetLanguage === "en" ? "eng" : targetLanguage === "tw" ? "twi" : targetLanguage;

  if (src === tgt) {
    return cleanText;
  }

  const ck = `${src}>${tgt}:${cleanText.toLowerCase().replace(/\s+/g, " ")}`;
  if (translationCache[ck]) return translationCache[ck];

  const payload = {
    text: cleanText,
    source_language: src,
    target_language: tgt,
  };

  const result = await khayaFetch("/v2/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const out = result.text || "";
  if (out) { translationCache[ck] = out; saveTranslations(); }
  return out;
}

/**
 * Generate a cache key for TTS text and speaker.
 */
function getCacheKey(text, speaker = "female") {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("md5").update(`${norm}:${speaker}`).digest("hex");
}

/**
 * Synthesize Twi speech from text using Khaya TTS v2.
 * Includes disk & in-memory caching for repeated phrases.
 *
 * Confirmed working schema:
 * POST /tts/v2/synthesize
 * Body: { text: "...", language: "twi", speaker: "female" }
 * (Accepts speaker: "female", "male_low", "male_high")
 * Returns: binary audio/wav Buffer
 *
 * @param {string} text - Twi text to synthesize
 * @param {string} speaker - "female", "male_low", or "male_high"
 * @returns {Promise<Buffer>} audio/wav buffer
 */
async function synthesize(text, speaker = "female") {
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("Text is required for speech synthesis");
  }

  const cleanText = text.trim();
  const cacheKey = getCacheKey(cleanText, speaker);

  // 1. Check in-memory cache
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  // 2. Check disk cache
  const cacheFilePath = path.join(CACHE_DIR, `${cacheKey}.wav`);
  if (fs.existsSync(cacheFilePath)) {
    try {
      const cachedBuffer = ensureWavFormat(fs.readFileSync(cacheFilePath));
      memoryCache.set(cacheKey, cachedBuffer);
      return cachedBuffer;
    } catch {
      // Disk read error, proceed to fetch
    }
  }

  // 3. Call Khaya TTS v2 API
  const payload = {
    text: cleanText,
    language: "twi",
    speaker: speaker || "female",
  };

  const rawAudio = await khayaFetch(
    "/tts/v2/synthesize",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    true // binary output
  );

  const audioBuffer = ensureWavFormat(rawAudio);

  // 4. Cache audio in memory and on disk
  memoryCache.set(cacheKey, audioBuffer);
  try {
    fs.writeFileSync(cacheFilePath, audioBuffer);
  } catch (err) {
    console.warn("[khaya] Failed to write audio cache file:", err.message);
  }

  return audioBuffer;
}

/**
 * Ensure audio buffer has valid WAV header (converts float32 to PCM16, or wraps raw PCM).
 */
function ensureWavFormat(audioBuffer) {
  if (!audioBuffer || !audioBuffer.length) return audioBuffer;

  // Check for RIFF WAV header
  if (audioBuffer.length > 12 && audioBuffer.subarray(0, 4).toString() === "RIFF" && audioBuffer.subarray(8, 12).toString() === "WAVE") {
    let pos = 12;
    let fmtTag = 1, channels = 1, sampleRate = 16000, bitsPerSample = 16;
    let dataOffset = -1, dataLen = 0;

    while (pos + 8 <= audioBuffer.length) {
      const chunkId = audioBuffer.subarray(pos, pos + 4).toString();
      const chunkSize = audioBuffer.readUInt32LE(pos + 4);
      if (chunkId === "fmt ") {
        fmtTag = audioBuffer.readUInt16LE(pos + 8);
        channels = audioBuffer.readUInt16LE(pos + 10);
        sampleRate = audioBuffer.readUInt32LE(pos + 12);
        bitsPerSample = audioBuffer.readUInt16LE(pos + 22);
      } else if (chunkId === "data") {
        dataOffset = pos + 8;
        dataLen = Math.min(chunkSize, audioBuffer.length - dataOffset);
        break;
      }
      pos += 8 + chunkSize;
    }

    // Convert 32-bit IEEE float to standard 16-bit PCM for universal browser support
    if (fmtTag === 3 && bitsPerSample === 32 && dataOffset > 0) {
      const numSamples = Math.floor(dataLen / 4);
      const pcm16Data = Buffer.alloc(numSamples * 2);
      for (let i = 0; i < numSamples; i++) {
        const floatVal = audioBuffer.readFloatLE(dataOffset + i * 4);
        const clamped = Math.max(-1.0, Math.min(1.0, floatVal));
        const int16 = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF);
        pcm16Data.writeInt16LE(int16, i * 2);
      }

      const outHeader = Buffer.alloc(44);
      const byteRate = sampleRate * channels * 2;
      const blockAlign = channels * 2;
      outHeader.write("RIFF", 0);
      outHeader.writeUInt32LE(36 + pcm16Data.length, 4);
      outHeader.write("WAVE", 8);
      outHeader.write("fmt ", 12);
      outHeader.writeUInt32LE(16, 16);
      outHeader.writeUInt16LE(1, 20); // PCM
      outHeader.writeUInt16LE(channels, 22);
      outHeader.writeUInt32LE(sampleRate, 24);
      outHeader.writeUInt32LE(byteRate, 28);
      outHeader.writeUInt16LE(blockAlign, 32);
      outHeader.writeUInt16LE(16, 34); // 16-bit
      outHeader.write("data", 36);
      outHeader.writeUInt32LE(pcm16Data.length, 40);

      return Buffer.concat([outHeader, pcm16Data]);
    }

    return audioBuffer;
  }

  // If raw PCM, prepend standard 44-byte WAV header (16kHz 16-bit mono)
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = audioBuffer.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, audioBuffer]);
}

/**
 * Transcribe spoken Twi audio into text using Khaya ASR v3.
 *
 * Confirmed working schema:
 * POST /asr/v3/transcribe?language=twi
 * Header: Content-Type: audio/wav (or audio/mpeg)
 * Body: binary audio buffer
 * Returns: { text: "..." }
 *
 * @param {Buffer} audioBuffer - raw audio file buffer (WAV/MP3/OGG)
 * @param {string} mimeType - mime type e.g. "audio/wav"
 * @param {string} language - language code (default "twi")
 * @returns {Promise<string>} transcribed text
 */
async function transcribe(audioBuffer, mimeType = "audio/wav", language = "twi") {
  if (!audioBuffer || !audioBuffer.length) {
    throw new Error("Audio buffer is required for transcription");
  }

  const cleanBuffer = ensureWavFormat(audioBuffer);
  const endpoint = `/asr/v3/transcribe?language=${encodeURIComponent(language)}`;

  const result = await khayaFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "audio/wav",
    },
    body: cleanBuffer,
  });

  return result.text || "";
}

/**
 * Pre-warm the cache with Sentinel's standard fixed phrases.
 */
async function prewarmCache() {
  const fixedPhrases = [
    "Akwaaba. Me ne Sentinel.",
    "Mɛtumi aboa wo sɛn nnɛ?",
    "Nom nsuo bi na gye w'ahome.",
    "Wo ho te sɛn?",
    "Kɔda kakra.",
    "Bere a wode bɛkɔ mu no.",
  ];

  for (const phrase of fixedPhrases) {
    try {
      await synthesize(phrase, "female");
    } catch {
      // Non-fatal if offline
    }
  }
}

module.exports = {
  restingUntil,
  translate,
  synthesize,
  transcribe,
  checkHealth,
  prewarmCache,
  getCacheKey,
  ensureWavFormat,
};
