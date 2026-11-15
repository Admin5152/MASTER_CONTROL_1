// Sentinel's languages (pure: no DOM, tested with node --test).
//
// English is spoken by ElevenLabs (or Kokoro offline). Every other language goes through Khaya AI (GhanaNLP):
//   listening:  Khaya transcribes the crew member's speech and translates it to English for the brain
//   speaking:   the brain answers in English; Khaya translates the reply and speaks it
// The rules, safety checks and number checks always work on English. Critical alerts also play in English.
//
// To add a language: add a row here with its Khaya code (it must be in Khaya's translation list and speak with the
// multilingual voices; see docs/LANGUAGES.md), and the words people use to ask for it.

export const LANGUAGES = [
  { code: "en", khaya: "eng", name: "English", native: "English", engine: "ElevenLabs", words: ["english"] },
  { code: "tw", khaya: "twi", name: "Twi", native: "Twi", engine: "Khaya AI", words: ["twi", "asante twi", "akan"] },
  { code: "ee", khaya: "ewe", name: "Ewe", native: "Eʋegbe", engine: "Khaya AI", words: ["ewe", "eʋegbe", "evegbe"] },
  { code: "gaa", khaya: "gaa", name: "Ga", native: "Gã", engine: "Khaya AI", words: ["ga", "gã"] },
  { code: "fat", khaya: "fat", name: "Fante", native: "Mfantse", engine: "Khaya AI", words: ["fante", "fanti", "mfantse"] },
  { code: "dag", khaya: "dag", name: "Dagbani", native: "Dagbanli", engine: "Khaya AI", words: ["dagbani", "dagbanli", "dagomba"] },
  { code: "yo", khaya: "yor", name: "Yoruba", native: "Yorùbá", engine: "Khaya AI", words: ["yoruba", "yorùbá"] },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** A known language code, or "en". */
export function cleanLang(code) { return BY_CODE.has(code) ? code : "en"; }

/** The language's row ({code, khaya, name, native, engine}); English for an unknown code. */
export function langInfo(code) { return BY_CODE.get(cleanLang(code)); }

/** True for a language spoken and heard through Khaya (anything but English). */
export function isLocal(code) { return cleanLang(code) !== "en"; }

/** The code Khaya uses for this language ("twi", "ewe", ...). */
export function khayaCode(code) { return langInfo(code).khaya; }

// "speak Ewe", "switch to Ga", "answer me in Fante", "can you talk Dagbani", "let's speak Yoruba", "English please"
const ASK = "(?:speak|talk|answer|reply|respond|switch|change|chat|converse|say it|use|go)";
const LEADIN = "(?:(?:hey |ok |okay )?sentinel )?(?:(?:please|can you|could you|would you|will you|let's|lets|let us|i want you to|now|and) )*";
/**
 * The language a crew member asked Sentinel to speak, or null.
 * "Ga" is a short word, so it only counts with a verb or "in" in front ("speak Ga", "in Ga").
 */
export function matchLanguageRequest(text) {
  const t = ` ${String(text || "").toLowerCase().replace(/[^\p{L}\s']/gu, " ").replace(/\s+/g, " ").trim()} `;
  for (const l of LANGUAGES) {
    for (const w of l.words) {
      const word = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // the request starts the sentence ("speak Ewe", "can you speak Ewe"), so "how many people speak Yoruba" is a question
      const asked = new RegExp(`^ ${LEADIN}${ASK}(?: \\w+){0,4} (?:in |to |into )?${word} `).test(t)
        || new RegExp(` (?:in|into) ${word}(?: please| now| from now on)? $`).test(t)
        || new RegExp(`^ (?:${word})(?: please| now)? $`).test(t) && w.length > 2;
      if (asked) return l.code;
    }
  }
  return null;
}
