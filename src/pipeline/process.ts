// LLM stages over the queue: screen → redact → research (cached per company) → vet. Up to 4 jobs in flight.
import type { Config } from "../config.ts";
import { companyKey, type JobStatus, type Store } from "../db/store.ts";
import { screen } from "../filter/rules.ts";
import { mapLimit } from "../http.ts";
import { redact, screenPosting } from "../injection/screen.ts";
import type { CallRecord } from "../llm/client.ts";
import { researchCompany, type CompanyProfile } from "../research/profile.ts";
import type { Posting } from "../sources/types.ts";
import type { Candidate } from "../vet/candidate.ts";
import { vetJob, type VetResult } from "../vet/vet.ts";

const RESEARCH_MAX_AGE_DAYS = 30;

export interface ProcessStats {
  processed: number;
  apply: number;
  maybe: number;
  skip: number;
  needsReview: number;
  errors: number;
}

export interface Processed {
  id: string;
  posting: Posting;
  status: JobStatus;
  vet?: VetResult;
  findings: number;
  error?: string;
}

/** `ids` limits the run to those queued jobs (a job you just added), instead of the best of the whole queue. */
export async function processQueue(store: Store, cfg: Config, runId: number, candidate: Candidate, ids?: string[]): Promise<{ stats: ProcessStats; jobs: Processed[] }> {
  const queue = store.queue(cfg.caps.vetPerRun, ids);
  store.event(runId, "vet", `${queue.length} job(s) queued for screening and vetting`);
  // One research call per company per run, even when several of its jobs are in flight at once.
  const inflight = new Map<string, Promise<CompanyProfile | null>>();

  const companyProfile = (p: Posting, description: string, record: (r: CallRecord) => void): Promise<CompanyProfile | null> => {
    const key = companyKey(p.company);
    const cached = store.company(key, RESEARCH_MAX_AGE_DAYS) as CompanyProfile | null;
    if (cached) return Promise.resolve(cached);
    if (!inflight.has(key)) {
      const name = cfg.companyNames[p.company] ?? p.company;
      inflight.set(key, researchCompany({ name, slug: ["linkedin", "hn", "manual"].includes(p.source) ? undefined : p.company, postingText: description, postingUrl: p.url }, record)
        .then((profile) => (store.saveCompany(key, name, profile), profile))
        .catch((e: Error) => (store.event(runId, "research", `${name}: ${e.message}`, "warn"), null)));
    }
    return inflight.get(key)!;
  };

  const jobs = await mapLimit(queue, 4, async ({ id, posting }): Promise<Processed> => {
    const record = (r: CallRecord) => store.recordCall(runId, id, r);
    try {
      const screened = await screenPosting(posting, record);
      store.saveStage(id, "screen", screened);
      if (screened.findings.length) store.event(runId, "screen", `${screened.findings.length} finding(s): ${screened.findings.map((f) => f.kind).join(", ")}`, screened.needsReview ? "warn" : "info", id);
      const description = redact(posting.description, screened.findings);

      const company = await companyProfile(posting, description, record);
      store.setCompanyKey(id, companyKey(posting.company));
      const vet = await vetJob({ candidate, posting, description, signals: screen(posting, cfg).signals, company, cfg }, record);
      const status: JobStatus = screened.needsReview ? "needs_review" : vet.decision;
      store.saveStage(id, "vet", vet, status);
      store.event(runId, "vet", `${vet.decision} (${vet.fitScore}): ${vet.summary}`, "info", id);
      return { id, posting, status, vet, findings: screened.findings.length };
    } catch (e) {
      // Leave the job in `new` so the next run retries it.
      store.event(runId, "vet", `failed: ${(e as Error).message}`, "error", id);
      return { id, posting, status: "new", findings: 0, error: (e as Error).message };
    }
  });

  const count = (s: JobStatus) => jobs.filter((j) => j.status === s).length;
  const stats = { processed: jobs.length, apply: count("apply"), maybe: count("maybe"), skip: count("skip"), needsReview: count("needs_review"), errors: jobs.filter((j) => j.error).length };
  store.event(runId, "vet", `done: ${JSON.stringify(stats)}`);
  return { stats, jobs };
}

export function printVetDigest(jobs: Processed[]): void {
  const order: JobStatus[] = ["apply", "needs_review", "maybe", "skip", "new"];
  console.log("\nVetted:");
  for (const j of [...jobs].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.vet?.fitScore ?? 0) - (a.vet?.fitScore ?? 0))) {
    const tag = j.error ? "ERROR" : j.status;
    console.log(`  ${tag.padEnd(12)} ${String(j.vet?.fitScore ?? "").padStart(3)}  ${j.posting.company.slice(0, 18).padEnd(18)} ${j.posting.title.slice(0, 50).padEnd(50)} ${j.error ?? j.vet?.summary.slice(0, 110) ?? ""}`);
  }
}
