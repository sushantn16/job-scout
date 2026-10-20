// Form stage: read a job's application form and prepare answers. Runs right after tailoring, when a job becomes ready
// to apply, and on demand from the dashboard, where you can paste the form's URL for jobs whose source doesn't know it.
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Config } from "../config.ts";
import { companyKey, type Store } from "../db/store.ts";
import { loadAnswers } from "../forms/answers.ts";
import { prepareForm, writeFormMd, type FormPrep } from "../forms/prepare.ts";
import { formTarget, readForm } from "../forms/read.ts";
import type { CallRecord } from "../llm/client.ts";
import type { CompanyProfile } from "../research/profile.ts";
import { resolveOutput } from "../tailor/output.ts";
import type { Candidate } from "../vet/candidate.ts";
import type { VetResult } from "../vet/vet.ts";

/** What's stored on the job: the prepared form, or the URL tried and why it failed. */
export type FormStage = FormPrep | { url?: string; error: string };

interface StoredTailor {
  dir: string;
  cvFile: string;
  whyUs?: string;
  note?: string;
}

export const NO_FORM_URL = "This job's source doesn't link to its application form. Paste the form's URL on the job page.";

/**
 * `url` replaces the form URL; without it, the one used last time, else the job's own posting on its company's board
 * (found for LinkedIn and HN jobs by src/pipeline/boards.ts), else the one the job's source gives.
 */
export async function formOne(id: string, store: Store, cfg: Config, candidate: Candidate, record?: (r: CallRecord) => void, url?: string): Promise<FormStage> {
  const posting = store.posting(id);
  const vet = store.stage<VetResult>(id, "vet");
  if (!posting || !vet) throw new Error("missing posting or vet result");
  const previous = store.stage<FormStage>(id, "form");
  const chosen = url ?? previous?.url;
  // A LinkedIn or HN job found on its company's board: read the form as that board's own posting, so a Greenhouse
  // job on the company's site (?gh_jid=…) still goes through the Greenhouse API.
  const own = chosen ? null : store.boardUrl(id);
  const board = own ? store.board(companyKey(posting.company), Infinity) : null;
  const target = own && board ? formTarget({ source: board.kind, company: board.slug, url: own }) : formTarget(posting, chosen);
  if (!target) {
    const stage = { error: NO_FORM_URL };
    store.saveStage(id, "form", stage);
    return stage;
  }
  try {
    const form = await readForm(target);
    if (!form.fields.length) throw new Error("no form fields found. Forms built by JavaScript can't be read safely; open this one yourself");
    const tailor = store.stage<StoredTailor>(id, "tailor");
    const companyName = store.companyName(posting.company, cfg.companyNames);
    const prep = await prepareForm(
      {
        form, candidate, saved: loadAnswers(), vet, companyName, jobTitle: posting.title,
        company: store.company(companyKey(posting.company), 365) as CompanyProfile | null,
        application: tailor?.whyUs && tailor.note ? { whyUs: tailor.whyUs, note: tailor.note } : null,
        cvFile: tailor ? basename(tailor.cvFile) : null,
      },
      record,
    );
    store.saveStage(id, "form", prep);
    if (tailor && existsSync(resolveOutput(tailor.dir))) writeFormMd(resolveOutput(tailor.dir), prep, `${companyName}: ${posting.title}`);
    return prep;
  } catch (e) {
    const stage = { url: target.url, error: (e as Error).message };
    store.saveStage(id, "form", stage);
    return stage;
  }
}

/** One line for the event log. */
export function formSummary(s: FormStage): string {
  if ("error" in s) return `form not prepared: ${s.error}`;
  const questions = s.fields.filter((f) => f.kind === "question");
  return `form read: ${questions.length} question(s), ${questions.filter((f) => !f.needsYou).length} answered; ${s.fields.filter((f) => f.needsYou).length} field(s) need you`;
}
