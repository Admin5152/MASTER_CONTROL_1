"""Browser smoke check for SIM world selection and surface coordinates."""
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1366, "height": 768})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("localStorage.setItem('sentinel:listen','ptt')")
    page.goto("http://127.0.0.1:8000/app/", timeout=150000)
    page.wait_for_selector("#start-screen.is-ready", timeout=150000)
    page.click("#start-btn")
    page.wait_for_function("!!window.sentinel?.director?.run", timeout=150000)
    page.evaluate("void window.sentinel.director.run([{cmd:'open_screen',name:'radiation'}])")
    page.wait_for_selector("#rad-profile", timeout=60000)
    for profile, world in [("lunar", "Moon"), ("mars_surface", "Mars"), ("mars_transit", "Mars")]:
        page.select_option("#rad-profile", profile)
        page.wait_for_function("name => document.querySelector('[data-location-world]')?.textContent.includes(name)", arg=world)
        page.wait_for_timeout(3500)
        text = page.locator("[data-location-coords]").inner_text()
        assert "SIM" in text
        if profile == "mars_transit":
            assert "No surface position" in text
        else:
            assert "surface position" in text
        out = Path("tests/screenshots")
        out.mkdir(exist_ok=True)
        page.screenshot(path=str(out / f"radiation-{profile}.png"))
        print(profile, text)
    assert not errors, errors
    browser.close()
