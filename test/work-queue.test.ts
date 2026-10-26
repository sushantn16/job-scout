import { test } from "node:test";
import assert from "node:assert/strict";
import { workQueue } from "../src/http.ts";

/** A task that finishes when told to, so a test can see what's running at each moment. */
function tasks() {
  const running = new Set<string>();
  let peak = 0;
  const finish = new Map<string, () => void>();
  const work = (id: string) => new Promise<string>((resolve) => {
    running.add(id);
    peak = Math.max(peak, running.size);
    finish.set(id, () => (running.delete(id), resolve(`done ${id}`)));
  });
  return { running, work, finish: (id: string) => finish.get(id)!(), peak: () => peak };
}
const tick = () => new Promise((r) => setImmediate(r));

test("items start the moment they're added, at most `limit` at a time", async () => {
  const t = tasks();
  const q = workQueue(2, t.work);
  q.add("a");
  await tick();
  assert.deepEqual([...t.running], ["a"], "starts at once, without waiting for more items");
  q.add("b");
  q.add("c");
  await tick();
  assert.deepEqual([...t.running], ["a", "b"], "c waits for a slot");
  t.finish("a");
  await tick();
  assert.deepEqual([...t.running].sort(), ["b", "c"], "c takes the freed slot");
  q.add("d");
  t.finish("b");
  t.finish("c");
  await tick();
  t.finish("d");
  assert.deepEqual(await q.done(), ["done a", "done b", "done c", "done d"]);
  assert.equal(t.peak(), 2);
});

test("a freed slot can't be taken twice when an item is added at the same moment", async () => {
  const t = tasks();
  const q = workQueue(1, t.work);
  q.add("a");
  q.add("b");
  await tick();
  t.finish("a");
  q.add("c"); // added in the same turn the slot is handed to b
  await tick();
  assert.deepEqual([...t.running], ["b"]);
  t.finish("b");
  await tick();
  t.finish("c");
  await q.done();
  assert.equal(t.peak(), 1);
});

test("duplicates are ignored and the cap counts every item added", async () => {
  const t = tasks();
  const q = workQueue(4, t.work, 2);
  assert.equal(q.add("a"), true);
  assert.equal(q.add("a"), false, "duplicate");
  assert.equal(q.add("b"), true);
  assert.equal(q.add("c"), false, "over the cap");
  await tick();
  t.finish("a");
  t.finish("b");
  assert.deepEqual(await q.done(), ["done a", "done b"]);
});
