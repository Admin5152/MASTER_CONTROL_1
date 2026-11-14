"""Screenshots of the main screens in both themes (brief section 10 items 2 and 7). Not a test.

Usage: .venv/Scripts/python tests/layout_shots.py [base_url] [WxH] [dark|light|both] [names...]
Writes tests/screenshots/v2/<theme>/<WxH>-<name>.png
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://127.0.0.1:8444")
import re
SIZE = next((a for a in sys.argv[1:] if re.fullmatch(r"\d+x\d+", a)), "1366x768")
W, H = map(int, SIZE.split("x"))
THEMES = ["dark", "light"] if "both" in sys.argv else ["light"] if "light" in sys.argv else ["dark"]
ONLY = [a for a in sys.argv[1:] if a not in (BASE, SIZE, "dark", "light", "both")]
ARGS = ["--ignore-certificate-errors", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
SHOTS = [
    ("01-home", "void window.sentinel.stages.go('assistant')", 3500),
    ("02-body", "void window.sentinel.director.run([{cmd:'open_screen', name:'body'}])", 5000),
    ("03-body-lungs", "document.querySelector('[data-sys=lungs]').click()", 5000),
    ("04-vitals", "void window.sentinel.director.run([{cmd:'open_screen', name:'vitals'}])", 4000),
    ("05-mission", "void window.sentinel.director.run([{cmd:'open_screen', name:'mission'}])", 4000),
    ("06-radiation", "void window.sentinel.director.run([{cmd:'open_screen', name:'radiation'}])", 4000),
    ("07-wellbeing", "void window.sentinel.screens.open('wellbeing')", 3000),
    ("08-organ-heart", "void window.sentinel.screens.open('organ', 'heart')", 5000),
    ("09-cognitive", "void window.sentinel.screens.open('cognitive')", 2500),
    ("10-exam", "void window.sentinel.screens.open('exam')", 2500),
    ("11-ground", "void window.sentinel.screens.open('ground')", 2500),
    ("12-measures", "void window.sentinel.screens.open('measures')", 2500),
    ("13-hardware", "void window.sentinel.screens.open('hardware')", 4000),
    ("14-settings", "void window.sentinel.screens.open('settings')", 2000),
    ("15-about", "void window.sentinel.screens.open('about')", 2000),
]


def main() -> None:
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True, args=ARGS)
        for theme in THEMES:
            out = ROOT / "tests" / "screenshots" / "v2" / theme
            out.mkdir(parents=True, exist_ok=True)
            page = b.new_page(viewport={"width": W, "height": H}, ignore_https_errors=True)
            page.set_default_timeout(150000)
            page.add_init_script(f"try {{ localStorage.setItem('sentinel:listen', 'ptt'); localStorage.setItem('sentinel:theme', '{theme}'); }} catch (e) {{}}")
            page.add_init_script("(function w(){ if (window.gsap) gsap.ticker.lagSmoothing(0); else setTimeout(w, 20); })()")
            errs: list[str] = []
            page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:300]))
            page.goto(BASE + "/app/")
            page.wait_for_selector("#start-screen.is-ready")
            page.click("#start-btn")
            page.wait_for_function("window.sentinel?.view?.state && window.sentinel.director")
            page.wait_for_timeout(2500)
            for name, js, wait in SHOTS:
                if ONLY and not any(o in name for o in ONLY):
                    continue
                try:
                    page.evaluate("window.sentinel.screens.current() && document.getElementById('sheet-close').click()")
                    page.evaluate(js)
                    page.wait_for_timeout(wait)
                    page.screenshot(path=str(out / f"{W}x{H}-{name}.png"))
                    print(theme, name, "ok")
                except Exception as e:  # keep going: one broken screen should not hide the others
                    print(theme, name, "FAILED", str(e)[:160])
            print(theme, "page errors:", errs[:6])
            page.close()
        b.close()


if __name__ == "__main__":
    main()
