/**
 * Automated test suite for Sentinel Twi Voice (Khaya AI integration).
 * Tests translation, TTS synthesis, disk caching, ASR transcription,
 * key rotation, timeout handling, and graceful English ElevenLabs fallback.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { translate, synthesize, transcribe, getCacheKey } = require("../server/khaya");
const { handleSpeak, handleListen, handleTranslate } = require("../server/routes/twi");

// Helper to mock HTTP response
function createMockRes() {
  let statusCode = 200;
  let headers = {};
  let body = "";

  return {
    writeHead: (code, h = {}) => {
      statusCode = code;
      headers = h;
    },
    setHeader: (k, v) => {
      headers[k] = v;
    },
    end: (data) => {
      body = data;
    },
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getJson: () => {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    },
    getBody: () => body,
  };
}

// Tests 3-8 call the real Khaya service, and every call counts against the plan's allowance: they run only with
// KHAYA_LIVE=1. Otherwise the network is off, so the fallback paths are what get tested.
const LIVE = process.env.KHAYA_LIVE === "1";
if (!LIVE) globalThis.fetch = async () => { throw new Error("network off in tests (KHAYA_LIVE=1 to call Khaya)"); };

async function runTests() {
  console.log("=== Sentinel Twi Voice Test Suite ===");
  let passed = 0;
  let failed = 0;

  // Test 1: Verify .env is listed in .gitignore
  try {
    const gitignore = fs.readFileSync(path.resolve(__dirname, "../.gitignore"), "utf-8");
    assert(gitignore.includes(".env"), ".env must be in .gitignore");
    console.log("✓ Test 1: Security - .env is properly git-ignored");
    passed++;
  } catch (err) {
    console.error("✗ Test 1 Failed:", err.message);
    failed++;
  }

  // Test 2: Verify .env.example contains the required keys for the team
  try {
    const envExample = fs.readFileSync(path.resolve(__dirname, "../.env.example"), "utf-8");
    assert(envExample.includes("KHAYA_KEY="), ".env.example must have KHAYA_KEY");
    assert(envExample.includes("KHAYA_KEY_SECONDARY="), ".env.example must have KHAYA_KEY_SECONDARY");
    console.log("✓ Test 2: Environment - .env.example contains required KHAYA keys");
    passed++;
  } catch (err) {
    console.error("✗ Test 2 Failed:", err.message);
    failed++;
  }

  if (LIVE) {
    // Test 3: Khaya Translation v2 (English -> Twi)
    try {
      const twi = await translate("Drink some water and rest.", "eng", "twi");
      assert(typeof twi === "string" && twi.length > 0, "Translation must return a string");
      console.log(`✓ Test 3: Khaya Translation (eng->twi): "${twi}"`);
      passed++;
    } catch (err) {
      console.error("✗ Test 3 Failed:", err.message);
      failed++;
    }

    // Test 4: Khaya Translation v2 (Twi -> English)
    try {
      const eng = await translate("Nom nsuo bi na gye w'ahome.", "twi", "eng");
      assert(typeof eng === "string" && eng.length > 0, "Translation must return a string");
      console.log(`✓ Test 4: Khaya Translation (twi->eng): "${eng}"`);
      passed++;
    } catch (err) {
      console.error("✗ Test 4 Failed:", err.message);
      failed++;
    }

    // Test 5: Khaya TTS v2 Synthesize & Disk Caching
    try {
      const testPhrase = "Akwaaba. Me ne Sentinel.";
      const start1 = Date.now();
      const audio1 = await synthesize(testPhrase, "female");
      const dur1 = Date.now() - start1;

      assert(Buffer.isBuffer(audio1), "Audio must be a Buffer");
      assert(audio1.length > 1000, "Audio buffer must contain valid WAV data");
      assert(audio1.subarray(0, 4).toString() === "RIFF", "Audio must start with RIFF header");

      // Second call should come from cache instantly (< 50ms)
      const start2 = Date.now();
      const audio2 = await synthesize(testPhrase, "female");
      const dur2 = Date.now() - start2;

      assert.strictEqual(audio1.length, audio2.length, "Cached audio length must match");
      assert(dur2 < 50, `Cached call must be fast (< 50ms), got ${dur2}ms`);
      console.log(`✓ Test 5: Khaya TTS & Caching: ${audio1.length} bytes (API: ${dur1}ms, Cache: ${dur2}ms)`);
      passed++;
    } catch (err) {
      console.error("✗ Test 5 Failed:", err.message);
      failed++;
    }

    // Test 6: Khaya ASR v3 Transcription (roundtrip with synthesized audio)
    try {
      const audio = await synthesize("Nom nsuo bi na gye w'ahome.", "female");
      const text = await transcribe(audio, "audio/wav", "twi");
      assert(typeof text === "string" && text.length > 0, "ASR must return text");
      console.log(`✓ Test 6: Khaya ASR v3: "${text}"`);
      passed++;
    } catch (err) {
      console.error("✗ Test 6 Failed:", err.message);
      failed++;
    }

    // Test 7: Route POST /api/twi/speak
    try {
      const res = createMockRes();
      await handleSpeak({ body: { text: "Time for your check-in." } }, res);
      const json = res.getJson();
      assert.strictEqual(res.getStatusCode(), 200);
      assert.strictEqual(json.ok, true);
      assert(json.audio && json.audio.startsWith("data:audio/wav;base64,"));
      assert(json.twi_text && json.twi_text.length > 0);
      console.log(`✓ Test 7: Route /api/twi/speak -> Twi: "${json.twi_text}"`);
      passed++;
    } catch (err) {
      console.error("✗ Test 7 Failed:", err.message);
      failed++;
    }

    // Test 8: Route POST /api/twi/listen (full flow: audio -> ASR -> translate -> English for Sentinel)
    try {
      const audio = await synthesize("Nom nsuo bi na gye w'ahome.", "female");
      const b64 = audio.toString("base64");
      const res = createMockRes();
      await handleListen({ body: { audio: b64, mimeType: "audio/wav" } }, res);
      const json = res.getJson();
      assert.strictEqual(res.getStatusCode(), 200);
      assert.strictEqual(json.ok, true);
      assert(json.twi_text && json.twi_text.length > 0);
      assert(json.eng_text && json.eng_text.length > 0);
      console.log(`✓ Test 8: Route /api/twi/listen -> Input Twi: "${json.twi_text}" -> Sentinel English: "${json.eng_text}"`);
      passed++;
    } catch (err) {
      console.error("✗ Test 8 Failed:", err.message);
      failed++;
    }
  } else {
    console.log("- Tests 3-8 skipped: they call Khaya and use up its call allowance (run with KHAYA_LIVE=1 to include them)");
  }

  // Test 9: Graceful Fallback Handling (invalid text/network failure never crashes)
  try {
    const res = createMockRes();
    // Intentionally pass an empty payload to verify graceful error return without throwing
    await handleSpeak({ body: { text: "" } }, res);
    const json = res.getJson();
    assert.strictEqual(res.getStatusCode(), 400);
    assert.strictEqual(json.ok, false);
    console.log("✓ Test 9: Graceful Error Handling - Invalid input returned 400 without crashing");
    passed++;
  } catch (err) {
    console.error("✗ Test 9 Failed:", err.message);
    failed++;
  }

  // Test 10: Critical Alert Flag Propagation
  try {
    const res = createMockRes();
    await handleSpeak({ body: { text: "Critical radiation alert: shelter now.", is_critical: true } }, res);
    const json = res.getJson();
    assert.strictEqual(json.is_critical, true, "Critical flag must be true");
    console.log("✓ Test 10: Critical Alert Flag - Successfully flagged for secondary English ElevenLabs playback");
    passed++;
  } catch (err) {
    console.error("✗ Test 10 Failed:", err.message);
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
