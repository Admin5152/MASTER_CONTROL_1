# How to run Sentinel

## 1. Start it on the laptop

1. Open **PowerShell** in the `cosmo care` folder.
2. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File run.ps1 -SkipSpeaker
   ```

   The first run installs what it needs; after that it starts in a few seconds.
3. Chrome opens **https://localhost:8443/app/** by itself.
4. The window prints two addresses and a **pairing PIN**. Keep that window open: closing it stops Sentinel.

Chrome may show a certificate warning. The certificate is Sentinel's own, made on this laptop. Click **Advanced**, then **Proceed**.

## 2. Use it

1. Tap **Begin**.
2. Say **"I'm Eliah"**, or tap your name.
3. Talk to it. Either:
   - say **"Hey Sentinel"** and then ask, or
   - type in **Ask Sentinel anything** at the bottom.

**Before a demo:** open the demo panel (the sliders icon, top right) and press **Reset**. Every crew member then starts calm, and old messages to ground are cleared.

**Things to say:**
- "How am I doing today?"
- "Do a full body scan"
- "Show my vitals"
- "Explode the watch"
- "Simulate a suit leak in the left glove"
- "Seal the suit"
- "Simulate a comms blackout"
- "Send a digest to ground"
- "The link is back"
- "Start Stillpoint"

## 3. Open it on the Samsung Galaxy Tab

1. Connect the tablet and the laptop to the **same Wi-Fi**. A phone hotspot is the most reliable choice.
2. On the tablet, open **Chrome** and type the **TABLET** address from the PowerShell window. It looks like `https://192.168.x.x:8443/app/`.
3. Accept the certificate warning: tap **Advanced**, then **Proceed**.
4. Enter the **6-digit PIN** shown in the PowerShell window. It is also in the demo panel on the laptop.
5. Optional: make it open like a real app. In Chrome's **⋮** menu, choose **Add to home screen**.

Two things to know:
- **The PIN changes every time Sentinel restarts.** To keep one fixed PIN, add a line such as `SENTINEL_PIN=123456` to the `.env` file.
- **On the very first run, Windows asks about the firewall.** Allow Python on **Private networks**. Otherwise the tablet cannot reach the laptop.

## 4. Stop it

Press **Ctrl+C** in the PowerShell window, or just close it.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Voice unavailable, showing text" | The ElevenLabs credits or the internet ran out. Sentinel still works and shows its words as text. |
| The tablet cannot load the page | Make sure both devices are on the same Wi-Fi, check the firewall step above, and retype the TABLET address. |
| Sentinel answers twice, in two voices | Sentinel is open in two tabs. Close one. |
| The page looks stuck or old | Reload the page. Sentinel always serves the newest version. |
