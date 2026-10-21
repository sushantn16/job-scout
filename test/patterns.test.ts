import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { joinTerms, lines, placePattern, terms } from "../dashboard/src/patterns.ts";

test("filter patterns survive the Preferences page's one-term-per-line editing unchanged", () => {
  for (const path of ["config/job-scout.json", "config/job-scout.local.json"].filter(existsSync)) {
    const cfg = loadConfig(path, null);
    for (const p of [cfg.titleInclude, cfg.titleExclude, cfg.companyExclude]) assert.equal(joinTerms(lines(terms(p))), p, `${path}: ${p.slice(0, 40)}`);
  }
});

test("top-level alternatives only: groups, classes and escapes stay whole", () => {
  assert.deepEqual(terms(String.raw`full[- ]?stack|engineer.*(agent|\bai\b|llm)|c\+\+|a\|b|[|]x`), ["full[- ]?stack", String.raw`engineer.*(agent|\bai\b|llm)`, String.raw`c\+\+`, String.raw`a\|b`, "[|]x"]);
});

test("a place pattern matches the names given, also next to letters \\b can't handle", () => {
  const re = new RegExp(placePattern(["Munich", "München"]), "i");
  assert.ok(re.test("Munich, Bavaria") && re.test("München (hybrid)") && !re.test("Munichtown"));
  const malmo = new RegExp(placePattern(["Malmö"]), "i");
  assert.ok(malmo.test("Malmö, Sweden") && malmo.test("Remote: Malmö"));
});
