"""Body model and zones browser check (Product Document section 7, tests SB1-SB7), against a running server.

Usage: .venv/Scripts/python tests/body_zones_check.py [base_url]
Start the server with SENTINEL_NO_PERSIST=1 SENTINEL_FRESH=1 so the crew starts from the mock data.
Exits non-zero when a check fails; screenshots go to tests/screenshots/v2/zones/.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "screenshots" / "v2" / "zones"
OUT.mkdir(parents=True, exist_ok=True)
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "http://127.0.0.1:8000")
ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors",
        "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


def main() -> None:
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True, args=ARGS)
        page = b.new_page(viewport={"width": 1366, "height": 768})
        page.set_default_timeout(120000)
        page.add_init_script("try { localStorage.setItem('sentinel:listen', 'ptt'); localStorage.removeItem('sentinel:glove'); } catch (e) {}")
        page.add_init_script("(function w(){ if (window.gsap) gsap.ticker.lagSmoothing(0); else setTimeout(w, 20); })()")
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:300]))
        page.on("console", lambda m: errs.append(f"{m.type}: {m.text}"[:240]) if m.type == "error" else None)
        page.goto(BASE + "/app/", wait_until="load")
        page.wait_for_selector("#start-screen.is-ready", timeout=90000)
        page.click("#start-btn")
        page.wait_for_function("window.sentinel?.view?.state", timeout=30000)
        page.evaluate("""() => { window.__ev = []; for (const n of ['body.zone.selected', 'body.scan.complete', 'symptom.logged'])
            window.sentinel.on(n, (d) => window.__ev.push([n, d])); }""")
        page.evaluate("window.sentinel.director.run([{cmd:'open_screen', name:'body'}])")
        page.wait_for_function("window.sentinel.body3d && window.sentinel.stages.current === 'body'", timeout=90000)
        page.wait_for_timeout(3000)
        cid = page.evaluate("window.sentinel.view.crewId")
        api = lambda path, body: page.evaluate(  # noqa: E731
            "async ([p, b]) => (await fetch(p, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b)})).status", [path, body])

        # the anatomy is fitted inside the body
        fit = page.evaluate("window.sentinel.body3d.debug().fit")
        check("anatomy fitted to the body at load", bool(fit) and all(fit[n]["fitted"] > 0 for n in ("ribcage", "heart", "lungs", "brain", "eyes", "intestines", "veins", "arteries")),
              json.dumps({n: fit[n]["fitted"] for n in ("ribcage", "heart", "brain", "eyes")}) if fit else "no report")

        zone_state = "() => Object.fromEntries([...document.querySelectorAll('#hotspots .zone')].map(z => [z.dataset.zone, [z.dataset.st, z.querySelector('.zstat').textContent, !!z.querySelector('.zdot svg path')]]))"
        # SB1: normal readings everywhere (state from the mock crew, scenario off)
        api(f"../api/state/{cid}/patch", {"vitals": {"heart_rate": 64, "spo2": 98, "breathing_rate": 14}, "manual": {"sleep_hours": 7.5, "mood": 4, "temp_c": 36.7, "glucose_mgdl": 95, "bp_systolic": 116, "bp_diastolic": 75, "symptoms": []}, "cabin": {"co2_ppm": 600, "oxygen_pct": 20.9}})
        page.wait_for_timeout(4000)
        zs = page.evaluate(zone_state)
        check("SB1 all indicators normal: every zone is green with icon and word", all(v[0] == "ok" and v[1] == "Normal" and v[2] for v in zs.values()), json.dumps(zs))
        page.screenshot(path=str(OUT / "01-all-normal.png"))

        # SB2: one indicator in the head zone at watch (sleep below the reference)
        api(f"../api/state/{cid}/patch", {"manual": {"sleep_hours": 4.5}})
        page.wait_for_timeout(4000)
        zs = page.evaluate(zone_state)
        check("SB2 one head indicator amber: head zone is amber", zs["head"][0] in ("watch", "alert") and zs["head"][1] in ("Watch", "Alert") and zs["heart"][0] == "ok", json.dumps(zs))
        page.screenshot(path=str(OUT / "02-head-amber.png"))

        # SB3: click the head zone -> details with indicators, how to measure, why it matters, MRID
        page.evaluate("document.querySelector('#zone-head').click()")
        page.wait_for_selector(".zone-pop [data-details]")
        page.click(".zone-pop [data-details]")
        page.wait_for_selector("#sheet-body [data-how]", state="attached")
        page.wait_for_timeout(800)
        sheet = page.evaluate("""() => ({ rows: document.querySelectorAll('#sheet-body table.readings tbody tr').length,
            icon: !!document.querySelector('#sheet-body .st-cell svg'), how: document.querySelector('#sheet-body [data-how]')?.textContent || '',
            why: document.querySelector('#sheet-body [data-why]')?.textContent || '', mrids: document.querySelector('#sheet-body [data-mrids]')?.textContent || '' })""")
        check("SB3 head zone opens its indicators with how to measure, why it matters and the MRID",
              sheet["rows"] > 0 and sheet["icon"] and len(sheet["how"]) > 40 and len(sheet["why"]) > 40 and "MEDB" in sheet["mrids"], json.dumps(sheet)[:300])
        sel = page.evaluate("window.__ev.filter(e => e[0] === 'body.zone.selected').map(e => e[1])")
        check("body.zone.selected emitted with zone and crewId", any(e.get("zone") == "head" and e.get("crewId") == cid for e in sel), json.dumps(sel))
        page.screenshot(path=str(OUT / "03-head-details.png"))
        page.evaluate("window.sentinel.screens.close()")

        # SB4: "Where does it hurt?" -> tap the chest on the 3D body -> symptom -> symptom.logged
        page.click("#btn-hurt")
        page.wait_for_function("document.querySelector('#body-host').classList.contains('is-pointing-mode')")
        page.evaluate("window.sentinel.body3d.zoomReset(0)")
        page.wait_for_timeout(1500)
        pt = page.evaluate("""() => { const b = window.sentinel.body3d, lm = b.landmarks;
            // the chest: project a point on the front of the trunk, between the shoulders and the waist
            const y = (lm.shoulderY + lm.waistY) / 2, a = b.anchorWorld('heart');
            const THREE_v = { x: 0.03, y, z: a[2] };
            const cam = b.camera; const v = new cam.position.constructor(THREE_v.x, THREE_v.y, THREE_v.z).project(cam);
            return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, region: b.regionAt((v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight)?.region }; }""")
        page.mouse.click(pt["x"], pt["y"])
        page.wait_for_selector("#sheet-body [data-type]", timeout=10000)
        title = page.text_content("#sheet-title")
        check("pointing at the chest names the chest", "chest" in title.lower(), f"{title} / regionAt={pt['region']}")
        page.screenshot(path=str(OUT / "04-symptom-picker.png"))
        page.click("#sheet-body [data-type='cough']")
        page.click("#sheet-body [data-severity='2']")
        page.click("#sheet-body [data-onset='today']")
        page.click("#sheet-body [data-save]")
        page.wait_for_selector("#sheet-body .sym-done", timeout=15000)
        logged = page.evaluate("window.__ev.filter(e => e[0] === 'symptom.logged').map(e => e[1])")
        check("SB4 symptom.logged emitted with zone and severity", any(e["zone"] == "lungs" and e["severity"] == 2 and e["type"] == "cough" and e["onset"] == "today" for e in logged), json.dumps(logged))
        st = page.evaluate(f"async () => (await (await fetch('../api/state/{cid}')).json()).manual")
        check("the symptom is saved to the crew member's state", st["symptom_log"][0]["type"] == "cough" and "cough" in st["symptoms"], json.dumps(st["symptom_log"][:1]))
        page.screenshot(path=str(OUT / "05-symptom-logged.png"))
        page.evaluate("window.sentinel.screens.close()")
        check("pointing mode ends with the sheet", not page.evaluate("document.querySelector('#body-host').classList.contains('is-pointing-mode')"))

        # SB5: X-ray toggle
        page.evaluate("void window.sentinel.director.run([{cmd:'xray', on:true, style:'anatomy'}])")
        page.wait_for_timeout(2500)
        on = page.evaluate("window.sentinel.body3d.xray")
        page.screenshot(path=str(OUT / "06-xray-anatomy.png"))
        page.evaluate("void window.sentinel.director.run([{cmd:'xray', on:false}])")
        page.wait_for_timeout(2000)
        check("SB5 X-ray toggles between skin and anatomy", on and not page.evaluate("window.sentinel.body3d.xray"))

        # SB6: mesh scan with one alert highlights the flagged zone
        api(f"../api/state/{cid}/patch", {"manual": {"sleep_hours": 7.5}, "vitals": {"spo2": 86}})
        page.wait_for_timeout(4000)
        page.evaluate("void window.sentinel.director.run([{cmd:'start_scan'}])")
        page.wait_for_function("window.__ev.some(e => e[0] === 'body.scan.complete')", timeout=120000)
        sc = page.evaluate("window.__ev.find(e => e[0] === 'body.scan.complete')[1]")
        page.wait_for_timeout(3500)
        tgt = page.evaluate("[...document.querySelectorAll('#hotspots .zone.is-target')].map(z => z.dataset.zone)")
        check("SB6 scan flags the alert zone and highlights it", sc["zones_flagged"] == ["lungs"] or ("lungs" in sc["zones_flagged"] and "lungs" in tgt), f"{sc} target={tgt}")
        page.screenshot(path=str(OUT / "07-scan-flagged.png"))
        page.evaluate("window.sentinel.director.cancel()")

        # SB7: glove mode -> touch targets at least 48 px
        page.evaluate("window.sentinel.setGlove(true)")
        page.wait_for_timeout(500)
        sizes = page.evaluate("""() => [...document.querySelectorAll('#stage-body button, #hotspots .zone, #sys-panel button, #sys-rail button')]
            .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
            .map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className.split(' ')[0] || e.textContent.trim().slice(0, 20), Math.round(r.width), Math.round(r.height)]; })""")
        small = [s for s in sizes if min(s[1], s[2]) < 48]
        check("SB7 glove mode: every body-screen target is at least 48 px", not small and len(sizes) > 10, f"{len(sizes)} targets, small: {small[:8]}")
        page.screenshot(path=str(OUT / "08-glove-mode.png"))
        page.evaluate("window.sentinel.setGlove(false)")

        # organ view: the realistic eye, the box picture rendered from the same 3D organ, the rail switching it
        page.evaluate("window.sentinel.screens.close()")
        page.evaluate("void window.sentinel.screens.open('organ', 'eyes')")
        page.wait_for_function("window.sentinel.body3d.style === 'real'", timeout=30000)
        page.wait_for_timeout(2500)
        eye = page.evaluate("""() => ({ mat: window.sentinel.body3d.nodes.eyes.material.type, img: document.querySelector('#sheet-body .organ-head img')?.src.slice(0, 22),
            title: document.querySelector('#sheet-title').textContent })""")
        check("organ view: realistic eye, and the box picture is the same 3D organ", eye["mat"] == "MeshPhysicalMaterial" and eye["img"].startswith("data:image/png") and "Eyes" in eye["title"], json.dumps(eye))
        page.screenshot(path=str(OUT / "08b-organ-eyes.png"))
        page.click("#sys-rail [data-sys='heart']")
        page.wait_for_timeout(2500)
        sw = page.evaluate("[document.querySelector('#sheet-title').textContent, window.sentinel.screens.current(), window.sentinel.body3d.lit]")
        check("the rail switches an open organ view (box and 3D agree)", "Heart" in sw[0] and sw[1] == "organ" and sw[2] == ["heart"], json.dumps(sw))
        # switching organ to organ goes straight there (no trip back to the whole body) and stays in step
        page.evaluate("window.__xr = []; const b = window.sentinel.body3d, u = b.update; b.update = (dt, t) => { u(dt, t); window.__xr.push(b.style); }")
        page.click("#sys-rail [data-sys='lungs']")
        page.wait_for_timeout(2500)
        sw2 = page.evaluate("[document.querySelector('#sheet-title').textContent, window.sentinel.body3d.lit, window.__xr.filter(s => s !== 'real').length]")
        check("organ to organ: lungs with the airway, no reset in between", "Lungs" in sw2[0] and sw2[1] == ["lungs", "airway"] and sw2[2] == 0, json.dumps(sw2))
        page.click("#sys-rail [data-sys='gut']")
        page.wait_for_timeout(2500)
        sw3 = page.evaluate("[document.querySelector('#sheet-title').textContent, window.sentinel.body3d.lit]")
        check("organ to organ: the whole gut group", "Digestion" in sw3[0] and set(sw3[1]) == {"stomach", "intestines", "liver", "pancreas_spleen"} if sw3[1] else False, json.dumps(sw3))
        page.evaluate("window.sentinel.screens.close()")
        page.wait_for_timeout(1500)

        # female body: the fit runs for her too
        page.evaluate(f"async () => fetch('../api/state/{cid}/patch', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{body_model:'female'}})}})")
        page.wait_for_function("window.sentinel.body3d.model === 'female'", timeout=60000)
        page.wait_for_timeout(2500)
        page.evaluate("void window.sentinel.director.run([{cmd:'xray', on:true, style:'anatomy'}])")
        page.wait_for_timeout(2500)
        ffit = page.evaluate("window.sentinel.body3d.debug().fit")
        check("female anatomy fitted too, legs included", bool(ffit) and ffit["ribcage"]["fitted"] > 0 and ffit["skull"]["fitted"] > 0 and ffit["limbs"]["fitted"] > 10000, json.dumps(ffit.get("limbs") if ffit else None))
        page.screenshot(path=str(OUT / "09-female-anatomy.png"))

        # the voice endpoints answer 503 on a server without voice models; that is not a body-screen error
        real = [e for e in errs if "favicon" not in e and "/api/tts" not in e and "status of 503" not in e]
        check("no page errors", not real, "; ".join(real[:5]))
        b.close()
    print(f"\n{len(failures)} failed" if failures else "\nall passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
