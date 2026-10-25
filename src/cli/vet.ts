// Run the LLM stages over the queue without fetching. Recorded as a `vet` run so the freshness window is unaffected.
// `pnpm vet <id>…` scores only those queued jobs (the dashboard does this for a job you add by hand).
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { printVetDigest, processQueue } from "../pipeline/process.ts";
import { loadCandidate } from "../vet/candidate.ts";
import { withRun } from "./with-run.ts";

const cfg = loadConfig();
const store = new Store();
const ids = process.argv.slice(2);
await withRun(store, "vet", async (runId) => {
  const { stats, jobs } = await processQueue(store, cfg, runId, loadCandidate(), ids.length ? ids : undefined);
  console.log(`Run ${runId}: ${JSON.stringify(stats)}`);
  printVetDigest(jobs);
  // Nested like a scan's stats, so the dashboard reads both the same way.
  return { stats: { vet: stats } };
});
