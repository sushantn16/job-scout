import { test } from "node:test";
import assert from "node:assert/strict";
import { check, Corpus, numbers, terms } from "../src/tailor/facts.ts";

// Fictional CV facts: the checks only care about the numbers and names in them.
const llm = "Built the LLM layer for an AI listing writer serving **2M requests/month**: compared Gemini Flash with Claude Sonnet on an automated eval set, then led the switch, cutting inference cost from **€500K to €90K/year**; planned a Bedrock self-hosting option targeting €20K/year.";
const hub = "Led development of **Insights Hub**, an analytics product for business customers; owned the phased migration of **2M+ users** under active production constraints.";
const skills = "TypeScript, React, Next.js, Astro, Tailwind CSS, Node.js, Python, AWS, Docker, GitHub Actions, Playwright, Acme";
const bank = new Corpus([llm, hub, skills]);
const own = new Corpus([llm]);

test("number extraction normalizes formats", () => {
  assert.deepEqual(numbers("cut cost from €500K to €90K/year, 30%+ growth, ~80% faster"), ["€500k", "€90k", "30%", "80%"]);
});

test("an honest rewording of a bullet passes", () => {
  const text = "Led the switch from Claude Sonnet to Gemini Flash after an automated eval set, cutting inference cost from €500K to €90K/year at 2M requests/month.";
  assert.deepEqual(check("acme-llm", text, own, bank), []);
});

test("an invented technology fails, even in lower case when the job lists it", () => {
  const v = check("acme-llm", "Deployed the LLM layer on Kubernetes, cutting cost to €90K/year.", own, bank);
  assert.ok(v.some((x) => x.problem.includes('"Kubernetes"')));
  const lower = check("acme-llm", "deployed the LLM layer on kubernetes clusters.", own, bank, ["Kubernetes"]);
  assert.ok(lower.some((x) => x.problem.includes('"kubernetes"')));
});

test("inflated or computed numbers fail", () => {
  const v = check("profile", "Cut inference cost by 82% for a platform serving 2M requests/month.", bank, bank);
  assert.deepEqual(v.map((x) => x.problem), ['number "82%" is not in the source facts']);
});

test("a number moved from another bullet fails against the bullet's own facts", () => {
  const v = check("acme-llm", "Compared Gemini Flash on an eval set, then migrated 2M+ users.", own, bank);
  assert.equal(v.length, 0, "2M+ normalizes to 2m, which this bullet has (2M requests/month)");
  const moved = check("acme-hub", "Owned the phased migration of Insights Hub, cutting cost to €90K/year.", new Corpus([hub]), bank);
  assert.ok(moved.some((x) => x.problem.includes("€90k")));
});

test("compounds are checked by part: known parts pass, an unknown part still fails", () => {
  assert.deepEqual(check("note", "I shipped TypeScript/React features and AI-visibility work.", bank, bank), []);
  assert.ok(check("note", "I shipped TypeScript/Kubernetes features.", bank, bank).some((x) => x.problem.includes('"Kubernetes"')));
});

test("sentence-initial capitals, possessives and generic words are not claims", () => {
  assert.deepEqual(terms("Led the work. I shipped Acme's AI features with my team."), ["Acme"]);
});
