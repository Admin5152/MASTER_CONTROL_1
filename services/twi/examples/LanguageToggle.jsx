import React, { useState, useEffect, useCallback } from "react";
import { getLanguage, setLanguage, speakTwi, recordAndListenTwi } from "../hooks/useTwiVoice.js";

/**
 * LanguageToggle Component.
 * Enables crew members to switch between English (ElevenLabs default) and Twi (Khaya AI voice).
 *
 * Features:
 * - Persisted language selection ("en" or "tw")
 * - Live loading indicator when Khaya is synthesizing/translating
 * - Display of permission denial and status notifications
 */
export function LanguageToggle({ onCommand, onListeningChange }) {
  const [currentLang, setCurrentLang] = useState(getLanguage);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const handleLangChange = (e) => setCurrentLang(e.detail);
    const handleLoading = (e) => setIsLoading(Boolean(e.detail));
    const handleFallback = (e) => {
      setStatusMessage(`Voice notice: ${e.detail} (English voice active)`);
      setTimeout(() => setStatusMessage(""), 6000);
    };

    window.addEventListener("sentinel:language-change", handleLangChange);
    window.addEventListener("sentinel:twi-loading", handleLoading);
    window.addEventListener("sentinel:twi-fallback", handleFallback);

    return () => {
      window.removeEventListener("sentinel:language-change", handleLangChange);
      window.removeEventListener("sentinel:twi-loading", handleLoading);
      window.removeEventListener("sentinel:twi-fallback", handleFallback);
    };
  }, []);

  const handleSelectLang = useCallback((lang) => {
    const updated = setLanguage(lang);
    setCurrentLang(updated);
  }, []);

  const handleRecordTwi = async () => {
    if (isRecording) return;
    setIsRecording(true);
    if (typeof onListeningChange === "function") onListeningChange(true);
    setStatusMessage("Listening in Twi...");

    try {
      const result = await recordAndListenTwi(7000);
      setIsRecording(false);
      if (typeof onListeningChange === "function") onListeningChange(false);

      if (result && result.eng_text) {
        setStatusMessage(`Understood: "${result.twi_text}"`);
        if (typeof onCommand === "function") {
          onCommand(result.eng_text);
        }
      } else if (result && result.fallback) {
        setStatusMessage("ASR timeout: falling back to standard voice.");
      }
      setTimeout(() => setStatusMessage(""), 4000);
    } catch (err) {
      setIsRecording(false);
      if (typeof onListeningChange === "function") onListeningChange(false);
      setStatusMessage(`Microphone error: ${err.message}`);
      setTimeout(() => setStatusMessage(""), 5000);
    }
  };

  return (
    <div className="sentinel-language-toggle-wrapper" style={{ display: "inline-flex", flexDirection: "column", gap: "4px" }}>
      <div
        className="sentinel-language-toggle"
        role="group"
        aria-label="Language Selector"
        style={{
          display: "inline-flex",
          alignItems: "center",
          background: "rgba(15, 23, 42, 0.75)",
          border: "1px solid rgba(148, 163, 184, 0.2)",
          borderRadius: "9999px",
          padding: "3px 6px",
          gap: "4px",
          fontSize: "12px",
          color: "#94a3b8",
          backdropFilter: "blur(8px)",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: "11px", opacity: 0.8, marginRight: "2px" }}>Voice:</span>
        <button
          type="button"
          onClick={() => handleSelectLang("en")}
          style={{
            background: currentLang === "en" ? "rgba(56, 189, 248, 0.2)" : "transparent",
            color: currentLang === "en" ? "#38bdf8" : "#94a3b8",
            border: currentLang === "en" ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent",
            borderRadius: "9999px",
            padding: "2px 8px",
            cursor: "pointer",
            fontWeight: currentLang === "en" ? 600 : 400,
            transition: "all 0.15s ease",
          }}
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => handleSelectLang("tw")}
          style={{
            background: currentLang === "tw" ? "rgba(234, 179, 8, 0.2)" : "transparent",
            color: currentLang === "tw" ? "#eab308" : "#94a3b8",
            border: currentLang === "tw" ? "1px solid rgba(234, 179, 8, 0.4)" : "1px solid transparent",
            borderRadius: "9999px",
            padding: "2px 8px",
            cursor: "pointer",
            fontWeight: currentLang === "tw" ? 600 : 400,
            transition: "all 0.15s ease",
          }}
        >
          TWI
        </button>

        {isLoading && (
          <span
            className="spinner"
            aria-label="Synthesizing Twi..."
            style={{
              display: "inline-block",
              width: "10px",
              height: "10px",
              border: "2px solid #eab308",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              marginLeft: "4px",
            }}
          />
        )}

        {currentLang === "tw" && (
          <button
            type="button"
            onClick={handleRecordTwi}
            disabled={isRecording}
            title="Push to speak in Twi"
            style={{
              background: isRecording ? "#ef4444" : "rgba(234, 179, 8, 0.15)",
              color: isRecording ? "#fff" : "#eab308",
              border: "1px solid rgba(234, 179, 8, 0.3)",
              borderRadius: "9999px",
              padding: "2px 6px",
              marginLeft: "4px",
              cursor: isRecording ? "default" : "pointer",
              fontSize: "10px",
            }}
          >
            {isRecording ? "Listening..." : "Speak Twi"}
          </button>
        )}
      </div>

      {statusMessage && (
        <span
          className="twi-status-msg"
          style={{
            fontSize: "11px",
            color: "#e2e8f0",
            opacity: 0.85,
            paddingLeft: "6px",
          }}
        >
          {statusMessage}
        </span>
      )}
    </div>
  );
}

export default LanguageToggle;
