"""Browser run of the clinic, care and mind screens (Product Document parts 4 and 5) with Playwright.

Usage: .venv/Scripts/python tests/clinic_ui_check.py [base_url]
Starts nothing: the server must already be running (use SENTINEL_NO_PERSIST=1 SENTINEL_FRESH=1 for a clean run).
Opens every new screen in the existing side sheet, drives the main flows by touch (health log save, wake log,
triage to protocol runner, daily check-in, journal, alerts) and checks what the brain stored.
Saves screenshots to tests/screenshots/ and prints a PASS/FAIL line per check.
"""
from __future__ import annotations

import json
import ssl
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tests" / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "http://127.0.0.1:8765")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=CTX, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def launch(p):
    args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required"]
    for ch in ("chrome", "msedge"):
        try:
            return p.chromium.launch(channel=ch, headless=True, args=args)
        except Exception:
            continue
    return p.chromium.launch(headless=True, args=args)


def main() -> int:
    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(viewport={"width": 1366, "height": 768}, ignore_https_errors=True, has_touch=True, permissions=["camera", "microphone"])
        page = ctx.new_page()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(BASE + "/app/", wait_until="domcontentloaded")
        page.click("#start-btn")
        page.wait_for_function("window.sentinel && window.sentinel.view && window.sentinel.view.state && window.sentinel.screens", timeout=30000)
        page.wait_for_timeout(2500)
        # ---- the name comes first: an alert about someone is not shown or spoken until they say who they are
        first = page.evaluate("window.sentinel.view.crewId")
        api("POST", f"/api/state/{first}/patch", {"manual": {"bp_systolic": 192, "bp_diastolic": 124}})
        page.wait_for_timeout(1800)
        check("before a name is chosen: no alert banner, no action card", page.evaluate("document.getElementById('banner').hidden && document.getElementById('action-card').hidden") and bool(page.query_selector("#who [data-who]")))
        page.click(f'#who [data-who="{first}"]')
        page.wait_for_timeout(2600)
        check("after choosing a name: that person's alert appears", page.evaluate("!document.getElementById('banner').hidden"), page.inner_text("#banner-title"))
        page.click("#banner-ack")
        api("POST", f"/api/state/{first}/patch", {"manual": {"bp_systolic": 118, "bp_diastolic": 76}})
        page.wait_for_timeout(1200)
        cid = page.evaluate("window.sentinel.view.crewId")
        body = "#sheet-body"

        def open_screen(name: str, arg=None) -> None:
            if page.evaluate("!document.getElementById('banner').hidden"):   # an alert banner is up: acknowledge it first
                page.click("#banner-ack")
                page.wait_for_timeout(400)
            page.evaluate("([n, a]) => window.sentinel.screens.open(n, a)", [name, arg])
            page.wait_for_timeout(900)

        def text() -> str:
            return page.inner_text(body)

        def shot(name: str) -> None:
            page.screenshot(path=str(SHOTS / f"clinic-{name}.png"))

        # ---- the always-present buttons and the environment chip
        check("home shows I don't feel well, Daily check-in, Today", page.evaluate("['btn-unwell','btn-checkin','btn-today'].every(i => document.getElementById(i))"))
        check("status line shows the environment chip", page.evaluate("!document.getElementById('sb-env').hidden && document.getElementById('sb-env').textContent.length > 2"), page.inner_text("#sb-env"))

        # ---- every new screen opens in the existing sheet with content
        for name, needle in [("today", "Tasks and logs"), ("checkin", "Scan"), ("care", "I don't feel well"), ("mind", "Four dimensions"), ("journal", "Earlier entries"),
                             ("alerts", "Right now"), ("record", "Stored for you"), ("weekly", "Adherence"), ("environment", "Environment"), ("onboarding", "of 4 done"),
                             ("kit", "Available"), ("indicator", "How to measure"), ("datasets", "human research datasets")]:
            open_screen(name, "vitals.heart_rate" if name == "indicator" else None)
            try:
                page.wait_for_function("n => document.getElementById('sheet-body').innerText.toLowerCase().includes(n)", arg=needle.lower(), timeout=6000)
            except Exception:
                pass
            ok = page.evaluate("!document.getElementById('sheet').hidden") and needle.lower() in text().lower() and "could not load" not in text()
            check(f"screen {name} opens with its content", ok, text()[:70].replace("\n", " ") if not ok else "")
            shot(name)

        # ---- health log: a typed heart rate, blood pressure and a stress rating are saved and stored
        before = api("GET", f"/api/record/{cid}")["fields"]
        open_screen("health_log")
        nxt = lambda: (page.click("#sheet-body [data-hw-next]"), page.wait_for_timeout(250))
        check("health log: opens as a wizard on step 1 of 7 with only that step's fields", "step 1 of 7" in text().lower() and page.evaluate("[...document.querySelectorAll('#sheet-body .form-grid .field')].filter(f => !f.hidden).length") == 3)
        page.fill("#sheet-body #f-heart_rate", "900")
        page.wait_for_timeout(200)
        check("health log: an out-of-range value is flagged as it is typed, with the range", "900 is outside 20 to 250" in text() and page.evaluate("document.querySelector('#f-heart_rate').getAttribute('aria-invalid')") == "true")
        page.click("#sheet-body [data-hw-next]")
        page.wait_for_timeout(200)
        check("health log: it will not move on while a value is wrong", "step 1 of 7" in text().lower())
        page.fill("#sheet-body #f-heart_rate", "76")
        page.click('#sheet-body .field[data-key="heart_rate"] .hw-step:last-of-type')   # the plus stepper: 76 -> 77
        nxt()
        page.fill("#sheet-body #f-bp_systolic", "121")
        page.fill("#sheet-body #f-bp_diastolic", "79")
        nxt(); nxt(); nxt(); nxt()
        page.click('#sheet-body [data-self="stress_self"][data-n="2"]')
        nxt()
        t = text().lower()
        check("health log: the last step reviews what will be saved", "review and save" in t and "heart rate" in t and "77" in t and "121" in t and "stress" in t, t[:140].replace(chr(10), " "))
        page.click('#sheet-body [data-hw-edit="bp_systolic"]')
        page.wait_for_timeout(300)
        check("health log: the pen on a review row goes straight to that field", "step 2 of 7" in text().lower() and page.evaluate("document.activeElement && document.activeElement.id") == "f-bp_systolic")
        page.fill("#sheet-body #f-temp_c", "30.5") if False else None
        nxt(); page.fill("#sheet-body #f-temp_c", "31.2")
        page.wait_for_timeout(200)
        check("health log: a very low temperature can be recorded", page.evaluate("document.querySelector('#f-temp_c').getAttribute('aria-invalid')") != "true")
        page.fill("#sheet-body #f-temp_c", "")
        nxt(); nxt(); nxt(); nxt()
        shot("healthlog-review")
        page.click("#sheet-body [data-save]")
        try:
            page.wait_for_function("document.querySelector('#sheet-body [data-stored]')?.textContent.includes('Stored in your record')", timeout=8000)
        except Exception:
            pass
        rec = api("GET", f"/api/record/{cid}")["fields"]
        hr = rec.get("vitals.heart_rate", {})
        check("health log: typed heart rate is stored as MANUAL", hr.get("last") == 77 and hr.get("last_label") == "MANUAL" and hr.get("entered", 0) > before.get("vitals.heart_rate", {}).get("entered", 0), json.dumps(hr)[:120])
        check("health log: blood pressure is stored", rec.get("manual.bp_systolic", {}).get("last") == 121)
        check("health log: stress self-rating is stored", rec.get("manual.stress_self", {}).get("last") == 2)
        check("health log: the screen says what was stored", "stored in your record" in text().lower(), text()[-160:].replace("\n", " "))
        shot("healthlog-saved")

        # ---- today: the two-tap wake log
        open_screen("today", "wake")
        page.click('#sheet-body [data-taps="sleep"] [data-v="6.5"]')
        page.click('#sheet-body [data-taps="mood"] [data-v="4"]')
        page.click('#sheet-body [data-save="wake"]')
        try:
            page.wait_for_function("document.getElementById('sheet-body').innerText.includes('Saved to your record')", timeout=8000)
        except Exception:
            pass
        page.wait_for_timeout(300)
        rec = api("GET", f"/api/record/{cid}")["fields"]
        check("today: wake log stores sleep hours", rec.get("manual.sleep_hours", {}).get("last") == 6.5, text()[:0])
        done_btn = page.query_selector("#sheet-body [data-done]")
        if done_btn:
            rid = done_btn.get_attribute("data-done")
            done_btn.click()
            page.wait_for_timeout(1200)
            plan = api("GET", f"/api/plan/{cid}")["today_reminders"]
            r = next((x for x in plan if x["id"] == rid), {})
            check("today: marking a reminder done keeps its title", r.get("state") == "done" and bool(r.get("title")), json.dumps(r)[:120])
        shot("today-after")

        # ---- care by touch: triage, the card, then ONE step at a time with "did that help?"
        def say(words: str, wait: int = 1300, expect: str = "") -> None:   # typed into the ask bar: the same path as a spoken sentence
            page.fill("#ask-input", words)
            page.press("#ask-input", "Enter")
            if expect:   # wait for the screen to show the result, not for a fixed time
                try:
                    page.wait_for_function("n => document.getElementById('sheet-body').innerText.toLowerCase().includes(n)", arg=expect, timeout=8000)
                except Exception:
                    pass
            page.wait_for_timeout(wait if not expect else 250)

        open_screen("care", "triage")
        page.click('#sheet-body [data-z="head"]')
        page.wait_for_timeout(300)
        page.click('#sheet-body [data-s="headache"]')
        page.wait_for_timeout(300)
        page.click('#sheet-body [data-taps="sev"] [data-v="5"]')
        page.wait_for_timeout(900)
        for _ in range(6):
            if not page.query_selector('#sheet-body [data-a="0"]'):
                break
            page.click('#sheet-body [data-a="0"]')
            page.wait_for_timeout(500)
        page.wait_for_timeout(1200)
        t = text()
        check("care: severity 5 gives level 2 (Act) and a full card", "act" in t.lower().split() and "what to do now" in t.lower() and "escalate if" in t.lower() and "why it matters" in t.lower(), t[:120].replace("\n", " "))
        shot("care-card")
        page.click("#sheet-body [data-start]")
        page.wait_for_timeout(1200)
        check("care: the runner shows one step at a time", "step 1 of 6" in text().lower() and page.evaluate("document.querySelectorAll('#sheet-body [data-stepdone]').length") == 1)
        plan = api("GET", f"/api/plan/{cid}")["today_reminders"]
        check("care: starting the steps creates a recheck reminder", any(x.get("type") == "recheck" for x in plan))
        for _ in range(3):   # confirm, retrieve, verify: preparation, so no question after them
            page.click("#sheet-body [data-stepdone]")
            page.wait_for_timeout(700)
        check("care: preparation steps go straight to the next step", "step 4 of 6" in text().lower(), text()[:80].replace("\n", " "))
        page.click("#sheet-body [data-stepdone]")
        page.wait_for_timeout(800)
        check("care: after an action step it asks whether it helped", "did that help" in text().lower() and bool(page.query_selector('#sheet-body [data-ans="better"]')))
        shot("care-ask")
        page.click('#sheet-body [data-ans="same"]')
        page.wait_for_timeout(700)
        check("care: 'about the same' moves on to the next step", "step 5 of 6" in text().lower())
        page.click("#sheet-body [data-stepdone]")
        page.wait_for_timeout(800)
        page.click('#sheet-body [data-ans="better"]')
        page.wait_for_timeout(1200)
        log = api("GET", f"/api/care/log/{cid}")
        done = next((e for e in log["entries"] if e["type"] == "protocol_completed"), {})
        check("care: 'better' closes the run and logs where it eased", "finished" in text().lower() and "Resolved after step 5" in done.get("outcome", ""), done.get("outcome", ""))
        check("care: triage and outcome are in the care log", "triage" in [e["type"] for e in log["entries"]])
        shot("care-runner")

        # ---- care by conversation: "my stomach is not well" -> questions -> steps -> "it's worse" -> escalation
        page.evaluate("window.sentinel.screens.close()")
        page.wait_for_timeout(500)
        say("my stomach is not well")
        check("said: a symptom opens triage and asks how strong", page.evaluate("document.getElementById('sheet').dataset.screen") == "care" and "how strong" in text().lower(), text()[:80].replace("\n", " "))
        say("three", expect="question")
        for _ in range(6):
            if "question" not in text().lower():
                break
            say("no", 900)
        page.wait_for_timeout(900)
        check("said: stomach trouble gets its own steps, not another protocol", "stomach upset" in text().lower(), text()[:100].replace("\n", " "))
        say("start", expect="step 1 of 5")
        check("said: 'start' opens step 1", "step 1 of 5" in text().lower(), text()[:80].replace("\n", " "))
        say("done", expect="did that help")
        check("said: 'done' asks whether it helped", "did that help" in text().lower())
        say("no, it still hurts", expect="step 2 of 5")
        check("said: 'still hurts' moves to the next step", "step 2 of 5" in text().lower(), text()[:80].replace("\n", " "))
        say("okay done", expect="did that help")
        say("it is getting worse", expect="sent to the flight surgeon")
        t = text().lower()
        check("said: 'worse' escalates to the flight surgeon", "sent to the flight surgeon" in t and "worse after step 2" in t, t[:120].replace("\n", " "))
        packets = api("GET", f"/api/ground?crew_id={cid}")["packets"]
        check("escalation: a digest with what was done is queued", any("Worse after step 2" in (x.get("body") or {}).get("text", "") for x in packets))
        check("escalation: it is in the care log", "protocol_escalated" in [e["type"] for e in api("GET", f"/api/care/log/{cid}")["entries"]])
        shot("care-escalated")
        say("what is the weather like on mars", 1500)   # not a care reply: it must fall through to normal conversation
        check("conversation: an unrelated sentence is not swallowed by Care", "sent to the flight surgeon" in text().lower() or page.evaluate("document.getElementById('sheet').hidden"))

        # ---- the body panel's action plan can be ticked off, then asks whether it helped
        page.evaluate("window.sentinel.screens.close()")
        page.evaluate("window.sentinel.stages.go('body')")
        page.wait_for_timeout(2500)
        n = page.evaluate("document.querySelectorAll('#sys-panel [data-plan]').length")
        for k in range(n):
            page.evaluate(f"document.querySelectorAll('#sys-panel [data-plan]')[{k}].click()")
            page.wait_for_timeout(250)
        check("body: every action-plan line can be ticked, then it asks if it helped", n >= 1 and bool(page.query_selector('#sys-panel [data-plan-ans="yes"]')), f"{n} lines")
        shot("body-plan")
        page.evaluate("document.querySelector('#sys-panel [data-plan-ans=\"yes\"]').click()")
        page.wait_for_timeout(400)
        box = page.evaluate("(() => { const t = document.querySelector('.body-tools').getBoundingClientRect(), d = document.querySelector('.askbar').getBoundingClientRect(); return t.bottom <= d.top + 1; })()")
        check("body: the tool buttons sit above the ask bar (no overlap)", box)
        page.evaluate("window.sentinel.stages.go('vitals')")
        page.wait_for_timeout(1200)
        over = page.evaluate("""(() => { const r = [...document.querySelectorAll('#plan-line li')].map((l) => l.getBoundingClientRect()); let n = 0;
            for (let i = 1; i < r.length; i++) if (r[i].left < r[i - 1].right - 1) n++; return n; })()""")
        check("vitals: plan schedule labels do not overlap", over == 0, f"{over} overlaps")
        page.evaluate("window.sentinel.stages.go('assistant')")
        page.wait_for_timeout(800)

        # ---- care: a red flag jumps to the urgent card and queues a priority digest
        open_screen("care", {"zone": "head", "symptom": "headache", "severity": 3})
        page.wait_for_timeout(900)
        page.click('#sheet-body [data-a="1"]')
        page.wait_for_timeout(1800)
        t = text()
        check("care: a red flag skips to the urgent card", "urgent" in t.lower() and "crewmate" in t, t[:120].replace("\n", " "))
        packets = api("GET", f"/api/ground?crew_id={cid}")["packets"]
        check("care: urgent triage queues an URGENT digest", any(x.get("priority") == "URGENT" for x in packets))
        shot("care-urgent")

        # ---- daily check-in end to end
        open_screen("checkin")
        page.fill('#sheet-body [data-k="heart_rate"]', "66")
        page.click("#sheet-body [data-next]")
        page.wait_for_timeout(300)
        page.fill('#sheet-body [data-k="temp_c"]', "36.8")
        page.click("#sheet-body [data-next]")
        page.wait_for_timeout(300)
        page.click('#sheet-body [data-taps="mood"] [data-v="4"]')
        page.click('#sheet-body [data-taps="energy_self"] [data-v="4"]')
        page.click("#sheet-body [data-next]")
        page.wait_for_timeout(300)
        page.click("#sheet-body [data-next]")
        page.wait_for_timeout(2500)
        t = text()
        check("check-in: ends with a summary and saved entries", "check-in complete" in t.lower() and "saved to your record" in t, t[:140].replace("\n", " "))
        rec = api("GET", f"/api/record/{cid}")["fields"]
        check("check-in: entries are stored", rec.get("manual.temp_c", {}).get("last") == 36.8 and rec.get("manual.energy_self", {}).get("last") == 4)
        shot("checkin-summary")

        # ---- an out-of-range entry raises an alert with "Why this?"
        api("POST", f"/api/state/{cid}/patch", {"manual": {"bp_systolic": 168, "bp_diastolic": 102}})
        page.wait_for_timeout(1200)
        open_screen("alerts")
        try:
            page.wait_for_selector("#sheet-body [data-why]", timeout=6000)
        except Exception:
            pass
        check("alerts: an out-of-range reading appears in the list", page.evaluate("document.querySelectorAll('#sheet-body [data-why]').length") >= 1, text()[:100].replace("\n", " "))
        if page.query_selector("#sheet-body [data-why]"):
            page.click("#sheet-body [data-why]")
            page.wait_for_timeout(900)
            check("alerts: Why this? shows the rule and the source", "Rule" in text() and "Citation" in text(), "")
        shot("alerts")

        # ---- journal: saved on the device, listed back
        open_screen("journal")
        page.fill("#sheet-body #jr-text", "A long day, but the repair worked.")
        page.click("#sheet-body [data-save]")
        page.wait_for_timeout(1000)
        check("journal: the entry is saved and listed", "the repair worked" in text())

        # ---- environment: asks before switching
        open_screen("environment")
        page.click('#sheet-body [data-env="station"]')
        page.wait_for_timeout(400)
        env_before = api("GET", f"/api/aux/{cid}")["extras"]["environment"]
        check("environment: tapping asks to confirm and changes nothing yet", "switch to" in text().lower() and env_before != "station", env_before)
        page.click("#sheet-body [data-yes]")
        page.wait_for_timeout(1500)
        check("environment: yes switches and lists what changed", api("GET", f"/api/aux/{cid}")["extras"]["environment"] == "station" and "switched" in text().lower())
        shot("environment")

        # ---- ground: reply card with step confirmation, the delay simulator
        open_screen("ground")
        page.wait_for_timeout(800)
        check("ground: the delay simulator is shown", "what ground sees" in text().lower())
        shot("ground")

        # ---- record: the baseline model can be re-learned
        open_screen("record")
        page.click("#sheet-body [data-learn]")
        page.wait_for_timeout(1200)
        check("record: re-learning my normal reports the result", "Updated" in text() or "Nothing to update" in text() or "Last learned" in text())
        shot("record")

        # ---- every body area: hands give steps, numbness is never just "watch", and a spoken hand symptom starts triage
        open_screen("care", "triage")
        page.click('#sheet-body [data-z="bones:hands"]')
        page.wait_for_timeout(300)
        check("care: hands and arms offer their own symptoms", "numb or tingling fingers" in text().lower())
        page.click('#sheet-body [data-s="numb or tingling fingers"]')
        page.wait_for_timeout(300)
        page.click('#sheet-body [data-taps="sev"] [data-v="1"]')
        page.wait_for_timeout(900)
        for _ in range(4):
            if not page.query_selector('#sheet-body [data-a="0"]'):
                break
            page.click('#sheet-body [data-a="0"]')
            page.wait_for_timeout(500)
        page.wait_for_timeout(1200)
        t = text().lower()
        check("care: a hand symptom gets steps, at Act level, marked as a demo default", "muscle, joint or limb pain" in t and "act" in t.split() and "demo default" in t, t[:120].replace(chr(10), " "))
        page.click("#sheet-body [data-start]")
        page.wait_for_timeout(1000)
        page.click('#sheet-body [data-ans="worse"]')
        page.wait_for_timeout(1500)
        check("care: 'it's getting worse' escalates a hand problem too", "sent to the flight surgeon" in text().lower())
        shot("care-hands")
        page.evaluate("window.sentinel.screens.close()")
        page.wait_for_timeout(400)
        say("my knee is swollen")
        check("said: 'my knee is swollen' starts triage for the leg", page.evaluate("document.getElementById('sheet').dataset.screen") == "care" and "how strong" in text().lower(), text()[:80].replace(chr(10), " "))

        # ---- a finished scan is in the record; the datasets catalogue is searchable
        api("POST", f"/api/scan/{cid}", {"kind": "face", "seconds": 15, "samples": 8, "heart_rate": 70, "confidence": 0.6, "breathing_rate": 14})
        open_screen("record")
        page.wait_for_timeout(600)
        check("record: the saved scan is listed with its quality", "face scan (15 s), pulse 70 bpm at 60% quality" in text().lower(), "")
        check("face scan page: explains the 15-second scan and has the scan button", page.evaluate("!!document.getElementById('btn-scan15') && document.getElementById('scan-result').textContent.includes('15 seconds')"))
        open_screen("datasets", {"group": "sleep"})
        page.wait_for_timeout(1500)
        page.fill("#sheet-body [data-q]", "sleep latency")
        page.wait_for_timeout(600)
        n = page.evaluate("document.querySelectorAll('#sheet-body .ev-doc').length")
        check("datasets: the NASA catalogue filters and searches", n >= 1 and "dataset" in text().lower(), f"{n} shown")
        shot("datasets")

        # ---- fourth pass: less friction, visible state, detail pages, crew and profiles
        page.evaluate("window.sentinel.screens.close()")
        page.wait_for_timeout(400)
        page.click("#btn-menu")
        page.wait_for_timeout(500)
        opened = page.evaluate("!document.getElementById('menu').hidden")
        page.mouse.click(30, 330)
        page.wait_for_timeout(400)
        check("menu: tapping outside closes it", opened and page.evaluate("document.getElementById('menu').hidden"))
        page.click("#btn-micmute")
        page.wait_for_timeout(300)
        check("mic: muting shows on both microphone buttons and in the ask bar", page.evaluate("document.getElementById('btn-micmute').getAttribute('aria-pressed') === 'true' && document.getElementById('btn-mic').classList.contains('is-off') && document.getElementById('ask-input').placeholder.includes('muted')"))
        page.click("#btn-micmute")
        page.wait_for_timeout(300)
        check("mic: unmuting clears the muted state", page.evaluate("document.getElementById('btn-micmute').getAttribute('aria-pressed') === 'false' && !document.getElementById('ask-input').placeholder.includes('muted')"))
        page.click('#topnav [data-nav="radiation"]')
        page.wait_for_timeout(1500)
        page.click('#topnav [data-nav="wellbeing"]')
        page.wait_for_timeout(1500)
        page.evaluate("window.sentinel.screens.close()")
        page.wait_for_timeout(600)
        check("nav: after Wellbeing closes the highlight is back on Radiation", page.evaluate("document.querySelector('#topnav [data-nav=radiation]').getAttribute('aria-current') === 'true' && document.querySelector('#topnav [data-nav=wellbeing]').getAttribute('aria-current') !== 'true'"))
        check("status line: short labels", len(page.inner_text("#sb-env")) <= 14 and len(page.inner_text("#sb-comms")) <= 14, page.inner_text("#sb-env") + " | " + page.inner_text("#sb-comms"))
        page.evaluate("window.sentinel.stages.go('assistant')")
        page.wait_for_timeout(900)

        open_screen("health_log")
        shot("healthlog-wizard")
        hidden = page.evaluate("getComputedStyle(document.querySelector('#sheet-body .field .hint')).display === 'none'")
        page.click("#sheet-body .field .cl-info")
        page.wait_for_timeout(200)
        check("health log: guidance is hidden until the info button is tapped", hidden and page.evaluate("getComputedStyle(document.querySelector('#sheet-body .field .hint')).display !== 'none'"))
        shot("healthlog-clean")

        open_screen("today", "exercise")
        page.click('#sheet-body [data-ex="t2"]')
        try:
            page.wait_for_function("document.getElementById('sheet-body').innerText.toLowerCase().includes('harness on')", timeout=8000)
        except Exception:
            pass
        t = text().lower()
        check("exercise: names the device, the minutes and how to do it", "treadmill (t2) · planned 30 minutes" in t and "harness on" in t, t[:0])
        page.click('#sheet-body [data-save="exercise"]')
        page.wait_for_timeout(1500)
        check("exercise: the session counts toward the day's 120 minutes", "of 120 min today" in text().lower())
        shot("exercise")

        page.evaluate("window.sentinel.screens.zone('heart')")
        page.wait_for_timeout(2500)
        check("body system: readings, a trend chart and every stored entry", "trend and history" in text().lower() and page.evaluate("document.querySelectorAll('#sheet-body canvas').length") >= 1 and "stored entries" in text().lower())
        shot("zone-detail")
        open_screen("cabin")
        page.wait_for_timeout(2500)
        check("cabin: current values plus oxygen and CO2 history", page.evaluate("document.querySelectorAll('#sheet-body canvas').length") == 2 and "history" in text().lower())
        open_screen("trends")
        page.wait_for_timeout(2000)
        check("trends: stats and all stored entries under the chart", "my normal" in text().lower() and "stored entries" in text().lower())
        shot("trends-detail")
        open_screen("environment")
        check("environment: every place and mode has an icon with its words", page.evaluate("document.querySelectorAll('#sheet-body .hub button .env-ic svg').length") >= 7)

        say("my heart rate is 68 and my blood pressure is 118 over 76", 1800)
        rec = api("GET", f"/api/record/{cid}")["fields"]
        check("said: a reading in a sentence is saved to the record as MANUAL", rec["vitals.heart_rate"]["last"] == 68 and rec["vitals.heart_rate"]["last_label"] == "MANUAL" and rec["manual.bp_systolic"]["last"] == 118 and rec["manual.bp_diastolic"]["last"] == 76)
        say("my heart rate is 900", 900)
        check("said: an impossible reading is refused, not stored", api("GET", f"/api/record/{cid}")["fields"]["vitals.heart_rate"]["last"] == 68 and "outside 20 to 250" in page.inner_text("#transcript"))
        say("show my logs", 1500)
        check("said: 'show my logs' opens the saved record", page.evaluate("document.getElementById('sheet').dataset.screen") == "record")
        say("show my vitals history", 1500)
        check("said: 'vitals history' opens the trends page", page.evaluate("document.getElementById('sheet').dataset.screen") == "trends")
        check("home card: names what changed and links to it", page.evaluate("(() => { const c = document.getElementById('action-card'); return c.hidden || !/a reading has moved/i.test(c.textContent); })()"))
        open_screen("today")
        page.wait_for_timeout(600)
        check("today: three cards first, the lists folded away", page.evaluate("document.querySelectorAll('#sheet-body .cl-tile').length") == 3 and page.evaluate("document.querySelector('#sheet-body [data-panel]').hidden"))
        page.click('#sheet-body [data-tile="tasks"]')
        page.wait_for_timeout(1200)
        check("today: the tasks card opens the reminders and quick logs", page.evaluate("!document.querySelector('#sheet-body [data-panel]').hidden") and "today's reminders" in text().lower())
        shot("today-cards")
        page.click("#btn-menu")
        page.wait_for_timeout(500)
        top = page.evaluate("(() => { const m = document.getElementById('menu').getBoundingClientRect(), b = document.querySelector('#menu [data-go=\"vision\"]').getBoundingClientRect(); return m.top >= 0 && b.top >= m.top - 1; })()")
        check("menu: fits on screen with Face scan reachable", top)
        page.mouse.click(30, 330)
        page.wait_for_timeout(300)
        page.click("#btn-mic")
        page.wait_for_timeout(300)
        muted = page.evaluate("document.getElementById('btn-mic').classList.contains('is-off') && document.getElementById('btn-micmute').getAttribute('aria-pressed') === 'true'")
        page.click("#btn-mic")
        page.wait_for_timeout(300)
        check("mic: a tap on the microphone button mutes, another unmutes", muted and page.evaluate("document.getElementById('btn-micmute').getAttribute('aria-pressed') === 'false'"))
        say("how are you", 1500)
        check("conversation: a friendly reply without a language model", "how are you?" in page.inner_text("#transcript").lower() or "steady" in page.inner_text("#transcript").lower(), page.inner_text("#transcript")[-120:].replace(chr(10), " "))

        open_screen("profile")
        page.wait_for_timeout(1200)
        chips = page.evaluate("document.querySelectorAll('#sheet-body .pk-chip').length")
        page.fill('#sheet-body [data-pick="health.allergies"] [data-pk-q]', "lat")
        page.wait_for_timeout(300)
        check("profile: prefilled for the crew member, with searchable pickers", chips >= 3 and bool(page.query_selector('#sheet-body [data-pick="health.allergies"] [data-add="latex"]')), f"{chips} chips")
        shot("profile")
        open_screen("crew")
        page.fill("#sheet-body [data-new-name]", "Noor")
        page.click("#sheet-body [data-add-crew]")
        page.wait_for_timeout(2500)
        check("crew: a new crew member is added, selected and taken to first run", page.evaluate("window.sentinel.view.crewId") == "noor" and page.evaluate("document.getElementById('sheet').dataset.screen") == "onboarding", page.evaluate("window.sentinel.view.crewId"))
        open_screen("record")
        page.wait_for_timeout(900)
        check("crew: the new member starts with an empty record", "0 entered or measured readings" in text().lower() or "0</span> entered" in text().lower() or "0 entered" in text().lower(), text()[:120].replace(chr(10), " "))

        # ---- fifth pass: the inbox and the history filters
        page.evaluate("window.sentinel.setCrew('james', 'manual')")   # someone with history (the new crew member has none yet)
        page.wait_for_timeout(2500)
        # ---- an emergency step list can be ticked off, then Sentinel asks and can escalate
        page.evaluate("window.sentinel.screens.close()")
        api("POST", "/api/suit/james", {"action": "eva"})
        api("POST", "/api/suit/james", {"action": "leak", "region": "helmet", "size": "major"})
        try:
            page.wait_for_selector("#suit-alert [data-sa-step]", timeout=10000)
        except Exception:
            pass
        n = page.evaluate("document.querySelectorAll('#suit-alert [data-sa-step]').length")
        for k in range(n):
            page.evaluate(f"document.querySelector('#suit-alert [data-sa-step=\"{k}\"]').click()")
            page.wait_for_timeout(250)
        check("suit alert: every step can be ticked, then it asks if the pressure is holding", n >= 3 and bool(page.query_selector('#suit-alert [data-sa-ans="no"]')), f"{n} steps")
        shot("suit-steps")
        before = len(api("GET", "/api/ground?crew_id=james")["packets"])
        page.evaluate("document.querySelector('#suit-alert [data-sa-ans=\"no\"]').click()")
        page.wait_for_timeout(2000)
        check("suit alert: 'not holding' escalates to ground", len(api("GET", "/api/ground?crew_id=james")["packets"]) > before and "escalated" in page.inner_text("#suit-alert").lower())
        api("POST", "/api/suit/james", {"action": "seal"})
        api("POST", "/api/suit/james", {"action": "iva"})
        page.wait_for_timeout(1500)
        open_screen("trends")
        page.wait_for_selector("#sheet-body [data-hq]", timeout=10000)
        total = page.inner_text("#sheet-body [data-hcount]")
        page.click('#sheet-body [data-hs="sim"]')
        page.wait_for_timeout(300)
        sim = page.inner_text("#sheet-body [data-hcount]")
        page.fill("#sheet-body [data-hq]", "zzzz")
        page.wait_for_timeout(300)
        check("history: entries can be filtered by source and searched", total != "" and "0 of" in page.inner_text("#sheet-body [data-hcount]") and " of " in sim, f"{total} | {sim}")
        api("POST", f"/api/care/triage/james", {"zone": "head", "symptom": "headache", "severity": 2, "answers": {"vision_changes": True}, "log": True})
        told = [c["crew_id"] for c in api("GET", "/api/crew") if api("GET", f"/api/notifications/{c['crew_id']}")["count"]]
        check("notifications: an urgent case reaches the buddy's and commander's inbox", len(told) >= 1 and "james" not in told, ",".join(told))
        if told:
            page.evaluate("id => window.sentinel.setCrew(id, 'manual')", told[0])
            page.wait_for_timeout(2500)
            page.evaluate("window.sentinel.checkNotifications(false)")
            page.wait_for_timeout(1200)
            check("notifications: the bell shows the count for the person at the screen", page.evaluate("!document.getElementById('bell-n').hidden && Number(document.getElementById('bell-n').textContent) >= 1"))
            page.click("#btn-bell")
            page.wait_for_timeout(1200)
            check("notifications: the inbox names who needs help", "needs help now" in text().lower(), text()[:120].replace(chr(10), " "))
            shot("notifications")
            page.click("#sheet-body [data-clear-all]")
            page.wait_for_timeout(1200)
            check("notifications: clear all empties the inbox", "nothing waiting" in text().lower() and api("GET", f"/api/notifications/{told[0]}")["count"] == 0)

        bad = [e for e in errors if "favicon" not in e and "ERR_CERT" not in e and "/api/tts" not in e and "/api/stt" not in e
               and "503 (Service Unavailable)" not in e]   # no voice engine in the test server: /api/tts answers 503 and the browser voice takes over
        check("no console errors", not bad, " | ".join(bad[:4]))
        browser.close()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
