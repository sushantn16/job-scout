// Add a job the scan didn't find. A board link (Ashby, Greenhouse, Lever, Personio) is enough; for anything else the
// server answers 422 with needsDetails, and the details fields open for you to paste into.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, post, type Added } from "./api";
import { Button, statusLabel } from "./ui";

const input = "w-full rounded-md border border-line bg-raised px-2 py-1.5 text-ink";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[13px] text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export function AddJob({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string, message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  const [form, setForm] = useState({ url: "", company: "", title: "", location: "", description: "" });
  const [details, setDetails] = useState(false);
  const [score, setScore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<Added>("/api/jobs", { ...(details ? form : { url: form.url }), score });
      const scoring = r.scoring ? " Scoring it now; this page updates in about a minute." : r.status === "new" ? " It's queued for the next run." : "";
      onAdded(r.id, r.isNew ? `Added.${scoring}` : `Already tracked as ${statusLabel(r.status)}.${scoring}`);
    } catch (err) {
      if (err instanceof ApiError && err.body.needsDetails) setDetails(true);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="add-job-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(640px,calc(100vw-2rem))] overflow-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="grid gap-3.5 p-5">
        <h2 id="add-job-title" className="text-base">Add a job</h2>
        <p className="m-0 text-[13px] text-muted">
          Paste the posting's link. Ashby, Greenhouse, Lever and Personio links are read from the board itself. For anything
          else (LinkedIn, a company's careers page), paste the details too.
        </p>
        <Field label="Link to the posting">
          <input className={input} type="url" required autoFocus placeholder="https://jobs.ashbyhq.com/…" value={form.url} onChange={set("url")} />
        </Field>
        {details ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company"><input className={input} required value={form.company} onChange={set("company")} /></Field>
              <Field label="Job title"><input className={input} required value={form.title} onChange={set("title")} /></Field>
            </div>
            <Field label="Location (optional)"><input className={input} placeholder="Berlin, hybrid" value={form.location} onChange={set("location")} /></Field>
            <Field label="The full posting text">
              <textarea className={input} required minLength={100} rows={7} value={form.description} onChange={set("description")} />
            </Field>
          </>
        ) : (
          <button type="button" className="cursor-pointer justify-self-start text-[13px] text-accent-ink underline" onClick={() => setDetails(true)}>
            Paste the details yourself
          </button>
        )}
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={score} onChange={(e) => setScore(e.target.checked)} />
          Score it now: injection screen, company research and fit score (about a minute, around $0.10)
        </label>
        {error ? <div role="alert" className="rounded-lg border border-warning bg-warning-wash px-3 py-2 text-[13px]">{error}</div> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Adding…" : "Add job"}</Button>
        </div>
      </form>
    </dialog>
  );
}
