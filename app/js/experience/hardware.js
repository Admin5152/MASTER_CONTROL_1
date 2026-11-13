// Hardware slide (DESIGNED): exploded view of the planned wearable. Not running.
export function renderHardware(el) {
  const parts = [
    { id: "eye", x: 318, y: 80, label: "Eye camera", sub: "clip-on, tracks blink rate and eye strain", bx: 460, by: 60 },
    { id: "temp", x: 343, y: 100, label: "Skin temperature", sub: "behind-ear thermistor", bx: 460, by: 150 },
    { id: "pulse", x: 300, y: 290, label: "Pulse sensor (PPG)", sub: "chest patch, continuous heart rate", bx: 460, by: 260 },
    { id: "spo2", x: 162, y: 436, label: "SpO2 sensor", sub: "finger or wrist pulse oximeter", bx: 20, by: 470, left: true },
    { id: "accel", x: 300, y: 380, label: "Accelerometer", sub: "logs exercise, sleep and movement", bx: 460, by: 370 },
  ];
  el.innerHTML = `
  <div class="hardware">
    <svg viewBox="0 0 760 560" role="img" aria-label="Exploded view of the designed Sentinel wearable">
      <defs><filter id="hw-glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <g stroke="var(--line-dim)" fill="none" stroke-width="1.4">
        <ellipse cx="300" cy="90" rx="44" ry="54"/>
        <path d="M256 150 Q300 175 344 150 L380 180 L390 330 L370 470 L230 470 L210 330 L220 180 Z"/>
        <path d="M220 180 L170 330 L160 440 M380 180 L430 330 L440 440"/>
      </g>
      ${parts.map((p) => `
        <g class="hw-part">
          <circle cx="${p.x}" cy="${p.y}" r="10" fill="var(--surface-solid)" stroke="var(--line)" stroke-width="2" filter="url(#hw-glow)"/>
          <path d="M${p.x} ${p.y} L${p.left ? p.bx + 120 : p.bx - 20} ${p.left ? p.by - 2 : p.by + 18}" stroke="var(--line)" stroke-dasharray="3 4"/>
          <text x="${p.bx}" y="${p.by + 14}" fill="var(--ink)" font-size="20" font-family="var(--font)">${p.label}</text>
          <text x="${p.bx}" y="${p.by + 36}" fill="var(--ink-2)" font-size="14" font-family="var(--font)">${p.sub}</text>
        </g>`).join("")}
      <g>
        <rect x="560" y="470" width="170" height="64" rx="8" fill="var(--bg-inset)" stroke="var(--line)"/>
        <text x="575" y="498" fill="var(--ink)" font-size="17" font-family="var(--font)">Sentinel hub</text>
        <text x="575" y="520" fill="var(--ink-2)" font-size="13" font-family="var(--font)">Bluetooth LE to the tablet</text>
        <path d="M370 470 Q480 540 560 500" stroke="var(--line)" stroke-dasharray="6 6" fill="none"/>
      </g>
      <text x="30" y="40" fill="var(--badge-designed)" font-size="34" font-family="var(--font)" font-weight="700">DESIGNED</text>
      <text x="30" y="64" fill="var(--ink-2)" font-size="15" font-family="var(--font)">A design, not built. Nothing on this slide is running.</text>
    </svg>
    <p class="note">Today the app reads pulse from the webcam (LIVE) and simulates breathing rate and SpO2 (SIM). This wearable is how those readings would become real sensors on a mission; on a deep-space mission an onboard dosimeter would also feed the radiation display.</p>
  </div>`;
}
