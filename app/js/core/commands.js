// Director command whitelist and validator. Pure (no DOM): tested with node --test.
// The backend (brain/llm.py) keeps the same whitelist for LLM replies.
export const SCREENS = ["home", "assistant", "mission", "body", "vitals", "vision", "health_log", "trends", "radiation", "cabin",
  "cognitive", "orb_calm", "aurora_run", "race", "greenhouse", "grounding", "hardware", "crew", "wellbeing", "exam", "ground", "measures", "organ", "symptom",
  "interventions", "earth_window", "music", "connection", "readings", "settings", "about", "evidence"];
export const ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones", "whole_body"];
export const METRICS = ["heart_rate", "breathing_rate", "spo2", "bp", "glucose", "temp", "sleep", "mood",
  "reaction", "talk_time", "pitch", "o2", "co2"];
export const VIEWS = ["front", "back", "left", "right"];
export const MAX_COMMANDS = 3;
export const WEAR_ACTIONS = ["open", "close", "explode", "assemble", "zoom_in", "zoom_out", "turn", "reset", "alert"];
export const WEAR_ALERTS = ["normal", "health", "radiation", "sos", "suit"];
export const WEAR_PARTS = ["chest", "wrist", "patch"];
export const XRAY_STYLES = ["radiograph", "anatomy"];
/** Anatomy parts a person or the LLM can isolate: the 18 model nodes plus named groups. */
export const PARTS = ["skull", "spine", "ribcage", "shoulders", "pelvis", "limbs", "brain", "eyes", "heart", "lungs", "airway",
  "liver", "stomach", "intestines", "pancreas_spleen", "kidneys", "arteries", "veins", "vessels", "bones", "skeleton", "organs", "gut"];

/** Drop unknown commands, zones, screens, metrics and views; keep at most `max`. */
export function validateCommands(cmds, max = MAX_COMMANDS) {
  const out = [];
  if (!Array.isArray(cmds)) return out;
  for (const c of cmds) {
    if (!c || typeof c !== "object") continue;
    switch (c.cmd) {
      case "point_to": if (ZONES.includes(c.zone)) out.push({ cmd: "point_to", zone: c.zone }); break;
      case "open_screen": if (SCREENS.includes(c.name)) out.push({ cmd: "open_screen", name: c.name }); break;
      case "show_chart": if (METRICS.includes(c.metric)) out.push({ cmd: "show_chart", metric: c.metric }); break;
      case "start_scan": out.push({ cmd: "start_scan" }); break;
      case "show_radiation": out.push({ cmd: "show_radiation", on: c.on !== false }); break;
      case "close": out.push({ cmd: "close" }); break;
      case "suit": {
        if (!["eva", "iva", "leak", "seal"].includes(c.action)) break;
        const w = { cmd: "suit", action: c.action };
        if (typeof c.region === "string" && /^(helmet|torso|backpack|(left|right)_(arm|glove|leg|boot))$/.test(c.region)) w.region = c.region;
        if (typeof c.text === "string") w.text = c.text.slice(0, 120);
        out.push(w);
        break;
      }
      case "wearable": {
        if (!WEAR_ACTIONS.includes(c.action)) break;
        const w = { cmd: "wearable", action: c.action };
        if (WEAR_PARTS.includes(c.part)) w.part = c.part;
        if (["left", "right", "back", "front"].includes(c.direction)) w.direction = c.direction;
        if (c.action === "alert") { if (!WEAR_ALERTS.includes(c.kind)) break; w.kind = c.kind; }
        out.push(w);
        break;
      }
      case "rotate_body":
        if (VIEWS.includes(c.view)) out.push({ cmd: "rotate_body", view: c.view });
        else if (typeof c.angle === "number" && Number.isFinite(c.angle) && Math.abs(c.angle) <= 360) out.push({ cmd: "rotate_body", angle: c.angle });
        break;
      case "zoom_body":
        if (c.zone === "reset" || ZONES.includes(c.zone)) out.push({ cmd: "zoom_body", zone: c.zone });
        break;
      case "xray": {
        const x = { cmd: "xray", on: c.on !== false };
        if (XRAY_STYLES.includes(c.style)) x.style = c.style;
        out.push(x);
        break;
      }
      case "isolate": if (PARTS.includes(c.part)) out.push({ cmd: "isolate", part: c.part }); break;
      case "check_zone": {
        const zs = Array.isArray(c.zones) ? [...new Set(c.zones.filter((z) => ZONES.includes(z)))].slice(0, 3) : [];
        if (zs.length) out.push({ cmd: "check_zone", zones: zs });
        break;
      }
      default: break;
    }
    if (out.length >= max) break;
  }
  return out;
}
