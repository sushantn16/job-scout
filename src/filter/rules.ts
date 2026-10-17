import type { Config } from "../config.ts";
import type { Posting } from "../sources/types.ts";
import { applicantCount, germanRequirement, salaryBand, workplace, yearsRequired, type Band, type Evidence, type GermanLevel, type Workplace } from "./signals.ts";

export interface Signals {
  locationMatch: string;
  german: Evidence<GermanLevel>;
  years: Evidence<number | null>;
  band: Evidence<Band | null>;
  bandTopEur: number | null;
  workplace: Evidence<Workplace>;
  applicants: number | null;
}

export interface Screened {
  posting: Posting;
  signals: Signals;
  /** Empty when the job passes every hard rule. */
  rejections: string[];
}

const re = (s: string) => new RegExp(s, "i");

/** Which configured location a posting matches, or null. HN posts carry location in their header line. */
export function matchLocation(p: Posting, cfg: Config): string | null {
  const where = `${p.location} ${p.workplace}`;
  for (const [name, pattern] of Object.entries(cfg.locations)) if (re(pattern).test(where)) return name;
  return null;
}

/** Cheap relevance check before any detail fetch: right kind of role, right place, not a recruiter. */
export function isRelevant(p: Posting, cfg: Config): boolean {
  const title = p.source === "hn" ? (p.description.split("\n")[0] ?? "") : p.title;
  return (
    re(cfg.titleInclude).test(title) &&
    !re(cfg.titleExclude).test(p.title) &&
    !re(cfg.companyExclude).test(p.company) &&
    matchLocation(p, cfg) !== null
  );
}

export function screen(p: Posting, cfg: Config): Screened {
  const band = salaryBand(p.comp, p.description);
  const signals: Signals = {
    locationMatch: matchLocation(p, cfg) ?? "",
    german: germanRequirement(p.description),
    years: yearsRequired(p.description),
    band,
    bandTopEur: band.value ? Math.round(band.value.max * cfg.fxToEur[band.value.currency]) : null,
    workplace: workplace(p.workplace, p.description),
    applicants: applicantCount(p.applicants),
  };
  const rejections: string[] = [];
  const g = signals.german.value;
  if (g === "required" || (cfg.profile.germanBlocksAt === "plus" && g === "plus")) rejections.push(`German ${g}: ${signals.german.evidence}`);
  if (signals.years.value !== null && signals.years.value > cfg.profile.maxYearsRequired)
    rejections.push(`${signals.years.value}+ years required: ${signals.years.evidence}`);
  if (signals.bandTopEur !== null && signals.bandTopEur < cfg.profile.minBandTopEur)
    rejections.push(`band tops out at €${Math.round(signals.bandTopEur / 1000)}K: ${band.evidence}`);
  return { posting: p, signals, rejections };
}
