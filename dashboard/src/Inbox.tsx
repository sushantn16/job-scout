import { useState } from "react";
import { ago, post, usePoll, type JobRow, type Status } from "./api";
import { td, th } from "./Board";
import { Button, Card, Pill, StatusPill } from "./ui";

interface Email {
  id: number;
  received_at: string;
  from_addr: string;
  subject: string;
  snippet: string;
  kind: "confirmation" | "rejection" | "interview" | "unclear" | "ignored";
  rule: string;
  job_id: string | null;
  match_reason: string | null;
  from_status: Status | null;
  to_status: Status | null;
  undone: number;
  companyName: string | null;
  title: string | null;
}

const KIND_TONE = { confirmation: "info", rejection: "critical", interview: "good", unclear: "warning", ignored: "neutral" } as const;

function Resolve({ email, jobs, done }: { email: Email; jobs: JobRow[]; done: () => void }) {
  const [jobId, setJobId] = useState(email.job_id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const send = (kind: string) => post(`/api/inbox/${email.id}/resolve`, { jobId: jobId || undefined, kind }).then(done, (e: Error) => setErr(e.message));
  return (
    <div className="grid gap-2 rounded-lg border border-line bg-raised p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{email.subject || "(no subject)"}</strong>
        <span className="text-xs text-muted">{email.from_addr} · {ago(email.received_at)}</span>
      </div>
      <p className="m-0 text-[13px] text-ink-2">{email.snippet}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={jobId} onChange={(e) => setJobId(e.target.value)} className="max-w-[340px] rounded-md border border-line bg-raised px-1.5 py-1 text-ink">
          <option value="">Which job is this about?</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.companyName}: {j.title}</option>)}
        </select>
        <Button size="sm" disabled={!jobId} onClick={() => send("confirmation")}>Confirmation</Button>
        <Button size="sm" disabled={!jobId} onClick={() => send("interview")}>Interview</Button>
        <Button size="sm" disabled={!jobId} onClick={() => send("rejection")}>Rejection</Button>
        <Button size="sm" variant="ghost" onClick={() => send("ignored")}>Ignore</Button>
        {err ? <span className="text-xs text-critical">{err}</span> : null}
      </div>
    </div>
  );
}

export function Inbox() {
  const { data: emails, refresh } = usePoll<Email[]>("/api/inbox", 10_000);
  const { data: jobs } = usePoll<JobRow[]>("/api/jobs", 30_000);
  const [msg, setMsg] = useState<string | null>(null);
  if (!emails) return <div className="text-muted">Loading…</div>;
  const needsYou = emails.filter((e) => e.kind !== "ignored" && (e.kind === "unclear" || !e.job_id));
  const handled = emails.filter((e) => !needsYou.includes(e));
  const undo = (id: number) => post(`/api/inbox/${id}/undo`).then(() => (setMsg("Undone"), refresh()), (e: Error) => setMsg(e.message));

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => post("/api/actions/inbox").then(() => setMsg("Checking Gmail… results appear here and in the run log"), (e: Error) => setMsg(e.message))}>
          Check inbox now
        </Button>
        <span className="text-muted">Also checked automatically at the start of every pipeline run.{msg ? ` ${msg}` : ""}</span>
      </div>

      {emails.length === 0 ? (
        <Card title="Connect Gmail">
          <ol className="m-0 grid list-decimal gap-1.5 pl-5">
            <li>Turn on 2-step verification for your Google account, then create an app password at myaccount.google.com/apppasswords (name it "job-scout").</li>
            <li>Store it in the macOS Keychain from a terminal: <code className="rounded bg-hover px-1">security add-generic-password -U -s job-scout-imap -a you@gmail.com -w</code> (it prompts for the password, so it never lands in your shell history).</li>
            <li>Add <code className="rounded bg-hover px-1">JOB_SCOUT_IMAP_USER=you@gmail.com</code> to <code className="rounded bg-hover px-1">.env</code>, then press "Check inbox now". The first time, macOS asks whether node may use the Keychain item: choose "Always Allow".</li>
          </ol>
          <p className="mb-0 mt-2 text-muted">Only applicant-tracking senders and companies you applied to are read, the mailbox is opened read-only, and no email text goes to an LLM.</p>
        </Card>
      ) : null}

      {needsYou.length ? (
        <Card title={`Needs you (${needsYou.length})`} aside={<span className="text-[13px] font-normal text-muted">The rules couldn't classify these or match them to a job</span>}>
          <div className="grid gap-2">{needsYou.map((e) => <Resolve key={e.id} email={e} jobs={jobs ?? []} done={refresh} />)}</div>
        </Card>
      ) : null}

      {handled.length ? (
        <Card title="Handled">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>{["Received", "Email", "Job", "Read as", "Change", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {handled.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} whitespace-nowrap text-muted`}>{ago(e.received_at)}</td>
                  <td className={td}>
                    <div>{e.subject}</div>
                    <div className="text-xs text-muted">{e.from_addr}{e.rule ? ` · matched "${e.rule}"` : ""}</div>
                  </td>
                  <td className={td}>{e.job_id ? <a href={`#/job/${e.job_id}`}>{e.companyName}: {e.title}</a> : <span className="text-muted">–</span>}</td>
                  <td className={td}><Pill tone={KIND_TONE[e.kind]}>{e.kind}</Pill></td>
                  <td className={td}>
                    {e.to_status ? (
                      <span className="inline-flex items-center gap-1.5">
                        {e.from_status ? <StatusPill status={e.from_status} /> : null}→<StatusPill status={e.to_status} />
                        {e.undone ? <span className="text-xs text-muted">(undone)</span> : null}
                      </span>
                    ) : <span className="text-muted">no change</span>}
                  </td>
                  <td className={td}>{e.to_status && !e.undone ? <Button size="sm" onClick={() => undo(e.id)}>Undo</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
