import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, profileValues } from "../src/forms/classify.ts";
import { validateDrafts } from "../src/forms/prepare.ts";
import { ashbyFields, formTarget, fromPage, greenhouseFields, type FormField } from "../src/forms/read.ts";
import { Corpus } from "../src/tailor/facts.ts";
import { Cv } from "../src/cv/schema.ts";
import { readFileSync } from "node:fs";

test("form URLs: ATS sources know their form, others need a pasted URL", () => {
  const p = (source: "ashby" | "greenhouse" | "lever" | "personio" | "linkedin", url: string, company = "acme") => formTarget({ source, company, url });
  assert.deepEqual(p("greenhouse", "https://job-boards.greenhouse.io/vercel/jobs/6129441004"), { via: "greenhouse", board: "vercel", jobId: "6129441004", url: "https://job-boards.greenhouse.io/vercel/jobs/6129441004" });
  assert.deepEqual(p("greenhouse", "https://careers.example.com/jobs/?gh_jid=4567890", "example"), { via: "greenhouse", board: "example", jobId: "4567890", url: "https://careers.example.com/jobs/?gh_jid=4567890" });
  assert.equal(p("ashby", "https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff")?.url, "https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff/application");
  assert.equal(p("lever", "https://jobs.lever.co/qonto/489aaf09-447c-4a8a-b79d-bb65d0e568ef")?.url, "https://jobs.lever.co/qonto/489aaf09-447c-4a8a-b79d-bb65d0e568ef/apply");
  assert.equal(p("linkedin", "https://www.linkedin.com/jobs/view/4479616772"), null);
  const pasted = formTarget({ source: "linkedin", company: "Doodle", url: "https://www.linkedin.com/jobs/view/4479616772" }, "https://careers.doodle.com/jobs/8556332-senior-software-engineer-fullstack-all-genders");
  assert.deepEqual(pasted, { via: "page", url: "https://careers.doodle.com/jobs/8556332-senior-software-engineer-fullstack-all-genders/applications/new" }, "Teamtailor form page");
  assert.equal(formTarget({ source: "linkedin", company: "x", url: "" }, pasted!.url)?.url, pasted!.url, "a stored form URL stays as it is");
});

test("Greenhouse questions, location, compliance and demographic questions map to fields", () => {
  const fields = greenhouseFields({
    questions: [
      { label: "Resume/CV", required: true, fields: [{ name: "resume", type: "input_file" }, { name: "resume_text", type: "textarea" }] },
      { label: "Will you require Visa Sponsorship now, or in the future?", required: true, fields: [{ name: "q1", type: "multi_value_single_select", values: [{ label: "Yes" }, { label: "No" }] }] },
      { label: "Hidden", required: false, fields: [{ name: "h", type: "input_hidden" }] },
    ],
    demographic_questions: { questions: [{ label: "How would you describe your gender identity?", required: false, type: "multi_value_multi_select", answer_options: [{ label: "Man" }, { label: "Woman" }] }] },
  });
  assert.deepEqual(fields.map((f) => [f.type, f.question, f.options ?? null]), [
    ["file", "Resume/CV", null],
    ["choice", "Will you require Visa Sponsorship now, or in the future?", ["Yes", "No"]],
    ["multi", "How would you describe your gender identity?", ["Man", "Woman"]],
  ]);
});

test("Ashby form entries map to fields", () => {
  const fields = ashbyFields({
    sections: [{
      fieldEntries: [
        { field: { title: "Are you based in a EU or equivalent timezone?", type: "Boolean" }, isRequired: true },
        { field: { title: "Notice  Period", type: "String" }, isRequired: true },
        { field: { title: "What are you extremely good at?", type: "LongText" }, isRequired: true, descriptionHtml: "<p>Be specific.</p>" },
      ],
    }],
  });
  assert.deepEqual(fields, [
    { question: "Are you based in a EU or equivalent timezone?", type: "boolean", required: true },
    { question: "Notice Period", type: "text", required: true },
    { question: "What are you extremely good at?", type: "textarea", required: true, description: "Be specific." },
  ]);
});

test("page fields: required markers leave the question, browser types map to ours", () => {
  assert.deepEqual(fromPage({ question: "Are you willing to work from our Berlin office 2 days per week?* Required", type: "radio", required: false, options: ["Yes", "No"] }),
    { question: "Are you willing to work from our Berlin office 2 days per week?", type: "choice", required: true, options: ["Yes", "No"] });
  assert.deepEqual(fromPage({ question: "Full name ✱", type: "text", required: false, maxLength: 50 }), { question: "Full name", type: "text", required: true, maxLength: 50 });
  assert.equal(fromPage({ question: "Autofill from resume", type: "file", required: false }), null);
  assert.deepEqual(fromPage({ question: "Required.By submitting this application, I agree", type: "checkbox", required: false, options: ["x"] }),
    { question: "By submitting this application, I agree", type: "boolean", required: true });
  assert.equal(fromPage({ question: "Yes, Doodle can contact me about future job opportunities.", type: "checkbox", required: false, options: ["Yes"] })?.type, "boolean");
});

test("who answers what: profile, upload, consent, demographic, question", () => {
  const k = (question: string, type: FormField["type"] = "text", options?: string[]) => kindOf({ question, type, options });
  assert.equal(k("First name"), "profile");
  assert.equal(k("LinkedIn URL"), "profile");
  assert.equal(k("Location (City)"), "profile");
  assert.equal(k("Upload CV", "file"), "upload");
  assert.equal(k("By submitting my application, I acknowledge that I have read the Privacy Notice", "boolean"), "consent");
  assert.equal(k("Yes, Qonto can contact me about future job opportunities for up to 2 years", "boolean"), "consent");
  assert.equal(k("Do you identify as transgender?", "choice"), "demographic");
  assert.equal(k("Pronouns", "multi", ["He/him", "She/her", "They/them"]), "demographic");
  assert.equal(k("What are your salary expectations? A range would be great"), "question");
  assert.equal(k("What country are you based in?"), "question");
  assert.equal(k("Which AI or agentic tools do you use in your day-to-day engineering work, and how?", "textarea"), "question");
});

test("profile values come from the CV, links from saved answers", () => {
  const cv = Cv.parse(JSON.parse(readFileSync("config/cv-master.example.json", "utf8")));
  const v = profileValues(cv, { github: "github.com/alex-example" });
  assert.equal(v.firstName, "Alex");
  assert.equal(v.lastName, "Example");
  assert.equal(v.linkedin, "https://linkedin.com/in/alex-example");
  assert.equal(v.github, "https://github.com/alex-example");
  assert.equal(v.currentCompany, "Acme Marketplace");
  assert.equal(v.website, undefined);
});

test("drafted answers are checked: options, length and facts", () => {
  const fields: FormField[] = [
    { id: "q1", question: "Eligible to work in Germany?", type: "choice", required: true, options: ["Yes", "No"] },
    { id: "q2", question: "Salary expectations?", type: "text", required: true, maxLength: 40 },
    { id: "q3", question: "Which AI tools do you use?", type: "textarea", required: true },
  ];
  const corpus = new Corpus(["Built the LLM layer for an AI listing writer serving 2M requests/month", "Salary: €95K to €110K"]);
  const d = (id: string, choice: string[], text: string | null) => ({ id, key: "none" as const, choice, text, needsYou: false, why: "" });
  const ok = validateDrafts(fields, [d("q1", ["Yes"], null), d("q2", [], "€95K to €110K"), d("q3", [], "I use LLM evals for an AI listing writer.")], corpus);
  assert.equal(ok.size, 0);
  const bad = validateDrafts(fields, [d("q1", ["Maybe"], null), d("q2", [], "€150K, negotiable depending on the overall package"), d("q3", [], "I use Cursor daily.")], corpus);
  assert.deepEqual(bad.get("q1"), ['"Maybe" is not one of the options']);
  assert.ok(bad.get("q2")!.some((p) => p.includes("characters")));
  assert.ok(bad.get("q2")!.some((p) => p.includes("€150k")));
  assert.ok(bad.get("q3")!.some((p) => p.includes("Cursor")));
  assert.equal(validateDrafts(fields, [{ ...d("q2", [], null), needsYou: true }], corpus).size, 0, "needs-you answers aren't checked");
});
