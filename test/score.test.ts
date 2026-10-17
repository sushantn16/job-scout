import { test } from "node:test";
import assert from "node:assert/strict";
import { fitScore, type Ratings, type Weights } from "../src/vet/score.ts";
import type { Signals } from "../src/filter/rules.ts";

const W: Weights = { roleFit: 25, stackOverlap: 20, seniority: 10, aiRelevance: 10, funding: 8, culture: 8, english: 7, pay: 7, competition: 5, remoteBonus: 1 };
const signals = (o: Partial<{ years: number | null; band: number | null; applicants: number | null; workplace: "remote" | "onsite" }> = {}): Signals => ({
  locationMatch: "berlin",
  german: { value: "none", evidence: "" },
  years: { value: o.years ?? null, evidence: "" },
  band: { value: null, evidence: "" },
  bandTopEur: o.band ?? null,
  workplace: { value: o.workplace ?? "onsite", evidence: "" },
  applicants: o.applicants ?? null,
});
const best: Ratings = { roleFit: 4, stackOverlap: 4, aiRelevance: 2, level: "senior", stageAndFunding: "good", engineeringCulture: "strong", englishFirst: "yes" };

test("weights sum to 100 before the remote bonus", () => {
  const { remoteBonus, ...rest } = W;
  assert.equal(Object.values(rest).reduce((a, b) => a + b, 0), 100);
});

test("a perfect match scores 100, and the remote bonus never pushes past 100", () => {
  assert.equal(fitScore(best, signals({ band: 150_000, applicants: 10 }), W).score, 100);
  assert.equal(fitScore(best, signals({ band: 150_000, applicants: 10, workplace: "remote" }), W).score, 100);
});

test("unknowns cost points but don't zero a factor", () => {
  const r = fitScore({ ...best, stageAndFunding: "unknown", engineeringCulture: "unknown", englishFirst: "unknown" }, signals(), W);
  // funding 4 + culture 4 + English 4.2 + pay 3.5 + competition 3 instead of 8 + 8 + 7 + 7 + 5
  assert.equal(r.score, 84);
});

test("years asked and level scale seniority", () => {
  const pts = (s: Signals, level: Ratings["level"]) => fitScore({ ...best, level }, s, W).factors.find((f) => f.factor === "seniority")!.points;
  assert.equal(pts(signals({ years: 4 }), "senior"), 10);
  assert.equal(pts(signals({ years: 5 }), "senior"), 8.5);
  assert.equal(pts(signals({ years: 6 }), "senior"), 6);
  assert.equal(pts(signals(), "mid"), 5);
  assert.equal(pts(signals(), "junior"), 0);
});

test("a mismatched corporate backend role lands well below maybe", () => {
  const r = fitScore({ roleFit: 1, stackOverlap: 1, aiRelevance: 0, level: "mid", stageAndFunding: "good", engineeringCulture: "unknown", englishFirst: "unknown" }, signals({ applicants: 200 }), W);
  assert.ok(r.score < 50, `got ${r.score}`);
});
