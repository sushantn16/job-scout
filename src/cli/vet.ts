// Run the LLM stages over the queue without fetching. Recorded as a `vet` run so the freshness window is unaffected.
// `pnpm vet <id>…` scores only those queued jobs (the dashboard does this for a job you add by hand).
import { ensureAwsSession } from "../aws/session.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { printVetDigest, processQueue } from "../pipeline/process.ts";
import { loadCandidate } from "../vet/candidate.ts";

const cfg = loadConfig();
const store = new Store();
const runId = store.startRun(new Date(), "vet");
const aws = await ensureAwsSession((line) => (store.event(runId, "aws", line, "warn"), console.error(line)));
if (!aws.ok) {
  store.event(runId, "vet", `skipped: ${aws.detail}`, "error");
  store.finishRun(runId, "failed", {});
  console.error(aws.detail);
  process.exit(1);
}
try {
  const { stats, jobs } = await processQueue(store, cfg, runId, loadCandidate(), process.argv.slice(2).length ? process.argv.slice(2) : undefined);
  store.finishRun(runId, "done", stats);
  console.log(`Run ${runId}: ${JSON.stringify(stats)}`);
  printVetDigest(jobs);
} catch (e) {
  store.event(runId, "run", (e as Error).stack ?? String(e), "error");
  store.finishRun(runId, "failed", {});
  throw e;
}
