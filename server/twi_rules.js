/**
 * Sentinel Twi Language & Conversational System Rules.
 * Defines comprehensive vocabulary mappings, conversational patterns, and translation rules for Asante Twi.
 */

const TWI_SYSTEM_RULES = {
  language: "twi",
  code: "tw",
  iso_639_3: "twi",
  dialect: "asante",
  voice_engine: "Khaya AI (GhanaNLP)",

  guidelines: [
    "Speak with calm, clear, respectful, and reassuring Ghanaian Asante Twi.",
    "Keep health advice direct and conversational, suitable for an astronaut in orbit.",
    "Preserve critical medical and physiological numbers clearly.",
    "Always alert in Twi immediately, and trigger English secondary broadcast for level 3 emergencies.",
    "Show dual-language subtitles (Twi primary, English secondary) on all visual terminals.",
  ],

  // Conversational fast-path dictionary for zero-latency responses
  phrases: {
    "hello": "Akwaaba",
    "hi": "Akwaaba",
    "welcome": "Akwaaba",
    "how are you": "Me ho yɛ papa, medaase! Wo ho te sɛn?",
    "how are you doing": "Me ho yɛ papa, medaase! Wo ho te sɛn?",
    "i am fine": "Me ho yɛ, medaase",
    "i am doing well": "Me ho yɛ papa",
    "thank you": "Medaase pii",
    "thanks": "Medaase",
    "good morning": "Maakye! Wo ho te sɛn anɔpa yi?",
    "good afternoon": "Maaha! Me ho yɛ papa.",
    "good evening": "Maadwo! Gye w'ahome kakra.",
    "good night": "Nna pa. Da yiye.",
    "sleep well": "Nna pa",
    "take care": "Hwɛ wo ho so yiye",
    "drink water": "Nom nsuo kakra",
    "breathe": "Gye w'ahome yiye",
    "take a deep breath": "Gye w'ahome kɔ akyiri",
    "rest": "Gye w'ahome",
    "all clear": "Biribiara kɔ so yiye",
    "emergency": "Ntɛmpɛ Kɔkɔbɔ",
    "warning": "Kɔkɔbɔ",
    "medical alert": "Akwahosan kɔkɔbɔ",
    "yes": "Aane",
    "no": "Dabi",
    "i have a headache": "Tipae no ano yɛ den? Gye w'ahome kakra na nom nsuo. Sɛ ɛkɔ so a, bɔ me amanneɛ.",
    "i don't feel well": "Mebue akwahosan nhwehwɛmu no ama woatumi aka nea ɛrehaw wo.",
    "what can you do": "Metumi ahwɛ w'akwahosan, atie wo yareɛ ho nsɛm, akyerɛ wo komatwa ne mogya mmirikatuo, na me ne wo abɔ nkɔmmɔ.",
    "who are you": "Mene Sentinel, w'akwahosan boafoɔ wɔ wim yi mu. Mehwɛ sɛ w'apɔmuden kɔ so yiye.",
    "what are you": "Mene Sentinel, w'akwahosan boafoɔ wɔ wim yi mu.",
    "are you there": "Aane, mewɔ ha na meretie wo yiye pa ara.",
    "can you hear me": "Aane, meretie wo yiye pa ara.",
    "talk to me": "Mewɔ ha ma wo. Gye wo bere, asɛm bɛn na ɛwɔ w'adwenem?",
    "goodbye": "Yɛbɛsan ahyia bio. Mewɔ ha bere biara a wobɛhia me.",
    "bye": "Yɛbɛsan ahyia bio.",
  },

  // Spaceflight and clinical terms in Asante Twi
  medical_terms: {
    "heart rate": "Komatwa mmirikatuo",
    "pulse": "Komatwa",
    "blood pressure": "Mogya mmirikatuo",
    "oxygen": "Mframa pa (Oxygen)",
    "oxygen saturation": "Mframa pa dodow wɔ mogya mu",
    "cabin pressure": "Esuom mframa a ɛwɔ dan no mu",
    "radiation": "Sunsuma a ɛyɛ hu (Radiation)",
    "radiation storm": "Sunsuma a ano yɛ den kɛse",
    "solar flare": "Awia mu aprannaa",
    "headache": "Tipae",
    "dizziness": "Asisie",
    "fatigue": "Ɔbrɛ kɛse",
    "nausea": "Feerɔ",
    "medical kit": "Ayaresa adaka",
    "flight surgeon": "Ahunmu dɔkota panyin",
    "eva": "Abɔnten dwumadie (EVA)",
    "suit leak": "Atadeɛ mu mframa a ɛrefiri",
    "shielding": "Banbɔ afidie",
    "reaction test": "Reaction test ne Fitts's Law game",
    "check-in": "Da biara akwahosan nhwehwɛmu (daily check-in)",
    "vitals": "Komatwa ne mogya mmirikatuo",
  },

  conversational_responses: {
    greeting: "Akwaaba! Me ho yɛ papa, medaase. Wo ho te sɛn nnɛ?",
    can_speak: "Aane, mitumi kasa Twi yiye pa ara! Yɛbɛbɔ nkɔmmɔ wɔ Twi mu seesei ara.",
    full_conversation: "Ɛyɛ me dɛ kɛse! Yɛbɛkasa Twi nkutoo wɔ ha seesei. Mɛtumi aboa wo dɛn?",
    switch_confirm: "Akwaaba. Mɛkasa Twi seesei ara.",
    switch_english: "Switched to English. I'll speak English from now on.",
    vitals_normal: "Wo nipadua akwahosan tebea nyinaa yɛ papa na ɛkɔ so yiye.",
    rest_advice: "W'adwene ne wo nipadua abrɛ kakra. Gye w'ahome na nom nsuo.",
  },
};

/**
 * Common conversational patterns mapped from English to authentic Asante Twi.
 */
const TWI_CONVERSATIONAL_PATTERNS = [
  {
    pattern: /\b(?:how\s+are\s+you|how\s+are\s+you\s+doing|ete\s+s[ɛe]n|wo\s+ho\s+te\s+s[ɛe]n)\b/i,
    response: (name) => `Me ho yɛ papa, medaase! Wo nso wo ho te sɛn${name ? `, ${name}` : ""}? Mɛtumi aboa wo dɛn nnɛ?`,
  },
  {
    pattern: /\b(?:can\s+you\s+(?:answer|respond|speak|talk)\s+(?:in\s+)?twi|respond\s+in\s+twi|speak\s+in\s+twi|kasa\s+twi)\b/i,
    response: () => "Aane, mitumi kasa Twi yiye pa ara! Yɛbɛbɔ nkɔmmɔ wɔ Twi mu seesei ara.",
  },
  {
    pattern: /\b(?:let'?s\s+(?:have\s+)?(?:all\s+)?(?:the\s+)?conversation\s+(?:right\s+now\s+)?in\s+twi)\b/i,
    response: () => "Ɛyɛ me dɛ kɛse! Yɛbɛkasa Twi nkutoo wɔ ha seesei ara. Ka nea ɛwɔ w'adwenem kyerɛ me.",
  },
  {
    pattern: /\b(?:good\s*morning|maakye)\b/i,
    response: (name) => `Maakye${name ? `, ${name}` : ""}! Wo dae yiye anaa? Wo ho te sɛn anɔpa yi?`,
  },
  {
    pattern: /\b(?:good\s*afternoon|maaha)\b/i,
    response: (name) => `Maaha${name ? `, ${name}` : ""}! Me ho yɛ papa, wo nso wo ho te sɛn?`,
  },
  {
    pattern: /\b(?:good\s*evening|maadwo)\b/i,
    response: (name) => `Maadwo${name ? `, ${name}` : ""}! Da no kɔɔ sɛn? Gye w'ahome kakra.`,
  },
  {
    pattern: /\b(?:good\s*night|going\s+to\s+(?:bed|sleep)|nna\s+pa)\b/i,
    response: (name) => `Nna pa${name ? `, ${name}` : ""}. Da yiye. Mɛhwɛ wo so wɔ anadwo yi mu na sɛ biribi hia a mɛkanyan wo.`,
  },
  {
    pattern: /\b(?:who\s+are\s+you|what\s+are\s+you|your\s+name)\b/i,
    response: () => "Mene Sentinel, w'akwahosan boafoɔ wɔ wim yi mu. Mehwɛ sɛ w'apɔmuden kɔ so yiye, na mewɔ ha daa sɛ me ne wo bɛkasa.",
  },
  {
    pattern: /\b(?:joke|make\s+me\s+laugh|something\s+funny)\b/i,
    response: () => "Adɛn nti na obi a ɔwɔ wim no gyee n'ahome wɔ bosome no ho? Efisɛ na ɔpɛ kwan (space)! Hahaha.",
  },
  {
    pattern: /\b(?:bored|nothing\s+to\s+do)\b/i,
    response: () => "Ɛha nna yɛ tenten papa. Wopɛ sɛ yɛtu mmirika wɔ Slipstream, anaa yɛkɔhwɛ mfudeɛ a ɛwɔ abɔnten no, anaa yɛbɔ nkɔmmɔ kakra?",
  },
  {
    pattern: /\b(?:miss(?:ing)?\s+(?:home|family|earth)|homesick)\b/i,
    response: (name) => `Ɛyɛ den pa ara sɛ wobɛfiri fie akyirikyiri saa${name ? `, ${name}` : ""}. Wopɛ sɛ yɛhwɛ Asase mfonini kakra, anaa wobɛka wɔn ho asɛm akyerɛ me?`,
  },
  {
    pattern: /\b(?:talk\s+to\s+me|keep\s+me\s+company|just\s+want\s+to\s+talk)\b/i,
    response: (name) => `Mewɔ ha ma wo${name ? `, ${name}` : ""}. Gye wo bere. Asɛm bɛn na ɛwɔ w'adwenem?`,
  },
  {
    pattern: /\b(?:bad\s+day|hard\s+day|rough\s+day|tough\s+day)\b/i,
    response: () => "M'ani awu sɛ ɛnnɛ yɛ den ma wo saa. Ka nea esii kyerɛ me, anaa wopɛ sɛ wogye w'ahome kakra?",
  },
  {
    pattern: /\b(?:good\s+day|great\s+day|feeling\s+good|feeling\s+great)\b/i,
    response: (name) => `Ɛyɛ aso pa kɛse${name ? `, ${name}` : ""}! Ɛdeɛn na ɛyɛɛ fɛ nnɛ saa?`,
  },
  {
    pattern: /\b(?:are\s+you\s+(?:there|listening)|can\s+you\s+hear\s+me)\b/i,
    response: () => "Aane, meretie wo yiye pa ara.",
  },
  {
    pattern: /\b(?:what\s+can\s+you\s+do|help\s+me)\b/i,
    response: () => "Metumi ahwɛ w'akwahosan, atie wo yareɛ ho nsɛm, akyerɛ wo komatwa ne mogya mmirikatuo, na me ne wo abɔ nkɔmmɔ. Ka kyerɛ me sɛ 'me ho nfa me', anaa 'check-in', na meboae wo.",
  },
  {
    pattern: /\b(?:i\s+love\s+you|you'?re\s+(?:great|awesome|the\s+best))\b/i,
    response: (name) => `Medaase pii${name ? `, ${name}` : ""}. Mewɔ ha daa ma wo.`,
  },
  {
    pattern: /\b(?:goodbye|bye|see\s+you|talk\s+later)\b/i,
    response: (name) => `Yɛbɛsan ahyia bio${name ? `, ${name}` : ""}. Mewɔ ha bere biara a wobɛhia me.`,
  },
  {
    pattern: /\b(?:headache|head\s+hurts?|me\s+ti\s+pae\s+me)\b/i,
    response: () => "M'atwerɛ wo tipae no ato hɔ. Yɛrekɔ akwahosan nsɛmmisa mu ahwɛ aduru a ɛbɛboa wo.",
  },
  {
    pattern: /\b(?:not\s+feeling\s+well|symptom|where\s+does\s+it\s+hurt|me\s+ho\s+nfa\s+me)\b/i,
    response: () => "Mebue akwahosan nhwehwɛmu (symptom triage) ama woatumi aka nea ɛrehaw wo.",
  },
  {
    pattern: /\b(?:heart\s+rate|pulse|komatwa)\b/i,
    response: () => "Wo komatwa mmirikatuo (heart rate) kɔ so yiye na ɛbɛn wo gyinapɛn pɛpɛɛpɛ.",
  },
  {
    pattern: /\b(?:oxygen|cabin|mframa)\b/i,
    response: () => "Esuom mframa pa (Oxygen) a ɛwɔ dan no mu yɛ ɔha mu nkyekyem a ɛfata, biribiara kɔ so yiye.",
  },
  {
    pattern: /\b(?:radiation|sunsuma|storm)\b/i,
    response: () => "Sunsuma a ano yɛ den (Radiation) tebea kɔ so yiye na storm level yɛ nominal.",
  },
  {
    pattern: /\b(?:sleep|how\s+did\s+i\s+sleep|nna)\b/i,
    response: () => "W'adwuma ne wo nna ho kyerɛwtohɔ kɔ so yiye. Gye w'ahome na nom nsuo kakra.",
  },
  {
    pattern: /\b(?:reaction\s+test|fitts|cognitive)\b/i,
    response: () => "Yɛrebue reaction test ne Fitts's Law game no ama woaso w'adwene ne wo nsa kɔkroko ahwɛ.",
  },
  {
    pattern: /\b(?:check-?in|daily\s+check-?in)\b/i,
    response: () => "Yɛrebue da biara nhwehwɛmu no (daily check-in) seesei ara.",
  },
  {
    pattern: /\b(?:settings|nhyehy[ɛe][ɛe])\b/i,
    response: () => "Mebue nhyehyɛeɛ (settings) no seesei.",
  },
];

/**
 * Find fast-path Twi translation for common English phrases.
 */
function getFastPathTwi(englishText, name = "") {
  if (!englishText || typeof englishText !== "string") return null;
  const clean = englishText.trim().toLowerCase().replace(/[.,!?;:]/g, "");
  if (TWI_SYSTEM_RULES.phrases[clean]) {
    return TWI_SYSTEM_RULES.phrases[clean];
  }
  for (const item of TWI_CONVERSATIONAL_PATTERNS) {
    if (item.pattern.test(englishText)) {
      return item.response(name);
    }
  }
  return null;
}

/**
 * Translate general English response to Asante Twi using rules & phrase mapping.
 */
function translateEnglishToTwi(text, name = "") {
  if (!text || typeof text !== "string") return "";
  const fast = getFastPathTwi(text, name);
  if (fast) return fast;

  let out = text;

  // Replace common medical / health status phrases
  out = out.replace(/your heart rate is about (\d+), close to your usual (\d+)\.?/i, "Wo komatwa mmirikatuo yɛ bɛyɛ $1, ɛbɛn wo gyinapɛn $2 yiye.");
  out = out.replace(/your heart rate is about (\d+), (\d+) above your usual (\d+)\.?/i, "Wo komatwa mmirikatuo yɛ bɛyɛ $1, ɛboro wo gyinapɛn $3 so $2.");
  out = out.replace(/your heart rate is about (\d+)\.?/i, "Wo komatwa mmirikatuo yɛ bɛyɛ $1.");
  out = out.replace(/everything else is within your usual range,?\s*(\w*)\.?/i, "Wo nipadua akwahosan tebea nyinaa yɛ papa na ɛkɔ so yiye, $1.");
  out = out.replace(/cabin oxygen is (\d+(?:\.\d+)?) percent and carbon dioxide (\d+) ppm\.?/i, "Esuom mframa pa (Oxygen) a ɛwɔ dan no mu yɛ ɔha mu nkyekyem $1, na carbon dioxide nso yɛ $2 ppm.");
  out = out.replace(/opening symptom triage so you can record what you are feeling\.?/i, "Mebue akwahosan nhwehwɛmu (symptom triage) ama woatumi aka nea ɛrehaw wo.");
  out = out.replace(/i've noted your headache\. starting symptom triage/i, "M'atwerɛ wo tipae no ato hɔ. Yɛrekɔ akwahosan nsɛmmisa mu");
  out = out.replace(/starting the reaction test\.?/i, "Yɛrebue reaction test ne Fitts's Law game no.");
  out = out.replace(/opening the reaction test\.?/i, "Yɛrebue reaction test ne Fitts's Law game no.");
  out = out.replace(/reaction time is within your usual range/i, "Reaction bere a wode yɛɛ adwuma no yɛ papa na ɛkɔ so yiye");

  // If already translated
  if (out !== text) return out;

  // General fallback translation
  return `Akwaaba. ${text}`;
}

module.exports = {
  TWI_SYSTEM_RULES,
  TWI_CONVERSATIONAL_PATTERNS,
  getFastPathTwi,
  translateEnglishToTwi,
};
