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
