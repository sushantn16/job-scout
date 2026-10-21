import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db/store.ts";
import { screen } from "../src/filter/rules.ts";
import { sameJob, slugCandidates, titleKey } from "../src/sources/discover.ts";
import { posting } from "../src/sources/types.ts";

test("board slugs: joined, hyphenated and first word, without legal suffixes", () => {
  assert.deepEqual(slugCandidates("think-cell"), ["thinkcell", "think-cell", "think"]);
  assert.deepEqual(slugCandidates("Peec AI"), ["peecai", "peec-ai", "peec"]);
  assert.deepEqual(slugCandidates("Acme Software GmbH"), ["acmesoftware", "acme-software", "acme"]);
  assert.deepEqual(slugCandidates("Databricks"), ["databricks"]);
  assert.deepEqual(slugCandidates("go"), [], "too short to guess");
});

test("titles match across LinkedIn's and the board's spelling, never on a generic phrase", () => {
  const board = (...titles: string[]) => titles.map((title) => posting({ source: "ashby", company: "x", title, url: `https://x/${title}` }));
  assert.equal(titleKey("Senior Engineer (m/f/d) - All Genders"), "senior engineer");
  assert.equal(sameJob(board("Founding Engineer", "Designer"), "Founding Engineer (m/f/d)")?.title, "Founding Engineer");
  assert.equal(sameJob(board("Senior Fullstack Engineer"), "Senior Fullstack Engineer - AI Health tech")?.title, "Senior Fullstack Engineer", "one posting contains the other");
  assert.equal(sameJob(board("Senior Fullstack Engineer, Payments", "Senior Fullstack Engineer, Growth"), "Senior Fullstack Engineer"), null, "ambiguous");
  assert.equal(sameJob(board("Software Engineer, Platform"), "Software Engineer"), null, "two words is too generic");
});

test("a board posting known as a LinkedIn job's own posting is that job, not a new one", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-"));
  try {
    const store = new Store(join(dir, "test.db"));
    const cfg = loadConfig("config/job-scout.json", null);
    const runId = store.startRun(new Date(), "scan");
    const text = "Own product features end to end in TypeScript and React in Berlin. ".repeat(3);
    const linkedin = posting({ source: "linkedin", company: "VREY", title: "Full-Stack Product Engineer, Ruby on Rails (m/f/d) at Stealth", url: "https://www.linkedin.com/jobs/view/1", location: "Berlin", description: text });
    const id = store.upsert(runId, screen(linkedin, cfg), true).id;
    store.setBoardUrl(id, "https://jobs.ashbyhq.com/vrey/abc");
    const own = posting({ source: "ashby", company: "vrey", title: "Full-Stack Product Engineer, Ruby on Rails", url: "https://jobs.ashbyhq.com/vrey/abc", location: "Berlin", description: text });
    assert.deepEqual(store.upsert(runId, screen(own, cfg), true), { id, isNew: false });

    assert.equal(store.board("vrey", 30), undefined, "not checked yet");
    store.saveBoard("vrey", "VREY", { kind: "ashby", slug: "vrey" });
    assert.deepEqual({ ...store.board("vrey", 30) }, { kind: "ashby", slug: "vrey" });
    assert.equal(store.companyName("vrey", {}), "VREY", "a found board's slug shows the company's name");
    assert.equal(store.companyName("vrey", { vrey: "Vrey Inc" }), "Vrey Inc", "the config wins");
    store.saveBoard("acme", "Acme", null);
    assert.equal(store.board("acme", 30), null, "checked, none found");
    assert.equal(store.board("acme", -1), undefined, "a miss is checked again later");
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
