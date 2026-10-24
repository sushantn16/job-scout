// The board's sort orders. Plain TypeScript with no runtime imports, so the Node tests can load it too.
import type { JobRow } from "./api";

export const SORTS = [
  { id: "score", label: "Best score" },
  { id: "newest", label: "Newest" },
  { id: "salary", label: "Salary" },
  { id: "company", label: "Company A–Z" },
] as const;
export type SortId = (typeof SORTS)[number]["id"];

type Sortable = Pick<JobRow, "companyName" | "title" | "score" | "posted" | "first_seen" | "applied_at" | "bandTopEur">;

/** Once you've applied, when you applied matters more than when the job was posted, as on the card. */
const when = (j: Sortable) => {
  for (const d of [j.applied_at, j.posted, j.first_seen]) {
    const t = d ? Date.parse(d) : NaN;
    if (!Number.isNaN(t)) return t;
  }
  return 0;
};
/** Highest first, jobs without a value last. */
const desc = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a);
const byScore = (a: Sortable, b: Sortable) => desc(a.score, b.score);

const ORDER: Record<SortId, (a: Sortable, b: Sortable) => number> = {
  score: byScore,
  newest: (a, b) => when(b) - when(a) || byScore(a, b),
  salary: (a, b) => desc(a.bandTopEur, b.bandTopEur) || byScore(a, b),
  company: (a, b) => a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" }) || a.title.localeCompare(b.title),
};

export const sortJobs = <T extends Sortable>(jobs: T[], by: SortId): T[] => [...jobs].sort(ORDER[by]);
export const isSortId = (s: string | null): s is SortId => SORTS.some((o) => o.id === s);
