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
