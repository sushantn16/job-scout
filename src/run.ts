// Daily pipeline entry point. M1: fetch, filter, store, digest. LLM stages are added in M2/M3.
import { loadConfig } from "./config.ts";
import { Store } from "./db/store.ts";
import { isFresh, windowStart } from "./filter/freshness.ts";
import { isRelevant, screen, type Screened } from "./filter/rules.ts";
import { mapLimit } from "./http.ts";
import { ATS, type AtsKind } from "./sources/ats.ts";
import { hnWhosHiring } from "./sources/hn.ts";
import type { Posting } from "./sources/types.ts";
import { existsSync } from "node:fs";
import { notify } from "./notify.ts";
import { ensureAwsSession } from "./aws/session.ts";
import { processInbox } from "./inbox/process.ts";
import { printVetDigest, processQueue } from "./pipeline/process.ts";
import { processTailoring, type TailorOutcome } from "./pipeline/tailoring.ts";
import { loadCandidate } from "./vet/candidate.ts";

interface LinkedInModule {
  linkedinSearch(o: object, errors: string[]): Promise<Posting[]>;
  linkedinDetail(p: Posting, errors: string[]): Promise<Posting>;
}

// Private and git-ignored; absent in the public repo. A variable specifier keeps tsc from resolving it.
async function loadLinkedIn(): Promise<LinkedInModule | null> {
  const specifier = "./sources/private/linkedin.ts";
  return (await import(specifier).catch(() => null)) as LinkedInModule | null;
}

const cfg = loadConfig();
const store = new Store();
const started = new Date();
const since = windowStart(started, store.lastSuccessfulRunStart(), cfg.freshness.minHours, cfg.freshness.maxHours);
const runId = store.startRun(since);
const log = (stage: string, msg: string, level: "info" | "warn" | "error" = "info") => {
  store.event(runId, stage, msg, level);
  if (level !== "info") console.error(`[${stage}] ${msg}`);
};

// Check (and if needed renew) the AWS session while fetching, so a pending browser login doesn't hold up the fetch.
const llmConfigured = Boolean(process.env.JOB_SCOUT_MODEL && existsSync("data/private/preferences.json"));
const session = llmConfigured
  ? ensureAwsSession((line) => {
      log("aws", line, "warn");
      if (line.includes("approve the login")) notify("AWS login needed: approve it in your browser to continue the run");
    })
  : null;

// Replies to past applications, checked alongside the fetch. A Gmail problem never fails the run.
const inbox = processInbox(store, cfg, runId).catch((e: Error) => (log("inbox", `failed: ${e.message}`, "warn"), null));

try {
  log("run", `freshness window starts ${since.toISOString()}`);
  const boards = (Object.keys(ATS) as AtsKind[]).flatMap((kind) => cfg.sources[kind].map((slug) => ({ kind, slug })));
  const fetched = await mapLimit(boards, 16, async ({ kind, slug }) => {
    try {
      return await ATS[kind](slug);
    } catch (e) {
      log("fetch", `${kind}/${slug}: ${(e as Error).message}`, "warn");
      return [];
    }
  });
  const postings = fetched.flat();
  const fetchStats = { boards: boards.length, boardPostings: postings.length, hn: 0, linkedin: 0 };
  log("fetch", `${postings.length} postings from ${boards.length} boards`);

  if (cfg.sources.hn) {
    try {
      const hn = await hnWhosHiring();
      postings.push(...hn);
      fetchStats.hn = hn.length;
      log("fetch", `${hn.length} HN "Who is hiring" posts`);
    } catch (e) {
      log("fetch", `hn: ${(e as Error).message}`, "warn");
    }
  }

  const linkedin = await loadLinkedIn();
  if (linkedin) {
    const errors: string[] = [];
    const seconds = Math.ceil((started.getTime() - since.getTime()) / 1000);
    const cards = (await linkedin.linkedinSearch({ ...cfg.linkedin, seconds }, errors)).filter((c) => isRelevant(c, cfg) && !store.seen(c.company, c.title));
    const detailed: Posting[] = [];
    for (const c of cards.slice(0, cfg.linkedin.maxDetails)) detailed.push(await linkedin.linkedinDetail(c, errors));
    postings.push(...detailed);
    fetchStats.linkedin = detailed.length;
    for (const e of errors) log("fetch", e, "warn");
    log("fetch", `${detailed.length} new LinkedIn postings detailed (${cards.length} new relevant cards)`);
  }

  const relevant = postings.filter((p) => isRelevant(p, cfg));
  const fresh: Screened[] = [];
  let stale = 0;
  for (const p of relevant) {
    const s = screen(p, cfg);
    const recent = isFresh(p.posted, since);
    const { isNew, id } = store.upsert(runId, s, recent);
    if (!isNew) continue;
    if (!recent && s.rejections.length === 0) {
      stale++;
      continue;
    }
    fresh.push(s);
    store.event(runId, "filter", s.rejections.length ? `filtered: ${s.rejections[0]}` : "passed hard rules", "info", id);
  }

  const passed = fresh.filter((s) => s.rejections.length === 0);
  const stats = { fetch: fetchStats, postings: postings.length, relevant: relevant.length, new: fresh.length + stale, stale, passed: passed.length };
  log("filter", `${stats.relevant} relevant, ${stats.new} new, ${stale} older than the window, ${stats.passed} fresh and passed hard rules`);
  // LLM stages need a model and the private CV/preferences; without them (CI, a fresh clone) the scan still works.
  let vetted: Awaited<ReturnType<typeof processQueue>> | null = null;
  let tailored: TailorOutcome[] = [];
  const aws = session ? await session : null;
  if (aws && !aws.ok) log("vet", `skipped: ${aws.detail}`, "error");
  else if (aws) log("aws", `session ${aws.detail}`);
  if (llmConfigured && aws?.ok) {
    const candidate = loadCandidate();
    vetted = await processQueue(store, cfg, runId, candidate);
    tailored = await processTailoring(store, cfg, runId, candidate);
  }
  else if (!llmConfigured) log("vet", "skipped: JOB_SCOUT_MODEL or data/private/preferences.json missing", "warn");
  const replies = await inbox;
  store.finishRun(runId, "done", { ...stats, vet: vetted?.stats, tailored: tailored.filter((t) => !t.error).length, inbox: replies });

  const k = (n: number | null) => (n === null ? "  –  " : `€${Math.round(n / 1000)}K`.padStart(5));
  console.log(`\nRun ${runId} (window from ${since.toISOString()}): ${JSON.stringify(stats)}\n\nFresh, passed hard rules:`);
  passed
    .sort((a, b) => (b.signals.bandTopEur ?? 0) - (a.signals.bandTopEur ?? 0))
    .forEach(({ posting: p, signals: s }) =>
      console.log(`  ${k(s.bandTopEur)}  ${p.company.slice(0, 18).padEnd(18)} ${p.title.slice(0, 58).padEnd(58)} ${s.workplace.value.padEnd(7)} ${s.applicants ?? ""}`),
    );
  const filtered = fresh.filter((s) => s.rejections.length > 0);
  console.log(`\nFiltered (${filtered.length}):`);
  filtered.forEach(({ posting: p, rejections }) => console.log(`  ${p.company.slice(0, 18).padEnd(18)} ${p.title.slice(0, 44).padEnd(44)} ${rejections[0]!.slice(0, 70)}`));
  if (vetted) printVetDigest(vetted.jobs);
  const ready = tailored.filter((t) => !t.error).length;
  const review = vetted?.stats.needsReview ?? 0;
  const failed = (vetted?.stats.errors ?? 0) + tailored.filter((t) => t.error).length;
  notify(
    [
      replies?.interviews ? `${replies.interviews} interview invite${replies.interviews > 1 ? "s" : ""}!` : "",
      replies?.rejections ? `${replies.rejections} rejection${replies.rejections > 1 ? "s" : ""}` : "",
      ready || review ? [ready ? `${ready} application${ready > 1 ? "s" : ""} ready` : "", review ? `${review} need${review > 1 ? "" : "s"} review` : ""].filter(Boolean).join(", ") : `No new matches (${stats.new} new jobs checked)`,
      failed ? `${failed} job(s) failed, see the dashboard` : "",
    ].filter(Boolean).join(". ") + ". http://127.0.0.1:8765",
  );
  if (tailored.length) console.log(`\nApplications ready:\n${tailored.map((t) => `  ${t.error ? `ERROR ${t.error}` : t.dir}`).join("\n")}`);
} catch (e) {
  log("run", (e as Error).stack ?? String(e), "error");
  store.finishRun(runId, "failed", {});
  notify(`Run failed: ${(e as Error).message.slice(0, 120)}`);
  process.exitCode = 1;
}
