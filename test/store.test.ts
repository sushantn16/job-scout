import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db/store.ts";
import { screen } from "../src/filter/rules.ts";
import { pasted } from "../src/sources/manual.ts";
import { posting } from "../src/sources/types.ts";

test("jobs are read one at a time by id, and the queue comes back best band first", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const store = new Store(join(dir, "test.db"));
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = store.startRun(new Date(), "scan");
    const text = "You will own product features end to end in TypeScript and React, with a small team in Berlin. ".repeat(2);
    const add = (company: string, band: string) => {
      const p = { ...pasted({ url: `https://careers.${company}.com/1`, company, title: "Product Engineer", location: "Berlin", description: `${text} Salary ${band}.` }), hiddenText: ["hidden note"] };
      return store.upsert(runId, screen(p, cfg), true).id;
    };
    const low = add("lowco", "€90,000 – €120,000");
    const high = add("highco", "€110,000 – €150,000");

    assert.equal(store.posting(high)?.company, "highco");
    assert.deepEqual(store.posting(high)?.hiddenText, ["hidden note"], "hidden text survives the round trip");
    assert.equal(store.posting("0000000000000000"), null);
    assert.deepEqual(store.queue(15).map((q) => q.id), [high, low]);
    assert.deepEqual(store.queue(1).map((q) => q.posting.company), ["highco"]);
    assert.deepEqual(store.postings(["new"]).map((j) => j.status), ["new", "new"], "stored status comes with each job");
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("application dates: set on applying and on the first reply, cleared when a job moves back", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const store = new Store(join(dir, "test.db"));
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = store.startRun(new Date(), "scan");
    const p = pasted({ url: "https://careers.acme.com/1", company: "Acme", title: "Product Engineer", location: "Berlin", description: "Own product features end to end in TypeScript. ".repeat(4) });
    const id = store.upsert(runId, screen(p, cfg), true).id;
    // node:sqlite rows have no prototype; spread them into plain objects to compare.
    const dates = () => ({ ...(store.db.prepare("SELECT applied_at AS a, replied_at AS r, followed_up_at AS f FROM jobs WHERE id = ?").get(id) as { a: string | null; r: string | null; f: string | null }) });

    store.setStatus(id, "applied");
    const applied = dates().a;
    assert.ok(applied && !dates().r);
    assert.deepEqual(store.followUpsDue(0).map((j) => j.id), [id], "due straight away with a 0-day wait");
    assert.deepEqual(store.followUpsDue(10), [], "not yet with a 10-day wait");
    store.markFollowedUp(id);
    assert.ok(dates().f);

    store.setStatus(id, "interview");
    const replied = dates().r;
    assert.ok(replied && dates().a === applied, "applying keeps its first date");
    assert.deepEqual(store.followUpsDue(0), [], "a reply ends the reminders");
    store.setStatus(id, "rejected");
    assert.equal(dates().r, replied, "the first reply counts, not the last");

    store.setStatus(id, "applied");
    assert.deepEqual([dates().a, dates().r], [applied, null], "undoing the reply clears it");
    store.setStatus(id, "cv_ready");
    assert.deepEqual(dates(), { a: null, r: null, f: null }, "undoing the application clears everything");
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("application dates: older databases get them from the status changes in the event log", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const path = join(dir, "test.db");
    const old = new Store(path);
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = old.startRun(new Date(), "scan");
    const p = pasted({ url: "https://careers.acme.com/2", company: "Acme", title: "Product Engineer", location: "Berlin", description: "Own product features end to end in TypeScript. ".repeat(4) });
    const id = old.upsert(runId, screen(p, cfg), true).id;
    old.event(runId, "dashboard", "status cv_ready → applied", "info", id);
    old.event(runId, "dashboard", "status applied → rejected", "info", id);
    old.db.prepare("UPDATE jobs SET status = 'rejected' WHERE id = ?").run(id);
    for (const col of ["applied_at", "replied_at", "followed_up_at"]) old.db.exec(`ALTER TABLE jobs DROP COLUMN ${col}`);
    const [applied, rejected] = (old.db.prepare("SELECT at FROM events WHERE job_id = ? ORDER BY id").all(id) as { at: string }[]).map((e) => e.at);
    old.db.close();

    const store = new Store(path);
    assert.deepEqual({ ...store.db.prepare("SELECT applied_at AS a, replied_at AS r FROM jobs WHERE id = ?").get(id) }, { a: applied, r: rejected });
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a job its employer renamed is the same job, not a new one (run 29 failed on this)", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const store = new Store(join(dir, "test.db"));
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = store.startRun(new Date(), "scan");
    const text = "Own product features end to end in TypeScript and React in Berlin. ".repeat(3);
    const at = (title: string, source: "ashby" | "linkedin" = "ashby", url = "https://jobs.ashbyhq.com/clickhouse/2344ae13") =>
      screen(posting({ source, company: "clickhouse", title, url, location: "Berlin", description: text }), cfg);

    const { id } = store.upsert(runId, at("Langfuse - Product Engineer, Integrations"), true);
    assert.deepEqual(store.upsert(runId, at("Langfuse - Senior Product Engineer, Integrations"), true), { id, isNew: false });
    assert.equal(store.posting(id)?.title, "Langfuse - Senior Product Engineer, Integrations", "it takes the new title");

    // Renamed to a title another stored job already has: still the same job, and the old title stays.
    const other = store.upsert(runId, at("Langfuse - Staff Product Engineer", "linkedin", "https://www.linkedin.com/jobs/view/9"), true).id;
    assert.deepEqual(store.upsert(runId, at("Langfuse - Staff Product Engineer"), true), { id, isNew: false });
    assert.equal(store.posting(id)?.title, "Langfuse - Senior Product Engineer, Integrations");
    assert.notEqual(other, id);
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a job left in maybe moves to skip after the set number of days, timed from when it became maybe", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const store = new Store(join(dir, "test.db"));
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = store.startRun(new Date(), "scan");
    const text = "You will own product features end to end in TypeScript and React, with a small team in Berlin. ".repeat(2);
    const add = (company: string) => store.upsert(runId, screen(pasted({ url: `https://careers.${company}.com/1`, company, title: "Product Engineer", location: "Berlin", description: text }), cfg), true).id;
    const [old, recent, applied] = [add("oldco"), add("recentco"), add("appliedco")];
    for (const id of [old, recent]) store.setStatus(id, "maybe");
    store.setStatus(applied, "applied");
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    store.db.prepare("UPDATE jobs SET status_at = ? WHERE id IN (?, ?)").run(daysAgo(6), old, applied);
    store.db.prepare("UPDATE jobs SET status_at = ? WHERE id = ?").run(daysAgo(2), recent);

    assert.deepEqual(store.expireMaybes(5).map((j) => j.id), [old]);
    const status = (id: string) => (store.db.prepare("SELECT status, status_at FROM jobs WHERE id = ?").get(id) as { status: string; status_at: string });
    assert.equal(status(old).status, "skip");
    assert.ok(Date.now() - Date.parse(status(old).status_at) < 60_000, "the move itself restarts the clock");
    assert.equal(status(recent).status, "maybe");
    assert.equal(status(applied).status, "applied", "only maybe jobs expire");
    assert.deepEqual(store.expireMaybes(5), [], "nothing left to move");
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status_at: set on insert and on every status change; older databases get it from the event log", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const path = join(dir, "test.db");
    let store = new Store(path);
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = store.startRun(new Date(), "scan");
    const text = "You will own product features end to end in TypeScript and React, with a small team in Berlin. ".repeat(2);
    const id = store.upsert(runId, screen(pasted({ url: "https://careers.acme.com/1", company: "acme", title: "Product Engineer", location: "Berlin", description: text }), cfg), true).id;
    const statusAt = () => (store.db.prepare("SELECT status_at FROM jobs WHERE id = ?").get(id) as { status_at: string | null }).status_at;
    assert.match(statusAt() ?? "", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, "same ISO form as the other dates");

    // An older database: no column, no triggers, a vet result in the event log.
    store.db.exec("DROP TRIGGER jobs_status_at_insert; DROP TRIGGER jobs_status_at_update; ALTER TABLE jobs DROP COLUMN status_at");
    store.db.prepare("INSERT INTO events (run_id, job_id, at, level, stage, message) VALUES (?, ?, ?, 'info', 'vet', 'maybe (70): ok')").run(runId, id, "2026-10-01T10:00:00.000Z");
    store.db.prepare("INSERT INTO events (run_id, job_id, at, level, stage, message) VALUES (?, ?, ?, 'error', 'vet', 'failed: later')").run(runId, id, "2026-10-03T10:00:00.000Z");
    store.db.close();
    store = new Store(path);
    assert.equal(statusAt(), "2026-10-01T10:00:00.000Z", "the last scoring result, not a failed attempt");

    store.setStatus(id, "maybe");
    assert.notEqual(statusAt(), "2026-10-01T10:00:00.000Z", "a status change moves it");
    const before = statusAt();
    store.setStatus(id, "maybe");
    assert.equal(statusAt(), before, "writing the same status again doesn't");
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a slow stage moves a job only if it's still where the stage found it", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const store = new Store(join(dir, "test.db"));
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = store.startRun(new Date(), "scan");
    const text = "You will own product features end to end in TypeScript and React, with a small team in Berlin. ".repeat(2);
    const add = (company: string) => store.upsert(runId, screen(pasted({ url: `https://careers.${company}.com/1`, company, title: "Product Engineer", location: "Berlin", description: text }), cfg), true).id;
    const [kept, moved] = [add("keptco"), add("movedco")];

    // Dismissed from the dashboard while the vetter was working: the vet result is saved, the dismissal stands.
    store.setStatus(moved, "dismissed");
    for (const id of [kept, moved]) store.saveStage(id, "vet", { fitScore: 90 }, { to: "apply", from: "new" });
    assert.equal(store.status(kept), "apply");
    assert.equal(store.status(moved), "dismissed");
    assert.ok(store.stage(moved, "vet"), "the result is kept either way");

    // Marked applied while its CV was being tailored: tailoring finishing doesn't move it back to cv_ready.
    store.setStatus(kept, "applied");
    store.setStatus(kept, "cv_ready", "apply");
    assert.equal(store.status(kept), "applied");
    assert.ok((store.db.prepare("SELECT applied_at FROM jobs WHERE id = ?").get(kept) as { applied_at: string | null }).applied_at, "applied date kept");
    assert.equal(store.status("0000000000000000"), null);
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run left running after a crash is closed as failed, a live one isn't", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const store = new Store(join(dir, "test.db"));
    const crashed = store.startRun(new Date(), "vet");
    const live = store.startRun(new Date(), "vet");
    store.db.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(new Date(Date.now() - 3 * 3_600_000).toISOString(), crashed);
    store.failStaleRuns(2);
    const status = (id: number) => (store.db.prepare("SELECT status, finished_at FROM runs WHERE id = ?").get(id) as { status: string; finished_at: string | null });
    assert.equal(status(crashed).status, "failed");
    assert.ok(status(crashed).finished_at);
    assert.equal(status(live).status, "running");
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a city added on Preferences: Re-check stored jobs scores the jobs the next scan had to call older", async () => {
  const { cpSync, mkdirSync, utimesSync, writeFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    // A repo-shaped folder: the example config, and a database where it happened as on 2026-10-24.
    cpSync("config", join(dir, "config"), { recursive: true });
    mkdirSync(join(dir, "data", "private"), { recursive: true });
    const cfg = loadConfig("config/job-scout.json", null);
    writeFileSync(join(dir, "data", "private", "search.json"), JSON.stringify({ locations: { ...cfg.locations, munich: "\\bmunich\\b" } }));
    const saved = new Date("2026-10-24T18:53:51Z");
    utimesSync(join(dir, "data", "private", "search.json"), saved, saved);
    const store = new Store(join(dir, "data", "job-scout.db"));
    assert.equal(store.filtersChangedAt()?.toISOString(), saved.toISOString(), "older databases take it from the last save");

    const scan = (startedAt: string, since: string) => {
      const id = store.startRun(new Date(since), "scan");
      store.db.prepare("UPDATE runs SET started_at = ?, status = 'done' WHERE id = ?").run(startedAt, id);
      return id;
    };
    const before = scan("2026-10-24T18:00:00Z", "2026-10-23T18:00:00Z");
    const after = scan("2026-10-24T18:54:49Z", "2026-10-23T18:54:49Z");
    const later = scan("2026-10-25T12:00:00Z", "2026-10-24T18:54:49Z");
    assert.equal(store.firstScanAfter(saved), after);

    const text = "You will own product features end to end in TypeScript and React, with a small team. ".repeat(2);
    const add = (runId: number, company: string, posted: string) => {
      const p = { ...pasted({ url: `https://careers.${company}.com/1`, company, title: "Product Engineer", location: "Munich", description: text }), posted };
      return store.upsert(runId, screen(p, loadConfig(join(dir, "config", "job-scout.json"), join(dir, "data", "private", "search.json"))), false).id;
    };
    const tacto = add(after, "tacto", "2026-10-16");       // 8 days before that scan: within 14 days
    const tanso = add(after, "tanso", "2026-08-24");       // two months old: stays older
    const elsewhere = add(later, "laterco", "2026-10-16"); // found by a normal scan: its window applies
    add(before, "beforeco", "2026-10-16");
    store.db.close();

    execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(process.cwd(), "src/cli/rescreen.ts")], { cwd: dir, stdio: "pipe" });
    const after2 = new Store(join(dir, "data", "job-scout.db"));
    assert.equal(after2.status(tacto), "new", "queued for scoring");
    assert.equal(after2.status(tanso), "stale");
    assert.equal(after2.status(elsewhere), "stale");
    after2.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
