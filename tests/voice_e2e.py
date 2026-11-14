"""End-to-end voice check in a real browser (installed Chrome, real GPU and audio stack).

1. Begin, type a question: the reply must be spoken through Web Audio (a playing source on the voice graph,
   the AudioContext running, the engine reported).
2. Settings > Test voice: it must say which engine played.
3. Fault injection: /api/tts answers 500 -> a visible "Voice unavailable" notice, the HTTP status in the
   console, and the browser voice as the fallback (never silence without a trace).
Run against a server started with SENTINEL_TTS=kokoro so no ElevenLabs credit is spent.

Usage: .venv/Scripts/python tests/voice_e2e.py [base_url]
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://127.0.0.1:8444")
ARGS = ["--ignore-certificate-errors", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=user-gesture-required"]
ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def boot(b):
    pg = b.new_page(viewport={"width": 1366, "height": 768}, ignore_https_errors=True)
    pg.set_default_timeout(60000)
    pg.add_init_script("try { localStorage.setItem('sentinel:listen', 'ptt'); } catch (e) {}")
    logs: list[str] = []
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    pg.goto(BASE + "/app/")
    pg.wait_for_selector("#start-screen.is-ready")
    pg.click("#start-btn")          # a real user gesture: unlocks audio
    pg.wait_for_function("window.sentinel?.view?.state && window.sentinel.voiceState")
    return pg, logs


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=False, args=ARGS)

    # 1. a typed question is answered aloud through Web Audio
    pg, logs = boot(b)
    check("AudioContext running after Begin", pg.evaluate("window.sentinel.voiceState().ctx") == "running", pg.evaluate("window.sentinel.voiceState().ctx"))
    pg.wait_for_function("!window.sentinel.voiceState().speaking", timeout=60000)   # let the greeting finish
    pg.fill("#ask-input", "how is the cabin")
    pg.press("#ask-input", "Enter")
    pg.wait_for_function("window.sentinel.voiceState().playing === true", timeout=30000)
    st = pg.evaluate("window.sentinel.voiceState()")
    check("reply plays through Web Audio", st["playing"] and st["speaking"], f"engine={st['ttsSource']}")
    check("engine reported", st["ttsSource"] in ("kokoro", "elevenlabs"), st["ttsSource"])
    check("no voice notice", pg.is_hidden("#notice"))

    # 2. Settings > Test voice names the engine
    pg.evaluate("void window.sentinel.screens.open('settings')")
    pg.click("[data-test-voice]")
    pg.wait_for_function("document.querySelector('[data-voice-res]').textContent.startsWith('Played by')", timeout=30000)
    res = pg.inner_text("[data-voice-res]")
    check("Test voice reports the engine", "Kokoro" in res or "ElevenLabs" in res, res)
    pg.close()

    # 3. a failing /api/tts is visible, logged with its status, and falls back to the browser voice
    pg, logs = boot(b)
    pg.route("**/api/tts", lambda route: route.fulfill(status=500, body="boom"))
    pg.wait_for_timeout(500)
    pg.fill("#ask-input", "how is the cabin")
    pg.press("#ask-input", "Enter")
    pg.wait_for_selector("#notice:not([hidden])", timeout=30000)
    check("notice shown on TTS failure", "Voice unavailable" in pg.inner_text("#notice"), pg.inner_text("#notice"))
    check("HTTP status logged", any("/api/tts" in l and "HTTP 500" in l for l in logs), next((l for l in logs if "/api/tts" in l), "")[:120])
    pg.wait_for_function("window.sentinel.voiceState().ttsSource === 'browser' || !window.sentinel.voiceState().speaking", timeout=30000)
    check("falls back to the browser voice", pg.evaluate("window.sentinel.voiceState().ttsSource") == "browser", pg.evaluate("window.sentinel.voiceState().ttsSource"))
    pg.close()
    b.close()

print("VOICE E2E", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
