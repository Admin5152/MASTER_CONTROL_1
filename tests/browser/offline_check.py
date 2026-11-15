"""Brain-offline fallback check: block /api/* after start and confirm the page greys out and keeps values.
Usage: .venv/Scripts/python tests/offline_check.py [base_url]"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://localhost:8443"
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors"])
    pg = b.new_context(ignore_https_errors=True, viewport={"width": 1366, "height": 768}).new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + "/app/", wait_until="networkidle")
    pg.click("#start-btn")
    pg.wait_for_timeout(3000)
    before = pg.evaluate("document.querySelector('[data-tile=heart_rate] .tile-value').textContent")
    pg.route("**/api/**", lambda route: route.abort())
    pg.wait_for_timeout(3000)
    st = pg.evaluate("({offline: document.body.classList.contains('offline'), link: document.getElementById('sb-link').textContent, hr: document.querySelector('[data-tile=heart_rate] .tile-value').textContent})")
    pg.fill("#ask-input", "how am I doing")
    pg.click("#ask-form button[type=submit]")
    pg.wait_for_timeout(1500)
    reply = pg.evaluate("[...document.querySelectorAll('#transcript li.sentinel .msg')].pop()?.textContent || ''")
    pg.screenshot(path="tests/screenshots/1366x768-30-brain-offline.png")
    b.close()
ok = st["offline"] and "offline" in st["link"].lower() and st["hr"] == before and "offline" in reply.lower() and not errors
print(("PASS" if ok else "FAIL") + f" brain offline: {st} reply={reply!r} pageerrors={errors}")
sys.exit(0 if ok else 1)
