// The job's application form: every question it asks, with the prepared answer to copy, the ones that need you, and
// saved answers you write once and reuse on every form. Nothing is filled in or submitted from here.
import { useState } from "react";
import { ago, post, type FormFieldPrep, type JobDetail } from "./api";
import { Button, Card, Copy, H3, List, Pill } from "./ui";

const input = "w-full rounded-md border border-line bg-raised px-2 py-1 text-ink";

const SOURCE: Record<FormFieldPrep["source"], { label: string; tone: "good" | "info" | "neutral" | "warning" }> = {
  saved: { label: "saved answer", tone: "good" },
  drafted: { label: "drafted, check it", tone: "info" },
  profile: { label: "from your CV", tone: "neutral" },
  file: { label: "file", tone: "neutral" },
  you: { label: "needs you", tone: "warning" },
};

const Question = ({ f }: { f: FormFieldPrep }) => (
  <span className="font-semibold text-ink">
    {f.question}
    {f.required ? <span className="text-muted"> (required)</span> : null}
  </span>
);

/** A saved-answer topic with its input: saving fills this question here and on every other form. */
function SaveAnswer({ topic, hint, onSaved }: { topic: string; hint: string; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<string | null>(null);
  return (
    <div className="mt-1.5 grid gap-1.5">
      <textarea className={input} rows={2} placeholder={hint} value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!value.trim()} onClick={() => post("/api/answers", { key: topic, value }).then(() => (setState("Saved for every form"), onSaved()), (e: Error) => setState(e.message))}>
          Save answer
        </Button>
        <span className="text-xs text-muted">{state ?? `Saved as "${topic}" and reused on every form`}</span>
      </div>
    </div>
  );
}

export function FormPanel({ job, onChange }: { job: JobDetail; onChange: () => void }) {
  const form = job.form;
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const read = (withUrl: boolean) =>
    post(`/api/jobs/${job.id}/form`, withUrl ? { url: url.trim() } : {}).then(
      () => setMsg("Reading the form and preparing answers. This takes about a minute; the panel updates by itself."),
      (e: Error) => setMsg(e.message),
    );
  const urlBox = (label: string) => (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className={`${input} min-w-[260px] flex-1`} type="url" placeholder="https://… the page with the application form" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Button variant="primary" disabled={!/^https?:\/\/\S+$/.test(url.trim())} onClick={() => read(true)}>{label}</Button>
    </div>
  );

  if (!form || "error" in form) {
    return (
      <Card title="Application form">
        <p className="m-0 text-muted">{form ? form.error : "The form hasn't been read yet."}</p>
        {form?.url ? <p className="mb-0 mt-1 text-muted">Tried: <a href={form.url} target="_blank" rel="noreferrer">{form.url}</a></p> : null}
        {urlBox("Read form")}
        {form?.url ? <Button className="mt-2" onClick={() => read(false)}>Try again</Button> : null}
        {msg ? <p className="mb-0 mt-2 text-muted">{msg}</p> : null}
      </Card>
    );
  }

  const needs = form.fields.filter((f) => f.needsYou);
  const answered = form.fields.filter((f) => f.kind === "question" && !f.needsYou);
  const profile = form.fields.filter((f) => (f.kind === "profile" || f.kind === "upload") && !f.needsYou);
  const yours = form.fields.filter((f) => (f.kind === "consent" || f.kind === "demographic") && !f.needsYou);

  return (
    <Card title="Application form" aside={<a href={form.url} target="_blank" rel="noreferrer">Open the form</a>}>
      <p className="mb-3 mt-0 text-muted">
        {form.fields.length} fields, {answered.length} answers prepared, {needs.length} need you · read {ago(form.readAt)} via {form.via}
      </p>

      {needs.length ? (
        <>
          <H3>Needs you</H3>
          <ul className="m-0 mb-3 grid gap-3 pl-0">
            {needs.map((f) => (
              <li key={f.id} className="list-none rounded-lg border border-warning bg-warning-wash px-3 py-2">
                <Question f={f} />
                {f.options?.length ? <div className="text-xs text-muted">Options: {f.options.join(" / ")}</div> : null}
                <div className="text-[13px] text-ink-2">{f.why}</div>
                {f.flagged ? <div className="text-[13px] text-ink-2">Flagged text: “{f.flagged}”</div> : null}
                {f.key && job.answerTopics[f.key] ? <SaveAnswer topic={f.key} hint={job.answerTopics[f.key]!} onSaved={onChange} /> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {answered.length ? (
        <>
          <H3>Prepared answers</H3>
          <ul className="m-0 grid gap-3 pl-0">
            {answered.map((f) => (
              <li key={f.id} className="list-none">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Question f={f} />
                  <Pill tone={f.problems.length ? "warning" : SOURCE[f.source].tone}>{f.problems.length ? "needs an edit" : SOURCE[f.source].label}</Pill>
                </div>
                {f.choice?.length ? <div className="mb-1">Choose: <strong>{f.choice.join(", ")}</strong></div> : null}
                {f.value && !(f.choice?.length && f.value === f.choice.join(", ")) ? <Copy text={f.value} /> : null}
                {f.problems.length ? <div className="mt-1 text-[13px] text-ink-2">Fix before using: {f.problems.join("; ")}</div> : null}
                <div className="mt-1 text-xs text-muted">{f.why}{f.maxLength ? ` · up to ${f.maxLength} characters` : ""}</div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {profile.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold text-ink-2">Profile fields and files ({profile.length})</summary>
          <List>{profile.map((f) => <li key={f.id}>{f.question}: {f.value ?? <span className="text-muted">{f.why}</span>}</li>)}</List>
        </details>
      ) : null}
      {yours.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold text-ink-2">Consent and voluntary questions ({yours.length})</summary>
          <List>{yours.map((f) => <li key={f.id}>{f.question} <span className="text-muted">({f.why})</span></li>)}</List>
        </details>
      ) : null}

      <details className="mt-2">
        <summary className="cursor-pointer text-ink-2">Read the form again, or from a different URL</summary>
        {urlBox("Read this form")}
        <Button className="mt-2" onClick={() => read(false)}>Read again</Button>
      </details>
      {msg ? <p className="mb-0 mt-2 text-muted">{msg}</p> : null}
    </Card>
  );
}
