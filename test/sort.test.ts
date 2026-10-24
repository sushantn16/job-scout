import { test } from "node:test";
import assert from "node:assert/strict";
import { isSortId, sortJobs } from "../dashboard/src/sort.ts";

const job = (companyName: string, o: Partial<{ score: number | null; posted: string; first_seen: string; applied_at: string | null; bandTopEur: number | null; title: string }> = {}) => ({
  companyName,
  title: o.title ?? "Engineer",
  score: o.score ?? null,
  posted: o.posted ?? "",
  first_seen: o.first_seen ?? "2026-10-01T00:00:00Z",
  applied_at: o.applied_at ?? null,
  bandTopEur: o.bandTopEur ?? null,
});
const names = (jobs: { companyName: string }[]) => jobs.map((j) => j.companyName);

test("best score first, unscored jobs last", () => {
  assert.deepEqual(names(sortJobs([job("a", { score: 70 }), job("b"), job("c", { score: 90 })], "score")), ["c", "a", "b"]);
});

test("newest uses the applied date, then the posted date, then when it was first seen", () => {
  const jobs = [
    job("posted", { posted: "2026-10-20" }),
    job("applied", { posted: "2026-10-01", applied_at: "2026-10-22T10:00:00Z" }),
    job("seen", { posted: "", first_seen: "2026-10-21T00:00:00Z" }),
    job("garbled", { posted: "last week", first_seen: "2026-10-05T00:00:00Z" }),
  ];
  assert.deepEqual(names(sortJobs(jobs, "newest")), ["applied", "seen", "posted", "garbled"]);
});

test("salary highest first, jobs without a band last, ties by score", () => {
  const jobs = [job("none", { score: 99 }), job("low", { bandTopEur: 80_000 }), job("high-a", { bandTopEur: 120_000, score: 60 }), job("high-b", { bandTopEur: 120_000, score: 80 })];
  assert.deepEqual(names(sortJobs(jobs, "salary")), ["high-b", "high-a", "low", "none"]);
});

test("company A–Z, then title, and the input is left alone", () => {
  const jobs = [job("Zeta"), job("acme", { title: "B" }), job("Acme", { title: "A" })];
  assert.deepEqual(sortJobs(jobs, "company").map((j) => j.title), ["A", "B", "Engineer"]);
  assert.deepEqual(names(jobs), ["Zeta", "acme", "Acme"]);
});

test("only known sort ids are accepted from storage", () => {
  assert.equal(isSortId("salary"), true);
  assert.equal(isSortId("price"), false);
  assert.equal(isSortId(null), false);
});
