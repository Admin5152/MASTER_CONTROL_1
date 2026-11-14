// Local intent matcher: voice or typed phrases -> Director commands, with no network.
// Pure (no DOM). Extend by adding words to the tables below.
// Returns null when the phrase is not a local intent (it then goes to the brain).
// Result: { commands: [...], local?: 'stop'|'cabin', intent: name }

export const ZONE_WORDS = {
  head: ["head", "brain", "mind", "cognition", "memory", "thinking", "headache", "migraine", "head is pounding", "pounding head", "dizzy", "dizziness", "lightheaded"],
  eyes: ["eyes", "eye", "vision", "sight", "eyesight", "blurry", "blurred", "cant see", "cant see properly", "see properly"],
  heart: ["heart", "circulation", "heartbeat", "pulse", "palpitations", "racing heart"],
  lungs: ["lungs", "lung", "chest", "breathing", "breath", "respiration", "cant breathe", "trouble breathing", "hard to breathe", "short of breath", "shortness of breath"],
  gut: ["stomach", "gut", "belly", "tummy", "digestion", "nutrition", "abdomen", "bowel", "nausea", "nauseous", "stomachache", "stomach ache", "cramps", "queasy"],
  bones: ["bones", "bone", "muscles", "muscle", "legs", "leg", "skeleton", "knees", "knee", "thighs", "back pain", "backache", "sore back", "joint pain", "stiffness"],
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
  orb_calm: ["stillpoint", "still point", "orb calm", "breathing exercise", "breathing session", "calm session"],
  race: ["slipstream", "slip stream", "space race", "racing game", "race", "racer", "the game", "a game", "aurora run", "aurora"],
  grounding: ["grounding", "ground me", "5 4 3 2 1", "five four three", "panic", "anxious", "anxiety"],
  greenhouse: ["red harvest", "the farm", "mars farm", "greenhouse", "my plant", "the plant"],
  hardware: ["hardware screen", "hardware status", "sensor status"],
  crew: ["crew list", "crew", "who is on board", "enrol", "enroll"],
  vision: ["camera", "vision", "face scan"],
  vitals: ["vitals", "vital signs", "my vitals", "the vitals", "vital"],
  wellbeing: ["wellbeing", "well being", "wellness", "the games", "games"],
  settings: ["settings", "preferences"],
  about: ["credits", "sources", "about sentinel"],
  interventions: ["what helps me", "what helps"],
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

/** Who is speaking, from what they said: "I'm Seth", "this is Annie", "switch to Stanley", "Gadiel here".
 *  A name that is also an everyday word (like "Sad") needs an unambiguous phrase, so "I'm sad" stays a feeling.
 *  bare: also accept the name on its own (used while the "Who are you?" chooser is open). Returns a crew_id or null. */
export function crewFromSpeech(text, crew, { bare = false } = {}) {
  const t = ` ${String(text || "").toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const COMMON = new Set(["sad", "will", "may", "mark", "grace", "joy", "hope"]);
  for (const c of crew || []) {
    const n = String(c.display_name || "").toLowerCase();
    if (!n) continue;
    const strict = new RegExp(` (this is|switch to|change to|log in as|sign in as|my name is|crew member|it is) ${n} | ${n} (here|speaking) `);
    const loose = new RegExp(` (i'm|i am|im|it's|its) ${n} `);
    if (strict.test(t) || (!COMMON.has(n) && loose.test(t)) || (bare && t.trim() === n)) return c.crew_id;
  }
  return null;
}

// SpaceWear: the 3D hardware prototypes (chest hub, watch, patch) in the drawer beside the body
const WEAR_WORDS = / (hardware|wearables?|spacewear|space wear|prototypes?|the devices?|devices|sentinel skin|the suit|chest (hub|module|unit|strap|harness)|harness|watch|wrist (module|unit|band)|smart ?watch|patch( sensor)?|sensor patch) /;
const WEAR_PART = (t) => (/ (chest|harness|hub) /.test(t) ? "chest" : / (watch|wrist) /.test(t) ? "wrist" : / patch /.test(t) ? "patch" : null);
/** A SpaceWear command, or null. `open` says the drawer is already showing, so bare verbs ("explode it") apply to it. */
export function wearIntent(text, { open = false } = {}) {
  const t = norm(text);
  if (/ (hardware|sensor) (screen|status|list|page) /.test(t)) return null;   // the hardware status screen, not the 3D models
  // the alert simulator: "simulate a radiation alert", "test the SOS", "show me the health warning", "back to normal"
  const alertKind = / (sos|emergency button|panic button|mayday) / .test(t) ? "sos" : / radiation (alert|alarm|warning) / .test(t) ? "radiation" : / health (alert|alarm|warning) / .test(t) ? "health" : null;
  if (alertKind && / (simulate|test|trigger|show|demo|play|try|run|what does|press) /.test(t)) {
    return { intent: "wear_alert", action: "control_wearable", target: alertKind, commands: [{ cmd: "wearable", action: "alert", kind: alertKind }] };
  }
  if (open && / (clear|stop|cancel|reset) (the )?(alert|alarm|warning)|back to normal|all clear /.test(t)) return { intent: "wear_alert", action: "control_wearable", target: "normal", commands: [{ cmd: "wearable", action: "alert", kind: "normal" }] };
  const named = WEAR_WORDS.test(t);
  if (!named && !open) return null;
  if (!named && / (body|me|my|skeleton|organs) /.test(t)) return null;   // "turn the body", "zoom in on my heart": the body, not the device
  const part = WEAR_PART(t);
  const c = { cmd: "wearable", action: "open" };
  if (part) c.part = part;
  if (/ (explode|exploded|blow (it )?apart|take (it )?apart|break (it )?(apart|down|open)|pull (it )?apart|open (it )?up|separate|show (me )?(the )?(inside|insides|internals|parts|layers|components)|tear ?down) /.test(t)) c.action = "explode";
  else if (/ (assemble|put (it )?(back )?together|put it back|collapse|reassemble|close (it )?up|unexplode) /.test(t)) c.action = "assemble";
  else if (/ (zoom (in|closer)|closer|bigger|enlarge|magnify|get close) /.test(t)) c.action = "zoom_in";
  else if (/ (zoom (out|back)|further|smaller|back up|whole thing) /.test(t)) c.action = "zoom_out";
  else if (/ (turn|rotate|spin|flip|twist|show (me )?(the )?(back|side|other side)) /.test(t)) {
    c.action = "turn";
    c.direction = / (back|around|over|flip|other side) /.test(t) ? "back" : / left /.test(t) ? "left" : / right /.test(t) ? "right" : / (front|face) /.test(t) ? "front" : "right";
  } else if (/ (reset|normal view|default view|start over) /.test(t)) c.action = "reset";
  else if (/ (close|hide|put away|dismiss|done with) /.test(t) && named) c.action = "close";
  else if (!named && !part) return null;      // drawer open, but nothing here is about it
  if (c.action === "open" && /^ (what|how|why|does|do|is|are|can|tell me|explain) /.test(t)) return null;   // a question about it: the brain answers (and can open it)
  return { intent: `wear_${c.action}`, action: "control_wearable", target: c.part || "wearable", commands: [c] };
}

export function matchIntent(text, ctx = {}) {
  const t = norm(text);
  if (t.trim() === "") return null;

  const wear = wearIntent(text, { open: !!ctx.wearOpen });
  if (wear) return wear;

  // full screen
  if (/ (full ?screen|fullscreen|immersive mode|kiosk mode) /.test(t)) {
    const off = / (exit|leave|close|stop|turn off|out of|no|disable|quit) /.test(t);
    return { intent: "fullscreen", action: "control_app", local: "fullscreen", on: !off, commands: [] };
  }

  // stop / back
  if (/^ (stop|cancel|be quiet|quiet|shush|stop talking) $/.test(t) || has(t, "stop talking")) return { intent: "stop", action: "stop", local: "stop", commands: [] };
  if (/ (go back|go home|close (this|that|it)?|back to home|never mind|nevermind) /.test(t) || /^ (back|close|home) $/.test(t)) {
    return { intent: "close", action: "go_back", commands: [{ cmd: "close" }] };
  }

  // body: isolate one anatomy part ("show me my spine", "show my blood vessels", "show my skeleton")
  const isoVerb = / (show|see|isolate|highlight|display) /.test(t);
  if (isoVerb && !has(t, "xray")) {
    const part = findWord(t, PART_WORDS);
    if (part) return { intent: "isolate", action: "control_body", target: part, commands: [{ cmd: "isolate", part }] };
  }

  // body: X-ray on/off (radiograph or coloured anatomy)
  if (has(t, "xray")) {
    const off = / (hide|off|stop|remove|turn off|close|no) /.test(t) || has(t, "normal view");
    const x = { cmd: "xray", on: !off };
    if (!off && / (anatomy|organs|colou?r|colou?red) /.test(t)) x.style = "anatomy";
    else if (!off && / (radiograph|bones only|real xray|plain xray) /.test(t)) x.style = "radiograph";
    return { intent: "xray", action: "control_body", target: "xray", commands: [x] };
  }
  // body: turn / rotate
  const deg = t.match(/ (rotate|turn) (?:it |me |the body )?(?:by )?(-?\d{1,3}) degrees? /);
  if (deg) return { intent: "rotate", action: "control_body", target: deg[2], commands: [{ cmd: "rotate_body", angle: Number(deg[2]) }] };
  if (/ (turn around|spin around|show (me )?my back|from (the )?back|back view|rear view|(turn|rotate) (me |the body |it )?(to )?(the )?back) /.test(t)) return { intent: "rotate", action: "control_body", target: "back", commands: [{ cmd: "rotate_body", view: "back" }] };
  if (/ (turn|rotate) (me |the body |it )?(to the )?left /.test(t) || has(t, "left side") || has(t, "left view")) return { intent: "rotate", action: "control_body", target: "left", commands: [{ cmd: "rotate_body", view: "left" }] };
  if (/ (turn|rotate) (me |the body |it )?(to the )?right /.test(t) || has(t, "right side") || has(t, "right view")) return { intent: "rotate", action: "control_body", target: "right", commands: [{ cmd: "rotate_body", view: "right" }] };
  if (/ (face me|front view|from the front|turn (me |the body |it )?(to the )?front) /.test(t)) return { intent: "rotate", action: "control_body", target: "front", commands: [{ cmd: "rotate_body", view: "front" }] };
  // body: zoom
  if (/ zoom (out|back)|reset (the )?(view|zoom) /.test(t)) return { intent: "zoom", action: "zoom", target: "reset", commands: [{ cmd: "zoom_body", zone: "reset" }] };
  if (/ zoom (in )?(into|in on|on|to|in) /.test(t) || / (close up|closer look) /.test(t)) {
    const z = findZones(t)[0];
    if (z) return { intent: "zoom", action: "zoom", target: z, commands: [{ cmd: "zoom_body", zone: z }] };
  }

  // full scan
  if (/ (full|body|whole body) scan /.test(t) || / (run|do|start) (a |the )?(full )?scan /.test(t) || has(t, "scan me") || has(t, "scan my body")) {
    return { intent: "scan", action: "start_check", target: "whole_body", commands: [{ cmd: "start_scan" }] };
  }

  // symptom entry by pointing at the body: "log a symptom", "where does it hurt", "something hurts"
  if (/ (log|report|record|add|enter) (a |an |my |new |another )?symptoms? /.test(t) || has(t, "where does it hurt") || has(t, "show where it hurts") ||
    (/ (something|it) hurts /.test(t) || / i (have|ve got|am in|m in) (a |some )?pain /.test(t)) && !findZones(t).length) {
    return { intent: "symptom", commands: [{ cmd: "open_screen", name: "symptom" }] };
  }

  // focused zone check / symptom triage: "check my chest", "i have a headache", "something feels off in my stomach", "my eye hurts", "my eyes are sore", "I can't see properly"
  const isSymptom = / (feels? (off|weird|wrong|strange|funny|bad|tight|sore)|hurts?|aches?|aching|sore|pain|tight|cant see|blurry|cant breathe|dizzy|nauseous|something (is )?(off|wrong) (with|in)|not right (with|in)) /.test(t) ||
    / (have|got) (a |an )?/.test(t) ||
    has(t, "headache");
  const checkVerb = / (check|scan|examine|inspect|test|triage) (my |the |on |out )?/.test(t) || isSymptom;
  if (checkVerb) {
    const zs = findZones(t).filter((z) => z !== "whole_body");
    if (zs.length) return { intent: "check", action: isSymptom ? "report_symptom" : "start_check", target: zs[0], commands: [{ cmd: "check_zone", zones: zs.slice(0, 3) }] };
  }

  // cabin status (answered locally)
  if (/ how (is|s) the (cabin|air) /.test(t) || has(t, "cabin status") || has(t, "check the cabin") || /^ (cabin|cabin air) $/.test(t)) {
    return { intent: "cabin", action: "navigate", target: "cabin", local: "cabin", commands: [] };
  }

  // vision
  if (/ (let me see you|look at me|see me|watch me|open (the )?camera|start (the )?camera) /.test(t)) {
    return { intent: "vision", action: "navigate", target: "vision", commands: [{ cmd: "open_screen", name: "vision" }, { cmd: "start_scan" }] };
  }

  // radiation layer toggle
  if (/ radiation layer /.test(t)) {
    const off = / (hide|off|remove) /.test(t);
    return { intent: "radiation_layer", action: "control_body", target: "radiation", commands: [{ cmd: "show_radiation", on: !off }] };
  }

  // trend charts: "show my heart rate trend", "glucose history"
  if (/ (trend|trends|history|chart|graph) /.test(t)) {
    const m = findWord(t, METRIC_WORDS);
    if (m) return { intent: "chart", action: "navigate", target: m, commands: [{ cmd: "show_chart", metric: m }] };
    return { intent: "trends", action: "navigate", target: "trends", commands: [{ cmd: "open_screen", name: "trends" }] };
  }

  // screens: open / show / start / go to
  const screen = findWord(t, SCREEN_WORDS);
  const verb = / (open|show|start|go to|take me to|launch|play|bring up|let s|lets|log) /.test(t);
  if (screen && (verb || t.trim().split(" ").length <= 3)) {
    if (screen === "home") return { intent: "close", action: "go_back", commands: [{ cmd: "close" }] };
    return { intent: `open_${screen}`, action: "navigate", target: screen, commands: [{ cmd: "open_screen", name: screen }] };
  }

  // point to a body zone: "show me my heart", "what's wrong with my eyes", "how is my stomach"
  const pointVerb = / (show me|show|what s wrong with|whats wrong with|what is wrong with|look at|point to|how is|how are|how s|hows) /.test(t);
  const zone = findWord(t, ZONE_WORDS);
  if (zone && pointVerb) return { intent: "point", action: "zoom", target: zone, commands: [{ cmd: "point_to", zone }] };

  // uncertain single zone mention -> clarification
  if (zone && t.trim().split(" ").length <= 2) {
    const friendlyName = { head: "head", eyes: "eyes", heart: "heart", lungs: "chest", gut: "stomach", bones: "bones and joints" }[zone] || zone;
    return { intent: "clarify", action: "clarify", target: zone, question: `Did you mean your ${friendlyName}?`, commands: [{ cmd: "check_zone", zones: [zone] }] };
  }

  return null;
}
