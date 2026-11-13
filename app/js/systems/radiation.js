// Radiation Watch stage: live NOAA proton flux (LIVE / SNAPSHOT / SIM replay) shown as the planet's
// particle stream and a flux chart, the modelled dose passport (SIM), and the storm checklist with a
// shelter timer. Reaction time beside cumulative dose is one tap away.
import { api } from "../core/api.js";
import { badgeHTML, esc } from "../interface/readings.js";

const PROFILES = { iss: "ISS", lunar: "Lunar surface", mars_transit: "Mars transit", mars_surface: "Mars surface" };
const WORDS = ["Quiet sun.", "Minor storm.", "Moderate storm.", "Strong storm.", "Severe storm.", "Extreme storm."];
let shelterStart = null;

export function stormChecklist(level) {
  return `Solar radiation storm, level S${level}. Move to the shelter area now. Stay there until the level falls below S2. Log the time you entered the shelter.`;
}

export function renderRadiation(el, ctx) {
  const charts = [];
  el.innerHTML = `
    <section class="card rcard">
      <div class="card-head"><span class="label">Space weather</span><span data-sw-badge></span></div>
      <p class="note" data-sw-time></p>
      <div class="chart-box"><canvas data-flux role="img" aria-label="Proton flux, 24 hours, log scale"></canvas></div>
      <p class="fine">Protons at or above 10 MeV, NOAA GOES near Earth, log scale with S-level lines. On a deep-space mission the onboard dosimeter would feed this display ${badgeHTML("DESIGNED")}.</p>
    </section>
    <section class="card rcard">
      <div class="card-head"><span class="label">Dose passport</span>${badgeHTML("SIM · modelled from measured rates")}</div>
      <div style="display:flex;align-items:baseline;gap:var(--s-2);flex-wrap:wrap"><span class="big-stat num" data-cum>—</span><span class="note">mSv of the <span data-limit>600</span> mSv career limit</span></div>
      <div class="dose-bar" aria-hidden="true"><span data-bar></span></div>
      <p class="note" data-margin></p>
      <div class="field"><label for="rad-profile">Mission profile</label><select id="rad-profile">${Object.entries(PROFILES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <p class="fine" data-rate-src></p>
      <p class="fine">A model (daily rate × mission days + storm dose), never a personal dosimeter reading.</p>
    </section>
    <section class="card rcard">
      <div class="card-head"><span class="label">Storm response</span><span class="card-status" data-shelter-st>—</span></div>
      <ol class="checklist"><li>Move to the shelter area (water and stowage walls).</li><li>Stay until the level falls below S2.</li><li>Log the time you entered.</li></ol>
      <button class="pill pill-dark pill-block" type="button" data-shelter aria-pressed="false">I am sheltered</button>
      <p class="note" data-shelter-info></p>
      <details class="more"><summary>Reaction time beside cumulative dose</summary>
        <div class="two"><div class="chart-box"><canvas data-react role="img" aria-label="Reaction time history"></canvas></div>
        <div class="chart-box"><canvas data-dose role="img" aria-label="Modelled cumulative dose"></canvas></div></div>
        <p class="fine">Tracked together so a trend is noticed early; this is not a diagnosis.</p></details>
    </section>`;

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const Chart = window.Chart;
  const sel = el.querySelector("#rad-profile");
  sel.value = ctx.view.state?.radiation?.mission_profile || "mars_transit";
  sel.addEventListener("change", () => ctx.patch({ radiation: { mission_profile: sel.value } }).then(() => { drawPassport(); ctx.space?.setProfile(sel.value); }));
  const shelterBtn = el.querySelector("[data-shelter]");
  shelterBtn.addEventListener("click", async () => {
    const on = !ctx.view.state.radiation.sheltered;
    shelterStart = on ? Date.now() : null;
    await ctx.patch({ radiation: { sheltered: on } });
    if (on) ctx.say("Shelter time logged. Stay until the level falls below S2.");
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
    const badge = sc ? "SIM" : sw.source === "live" ? "LIVE · NOAA GOES" : "SNAPSHOT";
    el.querySelector("[data-sw-badge]").innerHTML = badgeHTML(badge);
    el.querySelector("[data-sw-time]").textContent = sc ? sc.label : `${sw.source === "live" ? "Live" : "Saved snapshot"}, data time ${sw.time}. Latest flux ${sw.latest_flux?.toFixed(2)} pfu.`;
    // the planet window's hero
    document.getElementById("rad-level").textContent = `S${level}.`;
    document.getElementById("rad-word").textContent = WORDS[level] || WORDS[5];
    const pill = document.getElementById("rad-pill");
    pill.className = `status-pill${level >= 2 ? " is-alert" : level >= 1 ? " is-watch" : ""}`;
    document.getElementById("rad-pill-word").textContent = sc ? "Replay (SIM)" : sw.source === "live" ? "Live" : "Snapshot";
    document.getElementById("rad-lede").textContent = sc ? sc.label : `Protons at or above 10 MeV, measured by NOAA GOES near Earth. ${sw.source === "live" ? "Live feed." : `Saved snapshot from ${sw.time}.`}`;
    const prof = ctx.view.state?.radiation?.mission_profile || "";
    document.getElementById("rad-credit").textContent = `${prof.startsWith("mars") ? "Mars" : "Earth"}, with the particle stream drawn from the current storm level (${badge})`;
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
    const a = ctx.view.aux?.assessment?.radiation || {};
    el.querySelector("[data-cum]").textContent = r.cumulative_msv.toFixed(0);
    el.querySelector("[data-limit]").textContent = r.career_limit_msv;
    el.querySelector("[data-bar]").style.width = `${Math.min(100, (r.cumulative_msv / r.career_limit_msv) * 100)}%`;
    el.querySelector("[data-margin]").textContent = `Day ${r.mission_day} at ${r.dose_rate_msv_day} mSv/day: about ${a.margin_days != null ? Math.round(a.margin_days) : "—"} days of margin at this rate. Storm dose ${(a.storm_received_msv || 0).toFixed(3)} mSv received, ${(a.storm_avoided_msv || 0).toFixed(3)} mSv avoided by sheltering (shelter factor 50%, NASA OCHMO).`;
    const rs = a.rate_source;
    if (rs) el.querySelector("[data-rate-src]").innerHTML = `Rate source: <a class="src-link" href="${esc(rs.source.url)}" target="_blank" rel="noopener">${esc(rs.source.title)}</a> <span class="kind kind-${rs.kind}">${esc(rs.kind)}</span>`;
    shelterBtn.setAttribute("aria-pressed", String(r.sheltered));
    shelterBtn.textContent = r.sheltered ? "Leave shelter" : "I am sheltered";
    const stEl = el.querySelector("[data-shelter-st]");
    stEl.textContent = r.sheltered ? "Sheltered" : r.storm_level >= 2 ? "Shelter now" : "No action";
    stEl.className = `card-status ${r.sheltered ? "is-ok" : r.storm_level >= 2 ? "is-alert" : ""}`;
    const info = el.querySelector("[data-shelter-info]");
    if (r.sheltered && shelterStart) {
      const sec = Math.round((Date.now() - shelterStart) / 1000);
      info.textContent = `In shelter for ${Math.floor(sec / 60)} min ${sec % 60} s (entered ${new Date(shelterStart).toLocaleTimeString()}).`;
    } else info.textContent = r.storm_level >= 2 ? stormChecklist(r.storm_level) : "No storm at S2 or above.";
  }

  let sideDrawn = false;
  async function drawSide() {
    if (!Chart || sideDrawn) return;
    sideDrawn = true;
    const id = ctx.view.crewId;
    let react;
    try { react = await api.history(id, "cognitive.reaction_ms"); } catch { return; }
    const s = ctx.view.state;
    const pts = react.points;
    const opts = (title) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: title, color: css("--ink-2") } },
      scales: { y: { ticks: { color: css("--ink-3") }, grid: { color: css("--rule") } }, x: { ticks: { color: css("--ink-3"), maxTicksLimit: 4 }, grid: { display: false } } } });
    charts.push(new Chart(el.querySelector("[data-react]"), { type: "line", data: { labels: pts.map((p) => new Date(p.t * 1000).toLocaleDateString()), datasets: [{ data: pts.map((p) => p.v), borderColor: css("--assist"), borderWidth: 2, pointRadius: 2 }] }, options: opts("Reaction time (ms)") }));
    const days = pts.map((p, i) => s.radiation.mission_day - (pts.length - 1 - i));
    charts.push(new Chart(el.querySelector("[data-dose]"), { type: "line", data: { labels: days.map((d) => `day ${Math.round(d)}`), datasets: [{ data: days.map((d) => +(Math.max(0, d) * s.radiation.dose_rate_msv_day).toFixed(1)), borderColor: css("--watch"), borderWidth: 2, pointRadius: 0 }] }, options: opts("Modelled dose (mSv, SIM)") }));
  }
  el.querySelector("details")?.addEventListener("toggle", drawSide);

  drawFlux(); drawPassport();
  const timer = setInterval(() => { if (document.body.dataset.stage === "radiation") { drawFlux(); drawPassport(); } }, 2000);
  return () => { clearInterval(timer); charts.forEach((c) => c.destroy()); };
}
