# Good morning

## Open this

**http://127.0.0.1:8000/app/** in Chrome (the server is running on the laptop; ElevenLabs and Groq are on). Tap to skip the intro, then **Begin**. If the page does not load, start it again with `powershell -ExecutionPolicy Bypass -File run.ps1 -Http`.

Try, in order: the pill nav at the top (Overview, Body, Vitals, Mission, Radiation, Wellbeing); on **Body**, tap the systems on the left rail; type or say "check my heart"; "how far is Mars?" then "and how long would a message take?"; **Wellbeing → Space race**; **Guided exam → Send to ground**; Menu → **Sentinel Skin**; Settings → **Clinical light**.

## What changed overnight

- **Refs 12-16 layout language**: segmented pill nav; a left rail of body systems that isolates each system on the model; data chips pinned to the body; a right column with the system's status chip, metric cards with gradient range bars built from the sourced thresholds, and a care strategy card (Action plan / Onboard kit / Lifestyle); an insights card; a new **Vitals** screen with a heartbeat strip, a pressure gauge and the day's plan schedule.
- **Clinical light theme** next to the dark default, in Settings, remembered. Both share the same tokens and components; the X-ray always sits on near-black.
- **Real anatomy**: radiograph and coloured-anatomy X-ray (refs 09-11), mesh scan, zone checks, pointing; female and male bodies per crew member; a **realistic lit organ view**; organ thumbnails rendered in Blender.
- **NASA-grounded features**: a 3-minute reaction test like the ISS Reaction Self Test (lapses, false starts, sleep link), a guided health exam that builds a **ground packet**, **store-and-forward** to ground with the delay shown, **weekly standard measures** with timed sit-to-stand and tandem walk, and EIMO framing in the intro and About.
- **Space race**: Blender-made racer, three ghost racers, three laps past textured planets, five planet power-ups, mood before and after logged.
- **Voice and brain**: ElevenLabs River (cached, budget-capped) with Kokoro and browser fallbacks; Groq Whisper with a local fallback; a VAD on the mic with wake phrase or push-to-talk; gpt-oss-120b streaming sentence by sentence, with memory of the last eight turns and general questions answered properly.
- **Sentinel Skin** screen with each module's real source.
- **Team-ready repo**: README quickstart, CONTRIBUTING, docs/ARCHITECTURE, CREDITS, `.env.example`; dead code removed; history scanned for keys: none.

## Look at these screenshots first

- `tests/screenshots/v2/gpu/` real-GPU Chrome: `home.png`, `body.png`, `xray-anatomy.png`, `check-heart.png`, `vitals.png`, `race.png` (52-60 fps on this laptop)
- `tests/screenshots/v2/dark/1366x768-*.png` and `tests/screenshots/v2/light/1366x768-*.png`: every main screen in both themes, for choosing a theme
- `tests/screenshots/v2/body/`: radiograph, anatomy, heart check, female anatomy
- `tests/screenshots/v2/race/`: menu, flying, finish, mood saved

## Not verified

A real face on the webcam (face mesh, pulse), the real microphone in a real room (wake phrase, push-to-talk, VAD sensitivity), how the voice sounds through speakers, the Samsung tablet (layout, touch, tilt), and the v1 browser scripts against the new interface. Local Whisper fails on this laptop when memory is very tight (many apps open); Groq Whisper is the primary path and worked live.

## Three things I'd fix next

1. **Feed Sentinel Skin with SIM data** (module readings and the looping ultrasound panels in zone checks), the one brief item cut.
2. **Port the v1 browser checks** (`tests/browser_check.py`, `offline_check.py`, `resource_check.py`) to the v2 interface so CI covers every screen, the offline state and zero external requests.
3. **Tune voice on the real mic and tablet**: the VAD thresholds, wake-phrase sensitivity and the tablet layout of the body screen in portrait.
