// Company research with the model in JOB_SCOUT_MODEL_RESEARCH vs the cached profile (the earlier Opus run).
// Usage: node --env-file=.env evals/research-compare.ts <label> <companyKey>...
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db/store.ts";
import type { CallRecord } from "../src/llm/client.ts";
import { researchCompany, type CompanyProfile } from "../src/research/profile.ts";

const [label = "model", ...keys] = process.argv.slice(2);
const cfg = loadConfig();
const store = new Store();
const summary = (p: CompanyProfile) => ({
  stage: p.stage,
  funding: p.funding.length,
  culture: p.engineeringCulture.length,
  redFlags: p.redFlags.length,
  whyUs: p.whyUsMaterial.length,
  language: p.workingLanguage,
  dropped: p.droppedClaims,
  cited: [...new Set([...p.funding, ...p.engineeringCulture, ...p.whyUsMaterial].map((c) => new URL(c.sourceUrl).hostname))].join(" "),
});
for (const key of keys) {
  const opus = store.company(key, 365) as CompanyProfile | null;
  const job = store.postings(["stale", "new", "cv_ready", "maybe", "skip", "applied", "needs_review", "apply"]).find((j) => j.posting.company.toLowerCase().replace(/[^a-z0-9]/g, "") === key);
  if (!opus || !job) { console.log(`${key}: no cached profile or posting`); continue; }
  const calls: CallRecord[] = [];
  const name = cfg.companyNames[job.posting.company] ?? job.posting.company;
  const p = await researchCompany({ name, slug: ["linkedin", "hn"].includes(job.posting.source) ? undefined : job.posting.company, postingText: job.posting.description, postingUrl: job.posting.url }, (r) => calls.push(r));
  const c = calls[0]!;
  console.log(`\n## ${name}\n  opus  : ${JSON.stringify(summary(opus))}\n  ${label.padEnd(6)}: ${JSON.stringify(summary(p))}  (${c.model}, ${(c.ms / 1000).toFixed(1)}s, in ${c.inputTokens} out ${c.outputTokens})`);
  console.log(`  opus  one-liner: ${opus.oneLiner}\n  ${label.padEnd(6)}one-liner: ${p.oneLiner}`);
  console.log(`  ${label} funding: ${p.funding.map((f) => f.text).join(" | ").slice(0, 300)}`);
  console.log(`  ${label} why-us: ${p.whyUsMaterial.slice(0, 3).map((f) => f.text).join(" | ").slice(0, 400)}`);
}
