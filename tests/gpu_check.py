"""Real-GPU check in the installed Chrome (headed): frame rate per screen and a screenshot of each.
Usage: .venv/Scripts/python tests/gpu_check.py [base_url]"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://127.0.0.1:8444")
OUT = Path(__file__).resolve().parent / "screenshots" / "v2" / "gpu"
OUT.mkdir(parents=True, exist_ok=True)
STEPS = [
    ("home", "void window.sentinel.stages.go('assistant')", 4000),
    ("body", "void window.sentinel.director.run([{cmd:'open_screen', name:'body'}])", 5000),
    ("xray-anatomy", "void window.sentinel.director.run([{cmd:'xray', on:true, style:'anatomy'}])", 4000),
    ("check-heart", "void window.sentinel.director.run([{cmd:'check_zone', zones:['heart']}])", 7000),
    ("vitals", "window.sentinel.director.cancel(); void window.sentinel.director.run([{cmd:'open_screen', name:'vitals'}])", 4000),
    ("mission", "void window.sentinel.director.run([{cmd:'open_screen', name:'mission'}])", 4000),
]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=False, args=["--ignore-certificate-errors", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--window-size=1400,860"])
    pg = b.new_page(viewport={"width": 1366, "height": 768}, ignore_https_errors=True)
    pg.set_default_timeout(90000)
    pg.add_init_script("try { localStorage.setItem('sentinel:listen', 'ptt'); } catch (e) {}")
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(BASE + "/app/")
    pg.wait_for_timeout(3000)
    pg.screenshot(path=str(OUT / "00-intro.png"))
    pg.wait_for_selector("#start-screen.is-ready")
    print("gpu:", pg.evaluate("window.sentinel.space?.gpu"))
    pg.click("#start-btn")
    pg.wait_for_function("window.sentinel?.view?.state")
    for name, js, wait in STEPS:
        pg.evaluate(js)
        pg.wait_for_timeout(wait)
        print(name, pg.evaluate("JSON.stringify(window.sentinel.world.stats())"))
        pg.screenshot(path=str(OUT / f"{name}.png"))
    pg.evaluate("void window.sentinel.director.run([{cmd:'open_screen', name:'race'}])")
    pg.wait_for_selector("[data-mb]")
    pg.click("[data-mb='4']")
    pg.wait_for_function("window.sentinel.raceDebug && window.sentinel.raceDebug.t > 3")
    pg.keyboard.down("ArrowLeft"); pg.wait_for_timeout(1500); pg.keyboard.up("ArrowLeft")
    print("race", pg.evaluate("JSON.stringify(window.sentinel.world.stats())"))
    pg.screenshot(path=str(OUT / "race.png"))
    print("errors:", errs)
    b.close()
