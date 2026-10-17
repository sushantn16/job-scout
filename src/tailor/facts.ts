// The validator that keeps tailored text honest. Deterministic: tailored output may reorder, select and reword facts
// from the master CV, but may not introduce a number, technology or name the fact bank (plus, for application text,
// the cited company research) doesn't contain.

/** Numbers as claims: "€90K", "40", "60%", "2M", "30%+" normalized to compare across formats. */
const NUMBER = /[€$£]?\d+(?:[.,]\d+)?\s?(?:%|k\b|K\b|M\b|m\b|x\b|×)?\+?/g;
const normNumber = (s: string) => s.toLowerCase().replace(/\s|\+/g, "").replace(/,(?=\d{3}\b)/g, "");

export const numbers = (text: string): string[] => [...text.matchAll(NUMBER)].map((m) => normNumber(m[0])).filter((n) => /\d/.test(n));

// Words that carry no factual claim even when capitalized mid-sentence.
const GENERIC = new Set(["i", "i'm", "i've", "i'd", "ai", "llm", "llms", "api", "apis", "ui", "ux", "cv", "ceo", "cto", "the", "a", "an", "and", "my", "your", "our", "we", "you"]);

/**
 * Terms that would be factual claims: capitalized words not at a sentence start, and tokens with digits or tech
 * punctuation (Next.js, CI/CD). Lower-case terms that appear in `alsoCheck` (e.g. the job's tech stack) count too,
 * so "kubernetes" can't slip in lower-case.
 */
export function terms(text: string, alsoCheck: string[] = []): string[] {
  const out = new Set<string>();
  const stack = new Set(alsoCheck.map((t) => t.toLowerCase()));
  for (const sentence of text.replace(/\*\*/g, "").split(/(?<=[.!?:])\s+|\n+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((raw, i) => {
      const word = raw.replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/g, "").replace(/['’]s$/, "");
      // Check the parts of compounds separately: "TypeScript/React" and "AI-visibility" are fine when each part is.
      // Tech names that contain the separators themselves (Next.js, CI/CD, C++) are kept whole.
      const parts = /^[A-Za-z]+(?:[/-][A-Za-z]+)+$/.test(word) && !/^ci\/cd$/i.test(word) ? word.split(/[/-]/) : [word];
      parts.forEach((w) => {
        if (!w || GENERIC.has(w.toLowerCase())) return;
        const techy = /\d|[./+#]/.test(w) && /[a-z]/i.test(w);
        const capital = (i > 0 || parts.length > 1) && /[A-Z]/.test(w);
        if (techy || capital || stack.has(w.toLowerCase())) out.add(w);
      });
    });
  }
  return [...out];
}

export interface Violation {
  where: string;
  problem: string;
}

/** Lower-cased reference text that a term must occur in. */
export class Corpus {
  private readonly text: string;
  private readonly nums: Set<string>;
  constructor(parts: string[]) {
    this.text = parts.join("\n").replace(/\*\*/g, "").toLowerCase();
    this.nums = new Set(parts.flatMap(numbers));
  }
  hasTerm(term: string): boolean {
    return this.text.includes(term.toLowerCase());
  }
  hasNumber(n: string): boolean {
    return this.nums.has(n);
  }
}

/** Check one piece of text: its numbers against `numberSource`, its terms against `termSource`. */
export function check(where: string, text: string, numberSource: Corpus, termSource: Corpus, techStack: string[] = []): Violation[] {
  const v: Violation[] = [];
  for (const n of new Set(numbers(text))) if (!numberSource.hasNumber(n)) v.push({ where, problem: `number "${n}" is not in the source facts` });
  for (const t of terms(text, techStack)) if (!termSource.hasTerm(t)) v.push({ where, problem: `"${t}" is not in the source facts` });
  return v;
}
