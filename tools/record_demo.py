"""Record a narrated demo video of Sentinel from the real app.

The browser is driven through a scripted demo and records the screen. Sentinel's voice is captured inside the
page (every voice clip as it starts playing, with its time), then ffmpeg lays the clips over the screen recording.
The browser is muted while recording: nothing plays out loud.

    .venv/Scripts/python tools/record_demo.py https://127.0.0.1:8443 video/demo
"""
import base64, os, subprocess, sys, time, wave
import httpx
from playwright.sync_api import sync_playwright

B, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
api = httpx.Client(base_url=B, verify=False, timeout=30)
CID = "james"

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

clips = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=False, args=["--mute-audio", "--autoplay-policy=no-user-gesture-required",
                          "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--window-size=1400,900"])
    ctx = b.new_context(ignore_https_errors=True, viewport={"width": 1366, "height": 768}, record_video_dir=OUT, record_video_size={"width": 1366, "height": 768})
    ctx.expose_binding("__clip", lambda src, t, sr, b64: clips.append((t, sr, b64)))
    ctx.add_init_script(HOOK)
    ctx.add_init_script("try { localStorage.setItem('sentinel:listen', 'ptt'); localStorage.removeItem('sentinel.crew'); } catch (e) {}")
    pg = ctx.new_page(); video_t0 = time.time() * 1000
    pg.set_default_timeout(90000)

    def quiet(max_s=30):
        """Wait until Sentinel has finished speaking (and stays quiet for a moment)."""
        pg.wait_for_timeout(1400)
        calm, t = 0, time.time()
        while time.time() - t < max_s:
            busy = pg.evaluate("window.__active > 0 || !!document.querySelector('.orb-thinking')")
            calm = 0 if busy else calm + 1
            if calm >= 6: break
            pg.wait_for_timeout(150)

    def say(text, then=0, max_s=30):
        pg.click("#ask-input"); pg.type("#ask-input", text, delay=38); pg.wait_for_timeout(250); pg.press("#ask-input", "Enter")
        quiet(max_s); pg.wait_for_timeout(then)

    api.post("/api/scenario/reset"); time.sleep(2)
    pg.goto(B + "/app/"); pg.wait_for_selector("#start-screen.is-ready", timeout=90000); pg.wait_for_timeout(3500)   # the intro and the logo
    pg.click("#start-btn"); pg.wait_for_selector("#who [data-who]"); quiet()
    say("I'm Eliah", 600)
    say("How am I doing today?", 800)
    say("Do a full body scan", 1500, max_s=60)
    say("Show my vitals", 600)
    pg.evaluate("document.getElementById('wearable-host')?.scrollIntoView({behavior: 'smooth', block: 'center'})"); pg.wait_for_timeout(1200)
    say("Explode the watch", 1200)
    say("Simulate a radiation alert", 2500)
    say("Open the mission", 1500)
    say("Start an EVA", 600)
    say("Simulate a suit leak in the left glove", 2500)
    say("How is my suit?", 600)
    say("Seal the suit", 800)
    say("End the EVA", 600)
    api.post(f"/api/state/{CID}/patch", json={"cabin": {"oxygen_pct": 17.2}}); quiet(); pg.wait_for_timeout(2500)
    pg.click("#banner-ack"); api.post(f"/api/state/{CID}/patch", json={"cabin": {"oxygen_pct": 20.9}}); pg.wait_for_timeout(1200)
    say("Simulate a comms blackout", 400)
    say("Send a digest to ground", 600)
    say("The link is back", 600)
    say("What's the hardest part of a Mars mission for the human body?", 800, max_s=40)
    say("Show me the NASA documents", 2500)
    pg.evaluate("window.sentinel.screens.close()"); pg.wait_for_timeout(600)
    say("Start Stillpoint", 4000)
    pg.evaluate("window.sentinel.screens.close()"); pg.wait_for_timeout(2500)
    video_path = pg.video.path()
    ctx.close(); b.close()

api.post("/api/scenario/reset")
webm = video_path
print(f"screen recording: {webm}; voice clips captured: {len(clips)}")

# the voice track: each clip at the moment it started playing
inputs, filters = [], []
for i, (t, sr, b64) in enumerate(clips):
    f = os.path.join(OUT, f"clip_{i:02d}.wav")
    with wave.open(f, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(sr)); w.writeframes(base64.b64decode(b64))
    inputs += ["-i", f]
    delay = max(0, int(t - video_t0))
    filters.append(f"[{i + 1}:a]aresample=48000,adelay={delay}|{delay}[a{i}]")
mix = "".join(f"[a{i}]" for i in range(len(clips)))
fc = ";".join(filters) + f";{mix}amix=inputs={len(clips)}:normalize=0:dropout_transition=0,volume=1.0[aout]"
out = os.path.join(OUT, "sentinel-demo.mp4")
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", webm] + inputs + ["-filter_complex", fc, "-map", "0:v", "-map", "[aout]",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", out]
subprocess.run(cmd, check=True)
for i in range(len(clips)):
    os.remove(os.path.join(OUT, f"clip_{i:02d}.wav"))
print("demo video:", out)
