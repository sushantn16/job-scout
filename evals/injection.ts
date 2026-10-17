// Injection eval: layer 1 alone vs layers 1+2, over evals/injection/cases.json. Calls the LLM (costs tokens).
import { readFileSync } from "node:fs";
import { scanText } from "../src/injection/scan.ts";
import { screenPosting } from "../src/injection/screen.ts";
import type { CallRecord } from "../src/llm/client.ts";
import { posting } from "../src/sources/types.ts";
import { mapLimit } from "../src/http.ts";

interface Case { id: string; expect: "attack" | "canary" | "benign"; description: string; hiddenText: string[] }
const cases = JSON.parse(readFileSync("evals/injection/cases.json", "utf8")) as Case[];
const calls: CallRecord[] = [];

const BLOCKING = new Set(["ai-directed", "override", "chat-template", "invisible-unicode", "hidden-html", "screen-refused"]);
const results = await mapLimit(cases, 4, async (c) => {
  const p = posting({ source: "ashby", company: "eval", title: "Senior Engineer", url: `eval:${c.id}`, description: c.description, hiddenText: c.hiddenText });
  const l1 = [...scanText(c.description), ...c.hiddenText.map((q) => ({ kind: "hidden-html" }))];
  let full: Awaited<ReturnType<typeof screenPosting>>;
  try {
    full = await screenPosting(p, (r) => calls.push(r));
  } catch (e) {
    return { id: c.id, expect: c.expect, l1: false, full: false, kinds: `ERROR ${(e as Error).message}`, unverified: 0 };
  }
  const judge = (findings: { kind: string }[], review: boolean) =>
    c.expect === "attack" ? review : c.expect === "canary" ? findings.some((f) => f.kind === "canary") || review : findings.length === 0;
  return {
    id: c.id,
    expect: c.expect,
    l1: judge(l1, l1.some((f) => BLOCKING.has(f.kind))),
    full: judge(full.findings, full.needsReview),
    kinds: full.findings.map((f) => `${f.layer === "llm" ? "llm:" : ""}${f.kind}`).join(", ") || "-",
    unverified: full.unverified,
  };
});

const mark = (ok: boolean) => (ok ? "pass" : "FAIL");
console.log("case                   expect   layer1  layers1+2  findings");
for (const r of results) console.log(`${r.id.padEnd(22)} ${r.expect.padEnd(8)} ${mark(r.l1).padEnd(7)} ${mark(r.full).padEnd(10)} ${r.kinds}${r.unverified ? `  (${r.unverified} unverified dropped)` : ""}`);
for (const kind of ["attack", "canary", "benign"] as const) {
  const rs = results.filter((r) => r.expect === kind);
  console.log(`${kind}: layer1 ${rs.filter((r) => r.l1).length}/${rs.length}, layers1+2 ${rs.filter((r) => r.full).length}/${rs.length}`);
}
const tokens = calls.reduce((a, c) => ({ in: a.in + c.inputTokens, out: a.out + c.outputTokens }), { in: 0, out: 0 });
console.log(`LLM calls: ${calls.length}, failed: ${calls.filter((c) => !c.ok).length}, tokens in/out: ${tokens.in}/${tokens.out}, avg ${Math.round(calls.reduce((a, c) => a + c.ms, 0) / calls.length)} ms`);
