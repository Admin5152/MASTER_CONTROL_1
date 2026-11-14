"""Standalone browser check for the interactive planet explorer."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1200, "height": 850})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/js/main.js*", lambda route: route.abort())
    page.goto("http://127.0.0.1:8000/app/", wait_until="domcontentloaded", timeout=60000)
    page.set_content('''<base href="http://127.0.0.1:8000/app/"><link rel="stylesheet" href="css/tokens.css"><link rel="stylesheet" href="css/app.css"><script type="importmap">{"imports":{"three":"./vendor/three/three.module.js","three/addons/":"./vendor/three/jsm/"}}</script>''')
    page.evaluate("async () => { window.explorer = await import('./js/systems/planet-explorer.js'); }")
    for profile, name in [("lunar", "Moon"), ("mars_surface", "Mars"), ("mars_transit", "Mars")]:
        page.evaluate("p => { const host = document.createElement('div'); host.id = 'inline-host'; host.className = 'stage stage-radiation is-active'; document.body.append(host); window.cleanup = window.explorer.mountPlanetExplorer(host, p, 'Demo astronaut'); }", profile)
        page.wait_for_selector(".planet-inline")
        assert name in page.locator(".planet-inline h2").inner_text()
        page.locator("[data-zoom-in]").click(no_wait_after=True)
        page.locator("[data-reset]").click(no_wait_after=True)
        page.wait_for_timeout(1500)
        assert page.locator(".planet-map-marker:visible").count() > 0
        if profile in ("lunar", "mars_surface", "mars_transit"):
            assert page.locator("[data-sites] button").count() == 6
            page.locator("[data-sites] button").last.click(no_wait_after=True)
            assert "High radiation zone" in page.locator("[data-selected]").inner_text()
        else:
            assert page.locator("[data-sites] button").count() == 0
        canvas = page.locator(".planet-inline canvas").bounding_box()
        page.mouse.move(canvas['x'] + 100, canvas['y'] + 100)
        page.mouse.down()
        page.mouse.move(canvas['x'] + 200, canvas['y'] + 140, steps=10)
        page.mouse.up()
        page.evaluate("window.cleanup(); document.querySelector('#inline-host').remove()")
        assert page.locator(".planet-inline").count() == 0
        print(profile, "passed")
    assert not errors, errors
    browser.close()
