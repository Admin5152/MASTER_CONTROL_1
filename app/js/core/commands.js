// Director command whitelist and validator. Pure (no DOM): tested with node --test.
export const SCREENS = ["home", "vision", "health_log", "trends", "radiation", "cognitive", "orb_calm",
  "aurora_run", "greenhouse", "hardware", "crew"];
export const ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones", "whole_body"];
export const METRICS = ["heart_rate", "breathing_rate", "spo2", "bp", "glucose", "temp", "sleep", "mood",
  "reaction", "talk_time", "pitch", "o2", "co2"];
export const MAX_COMMANDS = 3;

/** Drop unknown commands, zones, screens and metrics; keep at most `max`. */
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
      default: break;
    }
    if (out.length >= max) break;
  }
  return out;
}
