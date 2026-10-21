import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db/store.ts";
import { screen } from "../src/filter/rules.ts";
import { formTarget } from "../src/forms/read.ts";
import { boardOf, pasted } from "../src/sources/manual.ts";

test("board links: Ashby, Greenhouse, Lever and Personio postings are read from their board", () => {
  assert.deepEqual(boardOf("https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff"), { kind: "ashby", slug: "linear", jobId: "d3bc1ced-3ce4-4086-a050-555055dbb1ff" });
  assert.deepEqual(boardOf("https://jobs.ashbyhq.com/Peec%20AI/d3bc1ced-3ce4-4086-a050-555055dbb1ff/application"), { kind: "ashby", slug: "Peec AI", jobId: "d3bc1ced-3ce4-4086-a050-555055dbb1ff" });
  assert.deepEqual(boardOf("https://job-boards.greenhouse.io/vercel/jobs/6129441004"), { kind: "greenhouse", slug: "vercel", jobId: "6129441004" });
  assert.deepEqual(boardOf("https://boards.greenhouse.io/embed/job_app?for=vercel&token=6129441004"), { kind: "greenhouse", slug: "vercel", jobId: "6129441004" });
  assert.deepEqual(boardOf("https://jobs.eu.lever.co/qonto/489aaf09-447c-4a8a-b79d-bb65d0e568ef/apply"), { kind: "lever", slug: "qonto", jobId: "489aaf09-447c-4a8a-b79d-bb65d0e568ef" });
  assert.deepEqual(boardOf("https://acme.jobs.personio.de/job/1234567?language=en"), { kind: "personio", slug: "acme", jobId: "1234567" });
});

test("board links: anything else needs the details pasted", () => {
  assert.equal(boardOf("https://www.linkedin.com/jobs/view/4479616772"), null);
  assert.equal(boardOf("https://careers.doodle.com/jobs/8556332-senior-software-engineer"), null);
  assert.equal(boardOf("https://jobs.ashbyhq.com/linear"), null, "a board's front page is not a job");
  assert.equal(boardOf("not a url"), null);
});

test("a job added from a LinkedIn link has no form to read until you paste one", () => {
  assert.equal(formTarget({ source: "manual", company: "Acme", url: "https://www.linkedin.com/jobs/view/4479616772" }), null);
  assert.deepEqual(formTarget({ source: "manual", company: "Acme", url: "https://careers.acme.com/jobs/123-engineer" }), { via: "page", url: "https://careers.acme.com/jobs/123-engineer/applications/new" });
});

test("adding by hand queues the job even when a hard rule would filter it, and re-queues a filtered one", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const store = new Store(join(dir, "test.db"));
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = store.startRun(new Date(), "vet");
    const text = "We build developer tools. You will own features end to end in TypeScript and React. ".repeat(3);
    const job = pasted({ url: "https://careers.acme.com/jobs/1", company: "Acme", title: "Senior Product Engineer", location: "Berlin", description: `${text} Fluent German is required.` });
    const s = screen(job, cfg);
    assert.ok(s.rejections.length > 0, "the German rule rejects it");

    const first = store.addByHand(runId, s);
    assert.deepEqual([first.isNew, first.status], [true, "new"]);
    assert.deepEqual(store.queue(15, [first.id]).map((q) => q.id), [first.id], "the vet run can be limited to this job");
    assert.equal(store.postings(["new"]).find((p) => p.id === first.id)?.manual, true, "marked, so re-screening leaves it queued");

    store.setStatus(first.id, "filtered");
    assert.deepEqual(store.addByHand(runId, s), { id: first.id, isNew: false, status: "new" }, "a filtered job is queued again");

    store.setStatus(first.id, "applied");
    assert.deepEqual(store.addByHand(runId, s), { id: first.id, isNew: false, status: "applied" }, "a job you're already working on stays put");
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
