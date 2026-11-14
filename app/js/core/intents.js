// Local intent matcher: voice or typed phrases -> Director commands, with no network.
// Pure (no DOM). Extend by adding words to the tables below.
// Returns null when the phrase is not a local intent (it then goes to the brain).
// Result: { commands: [...], local?: 'stop'|'cabin', intent: name }

export const ZONE_WORDS = {
  head: ["head", "brain", "mind", "cognition", "memory", "thinking", "headache"],
  eyes: ["eyes", "eye", "vision", "sight", "eyesight"],
  heart: ["heart", "circulation", "heartbeat"],
  lungs: ["lungs", "lung", "chest", "breathing", "breath"],
  gut: ["stomach", "gut", "belly", "tummy", "digestion", "nutrition", "abdomen", "bowel"],
  bones: ["bones", "bone", "muscles", "muscle", "legs", "leg", "skeleton", "knees", "knee", "thighs", "back pain"],
  whole_body: ["whole body", "radiation dose", "everything"],
};

export const METRIC_WORDS = {
  heart_rate: ["heart rate", "pulse"],
  breathing_rate: ["breathing rate", "respiration"],
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
  symptom: ["symptom log", "symptoms", "symptom"],
  radiation: ["radiation", "space weather", "solar storm", "dose passport", "dose"],
  health_log: ["health log", "manual log", "log my health", "log health", "health form"],
  trends: ["trends", "charts", "trend"],
  cognitive: ["cognitive check", "cognitive test", "reaction test", "reaction game", "cognitive"],
  orb_calm: ["orb calm", "breathing exercise", "calm session"],
  race: ["slipstream", "slip stream", "space race", "racing game", "race", "racer", "the game", "a game", "aurora run", "aurora"],
  grounding: ["grounding", "ground me", "5 4 3 2 1", "five four three", "panic", "anxious", "anxiety"],
  greenhouse: ["red harvest", "the farm", "mars farm", "greenhouse", "my plant", "the plant"],
  hardware: ["hardware", "wearable", "the device", "sentinel skin", "the suit"],
  crew: ["crew list", "crew", "who is on board", "enrol", "enroll"],
  vision: ["camera", "vision", "face scan"],
  mission: ["mission", "dashboard", "earth"],
  body: ["body model", "my body", "body screen", "the body"],
  cabin: ["cabin screen", "cabin air screen"],
  home: ["home", "main screen"],
};

// parts that are not zones (zones such as "heart" point and check instead)
export const PART_WORDS = {
  spine: ["spine", "backbone", "vertebrae", "spinal column"], skull: ["skull"], ribcage: ["ribcage", "rib cage", "ribs"],
  pelvis: ["pelvis", "hips", "hip bones"], vessels: ["blood vessels", "vessels", "veins and arteries", "arteries and veins", "circulation system", "circulatory system"],
  arteries: ["arteries"], veins: ["veins"], skeleton: ["skeleton", "my bones", "all my bones"], liver: ["liver"], kidneys: ["kidneys", "kidney"],
  intestines: ["intestines", "bowel", "guts"], airway: ["airway", "windpipe", "trachea"], organs: ["organs", "my organs"],
};
const norm = (s) => ` ${String(s || "").toLowerCase().replace(/[’']/g, "").replace(/x ray/g, "xray").replace(/x-ray/g, "xray").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
const has = (t, w) => t.includes(` ${w} `);
const pairsOf = (table) => Object.entries(table).flatMap(([k, ws]) => ws.map((w) => [k, w])).sort((a, b) => b[1].length - a[1].length);
const findWord = (t, table) => {
  // longest phrase first so "heart rate" beats "heart"
  for (const [k, w] of pairsOf(table)) if (has(t, w)) return k;
  return null;
};
/** Every zone named in the phrase, in the order spoken, without repeats. */
export function findZones(text) {
  let t = norm(text);
  const hits = [];
  for (const [k, w] of pairsOf(ZONE_WORDS)) {
    let i = t.indexOf(` ${w} `);
    while (i >= 0) {
      hits.push([i, k]);
      t = t.slice(0, i + 1) + "#".repeat(w.length) + t.slice(i + 1 + w.length); // consume so "chest" is not also "breath"
      i = t.indexOf(` ${w} `);
    }
  }
  return [...new Set(hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]))];
}

export function matchIntent(text) {
  const t = norm(text);
  if (t.trim() === "") return null;

  // stop / back
  if (/^ (stop|cancel|be quiet|quiet|shush|stop talking) $/.test(t) || has(t, "stop talking")) return { intent: "stop", local: "stop", commands: [] };
  if (/ (go back|go home|close (this|that|it)?|back to home|never mind|nevermind) /.test(t) || /^ (back|close|home) $/.test(t)) {
    return { intent: "close", commands: [{ cmd: "close" }] };
  }

  // body: isolate one anatomy part ("show me my spine", "show my blood vessels", "show my skeleton")
  const isoVerb = / (show|see|isolate|highlight|display) /.test(t);
  if (isoVerb && !has(t, "xray")) {
    const part = findWord(t, PART_WORDS);
    if (part) return { intent: "isolate", commands: [{ cmd: "isolate", part }] };
  }

  // body: X-ray on/off (radiograph or coloured anatomy)
  if (has(t, "xray")) {
    const off = / (hide|off|stop|remove|turn off|close|no) /.test(t) || has(t, "normal view");
    const x = { cmd: "xray", on: !off };
    if (!off && / (anatomy|organs|colou?r|colou?red) /.test(t)) x.style = "anatomy";
    else if (!off && / (radiograph|bones only|real xray|plain xray) /.test(t)) x.style = "radiograph";
    return { intent: "xray", commands: [x] };
  }
  // body: turn / rotate
  const deg = t.match(/ (rotate|turn) (?:it |me |the body )?(?:by )?(-?\d{1,3}) degrees? /);
  if (deg) return { intent: "rotate", commands: [{ cmd: "rotate_body", angle: Number(deg[2]) }] };
  if (/ (turn around|spin around|show (me )?my back|from (the )?back|back view|rear view) /.test(t)) return { intent: "rotate", commands: [{ cmd: "rotate_body", view: "back" }] };
  if (/ (turn|rotate) (me |the body |it )?(to the )?left /.test(t) || has(t, "left side") || has(t, "left view")) return { intent: "rotate", commands: [{ cmd: "rotate_body", view: "left" }] };
  if (/ (turn|rotate) (me |the body |it )?(to the )?right /.test(t) || has(t, "right side") || has(t, "right view")) return { intent: "rotate", commands: [{ cmd: "rotate_body", view: "right" }] };
  if (/ (face me|front view|from the front|turn (me |the body |it )?(to the )?front) /.test(t)) return { intent: "rotate", commands: [{ cmd: "rotate_body", view: "front" }] };
  // body: zoom
  if (/ zoom (out|back)|reset (the )?(view|zoom) /.test(t)) return { intent: "zoom", commands: [{ cmd: "zoom_body", zone: "reset" }] };
  if (/ zoom (in )?(into|in on|on|to|in) /.test(t) || / (close up|closer look) /.test(t)) {
    const z = findZones(t)[0];
    if (z) return { intent: "zoom", commands: [{ cmd: "zoom_body", zone: z }] };
  }

  // full scan
  if (/ (full|body|whole body) scan /.test(t) || / (run|do|start) (a |the )?(full )?scan /.test(t) || has(t, "scan me") || has(t, "scan my body")) {
    return { intent: "scan", commands: [{ cmd: "start_scan" }] };
  }

  // symptom entry by pointing at the body: "log a symptom", "where does it hurt", "something hurts"
  if (/ (log|report|record|add|enter) (a |an |my |new |another )?symptoms? /.test(t) || has(t, "where does it hurt") || has(t, "show where it hurts") ||
    (/ (something|it) hurts /.test(t) || / i (have|ve got|am in|m in) (a |some )?pain /.test(t)) && !findZones(t).length) {
    return { intent: "symptom", commands: [{ cmd: "open_screen", name: "symptom" }] };
  }

  // focused zone check: "check my chest", "check my eyes and my head", "something feels off in my stomach"
  const checkVerb = / (check|scan|examine|inspect|test) (my |the |on |out )?/.test(t) ||
    / (feels? (off|weird|wrong|strange|funny|bad|tight|sore)|hurts?|aches?|aching|sore|pain in|something (is )?(off|wrong) (with|in)|not right (with|in)) /.test(t);
  if (checkVerb) {
    const zs = findZones(t).filter((z) => z !== "whole_body");
    if (zs.length) return { intent: "check", commands: [{ cmd: "check_zone", zones: zs.slice(0, 3) }] };
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
  const pointVerb = / (show me|show|what s wrong with|whats wrong with|what is wrong with|look at|point to|how is|how are|how s|hows) /.test(t);
  const zone = findWord(t, ZONE_WORDS);
  if (zone && pointVerb) return { intent: "point", commands: [{ cmd: "point_to", zone }] };

  return null;
}
