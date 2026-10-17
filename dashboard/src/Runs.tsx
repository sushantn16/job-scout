import { useEffect, useRef, useState } from "react";
import { duration, getJson, usd, type Event, type Run } from "./api";
import { td, th } from "./Board";
import { Card, cx, RunPill } from "./ui";

const statsLine = (r: Run) => {
  const s = (r.stats ?? {}) as Record<string, unknown>;
  const vet = (s.vet ?? (typeof s.processed === "number" ? s : undefined)) as Record<string, number> | undefined;
  const inbox = s.inbox as Record<string, number> | null | undefined;
  return [
    s.relevant != null ? `${s.relevant} relevant` : null,
    s.passed != null ? `${s.passed} fresh` : null,
    vet ? `${vet.apply} apply · ${vet.maybe} maybe · ${vet.skip} skip${vet.needsReview ? ` · ${vet.needsReview} review` : ""}${vet.errors ? ` · ${vet.errors} errors` : ""}` : null,
    s.tailored ? `${s.tailored} tailored` : null,
    inbox ? `${inbox.new} new email${inbox.new === 1 ? "" : "s"}${inbox.changed ? `, ${inbox.changed} status change${inbox.changed === 1 ? "" : "s"}` : ""}` : null,
    s.ranking != null ? `${s.ranking} ranked (eval)` : null,
  ].filter(Boolean).join(" · ");
};

const LEVEL = { info: "", warn: "text-serious", error: "text-critical" } as const;

/** Event log of one run; polls every 2s while the run is live. */
export function Log({ run }: { run: Run }) {
  const [events, setEvents] = useState<Event[]>([]);
  const after = useRef(0);
  useEffect(() => {
    setEvents([]);
    after.current = 0;
    let live = true;
    const load = () =>
      getJson<Event[]>(`/api/runs/${run.id}/events?after=${after.current}`).then((e) => {
        if (!live || !e.length) return;
        after.current = e[e.length - 1]!.id;
        setEvents((prev) => [...prev, ...e]);
      });
    load();
    const t = run.status === "running" ? setInterval(load, 2000) : undefined;
    return () => ((live = false), clearInterval(t));
  }, [run.id, run.status]);
  return (
    <div className="grid max-h-[360px] gap-0.5 overflow-auto font-mono text-xs" aria-live="polite">
      {events.length ? events.map((e) => (
        <div key={e.id} className={LEVEL[e.level]}>
          {new Date(e.at).toLocaleTimeString()} [{e.stage}] {e.message}
        </div>
      )) : <span className="text-muted">No events.</span>}
    </div>
  );
}

export function Runs({ runs }: { runs: Run[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const run = runs.find((r) => r.id === selected) ?? runs[0];
  return (
    <div className="grid gap-4">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>{["Run", "Kind", "Started", "Duration", "Status", "Result", "LLM cost"].map((h) => <th key={h} className={h === "LLM cost" ? `${th} text-right` : th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} onClick={() => setSelected(r.id)} aria-selected={r.id === run?.id} className={cx("cursor-pointer hover:bg-hover", r.id === run?.id && "bg-hover")}>
              <td className={td}>#{r.id}</td>
              <td className={td}>{r.kind}</td>
              <td className={td}>{new Date(r.started_at).toLocaleString()}</td>
              <td className={td}>{duration(r.started_at, r.finished_at)}</td>
              <td className={td}><RunPill status={r.status} /></td>
              <td className={`${td} text-muted`}>{statsLine(r)}</td>
              <td className={`${td} text-right tabular-nums`}>{usd(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {run ? (
        <Card title={`Run #${run.id} events`}>
          <Log run={run} />
        </Card>
      ) : null}
    </div>
  );
}
