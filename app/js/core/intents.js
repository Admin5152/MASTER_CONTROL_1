// Local intent matcher: voice or typed phrases -> Director commands, with no network.
// Pure (no DOM). Extend by adding words to the tables below.
// Returns null when the phrase is not a local intent (it then goes to /api/chat).
// Result: { commands: [...], local?: 'stop'|'cabin'|'how', intent: name }

export const ZONE_WORDS = {
  head: ["head", "brain", "mind", "cognition", "memory", "thinking"],
  eyes: ["eyes", "eye", "vision", "sight"],
  heart: ["heart", "circulation"],
  lungs: ["lungs", "lung", "chest", "breathing"],
  gut: ["stomach", "gut", "belly", "tummy", "digestion", "nutrition"],
  bones: ["bones", "bone", "muscles", "muscle", "legs", "leg", "skeleton"],
  whole_body: ["whole body", "radiation dose"],
};

export const METRIC_WORDS = {
  heart_rate: ["heart rate", "pulse", "heartbeat"],
  breathing_rate: ["breathing rate", "breathing", "respiration"],
  spo2: ["spo2", "blood oxygen", "oxygen saturation", "saturation"],
  bp: ["blood pressure", "pressure"],
  glucose: ["glucose", "blood sugar", "sugar"],
  temp: ["temperature", "temp", "fever"],
  sleep: ["sleep"],
  mood: ["mood"],
  reaction: ["reaction time", "reaction", "reflexes"],
  talk_time: ["talk time", "talking"],
  pitch: ["pitch", "voice"],
  o2: ["cabin oxygen", "oxygen level"],
  co2: ["co2", "carbon dioxide"],
};

export const SCREEN_WORDS = {
  radiation: ["radiation", "space weather", "solar storm", "dose passport", "dose"],
  health_log: ["health log", "manual log", "log my health", "log health", "health form"],
  trends: ["trends", "charts", "trend"],
  cognitive: ["cognitive check", "cognitive test", "reaction test", "reaction game", "cognitive"],
  orb_calm: ["orb calm", "breathing exercise", "calm session"],
  aurora_run: ["aurora run", "aurora", "the game"],
  greenhouse: ["greenhouse", "my plant", "the plant"],
  hardware: ["hardware", "wearable", "the device"],
  crew: ["crew list", "crew", "who is on board", "enrol", "enroll"],
  vision: ["camera", "vision"],
  home: ["home", "main screen"],
};

const norm = (s) => ` ${String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
const has = (t, w) => t.includes(` ${w} `);
const findWord = (t, table) => {
  // longest phrase first so "heart rate" beats "heart"
  const pairs = Object.entries(table).flatMap(([k, ws]) => ws.map((w) => [k, w])).sort((a, b) => b[1].length - a[1].length);
  for (const [k, w] of pairs) if (has(t, w)) return k;
  return null;
};

export function matchIntent(text) {
  const t = norm(text);
  if (t.trim() === "") return null;

  // stop / back
  if (/^ (stop|cancel|be quiet|quiet|shush|stop talking) $/.test(t) || has(t, "stop talking")) return { intent: "stop", local: "stop", commands: [] };
  if (/ (go back|go home|close (this|that|it)?|back to home|never mind|nevermind) /.test(t) || /^ (back|close|home) $/.test(t)) {
    return { intent: "close", commands: [{ cmd: "close" }] };
  }

  // full scan
  if (/ (full|body) scan /.test(t) || / (run|do|start) (a )?scan /.test(t) || has(t, "scan me")) {
    return { intent: "scan", commands: [{ cmd: "start_scan" }] };
  }

  // cabin status (answered locally)
  if (/ how (is|s) the (cabin|air) /.test(t) || has(t, "cabin status") || has(t, "check the cabin") || /^ (cabin|cabin air) $/.test(t)) {
    return { intent: "cabin", local: "cabin", commands: [] };
  }

  // vision
  if (/ (let me see you|look at me|see me|watch me|open (the )?camera|start (the )?camera) /.test(t)) {
    return { intent: "vision", commands: [{ cmd: "open_screen", name: "vision" }, { cmd: "start_scan" }] };
  }

  // radiation layer toggle
  if (/ radiation layer /.test(t)) {
    const off = / (hide|off|remove) /.test(t);
    return { intent: "radiation_layer", commands: [{ cmd: "show_radiation", on: !off }] };
  }

  // trend charts: "show my heart rate trend", "glucose history"
  if (/ (trend|trends|history|chart|graph) /.test(t)) {
    const m = findWord(t, METRIC_WORDS);
    if (m) return { intent: "chart", commands: [{ cmd: "show_chart", metric: m }] };
    return { intent: "trends", commands: [{ cmd: "open_screen", name: "trends" }] };
  }

  // screens: open / show / start / go to
  const screen = findWord(t, SCREEN_WORDS);
  const verb = / (open|show|start|go to|take me to|launch|play|bring up|let s|lets|log) /.test(t);
  if (screen && (verb || t.trim().split(" ").length <= 3)) {
    if (screen === "home") return { intent: "close", commands: [{ cmd: "close" }] };
    return { intent: `open_${screen}`, commands: [{ cmd: "open_screen", name: screen }] };
  }

  // point to a body zone: "show me my heart", "what's wrong with my eyes", "how is my stomach"
  const pointVerb = / (show me|show|what s wrong with|whats wrong with|what is wrong with|look at|point to|check|how is|how are|how s|hows|zoom (in )?(on|to)) /.test(t);
  const zone = findWord(t, ZONE_WORDS);
  if (zone && pointVerb) return { intent: "point", commands: [{ cmd: "point_to", zone }] };

  return null;
}
