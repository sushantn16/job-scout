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
