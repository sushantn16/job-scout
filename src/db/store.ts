import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Screened } from "../filter/rules.ts";
import type { EventStage } from "../pipeline/stages.ts";
import type { AtsKind } from "../sources/ats.ts";
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
-- Company job boards found from LinkedIn/HN jobs (src/pipeline/boards.ts); kind and slug are null when none was found.
CREATE TABLE IF NOT EXISTS boards (
  company_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT,
  slug TEXT,
  checked_at TEXT NOT NULL
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
    // `applied_at`, `replied_at` and `followed_up_at` time the application, for follow-ups and reply times.
    const jobColumns = [["hidden", "TEXT NOT NULL DEFAULT '[]'"], ["screen", "TEXT"], ["vet", "TEXT"], ["tailor", "TEXT"], ["company_key", "TEXT"], ["form", "TEXT"],
      ["manual", "INTEGER NOT NULL DEFAULT 0"], ["applied_at", "TEXT"], ["replied_at", "TEXT"], ["followed_up_at", "TEXT"],
      // The job's own posting on its company's board, for a job first seen on LinkedIn or HN.
      ["board_url", "TEXT"],
      // When the status last changed, so a job left in maybe can be skipped after a while.
      ["status_at", "TEXT"]] as const;
    for (const [col, def] of jobColumns) if (!jobCols.has(col)) this.db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`);
    // Jobs from before status_at: the last scoring result or status change in the event log, else when first seen.
    if (!jobCols.has("status_at")) {
      this.db.exec(`UPDATE jobs SET status_at = coalesce((SELECT max(at) FROM events e WHERE e.job_id = jobs.id
        AND (e.message LIKE 'status %' OR (e.stage = 'vet' AND e.message NOT LIKE 'failed%'))), first_seen)`);
    }
    // Triggers rather than every writer setting it: status is written from the scan, the vetter, the inbox and the dashboard.
    const at = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS jobs_status_at_insert AFTER INSERT ON jobs
      BEGIN UPDATE jobs SET status_at = ${at} WHERE id = NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS jobs_status_at_update AFTER UPDATE OF status ON jobs WHEN NEW.status IS NOT OLD.status
      BEGIN UPDATE jobs SET status_at = ${at} WHERE id = NEW.id; END;`);
    // Jobs applied to before the dates were kept: read them from the status changes in the event log.
    if (!jobCols.has("applied_at")) {
      const first = (to: string) => `(SELECT min(at) FROM events e WHERE e.job_id = jobs.id AND e.message LIKE '%→ ${to}%')`;
      this.db.exec(`UPDATE jobs SET applied_at = coalesce(${first("applied")}, ${first("interview")}, ${first("rejected")}) WHERE status IN ('applied', 'interview', 'rejected')`);
      this.db.exec(`UPDATE jobs SET replied_at = min(coalesce(${first("interview")}, '~'), coalesce(${first("rejected")}, '~')) WHERE status IN ('interview', 'rejected')`);
      this.db.exec("UPDATE jobs SET replied_at = NULL WHERE replied_at = '~'");
    }
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

  /** A run still "running" after `hours` was killed (a crash, a container restart): mark it failed so it stops blocking. */
  failStaleRuns(hours: number): void {
    this.db.prepare("UPDATE runs SET status = 'failed', finished_at = ? WHERE status = 'running' AND started_at <= ?")
      .run(now(), new Date(Date.now() - hours * 3_600_000).toISOString());
  }

  status(id: string): JobStatus | null {
    return (this.db.prepare("SELECT status FROM jobs WHERE id = ?").get(id) as { status: JobStatus } | undefined)?.status ?? null;
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
    const id = createHash("sha1").update(`${p.source}|${p.url}`).digest("hex").slice(0, 16);
    // The same job: the same source and URL (even if the employer has since renamed it), the same company and title
    // from any source, or the posting already known as a LinkedIn job's own posting. The same URL wins a tie.
    const existing = this.db.prepare("SELECT id, title FROM jobs WHERE id = ? OR dedupe_key = ? OR board_url = ? ORDER BY id = ? DESC LIMIT 1")
      .get(id, key, p.url, id) as { id: string; title: string } | undefined;
    if (existing) {
      // A renamed job takes its new title, unless another stored job already has it.
      if (existing.id === id && existing.title !== p.title)
        this.db.prepare("UPDATE jobs SET title = ?, dedupe_key = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM jobs WHERE dedupe_key = ? AND id <> ?)").run(p.title, key, id, key, id);
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

  /** Refresh what the rules read from a job's text, without touching its status. */
  updateSignals(id: string, s: Screened): void {
    this.db.prepare("UPDATE jobs SET signals = ? WHERE id = ?").run(JSON.stringify(s.signals), id);
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

  /**
   * Also keeps the application's dates: applying sets `applied_at` once, the first interview or rejection sets
   * `replied_at`, and moving back before applying (an undo, a re-vet) clears them.
   * With `from`, it changes only a job still in that status, so a slow stage can't undo a change made meanwhile.
   */
  setStatus(id: string, status: JobStatus, from?: JobStatus): void {
    const sent = ["applied", "interview", "rejected"].includes(status);
    const replied = status === "interview" || status === "rejected";
    const t = now();
    this.db.prepare(
      `UPDATE jobs SET status = ?,
         applied_at = CASE WHEN ? THEN coalesce(applied_at, ?) END,
         replied_at = CASE WHEN ? THEN coalesce(replied_at, ?) END,
         followed_up_at = CASE WHEN ? THEN followed_up_at END
       WHERE id = ?${from ? " AND status = ?" : ""}`,
    ).run(status, sent ? 1 : 0, t, replied ? 1 : 0, t, sent ? 1 : 0, id, ...(from ? [from] : []));
  }

  /** You chased an application up: the follow-up reminder starts again from today. */
  markFollowedUp(id: string): void {
    this.db.prepare("UPDATE jobs SET followed_up_at = ? WHERE id = ? AND status = 'applied'").run(now(), id);
  }

  /** Jobs left in maybe for `days` or more without a decision move to skip; returns the ones moved. */
  expireMaybes(days: number): { id: string; company: string; title: string }[] {
    const before = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.prepare("UPDATE jobs SET status = 'skip' WHERE status = 'maybe' AND status_at <= ? RETURNING id, company, title").all(before) as never;
  }

  /** Applications with no reply since they were sent, or last followed up, `days` or more ago. */
  followUpsDue(days: number): { id: string; company: string; title: string }[] {
    const before = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.prepare("SELECT id, company, title FROM jobs WHERE status = 'applied' AND coalesce(followed_up_at, applied_at) <= ?").all(before) as never;
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
  /** With `status`, the job moves only if it's still `from`: a dismissal made while the LLM was working stands. */
  saveStage(id: string, stage: "screen" | "vet" | "tailor" | "form", result: object, status?: { to: JobStatus; from: JobStatus }): void {
    this.db.prepare(`UPDATE jobs SET ${stage} = ?${status ? ", status = CASE WHEN status = ? THEN ? ELSE status END" : ""} WHERE id = ?`)
      .run(...(status ? [JSON.stringify(result), status.from, status.to, id] : [JSON.stringify(result), id]));
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

  /** A company's display name: from the config, else from the board found for it, else as the source gave it. */
  companyName(company: string, configured: Record<string, string>): string {
    return configured[company] ?? (this.db.prepare("SELECT name FROM boards WHERE slug = ?").get(company) as { name: string } | undefined)?.name ?? company;
  }

  /** Boards found for companies, to scan alongside the configured ones. */
  boards(): { kind: AtsKind; slug: string; name: string }[] {
    return this.db.prepare("SELECT kind, slug, name FROM boards WHERE slug IS NOT NULL ORDER BY name").all() as never;
  }

  /** The board found for a company: undefined if not checked in `maxAgeDays`, null if checked and none found. */
  board(key: string, maxAgeDays: number): { kind: AtsKind; slug: string } | null | undefined {
    const row = this.db.prepare("SELECT kind, slug, checked_at FROM boards WHERE company_key = ?").get(key) as { kind: AtsKind | null; slug: string | null; checked_at: string } | undefined;
    if (!row) return undefined;
    if (row.kind && row.slug) return { kind: row.kind, slug: row.slug };
    return Date.now() - Date.parse(row.checked_at) > maxAgeDays * 86_400_000 ? undefined : null;
  }

  saveBoard(key: string, name: string, found: { kind: AtsKind; slug: string } | null): void {
    this.db.prepare("INSERT INTO boards (company_key, name, kind, slug, checked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_key) DO UPDATE SET name = excluded.name, kind = excluded.kind, slug = excluded.slug, checked_at = excluded.checked_at")
      .run(key, name, found?.kind ?? null, found?.slug ?? null, now());
  }

  /** Jobs worth finding on their company's board: seen only on LinkedIn, HN or a pasted link, and still in play. */
  boardCandidates(): { id: string; company: string; title: string }[] {
    return this.db.prepare(
      `SELECT id, company, title FROM jobs WHERE source IN ('linkedin', 'hn', 'manual') AND board_url IS NULL
       AND status IN ('needs_review', 'apply', 'maybe', 'cv_ready', 'applied', 'interview') ORDER BY first_seen DESC`,
    ).all() as never;
  }

  setBoardUrl(id: string, url: string): void {
    this.db.prepare("UPDATE jobs SET board_url = ? WHERE id = ?").run(url, id);
  }

  boardUrl(id: string): string | null {
    return (this.db.prepare("SELECT board_url FROM jobs WHERE id = ?").get(id) as { board_url: string | null } | undefined)?.board_url ?? null;
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
  matchableJobs(): { id: string; company: string; title: string; status: JobStatus }[] {
    return this.db.prepare("SELECT id, company, title, status FROM jobs WHERE status <> 'dismissed'").all() as never;
  }
}
