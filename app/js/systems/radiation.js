import { mountPlanetExplorer } from "./planet-explorer.js";

// Radiation Watch stage: live NOAA proton flux (LIVE / SNAPSHOT / SIM replay) shown as the planet's

// particle stream and a flux chart, the modelled dose passport (SIM), and the storm checklist with a

// shelter timer. Reaction time beside dose rate is one tap away.

import { api } from "../core/api.js";

import { badgeHTML, esc } from "../interface/readings.js";



const PROFILES = { iss: "ISS", lunar: "Lunar surface", mars_transit: "Mars transit", mars_surface: "Mars surface" };

const WORDS = ["Quiet sun.", "Minor storm.", "Moderate storm.", "Strong storm.", "Severe storm.", "Extreme storm."];

const DEMO_LOCATIONS = {

  lunar: { latitude: 0.6741, longitude: 23.4729, source: "sim", updated: "" },

  mars_surface: { latitude: -4.5895, longitude: 137.4417, source: "sim", updated: "" },

};

const WORLD_NAMES = { iss: "Earth · orbit", lunar: "Moon · surface", mars_transit: "Mars · destination (in transit)", mars_surface: "Mars · surface" };

let shelterStart = null;



export function stormChecklist(level) {

  return `Solar radiation storm, level S${level}. Move to the shelter area now. Follow mission radiation operations guidance and await clearance. Log the time you entered the shelter.`;

}



export function renderRadiation(el, ctx) {

  const charts = [];

  let closeExplorer = null;

  let explorerProfile = null;
  el.innerHTML = `

    <section class="card rcard">

      <div class="card-head"><span class="label">Space weather</span><span data-sw-badge></span></div>


      <p class="note" data-sw-time></p>

      <div class="chart-box"><canvas data-flux role="img" aria-label="Proton flux, 24 hours, log scale"></canvas></div>

      <p class="fine">Protons at or above 10 MeV, NOAA GOES near Earth, log scale with S-level lines. On a deep-space mission the onboard dosimeter would feed this display ${badgeHTML("DESIGNED")}.</p>

      <div class="rad-location" aria-live="polite"><span class="label">Mission location · SIM</span><strong data-location-world></strong><p class="note" data-location-coords></p><p class="fine">Demo position only. The marker follows the selected mission world; no astronaut telemetry is connected.</p></div>

    </section>

    <section class="card rcard">

      <div class="card-head"><span class="label">Dose passport</span>${badgeHTML("SIM · illustrative dose model")}</div>

      <div style="display:flex;align-items:baseline;gap:var(--s-2);flex-wrap:wrap"><span class="big-stat num" data-cum>—</span><span class="note">mSv of the <span data-limit>600</span> mSv career limit</span></div>

      <div class="dose-bar" aria-hidden="true"><span data-bar></span></div>

      <p class="note" data-current-rate></p><p class="note" data-margin></p>

      <div class="field"><label for="rad-profile">Mission profile</label><select id="rad-profile">${Object.entries(PROFILES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>

      <p class="fine" data-rate-src></p>

      <p class="fine">A model (daily rate × mission days + storm dose), never a personal dosimeter reading.</p>

    </section>

    <section class="card rcard">

      <div class="card-head"><span class="label">Storm response</span><span class="card-status" data-shelter-st>—</span></div>

      <ol class="checklist"><li>Move to the shelter area (water and stowage walls).</li><li>Await clearance from the mission radiation operations team.</li><li>Log the time you entered.</li></ol>

      <button class="pill pill-dark pill-block" type="button" data-shelter aria-pressed="false">I am sheltered</button>

      <p class="note" data-shelter-info></p>

      <details class="more"><summary>Reaction time beside dose rate</summary>

        <div class="two"><div class="chart-box"><canvas data-react role="img" aria-label="Reaction time history"></canvas></div>

        <div class="chart-box"><canvas data-dose role="img" aria-label="Modelled dose rate history, SIM"></canvas></div></div>

        <p class="fine">Tracked together so a trend is noticed early; this is not a diagnosis.</p></details>

    </section>`;



  const explorerHost = document.createElement("div");
  explorerHost.className = "rad-planet-center";
  el.append(explorerHost);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const Chart = window.Chart;

  const sel = el.querySelector("#rad-profile");

  sel.value = ctx.view.state?.radiation?.mission_profile || "mars_transit";

  sel.addEventListener("change", () => ctx.patch({ radiation: { mission_profile: sel.value, location: DEMO_LOCATIONS[sel.value] || { latitude: null, longitude: null, source: "unknown", updated: "" } } }).then(() => { drawPassport(); ctx.space?.setProfile(sel.value); }));

  const shelterBtn = el.querySelector("[data-shelter]");

  shelterBtn.addEventListener("click", async () => {

    const on = !ctx.view.state.radiation.sheltered;

    shelterStart = on ? Date.now() : null;

    await ctx.patch({ radiation: { sheltered: on } });

    if (on) ctx.say("Shelter time logged. Await clearance from the mission radiation operations team.");

    drawPassport();

  });



  let fluxChart = null;

  async function drawFlux() {

    let sw;

    try { sw = await api.spaceweather(); } catch { return; }

    ctx.view.spaceweather = sw;

    const sc = sw.scenario;

    const level = sc ? sc.level : sw.level;

    ctx.space?.setStorm(level);

    const badge = "SIM";

    el.querySelector("[data-sw-badge]").innerHTML = badgeHTML(badge);

    el.querySelector("[data-sw-time]").textContent = sc ? sc.label : `${sw.source === "live" ? "Live NOAA" : "Saved snapshot"}${!Number.isFinite(Date.parse(sw.time)) || Date.now() - Date.parse(sw.time) > 900000 ? " / STALE" : ""}, data time ${sw.time || "unavailable"}. Latest flux ${Number.isFinite(sw.latest_flux) ? sw.latest_flux.toFixed(2) : "unavailable"} pfu. Dose model: SIM.`;

    // the planet window's hero

    document.getElementById("rad-level").textContent = `S${level}.`;

    document.getElementById("rad-word").textContent = WORDS[level] || WORDS[5];

    const pill = document.getElementById("rad-pill");

    pill.className = `status-pill${level >= 2 ? " is-alert" : level >= 1 ? " is-watch" : ""}`;

    document.getElementById("rad-pill-word").textContent = sc ? "Replay (SIM)" : sw.source === "live" ? "Live" : "Snapshot";

    document.getElementById("rad-lede").textContent = sc ? sc.label : `Protons at or above 10 MeV, measured by NOAA GOES near Earth. ${sw.source === "live" ? "Live feed." : `Saved snapshot from ${sw.time}.`}`;

    const pts = sc ? sc.series.map((p) => ({ x: `+${p.t}s`, y: p.flux })) : sw.series.slice(-288).map((p) => ({ x: p.t.slice(11, 16), y: p.flux }));

    if (!Chart) return;

    const data = { labels: pts.map((p) => p.x), datasets: [{ data: pts.map((p) => Math.max(0.01, p.y)), borderColor: css("--assist"), borderWidth: 2, pointRadius: 0, tension: 0.2, fill: { target: "origin", above: css("--assist-soft") } }] };

    if (fluxChart) { fluxChart.data = data; fluxChart.update("none"); return; }

    fluxChart = new Chart(el.querySelector("[data-flux]"), {

      type: "line", data,

      options: { responsive: true, maintainAspectRatio: false, animation: false,

        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y.toFixed(2)} pfu` } } },

        scales: { y: { type: "logarithmic", min: 0.01, max: 1e5, ticks: { color: css("--ink-3"), callback: (v) => ([0.01, 1, 100, 10000].includes(v) ? v : "") }, grid: { color: css("--rule") } },

          x: { ticks: { color: css("--ink-3"), maxTicksLimit: 5, maxRotation: 0 }, grid: { display: false } } } },

      plugins: [{ id: "sbands", beforeDatasetsDraw(chart) {

        const { ctx: g, chartArea: a, scales: { y } } = chart;

        g.save();

        [[10, "S1"], [100, "S2"], [1000, "S3"], [10000, "S4"], [100000, "S5"]].forEach(([v, name], i) => {

          const yy = y.getPixelForValue(v);

          g.strokeStyle = i >= 1 ? css("--alert") : css("--watch"); g.globalAlpha = 0.5; g.setLineDash([3, 4]);

          g.fillStyle = g.strokeStyle; g.globalAlpha = 0.04; g.fillRect(a.left, a.top, a.right - a.left, yy - a.top); g.globalAlpha = 0.5;

          g.beginPath(); g.moveTo(a.left, yy); g.lineTo(a.right, yy); g.stroke();

          g.globalAlpha = 0.9; g.fillStyle = g.strokeStyle; g.font = "11px Inter, sans-serif"; g.fillText(name, a.right - 20, yy - 3);

        });

        g.restore();

      } }],

    });

    charts.push(fluxChart);

  }



  function drawPassport() {

    const s = ctx.view.state;

    if (!s) return;

    const r = s.radiation;
    if (!r) return;
    const explorerKey = `${ctx.view.crewId}:${r.mission_profile}`;
    if (explorerKey !== explorerProfile) {
      closeExplorer?.();
      const others = (ctx.view.crew || []).filter((c) => c.crew_id !== ctx.view.crewId).map((c) => c.display_name);
      closeExplorer = mountPlanetExplorer(explorerHost, r.mission_profile, s.display_name, others, async (site, box) => {
        // a crewmate on the map: where they are, their radiation exposure and shelter state, and whether they need help.
        // Nothing from their health record: that is theirs to share.
        const c = (ctx.view.crew || []).find((x) => x.display_name === site.name);
        if (!c) return;
        try {
          const k = await api.crewCard(c.crew_id), x = k.radiation, me = c.crew_id === ctx.view.crewId;
          box.innerHTML = `<strong>${esc(k.display_name)}${me ? " (you)" : ""}</strong> · ${esc(site.status)} · ${esc(k.mode)} mode ${badgeHTML("SIM")}<br>
            Dose so far <strong>${x.cumulative_msv} mSv</strong> of ${x.career_limit_msv} · now ${x.dose_rate_usv_h} µSv/h · storm S${x.storm_level}${x.margin_days != null ? ` · about ${Math.round(x.margin_days)} days of margin` : ""}<br>
            ${x.shelter_advised ? (x.sheltered ? "In shelter." : "<strong>Shelter advised and not yet sheltered.</strong>") : "No shelter needed."}${k.needs_help ? " <strong>Has an urgent alert: check on them.</strong>" : " No urgent alert."}${k.buddy ? ` Buddy: ${esc(k.buddy)}.` : ""}
            <span class="fine">Health readings are private to ${me ? "you" : esc(k.display_name)}.</span>`;
        } catch { /* offline: the site line stays */ }
      });
      explorerProfile = explorerKey;
    }

    const a = ctx.view.aux?.assessment?.radiation || {};

    const location = DEMO_LOCATIONS[r.mission_profile] || null;

    ctx.space?.setProfile(r.mission_profile);

    ctx.space?.setLocation(location);

    el.querySelector("[data-location-world]").textContent = WORLD_NAMES[r.mission_profile] || "Unknown world";

    el.querySelector("[data-location-coords]").textContent = location

      ? `${Math.abs(location.latitude).toFixed(4)}° ${location.latitude < 0 ? "S" : "N"}, ${Math.abs(location.longitude).toFixed(4)}° ${location.longitude < 0 ? "W" : "E"} · SIM surface position (green marker)`

      : "No surface position: astronaut is in orbit or transit. SIM";

    el.querySelector("[data-cum]").textContent = r.cumulative_msv.toFixed(0);

    el.querySelector("[data-limit]").textContent = r.career_limit_msv;

    el.querySelector("[data-bar]").style.width = `${Math.min(100, (r.cumulative_msv / r.career_limit_msv) * 100)}%`;

    el.querySelector("[data-margin]").textContent = `Day ${r.mission_day} at ${r.dose_rate_msv_day} mSv/day: about ${a.margin_days != null ? Math.round(a.margin_days) : "—"} days of margin at this rate. Storm dose ${(a.storm_received_msv || 0).toFixed(3)} mSv received, ${(a.storm_avoided_msv || 0).toFixed(3)} mSv avoided by sheltering (illustrative shelter reduction; SIM).`;

    el.querySelector("[data-current-rate]").textContent = `${r.dose_rate_usv_h.toFixed(2)} µSv/h · ${r.event_level} · SIM (confidence 1). This module does not measure dose.`;

    const rs = a.rate_source;

    if (rs) el.querySelector("[data-rate-src]").innerHTML = `Rate source: <a class="src-link" href="${esc(rs.source.url)}" target="_blank" rel="noopener">${esc(rs.source.title)}</a> <span class="kind kind-${rs.kind}">${esc(rs.kind)}</span>`;

    shelterBtn.setAttribute("aria-pressed", String(r.sheltered));

    shelterBtn.textContent = r.sheltered ? "Leave shelter" : "I am sheltered";

    const stEl = el.querySelector("[data-shelter-st]");

    stEl.textContent = r.sheltered ? "Sheltered" : r.storm_level >= 3 ? "Shelter now" : "No action";

    stEl.className = `card-status ${r.sheltered ? "is-ok" : r.storm_level >= 3 ? "is-alert" : ""}`;

    const info = el.querySelector("[data-shelter-info]");

    if (r.sheltered && shelterStart) {

      const sec = Math.round((Date.now() - shelterStart) / 1000);

      info.textContent = `In shelter for ${Math.floor(sec / 60)} min ${sec % 60} s (entered ${new Date(shelterStart).toLocaleTimeString()}).`;

    } else info.textContent = r.storm_level >= 3 ? stormChecklist(r.storm_level) : "No shelter advisory (demo threshold S3).";

  }



  let sideDrawn = false;

  async function drawSide() {

    if (!Chart || sideDrawn) return;

    sideDrawn = true;

    const id = ctx.view.crewId;

    let react, dose;

    try { [react, dose] = await Promise.all([api.history(id, "cognitive.reaction_ms"), api.history(id, "radiation.dose_rate_usv_h")]); } catch { sideDrawn = false; return; }

    const s = ctx.view.state;

    const pts = react.points;

    const opts = (title) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: title, color: css("--ink-2") } },

      scales: { y: { ticks: { color: css("--ink-3") }, grid: { color: css("--rule") } }, x: { ticks: { color: css("--ink-3"), maxTicksLimit: 4 }, grid: { display: false } } } });

    charts.push(new Chart(el.querySelector("[data-react]"), { type: "line", data: { labels: pts.map((p) => new Date(p.t * 1000).toLocaleDateString()), datasets: [{ data: pts.map((p) => p.v), borderColor: css("--assist"), borderWidth: 2, pointRadius: 2 }] }, options: opts("Reaction time (ms)") }));

    const days = pts.map((p, i) => s.radiation.mission_day - (pts.length - 1 - i));

    charts.push(new Chart(el.querySelector("[data-dose]"), { type: "line", data: { labels: dose.points.map((p) => new Date(p.t * 1000).toLocaleTimeString()), datasets: [{ data: dose.points.map((p) => p.v), borderColor: css("--watch"), borderWidth: 2, pointRadius: 0 }] }, options: opts("Dose rate (µSv/h, SIM)") }));

  }

  el.querySelector("details")?.addEventListener("toggle", drawSide);



  drawFlux(); drawPassport();

  const timer = setInterval(() => { if (document.body.dataset.stage === "radiation") { drawFlux(); drawPassport(); } }, 2000);

  return () => { closeExplorer?.(); clearInterval(timer); charts.forEach((c) => c.destroy()); };

}
