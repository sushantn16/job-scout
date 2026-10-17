import { useState, type ReactNode } from "react";
import { euro, post, usd, usePoll, type JobDetail as Job, type Status } from "./api";
import { ScoreBreakdown } from "./charts";
import { Markdown } from "./Markdown";
import { Banner, Button, Card, H3, List, Pill, StatusPill } from "./ui";

/** Which status changes make sense from each status. "new" re-queues the job for vetting. */
const NEXT: Partial<Record<Status, { to: Status; label: string; primary?: boolean }[]>> = {
  needs_review: [{ to: "apply", label: "Approve for tailoring", primary: true }, { to: "dismissed", label: "Dismiss" }],
  apply: [{ to: "dismissed", label: "Dismiss" }],
  cv_ready: [{ to: "applied", label: "Mark applied", primary: true }, { to: "dismissed", label: "Dismiss" }],
  maybe: [{ to: "apply", label: "Move to apply", primary: true }, { to: "dismissed", label: "Dismiss" }],
  skip: [{ to: "apply", label: "Move to apply" }, { to: "dismissed", label: "Dismiss" }],
  applied: [{ to: "interview", label: "Got an interview", primary: true }, { to: "rejected", label: "Rejected" }],
  interview: [{ to: "rejected", label: "Rejected" }],
};

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative whitespace-pre-wrap rounded-lg border border-line bg-raised px-3.5 py-3 pr-20">
      <Button size="sm" className="absolute right-2 top-2" onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}>
        {done ? "Copied" : "Copy"}
      </Button>
      {text}
    </div>
  );
}

/** The posting text with flagged quotes highlighted. Built from text nodes, never HTML. */
function Highlighted({ text, quotes }: { text: string; quotes: string[] }) {
  const parts: ReactNode[] = [];
  let rest = text;
  let k = 0;
  for (;;) {
    const hits = quotes.map((q) => ({ q, i: rest.toLowerCase().indexOf(q.toLowerCase()) })).filter((h) => h.q && h.i >= 0).sort((a, b) => a.i - b.i);
    const h = hits[0];
    if (!h) break;
    parts.push(rest.slice(0, h.i), <mark className="bg-warning-wash text-inherit outline outline-1 outline-warning" key={k++}>{rest.slice(h.i, h.i + h.q.length)}</mark>);
    rest = rest.slice(h.i + h.q.length);
  }
  parts.push(rest);
  return <pre className="m-0 max-h-[420px] overflow-auto whitespace-pre-wrap font-sans text-[13px] text-ink-2">{parts}</pre>;
}

const Cites = ({ items }: { items: { text: string; sourceUrl: string }[] }) =>
  items.length ? (
    <List>
      {items.map((c, i) => (
        <li key={i}>
          {c.text} <a href={c.sourceUrl} target="_blank" rel="noreferrer">source</a>
        </li>
      ))}
    </List>
  ) : (
    <span className="text-muted">None found</span>
  );

/** A "## Heading" section's text from application.md (for applications tailored before the text was stored). */
const section = (md: string | null, heading: string) =>
  md?.split(/^## /m).find((s) => s.startsWith(`${heading}\n`))?.slice(heading.length).trim() ?? "(see application.md)";

const Facts = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 text-[13px]">
    {rows.map(([k, v]) => [<dt key={`k-${k}`} className="text-muted">{k}</dt>, <dd key={`v-${k}`} className="m-0">{v}</dd>])}
  </dl>
);

export function JobDetail({ id, back }: { id: string; back: () => void }) {
  const { data: job, error, refresh } = usePoll<Job>(`/api/jobs/${id}`, 10_000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <Banner tone="critical" title="Could not load this job">{error}</Banner>;
  if (!job) return <div className="text-muted">Loading…</div>;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setMsg(done);
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (to: Status) => act(() => post(`/api/jobs/${id}/status`, { status: to }), `Moved to ${to}`);
  const traps = (job.screen?.findings ?? []).filter((f) => f.kind !== "invisible-unicode");
  const v = job.vet;
  const s = job.signals;
  const c = job.companyProfile;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" onClick={back}>← Board</Button>
        <div className="min-w-[260px] flex-1">
          <h1 className="text-xl">{job.companyName}: {job.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2.5 text-muted">
            <StatusPill status={job.status} />
            <span>{job.location}</span>
            <a href={job.url} target="_blank" rel="noreferrer">Posting</a>
            {job.tailor ? <a href={`/api/jobs/${id}/cv`} target="_blank" rel="noreferrer">CV (PDF)</a> : null}
            <span>LLM cost {usd(job.cost)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(NEXT[job.status] ?? []).map((a) => (
            <Button key={a.to} variant={a.primary ? "primary" : "default"} disabled={busy} onClick={() => setStatus(a.to)}>{a.label}</Button>
          ))}
          {job.status === "apply" ? <Button variant="primary" disabled={busy} onClick={() => act(() => post("/api/actions/tailor"), "Tailoring started")}>Tailor now</Button> : null}
          <Button disabled={busy} onClick={() => setStatus("new")}>Re-vet</Button>
        </div>
      </div>
      {msg ? <div className="text-muted">{msg}</div> : null}

      {traps.length ? (
        <Banner tone="warning" title="This posting contains text aimed at AI. Write the application form yourself.">
          <List>{traps.map((f, i) => <li key={i}>({f.kind}) {f.quote}</li>)}</List>
        </Banner>
      ) : null}
      {job.tailor?.needsEdit?.length ? (
        <Banner tone="critical" title="Some claims in the application text need an edit">
          <List>{job.tailor.needsEdit.map((x, i) => <li key={i}>{x.where}: {x.problem}</li>)}</List>
        </Banner>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          {v ? (
            <Card title="Fit score">
              <p className="mb-2 mt-0 text-muted">{v.summary}</p>
              <ScoreBreakdown factors={v.factors} total={v.fitScore} />
            </Card>
          ) : null}
          {v ? (
            <Card title="Strengths and gaps">
              <H3>Strengths</H3>
              <List>{v.strengths.map((x, i) => <li key={i}>{x.point} <span className="text-muted">{x.cvBulletIds.join(", ")}</span></li>)}</List>
              <H3 className="mt-3">Gaps to prepare for</H3>
              <ul className="m-0 grid gap-1.5 pl-0">
                {v.gaps.map((g, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Pill tone={g.severity === "blocker" ? "critical" : g.severity === "major" ? "warning" : "neutral"}>{g.severity}</Pill>
                    <span>{g.point}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {job.tailor ? (
            <Card title="Application">
              <H3>Why us</H3>
              <Copy text={job.tailor.whyUs ?? section(job.application, "Why us")} />
              <H3 className="mt-3">Note to the hiring manager</H3>
              <Copy text={job.tailor.note ?? section(job.application, "Note to the hiring manager")} />
              <p className="mt-2 text-muted">Folder (in the applications volume): {job.tailor.dir}</p>
              <iframe className="h-[640px] w-full rounded-lg border border-line bg-white" src={`/api/jobs/${id}/cv`} title="Tailored CV" />
              {job.application ? (
                <details className="mt-3">
                  <summary className="cursor-pointer font-semibold text-ink-2">Everything in application.md (changes from your master CV)</summary>
                  <div className="mt-2"><Markdown source={job.application} /></div>
                </details>
              ) : null}
            </Card>
          ) : null}
          <Card title="Posting">
            <details>
              <summary className="cursor-pointer font-semibold text-ink-2">Show the original posting text{traps.length ? " (flagged text highlighted)" : ""}</summary>
              <div className="mt-2"><Highlighted text={job.description} quotes={traps.map((f) => f.quote)} /></div>
            </details>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card title="Facts">
            <Facts
              rows={[
                ["Pay band", `${s?.band.evidence || "not posted"}${s?.bandTopEur ? ` (top ${euro(s.bandTopEur)})` : ""}`],
                ["Workplace", s?.workplace.value ?? "–"],
                ["Years asked", s?.years.value ?? "not stated"],
                ["German", s?.german.value ?? "–"],
                ["Applicants", job.applicants || "unknown"],
                ["Posted", `${job.posted ? job.posted.slice(0, 10) : "unknown"} via ${job.source}`],
                ...(job.rejections.length ? ([["Filtered", job.rejections.join("; ")]] as [string, ReactNode][]) : []),
              ]}
            />
          </Card>
          {c ? (
            <Card title={`Company: ${c.name}`}>
              <p className="mb-3 mt-0">{c.oneLiner}</p>
              <Facts
                rows={[
                  ["Stage", c.stage],
                  ["Size", c.size ?? "unknown"],
                  ["Language", c.workingLanguage],
                  ["Website", c.website ? <a href={c.website} target="_blank" rel="noreferrer">{c.website}</a> : "not found"],
                  ["Reviews", <><a href={c.reviewLinks.glassdoor} target="_blank" rel="noreferrer">Glassdoor</a> · <a href={c.reviewLinks.kununu} target="_blank" rel="noreferrer">kununu</a></>],
                ]}
              />
              <p className="my-3">{c.outlook}</p>
              <H3>Funding</H3><Cites items={c.funding} />
              <H3 className="mt-2.5">Engineering culture</H3><Cites items={c.engineeringCulture} />
              <H3 className="mt-2.5">Red flags</H3><Cites items={c.redFlags} />
              <H3 className="mt-2.5">Material for "why us"</H3><Cites items={c.whyUsMaterial} />
              <p className="mb-0 mt-3 text-muted">Researched {c.researchedAt.slice(0, 10)}</p>
            </Card>
          ) : null}
          {v ? (
            <Card title="Requirements (as the tailor sees them)">
              <H3>Must have</H3><List>{v.requirements.mustHave.map((x, i) => <li key={i}>{x}</li>)}</List>
              <H3 className="mt-2.5">Nice to have</H3><List>{v.requirements.niceToHave.map((x, i) => <li key={i}>{x}</li>)}</List>
              <H3 className="mt-2.5">Stack</H3><p className="m-0">{v.requirements.techStack.join(", ")}</p>
              <H3 className="mt-2.5">Team</H3><p className="m-0">{v.requirements.teamContext}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
