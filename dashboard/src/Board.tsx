import type { JobRow, Status } from "./api";
import { ago, euro } from "./api";
import { Pill, StatusPill, statusLabel } from "./ui";

const COLUMNS: { title: string; statuses: Status[] }[] = [
  { title: "Needs review", statuses: ["needs_review"] },
  { title: "Ready to apply", statuses: ["cv_ready", "apply"] },
  { title: "Maybe", statuses: ["maybe"] },
  { title: "Applied", statuses: ["applied"] },
  { title: "Interview", statuses: ["interview"] },
];

function JobCard({ job, open }: { job: JobRow; open: (id: string) => void }) {
  const meta = [job.workplace && job.workplace !== "unknown" ? job.workplace : null, job.bandTopEur ? `to ${euro(job.bandTopEur)}` : null, job.posted ? ago(job.posted) : null].filter(Boolean);
  return (
    <button
      onClick={() => open(job.id)}
      className="grid w-full cursor-pointer gap-1 rounded-[9px] border border-line bg-surface px-3 py-2.5 text-left text-ink hover:border-axis hover:bg-hover focus-visible:border-axis focus-visible:bg-hover focus-visible:outline-none"
    >
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{job.companyName}</span>
        {job.score != null ? <span className="font-semibold tabular-nums">{job.score}</span> : null}
      </div>
      <div className="text-[13px] text-ink-2">{job.title}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {job.status === "apply" ? <StatusPill status="apply" /> : null}
        {job.flagged ? <Pill tone="warning">AI-directed text</Pill> : null}
        {meta.map((m) => <span key={m}>{m}</span>)}
      </div>
    </button>
  );
}

export function Board({ jobs, open }: { jobs: JobRow[]; open: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 items-start gap-3 xl:grid-cols-5">
      {COLUMNS.map((c) => {
        const list = jobs.filter((j) => c.statuses.includes(j.status));
        return (
          <div className="grid gap-2" key={c.title}>
            <header className="flex justify-between px-0.5 text-[12.5px] font-semibold text-ink-2">
              <span>{c.title}</span>
              <span>{list.length}</span>
            </header>
            {list.length ? list.map((j) => <JobCard key={j.id} job={j} open={open} />) : <div className="px-0.5 py-1.5 text-[12.5px] text-muted">Nothing here</div>}
          </div>
        );
      })}
    </div>
  );
}

export const th = "border-b border-grid px-2 py-1.5 text-left font-medium text-muted";
export const td = "border-b border-grid px-2 py-1.5 align-top";

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
            <td className={td}>{j.companyName}</td>
            <td className={td}>{j.title}</td>
            <td className={td}><StatusPill status={j.status} /></td>
            <td className={`${td} text-right tabular-nums`}>{j.score ?? "–"}</td>
            <td className={td}>{euro(j.bandTopEur)}</td>
            <td className={`${td} text-muted`}>{j.posted ? ago(j.posted) : "–"}</td>
            <td className={`${td} text-muted`}>{j.rejection ?? j.summary ?? (j.status === "stale" ? "Posted before the freshness window" : statusLabel(j.status))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
