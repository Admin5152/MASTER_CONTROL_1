"""Quick visual pass: screenshot the main stages at one size. For design iteration, not a test.

Usage: .venv/Scripts/python tests/shots.py [base_url] [WxH] [names...]
"""
from __future__ import annotations

import sys
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


def main() -> None:
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True, args=ARGS)
        ctx = b.new_context(viewport={"width": W, "height": H}, ignore_https_errors=True, permissions=["camera", "microphone"])
        page = ctx.new_page()
        errs: list[str] = []
        page.on("console", lambda m: (errs.append(f"{m.type}: {m.text}"[:300]) if len(errs) < 400 else None) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        page.goto(BASE + "/app/", wait_until="networkidle")
        page.wait_for_timeout(2500)
        tag = f"{W}x{H}"
        page.screenshot(path=str(OUT / f"{tag}-00-start.png"))
        page.click("#start-btn")
        page.wait_for_function("window.sentinel && window.sentinel.view && window.sentinel.view.state", timeout=20000)
        page.wait_for_timeout(3000)
        page.screenshot(path=str(OUT / f"{tag}-01-assistant.png"))
        for name in ["mission", "body", "vision", "radiation"]:
            if ONLY and name not in ONLY:
                continue
            page.evaluate(f"window.sentinel.director.run([{{cmd:'open_screen', name:'{name}'}}])")
            page.wait_for_timeout(4000)
            page.screenshot(path=str(OUT / f"{tag}-02-{name}.png"))
        if not ONLY or "point" in ONLY:
            page.evaluate("window.sentinel.director.run([{cmd:'point_to', zone:'eyes'}])")
            page.wait_for_timeout(4500)
            page.screenshot(path=str(OUT / f"{tag}-03-point-eyes.png"))
        if not ONLY or "scan" in ONLY:
            page.evaluate("window.sentinel.director.run([{cmd:'start_scan'}])")
            page.wait_for_timeout(3500)
            page.screenshot(path=str(OUT / f"{tag}-04-scan-mid.png"))
            page.wait_for_timeout(5000)
            page.screenshot(path=str(OUT / f"{tag}-05-scan-end.png"))
        if not ONLY or "more" in ONLY:
            page.evaluate("window.sentinel.screens.open('more')")
            page.wait_for_timeout(1200)
            page.screenshot(path=str(OUT / f"{tag}-06-more.png"))
        print("stats", page.evaluate("JSON.stringify(window.sentinel.world.stats())"), "gpu", page.evaluate("window.sentinel.space.gpu"), "orb", page.evaluate("window.sentinel.orb.probe()"), "lost", page.evaluate("document.querySelectorAll('.is-lost').length"))
        print("\n".join(errs[:30]))
        b.close()


if __name__ == "__main__":
    main()
