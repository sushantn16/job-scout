// Inbox stage: fetch application emails, match each to a job, classify it by rules, and move the job's status.
import type { Config } from "../config.ts";
import type { JobStatus, Store } from "../db/store.ts";
import { classify, matchJob, nextStatus, type MatchJob } from "./classify.ts";
import { fetchApplicationEmails } from "./gmail.ts";

export interface InboxStats {
  checked: number;
  new: number;
  matched: number;
  changed: number;
  needsYou: number;
  interviews: number;
  rejections: number;
  confirmations: number;
}

/** Statuses whose company names go into the Gmail search; the ATS senders catch the rest. */
const ACTIVE = new Set(["cv_ready", "apply", "applied", "interview", "needs_review", "maybe"]);

export async function processInbox(store: Store, cfg: Config, runId: number): Promise<InboxStats | null> {
  const user = process.env.JOB_SCOUT_IMAP_USER;
  if (!user) {
    store.event(runId, "inbox", "skipped: JOB_SCOUT_IMAP_USER not set (see README)", "warn");
    return null;
  }
  const jobs: MatchJob[] = store.matchableJobs().map((j) => ({ ...j, companyName: cfg.companyNames[j.company] ?? j.company }));
  const names = [...new Set(jobs.filter((j) => ACTIVE.has(j.status)).map((j) => j.companyName))];
  const emails = (await fetchApplicationEmails(user, names)).sort((a, b) => a.date.localeCompare(b.date));
  const stats: InboxStats = { checked: emails.length, new: 0, matched: 0, changed: 0, needsYou: 0, interviews: 0, rejections: 0, confirmations: 0 };

  // Oldest first, so a confirmation followed by a rejection ends at "rejected".
  for (const e of emails) {
    if (store.hasEmail(e.messageId)) continue;
    stats.new++;
    const { kind, rule } = classify(e.subject, e.text);
    const match = matchJob(e, jobs);
    let fromStatus: string | null = null;
    let toStatus: string | null = null;
    if (match) {
      stats.matched++;
      const next = kind === "unclear" ? null : nextStatus(kind, match.job.status);
      if (next) {
        fromStatus = match.job.status;
        toStatus = next;
        store.setStatus(match.job.id, next as JobStatus);
        match.job.status = next;
        stats.changed++;
        if (next === "interview") stats.interviews++;
        else if (next === "rejected") stats.rejections++;
        else if (next === "applied") stats.confirmations++;
        store.event(runId, "inbox", `${match.job.companyName}: ${fromStatus} → ${next} (${kind}: "${rule}")`, "info", match.job.id);
      }
    }
    if (!match || kind === "unclear") stats.needsYou++;
    store.saveEmail({
      messageId: e.messageId, receivedAt: e.date, from: e.from, subject: e.subject, snippet: e.text.replace(/\s+/g, " ").slice(0, 400),
      kind, rule, jobId: match?.job.id ?? null, matchReason: match?.reason ?? null, fromStatus, toStatus, runId,
    });
  }
  store.event(runId, "inbox", `${stats.checked} emails checked, ${stats.new} new, ${stats.changed} status change(s), ${stats.needsYou} for you to look at`);
  return stats;
}
