// Employee-review snippets from kununu and Glassdoor, through the Tavily search API. Both sites block automated
// access, so the pages are never fetched: the search index's snippets usually carry the rating and review count.
// Without TAVILY_API_KEY this returns nothing and research works as before.
import { stripInvisible } from "../injection/scan.ts";
import type { ResearchSource } from "./gather.ts";

export type ReviewSite = "kununu" | "glassdoor";
const DOMAINS: Record<ReviewSite, string[]> = { kununu: ["kununu.com"], glassdoor: ["glassdoor.com", "glassdoor.de"] };

interface TavilyResult { url: string; title: string; content: string }

async function search(key: string, query: string, domains: string[]): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    // "advanced" costs 2 credits instead of 1, but "basic" snippets mostly lack the score.
    body: JSON.stringify({ query, include_domains: domains, search_depth: "advanced", max_results: 3 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { results?: TavilyResult[] }).results ?? [];
}

export async function reviewSources(name: string, errors: string[], key = process.env.TAVILY_API_KEY): Promise<ResearchSource[]> {
  if (!key) return [];
  const sites = Object.keys(DOMAINS) as ReviewSite[];
  const found = await Promise.all(
    sites.map((site) =>
      search(key, `${name} ${site === "kununu" ? "Bewertungen" : "reviews"} rating`, DOMAINS[site]).catch((e: Error) => (errors.push(`${site}: ${e.message}`), [])),
    ),
  );
  return found.flat().map((r) => ({ url: r.url, kind: "reviews" as const, title: r.title, text: stripInvisible(r.content).slice(0, 1500) }));
}

/**
 * A company's own page on the site, not a ranking, search, job list or single review: kununu's /de/<company>[/kommentare],
 * Glassdoor's /Reviews/, /Overview/, /Bewertungen/ or /Ueberblick/ pages.
 */
export function isCompanyPage(site: ReviewSite, url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (!DOMAINS[site].some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) return false;
  // Filtered views rate a slice of the company: kununu's ?position=student, Glassdoor's location (_IL, _IC, _IN) and topic (_KH) pages.
  if (u.search || /_(IL|IC|IN|KH)[.\d]/.test(u.pathname)) return false;
  return site === "kununu"
    ? /^\/(de|at|ch)\/(?!beste-arbeitgeber|top-|search|jobs|gehalt)[^/]+(\/kommentare)?\/?$/i.test(u.pathname)
    : /^\/(Reviews|Overview|Bewertungen|Ueberblick)\/(?!Employee-Review)/.test(u.pathname);
}

/** The snippet without comparisons such as kununu's "unter dem Durchschnitt (3,8 Punkte)", which aren't the company's score. */
export const withoutAverages = (text: string) =>
  text.replace(/(branchen)?durchschnitt\s*\([^)]*\)/gi, " ").replace(/(industry|sector) average[^.;)]*/gi, " ");

/** Whether `text` states the number, in English or German form ("3.6", "3,6"; "1,545", "1.545", "1545"). */
export function mentions(text: string, n: number, decimals: 0 | 1): boolean {
  const forms = decimals
    ? [n.toFixed(1), n.toFixed(1).replace(".", ",")]
    : [String(n), n.toLocaleString("en-US"), n.toLocaleString("de-DE")];
  return forms.some((f) => new RegExp(`(^|[^\\d.,])${f.replace(/[.,]/g, "\\$&")}($|[^\\d]|[.,](?!\\d))`).test(text));
}
