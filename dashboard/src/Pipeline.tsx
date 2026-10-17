import { useState } from "react";
import { duration, usd, usePoll, type Run } from "./api";
import { Diagram } from "./Diagram";
import { Log } from "./Runs";
import { Banner, Button, Card, cx, Pill } from "./ui";

type StageStatus = "done" | "running" | "waiting" | "skipped" | "idle" | "failed";
interface Stage { key: string; name: string; does: string; status: StageStatus; metrics: string[]; ms: number | null; cost: number; calls: number; errors: number }

const TONE = { done: "good", running: "info", waiting: "neutral", skipped: "neutral", idle: "neutral", failed: "critical" } as const;
const LABEL: Record<StageStatus, string> = { done: "Done", running: "Running", waiting: "Waiting", skipped: "Not in this run", idle: "Nothing new", failed: "Failed" };
const secs = (ms: number | null) => (ms == null ? null : ms < 1000 ? "<1s" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);

function StageCard({ s, i }: { s: Stage; i: number }) {
  const foot = [secs(s.ms), s.cost ? usd(s.cost) : null, s.calls ? `${s.calls} LLM call${s.calls === 1 ? "" : "s"}` : null].filter(Boolean);
  return (
    <div
      role="listitem"
      className={cx(
        "flex flex-col gap-1.5 rounded-xl border bg-surface p-3",
        s.status === "running" ? "border-accent ring-1 ring-accent" : s.status === "failed" ? "border-critical" : "border-line",
        ["waiting", "skipped", "idle"].includes(s.status) && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="inline-grid size-5 place-items-center rounded-full bg-hover text-[11.5px] text-ink-2">{i + 1}</span>
        <span className="font-semibold">{s.name}</span>
      </div>
      <div><Pill tone={TONE[s.status]} pulse={s.status === "running"}>{LABEL[s.status]}</Pill></div>
      <div className="text-xs text-muted">{s.does}</div>
      <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">{s.metrics.map((m) => <li key={m}>{m}</li>)}</ul>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {foot.join(" · ")}
        {s.errors ? <Pill tone="critical">{s.errors} error{s.errors === 1 ? "" : "s"}</Pill> : null}
      </div>
    </div>
  );
}

/** `start` runs single stages: vetting the queue or tailoring "apply" jobs without a full pipeline run. */
export function Pipeline({ runs, running, start }: { runs: Run[]; running: boolean; start: (name: "vet" | "tailor") => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const live = runs.some((r) => r.status === "running");
  const { data, error } = usePoll<{ run: Run; stages: Stage[] }>(picked ? `/api/pipeline/${picked}` : "/api/pipeline", live ? 2000 : 10_000);
  if (error) return <Banner tone="critical" title="No pipeline to show">{error}</Banner>;
  if (!data) return <div className="text-muted">Loading…</div>;
  const { run, stages } = data;
  const total = stages.reduce((s, x) => s + x.cost, 0);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-muted">
          Run{" "}
          <select
            value={picked ?? ""}
            onChange={(e) => setPicked(e.target.value ? Number(e.target.value) : null)}
            className="rounded-md border border-line bg-raised px-1.5 py-0.5 text-ink"
          >
            <option value="">Latest (live if running)</option>
            {runs.map((r) => <option key={r.id} value={r.id}>#{r.id} {r.kind} · {new Date(r.started_at).toLocaleString()}</option>)}
          </select>
        </label>
        <span>
          <strong>Run #{run.id}</strong>{" "}
          <span className="text-muted">{run.kind} · started {new Date(run.started_at).toLocaleTimeString()} · {duration(run.started_at, run.finished_at)} · {usd(total)}</span>
        </span>
        <span className="flex-1" />
        <span className="text-[12.5px] text-muted">Run one stage:</span>
        <Button size="sm" disabled={running} onClick={() => start("vet")}>Vet the queue</Button>
        <Button size="sm" disabled={running} onClick={() => start("tailor")}>Tailor "apply" jobs</Button>
      </div>
      <Card><Diagram stages={stages} /></Card>
      <h2 className="text-[15px]">Stage details</h2>
      <div role="list" className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {stages.map((s, i) => <StageCard key={s.key} s={s} i={i} />)}
      </div>
      <Card title="Event log"><Log run={run} /></Card>
    </div>
  );
}
