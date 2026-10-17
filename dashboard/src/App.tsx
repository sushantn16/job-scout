import { useEffect, useState } from "react";
import { ago, duration, post, usd, usePoll, type JobRow, type Summary } from "./api";
import { Board, JobTable } from "./Board";
import { Funnel } from "./charts";
import { Inbox } from "./Inbox";
import { JobDetail } from "./JobDetail";
import { Pipeline } from "./Pipeline";
import { Runs } from "./Runs";
import { Banner, Button, Card, RunPill, StatTile } from "./ui";

type View = "board" | "pipeline" | "inbox" | "jobs" | "runs";
type Route = { view: View } | { view: "job"; id: string };
const VIEWS: { view: View; label: string }[] = [
  { view: "board", label: "Board" },
  { view: "pipeline", label: "Pipeline" },
  { view: "inbox", label: "Inbox" },
  { view: "jobs", label: "All jobs" },
  { view: "runs", label: "Runs" },
];
const parseRoute = (): Route => {
  const [, view, id] = location.hash.split("/");
  if (view === "job" && id) return { view: "job", id };
  return VIEWS.some((v) => v.view === view) ? { view: view as View } : { view: "board" };
};

type Theme = "system" | "light" | "dark";
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("theme") as Theme) ?? "system");
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"))];
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const go = (hash: string) => (location.hash = hash);
  const [theme, cycleTheme] = useTheme();
  const summary = usePoll<Summary>("/api/summary", 4000);
  const jobs = usePoll<JobRow[]>(route.view === "jobs" ? "/api/jobs?status=all" : "/api/jobs", 8000);
  const inbox = usePoll<{ kind: string; job_id: string | null }[]>("/api/inbox", 30_000);
  const [msg, setMsg] = useState<string | null>(null);

  const s = summary.data;
  const c = s?.counts ?? {};
  const last = s?.runs[0];
  const running = Boolean(s?.running);
  const start = (name: "scan" | "vet" | "tailor" | "inbox") =>
    post<{ started: string }>(`/api/actions/${name}`).then(() => (setMsg(`Started ${name}`), summary.refresh()), (e: Error) => setMsg(e.message));
  const appliedTotal = (c.applied ?? 0) + (c.interview ?? 0) + (c.rejected ?? 0);
  const needsYou = (inbox.data ?? []).filter((e) => e.kind !== "ignored" && (e.kind === "unclear" || !e.job_id)).length;

  return (
    <div className="mx-auto grid max-w-[1280px] gap-4 px-6 pb-12 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-lg">job-scout</h1>
        <nav className="flex gap-1">
          {VIEWS.map((v) => (
            <Button key={v.view} variant="ghost" aria-current={route.view === v.view ? "page" : undefined} onClick={() => go(`#/${v.view === "board" ? "" : v.view}`)}>
              {v.label}
              {v.view === "inbox" && needsYou ? <span className="ml-1.5 rounded-full bg-warning px-1.5 text-[11px] font-semibold text-black">{needsYou}</span> : null}
            </Button>
          ))}
        </nav>
        <span className="flex-1" />
        {last ? (
          <span className="inline-flex items-center gap-2 text-muted">
            Last run <RunPill status={last.status} /> {ago(last.started_at)} · {duration(last.started_at, last.finished_at)}
          </span>
        ) : null}
        <Button variant="primary" disabled={running} onClick={() => start("scan")} title={s ? `Looks for postings since ${new Date(s.nextWindowStart).toLocaleString()}` : undefined}>
          {running ? "Running…" : "Run pipeline"}
        </Button>
        {s && !running ? <span className="text-[12.5px] text-muted">looks back to {new Date(s.nextWindowStart).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span> : null}
        <Button disabled={running} onClick={() => start("inbox")}>Check inbox</Button>
        <Button variant="ghost" onClick={cycleTheme} title="Theme">{theme === "system" ? "◐ System" : theme === "light" ? "☀ Light" : "☾ Dark"}</Button>
      </div>
      {msg ? <div className="text-muted">{msg}</div> : null}
      {summary.error ? <Banner tone="critical" title="API unreachable">{summary.error}</Banner> : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <StatTile label="Ready to apply" value={(c.cv_ready ?? 0) + (c.apply ?? 0)} sub={`${c.cv_ready ?? 0} with a tailored CV`} />
        <StatTile label="Needs review" value={c.needs_review ?? 0} sub="AI-directed text in the posting" />
        <StatTile label="Applied" value={appliedTotal} sub={`${c.interview ?? 0} interviews · ${c.rejected ?? 0} rejected`} />
        <StatTile label="In the queue" value={c.new ?? 0} sub={`${c.maybe ?? 0} maybe · ${c.skip ?? 0} skipped`} />
        <StatTile label="LLM spend, 30 days" value={s ? usd(s.cost30d) : "–"} sub={s?.pricingNote ? "list prices, see config" : undefined} />
      </div>

      {route.view === "board" ? (
        <>
          <Board jobs={jobs.data ?? []} open={(id) => go(`#/job/${id}`)} />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card title="Recent runs" aside={<a href="#/runs" className="text-[13px] font-normal">All runs</a>}>
              <Runs runs={(s?.runs ?? []).slice(0, 5)} />
            </Card>
            <Card title="Funnel">
              <Funnel
                stages={[
                  { label: "Ready to apply", n: (c.cv_ready ?? 0) + (c.apply ?? 0), tone: 1 },
                  { label: "Applied (total)", n: appliedTotal, tone: 2 },
                  { label: "Interview", n: c.interview ?? 0, tone: 3 },
                  { label: "Rejected", n: c.rejected ?? 0, tone: 0 },
                ]}
              />
            </Card>
          </div>
        </>
      ) : null}
      {route.view === "pipeline" ? <Pipeline runs={s?.runs ?? []} running={running} start={start} /> : null}
      {route.view === "inbox" ? <Inbox /> : null}
      {route.view === "jobs" ? <Card title={`All jobs (${jobs.data?.length ?? 0})`}><JobTable jobs={jobs.data ?? []} open={(id) => go(`#/job/${id}`)} /></Card> : null}
      {route.view === "runs" ? <Runs runs={s?.runs ?? []} /> : null}
      {route.view === "job" ? <JobDetail id={route.id} back={() => go("#/")} /> : null}
    </div>
  );
}
