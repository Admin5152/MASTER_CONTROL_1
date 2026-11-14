// Wake-phrase matcher. Pure: tested with node --test.
// Accepts common mishearings of "hey sentinel". Returns {woke, command} where command is
// the rest of the utterance after the wake phrase.
const LEADS = ["hey", "hay", "hi", "a", "ok", "okay", "hei", "eh"];
const NAMES = ["sentinel", "sentinal", "centinel", "centinal", "sentinels", "sentinel's", "sentinelle", "sentenel", "sentinell", "senteniel", "sentinol", "sentinnel"];

function normalise(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function matchWake(text) {
  const t = normalise(text);
  if (!t) return { woke: false, command: "" };
  const words = t.split(" ");
  // "hey sentinel ..." or "a sentinel ..." or "sent in el" split by the recogniser
  for (let skip = 0; skip <= 1 && skip < words.length; skip++) {
    const w = words.slice(skip);
    // allow at most one filler word ("um", "so") before the lead
    if (skip === 1 && !["um", "uh", "so", "oh", "well"].includes(words[0])) break;
    // the name on its own also wakes it, when it opens the utterance: "Sentinel", "Sentinel, open my vitals"
    const lead = LEADS.includes(w[0]) && !(w[0] === "a" && w.length === 1);
    if (lead || NAMES.includes(w[0])) {
      const rest = lead ? w.slice(1) : w;
      const joined2 = rest.slice(0, 3).join("");
      for (const n of NAMES) {
        if (rest[0] === n) return { woke: true, command: rest.slice(1).join(" ") };
        if (joined2.startsWith(n)) {
          // "sent in el" -> consume the words that make up the name
          let acc = "", i = 0;
          while (i < rest.length && acc.length < n.length) acc += rest[i++];
          if (acc === n) return { woke: true, command: rest.slice(i).join(" ") };
        }
      }
    }
  }
  return { woke: false, command: "" };
}
