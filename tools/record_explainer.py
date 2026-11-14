"""Record the Sentinel explainer: a narrated walk through the real app, opening on a hook, with facts on screen.

What it does:
1. Voices the narration with ElevenLabs (a narrator voice, distinct from Sentinel's), cached on disk so a re-run
   costs nothing. Every number the narrator says is in FACTS below with its source.
2. Drives the real app in Chrome. Each chapter opens on Sentinel's Overview with a fact card docked beside the orb, built
   as the app's own glass panel (its tokens, fonts, radius), while the narrator speaks; then the feature runs live and
   Sentinel speaks for itself.
3. Captures the screen straight from Chrome (DevTools screencast, 1920x1080) and Sentinel's voice from inside the
   page, then lays narration and voice over the picture with ffmpeg. Chrome is muted: nothing plays out loud.

    .venv/Scripts/python tools/record_explainer.py https://127.0.0.1:8443 video/explainer

Outputs sentinel-explainer.mp4 and sentinel-explainer.srt (narration subtitles) in the output folder.
"""
import asyncio, base64, hashlib, json, os, shutil, subprocess, sys, time, wave
from pathlib import Path

import httpx
from dotenv import load_dotenv
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
B, OUT = sys.argv[1], Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
NARR = OUT / "narration"; NARR.mkdir(exist_ok=True)
FRAMES = OUT / "frames"
CID = "james"
NARRATOR = ("JBFqnCBsd6RMkjVDRZzb", "George")          # premade ElevenLabs voice; Sentinel itself speaks as River
MODEL = "eleven_multilingual_v2"
W, H = 1920, 1080

# Every figure on screen or in the narration, with where it comes from.
FACTS = {
    "22 minutes": "Mars to Earth one-way light time at the greatest distance, about 401 million km (NASA).",
    "about three years": "Round-trip crewed Mars mission (NASA).",
    "1 to 1.5% a month": "Bone mineral density loss in microgravity (NASA).",
    "five hazards": "Radiation, isolation and confinement, distance from Earth, gravity, hostile closed environments (NASA Human Research Program).",
    "4.3 psi": "Operating pressure of NASA's EMU spacesuit; sea level is 14.7 psi.",
    "19.5% oxygen": "Below this, air is oxygen-deficient (OSHA); Earth's air is 20.9%.",
    "two weeks every 26 months": "Mars solar conjunction (NASA).",
    "68 documents": "NASA JSC 28913 Medical Requirements Integration Documents parsed into shared/nasa_mrid.json.",
    "16 sunrises a day": "International Space Station orbits (NASA).",
}

N = {
    "hook1": "Twenty-two minutes. That is how long a radio signal can take to travel from Mars to Earth. Every question to mission control waits that long, and the answer takes just as long to come back.",
    "hook2": "A crewed mission to Mars lasts about three years. No hospital. No house calls. So the help has to travel with the crew.",
    "intro": "This is Sentinel, from COSMOcare. A health companion that lives on board, knows every astronaut, and keeps working when Earth goes quiet. What follows is the real app, end to end.",
    "you": "There is no login. Each astronaut just says who they are, and every reading is compared with their own normal, not a textbook average. Everything here works by voice. For this video, the commands are typed, so you can read them.",
    "twin": "In microgravity, astronauts can lose one to one and a half percent of their bone density every month. The body changes quietly, so Sentinel looks at all of it, system by system, on a digital twin.",
    "wear": "NASA names five hazards of human spaceflight, and radiation comes first. SpaceWear, the crew's wearables, streams heart rate, oxygen and radiation dose. Every part can be explored by voice, and alerts reach the wrist.",
    "eva": "A spacesuit holds about four point three pounds per square inch, less than a third of the pressure at sea level. Outside the station, a small leak is an emergency.",
    "leak": "Sentinel finds the leak, turns that part of the twin red, and gives the crew the steps, in order.",
    "cabin": "Some problems can't wait for a question. If cabin oxygen falls below nineteen and a half percent, Sentinel takes over every screen at once.",
    "quiet": "About every twenty-six months, Mars passes behind the Sun, and contact is lost for around two weeks. Sentinel keeps working on board, and holds its reports for the ground until the link returns.",
    "nasa": "Its medical knowledge is built on sixty-eight NASA Medical Requirements Integration Documents. Ask it anything about space, and it can show you where the answer comes from.",
    "mind": "In orbit, the crew sees sixteen sunrises a day. On the way to Mars, the same few faces for years. Sentinel looks after the mind as well. Stillpoint is a guided pause for the heavy moments.",
    "private": "Health data stays on board, encrypted at rest. Until someone says its name, speech is transcribed on the device, and nothing leaves it. And a new device must pair with a PIN before it sees anything.",
    "end": "Sentinel. So that no one out there is ever alone with a problem.",
}

# hook and end: full-screen title cards; chapters: app panels docked inside the live interface
CARDS = {
    "hook1": {"opaque": True, "track": True, "big": "22 minutes", "line": "for one message to cross from Mars to Earth", "src": "NASA · one-way light time"},
    "hook2": {"opaque": True, "big": "≈ 3 years", "line": "a crewed Mars mission, there and back. No hospital. No house calls.", "src": "NASA"},
    "you": {"label": "01 · It knows you", "big": "Your normal", "line": "Every reading is compared with that astronaut's own baseline, not a population average."},
    "twin": {"label": "02 · Digital twin", "big": "1–1.5%", "line": "of bone density can be lost each month in microgravity", "src": "NASA"},
    "wear": {"label": "03 · SpaceWear", "big": "5 hazards", "line": "Radiation · Isolation · Distance · Gravity · Hostile environments", "src": "NASA Human Research Program"},
    "eva": {"label": "04 · Spacewalks", "big": "4.3 psi", "line": "inside a spacesuit: less than a third of the air pressure at sea level", "src": "NASA EMU"},
    "cabin": {"label": "05 · The cabin", "big": "19.5%", "line": "oxygen: below this, air counts as oxygen-deficient. Earth's air is 20.9%.", "src": "OSHA"},
    "quiet": {"label": "06 · When Earth goes quiet", "big": "≈ 2 weeks", "line": "without contact when Mars passes behind the Sun, about every 26 months", "src": "NASA · solar conjunction"},
    "nasa": {"label": "07 · Grounded in NASA", "big": "68", "line": "NASA Medical Requirements Integration Documents, built in", "src": "NASA JSC 28913"},
    "mind": {"label": "08 · The mind, too", "big": "16 sunrises", "line": "a day in orbit. Sleep and mood need care as much as the body.", "src": "NASA"},
    "private": {"label": "09 · Private by design", "list": [["On board", "Health data never leaves the spacecraft unasked, and is encrypted at rest."],
                                                           ["On device", "Until you say “Sentinel”, speech is transcribed locally."],
                                                           ["Paired", "Another device needs the laptop's PIN before it sees anything."]]},
    "end": {"opaque": True, "logo": True, "big": "Sentinel", "line": "So that no one out there is ever alone with a problem.", "src": "COSMOcare"},
}

OVERLAY = r"""(() => {
  const css = `
  #xv{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .8s ease;
      background:rgba(4,8,16,.74)}
  #xv.opaque{background:radial-gradient(120% 90% at 50% 40%,#0b1424 0%,#03060c 70%)}
  #xv.on{opacity:1}
  #xv .in{display:grid;gap:22px;justify-items:center;text-align:center;max-width:min(1040px,86vw);transform:translateY(14px);transition:transform 1.1s cubic-bezier(.2,.7,.2,1)}
  #xv.on .in{transform:none}
  #xv .lab{font-family:var(--font-label);font-size:13px;letter-spacing:.34em;text-transform:uppercase;color:var(--assist)}
  #xv .big{font-family:var(--font);font-weight:200;font-size:132px;line-height:1;letter-spacing:-.02em;color:var(--ink)}
  #xv .line{font-family:var(--font);font-weight:300;font-size:25px;line-height:1.45;color:var(--ink-2);max-width:36ch;text-wrap:balance}
  #xv .src{font-family:var(--font-label);font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-3);margin-top:6px}
  #xv .track{position:relative;width:620px;height:2px;margin:6px 0 18px;background:linear-gradient(90deg,#d9734a,rgba(255,255,255,.14) 50%,var(--assist))}
  #xv .track i{position:absolute;top:-6px;width:14px;height:14px;border-radius:50%}
  #xv .track .a{left:-7px;background:#d9734a;box-shadow:0 0 18px #d9734a}
  #xv .track .b{right:-7px;background:var(--assist);box-shadow:0 0 18px var(--assist)}
  #xv .track .p{top:-3px;width:8px;height:8px;background:var(--ink);box-shadow:0 0 14px var(--ink);animation:xvgo 9s linear forwards}
  #xv .track span{position:absolute;top:16px;font-family:var(--font-label);font-size:10px;letter-spacing:.28em;color:var(--ink-3)}
  #xv .track .ma{left:-14px} #xv .track .mb{right:-18px}
  @keyframes xvgo{from{left:0}to{left:calc(100% - 8px)}}
  #xv .list{display:grid;gap:18px;margin-top:10px;text-align:left;width:min(820px,80vw)}
  #xv .row{display:grid;grid-template-columns:150px 1fr;gap:24px;align-items:baseline;padding:18px 26px;border-radius:22px;
      background:var(--surface);border:1px solid var(--rule);opacity:0;transform:translateY(10px);transition:opacity .7s ease,transform .7s ease}
  #xv.on .row{opacity:1;transform:none}
  #xv .row b{font-family:var(--font-label);font-weight:400;font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--nominal)}
  #xv .row span{font-size:21px;font-weight:300;color:var(--ink);line-height:1.4}
  #xv .logo{color:var(--ink);transform:scale(1.25);margin-bottom:12px}
  /* chapter cards: the app's own glass panel, docked in the free space left of Sentinel's orb */
  #xvc{position:fixed;left:56px;top:50%;width:380px;z-index:2147482000;padding:28px 30px 24px;display:grid;gap:10px;pointer-events:none;
      opacity:0;transform:translate(-32px,-50%);transition:opacity .6s ease,transform .9s cubic-bezier(.2,.7,.2,1)}
  #xvc.on{opacity:1;transform:translate(0,-50%)}
  #xvc.wide{width:500px}
  #xvc .lab{font-family:var(--font-label);font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:var(--assist)}
  #xvc .big{font-family:var(--font);font-weight:200;font-size:56px;line-height:1.02;letter-spacing:-.02em;color:var(--ink);margin-top:8px}
  #xvc .line{font-family:var(--font);font-weight:300;font-size:17px;line-height:1.5;color:var(--ink-2)}
  #xvc .src{display:flex;align-items:center;gap:9px;margin-top:8px;padding-top:14px;border-top:1px solid var(--rule);
      font-family:var(--font-label);font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-3)}
  #xvc .src::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--nominal);box-shadow:0 0 8px var(--nominal)}
  #xvc .rows{display:grid;gap:12px;margin-top:8px}
  #xvc .r{display:grid;gap:4px;padding:14px 16px;border-radius:16px;background:var(--surface-sunk, rgba(255,255,255,.03));border:1px solid var(--rule);
      opacity:0;transform:translateY(8px);transition:opacity .6s ease,transform .6s ease}
  #xvc.on .r{opacity:1;transform:none}
  #xvc .r b{font-family:var(--font-label);font-weight:400;font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:var(--nominal)}
  #xvc .r span{font-size:16px;font-weight:300;line-height:1.45;color:var(--ink)}`;
  window.__xv = {
    show(c) {
      if (!document.getElementById("xv-css")) { const st = document.createElement("style"); st.id = "xv-css"; st.textContent = css; document.head.appendChild(st); }
      const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
      if (!c.opaque) {   // a chapter card: an app panel inside the live interface
        let d = document.getElementById("xvc");
        if (!d) { d = document.createElement("aside"); d.id = "xvc"; d.className = "panel"; document.body.appendChild(d); }
        let h = "";
        if (c.label) h += `<div class="lab">${esc(c.label)}</div>`;
        if (c.big) h += `<div class="big">${esc(c.big)}</div>`;
        if (c.line) h += `<div class="line">${esc(c.line)}</div>`;
        if (c.list) h += '<div class="rows">' + c.list.map(([k, v], i) => `<div class="r" style="transition-delay:${0.5 + i * 0.9}s"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("") + "</div>";
        if (c.src) h += `<div class="src">${esc(c.src)}</div>`;
        d.innerHTML = h; d.classList.toggle("wide", !!c.list);
        d.classList.remove("on"); void d.offsetWidth; d.classList.add("on");
        return;
      }
      let el = document.getElementById("xv");
      if (!el) { el = document.createElement("div"); el.id = "xv"; document.body.appendChild(el); }
      let h = '<div class="in">';
      if (c.logo) { const l = document.querySelector(".intro-logo"); if (l) h += `<div class="logo">${l.innerHTML}</div>`; }
      if (c.label) h += `<div class="lab">${esc(c.label)}</div>`;
      if (c.track) h += '<div class="track"><i class="a"></i><i class="p"></i><i class="b"></i><span class="ma">MARS</span><span class="mb">EARTH</span></div>';
      if (c.big) h += `<div class="big">${esc(c.big)}</div>`;
      if (c.line) h += `<div class="line">${esc(c.line)}</div>`;
      if (c.list) h += '<div class="list">' + c.list.map(([k, v], i) => `<div class="row" style="transition-delay:${0.5 + i * 0.9}s"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("") + "</div>";
      if (c.src) h += `<div class="src">${esc(c.src)}</div>`;
      el.innerHTML = h + "</div>";
      el.classList.toggle("opaque", !!c.opaque);
      el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    },
    hide() { document.getElementById("xv")?.classList.remove("on"); document.getElementById("xvc")?.classList.remove("on"); },
  };
})();"""

HOOK = """(() => {
  window.__active = 0;
  const st = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    const buf = this.buffer;
    if (buf && buf.duration > 0.3 && window.__clip) {
      const d = buf.getChannelData(0), pcm = new Int16Array(d.length);
      for (let i = 0; i < d.length; i++) pcm[i] = Math.max(-1, Math.min(1, d[i])) * 32767;
      let bin = ""; const u8 = new Uint8Array(pcm.buffer);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      window.__clip(Date.now(), buf.sampleRate, btoa(bin));
      window.__active++; this.addEventListener("ended", () => { window.__active--; });
    }
    return st.apply(this, a);
  };
})();"""


# ---------- 1. narration ----------
def voice_narration() -> dict:
    key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    files, spent = {}, 0
    for k, text in N.items():
        f = NARR / f"{k}-{hashlib.sha1((NARRATOR[0] + MODEL + text).encode()).hexdigest()[:10]}.mp3"
        if not f.exists():
            r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{NARRATOR[0]}?output_format=mp3_44100_128",
                           headers={"xi-api-key": key}, timeout=60,
                           json={"text": text, "model_id": MODEL, "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.1}})
            r.raise_for_status(); f.write_bytes(r.content); spent += len(text)
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                                   capture_output=True, text=True, check=True).stdout.strip())
        files[k] = (f, dur)
    if spent:   # keep the app's ElevenLabs meter honest
        u = ROOT / "data" / "tts_usage.json"
        try:
            j = json.loads(u.read_text()); j["eleven_chars"] = j.get("eleven_chars", 0) + spent; u.write_text(json.dumps(j))
        except (OSError, ValueError):
            pass
    print(f"narration: {len(files)} parts, {sum(d for _, d in files.values()):.0f} s, {spent} new characters")
    return files


# ---------- 2. the run ----------
async def run(narr: dict):
    api = httpx.AsyncClient(base_url=B, verify=False, timeout=30)
    clips, spoken, frames = [], [], []
    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    FRAMES.mkdir()
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=False, args=[
            "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
            "--window-size=1640,1020", "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
        ctx = await b.new_context(ignore_https_errors=True, viewport={"width": 1600, "height": 900}, device_scale_factor=1.2)
        await ctx.expose_binding("__clip", lambda src, t, sr, b64: clips.append((t / 1000.0, sr, b64)))
        await ctx.add_init_script(HOOK)
        await ctx.add_init_script(OVERLAY)
        await ctx.add_init_script("try { localStorage.setItem('sentinel:listen', 'ptt'); localStorage.removeItem('sentinel.crew'); } catch (e) {}")
        pg = await ctx.new_page(); pg.set_default_timeout(90000)
        cdp = await ctx.new_cdp_session(pg)

        def on_frame(ev):
            i = len(frames)
            (FRAMES / f"{i:06d}.jpg").write_bytes(base64.b64decode(ev["data"]))
            frames.append(ev["metadata"]["timestamp"])
            asyncio.ensure_future(cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]}))
        cdp.on("Page.screencastFrame", on_frame)

        async def quiet(max_s=30):
            await pg.wait_for_timeout(1400)
            calm, t = 0, time.time()
            while time.time() - t < max_s:
                busy = await pg.evaluate("window.__active > 0 || !!document.querySelector('.orb-thinking')")
                calm = 0 if busy else calm + 1
                if calm >= 6:
                    break
                await pg.wait_for_timeout(150)

        async def say(text, then=0, max_s=30):
            print(f"[{len(frames):5d} frames] say: {text}", flush=True)
            await pg.click("#ask-input"); await pg.type("#ask-input", text, delay=42); await pg.wait_for_timeout(300); await pg.press("#ask-input", "Enter")
            await quiet(max_s); await pg.wait_for_timeout(then)

        async def home():
            """Back to Overview (Sentinel's orb, open space on the left) unless the crew chooser is up."""
            if await pg.evaluate("!!document.getElementById('who')"):
                return
            await pg.evaluate("window.sentinel.screens?.close?.()")
            if not await pg.evaluate("document.querySelector('[data-nav=assistant]')?.getAttribute('aria-current') === 'true'"):
                await pg.click("[data-nav=assistant]")
            await pg.wait_for_timeout(1100)

        async def narrate(k, card=True, hold=0.6):
            """The narrator speaks k; with card, over its chapter card, which then fades back to the live app."""
            print(f"[{len(frames):5d} frames] narrate: {k}", flush=True)
            if card and k in CARDS:
                if not CARDS[k].get("opaque"):
                    await home()
                await pg.evaluate("(c) => window.__xv.show(c)", CARDS[k]); await pg.wait_for_timeout(700)
            f, dur = narr[k]
            spoken.append((time.time(), k, f, dur))
            await pg.wait_for_timeout(int((dur + hold) * 1000))
            if card and k in CARDS and k not in ("hook1", "end"):
                await pg.evaluate("window.__xv.hide()"); await pg.wait_for_timeout(900)

        await api.post("/api/scenario/reset"); await asyncio.sleep(2)
        await pg.goto(B + "/app/")
        await pg.evaluate("(c) => window.__xv.show(c)", CARDS["hook1"])
        await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W, "maxHeight": H, "everyNthFrame": 1})
        await pg.wait_for_timeout(1200)

        # the hook
        await narrate("hook1", hold=0.4)
        await narrate("hook2", hold=0.5)
        await pg.wait_for_selector("#start-screen.is-ready", timeout=90000)
        await narrate("intro", card=False, hold=0.3)        # the hook card fades and the real start screen is under it
        await pg.click("#start-btn"); await pg.wait_for_selector("#who [data-who]"); await quiet()

        await narrate("you")
        # the chooser is a voice moment: the words go in exactly as the microphone's transcript would
        print(f"[{len(frames):5d} frames] hear: I'm Eliah", flush=True)
        await pg.wait_for_timeout(600); await pg.evaluate("window.sentinel.hear(\"I'm Eliah\")"); await quiet(); await pg.wait_for_timeout(500)
        await say("How am I doing today?", 700)
        await narrate("twin")
        await say("Do a full body scan", 0, max_s=60)
        # the scan pauses between organs: wait for its last line, so the next chapter never talks over it
        await pg.wait_for_function("document.body.innerText.includes('Scan complete')", timeout=75000, polling=200)
        await quiet(); await pg.wait_for_timeout(1200)
        await narrate("wear")
        await say("Show my vitals", 400)
        await pg.evaluate("document.getElementById('wearable-host')?.scrollIntoView({behavior: 'smooth', block: 'center'})"); await pg.wait_for_timeout(1200)
        await say("Explode the watch", 1000)
        await say("Simulate a radiation alert", 2200)
        await narrate("eva")
        await say("Open the mission", 1000)
        await say("Start an EVA", 400)
        await say("Simulate a suit leak in the left glove", 1500)
        await narrate("leak", card=False, hold=1.0)
        await say("Seal the suit", 600)
        await say("End the EVA", 400)
        await narrate("cabin")
        await api.post(f"/api/state/{CID}/patch", json={"cabin": {"oxygen_pct": 17.2}}); await quiet(); await pg.wait_for_timeout(2200)
        await pg.click("#banner-ack"); await api.post(f"/api/state/{CID}/patch", json={"cabin": {"oxygen_pct": 20.9}}); await pg.wait_for_timeout(1200)
        await narrate("quiet")
        await say("Simulate a comms blackout", 400)
        await say("Send a digest to ground", 600)
        await say("The link is back", 600)
        await narrate("nasa")
        await say("What does deep-space radiation do to the human body?", 800, max_s=100)
        await say("Show me the NASA documents", 2500)
        await pg.evaluate("window.sentinel.screens.close()"); await pg.wait_for_timeout(600)
        await narrate("mind")
        await say("Start Stillpoint", 4500)
        await pg.evaluate("window.sentinel.screens.close()"); await pg.wait_for_timeout(1200)
        await narrate("private", hold=1.2)
        await narrate("end", hold=2.8)

        await cdp.send("Page.stopScreencast"); await pg.wait_for_timeout(300)
        await ctx.close(); await b.close()
    await api.post("/api/scenario/reset"); await api.aclose()
    return frames, clips, spoken


# ---------- 3. assemble ----------
def srt_time(s):
    ms = int(round(s * 1000)); return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def assemble(frames, clips, spoken):
    t0, end = frames[0], frames[-1] + 0.04
    total = end - t0
    with open(FRAMES / "list.txt", "w") as f:   # each screencast frame shown until the next one arrived
        for i, ts in enumerate(frames):
            nxt = frames[i + 1] if i + 1 < len(frames) else end
            f.write(f"file '{i:06d}.jpg'\nduration {max(nxt - ts, 0.001):.4f}\n")
        f.write(f"file '{len(frames) - 1:06d}.jpg'\n")
    inputs, filters, labels = [], [], []
    tmp = []
    for i, (t, k, path, dur) in enumerate(spoken):
        inputs += ["-i", str(path)]; d = max(0, int((t - t0) * 1000))
        filters.append(f"[{len(labels) + 1}:a]aresample=48000,adelay={d}|{d}[a{len(labels)}]"); labels.append(f"[a{len(labels)}]")
    for j, (t, sr, b64) in enumerate(clips):
        wf = OUT / f"clip_{j:03d}.wav"; tmp.append(wf)
        with wave.open(str(wf), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(sr)); w.writeframes(base64.b64decode(b64))
        inputs += ["-i", str(wf)]; d = max(0, int((t - t0) * 1000))
        filters.append(f"[{len(labels) + 1}:a]aresample=48000,volume=0.92,adelay={d}|{d}[a{len(labels)}]"); labels.append(f"[a{len(labels)}]")
    fc = ";".join(filters) + f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={total - 2:.2f}:d=2[aout]"
    fc += f";[0:v]fps=30,format=yuv420p,fade=t=in:st=0:d=1.2,fade=t=out:st={total - 1.8:.2f}:d=1.8[vout]"
    out = OUT / "sentinel-explainer.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(FRAMES / "list.txt")] + inputs + [
        "-filter_complex", fc, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.2f}", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    for wf in tmp:
        wf.unlink()
    with open(OUT / "sentinel-explainer.srt", "w", encoding="utf-8") as f:   # narration subtitles, for captions on upload
        for i, (t, k, path, dur) in enumerate(spoken, 1):
            f.write(f"{i}\n{srt_time(t - t0)} --> {srt_time(t - t0 + dur)}\n{N[k]}\n\n")
    print(f"explainer: {out} ({total:.0f} s, {len(frames)} frames, {len(clips)} Sentinel clips)")


if __name__ == "__main__":
    narr = voice_narration()
    if "--narration-only" in sys.argv:
        sys.exit(0)
    frames, clips, spoken = asyncio.run(run(narr))
    assemble(frames, clips, spoken)
    if "--keep-frames" not in sys.argv:
        shutil.rmtree(FRAMES)
