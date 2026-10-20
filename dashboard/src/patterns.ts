// Filter patterns as the Preferences page edits them: a pattern's top-level alternatives become one line each, and
// place names become a location pattern. Plain TypeScript with no imports, so the Node tests can load it too.

/** A pattern's top-level alternatives, one per line: "a|b(c|d)" is ["a", "b(c|d)"]. */
export function terms(pattern: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cls = false;
  let cur = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\") {
      cur += ch + (pattern[++i] ?? "");
      continue;
    }
    if (cls) cls = ch !== "]";
    else if (ch === "[") cls = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "|" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  return [...out, cur].map((t) => t.trim()).filter(Boolean);
}
export const joinTerms = (lines: string) => lines.split("\n").map((t) => t.trim()).filter(Boolean).join("|");
export const lines = (xs: string[]) => xs.join("\n");
export const unlines = (s: string) => s.split("\n").map((t) => t.trim()).filter(Boolean);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A location pattern for place names. Lookarounds instead of \b, which fails next to letters like ö. */
export const placePattern = (names: string[]) => `(?<![a-z])(?:${names.map((n) => escape(n.toLowerCase())).join("|")})(?![a-z])`;

