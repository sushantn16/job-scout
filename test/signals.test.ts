// Cases are real sentences from postings seen on 2026-10-17.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applicantCount, germanRequirement, salaryBand, workplace, yearsRequired } from "../src/filter/signals.ts";

test("German: required phrasings", () => {
  for (const s of [
    "Are able to speak English and German fluently.", // OpenAI Applied AI Engineer, Codex
    "Much of this work happens in German, with German executives and engineering teams, so native or fluent German is essential for the role.", // Anthropic
    "Fluent written and spoken English and German — both are required, as you'll work closely with German-speaking customers.", // Staffbase
    "You speak fluent German (C1+) and English.", // Langdock FDE
    "Native German speaker with fluent English proficiency",
    "If applying for Germany- it is a requirement that you are able to speak business level or fluent German", // Helsing
    "Du verfügst über gute Deutschkenntnisse und arbeitest gerne eng mit unseren Praxisteams zusammen.",
  ]) assert.equal(germanRequirement(s).value, "required", s);
});

test("German: optional phrasings are a plus, not a blocker", () => {
  for (const s of [
    "Languages: Fluent in English, German is a plus.", // Statista
    "German fluency is a plus.", // Wolters Kluwer Libra
    "Fluent German is a big plus, to improve the interaction between you and our customers.", // Nelly
  ]) assert.equal(germanRequirement(s).value, "plus", s);
});

test("German: country and market mentions are not language requirements", () => {
  for (const s of [
    "Headquartered in Chemnitz, Germany and New York City.",
    "We started with roofers in Germany.",
    "positioning to resonate with enterprise decision-makers in the German market",
    // Statista, falsely rejected in run 1: "level" belongs to "Junior-level", not to German.
    "Some of the benefits listed here apply only to the German entity and to Junior-level roles or above.",
  ]) assert.equal(germanRequirement(s).value, "none", s);
});

test("German: postings written in German count as required", () => {
  const de =
    "Warum das zählt: Rund ein Viertel der Menschen in Deutschland benötigt jedes Jahr Physiotherapie. Wir bauen die Software für die Praxen. " +
    "Du arbeitest eng mit unseren Praxisteams zusammen und bist für die Qualität der Produkte mit verantwortlich. Wir bieten dir eine Rolle mit viel Verantwortung, " +
    "flexible Arbeitszeiten und ein Team, das sich auf dich freut. Bei uns arbeitest du mit modernen Tools und mit einer Mission, die zählt und die wir mit dir teilen.";
  assert.equal(germanRequirement(de).value, "required");
});

test("years: experience requirements", () => {
  assert.equal(yearsRequired("WHAT WE'RE LOOKING FOR - 5+ years of professional fullstack engineering experience").value, 5);
  assert.equal(yearsRequired("8+ years building and operating backend systems in production, with 3+ years shipping LLM/GenAI features").value, 8);
  assert.equal(yearsRequired("3–5+ years of experience in full-stack development (React, Next.js)").value, 3);
  // Cosuno, missed in the first ranking run: no "experience" word, just "writing production-grade".
  assert.equal(yearsRequired("Strong Python: You have 5+ years writing production-grade Python").value, 5);
});

test("years: company trivia is ignored", () => {
  assert.equal(yearsRequired("SENIOR PRODUCT ENGINEER — posted 5 years ago").value, null);
  assert.equal(yearsRequired("a one-month fully paid sabbatical after every 4 years of working at Upvest").value, null);
  assert.equal(yearsRequired("Our Staff Engineer Who Has Been With Us For Over 4 Years").value, null);
});

test("salary: published bands", () => {
  assert.deepEqual(salaryBand("€90K – €140K • Offers Equity", "").value, { min: 90_000, max: 140_000, currency: "EUR" });
  assert.deepEqual(salaryBand("€72.8K – €144.4K • Offers Equity • Multiple Ranges", "").value, { min: 72_800, max: 144_400, currency: "EUR" });
  assert.deepEqual(salaryBand("£90K – £135K", "").value, { min: 90_000, max: 135_000, currency: "GBP" });
  assert.deepEqual(salaryBand("", "Range for Senior Engineer : EU: €90,000 - 125,000 (base salary) + equity").value, { min: 90_000, max: 125_000, currency: "EUR" });
  assert.deepEqual(salaryBand("", "You're building interactive AI tools. EUR 60-90k").value, { min: 60_000, max: 90_000, currency: "EUR" });
  assert.deepEqual(salaryBand("", "Compensation: €65k-90k + 25% of your base salary in equity").value, { min: 65_000, max: 90_000, currency: "EUR" });
});

test("salary: market sizes and counts are not bands", () => {
  assert.equal(salaryBand("", "Industrial procurement is a €900B market in Europe alone").value, null);
  assert.equal(salaryBand("", "They do more than €700 billion of work a year").value, null);
});

test("workplace and applicants", () => {
  assert.equal(workplace("OnSite", "").value, "onsite");
  assert.equal(workplace("", "This is a Berlin based on-site role").value, "onsite");
  assert.equal(workplace("", "Hybrid working: We are usually in our Berlin office 3 days a week").value, "hybrid");
  assert.equal(applicantCount("Over 200 applicants"), 200);
  assert.equal(applicantCount("Be among the first 25 applicants"), 25);
});
