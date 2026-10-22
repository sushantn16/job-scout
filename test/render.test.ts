import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Cv } from "../src/cv/schema.ts";
import { renderCvHtml } from "../src/cv/render-html.ts";

const example = () => Cv.parse(JSON.parse(readFileSync("config/cv-master.example.json", "utf8")));

test("CV header: website and GitHub become links in a three-column contact line", () => {
  const html = renderCvHtml(example());
  assert.match(html, /<div class="contact three">/);
  assert.match(html, /<a href="https:\/\/alex-example\.dev">alex-example\.dev<\/a>/);
  assert.match(html, /<a href="https:\/\/github\.com\/alex-example">github\.com\/alex-example<\/a>/);
  assert.match(html, /<a href="https:\/\/linkedin\.com\/in\/alex-example">linkedin\.com\/in\/alex-example<\/a>/);
});

test("CV header: without links it keeps the two-column layout and order", () => {
  const cv = example();
  const html = renderCvHtml({ ...cv, basics: { ...cv.basics, website: undefined, github: undefined } });
  assert.match(html, /<div class="contact">/);
  const order = ["mail", "phone", "linkedin", "pin"].map((s) => html.indexOf(cv.basics[{ mail: "email", phone: "phone", linkedin: "linkedin", pin: "location" }[s] as "email"]));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "email, phone, LinkedIn, location");
});

test("CV projects: rendered between experience and education, with the name linked when a URL is given", () => {
  const cv = example();
  const html = renderCvHtml({
    ...cv,
    projects: [
      { id: "p1", name: "tool-one", stack: "TypeScript, Docker", url: "github.com/alex-example/tool-one", text: "Does **one** thing." },
      { id: "p2", name: "tool-two", text: "Does another." },
    ],
  });
  assert.match(html, /<a href="https:\/\/github\.com\/alex-example\/tool-one"><strong>tool-one<\/strong><\/a> \(TypeScript, Docker\): Does <strong>one<\/strong> thing\./);
  assert.match(html, /<li><strong>tool-two<\/strong>: Does another\.<\/li>/);
  const at = (s: string) => html.indexOf(s);
  assert.ok(at("<h2>Work Experience</h2>") < at("<h2>Projects</h2>") && at("<h2>Projects</h2>") < at("<h2>Education</h2>"));
});

test("CV projects: no section when there are none", () => {
  assert.doesNotMatch(renderCvHtml(example()), /<h2>Projects<\/h2>/);
});
