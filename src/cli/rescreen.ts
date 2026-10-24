// Re-apply the hard rules to stored jobs that no LLM stage has touched yet, and refresh what the rules read from
// every other job. Run after editing rules or config.
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { isFresh } from "../filter/freshness.ts";
import { screen } from "../filter/rules.ts";
import { statusFor, type JobStatus } from "../db/store.ts";

const cfg = loadConfig();
const store = new Store();
const UNSCORED: JobStatus[] = ["new", "filtered", "stale"];
const ALL: JobStatus[] = [...UNSCORED, "screened", "needs_review", "apply", "maybe", "skip", "cv_ready", "applied", "interview", "rejected", "dismissed"];
let changed = 0;
let refreshed = 0;
for (const { id, status: before, firstRun, manual, posting } of store.postings(ALL)) {
  const s = screen(posting, cfg);
  // Scored jobs keep their status; only what the rules read is refreshed (e.g. a recruiter badge).
  // A job you added by hand stays queued whatever the rules say: you chose it.
  if (!UNSCORED.includes(before) || manual) {
    store.updateSignals(id, s);
    refreshed++;
    continue;
  }
  // Freshness is judged against the window of the run that first saw the job, not against today.
  const fresh = isFresh(posting.posted, store.runSince(firstRun));
  store.updateScreen(id, s, fresh);
  const after = statusFor(s, fresh);
  if (before !== after) {
    changed++;
    console.log(`${before} → ${after}: ${posting.company} | ${posting.title}${s.rejections[0] ? ` (${s.rejections[0].slice(0, 80)})` : ""}`);
  }
}
const summary = `${changed} job(s) changed status; signals refreshed on ${refreshed} other job(s)`;
console.log(summary);
// Started from the dashboard, its output goes nowhere: leave the result in the event log.
store.event(store.latestRunId(), "dashboard", `re-checked stored jobs: ${summary}`);
