// The board: one column per stage, best score first unless you pick another order. Drag a card to the next stage to
// change its status, or onto the dismiss bar that appears while dragging; every move is also a button on the job's
// page, for keyboard use.
import { useEffect, useState, type DragEvent } from "react";
import { ago, euro, followUpDue, post, usd, type JobRow, type Status, type Summary } from "./api";
import { statsLine } from "./Runs";
import { isSortId, sortJobs, SORTS, type SortId } from "./sort";
import { Button, cx, Pill, Stats } from "./ui";

type Open = (id: string) => void;

interface Column {
  title: string;
  statuses: Status[];
  /** Hide the column while it's empty: it holds exceptions, not a stage every job passes through. */
  optional?: boolean;
  /** What dropping a card here does, and from which statuses that makes sense. */
  drop?: { to: Status; from: Status[]; done: string };
}

const COLUMNS: Column[] = [
  { title: "Needs review", statuses: ["needs_review"], optional: true },
  { title: "Ready to apply", statuses: ["cv_ready", "apply"], drop: { to: "apply", from: ["maybe", "skip", "needs_review"], done: "moved to apply; it's tailored on the next run, or press Tailor now on its page" } },
  { title: "Maybe", statuses: ["maybe"] },
  { title: "Applied", statuses: ["applied"], drop: { to: "applied", from: ["cv_ready", "apply"], done: "marked applied" } },
  { title: "Interview", statuses: ["interview"], drop: { to: "interview", from: ["applied"], done: "moved to interview" } },
  { title: "Rejected", statuses: ["rejected"], drop: { to: "rejected", from: ["applied", "interview"], done: "marked rejected" } },
];
const DISMISSABLE: Status[] = ["needs_review", "apply", "cv_ready", "maybe", "skip"];
/** A long column shows this many cards, best first, until you ask for the rest. */
const SHOWN = 8;

function JobCard({ job, open, onDrag, followUpDays }: { job: JobRow; open: Open; onDrag: (j: JobRow | null) => void; followUpDays: number }) {
  // Once you've applied, when you applied matters more than when the job was posted.
  const when = job.applied_at ? `applied ${ago(job.applied_at)}` : job.posted ? ago(job.posted) : null;
  const meta = [job.workplace && job.workplace !== "unknown" ? job.workplace : null, job.bandTopEur ? `to ${euro(job.bandTopEur)}` : null, when].filter(Boolean);
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", job.id);
        e.dataTransfer.effectAllowed = "move";
        onDrag(job);
      }}
      onDragEnd={() => onDrag(null)}
      onClick={() => open(job.id)}
      className="grid w-full cursor-pointer gap-1 rounded-[9px] border border-line bg-surface px-3 py-2.5 text-left text-ink hover:border-axis hover:bg-hover focus-visible:border-axis focus-visible:bg-hover focus-visible:outline-none active:cursor-grabbing"
    >
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{job.companyName}</span>
        {job.score != null ? <span className="font-semibold tabular-nums">{job.score}</span> : null}
      </div>
      <div className="text-[13px] text-ink-2">{job.title}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {job.status === "apply" ? <Pill tone="info">Not tailored yet</Pill> : null}
        {job.manual ? <Pill>Added by you</Pill> : null}
        {job.recruiter ? <Pill tone="warning">{job.recruiter === "reposted" ? "Reposted" : "Recruiter"}</Pill> : null}
        {job.flagged ? <Pill tone="warning">AI-directed text</Pill> : null}
        {followUpDue(job, followUpDays) ? <Pill tone="warning">Follow up</Pill> : null}
        {meta.map((m) => <span key={m}>{m}</span>)}
      </div>
    </button>
  );
}

export function Board({ jobs, summary, open, changed, notify }: { jobs: JobRow[]; summary: Summary | null; open: Open; changed: () => void; notify: (m: string) => void }) {
  const [dragging, setDragging] = useState<JobRow | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortId>(() => {
    const saved = localStorage.getItem("boardSort");
    return isSortId(saved) ? saved : "score";
  });
  useEffect(() => localStorage.setItem("boardSort", sort), [sort]);
  const sorted = sortJobs(jobs, sort);
  const c = summary?.counts ?? {};
  const last = summary?.runs.find((r) => r.kind === "scan" && r.status !== "running");
  const replies = summary?.replyDays ?? [];
  const median = replies.length ? replies[Math.floor((replies.length - 1) / 2)]! : null;
  const waitingSub = [
    summary?.followUpsDue ? `${summary.followUpsDue} to follow up` : "none to follow up",
    median !== null ? `median reply ${median} d` : null,
  ].filter(Boolean).join(" · ");
  const columns = COLUMNS.filter((col) => !col.optional || jobs.some((j) => col.statuses.includes(j.status)));

  const move = (job: JobRow, to: Status, done: string) =>
    post(`/api/jobs/${job.id}/status`, { status: to }).then(() => (notify(`${job.companyName}: ${done}`), changed()), (e: Error) => notify(e.message));
  const accepts = (col: Column) => Boolean(dragging && col.drop?.from.includes(dragging.status));
  const target = (key: string, ok: boolean, onDrop: () => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!ok) return;
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      setDragging(null);
      if (ok) onDrop();
    },
  });

  return (
    <div className="grid gap-5">
      <Stats
        items={[
          { label: "Ready to apply", value: (c.cv_ready ?? 0) + (c.apply ?? 0), sub: `${c.cv_ready ?? 0} with a tailored CV` },
          { label: "Applied", value: (c.applied ?? 0) + (c.interview ?? 0) + (c.rejected ?? 0), sub: `${c.interview ?? 0} interview${c.interview === 1 ? "" : "s"} · ${c.rejected ?? 0} rejected` },
          { label: "Waiting for a reply", value: c.applied ?? 0, sub: waitingSub },
          { label: "To decide", value: c.maybe ?? 0, sub: `${c.skip ?? 0} skipped by the score` },
          { label: "LLM spend, 30 days", value: summary ? usd(summary.cost30d) : "–", sub: summary?.pricingNote ? "list prices, see config" : undefined },
        ]}
      />
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 px-0.5">
        {last || c.new ? (
          <p className="m-0 text-[13px] text-muted">
            {last ? `Last scan ${ago(last.started_at)}${statsLine(last) ? `: ${statsLine(last)}` : ""}. ` : ""}
            {c.new ? `${c.new} job${c.new === 1 ? "" : "s"} queued for scoring. ` : ""}
            <a href="#/pipeline">Pipeline</a>
          </p>
        ) : <span />}
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as SortId)} className="rounded-md border border-line bg-raised px-1.5 py-1 text-ink">
            {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 items-start gap-3 xl:grid-flow-col xl:auto-cols-fr xl:grid-cols-none">
        {columns.map((col) => {
          const list = sorted.filter((j) => col.statuses.includes(j.status));
          const all = expanded.has(col.title);
          const ok = accepts(col);
          return (
            <div
              key={col.title}
              {...target(col.title, ok, () => dragging && col.drop && move(dragging, col.drop.to, col.drop.done))}
              className={cx(
                "grid min-h-24 content-start gap-2 rounded-xl p-1.5 transition-colors",
                ok && "outline-2 -outline-offset-2 outline-dashed outline-accent",
                ok && over === col.title && "bg-accent-wash",
                dragging && !ok && "opacity-50",
              )}
            >
              <h2 className="flex justify-between px-1 text-[12.5px] font-semibold text-ink-2">
                <span>{col.title}</span>
                <span className="tabular-nums">{list.length}</span>
              </h2>
              {list.length ? (all ? list : list.slice(0, SHOWN)).map((j) => <JobCard key={j.id} job={j} open={open} onDrag={setDragging} followUpDays={summary?.followUpDays ?? 10} />) : (
                <div className="px-1 py-1.5 text-[12.5px] text-muted">{ok ? "Drop here" : "Nothing here"}</div>
              )}
              {list.length > SHOWN ? (
                <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setExpanded((s) => new Set(all ? [...s].filter((t) => t !== col.title) : [...s, col.title]))}>
                  {all ? "Show fewer" : `Show all ${list.length}`}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      {dragging && DISMISSABLE.includes(dragging.status) ? (
        <div
          {...target("dismiss", true, () => move(dragging, "dismissed", "dismissed"))}
          className={cx(
            "fixed inset-x-6 bottom-5 z-10 mx-auto max-w-[600px] rounded-xl border-2 border-dashed px-4 py-4 text-center font-semibold shadow-lg",
            over === "dismiss" ? "border-critical bg-critical-wash text-ink" : "border-axis bg-raised text-ink-2",
          )}
        >
          Drop here to dismiss {dragging.companyName}
        </div>
      ) : null}
    </div>
  );
}
