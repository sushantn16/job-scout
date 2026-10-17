// Deterministic source gathering for company research. Everything fetched here is untrusted text for the LLM.
import { getJson, getText } from "../http.ts";
import { stripInvisible } from "../injection/scan.ts";
import { decodeEntities, htmlToText } from "../text.ts";

export interface ResearchSource {
  url: string;
  kind: "website" | "page" | "news" | "hn" | "github" | "posting";
  title: string;
  text: string;
  date?: string;
}

export interface Gathered {
  website: string | null;
  sources: ResearchSource[];
  errors: string[];
}

const NOT_COMPANY_SITES = /ashbyhq|greenhouse|lever\.co|personio|linkedin|glassdoor|kununu|indeed|stepstone|youtube|twitter|x\.com|instagram|facebook|tiktok|google\.|apple\.com|github\.com|notion\.site|medium\.com|bit\.ly|wellfound|ycombinator\.com|crunchbase/i;
const PAGE_HINT = /\/(about|company|careers?|jobs|culture|values|team|engineering|blog|tech)(\/|$)/i;
const token = (name: string) => name.toLowerCase().replace(/\b(gmbh|ag|se|inc|ltd|labs?|technologies|hq)\b/g, "").replace(/[^a-z0-9]/g, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Headlines about the company rather than the word: funding, growth, people, deals.
const COMPANY_NEWS = /\b(raises?|raised|secures|bags|lands|funding|series [a-e]\b|valuation|unicorn|revenue|arr\b|layoffs?|lays off|cuts|acquires?|acquired|acquisition|merger|expands|launch\w*|ceo|founder|startup|\$\d|€\d|£\d)/i;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} [...]` : s);

function pageText(html: string): { title: string; text: string; links: string[] } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const meta = decodeEntities(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? "");
  const body = html.replace(/<(nav|footer|header|svg|noscript)[\s\S]*?<\/\1>/gi, " ");
  const links = [...html.matchAll(/href=["']([^"'#?]+)["']/gi)].map((m) => m[1] ?? "");
  return { title, text: stripInvisible(`${meta}\n${htmlToText(body)}`).trim(), links };
}

async function fetchPage(url: string, kind: ResearchSource["kind"], max: number) {
  const html = await getText(url, { tries: 2, timeoutMs: 15_000 });
  const { title, text, links } = pageText(html);
  return { source: { url, kind, title, text: clip(text, max) } satisfies ResearchSource, links };
}

async function findWebsite(name: string, slug: string | undefined, postingText: string, errors: string[]): Promise<{ site: string | null; github?: ResearchSource }> {
  let github: ResearchSource | undefined;
  for (const org of [...new Set([slug, token(name)].filter(Boolean))] as string[]) {
    try {
      const o = await getJson<{ login: string; name?: string; blog?: string; description?: string; public_repos: number; followers: number; created_at: string }>(
        `https://api.github.com/orgs/${org}`, { tries: 1 },
      );
      github = {
        url: `https://github.com/${o.login}`, kind: "github", title: `GitHub org ${o.login}`,
        text: `${o.name ?? o.login}: ${o.description ?? ""}. ${o.public_repos} public repos, ${o.followers} followers, on GitHub since ${o.created_at.slice(0, 4)}.`,
      };
      if (o.blog) return { site: o.blog.startsWith("http") ? o.blog : `https://${o.blog}`, github };
      break;
    } catch {
      // No such org, or rate-limited; fall through to the other strategies.
    }
  }
  const t = token(name);
  const fromPosting = [...postingText.matchAll(/https?:\/\/[^\s)>\]"']+/g)]
    .map((m) => { try { return new URL(m[0]); } catch { return null; } })
    .find((u) => u && !NOT_COMPANY_SITES.test(u.hostname) && t.length >= 3 && u.hostname.replace(/[^a-z0-9]/g, "").includes(t));
  if (fromPosting) return { site: fromPosting.origin, github };
  // "Peec AI" lives at peec.ai: try the board slug and the name without an "AI" suffix too.
  const stems = [...new Set([slug, t, token(name.replace(/\s+ai$/i, ""))].filter((x): x is string => !!x && x.length >= 3))];
  // Accept a guessed domain only if the page names the company: the full name for multi-word names ("Peec AI";
  // peec.com is someone else), the page title for single-word names.
  const named = (title: string, text: string) =>
    /\s/.test(name.trim()) ? `${title} ${text.slice(0, 3000)}`.toLowerCase().includes(name.toLowerCase()) : title.toLowerCase().includes(name.toLowerCase());
  const tlds = /\sai$/i.test(name) ? ["ai", "com", "io", "de", "co"] : ["com", "ai", "io", "de", "co"];
  for (const stem of stems) {
    for (const tld of tlds) {
      const url = `https://${stem}.${tld}`;
      try {
        const { title, text } = pageText(await getText(url, { tries: 1, timeoutMs: 8_000 }));
        if (named(title, text)) return { site: url, github };
      } catch {
        // Domain doesn't exist or doesn't answer.
      }
    }
  }
  errors.push(`website not found for ${name}`);
  return { site: null, github };
}

interface Rss { title: string; link: string; date: string; source: string }
const rssItems = (xml: string): Rss[] =>
  [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, i = ""]) => ({
    title: decodeEntities(i.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
    link: i.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "",
    date: new Date(i.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "").toISOString().slice(0, 10),
    source: decodeEntities(i.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? ""),
  }));

export async function gather(company: { name: string; slug?: string; postingText: string; postingUrl: string }): Promise<Gathered> {
  const errors: string[] = [];
  const sources: ResearchSource[] = [{ url: company.postingUrl, kind: "posting", title: "The job posting", text: clip(company.postingText, 3000) }];
  const { site, github } = await findWebsite(company.name, company.slug, company.postingText, errors);
  if (github) sources.push(github);

  if (site) {
    try {
      const home = await fetchPage(site, "website", 4000);
      sources.push(home.source);
      const origin = new URL(site).origin;
      const pages = [...new Set(home.links.map((l) => { try { return new URL(l, origin); } catch { return null; } })
        .filter((u): u is URL => !!u && u.origin === origin && PAGE_HINT.test(u.pathname))
        .map((u) => u.href))].slice(0, 3);
      for (const url of pages) {
        try { sources.push((await fetchPage(url, "page", 3000)).source); } catch (e) { errors.push(`${url}: ${(e as Error).message}`); }
      }
    } catch (e) {
      errors.push(`${site}: ${(e as Error).message}`);
    }
  }

  const since = new Date(Date.now() - 548 * 86_400_000).toISOString().slice(0, 10);
  try {
    const q = encodeURIComponent(`"${company.name}" (funding OR raises OR "Series" OR layoffs OR acquires OR acquired OR valuation)`);
    const news = rssItems(await getText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, { tries: 2 }))
      // Whole-word, case-sensitive name match: drops "side gigs" and "recreate gigs" for a company called Gigs.
      .filter((n) => n.date >= since && new RegExp(`(^|[^\\w])${escapeRe(company.name)}($|[^\\w])`).test(n.title) && COMPANY_NEWS.test(n.title))
      .slice(0, 10);
    for (const n of news) sources.push({ url: n.link, kind: "news", title: n.title, text: `${n.title} (${n.source}, ${n.date})`, date: n.date });
  } catch (e) {
    errors.push(`news: ${(e as Error).message}`);
  }

  try {
    // With a known site, stories linking to it (launches, engineering posts) beat a name search, which is noisy for
    // generic names.
    const host = site ? new URL(site).hostname.replace(/^www\./, "") : null;
    const url = host
      ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(host)}&restrictSearchableAttributes=url&tags=story`
      : `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${company.name}"`)}&tags=story&numericFilters=points>50`;
    const { hits } = await getJson<{ hits: { title: string; url: string | null; objectID: string; points: number; created_at: string }[] }>(url);
    // Algolia's url search is typo-tolerant (gigs.com also matches gifs.com): keep exact host matches only.
    const ours = (u: string | null) => { try { return !host || (!!u && new URL(u).hostname.replace(/^www\./, "").endsWith(host)); } catch { return false; } };
    for (const h of hits.filter((h) => ours(h.url)).slice(0, 5)) {
      sources.push({ url: `https://news.ycombinator.com/item?id=${h.objectID}`, kind: "hn", title: h.title, text: `${h.title} (${h.points} points, ${h.created_at.slice(0, 10)})${h.url ? ` -> ${h.url}` : ""}`, date: h.created_at.slice(0, 10) });
    }
  } catch (e) {
    errors.push(`hn: ${(e as Error).message}`);
  }
  return { website: site, sources, errors };
}
