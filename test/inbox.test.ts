import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, matchJob, nextStatus, type MatchJob } from "../src/inbox/classify.ts";

test("confirmations", () => {
  assert.equal(classify("Thank you for applying to Northwind", "Hi Alex, thanks for your interest in the (Senior) Product Engineer role. We'll review your application.").kind, "confirmation");
  assert.equal(classify("Application received: Senior Product Engineer", "We have received your application and will get back to you.").kind, "confirmation");
  assert.equal(classify("Deine Bewerbung", "Vielen Dank für deine Bewerbung als Senior Engineer bei uns.").kind, "confirmation");
});

test("rejections win over the polite phrases they contain", () => {
  const r = classify("Your application to Acme AI", "Thank you for applying to Acme AI. After careful consideration, we have decided to move forward with other candidates. We won't be moving forward to the next steps.");
  assert.equal(r.kind, "rejection");
  assert.equal(classify("Update on your application", "We regret to inform you that the position has been filled.").kind, "rejection");
  assert.equal(classify("Ihre Bewerbung", "Leider müssen wir Ihnen mitteilen, dass wir Sie nicht weiter berücksichtigen können.").kind, "rejection");
});

test("interview invites", () => {
  assert.equal(classify("Next steps for your application at Globex", "We'd love to invite you to a first interview. Please book a time here: https://calendly.com/globex/intro").kind, "interview");
  assert.equal(classify("Initech: tech interview", "The next step is a 60 minute tech interview with the hiring manager.").kind, "interview");
  assert.equal(classify("Your coding challenge", "As a next step we'd like you to complete a short take-home task.").kind, "interview");
});

test("unrelated job-site mail stays unclear", () => {
  assert.equal(classify("Your job alert for Product Engineer in Berlin", "12 new jobs match your preferences.").kind, "unclear");
});

const jobs: MatchJob[] = [
  { id: "a", company: "northwind", companyName: "Northwind", title: "(Senior) Product Engineer - m/f/d", status: "applied" },
  { id: "b", company: "acme", companyName: "Acme AI", title: "Senior Product Engineer", status: "cv_ready" },
  { id: "c", company: "acme", companyName: "Acme AI", title: "Senior Frontend Engineer", status: "cv_ready" },
  { id: "d", company: "Gigs", companyName: "Gigs", title: "Senior Product Engineer", status: "cv_ready" },
];

test("matching by company, then title words", () => {
  assert.equal(matchJob({ from: "Northwind <no-reply@ashbyhq.com>", subject: "Thank you for applying to Northwind", text: "" }, jobs)?.job.id, "a");
  assert.equal(matchJob({ from: "Acme AI Hiring <hiring@acme-ai.example>", subject: "Your application for Senior Frontend Engineer at Acme AI", text: "" }, jobs)?.job.id, "c");
});

test("matching refuses to guess", () => {
  assert.equal(matchJob({ from: "Acme AI <hiring@acme-ai.example>", subject: "Your application at Acme AI", text: "" }, jobs), null, "two Acme AI jobs, no title evidence");
  assert.equal(matchJob({ from: "Newsletter <news@example.com>", subject: "Weekend reading", text: "How side gigs became careers" }, jobs), null, "generic name in a non-ATS body");
});

test("status transitions never move a job backwards", () => {
  assert.equal(nextStatus("confirmation", "cv_ready"), "applied");
  assert.equal(nextStatus("confirmation", "interview"), null);
  assert.equal(nextStatus("interview", "applied"), "interview");
  assert.equal(nextStatus("rejection", "interview"), "rejected");
  // A rejection matched to a job you never applied to mustn't invent an application.
  for (const s of ["filtered", "stale", "skip", "dismissed", "rejected"] as const) assert.equal(nextStatus("rejection", s), null, s);
  assert.equal(nextStatus("rejection", "rejected"), null);
});

test("picks the readable text part of an email, skipping attachments", async () => {
  const { textPart } = await import("../src/inbox/gmail.ts");
  assert.deepEqual(textPart({ type: "text/plain" }), { part: "1", html: false }, "single-part message");
  const mixed = {
    type: "multipart/mixed",
    childNodes: [
      { type: "multipart/alternative", part: "1", childNodes: [{ type: "text/plain", part: "1.1" }, { type: "text/html", part: "1.2" }] },
      { type: "text/plain", part: "2", disposition: "attachment" },
    ],
  };
  assert.deepEqual(textPart(mixed), { part: "1.1", html: false });
  assert.deepEqual(textPart({ type: "multipart/alternative", childNodes: [{ type: "text/html", part: "1" }] }), { part: "1", html: true }, "HTML-only email");
  assert.equal(textPart({ type: "multipart/mixed", childNodes: [{ type: "application/pdf", part: "1", disposition: "attachment" }] }), null);
});
