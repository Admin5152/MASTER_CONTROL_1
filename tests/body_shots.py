"""Body studio visual pass (not a test): solid, radiograph, anatomy, zone check, isolate, female.

Usage: .venv/Scripts/python tests/body_shots.py [base_url] [WxH]
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "screenshots" / "v2" / "body"
OUT.mkdir(parents=True, exist_ok=True)
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://127.0.0.1:8444")
SIZE = next((a for a in sys.argv[1:] if "x" in a and a[0].isdigit()), "1366x768")
W, H = map(int, SIZE.split("x"))
ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors",
        "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]


def main() -> None:
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True, args=ARGS)
        ctx = b.new_context(viewport={"width": W, "height": H}, ignore_https_errors=True, permissions=["camera", "microphone"])
        page = ctx.new_page()
        page.add_init_script("(function w(){ if (window.gsap) gsap.ticker.lagSmoothing(0); else setTimeout(w, 20); })()")
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:300]))
        page.on("console", lambda m: errs.append(f"{m.type}: {m.text}"[:240]) if m.type == "error" else None)
        tag = f"{W}x{H}"
        page.goto(BASE + "/app/", wait_until="load")
        page.wait_for_selector("#start-screen.is-ready", timeout=90000)
        page.click("#start-btn")
        page.wait_for_function("window.sentinel?.view?.state", timeout=30000)
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / f"{tag}-00-home.png"))
        page.evaluate("window.sentinel.director.run([{cmd:'open_screen', name:'body'}])")
        page.wait_for_function("window.sentinel.body3d && window.sentinel.stages.current === 'body'", timeout=60000)
        page.wait_for_timeout(3500)
        page.screenshot(path=str(OUT / f"{tag}-01-solid.png"))
        print("debug", page.evaluate("JSON.stringify(window.sentinel.body3d.debug())"))

        def run(cmds: str, wait: int, name: str) -> None:
            page.evaluate(f"window.sentinel.director.run({cmds})")
            page.wait_for_timeout(wait)
            page.screenshot(path=str(OUT / f"{tag}-{name}.png"))

        run("[{cmd:'xray', on:true, style:'radiograph'}]", 3000, "02-radiograph")
        run("[{cmd:'xray', on:true, style:'anatomy'}]", 3000, "03-anatomy")
        run("[{cmd:'xray', on:false}]", 1500, "03b-solid-again")
        page.evaluate("window.sentinel.director.run([{cmd:'check_zone', zones:['heart']}])")
        page.wait_for_timeout(2600)
        page.screenshot(path=str(OUT / f"{tag}-04-check-sweep.png"))
        page.wait_for_timeout(5500)
        page.screenshot(path=str(OUT / f"{tag}-05-check-heart.png"))
        page.evaluate("window.sentinel.director.cancel()")
        run("[{cmd:'isolate', part:'spine'}]", 3500, "06-isolate-spine")
        run("[{cmd:'isolate', part:'vessels'}]", 3500, "07-isolate-vessels")
        run("[{cmd:'point_to', zone:'eyes'}]", 6000, "08-point-eyes")
        page.evaluate("window.sentinel.director.cancel(); window.sentinel.body3d.zoomReset(0); window.sentinel.body3d.setXray(false, 0)")
        page.evaluate("window.sentinel.body3d.setModel('female')")
        page.wait_for_timeout(5000)
        page.screenshot(path=str(OUT / f"{tag}-09-female-solid.png"))
        print("female", page.evaluate("JSON.stringify(window.sentinel.body3d.debug())"))
        run("[{cmd:'xray', on:true, style:'anatomy'}]", 3000, "10-female-anatomy")
        run("[{cmd:'start_scan'}]", 4000, "11-scan-mid")
        print("errors", errs[:10])
        b.close()


if __name__ == "__main__":
    main()
