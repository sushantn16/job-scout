// The frame every LLM command shares: a `vet` run row (so the freshness window is unaffected), an AWS session check,
// and a finished row whatever happens. A row left "running" would block the dashboard's Run buttons.
import { ensureAwsSession } from "../aws/session.ts";
import type { Store } from "../db/store.ts";
import type { EventStage } from "../pipeline/stages.ts";

export async function withRun(
  store: Store,
  stage: EventStage,
  body: (runId: number) => Promise<{ failed?: boolean; stats: object }>,
  jobId?: string,
): Promise<void> {
  const runId = store.startRun(new Date(), "vet");
  try {
    const aws = await ensureAwsSession((line) => (store.event(runId, "aws", line, "warn"), console.error(line)));
    if (!aws.ok) {
      store.event(runId, stage, `skipped: ${aws.detail}`, "error", jobId);
      store.finishRun(runId, "failed", {});
      console.error(aws.detail);
      process.exitCode = 1;
      return;
    }
    const { failed, stats } = await body(runId);
    store.finishRun(runId, failed ? "failed" : "done", stats);
  } catch (e) {
    store.event(runId, stage, (e as Error).stack ?? String(e), "error", jobId);
    store.finishRun(runId, "failed", {});
    throw e;
  }
}
