/**
 * Crew-to-Crew Messaging Controller & Interface (Phase 2 & 3).
 *
 * Implements:
 * - Slide-in panel from the right with conversation list and thread views.
 * - Real-time polling (3s background, 1.5s active thread) with bus events.
 * - Grouped message bubbles, date separators, voice indicators, read receipts.
 * - Auto-growing composer, draft saving per conversation, 500-char limit counter.
 * - Unread count badge and quiet toast notifications on incoming messages.
 * - Keyboard navigation (Escape closes, Enter sends).
 */

import { emit, on } from "../core/bus.js";

let appCtx = null;
let currentPartnerCid = null;
let currentViewMode = "list"; // "list" | "thread"
let pollTimer = null;
let lastUnreadTotal = 0;
let lastKnownMessageIds = new Set();
let draftsByCid = new Map();
let failedMessages = []; // [{ id, to_cid, text, via, t }]
let isUserScrolledUp = false;

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMsgTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Initialize crew messaging module and bind event listeners.
 */
export function initMessages(ctx) {
  appCtx = ctx;

  const btnMessages = document.getElementById("btn-messages");
  if (btnMessages) {
    btnMessages.addEventListener("click", () => toggleMessages());
  }

  // Close with Escape key
  document.addEventListener("keydown", (e) => {
    const panel = document.getElementById("messages-panel");
    if (!panel || panel.hidden) return;
    if (e.key === "Escape") {
      if (currentViewMode === "thread") {
        showConversationList();
      } else {
        closeMessages();
      }
    }
  });

  // Close when tapping outside the panel
  document.addEventListener("pointerdown", (e) => {
    const panel = document.getElementById("messages-panel");
    const btn = document.getElementById("btn-messages");
    if (!panel || panel.hidden) return;
    if (e.target.closest("#messages-panel, #btn-messages")) return;
    closeMessages();
  });

  // Listen for crew switch to update inboxes
  on("crew:changed", () => {
    lastKnownMessageIds.clear();
    updateUnreadBadge();
    if (isPanelOpen()) {
      if (currentViewMode === "thread" && currentPartnerCid) {
        openThread(currentPartnerCid);
      } else {
        showConversationList();
      }
    }
  });

  // Start background polling
  startPolling();
}

/**
 * Check if the messages panel is currently visible.
 */
export function isPanelOpen() {
  const panel = document.getElementById("messages-panel");
  return panel && !panel.hidden;
}

/**
 * Toggle open/close state of the messages panel.
 */
export function toggleMessages() {
  if (isPanelOpen()) {
    closeMessages();
  } else {
    openMessages();
  }
}

/**
 * Open the messages panel (defaults to conversation list, or thread if partnerCid provided).
 */
export async function openMessages(partnerCid = null) {
  const panel = document.getElementById("messages-panel");
  const backdrop = document.getElementById("messages-backdrop");
  const btn = document.getElementById("btn-messages");

  if (!panel) return;

  // Close AI menu and convo if open
  const menu = document.getElementById("menu");
  const convo = document.getElementById("convo");
  const btnMenu = document.getElementById("btn-menu");
  const btnConvo = document.getElementById("btn-convo");
  if (menu) menu.hidden = true;
  if (convo) convo.hidden = true;
  if (btnMenu) btnMenu.setAttribute("aria-expanded", "false");
  if (btnConvo) btnConvo.setAttribute("aria-expanded", "false");

  panel.hidden = false;
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.onclick = () => closeMessages();
  }
  if (btn) btn.setAttribute("aria-expanded", "true");

  // Animate slide-in
  requestAnimationFrame(() => {
    panel.classList.add("is-open");
    if (backdrop) backdrop.classList.add("is-open");
  });

  if (partnerCid) {
    await openThread(partnerCid);
  } else {
    await showConversationList();
  }
}

/**
 * Close the messages panel.
 */
export function closeMessages() {
  const panel = document.getElementById("messages-panel");
  const backdrop = document.getElementById("messages-backdrop");
  const btn = document.getElementById("btn-messages");

  if (!panel) return;

  panel.classList.remove("is-open");
  if (backdrop) backdrop.classList.remove("is-open");
  if (btn) btn.setAttribute("aria-expanded", "false");

  setTimeout(() => {
    panel.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }, 200);
}

/**
 * Render the main conversation list view.
 */
export async function showConversationList() {
  currentViewMode = "list";
  currentPartnerCid = null;

  const panel = document.getElementById("messages-panel");
  if (!panel) return;

  const myCid = getMyCid();
  let convos = [];
  try {
    const res = await fetch(`../api/messages/${myCid}/conversations`);
    if (res.ok) {
      const data = await res.json();
      convos = data.conversations || [];
    }
  } catch (err) {
    console.warn("[messages] Failed to load conversations:", err);
  }

  const allCrew = getCrewList().filter((c) => c.crew_id !== myCid);
  const convosByPartner = new Map(convos.map((c) => [c.other_cid, c]));

  const activeThreads = [];
  const availableCrew = [];

  for (const c of allCrew) {
    if (convosByPartner.has(c.crew_id)) {
      activeThreads.push(convosByPartner.get(c.crew_id));
    } else {
      availableCrew.push(c);
    }
  }

  panel.innerHTML = `
    <div class="msg-header">
      <div class="msg-header-title">
        <h2>Messages</h2>
        <span class="msg-crew-as">as <strong>${esc(getMyDisplayName())}</strong></span>
      </div>
      <button class="msg-btn-icon msg-btn-close" type="button" aria-label="Close messages">
        <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="msg-body msg-list-body">
      ${activeThreads.length ? `
        <div class="msg-threads-group">
          ${activeThreads.map((t) => renderConversationRow(t)).join("")}
        </div>
      ` : ""}

      ${availableCrew.length ? `
        <div class="msg-section-heading">${activeThreads.length ? "Start a conversation" : "Crew Members"}</div>
        <div class="msg-crew-grid">
          ${availableCrew.map((c) => `
            <button class="msg-crew-card" type="button" data-open-cid="${esc(c.crew_id)}">
              <div class="msg-avatar">${esc((c.display_name || c.crew_id).charAt(0).toUpperCase())}</div>
              <div class="msg-crew-info">
                <strong>${esc(c.display_name || c.crew_id)}</strong>
                ${c.callsign ? `<small class="msg-callsign">${esc(c.callsign)}</small>` : ""}
              </div>
            </button>
          `).join("")}
        </div>
      ` : ""}

      ${!activeThreads.length && !availableCrew.length ? `
        <div class="msg-empty-hint">No other crew members detected on board.</div>
      ` : ""}
    </div>
  `;

  // Attach click handlers
  panel.querySelector(".msg-btn-close")?.addEventListener("click", () => closeMessages());
  panel.querySelectorAll("[data-open-cid]").forEach((el) => {
    el.addEventListener("click", () => openThread(el.dataset.openCid));
  });
}

function renderConversationRow(t) {
  const initial = (t.other_name || t.other_cid).charAt(0).toUpperCase();
  const timeStr = formatMsgTime(t.last_time);
  const unread = t.unread_count || 0;

  return `
    <button class="msg-thread-row ${unread > 0 ? "has-unread" : ""}" type="button" data-open-cid="${esc(t.other_cid)}">
      <div class="msg-avatar">${esc(initial)}</div>
      <div class="msg-thread-main">
        <div class="msg-thread-top">
          <strong class="msg-thread-name">${esc(t.other_name || t.other_cid)}</strong>
          ${t.other_callsign ? `<span class="msg-callsign">${esc(t.other_callsign)}</span>` : ""}
          <span class="msg-thread-time">${esc(timeStr)}</span>
        </div>
        <div class="msg-thread-bottom">
          <span class="msg-thread-preview">${esc(t.last_message || "No messages")}</span>
          ${unread > 0 ? `<span class="msg-unread-pill">${unread}</span>` : ""}
        </div>
      </div>
    </button>
  `;
}

/**
 * Open a specific conversation thread with a partner crew member.
 */
export async function openThread(partnerCid) {
  currentViewMode = "thread";
  currentPartnerCid = partnerCid;

  const panel = document.getElementById("messages-panel");
  if (!panel) return;

  const myCid = getMyCid();
  const partner = getCrewList().find((c) => c.crew_id === partnerCid) || { crew_id: partnerCid, display_name: partnerCid };

  // 1. Mark thread as read immediately on open
  markConversationRead(partnerCid);

  // 2. Fetch conversation messages
  let messages = [];
  try {
    const res = await fetch(`../api/messages/${myCid}/conversation/${partnerCid}?limit=50`);
    if (res.ok) {
      const data = await res.json();
      messages = data.messages || [];
    }
  } catch (err) {
    console.warn("[messages] Failed to load thread messages:", err);
  }

  // Include any local failed unsent messages
  const unsent = failedMessages.filter((m) => m.to_cid === partnerCid);
  const allMessages = [...messages, ...unsent];

  const draftText = draftsByCid.get(partnerCid) || "";

  panel.innerHTML = `
    <div class="msg-header msg-thread-header">
      <button class="msg-btn-icon msg-btn-back" type="button" aria-label="Back to conversations">
        <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <div class="msg-header-title msg-partner-info">
        <div class="msg-avatar msg-avatar-sm">${esc((partner.display_name || partner.crew_id).charAt(0).toUpperCase())}</div>
        <div>
          <h2>${esc(partner.display_name || partner.crew_id)}</h2>
          ${partner.callsign ? `<span class="msg-callsign">${esc(partner.callsign)}</span>` : ""}
        </div>
      </div>
      <button class="msg-btn-icon msg-btn-close" type="button" aria-label="Close messages">
        <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="msg-body msg-thread-body" id="msg-messages-container">
      ${renderThreadContent(allMessages, partner)}
    </div>

    <div id="msg-scroll-pill" class="msg-scroll-pill" hidden>New message ↓</div>

    <form class="msg-composer" id="msg-composer-form">
      <div class="msg-composer-box">
        <textarea
          id="msg-input"
          class="msg-textarea"
          rows="1"
          maxlength="500"
          placeholder="Message ${esc(partner.display_name || partner.crew_id)}…"
          aria-label="Message text"
        >${esc(draftText)}</textarea>
        <button id="msg-btn-mic" class="msg-btn-mic" type="button" aria-label="Dictate message">
          <svg viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></svg>
        </button>
      </div>
      <div class="msg-composer-footer">
        <span id="msg-char-counter" class="msg-char-counter" hidden>0/500</span>
        <button id="msg-btn-send" class="msg-btn-send" type="submit" aria-label="Send message" disabled>
          <svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </form>
  `;

  // Attach controls
  panel.querySelector(".msg-btn-back")?.addEventListener("click", () => showConversationList());
  panel.querySelector(".msg-btn-close")?.addEventListener("click", () => closeMessages());

  const container = panel.querySelector("#msg-messages-container");
  if (container) {
    container.scrollTop = container.scrollHeight;
    container.addEventListener("scroll", () => {
      const scrollGap = container.scrollHeight - container.scrollTop - container.clientHeight;
      isUserScrolledUp = scrollGap > 60;
      const scrollPill = document.getElementById("msg-scroll-pill");
      if (scrollPill && !isUserScrolledUp) {
        scrollPill.hidden = true;
      }
    });
  }

  const scrollPill = panel.querySelector("#msg-scroll-pill");
  if (scrollPill) {
    scrollPill.addEventListener("click", () => {
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        scrollPill.hidden = true;
      }
    });
  }

  // Composer event wiring
  wireComposer(partnerCid);
}

function renderThreadContent(messages, partner) {
  if (!messages || !messages.length) {
    return `
      <div class="msg-empty-thread">
        <p>No messages yet. Say hello to ${esc(partner.display_name || partner.crew_id)}.</p>
      </div>
    `;
  }

  const myCid = getMyCid();
  let html = "";
  let lastDateStr = "";
  let lastSender = "";

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isMe = m.from_cid === myCid;
    const isFailed = Boolean(m.failed);

    // Date separator check
    const dateStr = formatDateSeparator(m.t);
    if (dateStr && dateStr !== lastDateStr) {
      html += `<div class="msg-date-separator"><span>${esc(dateStr)}</span></div>`;
      lastDateStr = dateStr;
      lastSender = "";
    }

    const isGrouped = lastSender === m.from_cid;
    lastSender = m.from_cid;

    // Delivery status on last sent message
    const isMyLast = isMe && i === messages.length - 1;
    let statusText = "";
    if (isMyLast && !isFailed) {
      if (m.read_at) {
        statusText = `Read · ${formatMsgTime(m.read_at)}`;
      } else if (m.delivered) {
        statusText = "Delivered";
      } else {
        statusText = "Sent";
      }
    }

    html += `
      <div class="msg-bubble-row ${isMe ? "is-me" : "is-them"} ${isGrouped ? "is-grouped" : ""} ${isFailed ? "is-failed" : ""}">
        <div class="msg-bubble">
          <div class="msg-bubble-text">${esc(m.text)}</div>
          <div class="msg-bubble-meta">
            ${m.via === "voice" ? `<span class="msg-voice-icon" title="Sent by voice"><svg viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></svg></span>` : ""}
            <span class="msg-bubble-time">${esc(formatMsgTime(m.t))}</span>
          </div>
        </div>
        ${isFailed ? `<button class="msg-retry-btn" type="button" data-retry-id="${esc(m.id)}">Not sent. Tap to retry.</button>` : ""}
        ${statusText ? `<div class="msg-status-line">${esc(statusText)}</div>` : ""}
      </div>
    `;
  }

  return html;
}

function wireComposer(partnerCid) {
  const form = document.getElementById("msg-composer-form");
  const textarea = document.getElementById("msg-input");
  const btnSend = document.getElementById("msg-btn-send");
  const counter = document.getElementById("msg-char-counter");
  const btnMic = document.getElementById("msg-btn-mic");

  if (!textarea || !btnSend) return;

  const updateInputState = () => {
    const val = textarea.value || "";
    draftsByCid.set(partnerCid, val);

    // Auto-grow height up to ~110px (approx 4 lines)
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 110)}px`;

    btnSend.disabled = !val.trim();

    // Show counter only when length > 400
    if (counter) {
      if (val.length > 400) {
        counter.hidden = false;
        counter.textContent = `${val.length}/500`;
        counter.classList.toggle("is-near-limit", val.length >= 490);
      } else {
        counter.hidden = true;
      }
    }
  };

  textarea.addEventListener("input", updateInputState);
  updateInputState();

  // Enter sends, Shift+Enter new line
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!btnSend.disabled) {
        form?.dispatchEvent(new Event("submit"));
      }
    }
  });

  // Form submit
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = (textarea.value || "").trim();
    if (!text) return;

    textarea.value = "";
    draftsByCid.delete(partnerCid);
    updateInputState();

    await sendMessageToPartner(partnerCid, text, "typed");
  });

  // Voice dictation button
  btnMic?.addEventListener("click", () => {
    dictateIntoComposer(textarea, updateInputState);
  });
}

async function dictateIntoComposer(textarea, onUpdate) {
  if (typeof window.__pushToTalk === "function") {
    // Arm push-to-talk listening
    window.__pushToTalk();
  }
  const prevPlaceholder = textarea.placeholder;
  textarea.placeholder = "Listening… speak now";

  // Capture transcript from speech engine
  const unbind = on("voice:transcript", ({ text, final }) => {
    if (text) {
      textarea.value = (textarea.value ? textarea.value + " " : "") + text;
      onUpdate();
    }
    if (final) {
      textarea.placeholder = prevPlaceholder;
      unbind();
    }
  });

  setTimeout(() => {
    textarea.placeholder = prevPlaceholder;
    unbind();
  }, 10000);
}

/**
 * Send a message to a partner crew member.
 */
export async function sendMessageToPartner(partnerCid, text, via = "typed") {
  const myCid = getMyCid();
  const tempId = `temp_${Date.now()}`;

  // Optimistic UI update if thread is open
  if (currentViewMode === "thread" && currentPartnerCid === partnerCid) {
    const container = document.getElementById("msg-messages-container");
    if (container) {
      const tempRow = document.createElement("div");
      tempRow.id = tempId;
      tempRow.className = "msg-bubble-row is-me";
      tempRow.innerHTML = `
        <div class="msg-bubble">
          <div class="msg-bubble-text">${esc(text)}</div>
          <div class="msg-bubble-meta">
            ${via === "voice" ? `<span class="msg-voice-icon"><svg viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></svg></span>` : ""}
            <span class="msg-bubble-time">${esc(formatMsgTime(Date.now() / 1000))}</span>
          </div>
        </div>
        <div class="msg-status-line">Sending…</div>
      `;
      container.appendChild(tempRow);
      container.scrollTop = container.scrollHeight;
    }
  }

  try {
    const res = await fetch(`../api/messages/${myCid}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to_cid: partnerCid,
        text,
        via,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      emit("message:sent", data.message);

      // Remove from failed list if this was a retry
      failedMessages = failedMessages.filter((m) => m.text !== text || m.to_cid !== partnerCid);

      // Refresh thread
      if (currentViewMode === "thread" && currentPartnerCid === partnerCid) {
        await refreshCurrentThread();
      }
      return data.message;
    }

    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("[messages] Send failed:", err);
    // Add to failed messages queue so typed text is NEVER lost
    const failedRecord = {
      id: tempId,
      from_cid: myCid,
      to_cid: partnerCid,
      text,
      via,
      t: Date.now() / 1000,
      failed: true,
    };
    failedMessages.push(failedRecord);

    if (currentViewMode === "thread" && currentPartnerCid === partnerCid) {
      await refreshCurrentThread();
    }
  }
}

async function refreshCurrentThread() {
  if (currentViewMode !== "thread" || !currentPartnerCid) return;
  const myCid = getMyCid();
  const partner = getCrewList().find((c) => c.crew_id === currentPartnerCid) || { crew_id: currentPartnerCid, display_name: currentPartnerCid };

  try {
    const res = await fetch(`../api/messages/${myCid}/conversation/${currentPartnerCid}?limit=50`);
    if (res.ok) {
      const data = await res.json();
      const messages = data.messages || [];
      const unsent = failedMessages.filter((m) => m.to_cid === currentPartnerCid);
      const allMessages = [...messages, ...unsent];

      const container = document.getElementById("msg-messages-container");
      if (container) {
        const wasScrolledUp = isUserScrolledUp;
        container.innerHTML = renderThreadContent(allMessages, partner);

        // Bind retry buttons
        container.querySelectorAll("[data-retry-id]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const failedItem = failedMessages.find((m) => m.id === btn.dataset.retryId);
            if (failedItem) {
              failedMessages = failedMessages.filter((m) => m.id !== failedItem.id);
              sendMessageToPartner(failedItem.to_cid, failedItem.text, failedItem.via);
            }
          });
        });

        if (!wasScrolledUp) {
          container.scrollTop = container.scrollHeight;
        } else {
          const scrollPill = document.getElementById("msg-scroll-pill");
          if (scrollPill) scrollPill.hidden = false;
        }
      }
    }
  } catch (err) {
    console.warn("[messages] Thread refresh error:", err);
  }
}

async function markConversationRead(partnerCid) {
  const myCid = getMyCid();
  try {
    await fetch(`../api/messages/${myCid}/read/${partnerCid}`, { method: "POST" });
    emit("conversation:read", { with: partnerCid });
    updateUnreadBadge();
  } catch {
    // ignore
  }
}

/**
 * Poll for unread messages and new activity.
 */
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const myCid = getMyCid();
    if (!myCid) return;

    // 1. Check unread count
    try {
      const res = await fetch(`../api/messages/${myCid}/unread`);
      if (res.ok) {
        const data = await res.json();
        const unreadCount = data.unread_count || 0;
        if (unreadCount !== lastUnreadTotal) {
          lastUnreadTotal = unreadCount;
          emit("unread:changed", unreadCount);
          updateUnreadBadge(unreadCount);
        }
      }
    } catch {
      // offline
    }

    // 2. If viewing a thread, refresh thread messages
    if (isPanelOpen() && currentViewMode === "thread" && currentPartnerCid) {
      await refreshCurrentThread();
      markConversationRead(currentPartnerCid);
    }

    // 3. Check for new incoming messages to trigger quiet toast
    checkNewIncomingMessages();
  }, isPanelOpen() ? 1500 : 3000);
}

async function checkNewIncomingMessages() {
  const myCid = getMyCid();
  if (!myCid) return;

  try {
    const res = await fetch(`../api/messages/${myCid}/conversations`);
    if (!res.ok) return;
    const data = await res.json();
    const convos = data.conversations || [];

    for (const c of convos) {
      if (c.unread_count > 0 && !lastKnownMessageIds.has(c.last_time)) {
        lastKnownMessageIds.add(c.last_time);
        emit("message:received", c);

        // If panel is closed, show brief quiet toast notification
        if (!isPanelOpen()) {
          showIncomingMessageToast(c.other_cid, c.other_name, c.last_message);
        }
      }
    }
  } catch {
    // ignore
  }
}

function showIncomingMessageToast(senderCid, senderName, preview) {
  const existing = document.getElementById("msg-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "msg-toast";
  toast.className = "msg-toast";
  toast.innerHTML = `
    <div class="msg-toast-avatar">${esc((senderName || senderCid).charAt(0).toUpperCase())}</div>
    <div class="msg-toast-content">
      <strong>${esc(senderName || senderCid)}</strong>
      <span>${esc(preview || "New message")}</span>
    </div>
  `;

  toast.addEventListener("click", () => {
    toast.remove();
    openMessages(senderCid);
  });

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("is-visible");
  }, 20);

  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

export function updateUnreadBadge(count = null) {
  const badge = document.getElementById("messages-badge");
  if (!badge) return;

  const currentCount = count !== null ? count : lastUnreadTotal;
  if (currentCount > 0) {
    badge.textContent = currentCount > 99 ? "99+" : currentCount;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function getMyCid() {
  if (appCtx?.view?.crewId) return appCtx.view.crewId;
  if (typeof window !== "undefined" && window.__crewId) return window.__crewId;
  return "james"; // Default nominal fallback
}

function getMyDisplayName() {
  const myCid = getMyCid();
  const crew = getCrewList().find((c) => c.crew_id === myCid);
  return crew?.display_name || myCid;
}

function getCrewList() {
  if (appCtx?.view?.crew?.length) return appCtx.view.crew;
  return [
    {"crew_id": "james", "display_name": "Eliah", "callsign": "James-1"},
    {"crew_id": "amara", "display_name": "Annie", "callsign": "Amara-1"},
    {"crew_id": "kenji", "display_name": "Seth", "callsign": "Kenji-1"},
    {"crew_id": "sofia", "display_name": "Sad", "callsign": "Sofia-1"},
    {"crew_id": "lukas", "display_name": "Stanley", "callsign": "Lukas-1"},
    {"crew_id": "priya", "display_name": "Gadiel", "callsign": "Priya-1"},
  ];
}

// Bind to window for global access
if (typeof window !== "undefined") {
  window.openCrewMessages = openMessages;
  window.closeCrewMessages = closeMessages;
  window.toggleCrewMessages = toggleMessages;
}
