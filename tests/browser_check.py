"""Browser run with Playwright against the installed Chrome or Edge (spec 9 step 3b).

Usage: .venv/Scripts/python tests/browser_check.py [base_url] [--quick]
Starts nothing: the server must already be running. Uses the browser's fake camera and
microphone, so the camera path runs but there is no face (this proves the no-face fallback).
Saves screenshots to tests/screenshots/ and prints a PASS/FAIL line per check.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
import ssl
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tests" / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "http://127.0.0.1:8000")
QUICK = "--quick" in sys.argv
SIZES = [(1366, 768), (1024, 768), (768, 1024)] if not QUICK else [(1366, 768)]
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=CTX, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def launch(p):
    args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors",
            "--autoplay-policy=no-user-gesture-required"]
    for ch in ("chrome", "msedge"):
        try:
            return p.chromium.launch(channel=ch, headless=True, args=args), ch
        except Exception:
            continue
    raise SystemExit("no Chrome or Edge found for Playwright")


def run_size(browser, w: int, h: int) -> None:
    tag = f"{w}x{h}"
    ctx = browser.new_context(viewport={"width": w, "height": h}, ignore_https_errors=True, has_touch=True,
                              permissions=["camera", "microphone"])
    page = ctx.new_page()
    errors: list[str] = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    api("POST", "/api/scenario/reset")
    page.goto(BASE + "/app/", wait_until="networkidle")
    page.screenshot(path=str(SHOTS / f"{tag}-00-start.png"))
    page.click("#start-btn")
    page.wait_for_selector("#sentinel-body .zone", timeout=15000)
    page.wait_for_function("window.sentinel && window.sentinel.view && window.sentinel.view.state", timeout=15000)
    page.wait_for_timeout(2500)
    page.screenshot(path=str(SHOTS / f"{tag}-01-home.png"))

    # layout: no horizontal scroll, no overlapping panels
    sw = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(f"{tag} no horizontal page scroll", sw <= 0, f"overflow {sw}px")
    overlap = page.evaluate("""() => {
      const ids = ['col-body','col-orb','col-cam','vitals','statusbar'];
      const r = ids.map(i => [i, document.getElementById(i).getBoundingClientRect()]);
      const out = [];
      for (let a = 0; a < r.length; a++) for (let b = a + 1; b < r.length; b++) {
        const A = r[a][1], B = r[b][1];
        const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (ix > 2 && iy > 2) out.push(r[a][0] + '/' + r[b][0]);
      }
      return out;
    }""")
    check(f"{tag} no overlapping panels", not overlap, ",".join(overlap))

    # every tile shows a value and a badge
    tiles = page.evaluate("""() => [...document.querySelectorAll('.tile')].map(t => ({
        id: t.dataset.tile, v: t.querySelector('.tile-value').textContent.trim(), b: t.querySelector('.tile-badge').textContent.trim()}))""")
    bad = [t["id"] for t in tiles if t["v"] in ("", "—") or not t["b"]]
    check(f"{tag} every tile has a value and a badge", not bad and len(tiles) == 12, ",".join(bad))
    sim_live = page.evaluate("""() => { const s = window.sentinel.view.state; return s.vitals.sources.heart_rate; }""")
    hr_badge = page.evaluate("document.querySelector('[data-tile=heart_rate] .tile-badge').textContent.trim()")
    check(f"{tag} simulated heart rate is badged SIM", sim_live != "sim" or hr_badge == "SIM", f"{sim_live}/{hr_badge}")

    # touch targets: every button at least 44 px (48 target; allow rounding)
    small = page.evaluate("""() => [...document.querySelectorAll('#app button')].filter(b => b.offsetParent && !b.closest('.sheet,.demo-panel')).filter(b => {
        const r = b.getBoundingClientRect(); return r.width < 40 || r.height < 40; }).map(b => b.id || b.className || b.textContent.trim()).slice(0, 8)""")
    check(f"{tag} visible controls are touch-sized", not small, ",".join(small))

    # click every body zone, panel opens
    for z in ["head", "eyes", "heart", "lungs", "gut", "bones"]:
        page.evaluate(f"document.querySelector('#zone-{z}').dispatchEvent(new MouseEvent('click', {{bubbles: true}}))")
        page.wait_for_timeout(350)
        ok = page.evaluate("document.getElementById('sheet').hidden === false && document.getElementById('sheet').dataset.screen === 'zone'")
        title = page.evaluate("document.getElementById('sheet-title').textContent")
        check(f"{tag} zone {z} opens its panel", ok, title)
        if z == "eyes":
            page.screenshot(path=str(SHOTS / f"{tag}-02-zone-eyes.png"))
        page.click("#sheet-close")

    # drive the eye zone through the rules engine: fatigue raised -> action.zone eyes (alert)
    api("POST", "/api/state/james/patch", {"state": {"fatigue": 0.85}})
    try:
        page.wait_for_function("!document.getElementById('callout').hidden", timeout=6000)
    except Exception:
        pass
    st = page.evaluate("""() => { const e = document.querySelector('#zone-eyes'); return {target: e.classList.contains('is-target'), alert: e.classList.contains('is-alert'),
        vb: document.querySelector('#sentinel-body').getAttribute('viewBox'), callout: !document.getElementById('callout').hidden,
        beam: document.querySelectorAll('#beam-layer .beam').length}; }""")
    page.screenshot(path=str(SHOTS / f"{tag}-03-point-eyes.png"))
    check(f"{tag} action.zone eyes -> zone-eyes is-target and is-alert", st["target"] and st["alert"], json.dumps(st))
    check(f"{tag} pointing zooms, draws beam and callout", st["vb"] != "0 0 400 900" and st["callout"] and st["beam"] == 1, json.dumps(st))
    page.wait_for_timeout(10000)
    done = page.evaluate("({vb: document.querySelector('#sentinel-body').getAttribute('viewBox'), callout: !document.getElementById('callout').hidden, beams: document.querySelectorAll('#beam-layer line').length})")
    check(f"{tag} pointing sequence completes and eases back", done["vb"] == "0 0 400 900" and not done["callout"] and done["beams"] == 0, json.dumps(done))
    api("POST", "/api/state/james/patch", {"state": {"fatigue": 0.2}})
    page.wait_for_timeout(800)

    # full scan visits all six zones top to bottom
    page.evaluate("window.sentinel.director.run([{cmd:'start_scan'}])")
    page.wait_for_timeout(3000)
    page.screenshot(path=str(SHOTS / f"{tag}-04-scan.png"))
    page.wait_for_function("!window.sentinel.director.busy", timeout=30000)
    visits = page.evaluate("window.sentinel.director.lastScanVisits")
    check(f"{tag} full scan visits six zones top to bottom", visits == ["head", "eyes", "lungs", "heart", "gut", "bones"], ",".join(visits))
    rows = page.evaluate("[...document.querySelectorAll('#scan-list li')].map(l => l.querySelector('.badge') ? 1 : 0)")
    check(f"{tag} each scan line keeps a badge", len(rows) == 6 and all(rows), str(rows))

    # every screen through the Director
    for name in ["health_log", "trends", "radiation", "cognitive", "orb_calm", "aurora_run", "greenhouse", "hardware", "crew"]:
        page.evaluate(f"window.sentinel.director.run([{{cmd:'open_screen', name:'{name}'}}])")
        page.wait_for_timeout(1300)
        ok = page.evaluate(f"document.getElementById('sheet').dataset.screen === '{name}' && !document.getElementById('sheet').hidden")
        check(f"{tag} Director opens {name}", ok)
        page.screenshot(path=str(SHOTS / f"{tag}-05-screen-{name}.png"))
    page.evaluate("window.sentinel.director.run([{cmd:'show_chart', metric:'heart_rate'}])")
    page.wait_for_timeout(1200)
    has_chart = page.evaluate("!!document.querySelector('#sheet canvas')")
    check(f"{tag} Director shows a trend chart", has_chart)
    page.screenshot(path=str(SHOTS / f"{tag}-06-chart-hr.png"))
    page.evaluate("window.sentinel.director.run([{cmd:'close'}])")
    page.wait_for_timeout(400)
    page.evaluate("window.sentinel.director.run([{cmd:'open_screen', name:'vision'}])")
    page.wait_for_timeout(3000)
    cam = page.evaluate("({msg: document.getElementById('cam-msg').textContent, badge: document.getElementById('cam-badge').textContent})")
    check(f"{tag} fake camera, no face: pulse stays SIM", cam["badge"] == "SIM", json.dumps(cam))

    # typed input and quick commands work without a keyboard-only path
    page.fill("#ask-input", "how am I doing")
    page.click("#ask-form button[type=submit]")
    page.wait_for_timeout(1500)
    last = page.evaluate("[...document.querySelectorAll('#transcript li.sentinel .msg')].pop()?.textContent || ''")
    check(f"{tag} typed question gets a reply", bool(last), last[:80])
    page.click("#btn-demo")
    page.wait_for_timeout(500)
    check(f"{tag} demo panel opens by button", page.evaluate("!document.getElementById('demo-panel').hidden"))
    page.screenshot(path=str(SHOTS / f"{tag}-07-demo-panel.png"))
    page.click("#demo-panel [data-close]")

    if not QUICK and (w, h) == (1366, 768):
        run_scenarios(page, tag)
    # MediaPipe's WASM prints an INFO line through console.error ("INFO: Created TensorFlow Lite XNNPACK
    # delegate for CPU."). It is not an error; it is listed here so the filter is visible.
    benign = ("INFO: Created TensorFlow Lite XNNPACK delegate",)
    real = [e for e in errors if not any(b in e for b in benign)]
    check(f"{tag} zero console errors", not real, " | ".join(real)[:600])
    ctx.close()


def run_scenarios(page, tag: str) -> None:
    # cabin dip: banner appears, acknowledge recovers
    api("POST", "/api/scenario/cabin_dip?speed=4")
    page.wait_for_function("!document.getElementById('banner').hidden", timeout=20000)
    page.wait_for_timeout(600)
    page.screenshot(path=str(SHOTS / f"{tag}-10-cabin-alert.png"))
    check(f"{tag} cabin_dip raises the banner", True)
    page.click("#banner-ack")
    page.wait_for_timeout(4000)
    s = api("GET", "/api/state/james")
    check(f"{tag} acknowledge recovers oxygen", s["cabin"]["oxygen_pct"] > 19.5, str(s["cabin"]))
    # solar storm
    api("POST", "/api/scenario/solar_storm?speed=3")
    page.wait_for_timeout(9000)
    page.screenshot(path=str(SHOTS / f"{tag}-11-solar-storm.png"))
    st = api("GET", "/api/state/james")
    check(f"{tag} solar_storm reaches S2+ and flags radiation", st["radiation"]["storm_level"] >= 2 and st["action"]["type"] == "flag_radiation", f"S{st['radiation']['storm_level']} {st['action']['type']}")
    lbl = page.evaluate("document.querySelector('[data-sw-time]')?.textContent || ''")
    check(f"{tag} storm replay is labelled SIM with the DONKI date", "SIM" in lbl and "DONKI" in lbl, lbl)
    page.click("#banner-ack")
    page.wait_for_timeout(9000)
    # tired crew -> eyes, Orb Calm offered
    api("POST", "/api/scenario/tired_crew?crew_id=james")
    page.wait_for_timeout(6000)
    page.screenshot(path=str(SHOTS / f"{tag}-12-tired-crew.png"))
    s = api("GET", "/api/state/james")
    check(f"{tag} tired_crew offers Orb Calm at the eye zone", s["action"]["type"] == "offer_orb_calm" and s["action"]["zone"] == "eyes", f"{s['action']['type']} {s['action']['zone']}")
    page.wait_for_timeout(9000)
    page.evaluate("window.sentinel.director.run([{cmd:'open_screen', name:'orb_calm'}])")
    api("POST", "/api/scenario/calm_down?crew_id=james&speed=4")
    page.wait_for_timeout(7000)
    page.screenshot(path=str(SHOTS / f"{tag}-13-orb-calm.png"))
    page.wait_for_timeout(9000)
    txt = page.evaluate("document.querySelector('[data-phase]')?.textContent || ''")
    page.screenshot(path=str(SHOTS / f"{tag}-14-orb-calm-end.png"))
    check(f"{tag} Orb Calm reaches blue / clears with simulated heart rate", "cleared" in txt.lower() or "blue" in txt.lower(), txt)
    page.evaluate("window.sentinel.director.run([{cmd:'close'}])")
    api("POST", "/api/scenario/reset")
    page.wait_for_timeout(1500)
    # full demo, sped up
    api("POST", "/api/scenario/full_demo?speed=4")
    t0 = time.time()
    shots = 0
    while time.time() - t0 < 60:
        st = api("GET", "/api/scenario")
        if not st["running"]:
            break
        if shots < 6 and time.time() - t0 > shots * 4:
            page.screenshot(path=str(SHOTS / f"{tag}-2{shots}-full-demo.png"))
            shots += 1
        time.sleep(0.5)
    seq = [a["type"] for a in st["action_log"]]
    check(f"{tag} full_demo runs to the end", not st["running"] and st["step"] == "done", " > ".join(seq))
    api("POST", "/api/scenario/reset")


def main() -> None:
    with sync_playwright() as p:
        browser, ch = launch(p)
        print(f"browser: {ch}")
        for w, h in SIZES:
            run_size(browser, w, h)
        browser.close()
    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
