// Check Gmail for application replies and update job statuses. Recorded as an `inbox` run.
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { processInbox } from "../inbox/process.ts";

const store = new Store();
const runId = store.startRun(new Date(), "inbox");
try {
  const stats = await processInbox(store, loadConfig(), runId);
  store.finishRun(runId, "done", { inbox: stats });
  console.log(stats ? JSON.stringify(stats) : "skipped: JOB_SCOUT_IMAP_USER not set");
} catch (e) {
  store.event(runId, "inbox", (e as Error).message, "error");
  store.finishRun(runId, "failed", {});
  console.error((e as Error).message);
  process.exitCode = 1;
}
