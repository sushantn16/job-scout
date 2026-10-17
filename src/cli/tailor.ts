// Tailor "apply" jobs (up to caps.tailorPerRun) without fetching or vetting. Recorded as a `vet` run.
import { ensureAwsSession } from "../aws/session.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { processTailoring } from "../pipeline/tailoring.ts";
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
const outcomes = await processTailoring(store, cfg, runId, loadCandidate());
store.finishRun(runId, outcomes.some((o) => o.error) ? "failed" : "done", { tailored: outcomes.filter((o) => !o.error).length });
for (const o of outcomes) console.log(o.error ? `ERROR ${o.id}: ${o.error}` : `${o.dir}${o.needsEdit ? `  (${o.needsEdit} claim(s) need an edit)` : ""}`);
