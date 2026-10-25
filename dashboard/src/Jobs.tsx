import { useState } from "react";
import type { JobRow, Status } from "./api";
import { ago, euro } from "./api";
import { Button, Card, cx, StatusPill, statusLabel, td, th } from "./ui";

/** Status groups for the filter chips; `null` is every job. */
const GROUPS: { id: string; label: string; statuses: Status[] | null }[] = [
  { id: "all", label: "All", statuses: null },
  { id: "active", label: "Active", statuses: ["needs_review", "apply", "cv_ready", "applied", "interview"] },
  { id: "maybe", label: "Maybe", statuses: ["maybe"] },
  { id: "skip", label: "Skipped", statuses: ["skip"] },
  { id: "queued", label: "Queued", statuses: ["new"] },
  { id: "filtered", label: "Filtered out", statuses: ["filtered"] },
  { id: "stale", label: "Older", statuses: ["stale"] },
  { id: "closed", label: "Closed", statuses: ["rejected", "dismissed"] },
];
const PAGE = 50;

/** Every job, including skipped, filtered and older ones, with the reason each ended where it did. */
export function JobTable({ jobs, open }: { jobs: JobRow[]; open: (id: string) => void }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          {["Company", "Role", "Status", "Score", "Band", "Posted", "Why"].map((h) => <th key={h} className={h === "Score" ? `${th} text-right` : th}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="cursor-pointer hover:bg-hover" onClick={() => open(j.id)}>
            <td className={`${td} font-semibold`}>{j.companyName}</td>
            <td className={td}><a href={`#/job/${j.id}`} className="text-ink" onClick={(e) => e.stopPropagation()}>{j.title}</a></td>
            <td className={td}><StatusPill status={j.status} /></td>
            <td className={`${td} text-right tabular-nums`}>{j.score ?? "–"}</td>
            <td className={`${td} whitespace-nowrap`}>{euro(j.bandTopEur)}</td>
            <td className={`${td} whitespace-nowrap text-muted`}>{j.posted ? ago(j.posted) : "–"}</td>
            <td className={`${td} max-w-[420px] text-muted`}>
              <span className="line-clamp-2">{j.rejection ?? j.summary ?? (j.status === "stale" ? "Posted before the freshness window" : statusLabel(j.status))}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AllJobs({ jobs, open }: { jobs: JobRow[]; open: (id: string) => void }) {
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const inGroup = (g: (typeof GROUPS)[number]) => (g.statuses ? jobs.filter((j) => g.statuses!.includes(j.status)) : jobs);
  const needle = q.trim().toLowerCase();
  const shown = inGroup(GROUPS.find((g) => g.id === group)!).filter((j) => !needle || `${j.companyName} ${j.title}`.toLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  // The list refreshes every few seconds and can shrink under you: stay on the last page that still exists.
  const at = Math.min(page, pages - 1);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {GROUPS.map((g) => {
            const n = inGroup(g).length;
            return (
              <button
                key={g.id}
                aria-pressed={group === g.id}
                onClick={() => (setGroup(g.id), setPage(0))}
                className={cx(
                  "cursor-pointer rounded-full border px-2.5 py-0.5 text-[12.5px]",
                  group === g.id ? "border-accent bg-accent text-white" : "border-line bg-raised text-ink-2 hover:bg-hover",
                )}
              >
                {g.label} <span className={cx("tabular-nums", group === g.id ? "text-white/80" : "text-muted")}>{n}</span>
              </button>
            );
          })}
        </div>
        <span className="flex-1" />
        <input
          type="search"
          value={q}
          onChange={(e) => (setQ(e.target.value), setPage(0))}
          placeholder="Search company or role"
          aria-label="Search company or role"
          className="w-64 rounded-md border border-line bg-raised px-2 py-1 text-ink"
        />
      </div>
      {shown.length ? <JobTable jobs={shown.slice(at * PAGE, (at + 1) * PAGE)} open={open} /> : <p className="m-0 text-muted">No jobs match.</p>}
      {pages > 1 ? (
        <nav className="mt-3 flex items-center justify-end gap-2 text-[13px] text-muted" aria-label="Pages">
          <span className="tabular-nums">{at * PAGE + 1}–{Math.min(shown.length, (at + 1) * PAGE)} of {shown.length}</span>
          <Button size="sm" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</Button>
          <Button size="sm" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>Next</Button>
        </nav>
      ) : null}
    </Card>
  );
}
