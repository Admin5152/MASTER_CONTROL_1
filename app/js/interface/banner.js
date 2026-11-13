// Full-width alert banner: cabin, radiation and crew alerts. Persists until acknowledged.
import { api } from "../core/api.js";
import { startAlarm, stopAlarm } from "../core/sound.js";
import { stormChecklist } from "../systems/radiation.js";
import { zoneReadings } from "./readings.js";

const SIM_DELAY_MIN = 12.7; // SIM: one-way Earth-Mars light time chosen inside NASA's 4-24 minute range

export function createBanner({ say }) {
  const el = document.getElementById("banner");
  const title = document.getElementById("banner-title");
  const detail = document.getElementById("banner-detail");
  const ground = document.getElementById("banner-ground");
  const badge = document.getElementById("banner-badge");
  let activeKey = null;
  const acked = new Set();

  document.getElementById("banner-ack").addEventListener("click", async () => {
    if (activeKey) acked.add(activeKey);
    const wasCabin = activeKey?.startsWith("cabin");
    hide();
    if (wasCabin) { try { await api.cabin({ acknowledge: true }); } catch {} }
  });

  const setH = () => document.documentElement.style.setProperty("--banner-h", el.hidden ? "0px" : `${el.offsetHeight}px`);
  new ResizeObserver(setH).observe(el);
  function hide() { el.hidden = true; activeKey = null; stopAlarm(); setH(); }

  function show(key, t, d, sev, spoken, badgeText = "SIM") {
    if (activeKey === key) return;
    activeKey = key;
    el.hidden = false;
    el.classList.toggle("is-watch", sev === "watch");
    requestAnimationFrame(setH);
    title.textContent = t;
    detail.textContent = d;
    const now = new Date();
    const reply = new Date(now.getTime() + SIM_DELAY_MIN * 2 * 60000);
    ground.textContent = `Flagged to ground at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. One-way signal delay ${SIM_DELAY_MIN} min (SIM); earliest reply about ${reply.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
    badge.className = `badge ${badgeText.startsWith("LIVE") ? "badge-live" : "badge-sim"}`;
    badge.textContent = badgeText;
    startAlarm(sev);
    say(spoken, { priority: true });
  }

  /** Decide from state whether an alert is active. */
  function update(state, aux) {
    if (!state) return;
    const a = state.action || {};
    const cabin = state.cabin || {};
    let key = null, t = "", d = "", spoken = "", sev = "alert", b = "SIM";
    if (a.type === "flag_cabin" || cabin.alert) {
      key = `cabin`;
      t = "Cabin atmosphere alert";
      d = `${a.detail || "Cabin air out of range."} Cabin readings are simulated (SIM).`;
      spoken = `Caution. ${a.detail || "Cabin air is out of range."} I have flagged it to ground. Please acknowledge.`;
    } else if (a.type === "flag_radiation") {
      key = `rad-${state.radiation.storm_level}`;
      t = `Solar radiation storm S${state.radiation.storm_level}`;
      d = stormChecklist(state.radiation.storm_level);
      spoken = stormChecklist(state.radiation.storm_level);
      b = state.radiation.source === "live_feed" ? "LIVE · NOAA" : "SIM";
    } else if (a.type === "flag_ground") {
      key = `crew-${state.crew_id}-${a.zone}`;
      t = `${state.display_name}: reading past the alert line`;
      d = `${a.detail} This may warrant a check with the flight surgeon.`;
      spoken = `${state.display_name}, ${a.detail} This may warrant a check with the flight surgeon.`;
      const top = zoneReadings(a.zone, state, aux).find((r) => r.severity === "alert");
      b = top?.badge === "LIVE" ? "LIVE" : "SIM";
    }
    if (!key) {
      // the condition cleared: forget acknowledgements so a new alert shows again
      acked.clear();
      if (activeKey) hide();
      return;
    }
    if (acked.has(key)) return;
    show(key, t, d, sev, spoken, b);
  }

  return { update, hide, get active() { return activeKey; } };
}
