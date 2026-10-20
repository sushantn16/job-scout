import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Screened } from "../filter/rules.ts";
import type { EventStage } from "../pipeline/stages.ts";
import type { Posting } from "../sources/types.ts";

// Job lifecycle. M1 writes `new`, `filtered` and `stale`; later stages are claimed by the LLM workers.
export type JobStatus =
  | "new" | "filtered" | "stale" | "screened" | "needs_review" | "apply" | "maybe" | "skip"
  | "cv_ready" | "applied" | "interview" | "rejected" | "dismissed";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'scan',
  since TEXT,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  stats TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL, company TEXT NOT NULL, title TEXT NOT NULL, location TEXT NOT NULL,
  url TEXT NOT NULL, description TEXT NOT NULL, comp TEXT NOT NULL, workplace TEXT NOT NULL,
  applicants TEXT NOT NULL, posted TEXT NOT NULL, hidden TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  signals TEXT NOT NULL,
  rejections TEXT NOT NULL,
  first_run INTEGER NOT NULL REFERENCES runs(id),
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS companies (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile TEXT NOT NULL,
  researched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES runs(id),
  job_id TEXT,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  kind TEXT NOT NULL,
  rule TEXT NOT NULL,
  job_id TEXT REFERENCES jobs(id),
  match_reason TEXT,
  from_status TEXT,
  to_status TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  run_id INTEGER,
  processed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES runs(id),
  job_id TEXT REFERENCES jobs(id),
  at TEXT NOT NULL,
  level TEXT NOT NULL,
  stage TEXT NOT NULL,
  message TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();
const norm = (s: string) =>
  s.toLowerCase()
    .replace(/\((?:[mfwdx]\/){1,3}[mfwdx]\)|\(all genders?\)|\b[mfwdx]\/[mfwdx]\/[mfwdx]\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Hard-rule rejections win over staleness: the reason is more useful in the dashboard. */
export const statusFor = (s: Screened, fresh: boolean): JobStatus => (s.rejections.length ? "filtered" : fresh ? "new" : "stale");

export const companyKey = (company: string) => norm(company).replace(/ /g, "");

export const dedupeKey = (company: string, title: string) => `${norm(company).replace(/ /g, "")}|${norm(title)}`;

type JobRow = Omit<Posting, "hiddenText"> & { id: string; status: JobStatus; first_run: number; manual: number; hidden: string };

/** A stored job as the pipeline reads it. */
export interface StoredJob { id: string; status: JobStatus; firstRun: number; manual: boolean; posting: Posting }

const toJob = ({ id, status, first_run, manual, hidden, source, company, title, location, url, description, comp, workplace, applicants, posted }: JobRow): StoredJob => ({
  id,
  status,
  firstRun: first_run,
  manual: manual === 1,
  posting: { source, company, title, location, url, description, comp, workplace, applicants, posted, hiddenText: JSON.parse(hidden) as string[] },
});

export class Store {
  readonly db: DatabaseSync;

  constructor(path = "data/job-scout.db") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    // Databases created before the freshness window existed lack runs.since.
    const cols = this.db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "since")) this.db.exec("ALTER TABLE runs ADD COLUMN since TEXT");
    if (!cols.some((c) => c.name === "kind")) this.db.exec("ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'scan'");
    const jobCols = new Set((this.db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name));
    // Columns added after the first schema; each stage stores its full JSON result for the dashboard.
    // `manual` marks a job you added by hand, which re-screening must leave queued.
    for (const [col, def] of [["hidden", "TEXT NOT NULL DEFAULT '[]'"], ["screen", "TEXT"], ["vet", "TEXT"], ["tailor", "TEXT"], ["company_key", "TEXT"], ["form", "TEXT"], ["manual", "INTEGER NOT NULL DEFAULT 0"]] as const)
      if (!jobCols.has(col)) this.db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`);
    const callCols = new Set((this.db.prepare("PRAGMA table_info(llm_calls)").all() as { name: string }[]).map((c) => c.name));
    for (const col of ["cache_read_tokens", "cache_write_tokens"])
      if (!callCols.has(col)) this.db.exec(`ALTER TABLE llm_calls ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
  }

  /** Most recent run of any kind, for attaching dashboard events; 0 if none. */
  latestRunId(): number {
    return (this.db.prepare("SELECT max(id) AS id FROM runs").get() as { id: number | null }).id ?? 0;
  }

  lastSuccessfulRunStart(): Date | null {
    const row = this.db.prepare("SELECT started_at FROM runs WHERE status = 'done' AND kind = 'scan' ORDER BY id DESC LIMIT 1").get() as { started_at: string } | undefined;
    return row ? new Date(row.started_at) : null;
  }

  /** Freshness window start recorded for a run; older runs fall back to 24 hours before their start. */
  runSince(id: number): Date {
    const row = this.db.prepare("SELECT started_at, since FROM runs WHERE id = ?").get(id) as { started_at: string; since: string | null };
    return new Date(row.since ?? new Date(Date.parse(row.started_at) - 24 * 3_600_000).toISOString());
  }

  /** `vet` runs only process the queue; they must not move the freshness window, which follows `scan` runs. */
  startRun(since: Date, kind: "scan" | "vet" | "inbox" = "scan"): number {
    return Number(this.db.prepare("INSERT INTO runs (started_at, since, kind) VALUES (?, ?, ?)").run(now(), since.toISOString(), kind).lastInsertRowid);
  }

  finishRun(id: number, status: "done" | "failed", stats: object): void {
    this.db.prepare("UPDATE runs SET finished_at = ?, status = ?, stats = ? WHERE id = ?").run(now(), status, JSON.stringify(stats), id);
  }

  event(runId: number, stage: EventStage, message: string, level: "info" | "warn" | "error" = "info", jobId?: string): void {
    this.db.prepare("INSERT INTO events (run_id, job_id, at, level, stage, message) VALUES (?, ?, ?, ?, ?, ?)")
      .run(runId, jobId ?? null, now(), level, stage, message);
  }

  /** True if this company+title has been stored before (from any source). */
  seen(company: string, title: string): boolean {
    return this.db.prepare("SELECT 1 FROM jobs WHERE dedupe_key = ?").get(dedupeKey(company, title)) !== undefined;
  }

  /** Insert a new job, or only refresh last_seen if it already exists. Returns whether it was new. */
  upsert(runId: number, s: Screened, fresh: boolean): { id: string; isNew: boolean } {
    const p = s.posting;
    const key = dedupeKey(p.company, p.title);
    const existing = this.db.prepare("SELECT id FROM jobs WHERE dedupe_key = ?").get(key) as { id: string } | undefined;
    if (existing) {
      // Refresh fields the source may correct, but only from the source the job was stored from: a LinkedIn
      // sighting of an Ashby job must not overwrite Ashby's own dates. Status is decided once, at first sight.
      this.db.prepare(
        `UPDATE jobs SET last_seen = ?,
           posted = CASE WHEN source = ? AND ? <> '' THEN ? ELSE posted END,
           comp = CASE WHEN source = ? AND ? <> '' THEN ? ELSE comp END,
           applicants = CASE WHEN source = ? AND ? <> '' THEN ? ELSE applicants END
         WHERE id = ?`,
      ).run(now(), p.source, p.posted, p.posted, p.source, p.comp, p.comp, p.source, p.applicants, p.applicants, existing.id);
      return { id: existing.id, isNew: false };
    }
    const id = createHash("sha1").update(`${p.source}|${p.url}`).digest("hex").slice(0, 16);
    const t = now();
    this.db.prepare(
      `INSERT INTO jobs (id, dedupe_key, source, company, title, location, url, description, comp, workplace, applicants, posted, hidden,
         status, signals, rejections, first_run, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, key, p.source, p.company, p.title, p.location, p.url, p.description, p.comp, p.workplace, p.applicants, p.posted, JSON.stringify(p.hiddenText),
      statusFor(s, fresh), JSON.stringify(s.signals), JSON.stringify(s.rejections), runId, t, t,
    );
    return { id, isNew: true };
  }

  /**
   * A job you added by hand: stored like a scanned one, then queued for scoring even if a hard rule rejects it, since
   * you chose it. A job seen before but never scored (filtered, or older than the window) is queued again; any other
   * known job is left where it is.
   */
  addByHand(runId: number, s: Screened): { id: string; isNew: boolean; status: JobStatus } {
    const { id, isNew } = this.upsert(runId, s, true);
    const { status } = this.db.prepare("SELECT status FROM jobs WHERE id = ?").get(id) as { status: JobStatus };
    if (!isNew && status !== "filtered" && status !== "stale") return { id, isNew, status };
    this.db.prepare("UPDATE jobs SET status = 'new', manual = 1 WHERE id = ?").run(id);
    return { id, isNew, status: "new" };
  }

  /** Stored postings in the given statuses, for re-screening after a rule or config change. */
  postings(statuses: JobStatus[]): StoredJob[] {
    const rows = this.db.prepare(`SELECT * FROM jobs WHERE status IN (${statuses.map(() => "?").join(",")})`).all(...statuses);
    return (rows as unknown as JobRow[]).map(toJob);
  }

  posting(id: string): Posting | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? toJob(row).posting : null;
  }

  updateScreen(id: string, s: Screened, fresh: boolean): void {
    this.db.prepare("UPDATE jobs SET status = ?, signals = ?, rejections = ? WHERE id = ?")
      .run(statusFor(s, fresh), JSON.stringify(s.signals), JSON.stringify(s.rejections), id);
  }

  /** Jobs whose company and title contain the given fragments (case-insensitive). */
  find(company: string, title: string): { id: string; company: string; title: string; status: JobStatus }[] {
    return this.db.prepare("SELECT id, company, title, status FROM jobs WHERE company LIKE ? AND title LIKE ?")
      .all(`%${company}%`, `%${title}%`) as never;
  }

  setStatus(id: string, status: JobStatus): void {
    this.db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  }

  company(key: string, maxAgeDays: number): unknown | null {
    const row = this.db.prepare("SELECT profile, researched_at FROM companies WHERE key = ?").get(key) as { profile: string; researched_at: string } | undefined;
    if (!row || Date.now() - Date.parse(row.researched_at) > maxAgeDays * 86_400_000) return null;
    return JSON.parse(row.profile);
  }

  saveCompany(key: string, name: string, profile: object): void {
    this.db.prepare("INSERT INTO companies (key, name, profile, researched_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, profile = excluded.profile, researched_at = excluded.researched_at")
      .run(key, name, JSON.stringify(profile), now());
  }

  recordCall(runId: number, jobId: string | null, c: { role: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; ms: number; ok: boolean; error?: string }): void {
    this.db.prepare("INSERT INTO llm_calls (run_id, job_id, role, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, ms, ok, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(runId, jobId, c.role, c.model, c.inputTokens, c.outputTokens, c.cacheReadTokens, c.cacheWriteTokens, c.ms, c.ok ? 1 : 0, c.error ?? null, now());
  }

  /** Persist one stage's result on the job. */
  saveStage(id: string, stage: "screen" | "vet" | "tailor" | "form", result: object, status?: JobStatus): void {
    this.db.prepare(`UPDATE jobs SET ${stage} = ?${status ? ", status = ?" : ""} WHERE id = ?`).run(...(status ? [JSON.stringify(result), status, id] : [JSON.stringify(result), id]));
  }

  stage<T>(id: string, stage: "screen" | "vet" | "tailor" | "form"): T | null {
    const row = this.db.prepare(`SELECT ${stage} AS v FROM jobs WHERE id = ?`).get(id) as { v: string | null } | undefined;
    return row?.v ? (JSON.parse(row.v) as T) : null;
  }

  /** Jobs vetted "apply" and not yet tailored, best score first. */
  tailorQueue(limit: number): string[] {
    return (this.db.prepare(
      "SELECT id FROM jobs WHERE status = 'apply' ORDER BY coalesce(json_extract(vet, '$.fitScore'), 0) DESC LIMIT ?",
    ).all(limit) as { id: string }[]).map((r) => r.id);
  }

  setCompanyKey(id: string, key: string): void {
    this.db.prepare("UPDATE jobs SET company_key = ? WHERE id = ?").run(key, id);
  }

  /** Jobs waiting for the LLM stages, best first: highest posted band, then fewest applicants, then newest. `only` limits it to those IDs. */
  queue(limit: number, only?: string[]): { id: string; posting: Posting }[] {
    const where = only?.length ? `AND id IN (${only.map(() => "?").join(",")})` : "";
    const rows = this.db.prepare(
      `SELECT * FROM jobs WHERE status = 'new' ${where}
       ORDER BY coalesce(json_extract(signals, '$.bandTopEur'), 0) DESC, coalesce(json_extract(signals, '$.applicants'), 100) ASC, posted DESC
       LIMIT ?`,
    ).all(...(only ?? []), limit) as unknown as JobRow[];
    return rows.map(toJob).map(({ id, posting }) => ({ id, posting }));
  }

  hasEmail(messageId: string): boolean {
    return this.db.prepare("SELECT 1 FROM emails WHERE message_id = ?").get(messageId) !== undefined;
  }

  saveEmail(e: {
    messageId: string; receivedAt: string; from: string; subject: string; snippet: string; kind: string; rule: string;
    jobId: string | null; matchReason: string | null; fromStatus: string | null; toStatus: string | null; runId: number;
  }): void {
    this.db.prepare(
      `INSERT INTO emails (message_id, received_at, from_addr, subject, snippet, kind, rule, job_id, match_reason, from_status, to_status, run_id, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(e.messageId, e.receivedAt, e.from, e.subject, e.snippet, e.kind, e.rule, e.jobId, e.matchReason, e.fromStatus, e.toStatus, e.runId, now());
  }

  /** Every job an email might be about: all but dismissed ones (you may apply to an older or skipped job yourself). */
  matchableJobs(): { id: string; company: string; title: string; status: string }[] {
    return this.db.prepare("SELECT id, company, title, status FROM jobs WHERE status <> 'dismissed'").all() as never;
  }
}
