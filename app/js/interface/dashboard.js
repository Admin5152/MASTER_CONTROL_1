// Mission hero + five cards (ref 02), and the body screen's findings list (ref 07's problem list).
import { api } from "../core/api.js";
import { plantSVG } from "../experience/greenhouse.js";
import { ZONE_NAMES, badgeHTML, esc, fmt, statusWord, zoneReadings } from "./readings.js";
import { tileMarkup } from "./tiles.js";

const PROFILE = { iss: "ISS orbit.", lunar: "Lunar surface.", mars_transit: "Mars transit.", mars_surface: "Mars surface." };
const RANK = { ok: 0, none: 0, info: 1, watch: 2, alert: 3 };
const worstOf = (zones) => Object.values(zones || {}).reduce((w, s) => (RANK[s] > RANK[w] ? s : w), "ok");

export function mountMission(host, onOpen) {
  host.innerHTML = `
    <button class="mcard card" type="button" data-card="crew">
      <div class="card-head"><span class="label">Crew status</span><span class="card-status" data-crew-count>—</span></div>
      <ul class="crew-list" data-crew-list></ul>
      <div class="foot"><span class="sub" data-crew-note>Manual selection</span></div>
    </button>
    <button class="mcard card" type="button" data-card="cabin">
      <div class="card-head"><span class="label">Cabin</span><span class="card-status" data-cabin-st>—</span></div>
      <div style="display:grid;gap:var(--s-2);align-content:center">
        <div class="gauge-row"><span>O2</span><div class="meter" data-o2m><span></span></div><strong class="num" data-o2>—</strong></div>
        <div class="gauge-row"><span>CO2</span><div class="meter" data-co2m><span></span></div><strong class="num" data-co2>—</strong></div>
      </div>
      <div class="foot"><span class="sub">No cabin sensor in this build</span>${badgeHTML("SIM")}</div>
    </button>
    <button class="mcard card" type="button" data-card="radiation">
      <div class="card-head"><span class="label">Radiation</span><span class="card-status" data-rad-st>—</span></div>
      <div style="display:grid;gap:2px;align-content:center"><span class="big" data-tile-host="storm"></span><span class="sub">NOAA solar radiation storm level</span></div>
      <div class="foot"><span class="sub" data-tile-host="dose"></span></div>
    </button>
    <button class="mcard card" type="button" data-card="checkin">
      <div class="card-head"><span class="label">Next check-in</span><span class="card-status" data-ck-st>Routine</span></div>
      <div style="display:grid;gap:2px;align-content:center"><span class="big" data-ck-what>—</span><span class="sub" data-ck-when></span></div>
      <div class="foot"><span class="sub" data-ck-streak></span>${badgeHTML("LIVE")}</div>
    </button>
    <button class="mcard card" type="button" data-card="greenhouse">
      <div class="card-head"><span class="label">Greenhouse</span><span class="card-status" data-gh-st>—</span></div>
      <div class="plant" data-plant></div>
      <div style="display:grid;gap:2px;align-content:end;padding-right:64px"><span class="big" data-gh-stage>—</span><span class="sub">Grows with your daily routine</span></div>
      <div class="foot"><span class="sub">NASA Veggie research</span></div>
    </button>`;
  host.querySelector('[data-tile-host="storm"]').innerHTML = tileMarkup("storm");
  host.querySelector('[data-tile-host="dose"]').innerHTML = `Modelled dose ${tileMarkup("dose")}`;
  host.querySelectorAll("[data-card]").forEach((b) => b.addEventListener("click", () => onOpen(b.dataset.card)));
}

let crewStates = {};
let crewT = 0;
async function refreshCrew(view) {
  if (Date.now() - crewT < 6000) return;
  crewT = Date.now();
  const out = {};
  await Promise.all((view.crew || []).map(async (c) => {
    try { out[c.crew_id] = (await api.json(`../api/assessment/${c.crew_id}`)).zones || {}; } catch { /* keep last */ }
  }));
  crewStates = { ...crewStates, ...out };
}

export function renderMission(host, view, extras) {
  const s = view.state, aux = view.aux;
  if (!s) return;
  refreshCrew(view);
  // hero
  const sevAll = worstOf(aux?.assessment?.zones);
  const cabinSev = s.cabin.alert ? "alert" : "ok";
  const stormSev = s.radiation.storm_level >= 2 ? "alert" : s.radiation.storm_level >= 1 ? "watch" : "ok";
  const sys = [cabinSev, stormSev].reduce((w, x) => (RANK[x] > RANK[w] ? x : w), "ok");
  const pill = document.getElementById("sys-status");
  pill.className = `status-pill${sys === "ok" ? "" : ` is-${sys}`}`;
  document.getElementById("sys-status-word").textContent = sys === "alert" ? (s.cabin.alert ? "Cabin alert" : "Storm alert") : sys === "watch" ? "Watch" : "Nominal";
  document.getElementById("md-profile").textContent = PROFILE[s.radiation.mission_profile] || "Mission.";
  document.getElementById("md-day").textContent = `Day ${aux?.clock?.mission_day ?? s.radiation.mission_day}.`;
  const crewSev = RANK[sevAll] >= RANK[sys] ? sevAll : sys;
  const st = document.getElementById("md-state");
  st.className = `is-${crewSev === "ok" ? "nominal" : crewSev === "info" ? "watch" : crewSev}`;
  st.textContent = crewSev === "ok" ? "All nominal." : crewSev === "alert" ? "Needs attention." : "One to watch.";
  document.getElementById("ms-crew").textContent = (view.crew || []).length || "—";
  document.getElementById("ms-day").textContent = aux?.clock?.mission_day ?? s.radiation.mission_day;
  // crew card
  const list = host.querySelector("[data-crew-list]");
  list.innerHTML = (view.crew || []).map((c) => {
    const zs = c.crew_id === view.crewId ? aux?.assessment?.zones : crewStates[c.crew_id];
    const w = worstOf(zs);
    return `<li class="${c.crew_id === view.crewId ? "is-me" : ""}"><span class="sdot is-${w === "info" ? "watch" : w}"></span>${esc(c.display_name)}<span style="margin-left:auto" class="st-${w}">${w === "ok" ? "" : statusWord(w)}</span></li>`;
  }).join("");
  const nWatch = (view.crew || []).filter((c) => RANK[worstOf(c.crew_id === view.crewId ? aux?.assessment?.zones : crewStates[c.crew_id])] >= 2).length;
  host.querySelector("[data-crew-count]").textContent = nWatch ? `${nWatch} to review` : "All nominal";
  host.querySelector("[data-crew-count]").className = `card-status ${nWatch ? "is-watch" : "is-ok"}`;
  host.querySelector("[data-crew-note]").textContent = s.identity?.source === "voice" ? "Identified by voice" : "Manual selection";
  // cabin card
  const o2 = s.cabin.oxygen_pct, co2 = s.cabin.co2_ppm;
  host.querySelector("[data-o2]").textContent = `${fmt(o2)}%`;
  host.querySelector("[data-co2]").textContent = `${Math.round(co2)}`;
  const o2m = host.querySelector("[data-o2m]"), co2m = host.querySelector("[data-co2m]");
  o2m.firstElementChild.style.width = `${Math.max(4, Math.min(100, ((o2 - 15) / 8) * 100))}%`;
  co2m.firstElementChild.style.width = `${Math.max(4, Math.min(100, (co2 / 5000) * 100))}%`;
  o2m.className = `meter${o2 < 19.5 ? " is-alert" : ""}`; co2m.className = `meter${co2 > 3947 ? " is-alert" : co2 > 3289 ? " is-watch" : ""}`;
  const cst = host.querySelector("[data-cabin-st]");
  cst.textContent = s.cabin.alert ? "Alert" : "Nominal"; cst.className = `card-status is-${s.cabin.alert ? "alert" : "ok"}`;
  // radiation card
  const rst = host.querySelector("[data-rad-st]");
  rst.textContent = extras.spaceweather?.scenario ? "Replay" : extras.spaceweather?.source === "live" ? "Live" : "Snapshot";
  rst.className = `card-status is-${stormSev}`;
  // check-in card
  const due = extras.due, next = extras.nextRoutine;
  host.querySelector("[data-ck-what]").textContent = due ? cap(due.label) : next ? cap(next.label) : "All done today";
  host.querySelector("[data-ck-when]").textContent = due ? "Due now" : next ? `From ${String(next.from).padStart(2, "0")}:00 mission time` : "Nothing else due";
  const ck = host.querySelector("[data-ck-st]");
  ck.textContent = due ? "Due now" : "Routine"; ck.className = `card-status${due ? " is-watch" : ""}`;
  host.querySelector("[data-ck-streak]").textContent = `Streak ${s.engagement.streak_days} days · ${s.engagement.checkins_today} today`;
  // greenhouse card
  host.querySelector("[data-plant]").innerHTML = plantSVG(s.engagement.greenhouse_stage, extras.wilt || 0);
  host.querySelector("[data-gh-stage]").textContent = `Stage ${s.engagement.greenhouse_stage}`;
  host.querySelector("[data-gh-st]").textContent = extras.wilt ? "Thirsty" : "Growing";
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------- findings (body screen, left column) ----------
export function renderFindings(listEl, statusEl, view, onPick) {
  const s = view.state, aux = view.aux;
  if (!s) return;
  const zones = ["head", "eyes", "heart", "lungs", "gut", "bones"];
  const rows = zones.map((z) => {
    const sev = aux?.assessment?.zones?.[z] || "ok";
    const rs = zoneReadings(z, s, aux);
    const top = rs.find((r) => r.severity !== "ok") || rs[0];
    return { z, sev, top };
  }).sort((a, b) => RANK[b.sev] - RANK[a.sev]);
  const key = JSON.stringify(rows.map((r) => [r.z, r.sev, r.top?.value, r.top?.badge, r.top?.change]));
  if (listEl.dataset.key === key) return;
  listEl.dataset.key = key;
  const n = rows.filter((r) => RANK[r.sev] >= 2).length;
  statusEl.textContent = n ? `${n} to review` : "All normal";
  statusEl.className = `card-status ${n ? (rows[0].sev === "alert" ? "is-alert" : "is-watch") : "is-ok"}`;
  listEl.innerHTML = rows.map(({ z, sev, top }) => `<li><button class="finding is-${sev === "info" ? "watch" : sev}" type="button" data-z="${z}">
      <span class="fdot"></span><span class="ft">${esc(ZONE_NAMES[z])}</span>${top ? badgeHTML(top.badge) : badgeHTML("DESIGNED")}
      <span class="fd">${top ? `${esc(top.label)} ${esc(fmt(top.value, top.field))} ${esc(top.unit || "")}${top.change ? `, ${esc(top.change)}` : ""}` : "No sensor yet: the wearable design would add one"}</span>
    </button></li>`).join("");
  listEl.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.z)));
}
