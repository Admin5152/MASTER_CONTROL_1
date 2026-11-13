"""Play Aurora Run for a few seconds (drag + hold) and run the cognitive check by tapping.
Usage: .venv/Scripts/python tests/experience_check.py [base_url]"""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://localhost:8443"
ok_all = True


def report(name, ok, detail=""):
    global ok_all
    ok_all &= ok
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors"])
    pg = b.new_context(ignore_https_errors=True, viewport={"width": 1366, "height": 768}, has_touch=True).new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + "/app/", wait_until="networkidle")
    pg.click("#start-btn")
    pg.wait_for_timeout(2500)
    # Aurora Run
    pg.evaluate("window.sentinel.director.run([{cmd:'open_screen', name:'aurora_run'}])")
    pg.wait_for_timeout(800)
    pg.click("[data-mb='2']")
    pg.wait_for_timeout(500)
    box = pg.locator(".game-canvas").bounding_box()
    pg.mouse.move(box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.5)
    pg.mouse.down(); pg.mouse.move(box["x"] + box["width"] * 0.2, box["y"] + box["height"] * 0.5, steps=10); pg.mouse.up()
    pg.keyboard.down("Space"); pg.wait_for_timeout(2000); pg.keyboard.up("Space")
    pg.wait_for_timeout(1500)
    pg.screenshot(path="tests/screenshots/1366x768-31-aurora-play.png")
    pg.evaluate("window.sentinel.view.aurora.endNow()")
    pg.wait_for_timeout(600)
    pg.click("[data-ma='4']")
    pg.wait_for_timeout(1500)
    res = pg.evaluate("document.querySelector('[data-res]')?.textContent || ''")
    report("Aurora Run plays and records mood 2 -> 4 as +2", "+2" in res, res)
    pg.screenshot(path="tests/screenshots/1366x768-32-aurora-summary.png")
    s = pg.evaluate("fetch('../api/state/' + window.sentinel.view.crewId).then(r => r.json()).then(s => s.wellbeing)")
    report("wellbeing stored", s.get("mood_before") == 2 and s.get("mood_after") == 4 and s.get("last_game") == "aurora_run", json.dumps(s))
    # Cognitive check: tap when green, a few times, then wait for the end
    pg.evaluate("window.sentinel.director.run([{cmd:'open_screen', name:'cognitive'}])")
    pg.wait_for_timeout(800)
    pad = pg.locator("[data-pad]")
    pad.dispatch_event("pointerdown")  # start
    taps = 0
    for _ in range(400):  # up to ~28 s
        if pg.evaluate("document.querySelector('[data-pad]')?.classList.contains('is-go')"):
            pg.wait_for_timeout(250)
            pad.dispatch_event("pointerdown")
            taps += 1
        if "Median" in (pg.evaluate("document.querySelector('[data-res]').textContent") or ""):
            break
        pg.wait_for_timeout(70)
    res = pg.evaluate("document.querySelector('[data-res]').textContent")
    report("cognitive check stores a median reaction time", "Median" in res, f"{taps} taps: {res}")
    pg.screenshot(path="tests/screenshots/1366x768-33-cognitive-result.png")
    report("no page errors", not errors, "; ".join(errors))
    b.close()
sys.exit(0 if ok_all else 1)
