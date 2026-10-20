import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db/store.ts";
import { screen } from "../src/filter/rules.ts";
import { pasted } from "../src/sources/manual.ts";

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
