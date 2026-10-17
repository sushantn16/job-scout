import { test } from "node:test";
import assert from "node:assert/strict";
import { isFresh, windowStart } from "../src/filter/freshness.ts";

const at = (s: string) => new Date(s);

test("window: the next run reaches back to the last one, however long ago", () => {
  const since = windowStart(at("2026-10-19T14:00:00Z"), at("2026-10-16T14:00:00Z"), 24, 72);
  assert.equal(since.toISOString(), "2026-10-16T14:00:00.000Z");
});

test("window: a re-run an hour later still looks back 24 hours", () => {
  const since = windowStart(at("2026-10-20T15:00:00Z"), at("2026-10-20T14:00:00Z"), 24, 72);
  assert.equal(since.toISOString(), "2026-10-19T15:00:00.000Z");
});

test("window: after a long break it is capped at 14 days", () => {
  const since = windowStart(at("2026-11-30T14:00:00Z"), at("2026-10-20T14:00:00Z"), 24, 336);
  assert.equal(since.toISOString(), "2026-11-16T14:00:00.000Z");
  assert.equal(windowStart(at("2026-10-27T14:00:00Z"), at("2026-10-20T14:00:00Z"), 24, 336).toISOString(), "2026-10-20T14:00:00.000Z");
});

test("window: first ever run uses 24 hours", () => {
  assert.equal(windowStart(at("2026-10-20T14:00:00Z"), null, 24, 72).toISOString(), "2026-10-19T14:00:00.000Z");
});

test("fresh: timestamps, bare dates and undated postings", () => {
  const since = at("2026-10-16T14:00:00Z");
  assert.equal(isFresh("2026-10-16T15:30:00.000Z", since), true);
  assert.equal(isFresh("2026-10-16T09:00:00.000Z", since), false);
  assert.equal(isFresh("2026-10-16", since), true, "same calendar day counts");
  assert.equal(isFresh("2026-10-15", since), false);
  assert.equal(isFresh("", since), true);
});
