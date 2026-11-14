// Symptom entry by pointing at the body (Product Document section 7, BODY-6). Pure logic: which
// symptoms are offered for a body region, how an entry is built and validated, and how it joins the
// crew member's state (manual.symptoms for the rules engine's kit match, manual.symptom_log for the
// detail). No DOM; tested with node --test. The sheet that uses it is ./symptom.js.
import { REGIONS, REGION_ZONE } from "../interface/body.js";

export const SEVERITIES = [
  { value: 1, word: "Mild", hint: "Noticeable, not in the way" },
  { value: 2, word: "Moderate", hint: "Getting in the way of work or sleep" },
  { value: 3, word: "Severe", hint: "Hard to work through" },
];
export const ONSETS = [
  { value: "now", word: "Just now" },
  { value: "today", word: "Earlier today" },
  { value: "yesterday", word: "Since yesterday" },
  { value: "days", word: "Several days" },
];
export const LOG_MAX = 20;   // brain/contract.py SYMPTOM_LOG_MAX

// Words a crew member would use, never a diagnosis. Those the onboard kit maps (shared/med_kit.json
// symptom_map) lead to a kit suggestion from the rules engine; the others are logged for the surgeon.
const SKIN = ["rash", "cut or scrape", "allergy"];
export const REGION_SYMPTOMS = {
  head: ["headache", "dizziness", "congestion", "insomnia", "ear pain"],
  eyes: ["dry eyes", "eye irritation", "blurred vision"],
  neck: ["neck pain", "muscle ache", "sore throat"],
  chest: ["cough", "chest tightness", "heartburn", "racing heart"],
  abdomen: ["nausea", "heartburn", "stomach pain", "diarrhoea", "motion sickness"],
  back: ["back pain", "muscle ache"],
  arms: ["muscle ache", "joint pain", "numbness"],
  hands: ["joint pain", "numbness", "swelling"],
  legs: ["muscle ache", "joint pain", "numbness", "swelling"],
  feet: ["joint pain", "numbness", "swelling"],
};
/** Symptoms that belong to another zone than their region's default. */
const TYPE_ZONE = { cough: "lungs", "chest tightness": "lungs", congestion: "lungs", "sore throat": "lungs",
  heartburn: "gut", rash: "whole_body", "cut or scrape": "whole_body", allergy: "whole_body", "racing heart": "heart" };
export const SKIN_SYMPTOMS = SKIN;

/** The choices shown for a region: its own symptoms, then the skin ones (skin is everywhere). */
export function symptomsFor(region) {
  return [...(REGION_SYMPTOMS[region] || []), ...SKIN];
}

/** The health zone a symptom reports to. */
export function zoneFor(region, type) {
  return TYPE_ZONE[String(type || "").toLowerCase()] || REGION_ZONE[region] || "whole_body";
}

/**
 * Build one log entry, or throw with a message a person can act on.
 * Returns { zone, region, type, severity, onset, at }: the symptom.logged payload and the contract shape.
 */
export function buildSymptom({ region, type, severity, onset = "now", at } = {}) {
  if (!REGIONS.includes(region)) throw new Error("Point at the body to say where.");
  const t = String(type || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
  if (!t) throw new Error("Choose what you feel.");
  const sev = Number(severity);
  if (![1, 2, 3].includes(sev)) throw new Error("Choose how strong it is.");
  if (!ONSETS.some((o) => o.value === onset)) throw new Error("Choose when it started.");
  return { zone: zoneFor(region, t), region, type: t, severity: sev, onset, at: at || new Date().toISOString() };
}

/** The state patch that records an entry: newest first, capped, and the type added to manual.symptoms once. */
export function symptomPatch(manual, entry) {
  const log = [entry, ...(manual?.symptom_log || [])].slice(0, LOG_MAX);
  const symptoms = [...new Set([...(manual?.symptoms || []), entry.type])];
  return { manual: { symptoms, symptom_log: log, updated: entry.at } };
}

/** "Moderate headache (head), earlier today": one line for a list or a ground packet. */
export function describeSymptom(e) {
  const sev = SEVERITIES.find((s) => s.value === e.severity)?.word || "";
  const on = ONSETS.find((o) => o.value === e.onset)?.word.toLowerCase() || "";
  return `${sev} ${e.type} (${e.region}), ${on}`.trim();
}
