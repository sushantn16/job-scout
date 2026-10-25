// The schema, and the changes older databases need to reach it. Run on every open; every step checks before it acts.
import type { DatabaseSync } from "node:sqlite";

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
-- Small facts about the database itself, e.g. when the search filters last changed (filtersChangedAt).
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA);
  // Databases created before the freshness window existed lack runs.since.
  const cols = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "since")) db.exec("ALTER TABLE runs ADD COLUMN since TEXT");
  if (!cols.some((c) => c.name === "kind")) db.exec("ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'scan'");
  const jobCols = new Set((db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name));
  // Columns added after the first schema; each stage stores its full JSON result for the dashboard.
  // `manual` marks a job you added by hand, which re-screening must leave queued.
  // `applied_at`, `replied_at` and `followed_up_at` time the application, for follow-ups and reply times.
  const jobColumns = [["hidden", "TEXT NOT NULL DEFAULT '[]'"], ["screen", "TEXT"], ["vet", "TEXT"], ["tailor", "TEXT"], ["company_key", "TEXT"], ["form", "TEXT"],
    ["manual", "INTEGER NOT NULL DEFAULT 0"], ["applied_at", "TEXT"], ["replied_at", "TEXT"], ["followed_up_at", "TEXT"],
    // The job's own posting on its company's board, for a job first seen on LinkedIn or HN.
    ["board_url", "TEXT"],
    // When the status last changed, so a job left in maybe can be skipped after a while.
    ["status_at", "TEXT"]] as const;
  for (const [col, def] of jobColumns) if (!jobCols.has(col)) db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`);
  // Jobs from before status_at: the last scoring result or status change in the event log, else when first seen.
  if (!jobCols.has("status_at")) {
    db.exec(`UPDATE jobs SET status_at = coalesce((SELECT max(at) FROM events e WHERE e.job_id = jobs.id
      AND (e.message LIKE 'status %' OR (e.stage = 'vet' AND e.message NOT LIKE 'failed%'))), first_seen)`);
  }
  // Triggers rather than every writer setting it: status is written from the scan, the vetter, the inbox and the dashboard.
  const at = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  db.exec(`CREATE TRIGGER IF NOT EXISTS jobs_status_at_insert AFTER INSERT ON jobs
    BEGIN UPDATE jobs SET status_at = ${at} WHERE id = NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS jobs_status_at_update AFTER UPDATE OF status ON jobs WHEN NEW.status IS NOT OLD.status
    BEGIN UPDATE jobs SET status_at = ${at} WHERE id = NEW.id; END;`);
  // Jobs applied to before the dates were kept: read them from the status changes in the event log.
  if (!jobCols.has("applied_at")) {
    const first = (to: string) => `(SELECT min(at) FROM events e WHERE e.job_id = jobs.id AND e.message LIKE '%→ ${to}%')`;
    db.exec(`UPDATE jobs SET applied_at = coalesce(${first("applied")}, ${first("interview")}, ${first("rejected")}) WHERE status IN ('applied', 'interview', 'rejected')`);
    db.exec(`UPDATE jobs SET replied_at = min(coalesce(${first("interview")}, '~'), coalesce(${first("rejected")}, '~')) WHERE status IN ('interview', 'rejected')`);
    db.exec("UPDATE jobs SET replied_at = NULL WHERE replied_at = '~'");
  }
  const callCols = new Set((db.prepare("PRAGMA table_info(llm_calls)").all() as { name: string }[]).map((c) => c.name));
  for (const col of ["cache_read_tokens", "cache_write_tokens"])
    if (!callCols.has(col)) db.exec(`ALTER TABLE llm_calls ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
}
