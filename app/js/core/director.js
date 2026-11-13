// The Director: every screen change goes through director.run(commands).
// Commands run in order; each returns a promise that resolves when its animation ends.
// A new run cancels the one in progress cleanly.
import { emit } from "./bus.js";
import { validateCommands } from "./commands.js";
import { cue } from "./sound.js";
import * as body from "../interface/body.js";
import { ZONE_NAMES, badgeHTML, esc, fmt, statusWord, zoneReadings } from "../interface/readings.js";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const SEV_COLOR = { ok: "var(--ok)", watch: "var(--watch)", alert: "var(--alert)", info: "var(--watch)" };
const sleep = (ms, token) => new Promise((res) => {
  const t = setTimeout(res, ms);
  token?.onCancel(() => { clearTimeout(t); res(); });
});

class Token {
  constructor() { this.cancelled = false; this.cbs = []; }
  onCancel(fn) { if (this.cancelled) fn(); else this.cbs.push(fn); }
  cancel() { if (this.cancelled) return; this.cancelled = true; this.cbs.splice(0).forEach((f) => { try { f(); } catch {} }); }
}

export function createDirector(deps) {
  const { orb, screens, say, getView, facts } = deps;
  const beamLayer = document.getElementById("beam-layer");
  const callout = document.getElementById("callout");
  const scanList = document.getElementById("scan-list");
  let current = null;
  let cleanup = [];
  const director = { lastScanVisits: [], busy: false, lastCommands: [] };

  function runCleanup() { cleanup.splice(0).reverse().forEach((f) => { try { f(); } catch {} }); }

  director.cancel = () => { current?.cancel(); current = null; runCleanup(); };

  director.run = async (commands) => {
    const cmds = validateCommands(commands, 6);
    director.cancel();
    const token = new Token();
    current = token;
    director.busy = true;
    director.lastCommands = cmds;
    emit("director:busy", true);
    try {
      for (const c of cmds) {
        if (token.cancelled) break;
        await step(c, token);
      }
    } finally {
      if (current === token) { director.busy = false; current = null; emit("director:busy", false); }
    }
  };

  async function step(c, token) {
    switch (c.cmd) {
      case "point_to": return pointTo(c.zone, token);
      case "open_screen": return screens.open(c.name);
      case "show_chart": return screens.chart(c.metric);
      case "start_scan": return fullScan(token);
      case "show_radiation": body.showRadiation(c.on); document.getElementById("btn-radlayer")?.setAttribute("aria-pressed", String(!!c.on)); return;
      case "close": screens.close(); return;
    }
  }

  // ---------- pointing sequence ----------
  function zoneSeverity(zone) {
    const v = getView();
    return v.aux?.assessment?.zones?.[zone] || "ok";
  }

  function makeLine(cls) {
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("class", cls);
    beamLayer.appendChild(l);
    return l;
  }

  function setLine(l, a, b) {
    l.setAttribute("x1", a.x); l.setAttribute("y1", a.y); l.setAttribute("x2", b.x); l.setAttribute("y2", b.y);
  }

  function sentenceFor(zone, readings) {
    const name = ZONE_NAMES[zone] || zone;
    const top = readings.find((r) => r.severity !== "ok") || readings[0];
    const z = facts?.zones?.[zone];
    if (!top) return `${name}. No readings for this area yet. ${z?.next || ""}`.trim();
    const val = `${fmt(top.value, top.field)}${top.unit && top.unit !== "/5" ? " " + top.unit : ""}`;
    const change = top.change ? `, ${top.change}` : "";
    const sev = top.severity === "ok" ? "within your usual range" : top.severity === "alert" ? "past the alert line" : "worth watching";
    return `${name}: ${top.label.toLowerCase()} ${val}${change}, ${sev}. ${z?.next || ""}`.trim();
  }

  function nextStepFor(zone) {
    const s = getView().state;
    const a = s?.action || {};
    if (a.type === "offer_orb_calm") return { label: "Start Orb Calm", cmd: { cmd: "open_screen", name: "orb_calm" } };
    if (a.type === "offer_intervention" && a.intervention) {
      const map = { breathing: "orb_calm", aurora_run: "aurora_run" };
      if (map[a.intervention]) return { label: a.intervention === "aurora_run" ? "Start Aurora Run" : "Start Orb Calm", cmd: { cmd: "open_screen", name: map[a.intervention] } };
      const names = { earth_window: "Open the Earth window", music: "Play ambient sound", connection: "Message a crewmate" };
      return { label: names[a.intervention] || "Open the suggestion", intervention: a.intervention };
    }
    if (zone === "whole_body") return { label: "Open Radiation Watch", cmd: { cmd: "open_screen", name: "radiation" } };
    if (zone === "head") return { label: "Run the cognitive check", cmd: { cmd: "open_screen", name: "cognitive" } };
    if (zone === "gut" || zone === "bones" || a.type === "suggest_medicine") return { label: "Open the health log", cmd: { cmd: "open_screen", name: "health_log" } };
    const metric = { heart: "heart_rate", lungs: "spo2", eyes: "sleep" }[zone] || "heart_rate";
    return { label: "See the trend", cmd: { cmd: "show_chart", metric } };
  }

  async function pointTo(zone, token) {
    const svg = body.bodySvg();
    if (!svg) return;
    const v = getView();
    const sev = zoneSeverity(zone);
    const color = SEV_COLOR[sev] || "var(--line)";
    document.documentElement.style.setProperty("--beam-color", color);
    const readings = zoneReadings(zone, v.state, v.aux);
    const a = body.anchorOf(zone);
    const fast = reduced();
    cue.point();

    if (zone === "whole_body") body.showRadiation(true);
    // 1. orb turns toward the zone, beam draws from orb to anchor
    const oc = orb.center();
    let target = body.screenPoint(a.x, a.y);
    const dx = target.x - oc.x, dy = target.y - oc.y, len = Math.hypot(dx, dy) || 1;
    orb.look(dx / len, dy / len);
    const beam = makeLine("beam");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("class", "beam-dot");
    dot.setAttribute("r", "5");
    beamLayer.appendChild(dot);
    const start = { x: oc.x + (dx / len) * oc.r, y: oc.y + (dy / len) * oc.r };
    const update = () => {
      target = body.screenPoint(a.x, a.y);
      setLine(beam, start, target);
      dot.setAttribute("cx", target.x); dot.setAttribute("cy", target.y);
      placeCallout(target);
    };
    cleanup.push(() => { beam.remove(); dot.remove(); orb.look(0, 0); body.setTarget(null); emit("vision:point", null); });
    setLine(beam, start, target);
    dot.setAttribute("cx", target.x); dot.setAttribute("cy", target.y);
    if (!fast && window.gsap) {
      const L = Math.hypot(target.x - start.x, target.y - start.y);
      beam.style.strokeDasharray = `${L}`;
      beam.style.strokeDashoffset = `${L}`;
      await new Promise((res) => { window.gsap.to(beam.style, { strokeDashoffset: 0, duration: 0.6, ease: "power2.out", onComplete: res }); token.onCancel(res); });
      beam.style.strokeDasharray = "";
    }
    if (token.cancelled) return;

    // 2. ring + zoom
    body.setTarget(zone);
    emit("vision:point", zone);
    cleanup.push(() => { if (body.isZoomed()) body.zoomReset(reduced() ? 0 : 0.6); });
    await body.zoomTo(body.zoomBoxFor(zone), fast ? 0 : 1.0, update);
    if (token.cancelled) return;

    // 3. callout card with leader line
    const sentence = sentenceFor(zone, readings);
    const next = nextStepFor(zone);
    const top = readings.find((r) => r.severity !== "ok") || readings[0];
    callout.innerHTML = `
      <h3>${esc(ZONE_NAMES[zone] || zone)} <span class="co-sev st-${sev}">${statusWord(sev)}</span></h3>
      ${top ? `<div class="co-reading"><span>${esc(top.label)}: <strong class="num">${esc(fmt(top.value, top.field))}</strong> ${esc(top.unit || "")}</span>${badgeHTML(top.badge)}</div>
      <div class="co-change">${esc(top.change || "No baseline comparison for this reading.")}</div>` : `<div class="co-change">No readings for this area yet.</div>`}
      <div class="co-mean">${esc(facts?.zones?.[zone]?.spaceflight?.split(". ")[0] || "")}.</div>
      <button class="btn btn-primary btn-big" type="button" data-next>${esc(next.label)}</button>`;
    callout.hidden = false;
    callout.dataset.zone = zone;
    const leader = makeLine("leader");
    cleanup.push(() => { leader.remove(); callout.hidden = true; callout.innerHTML = ""; });
    placeCallout(target, leader);
    if (!fast && window.gsap) window.gsap.fromTo(callout, { scaleX: 0.2, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.35, ease: "power2.out" });

    // 4. say it while the card is open; 6. wait for the user or eight seconds
    let acted = null;
    const waitUser = new Promise((res) => {
      callout.querySelector("[data-next]").addEventListener("click", () => { acted = next; res(); }, { once: true });
      token.onCancel(res);
    });
    say(sentence, { kind: "point" });
    await Promise.race([waitUser, sleep(8000, token)]);
    if (token.cancelled) return;

    // ease back
    if (!fast && window.gsap) {
      await new Promise((res) => window.gsap.to(callout, { opacity: 0, duration: 0.25, onComplete: res }));
    }
    runCleanup();
    await body.zoomReset(fast ? 0 : 0.8);
    if (acted) {
      if (acted.cmd) await step(acted.cmd, token);
      else if (acted.intervention) screens.intervention(acted.intervention);
    }
  }

  function placeCallout(target, leader) {
    if (callout.hidden) return;
    const host = document.getElementById("col-body").getBoundingClientRect();
    const cw = callout.offsetWidth || 320, ch = callout.offsetHeight || 220;
    let x = host.right + 12;
    if (x + cw > window.innerWidth - 8) x = Math.max(8, window.innerWidth - cw - 8);
    let y = Math.min(Math.max(8 + 64, target.y - ch / 2), window.innerHeight - ch - 8);
    callout.style.left = `${x}px`;
    callout.style.top = `${y}px`;
    const l = leader || beamLayer.querySelector(".leader");
    if (l) setLine(l, target, { x, y: Math.min(Math.max(target.y, y + 16), y + ch - 16) });
  }

  // ---------- full scan ----------
  async function fullScan(token) {
    const svg = body.bodySvg();
    if (!svg) return;
    const v = getView();
    const anchors = Object.fromEntries(body.ZONES.map((z) => [z, body.anchorOf(z)]));
    const order = body.scanOrder(anchors);
    const fast = reduced();
    director.lastScanVisits = [];
    scanList.innerHTML = "";
    if (body.isZoomed()) await body.zoomReset(0);
    svg.classList.add("is-scanning", "director-scan");
    body.ZONES.forEach((z) => body.zoneEl(z)?.classList.add("scan-pending"));
    const line = svg.querySelector("#scanline");
    const yState = { y: 20 };
    const setY = () => line?.setAttribute("transform", `translate(0 ${yState.y})`);
    cleanup.push(() => {
      svg.classList.remove("is-scanning", "director-scan");
      line?.removeAttribute("transform");
      body.ZONES.forEach((z) => body.zoneEl(z)?.classList.remove("scan-pending"));
    });
    say("Running a full scan.", { kind: "scan" });
    const results = [];
    for (const z of order) {
      if (token.cancelled) return;
      const toY = anchors[z].y;
      if (!fast && window.gsap) {
        await new Promise((res) => { window.gsap.to(yState, { y: toY, duration: Math.max(0.5, (toY - yState.y) / 140), ease: "none", onUpdate: setY, onComplete: res }); token.onCancel(res); });
      } else { yState.y = toY; setY(); await sleep(250, token); }
      if (token.cancelled) return;
      const sev = v.aux?.assessment?.zones?.[z] || "ok";
      body.zoneEl(z)?.classList.remove("scan-pending");
      cue.tick();
      director.lastScanVisits.push(z);
      const rs = zoneReadings(z, getView().state, getView().aux);
      const top = rs.find((r) => r.severity !== "ok") || rs[0];
      results.push({ zone: z, sev });
      const li = document.createElement("li");
      li.dataset.zone = z;
      li.innerHTML = `<span class="st st-${sev}">${statusWord(sev)}</span><span>${esc(ZONE_NAMES[z])}${top ? `: ${esc(top.label.toLowerCase())} ${esc(fmt(top.value, top.field))} ${esc(top.unit || "")}` : ": no sensor in this build"}</span>${top ? badgeHTML(top.badge) : badgeHTML("DESIGNED")}`;
      scanList.appendChild(li);
      await sleep(fast ? 100 : 450, token);
    }
    if (!fast && window.gsap) await new Promise((res) => { window.gsap.to(yState, { y: 860, duration: 1.2, ease: "none", onUpdate: setY, onComplete: res }); token.onCancel(res); });
    runCleanup();
    if (token.cancelled) return;
    const rank = { ok: 0, info: 1, watch: 2, alert: 3 };
    const worst = results.reduce((w, r) => (rank[r.sev] > rank[w.sev] ? r : w), { sev: "ok" });
    cue.done();
    if (worst.sev === "ok") {
      say("Scan complete. Everything is within your usual range.", { kind: "scan" });
    } else {
      const n = results.filter((r) => r.sev !== "ok").length;
      say(`Scan complete. ${n} area${n > 1 ? "s" : ""} need${n > 1 ? "" : "s"} a look; the most important is ${ZONE_NAMES[worst.zone].toLowerCase()}.`, { kind: "scan" });
      await sleep(2500, token);
      if (!token.cancelled) await pointTo(worst.zone, token);
    }
  }

  return director;
}
