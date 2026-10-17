// Read a job's application form and prepare answers: `pnpm form <job-id> [form-url]`. Recorded as a `vet` run.
import { ensureAwsSession } from "../aws/session.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { formOne, formSummary } from "../pipeline/form.ts";
import { loadCandidate } from "../vet/candidate.ts";

const [id, url] = process.argv.slice(2);
if (!id || !/^[0-9a-f]{16}$/.test(id) || (url && !/^https?:\/\//.test(url))) {
  console.error("usage: pnpm form <job-id> [form-url]");
  process.exit(2);
}
const cfg = loadConfig();
const store = new Store();
const runId = store.startRun(new Date(), "vet");
const aws = await ensureAwsSession((line) => (store.event(runId, "aws", line, "warn"), console.error(line)));
if (!aws.ok) {
  store.event(runId, "form", `skipped: ${aws.detail}`, "error", id);
  store.finishRun(runId, "failed", {});
  console.error(aws.detail);
  process.exit(1);
}
try {
  const stage = await formOne(id, store, cfg, loadCandidate(), (r) => store.recordCall(runId, id, r), url);
  const failed = "error" in stage;
  store.event(runId, "form", formSummary(stage), failed ? "warn" : "info", id);
  store.finishRun(runId, failed ? "failed" : "done", { forms: failed ? 0 : 1 });
  console.log(formSummary(stage));
  if (!failed) for (const f of stage.fields) console.log(`${f.needsYou ? "!" : " "} ${f.question}: ${f.value ?? f.why}`);
} catch (e) {
  store.event(runId, "form", (e as Error).message, "error", id);
  store.finishRun(runId, "failed", {});
  throw e;
}
