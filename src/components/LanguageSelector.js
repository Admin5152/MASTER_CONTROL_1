/**
 * Sentinel Language Selector Component.
 * Supports switching between English (ElevenLabs, default) and Twi (Khaya AI).
 *
 * Implemented in plain JavaScript for universal compatibility:
 * - Can be used as a React component: <LanguageSelector />
 * - Can be mounted into any DOM element: renderLanguageSelector(element)
 */

import { getLanguage, setLanguage } from "../hooks/useTwiVoice.js";

/**
 * Pure DOM mounting function for vanilla JS and React integration.
 */
export function renderLanguageSelector(container) {
  if (!container) return;

  const currentLang = getLanguage();

  container.innerHTML = `
    <div class="sentinel-language-selector" style="
      display: inline-flex;
      align-items: center;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 9999px;
      padding: 3px 6px;
      gap: 4px;
      font-size: 12px;
      font-family: inherit;
      color: #94a3b8;
      backdrop-filter: blur(8px);
      user-select: none;
    ">
      <span style="font-size: 11px; margin-right: 2px; opacity: 0.75;">Voice:</span>
      <button type="button" class="lang-btn ${currentLang === "en" ? "active" : ""}" data-lang="en" style="
        background: ${currentLang === "en" ? "rgba(56, 189, 248, 0.2)" : "transparent"};
        color: ${currentLang === "en" ? "#38bdf8" : "#94a3b8"};
        border: ${currentLang === "en" ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent"};
        border-radius: 9999px;
        padding: 2px 8px;
        cursor: pointer;
        font-weight: ${currentLang === "en" ? "600" : "400"};
        transition: all 0.15s ease;
      ">EN</button>
      <button type="button" class="lang-btn ${currentLang === "tw" ? "active" : ""}" data-lang="tw" style="
        background: ${currentLang === "tw" ? "rgba(234, 179, 8, 0.2)" : "transparent"};
        color: ${currentLang === "tw" ? "#eab308" : "#94a3b8"};
        border: ${currentLang === "tw" ? "1px solid rgba(234, 179, 8, 0.4)" : "1px solid transparent"};
        border-radius: 9999px;
        padding: 2px 8px;
        cursor: pointer;
        font-weight: ${currentLang === "tw" ? "600" : "400"};
        transition: all 0.15s ease;
      ">TWI</button>
      <span id="twi-voice-spinner" style="
        display: none;
        width: 10px;
        height: 10px;
        border: 2px solid #eab308;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-left: 2px;
      "></span>
    </div>
  `;

  // Attach event listeners
  const buttons = container.querySelectorAll(".lang-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const selected = btn.getAttribute("data-lang");
      setLanguage(selected);
      renderLanguageSelector(container);
    });
  });

  // Listen for loading spinner events
  if (typeof window !== "undefined") {
    window.addEventListener("sentinel:twi-loading", (e) => {
      const spinner = container.querySelector("#twi-voice-spinner");
      if (spinner) {
        spinner.style.display = e.detail ? "inline-block" : "none";
      }
    });
  }
}

/**
 * React Component representation (plain JavaScript, no JSX required).
 */
export function LanguageSelector() {
  const React = (typeof window !== "undefined" && window.React) ? window.React : null;

  if (React && React.createElement) {
    const [lang, setLang] = React.useState(getLanguage);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
      const handleLang = (e) => setLang(e.detail);
      const handleLoading = (e) => setLoading(e.detail);
      window.addEventListener("sentinel:language-change", handleLang);
      window.addEventListener("sentinel:twi-loading", handleLoading);
      return () => {
        window.removeEventListener("sentinel:language-change", handleLang);
        window.removeEventListener("sentinel:twi-loading", handleLoading);
      };
    }, []);

    return React.createElement(
      "div",
      { className: "sentinel-language-selector" },
      React.createElement("span", null, "Voice: "),
      React.createElement(
        "button",
        {
          type: "button",
          className: lang === "en" ? "active" : "",
          onClick: () => { setLanguage("en"); setLang("en"); },
        },
        "EN"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: lang === "tw" ? "active" : "",
          onClick: () => { setLanguage("tw"); setLang("tw"); },
        },
        "TWI"
      ),
      loading && React.createElement("span", { className: "spinner" })
    );
  }

  // Ref-based fallback for mounting into standard DOM
  return null;
}

export default LanguageSelector;
