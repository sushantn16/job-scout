// Fit score: the LLM rates a few factors on fixed scales; this formula combines them with configured weights. Factors
// that facts can decide (years, pay band, applicants, workplace) are computed here, never rated.
import type { Signals } from "../filter/rules.ts";

export interface Ratings {
  /** 0-4: 4 product/full-stack owning features end to end, 3 close neighbour, 2 generalist overlap, 1 mostly different, 0 unrelated. */
  roleFit: number;
  /** 0-4: share of the must-have stack the CV shows evidence for. */
  stackOverlap: number;
  /** 0-2: none, AI tooling or minor AI features, core LLM/AI product work. */
  aiRelevance: number;
  level: "junior" | "mid" | "senior" | "staff-plus" | "unspecified";
  stageAndFunding: "good" | "concern" | "unknown";
  engineeringCulture: "strong" | "average" | "weak" | "unknown";
  englishFirst: "yes" | "no" | "unknown";
}

export interface Weights {
  roleFit: number;
  stackOverlap: number;
  seniority: number;
  aiRelevance: number;
  funding: number;
  culture: number;
  english: number;
  pay: number;
  competition: number;
  remoteBonus: number;
}

export interface Factor {
  factor: string;
  weight: number;
  /** 0-1 share of the weight earned. */
  value: number;
  points: number;
  basis: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const LEVEL: Record<Ratings["level"], number> = { senior: 1, unspecified: 1, "staff-plus": 0.6, mid: 0.5, junior: 0 };
const yearsFactor = (y: number | null) => (y === null || y <= 4 ? 1 : y === 5 ? 0.85 : 0.6);
const FUNDING = { good: 1, unknown: 0.5, concern: 0 } as const;
const CULTURE = { strong: 1, average: 0.6, weak: 0.2, unknown: 0.5 } as const;
const ENGLISH = { yes: 1, unknown: 0.6, no: 0 } as const;
const pay = (top: number | null) => (top === null ? 0.5 : top >= 140_000 ? 1 : top >= 120_000 ? 0.8 : 0.6);
const competition = (n: number | null) => (n === null ? 0.6 : n < 25 ? 1 : n < 100 ? 0.7 : n < 200 ? 0.4 : 0.2);

export interface EmployeeReviews { rating: number; count: number; basis: string }
/**
 * kununu and Glassdoor combined, weighted by review count. Only ratings with a stated count count, so a page with a
 * handful of reviews can't sink a company. Null without one.
 */
export function combineReviews(reviews: { site: string; rating: number; reviewCount: number | null }[]): EmployeeReviews | null {
  const counted = reviews.filter((r): r is typeof r & { reviewCount: number } => r.reviewCount !== null && r.reviewCount > 0);
  const count = counted.reduce((n, r) => n + r.reviewCount, 0);
  if (!count) return null;
  const rating = Math.round((counted.reduce((s, r) => s + r.rating * r.reviewCount, 0) / count) * 10) / 10;
  return { rating, count, basis: counted.map((r) => `${r.site} ${r.rating} (${r.reviewCount})`).join(", ") };
}
/** Employees' rating scales the culture factor: a well-reviewed company keeps it, a poorly reviewed one loses it. */
const reviewFactor = (r: EmployeeReviews | null) => (!r || r.count < 20 || r.rating >= 3.5 ? 1 : r.rating >= 3 ? 0.5 : 0);

export function fitScore(r: Ratings, s: Signals, w: Weights, reviews: EmployeeReviews | null = null): { score: number; factors: Factor[] } {
  const f = (factor: string, weight: number, value: number, basis: string): Factor => {
    const v = clamp01(value);
    return { factor, weight, value: v, points: Math.round(weight * v * 10) / 10, basis };
  };
  const factors = [
    f("role fit", w.roleFit, r.roleFit / 4, `${r.roleFit}/4`),
    f("stack overlap", w.stackOverlap, r.stackOverlap / 4, `${r.stackOverlap}/4`),
    f("seniority", w.seniority, LEVEL[r.level] * yearsFactor(s.years.value), `level ${r.level}, ${s.years.value ?? "no"} years asked`),
    f("AI relevance", w.aiRelevance, r.aiRelevance / 2, `${r.aiRelevance}/2`),
    f("funding & outlook", w.funding, FUNDING[r.stageAndFunding], r.stageAndFunding),
    f("engineering culture", w.culture, CULTURE[r.engineeringCulture] * reviewFactor(reviews), reviews ? `${r.engineeringCulture}; employees rate it ${reviews.rating}/5 (${reviews.basis})` : r.engineeringCulture),
    f("English-first", w.english, ENGLISH[r.englishFirst], r.englishFirst),
    f("pay band", w.pay, pay(s.bandTopEur), s.bandTopEur === null ? "not posted" : `tops out at €${Math.round(s.bandTopEur / 1000)}K`),
    f("competition", w.competition, competition(s.applicants), s.applicants === null ? "applicants unknown" : `${s.applicants} applicants`),
  ];
  if (s.workplace.value === "remote" && w.remoteBonus) factors.push({ factor: "remote", weight: w.remoteBonus, value: 1, points: w.remoteBonus, basis: "remote role" });
  const score = Math.round(Math.min(100, factors.reduce((sum, x) => sum + x.points, 0)));
  return { score, factors };
}
