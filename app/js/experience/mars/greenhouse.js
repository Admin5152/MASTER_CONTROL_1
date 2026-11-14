// Mars Colony Farm (full screen): a 3D Mars base (base3d.js) where you grow crops that have really been
// grown in space and fill the crew's meal orders. The loop: pick a seed and tap planters to sow -> water
// them when they get thirsty halfway -> harvest into the store -> deliver orders for coins and XP -> level
// up to unlock crops -> spend coins in the shop on planters and upgrades. Clean the dust off the solar
// array; ride out dust storms; Sunlamps (from Orb Calm sessions) double growth for a while. Mood before and
// after is logged. All rules live in farm.js (tested); this file is the HUD and the feedback ("juice").
import { api } from "../../core/api.js";
import { cue } from "../../core/sound.js";
import { greenhouseCalm } from "../logic.js";
import { moodRow, scienceDrawer } from "../science.js";
import { createMarsBase } from "./base3d.js";
import * as F from "./farm.js";
import { cropIcon } from "./plants.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KEY = (id) => `sentinel.mars.v2.${id}`;
const nowS = () => Date.now() / 1000;
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const SVG = {
  coin: '<svg viewBox="0 0 24 24" class="i-coin"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.5h-3a1.8 1.8 0 0 0 0 3.5h4"/></svg>',
  drop: '<svg viewBox="0 0 24 24" class="i-drop"><path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" class="i-bolt"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" class="i-sun"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  basket: '<path d="M4 10h16l-2 9H6zM8 10l4-6 4 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"/>',
  dim: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  shop: '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1.5 11h-13zM8 9V7a4 4 0 0 1 8 0v2"/></svg>',
};
const DISH = { salad: "a salad", "stir-fry": "a stir-fry", soup: "soup", tacos: "tacos", snack: "a snack", bouquet: "flowers for the galley" };

function loadSaved(id) { try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch { return null; } }
function save(id, f) { try { localStorage.setItem(KEY(id), JSON.stringify(f)); } catch { /* private mode */ } }

export function renderGreenhouse(el, ctx) {
  const id = ctx.view.crewId;
  const world = ctx.world;
  const eng = () => ctx.view.state?.engagement || {};
  const saved = loadSaved(id);
  const f = F.loadFarm(saved, nowS());
  if (!saved) f.sunlampSeen = eng().calm_levels_cleared || 0;
  const away = F.catchUp(f, nowS());
  const lampsEarned = F.syncSunlamps(f, eng().calm_levels_cleared || 0);
  const prevScene = world.active;
  let moodBefore = null, startedAt = performance.now(), alive = true, seed = null, sel = -1;
  const session = { orders: 0, coins: 0, harvests: 0 };

  el.innerHTML = `<div class="gh gh3 farm">
    <div class="gh-dust" data-dust hidden></div>
    <div class="gh-tags" data-tags>
      ${Array.from({ length: F.MAX_PODS }, (_, i) => `<button type="button" class="ftag" data-tag="${i}"><span class="ftag-ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" pathLength="1"/></svg><svg viewBox="0 0 24 24" class="ic" data-ic></svg></span><span class="ftag-t" data-t></span></button>`).join("")}
      <button type="button" class="ftag ftag-solar" data-solar hidden><span class="ftag-ring">${SVG.bolt}</span><span class="ftag-t">Clean panels</span></button>
    </div>
    <div class="fx" data-fx></div>
    <header class="farm-top">
      <div class="farm-lvl"><span class="farm-star"><b data-lv></b></span><span class="farm-xp"><i data-xp></i></span><small data-xpt></small></div>
      <div class="farm-chip is-coin" data-coins-chip>${SVG.coin}<b data-coins></b></div>
      <div class="farm-chip is-water">${SVG.drop}<b data-water></b></div>
      <div class="farm-chip is-power" data-power-chip>${SVG.bolt}<b data-power></b></div>
      <span class="farm-sp"></span>
      <button type="button" class="farm-btn is-lamp" data-lamp>${SVG.sun}<b data-lamps></b><small>Sunlamp</small></button>
      <button type="button" class="farm-btn is-shop" data-shop>${SVG.shop}<small>Shop</small></button>
    </header>
    <aside class="farm-orders"><p class="farm-h">Crew orders</p><div data-orders></div></aside>
    <div class="farm-seed" data-seedbar hidden></div>
    <footer class="farm-store"><span class="farm-h">Store</span><div class="farm-store-items" data-store></div>
      <span class="farm-sp"></span><button type="button" class="farm-link" data-why>Why it works</button><button type="button" class="farm-btn is-done" data-finish><small>Finish</small></button></footer>
    <div class="gh-toast" data-toast></div>
    <div class="farm-modal" data-modal hidden></div>
    <section class="gh-over" data-over>
      <p class="label">Red Harvest · Mars</p>
      <h1>Feed the crew</h1>
      <p class="gh-lede">Grow crops that astronauts have really grown in space, keep them watered, and fill the crew's meal orders to earn coins. Level up to unlock new crops, buy planters, upgrade the base. Nothing ever dies.</p>
      <ol class="farm-how"><li><b>Sow</b>Pick a seed, then tap planters</li><li><b>Water</b>Crops get thirsty halfway</li><li><b>Harvest</b>Tap ripe crops into the store</li><li><b>Deliver</b>Fill orders for coins and XP</li></ol>
      <p class="gh-q">How is your mood right now?</p>
      ${moodRow("data-mb")}
      <button type="button" class="link-btn" data-skip>Skip</button>
    </section>
  </div>`;
  const $ = (s) => el.querySelector(s);
  const root = $(".gh");
  const drawer = scienceDrawer(root, "greenhouse", "Why Red Harvest works");

  const base = createMarsBase(world);
  world.add("mars", base.def);
  world.show("mars", { fade: false });
  base.setSky(14.5, false);   // golden Martian afternoon; the real Mars time shows in the header tooltip
  // centre the base in the space the HUD leaves free
  const fitView = () => {
    const W = innerWidth, H = innerHeight, o = $(".farm-orders").getBoundingClientRect(), top = $(".farm-top").getBoundingClientRect().bottom, st = $(".farm-store").getBoundingClientRect();
    const side = o.left > W * 0.5;
    base.setInsets({ right: side ? W - o.left + 12 : 0, bottom: side ? H - st.top : H - o.top, top });
  };
  requestAnimationFrame(fitView);
  addEventListener("resize", fitView);

  // ---------- feedback ----------
  let toastT = 0;
  function toast(msg, tone = "") {
    const t = $("[data-toast]");
    t.textContent = msg; t.className = `gh-toast is-on ${tone}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = "gh-toast"; }, 3400);
  }
  /** Float an item from a screen point to a HUD element (harvest -> store, coins -> wallet). */
  function fly(x, y, target, html, n = 1) {
    const r = target?.getBoundingClientRect?.();
    if (!r) return;
    for (let k = 0; k < n; k++) {
      const d = document.createElement("span");
      d.className = "fx-item"; d.innerHTML = html;
      d.style.left = `${x}px`; d.style.top = `${y}px`;
      $("[data-fx]").appendChild(d);
      const dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
      if (reduced() || !d.animate) { setTimeout(() => d.remove(), 50); continue; }
      const spread = (k - (n - 1) / 2) * 26;
      d.animate([
        { transform: "translate(-50%,-50%) scale(.4)", opacity: 0 },
        { transform: `translate(calc(-50% + ${spread}px), calc(-50% - 60px)) scale(1.25)`, opacity: 1, offset: 0.3 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.55)`, opacity: 0.9 },
      ], { duration: 900 + k * 90, easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = () => { d.remove(); target.classList.remove("is-pop"); void target.offsetWidth; target.classList.add("is-pop"); };
    }
  }
  function floatText(x, y, text, cls = "") {
    const d = document.createElement("span");
    d.className = `fx-text ${cls}`; d.textContent = text; d.style.left = `${x}px`; d.style.top = `${y}px`;
    $("[data-fx]").appendChild(d); setTimeout(() => d.remove(), 1300);
  }
  function confetti() {
    if (reduced()) return;
    const box = $("[data-fx]");
    for (let k = 0; k < 70; k++) {
      const c = document.createElement("i"); c.className = "fx-conf";
      c.style.left = `${50 + (Math.random() - 0.5) * 30}%`; c.style.background = ["#ffd35a", "#ff7fe0", "#7ee06a", "#6fd0ff", "#ff7a45"][k % 5];
      box.appendChild(c);
      c.animate([{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(${(Math.random() - 0.5) * 900}px, ${300 + Math.random() * 500}px) rotate(${Math.random() * 900}deg)`, opacity: 0 }], { duration: 1600 + Math.random() * 900, easing: "cubic-bezier(.2,.6,.4,1)" }).onfinish = () => c.remove();
    }
  }
  let shownCoins = f.coins;
  function tickCoins() {
    const el_ = $("[data-coins]");
    if (shownCoins === f.coins) { el_.textContent = f.coins; return; }
    const from = shownCoins, to = f.coins, t0 = performance.now();
    shownCoins = to;
    const run = () => { const k = Math.min(1, (performance.now() - t0) / 700); el_.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(run); };
    run();
  }

  // ---------- HUD ----------
  const tags = [...el.querySelectorAll("[data-tag]")];
  const sizes = new Array(tags.length).fill(null);
  base.def.onFrame = () => {
    // project each marker, then push colliding ones up so markers never overlap
    const pos = tags.map((t, i) => { const s = base.podScreen(i, 3.9); if (!sizes[i] || t.dataset.sz !== t.dataset.st + t.textContent.length) { sizes[i] = { w: t.offsetWidth, h: t.offsetHeight }; t.dataset.sz = t.dataset.st + t.textContent.length; } return { i, x: s.x, y: s.y, w: sizes[i].w, h: sizes[i].h, on: !t.hidden }; });
    const order = pos.filter((p) => p.on).sort((a, b) => b.y - a.y);
    for (let k = 0; k < order.length; k++) for (let j = 0; j < k; j++) {
      const a = order[k], o = order[j];
      if (Math.abs(a.x - o.x) < (a.w + o.w) / 2 + 4 && a.y > o.y - o.h - 4 && a.y - a.h < o.y + 4) a.y = o.y - o.h - 6;
    }
    for (const p of pos) tags[p.i].style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    const ss = base.solarScreen();
    $("[data-solar]").style.transform = `translate(${ss.x.toFixed(1)}px, ${ss.y.toFixed(1)}px) translate(-50%, -100%)`;
  };

  function drawTags(now) {
    for (let i = 0; i < F.MAX_PODS; i++) {
      const st = F.podStatus(f, i), t = tags[i];
      if (t.dataset.st !== st) {
        t.dataset.st = st;
        t.querySelector("[data-ic]").innerHTML = { empty: SVG.plus, ready: SVG.basket, thirsty: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>', growing: "", dim: SVG.dim, buy: SVG.lock, locked: SVG.lock }[st] || "";
      }
      const p = f.pods[i];
      t.querySelector(".fg").style.strokeDashoffset = (1 - (p.crop ? p.growth : 0)).toFixed(3);
      const label = st === "growing" || st === "dim" ? `${F.secondsLeft(f, i, now)}s` : st === "buy" ? `${F.nextPlanterCost(f)}` : st === "empty" && seed ? F.CROPS[seed].name : "";
      t.querySelector("[data-t]").textContent = label;
      t.classList.toggle("has-t", !!label);
      t.classList.toggle("is-lamp", st === "growing" && now < f.sunlampUntil);
      t.hidden = st === "locked";
    }
    $("[data-solar]").hidden = f.dust < 0.4;
  }

  const html = (sel_, h) => { const n = $(sel_); if (n.dataset.h !== h) { n.innerHTML = h; n.dataset.h = h; } };   // redraw only on change: a redraw mid-tap loses the tap
  function drawOrders() {
    html("[data-orders]", f.orders.map((o, k) => {
      const ok = F.canFill(f, o);
      return `<article class="ord${ok ? " is-ready" : ""}" data-ord="${k}">
        <header><span class="ord-av">${esc(o.who[0])}</span><span class="ord-who"><b>${esc(o.who)}</b><small>wants ${esc(DISH[o.dish] || o.dish)}</small></span><button type="button" class="ord-skip" data-skip-ord="${k}" aria-label="Swap this order">↻</button></header>
        <div class="ord-items">${Object.entries(o.items).map(([c, q]) => { const have = f.store[c] || 0; return `<span class="ord-it${have >= q ? " is-have" : ""}">${cropIcon(c)}<b>${Math.min(have, q)}/${q}</b></span>`; }).join("")}</div>
        <button type="button" class="ord-go" data-fill="${k}" ${ok ? "" : "disabled"}>${ok ? "Deliver" : "Need crops"}<span>${SVG.coin}${o.coins} · ${o.xp} XP</span></button>
      </article>`;
    }).join(""));
  }

  function drawStore() {
    const items = F.CROP_IDS.filter((c) => (f.store[c] || 0) > 0);
    html("[data-store]", items.length ? items.map((c) => `<span class="st-it" data-st-it="${c}">${cropIcon(c)}<b>${f.store[c]}</b></span>`).join("") : `<span class="st-empty">Harvested crops land here</span>`);
  }

  function drawSeedbar() {
    const bar = $("[data-seedbar]");
    bar.hidden = !seed;
    if (!seed) return;
    bar.innerHTML = `${cropIcon(seed)}<span><b>Sowing ${esc(F.CROPS[seed].name)}</b><small>Tap empty planters</small></span><button type="button" data-seedoff aria-label="Stop sowing">×</button>`;
    bar.querySelector("[data-seedoff]").addEventListener("click", () => { seed = null; drawAll(); });
  }

  function drawTop(now) {
    $("[data-lv]").textContent = f.level;
    $("[data-lv]").parentElement.style.setProperty("--xp", `${Math.min(100, (f.xp / F.xpForLevel(f.level)) * 100)}%`);
    $("[data-xp]").style.width = `${Math.min(100, (f.xp / F.xpForLevel(f.level)) * 100)}%`;
    $("[data-xpt]").textContent = `${f.xp} / ${F.xpForLevel(f.level)} XP`;
    tickCoins();
    $("[data-water]").textContent = `${Math.floor(f.reserve)}/${F.tankSize(f)}`;
    const active = f.pods.filter((p, i) => i < f.owned && p.crop && p.growth < 1).length;
    $("[data-power]").textContent = `${Math.min(active, F.poweredSlots(f))}/${F.poweredSlots(f)}`;
    $("[data-power-chip]").classList.toggle("is-low", active > F.poweredSlots(f));
    $("[data-lamps]").textContent = now < f.sunlampUntil ? `${Math.ceil(f.sunlampUntil - now)}s` : f.sunlamps;
    $("[data-lamp]").disabled = f.sunlamps < 1 || now < f.sunlampUntil;
    $("[data-lamp]").classList.toggle("is-on", now < f.sunlampUntil);
    const mt = F.marsTime(Date.now());
    $("[data-lv]").parentElement.title = `Sol ${mt.sol.toLocaleString()} · ${mt.label} Mars Coordinated Time`;
    $("[data-dust]").hidden = !f.storm;
  }

  function drawAll() { const now = nowS(); base.setFarm(f, now); drawTop(now); drawTags(now); drawOrders(); drawStore(); drawSeedbar(); }

  // ---------- actions ----------
  function tapPod(i, sx, sy) {
    const st = F.podStatus(f, i);
    const at = sx != null ? { x: sx, y: sy } : base.podScreen(i, 2);
    if (st === "buy") return openShop();
    if (st === "locked") return toast("Buy the planters in order from the shop.");
    if (st === "empty") {
      if (!seed) return openSeeds(i);
      if (f.reserve < F.WATER_COST) return toast("Out of water: the tank refills one litre every 8 seconds.", "is-warn");
      if (F.CROPS[seed].lvl > f.level) return;
      F.plant(f, i, seed); cue.tick(); navigator.vibrate?.(8);
      floatText(at.x, at.y, `−1 water`, "is-water");
    } else if (st === "thirsty") {
      if (!F.water(f, i)) return toast("Out of water: the tank refills one litre every 8 seconds.", "is-warn");
      cue.point(); navigator.vibrate?.(10);
      floatText(at.x, at.y, "Watered!", "is-water");
    } else if (st === "ready") {
      const h = F.harvest(f, i);
      cue.done(); navigator.vibrate?.([10, 30, 10]);
      base.burst(i);
      session.harvests++;
      fly(at.x, at.y, $(`[data-st-it="${h.crop}"]`) || $("[data-store]"), cropIcon(h.crop), h.n);
      floatText(at.x, at.y - 30, `+${h.n} ${F.CROPS[h.crop].name}`, "is-good");
      if (h.first) { setTimeout(() => toast(`New crop! ${h.fact}`, "is-fact"), 600); }
      if (h.levelUp) levelUp([]);
      ctx.patch?.({ engagement: { greenhouse_stage: greenhouseCalm(eng().greenhouse_stage || 0) } }).catch(() => {});
    } else if (st === "growing" || st === "dim") {
      floatText(at.x, at.y, st === "dim" ? "No power: clean the panels or upgrade solar" : `${F.secondsLeft(f, i, nowS())}s to go`, st === "dim" ? "is-warn" : "");
    }
    save(id, f); drawAll();
  }

  function fill(k, btn) {
    const r = btn.getBoundingClientRect();
    const res = F.fillOrder(f, k);
    if (!res) return;
    session.orders++; session.coins += res.coins;
    cue.done(); navigator.vibrate?.([15, 40, 15]);
    fly(r.left + r.width / 2, r.top + r.height / 2, $("[data-coins-chip]"), SVG.coin, Math.min(8, 3 + Math.floor(res.coins / 15)));
    floatText(r.left + r.width / 2, r.top, `+${res.coins} coins · +${res.xp} XP`, "is-gold");
    setTimeout(() => { tickCoins(); }, 700);
    if (res.levelUp) setTimeout(() => levelUp(res.unlocked), 900);
    save(id, f); drawAll();
  }

  function levelUp(unlocked) {
    cue.wake(); navigator.vibrate?.([20, 60, 20, 60, 40]);
    confetti();
    const m = $("[data-modal]");
    const crops = (unlocked && unlocked.length ? unlocked : F.CROP_IDS.filter((c) => F.CROPS[c].lvl === f.level));
    m.innerHTML = `<div class="fm-card fm-level"><span class="farm-star is-big"><b>${f.level}</b></span><h2>Level ${f.level}!</h2>
      ${crops.length ? `<p>New crop unlocked</p><div class="fm-unlocks">${crops.map((c) => `<span>${cropIcon(c)}<b>${esc(F.CROPS[c].name)}</b><small>${esc(F.CROPS[c].fact)}</small></span>`).join("")}</div>` : `<p>Bigger orders are on the way.</p>`}
      <button type="button" class="farm-cta" data-close-m>Keep farming</button></div>`;
    m.hidden = false;
    window.gsap?.fromTo(m.querySelector(".fm-card"), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.8)" });
    m.querySelector("[data-close-m]").addEventListener("click", () => { m.hidden = true; });
    if (crops[0]) ctx.say?.(`Level ${f.level}. You can now grow ${F.CROPS[crops[0]].name}.`);
  }

  function openSeeds(i) {
    const m = $("[data-modal]");
    m.innerHTML = `<div class="fm-card fm-seeds"><h2>Choose a seed</h2><p>It costs 1 litre of water to sow. Then tap any empty planter to sow the same seed.</p>
      <div class="fm-seed-grid">${F.CROP_IDS.map((k) => { const c = F.CROPS[k], lock = c.lvl > f.level; return `<button type="button" class="fm-seed${lock ? " is-locked" : ""}" data-seed="${k}" ${lock ? "disabled" : ""}>${cropIcon(k)}<b>${esc(c.name)}</b><small>${lock ? `Level ${c.lvl}` : `${c.grow}s · ${SVG.coin}${c.coins}`}</small></button>`; }).join("")}</div>
      <button type="button" class="farm-link" data-close-m>Cancel</button></div>`;
    m.hidden = false;
    window.gsap?.fromTo(m.querySelector(".fm-card"), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "back.out(1.5)" });
    m.querySelectorAll("[data-seed]").forEach((b) => b.addEventListener("click", () => { seed = b.dataset.seed; m.hidden = true; tapPod(i); }));
    m.querySelector("[data-close-m]").addEventListener("click", () => { m.hidden = true; });
  }

  function openShop() {
    const m = $("[data-modal]");
    const draw = () => {
      const pc = F.nextPlanterCost(f);
      const row = (key, title, blurb, lvl, cost, max) => `<div class="fm-shop-row"><div><b>${esc(title)}</b><small>${esc(blurb)}</small>${max != null ? `<span class="pips">${Array.from({ length: max }, (_, k) => `<i class="${k < lvl ? "on" : ""}"></i>`).join("")}</span>` : ""}</div>
        <button type="button" class="farm-cta${cost != null && f.coins >= cost ? "" : " is-off"}" data-buy="${key}" ${cost == null || f.coins < cost ? "disabled" : ""}>${cost == null ? "Max" : `${SVG.coin}${cost}`}</button></div>`;
      m.innerHTML = `<div class="fm-card fm-shop"><h2>Base shop</h2><p class="fm-wallet">${SVG.coin}<b>${f.coins}</b> coins</p>
        ${row("planter", "New planter", `${f.owned} of ${F.MAX_PODS} built`, f.owned, pc, null)}
        ${row("led", F.UPGRADES.led.name, `Crops grow ${Math.round((F.UPGRADES.led.effect(f.up.led + 1) - 1) * 100)}% faster`, f.up.led, F.upgradeCost(f, "led"), 3)}
        ${row("tank", F.UPGRADES.tank.name, `Holds ${F.UPGRADES.tank.effect(Math.min(3, f.up.tank + 1))} litres`, f.up.tank, F.upgradeCost(f, "tank"), 3)}
        ${row("solar", F.UPGRADES.solar.name, `Powers ${F.UPGRADES.solar.effect(Math.min(3, f.up.solar + 1))} planters`, f.up.solar, F.upgradeCost(f, "solar"), 3)}
        <button type="button" class="farm-link" data-close-m>Close</button></div>`;
      m.querySelectorAll("[data-buy]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.buy;
        const ok = k === "planter" ? F.buyPlanter(f) : F.buyUpgrade(f, k);
        if (!ok) return;
        cue.done(); navigator.vibrate?.(20); confetti();
        toast(k === "planter" ? "New planter built!" : `${F.UPGRADES[k].name} upgraded!`, "is-good");
        save(id, f); drawAll(); draw();
      }));
      m.querySelector("[data-close-m]").addEventListener("click", () => { m.hidden = true; });
    };
    draw();
    m.hidden = false;
    window.gsap?.fromTo(m.querySelector(".fm-card"), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "back.out(1.5)" });
  }

  // ---------- input ----------
  el.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tag]");
    if (t) return tapPod(Number(t.dataset.tag), e.clientX, e.clientY);
    const fb = e.target.closest("[data-fill]");
    if (fb) return fill(Number(fb.dataset.fill), fb);
    const sk = e.target.closest("[data-skip-ord]");
    if (sk) { F.skipOrder(f, Number(sk.dataset.skipOrd)); cue.tick(); save(id, f); return drawAll(); }
    if (e.target.closest("[data-solar]")) return clean(e.clientX, e.clientY);
  });
  function clean(x, y) {
    if (!F.cleanPanels(f)) return;
    cue.done(); navigator.vibrate?.(15);
    floatText(x, y, "Panels clean: full power", "is-good");
    save(id, f); drawAll();
  }
  const pts = new Map();
  let down = null, pinch0 = 0;
  const onDown = (e) => {
    if (e.target.closest("button, .farm-top, .farm-orders, .farm-store, .farm-modal, .gh-over, .sci-drawer, .farm-seed")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.setPointerCapture?.(e.pointerId);
    if (pts.size === 1) down = { moved: 0 };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onMove = (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) base.zoom(pinch0 / d); pinch0 = d; if (down) down.moved = 99; }
    else if (down) { const dx = e.clientX - prev.x, dy = e.clientY - prev.y; down.moved += Math.abs(dx) + Math.abs(dy); if (down.moved > 8) base.orbit(dx, dy); }
  };
  const onUp = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0 && down && down.moved <= 8) {
      const hit = base.pick(e.clientX, e.clientY);
      if (hit?.pod != null) tapPod(hit.pod, e.clientX, e.clientY);
      else if (hit?.solar) { if (f.dust >= 0.05) clean(e.clientX, e.clientY); else floatText(e.clientX, e.clientY, "Panels are clean"); }
    }
    if (pts.size === 0) down = null;
    pinch0 = 0;
  };
  const onWheel = (e) => { if (e.target.closest(".farm-modal, .sci-drawer, .gh-over, .farm-orders")) return; e.preventDefault(); base.zoom(e.deltaY > 0 ? 1.08 : 0.93); };
  root.addEventListener("pointerdown", onDown); root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp); root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  $("[data-shop]").addEventListener("click", () => openShop());
  $("[data-why]").addEventListener("click", () => drawer.open());
  $("[data-lamp]").addEventListener("click", () => { if (F.useSunlamp(f, nowS())) { cue.wake(); toast(`Sunlamp on: crops grow twice as fast for ${F.SUNLAMP_S} seconds.`, "is-od"); save(id, f); drawAll(); } });

  // ---------- start and finish ----------
  const begin = (m) => {
    moodBefore = m;
    const ov = $("[data-over]");
    ov.classList.add("is-out"); setTimeout(() => { ov.hidden = true; }, 450);
    startedAt = performance.now();
    const ready = away.filter((e) => e.type === "ready").length;
    if (lampsEarned) toast(`Your Stillpoint session${lampsEarned > 1 ? "s" : ""} earned ${lampsEarned} Sunlamp${lampsEarned > 1 ? "s" : ""}.`, "is-od");
    else if (ready) toast(`While you were away ${ready} crop${ready > 1 ? "s" : ""} ripened.`, "is-good");
    else if (f.harvests === 0) toast("Start with radishes: they're ready in 20 seconds.");
  };
  el.querySelectorAll("[data-mb]").forEach((b) => b.addEventListener("click", () => begin(Number(b.dataset.mb))));
  $("[data-skip]").addEventListener("click", () => begin(null));

  $("[data-finish]").addEventListener("click", () => {
    const ov = $("[data-over]");
    ov.hidden = false; ov.classList.remove("is-out");
    const minutes = (performance.now() - startedAt) / 60000;
    ov.innerHTML = `<p class="label">Shift complete</p><h1>${session.orders ? `${session.orders} order${session.orders > 1 ? "s" : ""} delivered` : session.harvests ? `${session.harvests} harvest${session.harvests > 1 ? "s" : ""}` : "See you next sol"}</h1>
      <p class="gh-lede">+${session.coins} coins this shift · level ${f.level} · ${f.ordersDone} orders in total. Your crops keep growing while you're away.</p>
      <p class="gh-q">How is your mood now?</p>${moodRow("data-ma")}
      <p class="note" data-res></p>
      <div class="gh-end-actions"><button type="button" class="pill pill-ghost" data-back>Keep farming</button><button type="button" class="pill pill-light" data-close>Done</button></div>`;
    ov.querySelector("[data-back]").addEventListener("click", () => { ov.classList.add("is-out"); setTimeout(() => { ov.hidden = true; }, 450); });
    ov.querySelector("[data-close]").addEventListener("click", () => ctx.screens?.close?.());
    ov.querySelectorAll("[data-ma]").forEach((b) => b.addEventListener("click", async () => {
      const after = Number(b.dataset.ma);
      ov.querySelectorAll("[data-ma]").forEach((x) => { x.disabled = true; x.setAttribute("aria-pressed", String(x === b)); });
      const change = moodBefore != null ? after - moodBefore : null;
      ov.querySelector("[data-res]").textContent = change != null ? `Mood ${moodBefore} before, ${after} after (${change >= 0 ? "+" : ""}${change}). Saved to your wellbeing log.` : `Mood ${after}. Saved to your wellbeing log.`;
      try {
        await api.log(id, "session.greenhouse_minutes", Math.round(minutes * 10) / 10, "user");
        await api.log(id, "session.greenhouse_harvest_kg", session.harvests, "user");
        await api.log(id, "session.greenhouse_mood_after", after, "user");
        if (moodBefore != null) { await api.log(id, "session.greenhouse_mood_before", moodBefore, "user"); await api.log(id, "session.greenhouse_mood_change", change, "user"); }
        await ctx.patch?.({ wellbeing: { mood_before: moodBefore, mood_after: after, last_game: "mars_farm", updated: new Date().toISOString() } });
      } catch { ov.querySelector("[data-res]").textContent += " (could not reach the brain; not saved)"; }
    }));
  });

  // ---------- the game clock ----------
  let last = nowS();
  const iv = setInterval(() => {
    if (!alive) return;
    const now = nowS();
    const evs = F.step(f, now - last, now);
    last = now;
    for (const e of evs) {
      if (e.type === "ready") cue.nudge();
      if (e.type === "thirsty") cue.tick();
      if (e.type === "dusty") toast("Dust is settling on the solar panels: tap them to clean.", "is-warn");
      if (e.type === "storm_end") toast("The dust storm has passed. Clean the panels for full power.", "is-good");
    }
    const growing = f.pods.filter((p, i) => i < f.owned && p.crop && p.growth < 1).length;
    if (!f.storm && growing >= 3 && f.level >= 2 && Math.random() < 1 / 150) {
      F.startStorm(f, now, 35 + Math.random() * 25);
      toast("Dust storm! Solar power is halved until it passes.", "is-warn");
      ctx.say?.("Dust storm incoming. Solar power is halved until it passes.");
    }
    drawAll();
    if (Math.round(now) % 4 === 0) save(id, f);
  }, 500);
  drawAll();

  return () => {
    alive = false; clearInterval(iv); clearTimeout(toastT); save(id, f);
    root.removeEventListener("wheel", onWheel);
    removeEventListener("resize", fitView);
    const back = prevScene && prevScene !== "mars" ? prevScene : "space";
    if (world.active === "mars") world.show(back, { fade: false }).then(() => world.remove("mars"));
    else world.remove("mars");
  };
}
