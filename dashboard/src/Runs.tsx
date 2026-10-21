import { useEffect, useRef, useState } from "react";
import { duration, getJson, usd, type Event, type Run } from "./api";
import { cx, RunPill, td, th } from "./ui";

/** One run's result in words, e.g. "125 relevant · 8 fresh · 1 apply · 2 maybe · 5 skip". */
export const statsLine = (r: Run) => {
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

/** Every recent run; picking one shows it in the diagram, stage cards and event log above. */
export function RunHistory({ runs, selected, onSelect }: { runs: Run[]; selected: number; onSelect: (id: number) => void }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>{["Run", "Kind", "Started", "Duration", "Status", "Result", "LLM cost"].map((h) => <th key={h} className={h === "LLM cost" ? `${th} text-right` : th}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} onClick={() => onSelect(r.id)} aria-selected={r.id === selected} className={cx("cursor-pointer hover:bg-hover", r.id === selected && "bg-hover")}>
            <td className={td}>
              <button className="cursor-pointer font-semibold text-ink hover:underline" onClick={(e) => (e.stopPropagation(), onSelect(r.id))}>#{r.id}</button>
            </td>
            <td className={td}>{r.kind}</td>
            <td className={`${td} whitespace-nowrap`}>{new Date(r.started_at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
            <td className={`${td} whitespace-nowrap`}>{duration(r.started_at, r.finished_at)}</td>
            <td className={td}><RunPill status={r.status} /></td>
            <td className={`${td} text-muted`}>{statsLine(r)}</td>
            <td className={`${td} text-right tabular-nums`}>{usd(r.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
