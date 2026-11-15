"""Load the page, tap Start, and list every request with its status (spec 9 step 2).
Usage: .venv/Scripts/python tests/resource_check.py [base_url]"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://localhost:8443"
seen = {}
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors"])
    pg = b.new_context(ignore_https_errors=True).new_page()
    pg.on("response", lambda r: seen.__setitem__(r.url.split("?")[0], r.status))
    pg.on("requestfailed", lambda r: seen.__setitem__(r.url, "FAILED"))
    pg.goto(BASE + "/app/", wait_until="networkidle")
    pg.click("#start-btn")
    pg.wait_for_timeout(8000)
    b.close()
vendor = {u: s for u, s in seen.items() if "/vendor/" in u}
bad = {u: s for u, s in seen.items() if s != 200}
print(f"{len(seen)} distinct URLs, {len(vendor)} under app/vendor/")
for u, s in sorted(vendor.items()):
    print(f"  {s}  {u.replace(BASE, '')}")
print("non-200:", bad or "none")
external = [u for u in seen if not u.startswith(BASE) and not u.startswith("data:") and not u.startswith("blob:")]
print("external hosts requested:", external or "none")
sys.exit(1 if bad or external else 0)
