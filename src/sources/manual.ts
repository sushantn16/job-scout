// Jobs you add by hand from the dashboard. A link to an Ashby, Greenhouse, Lever or Personio posting is read through that
// board's public API, so the job is stored exactly as a scan would store it; any other link needs its details pasted.
import { ATS, type AtsKind } from "./ats.ts";
import { posting, type Posting } from "./types.ts";

/** The board and job a posting link points at, for the boards whose public API lists the job. */
export function boardOf(link: string): { kind: AtsKind; slug: string; jobId: string } | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const path = u.pathname.replace(/\/+$/, "");
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (/(^|\.)greenhouse\.io$/.test(u.host)) {
    const m = path.match(/^\/([^/]+)\/jobs\/(\d+)/);
    const slug = m?.[1] ?? u.searchParams.get("for");
    const jobId = m?.[2] ?? u.searchParams.get("token") ?? u.searchParams.get("gh_jid");
    return slug && jobId ? { kind: "greenhouse", slug, jobId } : null;
  }
  if (u.host === "jobs.ashbyhq.com" && /^[0-9a-f-]{36}$/.test(seg[1] ?? "")) return { kind: "ashby", slug: seg[0]!, jobId: seg[1]! };
  if (/^jobs\.(eu\.)?lever\.co$/.test(u.host) && seg[0] && /^[0-9a-f-]{36}$/.test(seg[1] ?? "")) return { kind: "lever", slug: seg[0], jobId: seg[1]! };
  const personio = u.host.match(/^([\w-]+)\.jobs\.personio\.(?:de|com)$/);
  const personioId = seg[0] === "job" ? seg[1]?.match(/^\d+/)?.[0] : undefined;
  if (personio && personioId) return { kind: "personio", slug: personio[1]!, jobId: personioId };
  return null;
}

/** The posting behind a board link, from the board's own listing; null if the link isn't a board's or the job is gone. */
export async function fromBoard(link: string): Promise<Posting | null> {
  const b = boardOf(link);
  if (!b) return null;
  const jobs = await ATS[b.kind](b.slug);
  return jobs.find((p) => p.url.includes(b.jobId)) ?? null;
}

/** A posting from details you pasted, for links no board API covers (LinkedIn, a company's own careers page). */
export const pasted = (d: { url: string; company: string; title: string; location: string; description: string }): Posting =>
  posting({ source: "manual", url: d.url, company: d.company, title: d.title, location: d.location, description: d.description });
