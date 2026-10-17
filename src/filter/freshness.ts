// Only postings published since the last successful run are worth vetting: applying early is the advantage.

const HOUR = 3_600_000;

/**
 * Start of the freshness window: the last successful run, but never less than `minHours` ago (a manual re-run
 * still looks back a full day) and never more than `maxHours` ago (a long break doesn't flood the queue).
 * Runs are started by hand, so the window follows the gap since the last run: nothing posted in between is lost.
 */
export function windowStart(now: Date, lastRunStart: Date | null, minHours: number, maxHours: number): Date {
  const earliest = now.getTime() - maxHours * HOUR;
  const latest = now.getTime() - minHours * HOUR;
  const last = lastRunStart?.getTime() ?? latest;
  return new Date(Math.max(earliest, Math.min(last, latest)));
}

/**
 * Whether a posting was published inside the window. Date-only values (LinkedIn) compare by calendar day, so a
 * job posted late on the window's first day still counts. Undated postings count as fresh: the store's
 * de-duplication already guarantees they are new to us.
 */
export function isFresh(posted: string, since: Date): boolean {
  if (!posted) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(posted)) return posted >= since.toISOString().slice(0, 10);
  const t = Date.parse(posted);
  return Number.isNaN(t) || t >= since.getTime();
}
