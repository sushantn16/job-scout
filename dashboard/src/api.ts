import { useCallback, useEffect, useRef, useState } from "react";

export type Status =
  | "new" | "filtered" | "stale" | "screened" | "needs_review" | "apply" | "maybe" | "skip"
  | "cv_ready" | "applied" | "interview" | "rejected" | "dismissed";

export interface Run {
  id: number;
  kind: "scan" | "vet";
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "failed";
  since: string | null;
  stats: Record<string, unknown> | null;
  cost: number;
}

export interface Summary {
  runs: Run[];
  counts: Partial<Record<Status, number>>;
  cost30d: number;
  running: Run | null;
  pricingNote: string;
  nextWindowStart: string;
}

export interface JobRow {
  id: string;
  company: string;
  /** Display name from config (board slugs like "peec" become "Peec AI"). */
  companyName: string;
  title: string;
  status: Status;
  source: string;
  url: string;
  posted: string;
  applicants: string;
  location: string;
  first_seen: string;
  bandTopEur: number | null;
  workplace: string | null;
  score: number | null;
  decision: string | null;
  summary: string | null;
  flagged: number | null;
  findings: number | null;
  rejection: string | null;
}

export interface Factor { factor: string; weight: number; value: number; points: number; basis: string }
export interface Finding { layer: "pattern" | "llm"; kind: string; quote: string; intent?: string }
export interface Cited { text: string; sourceUrl: string }

export interface JobDetail extends Omit<JobRow, "score" | "decision" | "summary" | "flagged" | "findings" | "rejection"> {
  description: string;
  signals: { german: { value: string; evidence: string }; years: { value: number | null; evidence: string }; band: { evidence: string }; bandTopEur: number | null; workplace: { value: string } } | null;
  rejections: string[];
  screen: { findings: Finding[]; needsReview: boolean } | null;
  vet: {
    fitScore: number;
    decision: string;
    summary: string;
    factors: Factor[];
    strengths: { point: string; cvBulletIds: string[] }[];
    gaps: { point: string; severity: "blocker" | "major" | "minor" }[];
    culture: { englishFirst: string; engineeringCulture: string; stageAndFunding: string; notes: string };
    requirements: { mustHave: string[]; niceToHave: string[]; responsibilities: string[]; techStack: string[]; seniority: string; teamContext: string };
    tailoringAngle: string;
  } | null;
  tailor: { dir: string; cvFile: string; whyUs?: string; note?: string; emphasis?: string; headline?: string; needsEdit: { where: string; problem: string }[] } | null;
  application: string | null;
  companyProfile: {
    name: string; website: string | null; oneLiner: string; stage: string; size: string | null; outlook: string; workingLanguage: string;
    funding: Cited[]; engineeringCulture: Cited[]; redFlags: Cited[]; whyUsMaterial: Cited[];
    reviewLinks: { glassdoor: string; kununu: string }; researchedAt: string;
  } | null;
  cost: number;
  form: FormState | null;
  /** Saved-answer topics and what each holds. */
  answerTopics: Record<string, string>;
}

export interface FormFieldPrep {
  id: string;
  question: string;
  type: "text" | "textarea" | "choice" | "multi" | "boolean" | "file" | "email" | "tel" | "number" | "date" | "url";
  required: boolean;
  options?: string[];
  maxLength?: number;
  description?: string;
  kind: "profile" | "upload" | "consent" | "demographic" | "question";
  value: string | null;
  choice?: string[];
  key?: string;
  source: "profile" | "saved" | "drafted" | "file" | "you";
  needsYou: boolean;
  why: string;
  problems: string[];
  flagged?: string;
}
export type FormState = { url: string; via: string; readAt: string; fields: FormFieldPrep[] } | { url?: string; error: string };

export interface Event { id: number; run_id: number; job_id: string | null; at: string; level: "info" | "warn" | "error"; stage: string; message: string }

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Writes always send JSON: the server rejects anything else, which keeps other sites from posting to localhost. */
export async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? String(res.status));
  return data;
}

/** Fetch now and every `ms`; keeps the last good value while refetching, so the view never flashes. */
export function usePoll<T>(path: string | null, ms: number): { data: T | null; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const load = useCallback(() => {
    if (!path) return;
    getJson<T>(path).then((d) => live.current && (setData(d), setError(null)), (e: Error) => live.current && setError(e.message));
  }, [path]);
  useEffect(() => {
    live.current = true;
    load();
    const t = setInterval(load, ms);
    return () => ((live.current = false), clearInterval(t));
  }, [load, ms]);
  return { data, error, refresh: load };
}

export const euro = (n: number | null) => (n == null ? "–" : `€${Math.round(n / 1000)}K`);
export const usd = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n < 10 ? 2 : 0)}`);
export const ago = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const h = (Date.now() - t) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`;
};
export const duration = (a: string, b: string | null) => {
  const s = Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
