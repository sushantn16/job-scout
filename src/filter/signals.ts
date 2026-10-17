// Deterministic requirement extraction from posting text. Every signal carries the evidence it was read from,
// so the dashboard can show why a job was filtered.

export interface Evidence<T> {
  value: T;
  evidence: string;
}

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n|•|;/)
    .map((s) => s.trim())
    .filter(Boolean);

// A language word must sit within five words of "German": "the German entity and Junior-level roles" is not a
// language requirement, "speak business level or fluent German" is.
const CONTEXT = String.raw`speak\w*|fluen\w*|native|proficien\w*|\b[abc][12]\b\+?|language|written|spoken|verbal|(?:business|native|professional|mother)[- ]level`;
const GERMAN = String.raw`\b(?:german|deutsch)\b`;
const NEAR = String.raw`(?:\W+\w+){0,5}?\W+`;
const GERMAN_LANGUAGE = new RegExp(String.raw`(?:${CONTEXT})${NEAR}${GERMAN}|${GERMAN}${NEAR}(?:${CONTEXT})|\bdeutsch(?:kenntnisse|sprachig)`, "i");
const OPTIONAL = /\b(a (big |huge )?plus|nice[- ]to[- ]have|bonus|advantage\w*|helpful|not required|preferred|ideally|von vorteil|wünschenswert)\b/i;

/** Rough check for postings written in German: such roles effectively require German. */
export function isGermanText(text: string): boolean {
  const sample = text.slice(0, 3000);
  const de = sample.match(/\b(und|die|der|mit|wir|für|sie|bei|eine?)\b/gi)?.length ?? 0;
  const en = sample.match(/\b(the|and|you|with|we|for|our|are)\b/gi)?.length ?? 0;
  return de > 15 && de > en;
}

export type GermanLevel = "required" | "plus" | "none";

export function germanRequirement(text: string): Evidence<GermanLevel> {
  if (isGermanText(text)) return { value: "required", evidence: "posting is written in German" };
  let plus: string | undefined;
  for (const s of sentences(text)) {
    if (!GERMAN_LANGUAGE.test(s)) continue;
    if (OPTIONAL.test(s)) plus ??= s;
    else return { value: "required", evidence: s };
  }
  return plus ? { value: "plus", evidence: plus } : { value: "none", evidence: "" };
}

const YEARS = /(\d{1,2})\s*\+?\s*(?:[-–—]\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs|jahre)\b/gi;
const EXPERIENCE_CONTEXT = /experience|professional|building|engineering|shipping|developing|development|working with|writing|production|hands-on|commercial|erfahrung|in (a|the) /i;
const NOT_A_REQUIREMENT = /\bago\b|\bevery\b|\bold\b|founded|since|sabbatical|anniversary|been with us|for over/i;

/** Minimum years asked for. With several mentions ("8+ years backend, 3+ years LLM") the largest minimum wins. */
export function yearsRequired(text: string): Evidence<number | null> {
  let best: Evidence<number> | undefined;
  for (const m of text.matchAll(YEARS)) {
    const min = Number(m[1]);
    if (min < 1 || min > 15) continue;
    const at = m.index ?? 0;
    const window = text.slice(Math.max(0, at - 50), at + m[0].length + 70);
    if (NOT_A_REQUIREMENT.test(window) || !EXPERIENCE_CONTEXT.test(window)) continue;
    if (!best || min > best.value) best = { value: min, evidence: window.replace(/\s+/g, " ").trim() };
  }
  return best ?? { value: null, evidence: "" };
}

export interface Band {
  min: number;
  max: number;
  currency: "EUR" | "GBP" | "USD";
}

const CUR = String.raw`(€|EUR|£|GBP|\$|USD)`;
const NUM = String.raw`(\d{2,3}(?:[.,]\d{1,3})?)`;
const BAND = new RegExp(String.raw`${CUR}?\s?${NUM}\s?([kK])?\s*${CUR}?\s*(?:[-–—]|to|bis)\s*${CUR}?\s?${NUM}\s?([kK])?\s*${CUR}?`, "g");
const CURRENCY: Record<string, Band["currency"]> = { "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP", $: "USD", USD: "USD" };

const amount = (raw: string, k: boolean): number => {
  // "90,000" / "90.000" are thousands separators; "72.8" is a decimal.
  const thousands = /^\d{2,3}[.,]\d{3}$/.test(raw);
  const n = thousands ? Number(raw.replace(/[.,]/, "")) : Number(raw.replace(",", "."));
  return thousands ? n : k || n < 1000 ? n * 1000 : n;
};

/** First plausible salary range in the published comp field, falling back to the description. */
export function salaryBand(comp: string, text: string): Evidence<Band | null> {
  for (const source of [comp, text]) {
    for (const m of source.matchAll(BAND)) {
      const [, c1, a, k1, c2, c3, b, k2, c4] = m;
      const cur = c1 ?? c2 ?? c3 ?? c4;
      if (!cur || !a || !b) continue;
      const k = Boolean(k1 || k2);
      const band = { min: amount(a, k), max: amount(b, k), currency: CURRENCY[cur]! };
      if (band.min >= 20_000 && band.max <= 600_000 && band.min <= band.max) return { value: band, evidence: m[0].trim() };
    }
  }
  return { value: null, evidence: "" };
}

export type Workplace = "onsite" | "hybrid" | "remote" | "unknown";

export function workplace(field: string, text: string): Evidence<Workplace> {
  const f = field.toLowerCase();
  if (f.includes("onsite") || f.includes("on-site")) return { value: "onsite", evidence: field };
  if (f.includes("hybrid")) return { value: "hybrid", evidence: field };
  if (f.includes("remote")) return { value: "remote", evidence: field };
  for (const [value, re] of [
    ["hybrid", /[^.\n]*\b(hybrid|\d days? (a|per) week in (the )?office)\b[^.\n]*/i],
    ["onsite", /[^.\n]*\b(on-?site role|in-office role|fully on-?site|100% on-?site)\b[^.\n]*/i],
    ["remote", /[^.\n]*\b(fully remote|remote-first|remote within)\b[^.\n]*/i],
  ] as const) {
    const m = text.match(re);
    if (m) return { value, evidence: m[0].trim() };
  }
  return { value: "unknown", evidence: "" };
}

/** LinkedIn's applicant caption as a number: "Over 200 applicants" -> 200, "Be among the first 25" -> 25. */
export const applicantCount = (caption: string): number | null => {
  const n = caption.match(/(\d+)/)?.[1];
  return n ? Number(n) : null;
};
