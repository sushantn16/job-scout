import { useEffect, useRef, useState } from "react";
import { ago, duration, post, usePoll, type JobRow, type Summary } from "./api";
import { AddJob } from "./AddJob";
import { Board } from "./Board";
import { CvEditor } from "./CvEditor";
import { Inbox } from "./Inbox";
import { JobDetail } from "./JobDetail";
import { AllJobs } from "./Jobs";
import { Pipeline } from "./Pipeline";
import { Preferences } from "./Preferences";
import { Banner, Button, RunPill, useNotice } from "./ui";

type View = "board" | "jobs" | "inbox" | "pipeline" | "cv" | "preferences";
type Route = { view: View } | { view: "job"; id: string };
const VIEWS: { view: View; label: string; hash: string }[] = [
  { view: "board", label: "Board", hash: "#/" },
  { view: "jobs", label: "All jobs", hash: "#/jobs" },
  { view: "inbox", label: "Inbox", hash: "#/inbox" },
  { view: "pipeline", label: "Pipeline", hash: "#/pipeline" },
  { view: "cv", label: "CV", hash: "#/cv" },
  { view: "preferences", label: "Preferences", hash: "#/preferences" },
];
// The board lives at "#/"; the runs list moved into Pipeline.
const ALIASES: Record<string, View> = { "": "board", runs: "pipeline" };
const parseRoute = (): Route => {
  const [, view = "", id] = location.hash.split("/");
  if (view === "job" && id) return { view: "job", id };
  return { view: ALIASES[view] ?? (VIEWS.some((v) => v.view === view) ? (view as View) : "board") };
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

const ICON: Record<Theme, string> = {
  system: "M12 3a9 9 0 1 0 0 18V3Z M12 3a9 9 0 0 1 0 18",
  light: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  dark: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
};

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  // The list a job page was opened from, for its back button.
  const from = useRef("#/");
  useEffect(() => {
    const on = () => {
      const r = parseRoute();
      if (r.view !== "job") from.current = location.hash || "#/";
      setRoute(r);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const go = (hash: string) => (location.hash = hash);
  const [theme, cycleTheme] = useTheme();
  const [notice, notify] = useNotice();
  const [adding, setAdding] = useState(false);
  const summary = usePoll<Summary>("/api/summary", 4000);
  const jobs = usePoll<JobRow[]>(route.view === "jobs" ? "/api/jobs?status=all" : "/api/jobs", 8000);
  const inbox = usePoll<{ kind: string; job_id: string | null }[]>("/api/inbox", 30_000);

  const s = summary.data;
  const last = s?.runs[0];
  const running = Boolean(s?.running);
  const start = (name: "scan" | "vet" | "tailor") =>
    post<{ started: string }>(`/api/actions/${name}`).then(() => (notify(name === "scan" ? "Pipeline started" : `Started: ${name}`), summary.refresh()), (e: Error) => notify(e.message));
  const needsYou = (inbox.data ?? []).filter((e) => e.kind !== "ignored" && (e.kind === "unclear" || !e.job_id)).length;
  const open = (id: string) => go(`#/job/${id}`);

  return (
    <div className="mx-auto grid max-w-[1200px] gap-5 px-6 pb-14 pt-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
        <a href="#/" className="text-[17px] font-semibold text-ink no-underline">job-scout</a>
        <nav className="flex gap-0.5" aria-label="Views">
          {VIEWS.map((v) => (
            <Button key={v.view} variant="ghost" aria-current={route.view === v.view ? "page" : undefined} onClick={() => go(v.hash)}>
              {v.label}
              {v.view === "inbox" && needsYou ? <span className="ml-1.5 rounded-full bg-warning px-1.5 text-[11px] font-semibold text-black">{needsYou}</span> : null}
            </Button>
          ))}
        </nav>
        <span className="flex-1" />
        {last ? (
          <a href="#/pipeline" className="inline-flex items-center gap-2 text-[12.5px] text-muted no-underline hover:text-ink-2">
            {last.status === "done" ? `Last run ${ago(last.started_at)}` : <><RunPill status={last.status} /> {duration(last.started_at, last.finished_at)}</>}
          </a>
        ) : null}
        <Button onClick={() => setAdding(true)}>Add job</Button>
        <Button variant="primary" disabled={running} onClick={() => start("scan")} title={s ? `Looks for postings since ${new Date(s.nextWindowStart).toLocaleString()}` : undefined}>
          {running ? "Running…" : "Run pipeline"}
        </Button>
        <Button variant="ghost" onClick={cycleTheme} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}. Change theme`} className="px-2">
          <svg viewBox="0 0 24 24" className="block size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" aria-hidden="true">
            <path d={ICON[theme]} />
          </svg>
        </Button>
      </header>
      {summary.error ? <Banner tone="critical" title="API unreachable">{summary.error}</Banner> : null}

      {route.view === "board" ? <Board jobs={jobs.data ?? []} summary={s} open={open} changed={() => (jobs.refresh(), summary.refresh())} notify={notify} /> : null}
      {route.view === "jobs" ? <AllJobs jobs={jobs.data ?? []} open={open} /> : null}
      {route.view === "inbox" ? <Inbox /> : null}
      {route.view === "pipeline" ? <Pipeline runs={s?.runs ?? []} running={running} start={start} /> : null}
      {route.view === "cv" ? <CvEditor notify={notify} /> : null}
      {route.view === "preferences" ? <Preferences notify={notify} running={running} /> : null}
      {route.view === "job" ? <JobDetail key={route.id} id={route.id} back={() => go(from.current)} notify={notify} /> : null}

      {adding ? (
        <AddJob
          onClose={() => setAdding(false)}
          onAdded={(id, message) => {
            setAdding(false);
            notify(message);
            jobs.refresh();
            open(id);
          }}
        />
      ) : null}
      {notice}
    </div>
  );
}
