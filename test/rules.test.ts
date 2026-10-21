import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { isRelevant } from "../src/filter/rules.ts";
import { posting } from "../src/sources/types.ts";

const cfg = loadConfig("config/job-scout.json", null);
const relevant = (title: string) => isRelevant(posting({ source: "ashby", company: "acme", title, url: "https://x", location: "Berlin" }), cfg);

test("titles: hardware design and AI-training gigs are dropped before any LLM call", () => {
  // All six got past the title filter and were stored before 2026-10-20; two were scored (28 and 36).
  for (const t of [
    "ASIC Design Engineer",
    "Structural Engineer — AI Task Creator (OpenSees)",
    "Mechanical Design Engineer (Remote | $60–$120/hr)",
    "High Voltage Substation Design Engineer",
    "Design Engineer CREO (m/w/d) | Mechanical Design | Berlin",
    "Antenna Design Engineer / RF Integration Specialist (all gender)",
  ]) assert.equal(relevant(t), false, t);
});

test("titles: product, full-stack, design and AI engineering roles stay", () => {
  for (const t of ["Senior Product Engineer", "Design Engineer - EU", "Senior Design Engineer", "Full-Stack Engineer - ElevenMusic", "Senior AI Engineer (f/m/d)", "Forward Deployed Engineer"])
    assert.equal(relevant(t), true, t);
});
