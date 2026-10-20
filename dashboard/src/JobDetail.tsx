import { useState, type ReactNode } from "react";
import { ago, euro, post, usd, usePoll, type JobDetail as Job, type Status } from "./api";
import { ScoreBreakdown } from "./charts";
import { Markdown } from "./Markdown";
import { FormPanel } from "./FormPanel";
import { Banner, Button, Card, Copy, H3, List, Pill, StatusPill, Tabs } from "./ui";

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
  return <pre className="m-0 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-2">{parts}</pre>;
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

type Tab = "apply" | "fit" | "company" | "posting";

export function JobDetail({ id, back, notify }: { id: string; back: () => void; notify: (m: string) => void }) {
  const { data: job, error, refresh } = usePoll<Job>(`/api/jobs/${id}`, 10_000);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  if (error) return <Banner tone="critical" title="Could not load this job">{error}</Banner>;
  if (!job) return <div className="text-muted">Loading…</div>;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      notify(done);
      refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (to: Status) => act(() => post(`/api/jobs/${id}/status`, { status: to }), `Moved to ${to === "new" ? "the queue for re-vetting" : to}`);
  const traps = (job.screen?.findings ?? []).filter((f) => f.kind !== "invisible-unicode");
  const v = job.vet;
  const s = job.signals;
  const c = job.companyProfile;
  const recruiter = v?.recruiter ?? (s?.recruiter?.value ? { kind: "recruiter" as const, evidence: s.recruiter.evidence } : null);

  // The tab that fits where the job is: applying once there's something to apply with, else why it scored as it did.
  const tabs: { id: Tab; label: string }[] = [
    ...(job.tailor || job.form ? [{ id: "apply" as const, label: "Apply" }] : []),
    ...(v ? [{ id: "fit" as const, label: "Fit" }] : []),
    ...(c ? [{ id: "company" as const, label: "Company" }] : []),
    { id: "posting", label: traps.length ? "Posting (flagged)" : "Posting" },
  ];
  const current = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0]!.id;

  return (
    <div className="grid gap-4">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2.5" onClick={back}>← Back</Button>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[280px] flex-1">
          <div className="text-[13px] font-semibold text-ink-2">{job.companyName}</div>
          <h1 className="text-xl">{job.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <StatusPill status={job.status} />
            {job.location ? <span>{job.location}</span> : null}
            <a href={job.url} target="_blank" rel="noreferrer">Original posting ↗</a>
            {job.tailor ? <a href={`/api/jobs/${id}/cv`} target="_blank" rel="noreferrer">CV (PDF) ↗</a> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(NEXT[job.status] ?? []).map((a) => (
            <Button key={a.to} variant={a.primary ? "primary" : "default"} disabled={busy} onClick={() => setStatus(a.to)}>{a.label}</Button>
          ))}
          {job.status === "apply" ? <Button variant="primary" disabled={busy} onClick={() => act(() => post("/api/actions/tailor"), "Tailoring started")}>Tailor now</Button> : null}
          {job.status === "applied" ? (
            <Button disabled={busy} onClick={() => act(() => post(`/api/jobs/${id}/followed-up`), "Noted. The follow-up reminder starts again today")} title="Record that you chased this application up">
              Followed up
            </Button>
          ) : null}
          {job.status === "new" ? (
            <Button variant="primary" disabled={busy} onClick={() => act(() => post("/api/actions/vet"), "Scoring the queue; this page updates when it's done")}>Score now</Button>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setStatus("new")} title="Queue it to be screened and scored again">Re-vet</Button>
          )}
        </div>
      </div>

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
      {!v && job.status === "new" ? <Banner tone="info" title="Queued for scoring">This job hasn't been screened and scored yet. This page updates when it has.</Banner> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-4">
          <Tabs tabs={tabs} value={current} onChange={setTab} />

          {current === "apply" ? (
            <>
              {job.tailor ? (
                <Card title="Application text">
                  <H3>Why us</H3>
                  <Copy text={job.tailor.whyUs ?? section(job.application, "Why us")} />
                  <H3 className="mt-3">Note to the hiring manager</H3>
                  <Copy text={job.tailor.note ?? section(job.application, "Note to the hiring manager")} />
                </Card>
              ) : null}
              {job.tailor || job.form ? <FormPanel job={job} onChange={refresh} /> : null}
              {job.tailor ? (
                <Card title="Tailored CV" aside={<a href={`/api/jobs/${id}/cv`} target="_blank" rel="noreferrer" className="text-[13px] font-normal">Open the PDF ↗</a>}>
                  <iframe className="aspect-[210/297] w-full rounded-lg border border-line bg-white" src={`/api/jobs/${id}/cv`} title="Tailored CV" />
                  <p className="mb-0 mt-2 text-xs text-muted">Folder (in the applications volume): {job.tailor.dir}</p>
                  {job.application ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer font-semibold text-ink-2">Every change from your master CV (application.md)</summary>
                      <div className="mt-2"><Markdown source={job.application} /></div>
                    </details>
                  ) : null}
                </Card>
              ) : null}
            </>
          ) : null}

          {current === "fit" && v ? (
            <>
              <Card title="Fit score">
                <p className="mb-2 mt-0 text-ink-2">{v.summary}</p>
                <ScoreBreakdown factors={v.factors} total={v.fitScore} />
              </Card>
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
              <Card title="Requirements (as the tailor sees them)">
                <H3>Must have</H3><List>{v.requirements.mustHave.map((x, i) => <li key={i}>{x}</li>)}</List>
                <H3 className="mt-2.5">Nice to have</H3><List>{v.requirements.niceToHave.map((x, i) => <li key={i}>{x}</li>)}</List>
                <H3 className="mt-2.5">Stack</H3><p className="m-0">{v.requirements.techStack.join(", ")}</p>
                <H3 className="mt-2.5">Team</H3><p className="m-0">{v.requirements.teamContext}</p>
                <H3 className="mt-2.5">What the application should emphasise</H3><p className="m-0">{v.tailoringAngle}</p>
              </Card>
            </>
          ) : null}

          {current === "company" && c ? (
            <Card title={c.name} aside={<span className="text-xs font-normal text-muted">Researched {c.researchedAt.slice(0, 10)}</span>}>
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
              <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                <div><H3>Funding</H3><Cites items={c.funding} /></div>
                <div><H3>Engineering culture</H3><Cites items={c.engineeringCulture} /></div>
                <div><H3>Red flags</H3><Cites items={c.redFlags} /></div>
                <div><H3>Material for "why us"</H3><Cites items={c.whyUsMaterial} /></div>
              </div>
            </Card>
          ) : null}

          {current === "posting" ? (
            <Card title="Original posting" aside={traps.length ? <span className="text-xs font-normal text-muted">Flagged text is highlighted</span> : undefined}>
              <Highlighted text={job.description} quotes={traps.map((f) => f.quote)} />
            </Card>
          ) : null}
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-4">
          <Card>
            {v ? (
              <div className="mb-3 border-b border-grid pb-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[30px] font-semibold leading-none tabular-nums">{v.fitScore}</span>
                  <span className="text-muted">/ 100 fit</span>
                </div>
                {current !== "fit" ? <button className="mt-1.5 cursor-pointer text-left text-[13px] text-accent-ink hover:underline" onClick={() => setTab("fit")}>See why</button> : null}
              </div>
            ) : null}
            <Facts
              rows={[
                ["Pay band", `${s?.band.evidence || "not posted"}${s?.bandTopEur ? ` (top ${euro(s.bandTopEur)})` : ""}`],
                ["Workplace", s?.workplace.value ?? "–"],
                ["Years asked", s?.years.value ?? "not stated"],
                ["German", s?.german.value ?? "–"],
                ["Applicants", job.applicants || "unknown"],
                ["Posted", job.posted ? job.posted.slice(0, 10) : "unknown"],
                ...(job.applied_at ? ([["Applied", `${job.applied_at.slice(0, 10)} (${ago(job.applied_at)})`]] as [string, ReactNode][]) : []),
                ...(job.followed_up_at ? ([["Followed up", job.followed_up_at.slice(0, 10)]] as [string, ReactNode][]) : []),
                ...(job.replied_at && job.applied_at
                  ? ([["Reply", `after ${Math.round(((Date.parse(job.replied_at) - Date.parse(job.applied_at)) / 86_400_000) * 10) / 10} d`]] as [string, ReactNode][])
                  : []),
                ...(recruiter
                  ? ([["Posted by", `${recruiter.kind === "reposted" ? "a job board reposting it" : "a recruiter"}${recruiter.evidence ? `: “${recruiter.evidence}”` : ""}`]] as [string, ReactNode][])
                  : []),
                ["Source", job.manual ? (job.source === "manual" ? "added by you" : `added by you (${job.source})`) : job.source],
                ["LLM cost", usd(job.cost)],
                ...(job.rejections.length ? ([["Hard rules", job.rejections.join("; ")]] as [string, ReactNode][]) : []),
              ]}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}
