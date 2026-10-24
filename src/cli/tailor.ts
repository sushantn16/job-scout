// Tailor "apply" jobs (up to caps.tailorPerRun) without fetching or vetting. Recorded as a `vet` run.
// `pnpm tailor <id>…` tailors only those jobs (the dashboard's "Tailor now" does this).
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { processTailoring } from "../pipeline/tailoring.ts";
import { loadCandidate } from "../vet/candidate.ts";
import { withRun } from "./with-run.ts";

const cfg = loadConfig();
const store = new Store();
const ids = process.argv.slice(2);
await withRun(store, "tailor", async (runId) => {
  const outcomes = await processTailoring(store, cfg, runId, loadCandidate(), ids.length ? ids : undefined);
  for (const o of outcomes) console.log(o.error ? `ERROR ${o.id}: ${o.error}` : `${o.dir}${o.needsEdit ? `  (${o.needsEdit} claim(s) need an edit)` : ""}`);
  return { failed: outcomes.some((o) => o.error), stats: { tailored: outcomes.filter((o) => !o.error).length } };
});
