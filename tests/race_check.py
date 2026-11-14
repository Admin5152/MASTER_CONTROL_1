"""Space race browser check (Playwright, software GL): menu, countdown, flying, a power-up, the HUD, the finish
summary and the mood log. Not part of pytest (needs a running server).

Usage: .venv/Scripts/python tests/race_check.py [base_url]
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "screenshots" / "v2" / "race"
OUT.mkdir(parents=True, exist_ok=True)
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://127.0.0.1:8444")
ARGS = ["--ignore-certificate-errors", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"]


def main() -> int:
    ok = True
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True, args=ARGS)
        page = b.new_page(viewport={"width": 1366, "height": 768}, ignore_https_errors=True)
        page.set_default_timeout(120000)
        page.add_init_script("try { localStorage.setItem('sentinel:listen', 'ptt'); } catch (e) {}")
        page.add_init_script("(function w(){ if (window.gsap) gsap.ticker.lagSmoothing(0); else setTimeout(w, 20); })()")
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:300]))
        page.on("console", lambda m: errs.append(f"{m.type}: {m.text}"[:240]) if m.type == "error" and "XNNPACK" not in m.text else None)
        page.goto(BASE + "/app/")
        page.wait_for_selector("#start-screen.is-ready")
        page.click("#start-btn")
        page.wait_for_function("window.sentinel?.view?.state")
        page.evaluate("void window.sentinel.director.run([{cmd:'open_screen', name:'race'}])")
        page.wait_for_selector("[data-mb]")
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT / "01-menu.png"))
        page.click("[data-mb='3']")
        page.wait_for_function("window.sentinel.raceDebug && window.sentinel.world.stats().active === 'race'")
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT / "02-countdown.png"))
        # fly: steer right a little, then grab the Earth beacon by placing the ship on it (software GL is ~2 fps)
        page.keyboard.down("ArrowRight")
        page.wait_for_function("window.sentinel.raceDebug.t > 2")
        page.keyboard.up("ArrowRight")
        page.screenshot(path=str(OUT / "03-flying.png"))
        got = page.evaluate("""() => { const d = window.sentinel.raceDebug; const p = d.pickups[0];
            d.place(p.x, p.y); d.me.dist = p.dist - 1.5; return p.planet; }""")
        page.wait_for_timeout(2500)
        eff = page.evaluate("JSON.stringify(window.sentinel.raceDebug.me.effects)")
        page.screenshot(path=str(OUT / "04-powerup.png"))
        print("beacon", got, "effects", eff)
        # jump to the last stretch and let it finish
        page.evaluate("() => { const d = window.sentinel.raceDebug; d.me.dist = d.me.trackLength * d.me.laps - 3; }")
        page.wait_for_selector("[data-end]:not([hidden])")
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT / "05-finish.png"))
        page.click("[data-ma='4']")
        page.wait_for_timeout(2500)
        res = page.inner_text("[data-res]")
        print("result:", res)
        ok = ok and "Saved" in res
        page.screenshot(path=str(OUT / "06-mood-saved.png"))
        stats = page.evaluate("JSON.stringify(window.sentinel.world.stats())")
        print("stats", stats)
        page.click("#sheet-close")
        page.wait_for_timeout(2500)
        print("after close active:", page.evaluate("window.sentinel.world.stats().active"))
        print("errors:", errs[:8])
        ok = ok and not [e for e in errs if "pageerror" in e]
        b.close()
    print("RACE CHECK", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
