// One run as a pipeline: per stage, what went in and out, how long it took, what it cost, and whether it is done,
// running or still waiting. Computed from the run's stats, its event log and its LLM call log.
import type { DatabaseSync } from "node:sqlite";

export type StageStatus = "done" | "running" | "waiting" | "skipped" | "idle" | "failed";

export interface Stage {
  key: string;
  name: string;
  does: string;
  status: StageStatus;
  /** Short metric lines, e.g. "5,286 postings in", "127 relevant". */
  metrics: string[];
  ms: number | null;
  cost: number;
  calls: number;
  errors: number;
}

interface Run { id: number; kind: string; status: string; started_at: string; finished_at: string | null; stats: string | null }
interface Ev { at: string; stage: string; level: string; message: string; job_id: string | null }
interface Call { role: string; ok: number; ms: number; at: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number }

const STAGES = [
  { key: "fetch", name: "Fetch", does: "Company job boards, HN and LinkedIn" },
  { key: "filter", name: "Filter", does: "Title, location, German, years, pay band, freshness" },
  { key: "screen", name: "Injection screen", does: "Patterns + LLM check for text aimed at AI" },
  { key: "research", name: "Company research", does: "Website, news and HN, cited; cached 30 days" },
  { key: "vet", name: "Score", does: "LLM rates the rubric, the formula decides" },
  { key: "tailor", name: "Tailor", does: "CV, why-us answer and note, fact-checked" },
  { key: "ready", name: "Ready", does: "Waiting for you to review and apply" },
  { key: "inbox", name: "Inbox", does: "Replies matched to jobs; rules only" },
  { key: "outcomes", name: "Outcomes", does: "Applied, interview, rejected" },
] as const;

const n = (x: unknown) => (typeof x === "number" ? x.toLocaleString("en") : "–");

export function runPipeline(db: DatabaseSync, runId: number, price: (model: string) => { input: number; output: number; cacheRead: number; cacheWrite: number }): { run: Run; stages: Stage[] } | null {
  const run = db.prepare("SELECT id, kind, status, started_at, finished_at, stats FROM runs WHERE id = ?").get(runId) as Run | undefined;
  if (!run) return null;
  const stats = (run.stats ? JSON.parse(run.stats) : {}) as Record<string, unknown> & { vet?: Record<string, number>; fetch?: Record<string, number>; inbox?: Record<string, number> | null };
  const events = db.prepare("SELECT at, stage, level, message, job_id FROM events WHERE run_id = ? ORDER BY id").all(runId) as unknown as Ev[];
  const calls = db.prepare("SELECT role, ok, ms, at, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM llm_calls WHERE run_id = ?").all(runId) as unknown as Call[];
  const t = (iso: string) => Date.parse(iso);

  const byRole = (role: string) => calls.filter((c) => c.role === role);
  const costOf = (cs: Call[]) => cs.reduce((s, c) => {
    const p = price(c.model);
    return s + (c.input_tokens * p.input + c.output_tokens * p.output + c.cache_read_tokens * p.cacheRead + c.cache_write_tokens * p.cacheWrite) / 1e6;
  }, 0);
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

  const raw: Omit<Stage, "status" | "key" | "name" | "does">[] = [
    {
      metrics: run.kind === "vet" ? ["not part of this run"] : [
        stats.fetch ? `${n(stats.fetch.boardPostings)} from ${n(stats.fetch.boards)} boards` : `${n(stats.postings)} postings`,
        ...(stats.fetch ? [`${n(stats.fetch.hn)} HN · ${n(stats.fetch.linkedin)} LinkedIn`] : []),
      ],
      ms: fetchEnd ? t(fetchEnd.at) - t(run.started_at) : null, cost: 0, calls: 0, errors: evs("fetch", "warn").length,
    },
    {
      metrics: run.kind === "vet" ? ["not part of this run"] : [`${n(stats.relevant)} relevant · ${n(stats.new)} new`, `${n(stats.passed)} fresh and passed`, `${n(stats.stale)} older than the window`],
      ms: filterEv && fetchEnd ? t(filterEv.at) - t(fetchEnd.at) : null, cost: 0, calls: 0, errors: 0,
    },
    { metrics: [`${llm.screen.length} screened`, `${evs("screen", "warn").length} held for review`], ms: span(llm.screen), cost: costOf(llm.screen), calls: llm.screen.length, errors: llm.screen.filter((c) => !c.ok).length },
    { metrics: [`${llm.research.length} companies researched`, "others from the 30-day cache"], ms: span(llm.research), cost: costOf(llm.research), calls: llm.research.length, errors: llm.research.filter((c) => !c.ok).length + evs("research", "warn").length },
    {
      metrics: vet ? [`${vet.processed} scored`, `${vet.apply} apply · ${vet.maybe} maybe · ${vet.skip} skip`] : [`${llm.vet.length} scored so far`],
      ms: span(llm.vet), cost: costOf(llm.vet), calls: llm.vet.length, errors: (vet?.errors ?? 0) + llm.vet.filter((c) => !c.ok).length,
    },
    { metrics: [`${tailored} tailored`, `${evs("tailor", "warn").length} need an edit`], ms: span(llm.tailor), cost: costOf(llm.tailor), calls: llm.tailor.length, errors: evs("tailor", "error").length },
    { metrics: [`${tailored} new application${tailored === 1 ? "" : "s"}`], ms: null, cost: 0, calls: 0, errors: 0 },
    {
      metrics: stats.inbox
        ? [`${stats.inbox.new} new email${stats.inbox.new === 1 ? "" : "s"}`, `${stats.inbox.changed} status change${stats.inbox.changed === 1 ? "" : "s"}`, `${stats.inbox.needsYou} for you to look at`]
        : [inboxSkipped ? "Gmail not set up" : "not checked"],
      ms: null, cost: 0, calls: 0, errors: evs("inbox", "warn").filter((e) => e.message.startsWith("failed")).length,
    },
    { metrics: [`${outcomes.applied} applied · ${outcomes.interview} interview`, `${outcomes.rejected} rejected`], ms: null, cost: 0, calls: 0, errors: 0 },
  ];

  // Status: a finished run's stages are done (or skipped); in a live run, the latest stage with activity is running.
  const order = STAGES.map((s) => s.key) as string[];
  // The inbox runs alongside the main line from the start, so it never decides which main stage is current.
  const activity = events.map((e) => (["run", "dashboard", "inbox", "aws"].includes(e.stage) ? -1 : order.indexOf(e.stage))).filter((i) => i >= 0);
  const lastCall = calls.length ? order.indexOf([...calls].sort((a, b) => t(a.at) - t(b.at)).at(-1)!.role) : -1;
  const current = Math.max(run.kind === "vet" ? 2 : 0, ...activity, lastCall);
  const stages = STAGES.map((s, i): Stage => {
    let status: StageStatus;
    if (s.key === "inbox") {
      status = inboxSkipped ? "skipped" : inboxFailed ? "failed" : inboxDone ? (stats.inbox?.new ? "done" : "idle") : run.status === "running" ? "running" : "skipped";
      return { key: s.key, name: s.name, does: s.does, status, ...raw[i]! };
    }
    if (s.key === "outcomes") return { key: s.key, name: s.name, does: s.does, status: outcomes.applied ? "done" : "idle", ...raw[i]! };
    const notInRun = run.kind === "vet" && i < 2;
    if (notInRun || (llmSkipped && i >= 2 && i <= 5)) status = "skipped";
    else if (run.status === "running") status = i < current ? "done" : i === current ? "running" : "waiting";
    else if (run.status === "failed") status = i < current ? "done" : i === current ? "failed" : "waiting";
    // A finished stage that had nothing to process (no new jobs reached it) is idle, not "done".
    else status = i >= 2 && (i === 6 ? raw[5]!.calls === 0 : raw[i]!.calls === 0) ? "idle" : "done";
    return { key: s.key, name: s.name, does: s.does, status, ...raw[i]! };
  });
  return { run, stages };
}
