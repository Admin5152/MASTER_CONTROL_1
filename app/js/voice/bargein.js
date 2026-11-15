// Barge-in: talking over Sentinel (pure: no DOM, tested with node --test).
// While Sentinel speaks, a stricter VAD keeps listening. When someone talks, the voice dips at once (it yields),
// the words are transcribed, and these helpers decide what was meant:
//   "stop", "quiet"                  -> stop      (go quiet, a short "Okay.")
//   "wait", "hold on", "Sentinel"    -> hold      ("Sure, I'm listening." and wait)
//   "go on", "continue"              -> resume    (pick up where it left off)
//   "wait, show my vitals"           -> command   (do that instead)
// Sentinel's own voice coming back through the microphone is recognised as echo and ignored.

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

/** True when what the microphone heard is mostly Sentinel's own sentence (speaker echo), not a person. */
export function isEcho(heard, spoken) {
  const h = words(heard).filter((w) => w.length >= 3);
  if (h.length < 2) return false;                       // "wait", "stop": too short to be an echo
  const s = new Set(words(spoken));
  const hit = h.filter((w) => s.has(w)).length;
  return hit / h.length >= 0.6;
}

const STOP = /^(?:(?:ok(?:ay)?|sentinel|please|no)[\s,]+)*(?:stop|stop talking|be quiet|quiet|shush|shut up|silence|enough|that'?s enough|cancel|never ?mind|forget it)\b/i;
const RESUME = /^(?:(?:ok(?:ay)?|sorry|right|sentinel|yes|yeah|please)[\s,.]+)*(?:go on|go ahead|continue|carry on|keep going|you can (?:continue|go on)|please continue|finish (?:that|what you were saying)|what were you saying|where were we)\b/i;
const LEAD = /^(?:(?:hey\s+)?sentinel|wait|hold on|hang on|hold up|sorry|excuse me|okay|ok|no|actually|one (?:moment|second|sec))(?:[\s,.!?-]+|$)/i;
// words that only fill a pause ("hang on a sec", "wait, I'm talking"): no request in them
const FILLER = new Set("a an the sec second seconds moment minute just please i i'm im am talking speaking let me finish think up on wait hold hang sorry ok okay sentinel hey yes yeah no".split(" "));

/** What an interruption meant: {kind: "stop"|"hold"|"resume"|"command", rest} (rest: the command, if any). */
export function classifyInterruption(text) {
  const t = String(text || "").trim();
  if (!t) return { kind: "hold", rest: "" };
  if (RESUME.test(t)) return { kind: "resume", rest: "" };
  if (STOP.test(t) && words(t).length <= 5) return { kind: "stop", rest: "" };
  // strip "wait,", "sorry,", "Sentinel," from the front; what is left is a request, if anything
  let rest = t;
  for (let i = 0; i < 4 && LEAD.test(rest); i++) rest = rest.replace(LEAD, "");
  rest = rest.replace(/^[\s,.!?-]+/, "").trim();
  const restWords = words(rest);
  if (!restWords.length || /^sentinel$/i.test(rest)) return { kind: "hold", rest: "" };
  if (restWords.every((w) => FILLER.has(w)) && !/\?$/.test(t)) return { kind: "hold", rest: "" };   // "hold on a sec", "wait, I'm talking"
  return { kind: "command", rest };
}

/** "go on", "continue", "where were we": asked after an interruption, Sentinel picks up where it stopped. */
export function isResume(text) { return RESUME.test(String(text || "").trim()); }

/** Spoken replies to an interruption, short and natural. */
export const ACK = { stop: "Okay.", hold: "Sure, I'm listening." };
