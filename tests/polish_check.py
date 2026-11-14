"""Real-GPU check of the polish items: organ views in both themes, the Sentinel Skin SIM feed in an eye
and a heart check (ONSD reading, looping echo view), the exam subtitle, and the body column at tablet sizes.
Usage: .venv/Scripts/python tests/polish_check.py [base_url]"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://127.0.0.1:8444")
OUT = Path(__file__).resolve().parent / "screenshots" / "v2" / "polish"
OUT.mkdir(parents=True, exist_ok=True)


def boot(b, theme, w=1366, h=768):
    pg = b.new_page(viewport={"width": w, "height": h}, ignore_https_errors=True)
    pg.set_default_timeout(90000)
    pg.add_init_script(f"try {{ localStorage.setItem('sentinel:listen', 'ptt'); localStorage.setItem('sentinel:theme', '{theme}'); }} catch (e) {{}}")
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(BASE + "/app/")
    pg.wait_for_selector("#start-screen.is-ready")
    pg.click("#start-btn")
    pg.wait_for_function("window.sentinel?.view?.state && window.sentinel.director")
    pg.wait_for_timeout(1500)
    return pg, errs


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=False, args=["--ignore-certificate-errors", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    for theme in ("dark", "light"):
        pg, errs = boot(b, theme)
        for organ in ("heart", "lungs", "head"):
            pg.evaluate(f"void window.sentinel.screens.open('organ', '{organ}')")
            pg.wait_for_timeout(3500)
            pg.screenshot(path=str(OUT / f"{theme}-organ-{organ}.png"))
            pg.click("#sheet-close"); pg.wait_for_timeout(1500)
        pg.evaluate("void window.sentinel.screens.open('exam')")
        pg.wait_for_timeout(2500)
        pg.screenshot(path=str(OUT / f"{theme}-exam.png"))
        pg.click("#sheet-close"); pg.wait_for_timeout(800)
        if theme == "dark":
            pg.evaluate("void window.sentinel.screens.open('hardware')")
            pg.wait_for_timeout(2500)
            pg.click("[data-feed]")
            pg.wait_for_timeout(1500)
            pg.screenshot(path=str(OUT / "dark-skin-feed-on.png"))
            pg.click("[data-try='eyes']")
            pg.wait_for_selector("#callout:not([hidden])")
            pg.wait_for_timeout(1500)
            pg.screenshot(path=str(OUT / "dark-skin-check-eyes.png"))
            print("eyes callout:", pg.inner_text("#callout")[:400].replace("\n", " | "))
            pg.evaluate("void window.sentinel.director.run([{cmd:'check_zone', zones:['heart']}])")
            pg.wait_for_selector("#callout:not([hidden]) [data-us]")
            pg.wait_for_timeout(1500)
            pg.screenshot(path=str(OUT / "dark-skin-check-heart.png"))
        print(theme, "errors:", errs)
        pg.close()
    for w, h in ((1024, 768), (768, 1024)):
        pg, errs = boot(b, "dark", w, h)
        for name in ("body", "vitals"):
            pg.evaluate(f"void window.sentinel.director.run([{{cmd:'open_screen', name:'{name}'}}])")
            pg.wait_for_timeout(3500)
            pg.screenshot(path=str(OUT / f"{w}x{h}-{name}.png"))
        print(w, h, "errors:", errs)
        pg.close()
    b.close()
