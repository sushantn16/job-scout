// Re-apply the hard rules to stored jobs that no LLM stage has touched yet. Run after editing rules or config.
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { isFresh } from "../filter/freshness.ts";
import { screen } from "../filter/rules.ts";
import { statusFor } from "../db/store.ts";

const cfg = loadConfig();
const store = new Store();
let changed = 0;
// Freshness is judged against the window of the run that first saw the job, not against today.
for (const { id, status: before, firstRun, manual, posting } of store.postings(["new", "filtered", "stale"])) {
  // A job you added by hand stays queued whatever the rules say: you chose it.
  if (manual) continue;
  const s = screen(posting, cfg);
  const fresh = isFresh(posting.posted, store.runSince(firstRun));
  store.updateScreen(id, s, fresh);
  const after = statusFor(s, fresh);
  if (before !== after) {
    changed++;
    console.log(`${before} → ${after}: ${posting.company} | ${posting.title}${s.rejections[0] ? ` (${s.rejections[0].slice(0, 80)})` : ""}`);
  }
}
console.log(`${changed} job(s) changed status`);
