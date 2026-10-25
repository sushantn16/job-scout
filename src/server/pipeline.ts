// One run as a pipeline: per stage, what went in and out, how long it took, what it cost, and whether it is done,
// running or still waiting. Computed from the run's stats, its event log and its LLM call log.
import { costOf, type Price, type Usage } from "../llm/cost.ts";
import type { DatabaseSync } from "node:sqlite";

import { STAGES, type StageDef, type StageKey } from "../pipeline/stages.ts";

export type StageStatus = "done" | "running" | "waiting" | "skipped" | "idle" | "failed";

/** A stage as it went in one run: its definition from src/pipeline/stages.ts plus what happened. */
export interface Stage extends Omit<StageDef, "scanOnly"> {
  key: StageKey;
  status: StageStatus;
  /** Short metric lines, e.g. "5,286 postings in", "127 relevant". */
  metrics: string[];
  /** The metric the diagram shows on the stage's block. */
  headline: string | null;
  ms: number | null;
  cost: number;
  calls: number;
  errors: number;
}

interface Measured extends Pick<Stage, "metrics" | "ms" | "cost" | "calls" | "errors"> {
  /** Which of `metrics` is the headline. */
  headline: number;
}

interface Run { id: number; kind: string; status: string; started_at: string; finished_at: string | null; stats: string | null }
interface Ev { at: string; stage: string; level: string; message: string; job_id: string | null }
interface Call extends Usage { role: string; ok: number; ms: number; at: string }

const n = (x: unknown) => (typeof x === "number" ? x.toLocaleString("en") : "–");

export function runPipeline(db: DatabaseSync, runId: number, price: (model: string) => Price): { run: Run; stages: Stage[] } | null {
  const run = db.prepare("SELECT id, kind, status, started_at, finished_at, stats FROM runs WHERE id = ?").get(runId) as Run | undefined;
  if (!run) return null;
  const stats = (run.stats ? JSON.parse(run.stats) : {}) as Record<string, unknown> & { vet?: Record<string, number>; fetch?: Record<string, number>; inbox?: Record<string, number> | null };
  const events = db.prepare("SELECT at, stage, level, message, job_id FROM events WHERE run_id = ? ORDER BY id").all(runId) as unknown as Ev[];
  const calls = db.prepare("SELECT role, ok, ms, at, model, input_tokens AS input, output_tokens AS output, cache_read_tokens AS cacheRead, cache_write_tokens AS cacheWrite FROM llm_calls WHERE run_id = ?").all(runId) as unknown as Call[];
  const t = (iso: string) => Date.parse(iso);

  const byRole = (role: string) => calls.filter((c) => c.role === role);
  const cost = (cs: Call[]) => costOf(price, cs);
  // LLM stages interleave across jobs, so a stage's time is its span: first call start to last call end.
  const span = (cs: Call[]) => (cs.length ? Math.max(...cs.map((c) => t(c.at))) - Math.min(...cs.map((c) => t(c.at) - c.ms)) : null);
  const last = (stage: string) => [...events].reverse().find((e) => e.stage === stage);
  const evs = (stage: string, level?: string) => events.filter((e) => e.stage === stage && (!level || e.level === level));

  const fetchEnd = last("fetch");
  const filterEv = events.find((e) => e.stage === "filter" && !e.job_id);
  // Scan runs nest vetting stats under `vet`; vet-only runs store them at the top level.
  const vet = stats.vet ?? (typeof stats.processed === "number" ? (stats as unknown as Record<string, number>) : undefined);
  const tailored = evs("tailor").filter((e) => e.message.startsWith("cv ready")).length;
  const llmSkipped = events.some((e) => e.stage === "vet" && e.message.startsWith("skipped"));
  const inboxSkipped = events.some((e) => e.stage === "inbox" && e.message.startsWith("skipped"));
  const inboxDone = events.some((e) => e.stage === "inbox" && /emails checked/.test(e.message));
  const inboxFailed = events.some((e) => e.stage === "inbox" && e.message.startsWith("failed"));
  // Outcomes are totals across all jobs, not just this run: the loop's current state.
  const outcomes = Object.fromEntries(
    (db.prepare("SELECT status, count(*) AS n FROM jobs WHERE status IN ('applied', 'interview', 'rejected') GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]),
  ) as Record<string, number>;
  outcomes.applied = (outcomes.applied ?? 0) + (outcomes.interview ?? 0) + (outcomes.rejected ?? 0);
  outcomes.interview ??= 0;
  outcomes.rejected ??= 0;
  const llm = { screen: byRole("screen"), research: byRole("research"), vet: byRole("vet"), tailor: byRole("tailor") };

  const llmCalls = (cs: Call[]) => ({ ms: span(cs), cost: cost(cs), calls: cs.length });
  const none = { ms: null, cost: 0, calls: 0, errors: 0 };
  const measured: Record<StageKey, Measured> = {
    fetch: {
      metrics: run.kind === "vet" ? ["not part of this run"] : [
        stats.fetch ? `${n(stats.fetch.boardPostings)} from ${n(stats.fetch.boards)} boards${stats.fetch.foundBoards ? ` (${n(stats.fetch.foundBoards)} found)` : ""}` : `${n(stats.postings)} postings`,
        ...(stats.fetch ? [`${n(stats.fetch.hn)} HN · ${n(stats.fetch.linkedin)} LinkedIn`] : []),
      ],
      headline: 0, ms: fetchEnd ? t(fetchEnd.at) - t(run.started_at) : null, cost: 0, calls: 0, errors: evs("fetch", "warn").length,
    },
    filter: {
      metrics: run.kind === "vet" ? ["not part of this run"] : [`${n(stats.relevant)} relevant · ${n(stats.new)} new`, `${n(stats.passed)} fresh and passed`, `${n(stats.stale)} older than the window`],
      headline: 1, ms: filterEv && fetchEnd ? t(filterEv.at) - t(fetchEnd.at) : null, cost: 0, calls: 0, errors: 0,
    },
    screen: { metrics: [`${llm.screen.length} screened`, `${evs("screen", "warn").length} held for review`], headline: 0, ...llmCalls(llm.screen), errors: llm.screen.filter((c) => !c.ok).length },
    research: { metrics: [`${llm.research.length} companies researched`, "others from the 30-day cache"], headline: 0, ...llmCalls(llm.research), errors: llm.research.filter((c) => !c.ok).length + evs("research", "warn").length },
    vet: {
      metrics: vet ? [`${vet.processed} scored`, `${vet.apply} apply · ${vet.maybe} maybe · ${vet.skip} skip`] : [`${llm.vet.length} scored so far`],
      headline: 1, ...llmCalls(llm.vet), errors: (vet?.errors ?? 0) + llm.vet.filter((c) => !c.ok).length,
    },
    tailor: { metrics: [`${tailored} tailored`, `${evs("tailor", "warn").length} need an edit`], headline: 0, ...llmCalls(llm.tailor), errors: evs("tailor", "error").length },
    ready: { metrics: [`${tailored} new application${tailored === 1 ? "" : "s"}`], headline: 0, ...none },
    inbox: {
      metrics: stats.inbox
        ? [`${stats.inbox.new} new email${stats.inbox.new === 1 ? "" : "s"}`, `${stats.inbox.changed} status change${stats.inbox.changed === 1 ? "" : "s"}`, `${stats.inbox.needsYou} for you to look at`]
        : [inboxSkipped ? "Gmail not set up" : "not checked"],
      headline: 1, ...none, errors: evs("inbox", "warn").filter((e) => e.message.startsWith("failed")).length,
    },
    outcomes: { metrics: [`${outcomes.applied} applied · ${outcomes.interview} interview`, `${outcomes.rejected} rejected`], headline: 0, ...none },
  };

  // Status: a finished run's stages are done (or skipped); in a live run, the latest stage with activity is running.
  const order: string[] = STAGES.map((s) => s.key);
  // The inbox runs alongside the main line from the start, so it never decides which main stage is current.
  const activity = events.map((e) => (e.stage === "inbox" ? -1 : order.indexOf(e.stage))).filter((i) => i >= 0);
  const lastCall = calls.length ? order.indexOf([...calls].sort((a, b) => t(a.at) - t(b.at)).at(-1)!.role) : -1;
  const current = Math.max(run.kind === "vet" ? STAGES.findIndex((s) => !s.scanOnly) : 0, ...activity, lastCall);
  const stages = STAGES.map((s, i): Stage => {
    const { headline, ...m } = measured[s.key];
    let status: StageStatus;
    if (s.key === "inbox") status = inboxSkipped ? "skipped" : inboxFailed ? "failed" : inboxDone ? (stats.inbox?.new ? "done" : "idle") : run.status === "running" ? "running" : "skipped";
    else if (s.key === "outcomes") status = outcomes.applied ? "done" : "idle";
    else if ((run.kind === "vet" && s.scanOnly) || (llmSkipped && s.kind === "LLM")) status = "skipped";
    else if (run.status === "running") status = i < current ? "done" : i === current ? "running" : "waiting";
    else if (run.status === "failed") status = i < current ? "done" : i === current ? "failed" : "waiting";
    // A finished stage that had nothing to process (no new jobs reached it) is idle, not "done". Ready follows Tailor.
    else status = !s.scanOnly && (s.key === "ready" ? measured.tailor.calls : m.calls) === 0 ? "idle" : "done";
    return { key: s.key, name: s.name, kind: s.kind, does: s.does, status, ...m, headline: m.metrics[headline] ?? null };
  });
  return { run, stages };
}
