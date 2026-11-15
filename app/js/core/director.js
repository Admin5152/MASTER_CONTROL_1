// The Director: every screen change and every body move goes through director.run(commands).
// Commands run in order; each returns a promise that resolves when its animation ends. A new run
// cancels the one in progress cleanly. Whitelist and validation: ./commands.js.
import { emit } from "./bus.js";
import { validateCommands } from "./commands.js";
import { cue } from "./sound.js";
import * as body from "../interface/body.js";
import { ZONE_NAMES, badgeHTML, esc, fmt, statusWord, zoneReadings } from "../interface/readings.js";
import { skinReadings, mountUltrasound } from "../wearable/skin.js";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const SEV_COLOR = { ok: "#3fbf80", watch: "#ffb547", info: "#ffb547", alert: "#ff3b4e" };
const NS = "http://www.w3.org/2000/svg";
const sleep = (ms, token) => new Promise((res) => {
  const t = setTimeout(res, ms);
  token?.onCancel(() => { clearTimeout(t); res(); });
});
const INFO_ICON = '<svg class="co-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';

class Token {
  constructor() { this.cancelled = false; this.cbs = []; }
  onCancel(fn) { if (this.cancelled) fn(); else this.cbs.push(fn); }
  cancel() { if (this.cancelled) return; this.cancelled = true; this.cbs.splice(0).forEach((f) => { try { f(); } catch {} }); }
}

export function createDirector(deps) {
  const { orb, screens, stages, say, getView, facts, onFrame } = deps;
  const beamLayer = document.getElementById("beam-layer");
  const callout = document.getElementById("callout");
  const scanList = document.getElementById("scan-list");
  let current = null;
  let cleanup = [];
  const director = { lastScanVisits: [], lastChecks: [], busy: false, lastCommands: [] };
  const b3 = () => body.body3d();

  function runCleanup() { cleanup.splice(0).reverse().forEach((f) => { try { f(); } catch {} }); }
  director.cancel = () => { current?.cancel(); current = null; runCleanup(); b3()?.cancelScan(); };

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
    } catch (e) {
      console.warn("director step failed", e);
    } finally {
      if (current === token) { director.busy = false; current = null; emit("director:busy", false); }
    }
  };

  const ctxHome = () => (deps.homeStage ? deps.homeStage() : "assistant");

  async function toBody() {
    if (stages.current !== "body") await stages.go("body");
    for (let i = 0; i < 40 && !b3(); i++) await sleep(150);
    return b3();
  }

  async function step(c, token) {
    switch (c.cmd) {
      case "point_to": return pointTo(c.zone, token, !!c.silent);
      case "open_screen": return screens.open(c.name);
      case "show_chart": return screens.chart(c.metric);
      case "start_scan": return fullScan(token);
      case "wearable": {
        if (c.action === "close") { if (stages.current === "vitals") await stages.go(ctxHome()); return; }
        if (stages.current !== "vitals") { screens.close?.(); await stages.go("vitals"); }
        emit("wear:cmd", c);
        return;
      }
      case "check_zone": return checkZones(c.zones, token);
      case "show_radiation": {
        await toBody();
        body.showRadiation(c.on);
        document.getElementById("btn-radlayer")?.setAttribute("aria-pressed", String(!!c.on));
        return;
      }
      case "rotate_body": { const b = await toBody(); return b?.rotate(c.view ?? c.angle); }
      case "zoom_body": { const b = await toBody(); return b?.zoomTo(c.zone); }
      case "xray": {
        const b = await toBody();
        document.getElementById("btn-xray")?.setAttribute("aria-pressed", String(!!c.on));
        if (c.on && c.style) b?.setStyle(c.style);
        else if (c.on && !b?.xray) b?.focus(null);
        return b?.setXray(c.on);
      }
      case "isolate": {
        const b = await toBody();
        document.getElementById("btn-xray")?.setAttribute("aria-pressed", "true");
        await b?.isolate(c.part);
        emit("body:isolate", c.part);
        return;
      }
      case "close": screens.close(); return;
    }
  }

  // ---------- shared pieces ----------
  function zoneSeverity(zone) { return getView().aux?.assessment?.zones?.[zone] || "ok"; }
  function readingsFor(zone) {
    const v = getView();
    return zoneReadings(zone, v.state, v.aux).concat(skinReadings(zone, v.aux?.skin));
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
    const a = getView().state?.action || {};
    if (a.type === "offer_orb_calm") return { label: "Start Stillpoint", cmd: { cmd: "open_screen", name: "orb_calm" } };
    if (a.type === "offer_intervention" && a.intervention) {
      const map = { breathing: "orb_calm", aurora_run: "race" };
      if (map[a.intervention]) return { label: a.intervention === "aurora_run" ? "Take a Slipstream break" : "Start Stillpoint", cmd: { cmd: "open_screen", name: map[a.intervention] } };
      const names = { earth_window: "Open the Earth window", music: "Play ambient sound", connection: "Message a crewmate" };
      return { label: names[a.intervention] || "Open the suggestion", intervention: a.intervention };
    }
    if (zone === "whole_body") return { label: "Open Radiation Watch", cmd: { cmd: "open_screen", name: "radiation" } };
    if (zone === "head") return { label: "Run the cognitive check", cmd: { cmd: "open_screen", name: "cognitive" } };
    if (zone === "gut" || zone === "bones" || a.type === "suggest_medicine") return { label: "Open the health log", cmd: { cmd: "open_screen", name: "health_log" } };
    const metric = { heart: "heart_rate", lungs: "spo2", eyes: "sleep" }[zone] || "heart_rate";
    return { label: "See the trend", cmd: { cmd: "show_chart", metric } };
  }

  function el(tag, cls) { const e = document.createElementNS(NS, tag); if (cls) e.setAttribute("class", cls); beamLayer.appendChild(e); return e; }

  function placeCallout(dot, leader) {
    if (callout.hidden) return;
    // the callout lives in the free column between the side panels, above the body tools: it never
    // covers a panel, a control or the subtitle lane (coordinator review, 1366x768)
    const host = document.getElementById("body-host").getBoundingClientRect();
    const tools = document.querySelector("#body-host .body-tools")?.getBoundingClientRect();
    const cw = callout.offsetWidth || 320, ch = callout.offsetHeight || 220;
    const minX = host.left + 8, maxX = Math.max(minX, host.right - cw - 8);
    const top0 = host.top + 56, bottomMax = (tools && tools.height ? tools.top : host.bottom) - 10;
    const side = dot.x - host.left >= host.right - dot.x ? "left" : "right";
    let x = side === "left" ? dot.x - cw - 56 : dot.x + 56;
    x = Math.min(Math.max(x, minX), maxX);
    const y = Math.min(Math.max(top0, dot.y - ch * 0.35), Math.max(top0, bottomMax - ch));
    callout.style.left = `${x}px`; callout.style.top = `${y}px`;
    callout.style.maxHeight = `${Math.max(160, bottomMax - y)}px`;
    if (leader) {
      const onLeft = x + cw / 2 < dot.x;
      const ex = onLeft ? x + cw : x;
      const ey = Math.min(Math.max(dot.y, y + 18), y + Math.min(ch, bottomMax - y) - 18);
      const mx = onLeft ? Math.max(ex + 12, dot.x - 40) : Math.min(ex - 12, dot.x + 40);
      leader.setAttribute("points", `${dot.x},${dot.y} ${mx},${ey} ${ex},${ey}`);
    }
  }

  /** Red dot + leader + callout that follow the zone every frame. Returns the wait-for-user promise. */
  function showCallout(zone, html, color, token, next) {
    document.documentElement.style.setProperty("--beam-color", color);
    const dot = el("circle", "beam-dot"); dot.setAttribute("r", "7");
    const leader = el("polyline", "leader");
    // beam: a thin line of light from the orb to the zone (spec 6.11 step 1)
    const beam = el("line", "beam");
    callout.innerHTML = html;
    callout.hidden = false;
    document.body.classList.add("is-pointing");
    callout.dataset.zone = zone;
    const off = onFrame(() => {
      const p = body.screenPoint(zone);
      dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y);
      const oc = orb.center();
      beam.setAttribute("x1", oc.x); beam.setAttribute("y1", oc.y); beam.setAttribute("x2", p.x); beam.setAttribute("y2", p.y);
      placeCallout(p, leader);
    });
    const p0 = body.screenPoint(zone);
    dot.setAttribute("cx", p0.x); dot.setAttribute("cy", p0.y);
    placeCallout(p0, leader);
    const oc = orb.center();
    beam.setAttribute("x1", oc.x); beam.setAttribute("y1", oc.y); beam.setAttribute("x2", p0.x); beam.setAttribute("y2", p0.y);
    if (!reduced() && window.gsap) {
      const L = Math.hypot(p0.x - oc.x, p0.y - oc.y);
      window.gsap.fromTo(beam, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.out" });
      window.gsap.fromTo(dot, { attr: { r: 0 } }, { attr: { r: 7 }, duration: 0.45, ease: "back.out(2)" });
      window.gsap.fromTo(callout, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.45, ease: "power2.out" });
    }
    const usOff = mountUltrasound(callout.querySelector("[data-us]"), zone, getView().aux?.skin);
    cleanup.push(() => { off(); usOff?.(); dot.remove(); leader.remove(); beam.remove(); callout.hidden = true; callout.innerHTML = ""; document.body.classList.remove("is-pointing"); });
    let acted = null;
    const wait = new Promise((res) => {
      callout.querySelector("[data-next]")?.addEventListener("click", () => { acted = next; res(); }, { once: true });
      token.onCancel(res);
    });
    return { wait, acted: () => acted };
  }

  async function easeOut(token, restoreXray) {
    if (!reduced() && window.gsap && !callout.hidden) await new Promise((res) => window.gsap.to(callout, { opacity: 0, duration: 0.25, onComplete: res }));
    runCleanup();
    const b = b3();
    body.setTarget(null);
    emit("vision:point", null);
    if (b) await Promise.all([b.zoomReset(reduced() ? 0 : 1.1), restoreXray === false ? b.setXray(false, 0.8) : Promise.resolve()]);
  }

  function readingRows(rs) {
    return rs.length ? `<ul class="co-list">${rs.slice(0, 5).map((r) => `<li><span>${esc(r.label)} <strong class="num">${esc(fmt(r.value, r.field))}</strong> ${esc(r.unit || "")}</span>${badgeHTML(r.badge)}</li>`).join("")}</ul>` : "";
  }
  const nowStr = () => new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  // ---------- pointing: best view, zoom, X-ray, red dot, leader, callout ----------
  async function pointTo(zone, token, silent = false) {
    const b = await toBody();
    if (!b || token.cancelled) return;
    const sev = zoneSeverity(zone);
    const readings = readingsFor(zone);
    const fast = reduced();
    const wasX = b.xray;
    cue.point();
    if (zone === "whole_body") body.showRadiation(true);
    orb.look(-0.6, 0.1);
    cleanup.push(() => orb.look(0, 0));
    await b.zoomTo(zone, fast ? 0 : 1.3);
    if (token.cancelled) return;
    b.focus(zone === "whole_body" ? null : zone);
    emit("body:zone", zone);
    await b.setXray(true, fast ? 0 : 0.7);
    body.setTarget(zone);
    emit("vision:point", zone);
    if (token.cancelled) return;
    const top = readings.find((r) => r.severity !== "ok") || readings[0];
    const next = nextStepFor(zone);
    const html = `
      <h3>${INFO_ICON}${esc(ZONE_NAMES[zone] || zone)}<span class="co-sev st-${sev}">${statusWord(sev)}</span></h3>
      <p class="co-time">${esc(nowStr())}</p>
      ${top ? `<div class="co-reading"><span>${esc(top.label)}: <strong class="num">${esc(fmt(top.value, top.field))}</strong> ${esc(top.unit || "")}</span>${badgeHTML(top.badge)}</div>
        <p class="co-change">${esc(top.change || "No baseline comparison for this reading.")}</p>` : `<p class="co-change">No readings for this area yet.</p>`}
      <p class="co-mean">${esc((facts?.zones?.[zone]?.spaceflight || "").split(". ")[0])}.</p>
      ${skinBlock(zone)}
      <button class="pill pill-dark pill-block" type="button" data-next>${esc(next.label)}</button>`;
    const co = showCallout(zone, html, SEV_COLOR[sev] || SEV_COLOR.alert, token, next);
    const spoken = silent ? Promise.resolve() : say(sentenceFor(zone, readings), { kind: "point" });
    await Promise.race([co.wait, untilSaid(spoken, token), sleep(45000, token)]);
    if (token.cancelled) return;
    await easeOut(token, wasX);
    const acted = co.acted();
    if (acted) {
      if (acted.cmd) await step(acted.cmd, token);
      else if (acted.intervention) screens.intervention(acted.intervention);
    }
  }

  function skinBlock(zone) {
    const skin = getView().aux?.skin;
    if (!skin?.on || !["heart", "lungs", "eyes", "gut"].includes(zone)) return "";
    return `<div class="us-panel" data-us><canvas></canvas><div class="us-cap"><span>Sentinel Skin ultrasound</span>${badgeHTML("SIM · Sentinel Skin")}</div></div>`;
  }

  // ---------- full scan: mesh sweep head to feet, then resolve into X-ray ----------
  async function fullScan(token) {
    const b = await toBody();
    if (!b || token.cancelled) return;
    const v = getView();
    const anchors = Object.fromEntries(body.ZONES.map((z) => [z, body.anchorOf(z)]));
    const order = body.scanOrder(anchors);
    const fast = reduced();
    director.lastScanVisits = [];
    scanList.innerHTML = "";
    body.setTarget(null);
    await Promise.all([b.zoomReset(fast ? 0 : 1.0), b.setXray(false, fast ? 0 : 0.5)]);
    if (token.cancelled) return;
    body.ZONES.forEach((z) => body.zoneEl(z)?.classList.add("scan-pending"));
    cleanup.push(() => body.ZONES.forEach((z) => body.zoneEl(z)?.classList.remove("scan-pending")));
    b.beginScan(b.top);
    say("Running a full scan.", { kind: "scan" });
    const results = [];
    let y = b.top;
    for (const z of order) {
      if (token.cancelled) return;
      const toY = anchors[z].h;
      await b.sweepTo(toY, fast ? 0 : Math.max(0.35, (y - toY) * 1.6));
      y = toY;
      if (token.cancelled) return;
      const sev = v.aux?.assessment?.zones?.[z] || "ok";
      body.zoneEl(z)?.classList.remove("scan-pending");
      b.setRing({ head: "head", eyes: "head", lungs: "chest", heart: "chest", gut: "waist", bones: "thighs" }[z]);
      cue.tick();
      director.lastScanVisits.push(z);
      const rs = readingsFor(z);
      const top = rs.find((r) => r.severity !== "ok") || rs[0];
      results.push({ zone: z, sev });
      const li = document.createElement("li");
      li.dataset.zone = z;
      li.innerHTML = `<span class="st st-${sev}">${statusWord(sev)}</span><span>${esc(ZONE_NAMES[z])}${top ? `: ${esc(top.label.toLowerCase())} ${esc(fmt(top.value, top.field))} ${esc(top.unit || "")}` : ": no sensor yet"}</span>${top ? badgeHTML(top.badge) : badgeHTML("DESIGNED")}`;
      scanList.appendChild(li);
      await sleep(fast ? 60 : 260, token);
    }
    await b.sweepTo(-0.02, fast ? 0 : 1.1);
    b.setRing(null);
    await b.endScan(true, fast ? 0 : 1.0);
    // radiograph first, then the coloured anatomy (brief section 9 item 2)
    await sleep(fast ? 0 : 1100, token);
    if (!token.cancelled) b.focus(null);
    document.getElementById("btn-xray")?.setAttribute("aria-pressed", "true");
    runCleanup();
    if (token.cancelled) return;
    const rank = { ok: 0, info: 1, watch: 2, alert: 3 };
    clearTimeout(director.scanClear);
    director.scanClear = setTimeout(() => { scanList.innerHTML = ""; }, 30000);
    const worst = results.reduce((w, r) => (rank[r.sev] > rank[w.sev] ? r : w), { sev: "ok" });
    director.lastScanFlagged = results.filter((r) => r.sev !== "ok").map((r) => r.zone);
    emit("body.scan.complete", { zones_flagged: director.lastScanFlagged, crewId: getView().crewId });
    cue.done();
    if (worst.sev === "ok") {
      await say("Scan complete. Everything is within your usual range.", { kind: "scan" });
      await sleep(2500, token);
      if (!token.cancelled) { await b.setXray(false, 1.0); document.getElementById("btn-xray")?.setAttribute("aria-pressed", "false"); }
    } else {
      const n = results.filter((r) => r.sev !== "ok").length;
      await say(`Scan complete. ${n} area${n > 1 ? "s" : ""} need${n > 1 ? "" : "s"} a look; the most important is ${ZONE_NAMES[worst.zone].toLowerCase()}.`, { kind: "scan" });
      await sleep(700, token);
      if (!token.cancelled) await pointTo(worst.zone, token);
    }
  }

  // ---------- focused zone check (team lead item 6) ----------
  async function checkZones(zones, token) {
    const b = await toBody();
    if (!b || token.cancelled) return;
    const fast = reduced();
    director.lastChecks = [];
    for (const zone of zones) {
      if (token.cancelled) return;
      const name = ZONE_NAMES[zone] || zone;
      const lower = name.toLowerCase().replace(/^.*?: /, "");
      say(`Checking your ${shortName(zone)}.`, { kind: "check" });
      await b.setXray(false, fast ? 0 : 0.4);
      await b.zoomTo(zone, fast ? 0 : 1.3);
      if (token.cancelled) return;
      const [top, bottom] = b.zoneSpan(zone);
      b.beginScan(top);
      b.setRing({ head: "head", eyes: "head", lungs: "chest", heart: "chest", gut: "waist", bones: "thighs" }[zone] || null);
      await b.sweepTo(bottom, fast ? 0 : 1.7);
      await b.endScan(true, fast ? 0 : 0.9);
      b.setRing(null);
      if (token.cancelled) return;
      await sleep(fast ? 0 : 700, token);
      if (token.cancelled) return;
      emit("body:zone", zone);
      b.focus(zone === "whole_body" ? null : zone);
      body.setTarget(zone);
      const sev = zoneSeverity(zone);
      const rs = readingsFor(zone);
      const result = { zone, sev, readings: rs.length };
      director.lastChecks.push(result);
      let html, spoken, next, color;
      if (!rs.length) {
        result.verdict = "no_sensor";
        next = { label: "Log a symptom", cmd: { cmd: "open_screen", name: "symptom" } };
        spoken = `I have no sensor on your ${shortName(zone)} yet. Would you like to log a symptom?`;
        color = SEV_COLOR.watch;
        html = `<h3>${INFO_ICON}${esc(name)}<span class="co-sev">No data</span></h3><p class="co-time">${esc(nowStr())}</p>
          <p class="co-change">${esc(spoken)}</p>${badgeHTML("DESIGNED")} <span class="fine">The Sentinel Skin wearable would add a sensor here.</span>
          <button class="pill pill-dark pill-block" type="button" data-next>${esc(next.label)}</button>`;
      } else if (sev === "ok" && rs.every((r) => r.severity === "ok")) {
        result.verdict = "ok";
        next = { label: "Done" };
        spoken = `All readings for your ${shortName(zone)} are within your usual range.`;
        color = SEV_COLOR.ok;
        html = `<h3>${INFO_ICON}${esc(name)}<span class="co-sev st-ok">Normal</span></h3><p class="co-time">${esc(nowStr())}</p>
          <p class="co-change">${esc(spoken)}</p>${readingRows(rs)}${skinBlock(zone)}
          <button class="pill pill-ghost pill-block" type="button" data-next>Done</button>`;
      } else {
        result.verdict = "finding";
        const topR = rs.find((r) => r.severity !== "ok") || rs[0];
        next = nextStepFor(zone);
        spoken = sentenceFor(zone, rs);
        color = SEV_COLOR[sev] || SEV_COLOR.alert;
        html = `<h3>${INFO_ICON}${esc(name)}<span class="co-sev st-${sev === "ok" ? "watch" : sev}">${statusWord(sev === "ok" ? "watch" : sev)}</span></h3><p class="co-time">${esc(nowStr())}</p>
          <div class="co-reading"><span>${esc(topR.label)}: <strong class="num">${esc(fmt(topR.value, topR.field))}</strong> ${esc(topR.unit || "")}</span>${badgeHTML(topR.badge)}</div>
          <p class="co-change">${esc((topR.change || "No baseline comparison for this reading").replace(/\.?$/, "."))} This is a change from your own baseline, not a diagnosis.</p>
          ${readingRows(rs.filter((r) => r !== topR))}${skinBlock(zone)}
          <button class="pill pill-dark pill-block" type="button" data-next>${esc(next.label)}</button>`;
      }
      void lower;
      const co = showCallout(zone, html, color, token, next);
      const said = say(spoken, { kind: "check" });
      await Promise.race([co.wait, untilSaid(said, token), sleep(45000, token)]);
      if (token.cancelled) return;
      const acted = co.acted();
      if (acted?.cmd) { await easeOut(token, false); await step(acted.cmd, token); return; }
      if (acted?.intervention) { await easeOut(token, false); screens.intervention(acted.intervention); return; }
      runCleanup();
      body.setTarget(null);
    }
    await easeOut(token, false);
  }

  /** Smooth pacing: a card stays until Sentinel has finished saying it (and at least long enough to read), then a
   *  short breath; the next step never cuts a sentence off. */
  async function untilSaid(spoken, token) {
    await Promise.all([Promise.resolve(spoken).catch(() => {}), sleep(reduced() ? 0 : 4000, token)]);
    await sleep(reduced() ? 0 : 1200, token);
  }

  function shortName(zone) {
    return { head: "head", eyes: "eyes", heart: "heart", lungs: "chest and lungs", gut: "stomach", bones: "bones and muscles", whole_body: "whole body" }[zone] || zone;
  }

  return director;
}
