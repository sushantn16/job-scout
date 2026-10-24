// Read-mostly JSON API over the SQLite store for the dashboard. Writes are limited to job status changes, saved form
// answers, jobs you add by hand, and starting pipeline commands.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, Search, SEARCH_PATH, type Config } from "../config.ts";
import { writeJson } from "../files.ts";
import { loadPreferences, Preferences, PREFS_PATH } from "../vet/candidate.ts";
import type { JobStatus, Store } from "../db/store.ts";
import { outputRoot, resolveOutput } from "../tailor/output.ts";
import { runPipeline } from "./pipeline.ts";
import { costOf, type Usage } from "../llm/cost.ts";
import { nextStatus, type EmailKind } from "../inbox/classify.ts";
import { windowStart } from "../filter/freshness.ts";
import { ANSWERS_PATH, loadAnswers, saveAnswer, STANDARD, STANDARD_KEYS, type StandardKey } from "../forms/answers.ts";
import type { FormStage } from "../pipeline/form.ts";
import { screen } from "../filter/rules.ts";
import { boardOf, fromBoard, pasted } from "../sources/manual.ts";
import type { Posting } from "../sources/types.ts";

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, query: URLSearchParams) => Promise<void> | void;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const readBody = async (req: IncomingMessage, max = 10_000): Promise<unknown> => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > max) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
};

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

/** Answers saved after a form was read fill its "needs you" fields at once, without preparing the form again. */
function withSaved(form: FormStage | null, saved: Record<string, string>): FormStage | null {
  if (!form || "error" in form) return form;
  return {
    ...form,
    fields: form.fields.map((f) => {
      const answer = f.key ? saved[f.key] : undefined;
      if (!f.needsYou || !answer) return f;
      const pick = ["choice", "multi", "boolean"].includes(f.type);
      return { ...f, value: answer, source: "saved", needsYou: false, why: pick ? `Pick the option that matches your saved answer` : "From your saved answers" };
    }),
  };
}

/** Statuses a person may set from the dashboard. "apply" approves a job held for review; "new" re-queues it for vetting. */
const SETTABLE: JobStatus[] = ["apply", "new", "applied", "interview", "rejected", "dismissed"];
const ACTIONS = ["scan", "vet", "tailor", "inbox", "rescreen"] as const;

const problems = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ");

export function routes(store: Store, cfg: Config, repoDir: string): [string, RegExp, Handler][] {
  const db = store.db;
  const price = (model: string) => cfg.pricing[model] ?? cfg.pricing.default!;
  const cost = (rows: Usage[]) => costOf(price, rows);
  // Pipeline commands run detached, one at a time. The child itself counts as busy from the moment it's spawned, before
  // it has written its run row (a double click would otherwise start two); a run row counts for runs started elsewhere.
  let child: ChildProcess | null = null;
  const busy = () => {
    store.failStaleRuns(2);
    return Boolean((child && child.exitCode === null && child.signalCode === null) || db.prepare("SELECT id FROM runs WHERE status = 'running'").get());
  };
  const launch = (args: string[]) => {
    // Runs started here notify when they finish (or need an AWS login), since you may not be watching the page.
    child = spawn("pnpm", ["-s", ...args], { cwd: repoDir, detached: true, stdio: "ignore", env: { ...process.env, JOB_SCOUT_NOTIFY: "1" } });
    // Without a listener, a failed spawn (pnpm not on PATH) would be thrown and take the server down.
    child.on("error", (e) => console.error(`could not start ${args.join(" ")}: ${e.message}`));
    child.unref();
    return child.pid;
  };
  const usageSql = `SELECT model, sum(input_tokens) AS input, sum(output_tokens) AS output, sum(cache_read_tokens) AS cacheRead,
    sum(cache_write_tokens) AS cacheWrite FROM llm_calls`;

  return [
    ["GET", /^\/api\/summary$/, (_req, res) => {
      store.failStaleRuns(2);
      const runs = (db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 15").all() as { id: number; stats: string | null }[]).map((r) => ({
        ...r,
        stats: parse(r.stats),
        cost: cost(db.prepare(`${usageSql} WHERE run_id = ? GROUP BY model`).all(r.id) as never),
      }));
      const counts = Object.fromEntries((db.prepare("SELECT status, count(*) AS n FROM jobs GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      json(res, 200, {
        runs,
        counts,
        cost30d: cost(db.prepare(`${usageSql} WHERE at >= ? GROUP BY model`).all(since) as never),
        running: runs.find((r) => (r as unknown as { status: string }).status === "running") ?? null,
        pricingNote: cfg.pricing.default!.note ?? "",
        followUpDays: cfg.followUpDays,
        followUpsDue: store.followUpsDue(cfg.followUpDays).length,
        // Days from applying to the first interview invite or rejection, for every application that got one.
        replyDays: (db.prepare("SELECT julianday(replied_at) - julianday(applied_at) AS d FROM jobs WHERE replied_at IS NOT NULL AND applied_at IS NOT NULL ORDER BY d").all() as { d: number }[]).map((r) => Math.round(r.d * 10) / 10),
        // How far back the next pipeline run will look: since the last run, at least a day, at most the cap.
        nextWindowStart: windowStart(new Date(), store.lastSuccessfulRunStart(), cfg.freshness.minHours, cfg.freshness.maxHours).toISOString(),
      });
    }],

    ["GET", /^\/api\/runs\/(?<id>\d+)\/events$/, (_req, res, p, q) => {
      // dashboard/src/Runs.tsx asks for more while a page comes back full.
      json(res, 200, db.prepare("SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id LIMIT 500").all(Number(p.id), Number(q.get("after") ?? 0)));
    }],

    ["GET", /^\/api\/jobs$/, (_req, res, _p, q) => {
      const status = q.get("status");
      const rows = db.prepare(
        `SELECT id, company, title, status, source, manual, url, posted, applicants, location, first_seen, applied_at, replied_at, followed_up_at,
           json_extract(signals, '$.bandTopEur') AS bandTopEur, json_extract(signals, '$.workplace.value') AS workplace,
           json_extract(vet, '$.fitScore') AS score, json_extract(vet, '$.decision') AS decision, json_extract(vet, '$.summary') AS summary,
           json_extract(screen, '$.needsReview') AS flagged, json_array_length(json_extract(screen, '$.findings')) AS findings,
           json_extract(rejections, '$[0]') AS rejection,
           coalesce(json_extract(vet, '$.recruiter.kind'), CASE WHEN json_extract(signals, '$.recruiter.value') THEN 'recruiter' END) AS recruiter
         FROM jobs ${status === "all" ? "" : "WHERE status NOT IN ('filtered', 'stale')"}
         ORDER BY coalesce(json_extract(vet, '$.fitScore'), -1) DESC, posted DESC LIMIT 1000`,
      ).all() as { company: string }[];
      json(res, 200, rows.map((r) => ({ ...r, companyName: store.companyName(r.company, cfg.companyNames) })));
    }],

    ["GET", /^\/api\/jobs\/(?<id>[0-9a-f]{16})$/, (_req, res, p) => {
      const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(p.id!) as Record<string, string | null> | undefined;
      if (!row) return json(res, 404, { error: "no such job" });
      const company = row.company_key ? (db.prepare("SELECT profile, researched_at FROM companies WHERE key = ?").get(row.company_key) as { profile: string; researched_at: string } | undefined) : undefined;
      const tailor = parse<{ dir: string }>(row.tailor ?? null);
      const appFile = tailor ? join(resolveOutput(tailor.dir), "application.md") : null;
      json(res, 200, {
        ...row,
        companyName: store.companyName(row.company ?? "", cfg.companyNames),
        signals: parse(row.signals ?? null),
        rejections: parse(row.rejections ?? null),
        hidden: parse(row.hidden ?? null),
        screen: parse(row.screen ?? null),
        vet: parse(row.vet ?? null),
        tailor,
        application: appFile && existsSync(appFile) ? readFileSync(appFile, "utf8") : null,
        companyProfile: company ? { ...JSON.parse(company.profile), researchedAt: company.researched_at } : null,
        form: withSaved(parse<FormStage>(row.form ?? null), loadAnswers()),
        answerTopics: STANDARD,
        cost: cost(db.prepare(`${usageSql} WHERE job_id = ? GROUP BY model`).all(p.id!) as never),
      });
    }],

    // Add a job by hand. A board link is read through the board's API; any other link needs company, title and text.
    ["POST", /^\/api\/jobs$/, async (req, res) => {
      const body = (await readBody(req, 200_000)) as Record<string, unknown>;
      const field = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
      const url = field("url");
      if (!/^https?:\/\/\S+$/.test(url)) return json(res, 400, { error: "The link must start with http:// or https://" });
      let p: Posting | null = null;
      let boardError = "";
      try {
        p = await fromBoard(url);
      } catch (e) {
        boardError = ` (the board didn't answer: ${(e as Error).message})`;
      }
      if (!p) {
        const d = { url, company: field("company"), title: field("title"), location: field("location"), description: field("description") };
        if (!d.company || !d.title || d.description.length < 100) {
          const why = boardOf(url) ? `That board doesn't list this job${boardError || " any more"}.` : "This isn't an Ashby, Greenhouse, Lever or Personio link.";
          return json(res, 422, { needsDetails: true, error: `${why} Paste the company, the title and the full posting text.` });
        }
        p = pasted(d);
      }
      let runId = store.latestRunId();
      if (!runId) store.finishRun((runId = store.startRun(new Date(), "vet")), "done", {});
      const s = screen(p, cfg);
      const added = store.addByHand(runId, s);
      const note = s.rejections.length ? ` (a scan would have filtered it: ${s.rejections[0]})` : "";
      store.event(runId, "dashboard", `${added.isNew ? "added by hand" : "added again by hand"}: ${p.company}, ${p.title}${note}`, "info", added.id);
      const scoring = body.score !== false && added.status === "new" && !busy();
      if (scoring) launch(["vet", added.id]);
      json(res, added.isNew ? 201 : 200, { ...added, scoring, rejections: s.rejections });
    }],

    ["GET", /^\/api\/jobs\/(?<id>[0-9a-f]{16})\/cv$/, (_req, res, p) => {
      const tailor = parse<{ cvFile: string }>((db.prepare("SELECT tailor FROM jobs WHERE id = ?").get(p.id!) as { tailor: string | null } | undefined)?.tailor ?? null);
      const file = tailor ? resolve(resolveOutput(tailor.cvFile)) : null;
      // Serve only files under the output root, whatever the stored path says.
      if (!file || !file.startsWith(resolve(outputRoot())) || !existsSync(file)) return json(res, 404, { error: "no CV for this job" });
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `inline; filename="${encodeURIComponent(file.split("/").pop()!)}"` });
      res.end(readFileSync(file));
    }],

    ["POST", /^\/api\/jobs\/(?<id>[0-9a-f]{16})\/status$/, async (req, res, p) => {
      const { status } = (await readBody(req)) as { status?: JobStatus };
      if (!status || !SETTABLE.includes(status)) return json(res, 400, { error: `status must be one of ${SETTABLE.join(", ")}` });
      const from = store.status(p.id!);
      if (!from) return json(res, 404, { error: "no such job" });
      store.setStatus(p.id!, status);
      store.event(store.latestRunId(), "dashboard", `status ${from} → ${status}`, "info", p.id!);
      json(res, 200, { id: p.id, from, to: status });
    }],

    ["POST", /^\/api\/jobs\/(?<id>[0-9a-f]{16})\/followed-up$/, (_req, res, p) => {
      if (store.status(p.id!) !== "applied") return json(res, 400, { error: "only an application waiting for a reply can be followed up" });
      store.markFollowedUp(p.id!);
      store.event(store.latestRunId(), "dashboard", "followed up", "info", p.id!);
      json(res, 200, { ok: true });
    }],

    // Read the job's application form and prepare answers, in the background like the pipeline commands.
    ["POST", /^\/api\/jobs\/(?<id>[0-9a-f]{16})\/form$/, async (req, res, p) => {
      const { url } = (await readBody(req)) as { url?: string };
      if (url !== undefined && (typeof url !== "string" || !/^https?:\/\/[^\s]+$/.test(url.trim()))) return json(res, 400, { error: "the form URL must start with http:// or https://" });
      if (!db.prepare("SELECT id FROM jobs WHERE id = ? AND vet IS NOT NULL").get(p.id!)) return json(res, 404, { error: "no vetted job with this id" });
      if (busy()) return json(res, 409, { error: "a run is already in progress" });
      json(res, 202, { started: "form", pid: launch(["form", p.id!, ...(url ? [url.trim()] : [])]) });
    }],

    ["POST", /^\/api\/answers$/, async (req, res) => {
      const { key, value } = (await readBody(req)) as { key?: string; value?: string };
      if (!key || !STANDARD_KEYS.includes(key as StandardKey)) return json(res, 400, { error: `key must be one of ${STANDARD_KEYS.join(", ")}` });
      if (typeof value !== "string" || value.length > 2000) return json(res, 400, { error: "value must be text under 2,000 characters" });
      saveAnswer(key as StandardKey, value);
      store.event(store.latestRunId(), "dashboard", `saved answer: ${key}`);
      json(res, 200, { key });
    }],

    // The Preferences page: the search filters in effect, what the scorer reads about you, and saved form answers.
    ["GET", /^\/api\/preferences$/, (_req, res) => {
      json(res, 200, {
        search: { profile: cfg.profile, locations: cfg.locations, titleInclude: cfg.titleInclude, titleExclude: cfg.titleExclude, companyExclude: cfg.companyExclude, followUpDays: cfg.followUpDays, maybeDays: cfg.maybeDays, vet: { applyAt: cfg.vet.applyAt, maybeAt: cfg.vet.maybeAt } },
        prefs: loadPreferences(),
        answers: loadAnswers(),
        answerTopics: STANDARD,
        linkedinLocation: cfg.linkedin.location,
        foundBoards: store.boards(),
      });
    }],

    // Save all three at once. Every later run reads them; this server picks up the new filters straight away.
    ["POST", /^\/api\/preferences$/, async (req, res) => {
      const body = (await readBody(req, 100_000)) as { search?: unknown; prefs?: unknown; answers?: unknown };
      const search = Search.required().safeParse(body.search);
      if (!search.success) return json(res, 400, { error: `Search filters: ${problems(search.error)}` });
      const prefs = Preferences.safeParse(body.prefs);
      if (!prefs.success) return json(res, 400, { error: `What you want: ${problems(prefs.error)}` });
      const answers = Object.entries((body.answers ?? {}) as Record<string, unknown>);
      const bad = answers.find(([k, v]) => !STANDARD_KEYS.includes(k as StandardKey) || typeof v !== "string" || v.length > 2000);
      if (bad) return json(res, 400, { error: `Form answers: "${bad[0]}" must be a known topic with text under 2,000 characters` });
      writeJson(SEARCH_PATH, search.data);
      writeJson(PREFS_PATH, prefs.data);
      writeJson(ANSWERS_PATH, Object.fromEntries(answers.map(([k, v]) => [k, (v as string).trim()]).filter(([, v]) => v)));
      // Handlers share this config object, so updating it in place applies the new filters to every route.
      Object.assign(cfg, loadConfig());
      store.event(store.latestRunId(), "dashboard", "saved preferences");
      json(res, 200, { ok: true });
    }],

    // `ids` (vet and tailor only) limits the run to those jobs, for the buttons on a job's page.
    ["POST", /^\/api\/actions\/(?<name>scan|vet|tailor|inbox|rescreen)$/, async (req, res, p) => {
      const { ids = [] } = (await readBody(req)) as { ids?: unknown };
      const name = p.name as (typeof ACTIONS)[number];
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && /^[0-9a-f]{16}$/.test(id)) || (ids.length && name !== "vet" && name !== "tailor"))
        return json(res, 400, { error: "ids must be job ids, and only for vet or tailor" });
      if (busy()) return json(res, 409, { error: "a run is already in progress" });
      json(res, 202, { started: name, pid: launch([name, ...ids]) });
    }],

    ["GET", /^\/api\/pipeline(?:\/(?<id>\d+))?$/, (_req, res, p) => {
      // Without an id: the running run if there is one, else the latest scan.
      const id = p.id
        ? Number(p.id)
        : ((db.prepare("SELECT id FROM runs WHERE status = 'running' ORDER BY id DESC LIMIT 1").get() ??
            db.prepare("SELECT id FROM runs WHERE kind = 'scan' ORDER BY id DESC LIMIT 1").get()) as { id: number } | undefined)?.id;
      const out = id ? runPipeline(db, id, price) : null;
      return out ? json(res, 200, out) : json(res, 404, { error: "no runs yet" });
    }],

    ["GET", /^\/api\/inbox$/, (_req, res) => {
      const rows = db.prepare(
        `SELECT e.id, e.received_at, e.from_addr, e.subject, e.snippet, e.kind, e.rule, e.job_id, e.match_reason, e.from_status, e.to_status, e.undone,
           j.company, j.title, j.status AS job_status
         FROM emails e LEFT JOIN jobs j ON j.id = e.job_id ORDER BY e.received_at DESC LIMIT 200`,
      ).all() as { company: string | null }[];
      json(res, 200, rows.map((r) => ({ ...r, companyName: r.company ? store.companyName(r.company, cfg.companyNames) : null })));
    }],

    // Undo an automatic status change, if the job is still where the email put it.
    ["POST", /^\/api\/inbox\/(?<id>\d+)\/undo$/, (_req, res, p) => {
      const e = db.prepare("SELECT job_id, from_status, to_status, undone FROM emails WHERE id = ?").get(Number(p.id)) as { job_id: string | null; from_status: string | null; to_status: string | null; undone: number } | undefined;
      if (!e?.job_id || !e.to_status || e.undone) return json(res, 400, { error: "nothing to undo" });
      const now = store.status(e.job_id);
      if (now !== e.to_status) return json(res, 409, { error: `the job has since moved to ${now ?? "nowhere (deleted)"}` });
      store.setStatus(e.job_id, e.from_status as JobStatus);
      db.prepare("UPDATE emails SET undone = 1 WHERE id = ?").run(Number(p.id));
      store.event(store.latestRunId(), "dashboard", `undid email status change ${e.to_status} → ${e.from_status}`, "info", e.job_id);
      json(res, 200, { ok: true });
    }],

    // Classify or assign an email the rules couldn't handle; applies the same status rule as the automatic path.
    ["POST", /^\/api\/inbox\/(?<id>\d+)\/resolve$/, async (req, res, p) => {
      const { jobId, kind } = (await readBody(req)) as { jobId?: string; kind?: string };
      if (!kind || !["confirmation", "rejection", "interview", "ignored"].includes(kind)) return json(res, 400, { error: "kind must be confirmation, rejection, interview or ignored" });
      const email = db.prepare("SELECT to_status, undone FROM emails WHERE id = ?").get(Number(p.id)) as { to_status: string | null; undone: number } | undefined;
      if (!email) return json(res, 404, { error: "no such email" });
      // Re-resolving would overwrite the change it already made, and with it the way to undo that change.
      if (email.to_status && !email.undone) return json(res, 409, { error: "this email already moved its job; undo that first" });
      const current = jobId ? store.status(jobId) : null;
      if (jobId && !current) return json(res, 404, { error: "no such job" });
      const next = current && kind !== "ignored" ? nextStatus(kind as EmailKind, current) : null;
      if (next) {
        store.setStatus(jobId!, next);
        store.event(store.latestRunId(), "dashboard", `email set by you: ${current} → ${next} (${kind})`, "info", jobId!);
      }
      db.prepare("UPDATE emails SET kind = ?, job_id = coalesce(?, job_id), match_reason = 'set by you', from_status = ?, to_status = ?, undone = 0 WHERE id = ?")
        .run(kind, jobId ?? null, next ? current : null, next, Number(p.id));
      json(res, 200, { ok: true, to: next });
    }],

    ["GET", /^\/api\/funnel$/, (_req, res) => {
      json(res, 200, db.prepare(
        `SELECT source, status, count(*) AS n FROM jobs WHERE status IN ('apply', 'cv_ready', 'applied', 'interview', 'rejected') GROUP BY source, status`,
      ).all());
    }],
  ];
}
