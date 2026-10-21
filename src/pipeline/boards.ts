// After scoring: find the jobs seen only on LinkedIn, HN or a pasted link on their company's own board. A job found
// there gets its own posting's URL, which the form reader can follow, and the board is scanned from the next run on.
// Each company is checked once a month, and a known board is re-read only to match a new job of the same company.
import { companyKey, type Store } from "../db/store.ts";
import { mapLimit } from "../http.ts";
import { ATS } from "../sources/ats.ts";
import { findBoard, sameJob } from "../sources/discover.ts";
import type { Posting } from "../sources/types.ts";

const RECHECK_DAYS = 30;
/** Companies probed per run: up to 12 requests each (3 slugs × 4 boards), so a backlog spreads over a few runs. */
const PER_RUN = 15;

/** `fetched` holds this run's postings per board ("ashby/linear"), so a board scanned already isn't fetched again. */
export async function discoverBoards(store: Store, runId: number, fetched = new Map<string, Posting[]>()): Promise<{ checked: number; found: number; matched: number }> {
  const byCompany = new Map<string, { id: string; company: string; title: string }[]>();
  for (const j of store.boardCandidates()) {
    const key = companyKey(j.company);
    if (store.board(key, RECHECK_DAYS) === null) continue;
    byCompany.set(key, [...(byCompany.get(key) ?? []), j]);
  }
  const companies = [...byCompany].slice(0, PER_RUN);
  let found = 0;
  let matched = 0;
  await mapLimit(companies, 4, async ([key, jobs]) => {
    const company = jobs[0]!.company;
    try {
      // A known board: match these jobs against it. Unknown: probe likely slugs with the first job's title.
      const known = store.board(key, RECHECK_DAYS);
      let board: { kind: keyof typeof ATS; slug: string };
      let postings: Posting[];
      if (known) {
        board = known;
        postings = fetched.get(`${known.kind}/${known.slug}`) ?? (await ATS[known.kind](known.slug));
      } else {
        const f = await findBoard(company, jobs[0]!.title);
        store.saveBoard(key, company, f ? { kind: f.kind, slug: f.slug } : null);
        if (!f) return;
        found++;
        board = f;
        postings = f.postings;
      }
      for (const j of jobs) {
        const own = sameJob(postings, j.title);
        if (!own) continue;
        store.setBoardUrl(j.id, own.url);
        matched++;
        store.event(runId, "boards", `${company}: own posting on ${board.kind}/${board.slug}`, "info", j.id);
      }
    } catch (e) {
      store.event(runId, "boards", `${company}: ${(e as Error).message}`, "warn");
    }
  });
  const stats = { checked: companies.length, found, matched };
  if (companies.length) store.event(runId, "boards", `${stats.checked} compan${stats.checked === 1 ? "y" : "ies"} checked: ${found} new board(s), ${matched} job(s) matched to their own posting`);
  return stats;
}
