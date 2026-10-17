// Rank a fixed set of stored jobs with the full LLM pipeline, without changing their status. Shows each factor of the
// formula so the ranking can be checked line by line. Usage: pnpm eval:ranking [ids.json] [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { companyKey, Store } from "../src/db/store.ts";
import { screen } from "../src/filter/rules.ts";
import { mapLimit } from "../src/http.ts";
import { redact, screenPosting } from "../src/injection/screen.ts";
import type { CallRecord } from "../src/llm/client.ts";
import { researchCompany, type CompanyProfile } from "../src/research/profile.ts";
import { loadCandidate } from "../src/vet/candidate.ts";
import { vetJob, type VetResult } from "../src/vet/vet.ts";

const cfg = loadConfig();
const store = new Store();
const candidate = loadCandidate();
const ids = (JSON.parse(readFileSync(process.argv[2] ?? "data/private/evals/vetting-candidates.json", "utf8")) as { id: string }[]).map((x) => x.id);
const runId = store.startRun(new Date(), "vet");
const calls: CallRecord[] = [];
const research = new Map<string, Promise<CompanyProfile | null>>();

const rows = await mapLimit(ids, 4, async (id) => {
  const p = store.posting(id);
  if (!p) return { id, error: "not found" };
  const record = (r: CallRecord) => (calls.push(r), store.recordCall(runId, id, r));
  try {
    const screened = await screenPosting(p, record);
    const description = redact(p.description, screened.findings);
    const key = companyKey(p.company);
    const name = cfg.companyNames[p.company] ?? p.company;
    if (!research.has(key)) {
      const cached = store.company(key, 30) as CompanyProfile | null;
      research.set(key, cached ? Promise.resolve(cached) : researchCompany({ name, slug: ["linkedin", "hn"].includes(p.source) ? undefined : p.company, postingText: description, postingUrl: p.url }, record)
        .then((profile) => (store.saveCompany(key, name, profile), profile)).catch(() => null));
    }
    const vet = await vetJob({ candidate, posting: p, description, signals: screen(p, cfg).signals, company: await research.get(key)!, cfg }, record);
    return { id, company: name, title: p.title, flagged: screened.needsReview, vet };
  } catch (e) {
    return { id, company: p.company, title: p.title, error: (e as Error).message };
  }
});
store.finishRun(runId, "done", { ranking: rows.length });
writeFileSync(process.argv[3] ?? "out/ranking.json", JSON.stringify(rows, null, 2));

const ok = rows.filter((r): r is { id: string; company: string; title: string; flagged: boolean; vet: VetResult } => "vet" in r && !!r.vet);
ok.sort((a, b) => b.vet.fitScore - a.vet.fitScore);
const short: Record<string, string> = { "role fit": "role", "stack overlap": "stack", seniority: "senior", "AI relevance": "AI", "funding & outlook": "fund", "engineering culture": "cult", "English-first": "eng", "pay band": "pay", competition: "comp", remote: "rem" };
console.log(`${"#".padStart(2)} ${"score".padStart(5)} ${"verdict".padEnd(8)} ${"company".padEnd(16)} ${"title".padEnd(44)} factors (points)`);
ok.forEach((r, i) =>
  console.log(
    `${String(i + 1).padStart(2)} ${String(r.vet.fitScore).padStart(5)} ${(r.flagged ? "review" : r.vet.decision).padEnd(8)} ${r.company.slice(0, 16).padEnd(16)} ${r.title.slice(0, 44).padEnd(44)} ` +
      r.vet.factors.map((f) => `${short[f.factor] ?? f.factor} ${f.points}`).join(" · ") +
      (r.vet.gaps.some((g) => g.severity === "blocker") ? `  BLOCKER: ${r.vet.gaps.find((g) => g.severity === "blocker")!.point.slice(0, 80)}` : ""),
  ),
);
for (const r of rows.filter((r) => "error" in r)) console.log(`ERROR ${r.id}: ${(r as { error: string }).error.slice(0, 200)}`);
const t = calls.reduce((a, c) => ({ i: a.i + c.inputTokens, cr: a.cr + c.cacheReadTokens, cw: a.cw + c.cacheWriteTokens, o: a.o + c.outputTokens }), { i: 0, cr: 0, cw: 0, o: 0 });
console.log(`\nLLM calls ${calls.length} (failed ${calls.filter((c) => !c.ok).length}); tokens in ${t.i}, cache read ${t.cr}, cache write ${t.cw}, out ${t.o}`);
