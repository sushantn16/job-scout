// Rules-only classification of application emails, and matching them to stored jobs. No LLM ever reads an email.
import type { JobStatus } from "../db/store.ts";

export type EmailKind = "rejection" | "interview" | "confirmation" | "unclear";

// Checked in this order: rejections often also say "thank you for applying" or mention "next steps", and interview
// invites rarely contain rejection phrasing.
const RULES: [Exclude<EmailKind, "unclear">, RegExp][] = [
  ["rejection", /\bunfortunately\b|\bregret to inform\b|\b(?:not|won'?t|will not) (?:be )?(?:moving|move|proceed|progress|going)(?:ing)? (?:forward|ahead)?|decided (?:not )?to (?:move|proceed|go) (?:forward |ahead )?with (?:other|another|a different)|pursue other candidates|other candidates (?:whose|who)|position has (?:now )?been filled|no longer (?:considering|available|open)|not (?:the right |a )(?:fit|match)\b|leider|absage|nicht weiter berücksichtigen/i],
  ["interview", /\binterview\b|\bschedule (?:a|an|your) (?:call|chat|conversation|meeting|time)|\bbook (?:a|your) (?:time|slot|call)|calendly\.com|goodtime\.io|cal\.com\/|\/schedule\b|\bnext (?:step|round)s? (?:is|would be|will be)\b|\binvite you (?:to|for)\b|take-home|coding (?:challenge|exercise|task)|technical (?:challenge|assessment|task)|\bcase study\b|vorstellungsgespräch|kennenlernen/i],
  ["confirmation", /thank(?:s| you) for (?:applying|your application|your interest)|application (?:has been )?(?:received|submitted)|we(?:'ve| have) received your application|your application (?:to|for) .{0,60}(?:is in|was received|has been received)|bewerbung (?:ist )?eingegangen|vielen dank für (?:deine|ihre) bewerbung/i],
];

export function classify(subject: string, text: string): { kind: EmailKind; rule: string } {
  const hay = `${subject}\n${text.slice(0, 6000)}`;
  for (const [kind, re] of RULES) {
    const m = hay.match(re);
    if (m) return { kind, rule: m[0] };
  }
  return { kind: "unclear", rule: "" };
}

/** Applicant-tracking and job-site senders. Mail from these is job-related even when the company isn't named in From. */
export const ATS_SENDERS = /ashbyhq\.com|greenhouse(?:mail)?\.io|greenhouse\.io|lever\.co|hire\.lever\.co|personio\.(?:de|com)|workablemail\.com|workable\.com|smartrecruiters\.com|recruitee\.com|join\.com|teamtailor\.com|myworkday\.com|successfactors|linkedin\.com|softgarden|bamboohr\.com/i;

export interface MatchJob {
  id: string;
  company: string;
  companyName: string;
  title: string;
  status: JobStatus;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2 && !/^(senior|engineer|the|and|for|with|all|genders)$/.test(w)));

/**
 * The job an email is about: the company name (or board slug) must appear as a whole word in the sender or subject (or,
 * for applicant-tracking senders, the start of the body). With several jobs at that company, the one whose title shares the most words with the subject wins.
 */
export function matchJob(email: { from: string; subject: string; text: string }, jobs: MatchJob[]): { job: MatchJob; reason: string } | null {
  // The body is searched only for applicant-tracking senders, whose From is the ATS rather than the company. Otherwise a
  // generic company name ("Gigs") would match any email that mentions "side gigs".
  const body = ATS_SENDERS.test(email.from) ? email.text.slice(0, 3000) : "";
  const hay = ` ${norm(`${email.from} ${email.subject} ${body}`)} `;
  const candidates = jobs.filter((j) => [j.companyName, j.company].some((name) => norm(name).length >= 3 && hay.includes(` ${norm(name)} `)));
  if (!candidates.length) return null;
  const subjectWords = words(`${email.subject} ${email.text.slice(0, 600)}`);
  const scored = candidates
    .map((job) => ({ job, overlap: [...words(job.title)].filter((w) => subjectWords.has(w)).length }))
    .sort((a, b) => b.overlap - a.overlap);
  const best = scored[0]!;
  // Two jobs at one company with no title evidence either way: don't guess.
  if (scored.length > 1 && scored[1]!.overlap === best.overlap) return null;
  return { job: best.job, reason: `company "${best.job.companyName}"${best.overlap ? `, ${best.overlap} title word(s)` : ""}` };
}

/** The status an email moves a job to, or null if it shouldn't change it (e.g. a late confirmation after an interview). */
export function nextStatus(kind: EmailKind, current: JobStatus): JobStatus | null {
  // Only a job you could have applied to: a rejection matched to a filtered or skipped job would invent an application.
  if (kind === "rejection") return ["cv_ready", "apply", "applied", "interview", "maybe", "needs_review", "new"].includes(current) ? "rejected" : null;
  if (kind === "interview") return ["cv_ready", "apply", "applied", "maybe", "needs_review"].includes(current) ? "interview" : null;
  if (kind === "confirmation") return ["cv_ready", "apply", "maybe", "needs_review", "new"].includes(current) ? "applied" : null;
  return null;
}
