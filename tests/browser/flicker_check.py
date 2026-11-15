"""Flicker check (real GPU, installed Chrome): record video while clicking through every pill tab, the theme
toggle, sheets and the organ view, in both themes; then measure each frame's mean brightness with ffmpeg and
report flashes (a frame much darker or brighter than both neighbours), plus the biggest frame-to-frame jumps.

Usage: .venv/Scripts/python tests/flicker_check.py [base_url] [tag]
Writes tests/screenshots/v2/flicker/<tag>-<theme>.webm and prints the analysis.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://127.0.0.1:8444")
TAG = next((a for a in sys.argv[1:] if not a.startswith("http")), "run")
OUT = Path(__file__).resolve().parent.parent / "screenshots" / "v2" / "flicker"
OUT.mkdir(parents=True, exist_ok=True)
ARGS = ["--ignore-certificate-errors", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
NAV = ["body", "vitals", "mission", "radiation", "wellbeing", "assistant", "body"]


def script(pg):
    pg.goto(BASE + "/app/")
    pg.wait_for_selector("#start-screen.is-ready", timeout=90000)
    pg.click("#start-btn")
    pg.wait_for_function("window.sentinel?.view?.state && window.sentinel.director")
    pg.wait_for_timeout(2500)
    marks = []
    t0 = pg.evaluate("performance.now()")
    def mark(name):
        marks.append((name, round((pg.evaluate("performance.now()") - t0) / 1000, 2)))
    for nav in NAV:
        mark(f"nav {nav}")
        pg.click(f"#topnav [data-nav='{nav}']")
        pg.wait_for_timeout(1800)
        if nav == "wellbeing":
            pg.click("#sheet-close"); pg.wait_for_timeout(900)
    mark("organ heart")
    pg.evaluate("void window.sentinel.screens.open('organ', 'heart')"); pg.wait_for_timeout(3000)
    mark("close organ")
    pg.click("#sheet-close"); pg.wait_for_timeout(2000)
    mark("x-ray on")
    pg.click("#btn-xray"); pg.wait_for_timeout(1800)
    mark("nav vitals from x-ray")
    pg.click("#topnav [data-nav='vitals']"); pg.wait_for_timeout(1800)
    mark("settings")
    pg.evaluate("void window.sentinel.screens.open('settings')"); pg.wait_for_timeout(1200)
    other = "light" if pg.evaluate("document.documentElement.dataset.theme") != "light" else "dark"
    mark(f"theme {other}")
    pg.click(f"[data-theme-set='{other}']"); pg.wait_for_timeout(1500)
    pg.click("#sheet-close"); pg.wait_for_timeout(800)
    mark("nav body (other theme)")
    pg.click("#topnav [data-nav='body']"); pg.wait_for_timeout(1800)
    mark("nav mission (other theme)")
    pg.click("#topnav [data-nav='mission']"); pg.wait_for_timeout(1800)
    mark("end")
    return marks, t0


def analyse(video: Path, offset_s: float, marks):
    ff = shutil.which("ffmpeg")
    r = subprocess.run([ff, "-hide_banner", "-i", str(video), "-vf", "fps=30,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"],
                       capture_output=True, text=True)
    ys = [float(m) for m in re.findall(r"YAVG=([0-9.]+)", r.stderr)]
    flashes = []
    for i in range(1, len(ys) - 1):
        a, b, c = ys[i - 1], ys[i], ys[i + 1]
        if (b < a - 10 and b < c - 10) or (b > a + 10 and b > c + 10):
            flashes.append((round(i / 30 - offset_s, 2), round(a), round(b), round(c)))
    jumps = sorted(((abs(ys[i] - ys[i - 1]), round(i / 30 - offset_s, 2), round(ys[i - 1]), round(ys[i])) for i in range(1, len(ys))), reverse=True)[:6]
    def near(t):
        prev = [m for m in marks if m[1] <= t + 0.05]
        return prev[-1][0] if prev else "boot"
    print(f"  frames {len(ys)}; single-frame flashes (>10 luma vs both neighbours): {len(flashes)}")
    for t, a, b, c in flashes[:12]:
        print(f"    t={t:6.2f}s after '{near(t)}': {a} -> {b} -> {c}")
    print("  biggest frame-to-frame jumps:")
    for d, t, a, b in jumps:
        print(f"    t={t:6.2f}s after '{near(t)}': {a} -> {b} (delta {d:.0f})")
    return len(flashes)


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=False, args=ARGS)
    total = 0
    for theme in ("dark", "light"):
        ctx = b.new_context(viewport={"width": 1366, "height": 768}, ignore_https_errors=True,
                            record_video_dir=str(OUT / "tmp"), record_video_size={"width": 1366, "height": 768})
        ctx.add_init_script(f"try {{ localStorage.setItem('sentinel:listen', 'ptt'); localStorage.setItem('sentinel:theme', '{theme}'); }} catch (e) {{}}")
        pg = ctx.new_page()
        pg.set_default_timeout(90000)
        import time
        t_open = time.time()
        marks, _ = script(pg)
        # the video starts when the page opens; the marks start after Begin
        begin_offset = time.time() - t_open - marks[-1][1]
        vid = Path(pg.video.path())
        ctx.close()
        dest = OUT / f"{TAG}-{theme}.webm"
        shutil.move(str(vid), dest)
        print(f"{theme}: {dest.name}  (marks start at ~{begin_offset:.1f}s into the video)")
        total += analyse(dest, begin_offset, marks)
    b.close()
    print("TOTAL FLASHES", total)
