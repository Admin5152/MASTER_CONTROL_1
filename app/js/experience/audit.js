// Audit log (INT-3, NFR-6): every event, reading, flag, recommendation and action, newest first.
import { api } from "../core/api.js";
import { esc } from "../interface/readings.js";

export function registerAudit(registerScreen) {
  registerScreen("audit", { title: "Audit log", render: renderAudit });
}

function renderAudit(el) {
  el.innerHTML = `<p class="note">Everything Sentinel saw and did, kept on this device. Health background, raw audio and the words in an urgent wellbeing flow are never written here.</p>
    <input type="search" class="audit-q" data-q placeholder="Filter: digest, suit, safety, reading…" aria-label="Filter the audit log">
    <ol class="audit-list" data-list><li class="note">Loading…</li></ol>`;
  const list = el.querySelector("[data-list]"), q = el.querySelector("[data-q]");
  const draw = async () => {
    let d; try { d = await api.auditList(q.value); } catch { list.innerHTML = `<li class="note">The brain is offline.</li>`; return; }
    list.innerHTML = d.entries.map((e) => `<li><time>${esc(new Date(e.t * 1000).toLocaleTimeString())}</time><span class="au-src is-${esc(e.src)}">${esc(e.src)}</span><b>${esc(e.event)}</b><small>${esc(e.detail == null ? "" : typeof e.detail === "object" ? Object.entries(e.detail).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : String(e.detail))}</small></li>`).join("") || `<li class="note">Nothing yet.</li>`;
  };
  let t = 0; q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(draw, 250); });
  draw();
  const iv = setInterval(draw, 5000);
  return () => clearInterval(iv);
}
