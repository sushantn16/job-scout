// Public job-board APIs of applicant tracking systems. All are unauthenticated and documented for job widgets.
import { getJson, getText } from "../http.ts";
import { decodeEntities, htmlToText } from "../text.ts";
import { scanHtml } from "../injection/scan.ts";
import { posting, type Posting } from "./types.ts";

const hidden = (...html: (string | undefined)[]) => html.flatMap((h) => (h ? scanHtml(h).map((f) => f.quote) : []));

interface AshbyJob {
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  jobUrl: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  workplaceType?: string;
  isRemote?: boolean;
  publishedAt?: string;
  compensation?: { compensationTierSummary?: string | null } | null;
}

export async function ashby(slug: string): Promise<Posting[]> {
  const d = await getJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
  );
  return (d.jobs ?? []).map((j) =>
    posting({
      source: "ashby",
      company: slug,
      title: j.title,
      location: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join("; "),
      url: j.jobUrl,
      description: j.descriptionPlain ?? "",
      hiddenText: hidden(j.descriptionHtml),
      comp: j.compensation?.compensationTierSummary ?? "",
      workplace: j.workplaceType ?? (j.isRemote ? "Remote" : ""),
      posted: j.publishedAt ?? "",
    }),
  );
}

interface GreenhouseJob {
  title: string;
  location?: { name?: string };
  absolute_url: string;
  content?: string;
  first_published?: string;
}

export async function greenhouse(slug: string): Promise<Posting[]> {
  const d = await getJson<{ jobs?: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  return (d.jobs ?? []).map((j) =>
    posting({
      source: "greenhouse",
      company: slug,
      title: j.title,
      location: j.location?.name ?? "",
      url: j.absolute_url,
      // Greenhouse double-encodes: the content field is entity-escaped HTML.
      description: htmlToText(decodeEntities(j.content ?? "")),
      hiddenText: hidden(decodeEntities(j.content ?? "")),
      // first_published, not updated_at: edits bump updated_at and would make old jobs look fresh.
      posted: j.first_published ? new Date(j.first_published).toISOString() : "",
    }),
  );
}

interface LeverJob {
  text: string;
  hostedUrl: string;
  categories?: { location?: string; allLocations?: string[] };
  descriptionPlain?: string;
  description?: string;
  lists?: { text?: string; content?: string }[];
  workplaceType?: string;
  createdAt?: number;
}

export async function lever(slug: string): Promise<Posting[]> {
  for (const base of ["https://api.lever.co", "https://api.eu.lever.co"]) {
    let d: LeverJob[];
    try {
      d = await getJson<LeverJob[]>(`${base}/v0/postings/${slug}?mode=json`, { tries: 1 });
    } catch {
      continue;
    }
    if (!Array.isArray(d) || d.length === 0) continue;
    return d.map((j) =>
      posting({
        source: "lever",
        company: slug,
        title: j.text,
        location: [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join("; "),
        url: j.hostedUrl,
        description: [j.descriptionPlain ?? "", ...(j.lists ?? []).map((l) => `${l.text ?? ""}\n${htmlToText(l.content ?? "")}`)].join("\n"),
        hiddenText: hidden(j.description, ...(j.lists ?? []).map((l) => l.content)),
        workplace: j.workplaceType ?? "",
        posted: j.createdAt ? new Date(j.createdAt).toISOString() : "",
      }),
    );
  }
  return [];
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");

export async function personio(slug: string): Promise<Posting[]> {
  const xml = await getText(`https://${slug}.jobs.personio.de/xml`);
  return [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map(([, p = ""]) => {
    const offices = [tag(p, "office"), ...[...p.matchAll(/<additionalOffice>([\s\S]*?)<\/additionalOffice>/g)].map((m) => m[1] ?? "")];
    const desc = [...p.matchAll(/<value>([\s\S]*?)<\/value>/g)].map((m) => htmlToText(cdata(m[1] ?? ""))).join("\n");
    return posting({
      source: "personio",
      company: slug,
      title: decodeEntities(cdata(tag(p, "name"))),
      location: offices.map((o) => decodeEntities(cdata(o))).filter(Boolean).join("; "),
      url: `https://${slug}.jobs.personio.de/job/${tag(p, "id")}`,
      description: desc,
      posted: tag(p, "createdAt"),
    });
  });
}

export const ATS = { ashby, greenhouse, lever, personio } as const;
export type AtsKind = keyof typeof ATS;
