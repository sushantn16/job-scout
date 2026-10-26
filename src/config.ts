import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const Pattern = z.string().refine((s) => {
  try { new RegExp(s, "i"); return true; } catch { return false; }
}, "invalid regular expression");

export const Config = z.object({
  profile: z.object({
    maxYearsRequired: z.number().int(),
    minBandTopEur: z.number(),
    germanBlocksAt: z.enum(["required", "plus"]),
    /** Postings by a recruiter for a client, or reposted by a job board: score them with a badge, or skip them. */
    recruiters: z.enum(["flag", "skip"]).default("flag"),
  }),
  caps: z.object({ vetPerRun: z.number().int(), tailorPerRun: z.number().int() }),
  /**
   * Jobs worked on at once. Each job's screen, research and score run in order (research reads the screened text), but
   * jobs run side by side, and a job moves on to tailoring as soon as it's scored "apply".
   */
  concurrency: z.object({ score: z.number().int().positive(), tailor: z.number().int().positive() }).default({ score: 4, tailor: 3 }),
  /** Days without a reply before an application is due a follow-up. */
  followUpDays: z.number().int().positive().default(10),
  /** Days a job can stay in maybe without a decision before a scan moves it to skip. */
  maybeDays: z.number().int().positive().default(5),
  freshness: z.object({ minHours: z.number(), maxHours: z.number() }),
  /** Fit-score weights (see src/vet/score.ts); all but remoteBonus should sum to 100. */
  vet: z.object({
    applyAt: z.number(),
    maybeAt: z.number(),
    weights: z.object({
      roleFit: z.number(), stackOverlap: z.number(), seniority: z.number(), aiRelevance: z.number(), funding: z.number(),
      culture: z.number(), english: z.number(), pay: z.number(), competition: z.number(), remoteBonus: z.number(),
    }),
  }),
  fxToEur: z.object({ EUR: z.number(), GBP: z.number(), USD: z.number() }),
  locations: z.record(z.string(), Pattern),
  titleInclude: Pattern,
  titleExclude: Pattern,
  companyExclude: Pattern,
  sources: z.object({
    ashby: z.array(z.string()),
    greenhouse: z.array(z.string()),
    lever: z.array(z.string()),
    personio: z.array(z.string()),
    hn: z.boolean(),
  }),
  /** USD per million tokens, keyed by model ID; "default" applies to any model without its own entry. */
  pricing: z.record(z.string(), z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), note: z.string().optional() }))
    .refine((p) => "default" in p, "pricing needs a default entry"),
  /** Display names for board slugs, used for company research ("peec" is "Peec AI"). */
  companyNames: z.record(z.string(), z.string()),
  linkedin: z.object({
    keywords: z.array(z.string()),
    geoId: z.string(),
    location: z.string(),
    maxDetails: z.number().int(),
  }),
});
export type Config = z.infer<typeof Config>;

/** Your own settings in the git-ignored config/job-scout.local.json win over the example in config/job-scout.json. */
const defaultPath = () => (existsSync("config/job-scout.local.json") ? "config/job-scout.local.json" : "config/job-scout.json");

/**
 * The search filters you edit on the dashboard's Preferences page. They live in the data volume, so they survive an
 * image rebuild (config/ is baked into the image), and they win over the config file.
 */
export const SEARCH_PATH = "data/private/search.json";
export const Search = z.object({
  profile: Config.shape.profile,
  locations: Config.shape.locations,
  titleInclude: Pattern,
  titleExclude: Pattern,
  companyExclude: Pattern,
  followUpDays: z.number().int().positive(),
  maybeDays: z.number().int().positive(),
  vet: z.object({ applyAt: z.number(), maybeAt: z.number() }).refine((v) => v.applyAt > v.maybeAt, "the apply line must be above the maybe line"),
}).partial();
export type Search = z.infer<typeof Search>;

/** What decides which jobs are kept, as one comparable string: a change to it widens the next scan (newJobWindow). */
export const keptBy = (s: Pick<Config, "locations" | "titleInclude" | "titleExclude" | "companyExclude" | "profile">) =>
  JSON.stringify([s.locations, s.titleInclude, s.titleExclude, s.companyExclude, s.profile]);

/** `searchPath` null ignores saved search filters (tests use the example config as it is). */
export function loadConfig(path = defaultPath(), searchPath: string | null = SEARCH_PATH): Config {
  const base = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> & { vet?: object };
  const search = searchPath && existsSync(searchPath) ? Search.parse(JSON.parse(readFileSync(searchPath, "utf8"))) : {};
  return Config.parse({ ...base, ...search, vet: { ...base.vet, ...search.vet } });
}
