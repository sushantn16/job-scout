// Read a job's application form and prepare answers: `pnpm form <job-id> [form-url]`. Recorded as a `vet` run.
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { formOne, formSummary } from "../pipeline/form.ts";
import { loadCandidate } from "../vet/candidate.ts";
import { withRun } from "./with-run.ts";

const [id, url] = process.argv.slice(2);
if (!id || !/^[0-9a-f]{16}$/.test(id) || (url && !/^https?:\/\//.test(url))) {
  console.error("usage: pnpm form <job-id> [form-url]");
  process.exit(2);
}
const cfg = loadConfig();
const store = new Store();
await withRun(store, "form", async (runId) => {
  const stage = await formOne(id, store, cfg, loadCandidate(), (r) => store.recordCall(runId, id, r), url);
  const failed = "error" in stage;
  store.event(runId, "form", formSummary(stage), failed ? "warn" : "info", id);
  console.log(formSummary(stage));
  if (!failed) for (const f of stage.fields) console.log(`${f.needsYou ? "!" : " "} ${f.question}: ${f.value ?? f.why}`);
  return { failed, stats: { forms: failed ? 0 : 1 } };
}, id);
