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
  }),
  caps: z.object({ vetPerRun: z.number().int(), tailorPerRun: z.number().int() }),
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

export const loadConfig = (path = defaultPath()): Config => Config.parse(JSON.parse(readFileSync(path, "utf8")));
