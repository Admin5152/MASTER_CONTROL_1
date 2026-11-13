// What each reading is, where it came from (badge), and how to describe it.
// Badge rule: LIVE only when the value was really measured or entered now; anything a
// scenario, the demo panel or the simulator wrote is SIM.

export const ZONE_NAMES = {
  head: "Brain and cognition", eyes: "Eyes and vision", heart: "Heart and circulation", lungs: "Lungs and breathing",
  gut: "Digestion and nutrition", bones: "Bones and muscles", whole_body: "Whole body: radiation", cabin: "Cabin air",
};

export const FIELD_LABELS = {
  "vitals.heart_rate": ["Heart rate", "bpm"], "vitals.breathing_rate": ["Breathing rate", "/min"], "vitals.spo2": ["SpO2", "%"],
  "manual.bp_systolic": ["Systolic pressure", "mmHg"], "manual.bp_diastolic": ["Diastolic pressure", "mmHg"],
  "manual.glucose_mgdl": ["Blood glucose", "mg/dL"], "manual.temp_c": ["Temperature", "C"], "manual.sleep_hours": ["Sleep", "h"],
  "manual.mood": ["Mood", "/5"], "cognitive.reaction_ms": ["Reaction time", "ms"], "voice.talk_time": ["Talk time", "s"],
  "voice.pitch": ["Voice pitch", "Hz"], "state.fatigue": ["Fatigue index", ""], "state.stress": ["Stress index", ""],
  "cabin.oxygen_pct": ["Cabin oxygen", "%"], "cabin.co2_ppm": ["Cabin CO2", "ppm"],
  "radiation.cumulative_msv": ["Modelled dose", "mSv"],
};

export function get(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Returns 'LIVE' | 'SIM'. */
export function badgeFor(field, state, aux) {
  if (!state) return "SIM";
  const prov = aux?.assessment?.provenance || {};
  if (field.startsWith("vitals.")) {
    const key = field.split(".")[1];
    const src = state.vitals?.sources?.[key];
    return src === "camera" || src === "sensor" ? "LIVE" : "SIM";
  }
  if (field.startsWith("manual.") || field.startsWith("cognitive.") || field.startsWith("wellbeing.")) {
    return prov[field] === "user" ? "LIVE" : "SIM";
  }
  if (field.startsWith("voice.")) return prov[field] === "voice" ? "LIVE" : "SIM";
  return "SIM"; // cabin, state indices, radiation model, engagement
}

export function badgeHTML(kind, extra = "") {
  const k = String(kind).toUpperCase();
  const cls = k.startsWith("LIVE") ? "badge-live" : k.startsWith("DESIGNED") ? "badge-designed"
    : k.startsWith("SNAPSHOT") ? "badge-snapshot" : k === "STALE" ? "badge-stale" : "badge-sim";
  return `<span class="badge ${cls}" ${extra}>${esc(kind)}</span>`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmt(v, field) {
  if (v == null || v === "") return "—";
  if (typeof v !== "number") return String(v);
  if (field?.startsWith("state.")) return v.toFixed(1);
  if (field === "manual.temp_c") return v.toFixed(1);
  if (field === "radiation.cumulative_msv") return v.toFixed(0);
  return Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString();
}

const SEV_RANK = { ok: 0, none: 0, info: 1, watch: 2, alert: 3 };

/** All readings that belong to a zone, worst first. */
export function zoneReadings(zone, state, aux) {
  const out = [];
  const seen = new Set();
  const abs = aux?.assessment?.absolute || [];
  for (const r of abs) {
    if (r.zone !== zone) continue;
    seen.add(r.metric);
    out.push({
      field: r.metric, label: r.label, value: r.value, unit: r.unit, severity: r.severity,
      badge: badgeFor(r.metric, state, aux), kind: r.kind, source: r.source, note: r.note, levels: r.levels,
      change: changeText(r.metric, state),
    });
  }
  for (const d of state?.drift?.items || []) {
    if (d.zone !== zone || seen.has(d.metric)) continue;
    seen.add(d.metric);
    const [label, unit] = FIELD_LABELS[d.metric] || [d.metric, ""];
    out.push({ field: d.metric, label, value: get(state, d.metric), unit, severity: d.severity,
      badge: badgeFor(d.metric, state, aux), kind: "demo_placeholder", change: changeText(d.metric, state) });
  }
  // fields shown for the zone even when no threshold applies
  const extra = { head: ["cognitive.reaction_ms", "voice.talk_time", "voice.pitch"], whole_body: ["radiation.cumulative_msv"] }[zone] || [];
  for (const f of extra) {
    if (seen.has(f)) continue;
    const v = get(state, f);
    if (v == null) continue;
    const [label, unit] = FIELD_LABELS[f];
    out.push({ field: f, label, value: v, unit, severity: "ok", badge: f.startsWith("radiation") ? "SIM · modelled" : badgeFor(f, state, aux), change: changeText(f, state) });
  }
  return out.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
}

/** "18% above your usual 64", worded as change from baseline. */
export function changeText(field, state) {
  const item = (state?.drift?.items || []).find((i) => i.metric === field);
  const base = {
    "vitals.heart_rate": state?.baseline?.heart_rate, "voice.talk_time": state?.baseline?.talk_time,
    "voice.pitch": state?.baseline?.pitch, "cognitive.reaction_ms": state?.cognitive?.baseline_ms,
  }[field];
  const v = get(state, field);
  if (item && item.delta_pct) {
    const dir = item.delta_pct > 0 ? "above" : "below";
    return `${Math.abs(Math.round(item.delta_pct))}% ${dir} your usual${base ? ` ${fmt(base, field)}` : ""}`;
  }
  if (base && typeof v === "number") {
    const pct = Math.round(((v - base) / base) * 100);
    if (Math.abs(pct) < 3) return `close to your usual ${fmt(base, field)}`;
    return `${Math.abs(pct)}% ${pct > 0 ? "above" : "below"} your usual ${fmt(base, field)}`;
  }
  if (item && field.startsWith("state.")) return "raised compared with your usual";
  return "";
}

export function statusWord(sev) {
  return { ok: "Normal", none: "Normal", info: "Watch", watch: "Watch", alert: "Alert" }[sev] || "Normal";
}
