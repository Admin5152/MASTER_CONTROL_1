# How to run Sentinel

## What you need

| | Needed for |
| --- | --- |
| Windows 10 or 11 laptop | Running the server (`run.ps1` is a Windows script; the server and tests also run on macOS and Linux) |
| Python 3.10 or later (3.12 used) | The server |
| Google Chrome (or Edge) | The app |
| Node.js 18 or later (optional) | Twi, Ewe, Ga, Fante, Dagbani and Yoruba ([LANGUAGES.md](LANGUAGES.md)), and the JS tests |
| A Samsung Galaxy Tab or any tablet (optional) | The crew-facing screen |

## 1. First-time setup

```powershell
git clone https://github.com/Admin5152/MASTER_CONTROL_1.git sentinel
cd sentinel
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-voice.txt
copy .env.example .env
```

Open `.env` and add the keys you have; every one is optional ([CONFIGURATION.md](CONFIGURATION.md)):

```ini
ANTHROPIC_API_KEY=...      # Claude, the brain
LLM_API_KEY=...            # Groq: fast speech recognition and the backup brain
ELEVENLABS_API_KEY=...     # the English voices
KHAYA_KEY=...              # local languages (Khaya AI)
KHAYA_KEY_SECONDARY=...
```

## 2. Start it on the laptop

1. Open **PowerShell** in the project folder.
2. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File run.ps1 -SkipSpeaker
   ```

   `run.ps1` checks the Python packages, makes the HTTPS certificate, starts the local-language service on port 3001,
   starts the server on port 8443 and opens Chrome at **https://localhost:8443/app/**.
3. The window prints the **LAPTOP** and **TABLET** addresses and a **pairing PIN**. Keep it open: closing it stops
   Sentinel.

Chrome shows a certificate warning because the certificate is Sentinel's own, made on this laptop. Click
**Advanced**, then **Proceed**.

| Option | Effect |
| --- | --- |
| `-SkipSpeaker` | Skip the optional speaker-recognition install (recommended) |
| `-NoBrowser` | Do not open Chrome |
| `-Http` | Laptop only, plain HTTP on `http://127.0.0.1:8000/app/` (no tablet) |

## 3. Use it

1. Tap **Begin**.
2. Say **"I'm Eliah"**, or tap your name.
3. Talk to it: say **"Hey Sentinel"** and then ask, tap the orb, or type in the box at the bottom.

**Before a demo:** open the demo panel (press **D**, or the sliders icon) and press **Reset**. Every crew member starts
calm and old messages to ground are cleared.

**Things to say:**

| Area | Say |
| --- | --- |
| Health | "How am I doing today?", "Check my heart", "Do a full body scan", "Show my vitals", "Let me see you" |
| Eyes | "Check my eyes" |
| EVA | "Am I ready for an EVA?", "Start an EVA", "Suit check", "Simulate a leak in the left glove", "Seal the suit", "End the EVA" |
| Ground | "Simulate a comms blackout", "Send a digest to ground", "The link is back" |
| Languages | "Speak Twi", "Speak Ewe", "Speak English" |
| Voice | "Use a female voice", "Switch to Jon" |
| Knowledge | "How far is Mars?", "Why do astronauts lose bone in space?" |
| Talking over it | "Stop", "Wait", "Go on" |

## 4. Open it on the tablet

1. Put the tablet and the laptop on the **same network**. Campus and venue Wi-Fi often block devices from reaching
   each other, so the most reliable choice is the laptop's own hotspot: **Windows Settings → Network & internet →
   Mobile hotspot → On**, then join it from the tablet.
2. On the tablet open **Chrome** and type the **TABLET** address. With the laptop's hotspot it is
   **https://192.168.137.1:8443/app/**.
3. Tap **Advanced → Proceed** on the certificate warning.
4. Enter the **6-digit PIN** from the PowerShell window (also in the laptop's demo panel).
5. Optional: Chrome **⋮ → Add to home screen** makes it open like an app.

- **The PIN changes at every start.** For a fixed one, add `SENTINEL_PIN=123456` to `.env`.
- **First run: Windows asks about the firewall.** Allow Python on **Private networks**, or the tablet cannot connect.

## 5. Stop it

Press **Ctrl+C** in the PowerShell window, or close it. Also close the minimised Node window (the language service).

## 6. Run the tests

```powershell
.venv\Scripts\python -m pytest -q        # 305 Python tests (no keys or credit used)
node --test tests/js                      # 95 JavaScript tests
node tests/test_twi.js                    # the language service, offline
```

## If something goes wrong

See [LOGS.md → Troubleshooting](LOGS.md#troubleshooting). The most common:

| What you see | What to do |
| --- | --- |
| The tablet cannot load the page | Use the laptop's Mobile hotspot and `https://192.168.137.1:8443/app/`; check the firewall step |
| "Wrong PIN" | Use the newest PIN in the PowerShell window |
| "Voice unavailable, showing text" | ElevenLabs credit or the internet ran out; Sentinel still works and shows its words |
| Sentinel answers twice, in two voices | It is open in two tabs. Close one |
| The page looks stuck or old | Reload it. Sentinel always serves the newest version |
