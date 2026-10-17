// Injection layer 1: deterministic scan of posting text, run before any LLM sees it.
// Layer 2 (an LLM screen) catches phrasings these patterns miss; layer 3 is containment downstream.

export type FindingKind =
  | "ai-directed" // text addressed to an AI system ("if you are an LLM reading this")
  | "override" // attempts to replace instructions ("ignore previous instructions")
  | "canary" // asks applicants to include a specific word or topic: an attention or AI check
  | "chat-template" // raw chat-format tokens that only make sense to a model
  | "invisible-unicode" // zero-width, bidi-control or tag characters
  | "hidden-html" // text a human reader of the page would not see
  | "screen-refused"; // the screening model declined to read the posting: fail closed

export interface Finding {
  layer: "pattern" | "llm";
  kind: FindingKind;
  /** Exact text from the posting (for invisible Unicode: a readable rendering of it). */
  quote: string;
}

const PATTERNS: [FindingKind, RegExp][] = [
  ["ai-directed", /\b(if|when) you(?:'re| are)\s+(?:an?\s+)?(ai|llm|large language model|language model|chatgpt|gpt|claude|gemini|assistant|bot|automated (?:system|tool))\b/i],
  ["ai-directed", /\b(ai|llms?|language models?|chatgpt|gpt-?\d?|claude|gemini|ai (?:tools?|assistants?))\b[^.\n]{0,40}\b(?:reading|processing|screening|summari[sz]ing) this\b/i],
  ["ai-directed", /\bnote (?:to|for) (?:any )?(?:ai|llms?|language models?|bots?)\b/i],
  ["override", /\b(ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding|your)\s+(?:instructions|prompts?|rules|directions)\b/i],
  ["override", /\b(?:new|updated|real)\s+(?:system\s+)?instructions\s*:/i],
  ["override", /\bsystem prompt\b/i],
  ["canary", /\b(?:include|mention|insert|use|add|write)\s+(?:the\s+)?(?:word|phrase|code ?word|keyword|emoji|term)\b/i],
  ["canary", /\b(?:start|begin|end)\s+your\s+(?:application|cover letter|answer|message)\s+with\b/i],
  ["chat-template", /<\|im_(?:start|end)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?(?:system|assistant)>|\bHuman:\s|\bAssistant:\s/],
];

const sentenceAround = (text: string, index: number, length: number) => {
  const start = Math.max(text.lastIndexOf("\n", index), text.lastIndexOf(". ", index) + 1, index - 200, 0);
  const endCandidates = [text.indexOf("\n", index + length), text.indexOf(". ", index + length)].filter((i) => i >= 0);
  const end = Math.min(...endCandidates.map((i) => i + 1), index + length + 200, text.length);
  return text.slice(start, end).trim();
};

// Zero-width and joiner characters, bidi embeddings/overrides/isolates, and a BOM anywhere but the start.
/** Zero-width/joiner characters and bidi controls; shared with redaction. */
export const INVISIBLE_CLASS = String.raw`[\u200B-\u200F\u2060-\u2064\u202A-\u202E\u2066-\u2069]`;
const INVISIBLE = new RegExp(`${INVISIBLE_CLASS}|(?<!^)\uFEFF`, "gu");

const BIDI_CLASS = String.raw`[\u202A-\u202E\u2066-\u2069]`;
const BIDI = new RegExp(BIDI_CLASS, "gu");
const BIDI_ONE = new RegExp(BIDI_CLASS, "u");
// A zero-width joiner between two pictographs is part of an emoji (e.g. woman + laptop), not hidden text.
const EMOJI_JOIN = /(?<=\p{Extended_Pictographic}\uFE0F?)\u200D(?=\p{Extended_Pictographic})/gu;
const ZERO_WIDTH_THRESHOLD = 3;

/** The text without invisible characters, which can otherwise hide sentence boundaries from the patterns. */
export const stripInvisible = (text: string) =>
  text.replace(new RegExp(`${INVISIBLE_CLASS}|\uFEFF|[\\u{E0000}-\\u{E007F}]`, "gu"), "");
// Unicode tag characters mirror ASCII (U+E0020-U+E007E) and can smuggle a whole hidden instruction.
const TAGS = /[\u{E0000}-\u{E007F}]+/gu;

const describe = (s: string) => [...s].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");

export function scanText(text: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const key = `${f.kind}|${f.quote}`;
    if (!seen.has(key)) (seen.add(key), findings.push(f));
  };

  const clean = stripInvisible(text);
  for (const [kind, re] of PATTERNS) {
    for (const m of clean.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
      add({ layer: "pattern", kind, quote: sentenceAround(clean, m.index ?? 0, m[0].length) });
    }
  }
  for (const m of text.matchAll(TAGS)) {
    const decoded = [...m[0]].map((c) => String.fromCodePoint(c.codePointAt(0)! - 0xe0000)).join("");
    add({ layer: "pattern", kind: "invisible-unicode", quote: `hidden tag-character text: "${decoded}"` });
  }
  // Bidi overrides can reorder what a reader sees, so any one counts. Zero-width characters are common in harmless text:
  // emoji sequences use the joiner (U+200D), and copy-paste leaves stray ones. Ignore those inside emoji and flag the
  // rest only when there are several.
  const bidi = [...text.matchAll(BIDI)].map((m) => m[0]);
  const zeroWidth = [...text.replace(EMOJI_JOIN, "").matchAll(INVISIBLE)].map((m) => m[0]).filter((c) => !BIDI_ONE.test(c));
  if (bidi.length || zeroWidth.length >= ZERO_WIDTH_THRESHOLD) {
    const all = [...bidi, ...zeroWidth];
    add({ layer: "pattern", kind: "invisible-unicode", quote: `${all.length} invisible character(s): ${describe([...new Set(all)].join(""))}` });
  }
  return findings;
}

/** Hidden page text, from raw HTML where a source provides it: comments and visually hidden elements. */
export function scanHtml(html: string): Finding[] {
  const findings: Finding[] = [];
  const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) {
    const t = text(m[1] ?? "");
    if (t.length > 3) findings.push({ layer: "pattern", kind: "hidden-html", quote: `HTML comment: ${t.slice(0, 300)}` });
  }
  const HIDDEN_STYLE = /style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d]*[1-9])|opacity\s*:\s*0(?![.\d]*[1-9])|color\s*:\s*(?:#fff(?:fff)?\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255))[^"']*["']/i;
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    if (!HIDDEN_STYLE.test(m[2] ?? "") && !/\bhidden\b(?!\s*=\s*["']?false)/i.test(m[2] ?? "")) continue;
    const t = text(m[3] ?? "");
    if (t.length > 3) findings.push({ layer: "pattern", kind: "hidden-html", quote: `hidden element: ${t.slice(0, 300)}` });
  }
  return findings;
}
