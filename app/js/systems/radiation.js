// Radiation Watch screen: live NOAA proton flux (LIVE / SNAPSHOT / SIM replay), the modelled dose
// passport (SIM), the storm checklist with a shelter timer, and reaction time beside dose.
import { api } from "../core/api.js";
import { badgeHTML, esc } from "../interface/readings.js";

const PROFILES = { iss: "ISS", lunar: "Lunar surface", mars_transit: "Mars transit", mars_surface: "Mars surface" };
let shelterStart = null;

export function stormChecklist(level) {
  return `Solar radiation storm, level S${level}. Move to the shelter area now. Stay there until the level falls below S2. Log the time you entered the shelter.`;
}

export function renderRadiation(el, ctx) {
  const charts = [];
  let timer = null;
  el.innerHTML = `
    <div class="cols">
      <section>
        <h3>Space weather <span data-sw-badge></span></h3>
        <p class="big-stat num" data-level>S—</p>
        <p class="note" data-sw-time></p>
        <div class="chart-box"><canvas data-flux role="img" aria-label="Proton flux, 24 hours, log scale"></canvas></div>
        <p class="note">Protons at or above 10 MeV measured by NOAA GOES near Earth, log scale, with NOAA S-level bands. On a deep-space mission the same display would be fed by the onboard dosimeter ${badgeHTML("DESIGNED")}.</p>
      </section>
      <section>
        <h3>Dose passport ${badgeHTML("SIM · modelled from measured rates")}</h3>
        <div class="field"><label for="rad-profile">Mission profile</label>
          <select id="rad-profile">${Object.entries(PROFILES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <p style="margin-top:var(--s-3)"><span class="big-stat num" data-cum>—</span> <span class="note">mSv of the <span data-limit>600</span> mSv career limit</span></p>
        <div class="dose-bar" aria-hidden="true"><span data-bar></span></div>
        <p class="note" data-margin></p>
        <p class="note" data-rate-src></p>
        <p class="note">This is a model (daily rate × mission days + storm dose), never a personal dosimeter reading.</p>
        <h3>Storm response</h3>
        <ol class="checklist"><li>Move to the shelter area (water and stowage walls).</li><li>Stay until the level falls below S2.</li><li>Log the time you entered.</li></ol>
        <p><button class="btn btn-big" type="button" data-shelter aria-pressed="false">I am sheltered</button></p>
        <p class="note" data-shelter-info></p>
      </section>
    </div>
    <h3>Reaction time beside cumulative dose</h3>
    <div class="cols">
      <div class="chart-box"><canvas data-react role="img" aria-label="Reaction time history"></canvas></div>
      <div class="chart-box"><canvas data-dose role="img" aria-label="Modelled cumulative dose"></canvas></div>
    </div>
    <p class="note">Tracked together so a trend is noticed early; this is not a diagnosis.</p>`;

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const Chart = window.Chart;
  const sel = el.querySelector("#rad-profile");
  sel.value = ctx.view.state?.radiation?.mission_profile || "mars_transit";
  sel.addEventListener("change", () => ctx.patch({ radiation: { mission_profile: sel.value } }).then(drawPassport));
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
    el.querySelector("[data-level]").textContent = `S${level}`;
    el.querySelector("[data-sw-badge]").innerHTML = sc ? badgeHTML("SIM") : sw.source === "live" ? badgeHTML("LIVE · NOAA GOES") : badgeHTML("SNAPSHOT");
    el.querySelector("[data-sw-time]").textContent = sc ? sc.label : `${sw.source === "live" ? "Live" : "Saved snapshot"}, data time ${sw.time}. Latest flux ${sw.latest_flux?.toFixed(2)} pfu.`;
    const pts = sc ? sc.series.map((p) => ({ x: `+${p.t}s`, y: p.flux })) : sw.series.slice(-288).map((p) => ({ x: p.t.slice(11, 16), y: p.flux }));
    if (!Chart) return;
    const data = { labels: pts.map((p) => p.x), datasets: [{ data: pts.map((p) => Math.max(0.01, p.y)), borderColor: css("--line"), borderWidth: 2, pointRadius: 0, tension: 0.2 }] };
    if (fluxChart) { fluxChart.data = data; fluxChart.update("none"); return; }
    fluxChart = new Chart(el.querySelector("[data-flux]"), {
      type: "line", data,
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y.toFixed(2)} pfu` } } },
        scales: { y: { type: "logarithmic", min: 0.01, max: 1e5, ticks: { color: css("--ink-dim"), callback: (v) => ([0.01, 0.1, 1, 10, 100, 1000, 10000, 100000].includes(v) ? v : "") }, grid: { color: css("--rule") } },
          x: { ticks: { color: css("--ink-faint"), maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } } } },
      plugins: [{ id: "sbands", beforeDatasetsDraw(chart) {
        const { ctx: g, chartArea: a, scales: { y } } = chart;
        g.save();
        [[10, "S1"], [100, "S2"], [1000, "S3"], [10000, "S4"], [100000, "S5"]].forEach(([v, name], i) => {
          const yy = y.getPixelForValue(v);
          g.strokeStyle = i >= 1 ? css("--alert") : css("--watch"); g.globalAlpha = 0.6; g.setLineDash([4, 4]);
          g.beginPath(); g.moveTo(a.left, yy); g.lineTo(a.right, yy); g.stroke();
          g.globalAlpha = 0.9; g.fillStyle = g.strokeStyle; g.font = "12px sans-serif"; g.fillText(name, a.right - 24, yy - 4);
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
    const bar = el.querySelector("[data-bar]");
    bar.style.width = `${Math.min(100, (r.cumulative_msv / r.career_limit_msv) * 100)}%`;
    el.querySelector("[data-margin]").textContent = `Day ${r.mission_day} at ${r.dose_rate_msv_day} mSv/day: about ${a.margin_days != null ? Math.round(a.margin_days) : "—"} days of margin left at this rate. Storm dose so far ${(a.storm_received_msv || 0).toFixed(3)} mSv received, ${(a.storm_avoided_msv || 0).toFixed(3)} mSv avoided by sheltering (shelter factor 50%, NASA OCHMO).`;
    const rs = a.rate_source;
    if (rs) el.querySelector("[data-rate-src]").innerHTML = `Rate source: <a class="src-link" href="${esc(rs.source.url)}" target="_blank" rel="noopener">${esc(rs.source.title)}</a> <span class="kind kind-${rs.kind}">${esc(rs.kind)}</span>`;
    shelterBtn.setAttribute("aria-pressed", String(r.sheltered));
    shelterBtn.textContent = r.sheltered ? "Leave shelter" : "I am sheltered";
    shelterBtn.classList.toggle("btn-primary", r.sheltered);
    const info = el.querySelector("[data-shelter-info]");
    if (r.sheltered && shelterStart) {
      const sec = Math.round((Date.now() - shelterStart) / 1000);
      info.textContent = `In shelter for ${Math.floor(sec / 60)} min ${sec % 60} s (entered ${new Date(shelterStart).toLocaleTimeString()}).`;
    } else info.textContent = r.storm_level >= 2 ? stormChecklist(r.storm_level) : "No storm at S2 or above.";
  }

  async function drawSide() {
    if (!Chart) return;
    const id = ctx.view.crewId;
    let react;
    try { react = await api.history(id, "cognitive.reaction_ms"); } catch { return; }
    const s = ctx.view.state;
    const pts = react.points;
    charts.push(new Chart(el.querySelector("[data-react]"), {
      type: "line",
      data: { labels: pts.map((p) => new Date(p.t * 1000).toLocaleDateString()), datasets: [{ data: pts.map((p) => p.v), borderColor: css("--line"), borderWidth: 2, pointRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: "Reaction time (ms)", color: css("--ink-dim") } },
        scales: { y: { ticks: { color: css("--ink-dim") }, grid: { color: css("--rule") } }, x: { ticks: { color: css("--ink-faint"), maxTicksLimit: 5 }, grid: { display: false } } } },
    }));
    const days = pts.map((p, i) => s.radiation.mission_day - (pts.length - 1 - i));
    charts.push(new Chart(el.querySelector("[data-dose]"), {
      type: "line",
      data: { labels: days.map((d) => `day ${Math.round(d)}`), datasets: [{ data: days.map((d) => +(Math.max(0, d) * s.radiation.dose_rate_msv_day).toFixed(1)), borderColor: css("--watch"), borderWidth: 2, pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: "Modelled cumulative dose (mSv, SIM)", color: css("--ink-dim") } },
        scales: { y: { ticks: { color: css("--ink-dim") }, grid: { color: css("--rule") } }, x: { ticks: { color: css("--ink-faint"), maxTicksLimit: 5 }, grid: { display: false } } } },
    }));
  }

  drawFlux(); drawPassport(); drawSide();
  timer = setInterval(() => { drawFlux(); drawPassport(); }, 2000);
  return () => { clearInterval(timer); charts.forEach((c) => c.destroy()); };
}
