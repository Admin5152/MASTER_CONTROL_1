/**
 * Express router and standalone HTTP handler for Sentinel Twi Voice routes (/api/twi/*).
 *
 * Endpoints:
 * - GET  /api/twi/health    Verifies "twi" availability in ASR v3, Translation v2, and TTS v2.
 * - POST /api/twi/listen    Receive audio (WAV/MP3/WebM), transcribe with Khaya ASR, translate twi->eng.
 * - POST /api/twi/speak     Receive English text, translate eng->twi, synthesize with Khaya TTS.
 * - POST /api/twi/translate Direct translation endpoint (eng<->twi).
 *
 * Safety & Reliability Rules:
 * - 10-second timeout on Khaya calls: if exceeded, gracefully returns a fallback payload so English ElevenLabs plays.
 * - Never crashes the server or leaves the caller hanging.
 * - Critical alerts are flagged so the client can double-speak in English via ElevenLabs.
 */

const { translate, synthesize, transcribe, checkHealth, restingUntil, LANGUAGES } = require("../khaya");

/** The Khaya language for this request: ?lang= or body.lang, one of LANGUAGES; Twi when not given. */
function langOf(req) {
  let q = "";
  try { q = new URL(req.url || "", "http://x").searchParams.get("lang") || ""; } catch {}
  const l = String((req.body && !Buffer.isBuffer(req.body) && req.body.lang) || q || "twi").toLowerCase();
  return LANGUAGES[l] ? l : "twi";
}

// Twi spelling uses the letters ɛ and ɔ, which English never does: such a line is already Twi and is not translated
const looksTwi = (t) => /[ɛɔƐƆ]/.test(t || "");
const { getFastPathTwi, TWI_SYSTEM_RULES, translateEnglishToTwi } = require("../twi_rules");

const TIMEOUT_MS = 10000;

/**
 * Wraps a promise with a timeout.
 */
function withTimeout(promise, ms, operationName = "Khaya operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Handle GET /api/twi/health
 * Calls ASR, Translation, and TTS languages/speakers endpoints to verify Twi support.
 */
async function handleHealth(req, res) {
  try {
    const health = await withTimeout(checkHealth(), TIMEOUT_MS, "Health check");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: false,
      error: err.message,
      twi_supported: { asr: false, translation: false, tts: false },
    }));
  }
}

/**
 * Handle POST /api/twi/listen
 * Expects audio data either as raw binary, or JSON { audio: "<base64>", mimeType: "audio/wav" }.
 */
async function handleListen(req, res) {
  try {
    let audioBuffer = null;
    let mimeType = "audio/wav";

    // If body is already a buffer (raw body parser)
    if (Buffer.isBuffer(req.body)) {
      audioBuffer = req.body;
      mimeType = req.headers["content-type"] || "audio/wav";
    } else if (req.body && typeof req.body === "object") {
      // JSON body with base64 audio
      if (req.body.audio) {
        let b64 = req.body.audio;
        if (b64.includes(",")) {
          b64 = b64.split(",")[1];
        }
        audioBuffer = Buffer.from(b64, "base64");
      }
      if (req.body.mimeType) {
        mimeType = req.body.mimeType;
      }
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "No audio data received" }));
      return;
    }

    // Step 1: Transcribe Twi speech to text
    const lang = langOf(req);
    const twiText = await withTimeout(
      transcribe(audioBuffer, mimeType, lang),
      TIMEOUT_MS,
      "Twi ASR"
    );

    if (!twiText || !twiText.trim()) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, twi_text: "", eng_text: "" }));
      return;
    }

    // Step 2: Translate Twi text to English for Sentinel's existing logic
    const engText = await withTimeout(
      translate(twiText, lang, "eng"),
      TIMEOUT_MS,
      "Twi->English translation"
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      lang,
      text: twiText,          // what was said, in the language
      twi_text: twiText,      // the same (kept for older clients)
      eng_text: engText,
    }));
  } catch (err) {
    console.error("[twi route] Error in /api/twi/listen:", err.message);
    // Graceful fallback response: never crash, flag fallback
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: false,
      fallback: true,
      error: err.message,
      twi_text: "",
      eng_text: "",
    }));
  }
}

/**
 * Handle POST /api/twi/speak
 * Expects JSON: { text: "English advice", speaker?: "female", is_critical?: boolean }
 */
async function handleSpeak(req, res) {
  try {
    const body = req.body || {};
    const text = body.text || "";
    const speaker = body.speaker || "female";
    const isCritical = Boolean(body.is_critical);

    if (!text || !text.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Text is required" }));
      return;
    }

    // Step 1: Translate Sentinel's English text to Twi (fast-path rules or Khaya API)
    // Already Twi: spoken as it is. An exact known phrase: its fixed Twi (no call). Anything else: Khaya translates the
    // whole reply (the loose patterns in twi_rules matched part of a reply and dropped the rest, so they are now only
    // the offline fallback).
    const lang = langOf(req);
    const isTwi = lang === "twi";
    const exact = isTwi ? TWI_SYSTEM_RULES.phrases?.[text.trim().toLowerCase().replace(/[.,!?;:]/g, "")] : null;
    let twiText = (isTwi && looksTwi(text)) || body.already_translated ? text.trim() : (exact || null);
    if (!twiText) {
      try {
        twiText = await withTimeout(
          translate(text, "eng", lang),
          TIMEOUT_MS,
          "English->Twi translation"
        );
      } catch (trErr) {
        console.warn("[twi speak] Khaya translation failed, using rule translation:", trErr.message);
        twiText = isTwi ? translateEnglishToTwi(text) : text;   // offline: Twi phrase rules, or the English as it is
      }
    }
    if (!twiText) twiText = isTwi ? translateEnglishToTwi(text) : text;

    // Step 2: Synthesize Twi speech via Khaya TTS (or graceful fallback)
    let audioBuffer = null;
    try {
      audioBuffer = await withTimeout(
        synthesize(twiText, speaker, lang),
        TIMEOUT_MS,
        "Twi TTS"
      );
    } catch (ttsErr) {
      console.warn("[twi speak] Khaya TTS failed, returning Twi text for speech/caption:", ttsErr.message);
    }

    const base64Audio = audioBuffer ? `data:audio/wav;base64,${audioBuffer.toString("base64")}` : "";

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      lang,
      eng_text: text,
      text: twiText,          // the reply in the language
      twi_text: twiText,      // the same (kept for older clients)
      audio: base64Audio,
      is_critical: isCritical,
      resting_until: restingUntil() ? new Date(restingUntil()).toISOString() : null,
    }));
  } catch (err) {
    console.error("[twi route] Error in /api/twi/speak:", err.message);
    const twiFallback = translateEnglishToTwi(req.body?.text || "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      fallback: true,
      error: err.message,
      eng_text: req.body?.text || "",
      twi_text: twiFallback,
      audio: "",
      is_critical: Boolean(req.body?.is_critical),
    }));
  }
}

/**
 * Handle POST /api/twi/translate
 * Expects JSON: { text: "...", source: "eng", target: "twi" }
 */
async function handleTranslate(req, res) {
  try {
    const body = req.body || {};
    const text = body.text || "";
    const source = body.source || "eng";
    const target = body.target || "twi";

    if (!text || !text.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Text is required" }));
      return;
    }

    const translated = await withTimeout(
      translate(text, source, target),
      TIMEOUT_MS,
      "Translation"
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      text: translated,
      source,
      target,
    }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

/**
 * Standalone request dispatcher compatible with Node's http.createServer,
 * Express, or Connect middleware.
 */
function handleTwiRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Ocp-Apim-Subscription-Key");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  const url = req.url || "";

  if (url === "/api/twi/health" && req.method === "GET") {
    handleHealth(req, res);
    return true;
  }

  if (url === "/api/twi/languages" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ languages: Object.entries(LANGUAGES).map(([code, name]) => ({ code, name })), english: "eng" }));
    return true;
  }

  if (url === "/api/twi/rules" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(TWI_SYSTEM_RULES));
    return true;
  }

  if (url.startsWith("/api/twi/listen") && req.method === "POST") {
    parseBody(req, () => handleListen(req, res));
    return true;
  }

  if (url.startsWith("/api/twi/speak") && req.method === "POST") {
    parseBody(req, () => handleSpeak(req, res));
    return true;
  }

  if (url.startsWith("/api/twi/translate") && req.method === "POST") {
    parseBody(req, () => handleTranslate(req, res));
    return true;
  }

  return false;
}

/**
 * Helper to parse JSON or binary body for standalone HTTP servers.
 */
function parseBody(req, callback) {
  if (req.body) {
    callback();
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("application/json")) {
      try {
        req.body = JSON.parse(raw.toString("utf-8"));
      } catch {
        req.body = {};
      }
    } else {
      req.body = raw;
    }
    callback();
  });
}

/**
 * Express router factory (if Express is mounted).
 */
function createExpressRouter() {
  try {
    const express = require("express");
    const router = express.Router();

    router.use(express.json({ limit: "25mb" }));
    router.use(express.raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }));

    router.get("/health", handleHealth);
    router.post("/listen", handleListen);
    router.post("/speak", handleSpeak);
    router.post("/translate", handleTranslate);

    return router;
  } catch {
    return null;
  }
}

module.exports = {
  handleTwiRequest,
  createExpressRouter,
  handleHealth,
  handleListen,
  handleSpeak,
  handleTranslate,
};
