"""Quick visual pass for design iteration (not a test): intro, home and each stage at one size.

Usage: .venv/Scripts/python tests/shots.py [base_url] [WxH] [names...]
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "screenshots" / "v2" / "dev"
OUT.mkdir(parents=True, exist_ok=True)
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://127.0.0.1:8444")
SIZE = next((a for a in sys.argv[1:] if "x" in a and a[0].isdigit()), "1366x768")
W, H = map(int, SIZE.split("x"))
ONLY = [a for a in sys.argv[1:] if not a.startswith("http") and a != SIZE]
ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors",
        "--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"]


def want(n: str) -> bool:
    return not ONLY or n in ONLY


def main() -> None:
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True, args=ARGS)
        ctx = b.new_context(viewport={"width": W, "height": H}, ignore_https_errors=True, permissions=["camera", "microphone"])
        page = ctx.new_page()
        errs: list[str] = []
        page.on("console", lambda m: (errs.append(f"{m.type}: {m.text}"[:240]) if len(errs) < 400 else None) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:300]))
        tag = f"{W}x{H}"
        page.goto(BASE + "/app/", wait_until="load")
        for i, ms in enumerate([1800, 2600, 2600, 2400]):
            page.wait_for_timeout(ms)
            if want("intro"):
                page.screenshot(path=str(OUT / f"{tag}-00-intro-{i}.png"))
        page.wait_for_selector("#start-screen.is-ready", timeout=20000)
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT / f"{tag}-00-intro-ready.png"))
        page.click("#start-btn")
        page.wait_for_function("window.sentinel && window.sentinel.view && window.sentinel.view.state", timeout=20000)
        page.wait_for_timeout(3500)
        page.screenshot(path=str(OUT / f"{tag}-01-home.png"))
        for name in ["mission", "body", "vision", "radiation"]:
            if not want(name):
                continue
            page.evaluate(f"window.sentinel.director.run([{{cmd:'open_screen', name:'{name}'}}])")
            page.wait_for_timeout(4200)
            page.screenshot(path=str(OUT / f"{tag}-02-{name}.png"))
        if want("point"):
            page.evaluate("window.sentinel.director.run([{cmd:'point_to', zone:'eyes'}])")
            page.wait_for_timeout(5000)
            page.screenshot(path=str(OUT / f"{tag}-03-point-eyes.png"))
        if want("check"):
            page.evaluate("window.sentinel.director.run([{cmd:'check_zone', zones:['heart']}])")
            page.wait_for_timeout(2600)
            page.screenshot(path=str(OUT / f"{tag}-03-check-mid.png"))
            page.wait_for_timeout(3200)
            page.screenshot(path=str(OUT / f"{tag}-03-check-heart.png"))
        if want("scan"):
            page.evaluate("window.sentinel.director.run([{cmd:'start_scan'}])")
            page.wait_for_timeout(3800)
            page.screenshot(path=str(OUT / f"{tag}-04-scan-mid.png"))
            page.wait_for_timeout(6000)
            page.screenshot(path=str(OUT / f"{tag}-05-scan-end.png"))
        if want("menu"):
            page.evaluate("window.sentinel.director.run([{cmd:'close'}]); window.sentinel.stages.go('assistant')")
            page.wait_for_timeout(1500)
            page.click("#btn-menu")
            page.wait_for_timeout(800)
            page.screenshot(path=str(OUT / f"{tag}-06-menu.png"))
        print("stats", page.evaluate("JSON.stringify(window.sentinel.world.stats())"), "gpu", page.evaluate("window.sentinel.space.gpu"),
              "world", round(page.evaluate("window.sentinel.world.probe()"), 1), "orb", round(page.evaluate("window.sentinel.orb.probe()"), 1))
        for k, n in Counter(errs).most_common(20):
            print(n, k)
        b.close()


if __name__ == "__main__":
    main()
