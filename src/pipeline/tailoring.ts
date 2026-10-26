// Tailoring stage: for each "apply" job, write a tailored one-page CV and application text, mark it cv_ready, then
// read its application form and prepare answers (./form.ts). A form that can't be read never fails the job. In a scan,
// jobs join as they're scored (tailoringQueue), so the first "apply" doesn't wait for the rest of the run.
import { mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Config } from "../config.ts";
import { companyKey, type Store } from "../db/store.ts";
import type { ScreenResult } from "../injection/screen.ts";
import type { CallRecord } from "../llm/client.ts";
import { workQueue } from "../http.ts";
import { formOne, formSummary } from "./form.ts";
import type { CompanyProfile } from "../research/profile.ts";
import type { Posting } from "../sources/types.ts";
import { renderOnePage } from "../tailor/fit.ts";
import { applicationDir, toStored, writeApplication } from "../tailor/output.ts";
import { tailor } from "../tailor/tailor.ts";
import { CV_PATH, type Candidate } from "../vet/candidate.ts";
import type { VetResult } from "../vet/vet.ts";

export interface TailorJob {
  id: string;
  posting: Posting;
  vet: VetResult;
  screen: ScreenResult | null;
}

export interface TailorOutcome {
  id: string;
  dir?: string;
  needsEdit: number;
  reverted: number;
  dropped: number;
  error?: string;
}

export async function tailorOne(job: TailorJob, store: Store, cfg: Config, candidate: Candidate, record?: (r: CallRecord) => void): Promise<TailorOutcome> {
  const { posting: p, vet } = job;
  const companyName = store.companyName(p.company, cfg.companyNames);
  const company = store.company(companyKey(p.company), 365) as CompanyProfile | null;
  const tailored = await tailor({ candidate, vet, company, jobTitle: p.title, companyName }, record);
  const dir = applicationDir(companyName, p.title);
  const cvFile = join(dir, `${candidate.cv.basics.name} CV - ${companyName}.pdf`);
  const photo = candidate.cv.basics.photo ? resolve(dirname(CV_PATH), candidate.cv.basics.photo) : undefined;
  mkdirSync(dir, { recursive: true });
  const fitted = await renderOnePage(tailored.cv, photo, cvFile, candidate.cv);
  writeApplication({ dir, cvFile: basename(cvFile), posting: p, companyName, master: candidate.cv, tailored, finalCv: fitted.cv, dropped: fitted.dropped, added: fitted.added, vet, screen: job.screen, company });
  const result = { dir: toStored(dir), cvFile: toStored(cvFile), whyUs: tailored.whyUs, note: tailored.note, emphasis: tailored.emphasis, pages: fitted.pages, dropped: fitted.dropped, added: fitted.added, needsEdit: tailored.needsEdit, reverted: tailored.reverted, headline: fitted.cv.basics.title };
  store.saveStage(job.id, "tailor", result);
  return { id: job.id, dir: toStored(dir), needsEdit: tailored.needsEdit.length, reverted: tailored.reverted.length, dropped: fitted.dropped.length };
}

/** Jobs whose form may be on their company's own board, which board discovery is still looking for. */
const NEEDS_BOARD = new Set(["linkedin", "hn", "manual"]);

/**
 * Tailoring as a queue: a job starts the moment it's added (an "apply" verdict mid-run), up to `concurrency.tailor` at
 * a time and `caps.tailorPerRun` in the run. A job first seen on LinkedIn, HN or a pasted link reads its form only once
 * `boardsReady` settles: board discovery may find its own posting, whose form can be read.
 */
export function tailoringQueue(store: Store, cfg: Config, runId: number, candidate: Candidate, boardsReady: Promise<unknown> = Promise.resolve()) {
  const queue = workQueue(cfg.concurrency.tailor, async (id: string): Promise<TailorOutcome> => {
    const posting = store.posting(id);
    const vet = store.stage<VetResult>(id, "vet");
    if (!posting || !vet) return { id, needsEdit: 0, reverted: 0, dropped: 0, error: "missing posting or vet result" };
    const record = (r: CallRecord) => store.recordCall(runId, id, r);
    try {
      const out = await tailorOne({ id, posting, vet, screen: store.stage<ScreenResult>(id, "screen") }, store, cfg, candidate, record);
      store.setStatus(id, "cv_ready", "apply");
      store.event(runId, "tailor", `cv ready: ${out.dir}${out.needsEdit ? ` (${out.needsEdit} claim(s) need an edit)` : ""}`, out.needsEdit ? "warn" : "info", id);
      if (NEEDS_BOARD.has(posting.source)) await boardsReady.catch(() => undefined);
      const form = await formOne(id, store, cfg, candidate, record).catch((e: Error) => ({ error: e.message }));
      store.event(runId, "form", formSummary(form), "error" in form ? "warn" : "info", id);
      return out;
    } catch (e) {
      store.event(runId, "tailor", `failed: ${(e as Error).message}`, "error", id);
      return { id, needsEdit: 0, reverted: 0, dropped: 0, error: (e as Error).message };
    }
  }, cfg.caps.tailorPerRun);
  return {
    add: (id: string) => queue.add(id) && (store.event(runId, "tailor", "queued for tailoring", "info", id), true),
    done: queue.done,
  };
}

/** Tailor the "apply" jobs waiting, best score first (`only`: just those), without scoring anything first. */
export async function processTailoring(store: Store, cfg: Config, runId: number, candidate: Candidate, only?: string[]): Promise<TailorOutcome[]> {
  const queue = tailoringQueue(store, cfg, runId, candidate);
  const ids = store.tailorQueue(cfg.caps.tailorPerRun, only);
  store.event(runId, "tailor", `${ids.length} job(s) to tailor`);
  for (const id of ids) queue.add(id);
  return queue.done();
}
