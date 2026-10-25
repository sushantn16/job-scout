// Set a job's status by company and title fragment, e.g. `pnpm mark langdock "product engineer" applied`.
import { Store, type JobStatus } from "../db/store.ts";
import { JOB_STATUSES } from "../shared/status.ts";

const STATUSES: readonly JobStatus[] = JOB_STATUSES;
const [company, title, status] = process.argv.slice(2);
if (!company || !title || !STATUSES.includes(status as JobStatus)) {
  console.error(`usage: pnpm mark <company> <title fragment> <${STATUSES.join("|")}>`);
  process.exit(2);
}
const store = new Store();
const matches = store.find(company, title);
if (matches.length !== 1) {
  console.error(matches.length ? `ambiguous, ${matches.length} matches:` : "no match");
  for (const m of matches) console.error(`  ${m.company} | ${m.title} (${m.status})`);
  process.exit(1);
}
store.setStatus(matches[0]!.id, status as JobStatus);
console.log(`${matches[0]!.company} | ${matches[0]!.title}: ${matches[0]!.status} → ${status}`);
