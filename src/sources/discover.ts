// Finding a company's own job board from its name, for jobs the scan only saw on LinkedIn, HN or a pasted link. A
// board counts only when it lists the same job: a shared name isn't proof. A found board is scanned directly from
// then on (allowed, unlike LinkedIn), and the job's own posting there gives the form reader a link to follow.
import { ATS, type AtsKind } from "./ats.ts";
import type { Posting } from "./types.ts";

const ORDER: AtsKind[] = ["ashby", "greenhouse", "lever", "personio"];
const LEGAL = /\b(?:gmbh|ag|se|inc|ltd|llc|bv|oy|ab|sas?|co|corp|group|holding)\b\.?/g;

/** Board slugs a company's name suggests: "think-cell" gives thinkcell and think-cell; "Peec AI" adds peec. */
export function slugCandidates(name: string): string[] {
  const words = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(LEGAL, " ").split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  return [...new Set([words.join(""), words.join("-"), words[0]!])].filter((s) => s.length >= 3);
}

/** A title without gender markers, punctuation or case: "Senior Engineer (m/f/d) - All Genders" is "senior engineer". */
export const titleKey = (t: string) =>
  t.toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b[mfwdx](?:\s*\/\s*[mfwdx]){1,3}\b|\ball (?:genders?|identities)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The board posting that is this job: the same title, or failing that the only posting whose title contains the
 * other's (at least three words, so "Software Engineer" alone never matches).
 */
export function sameJob(postings: Posting[], title: string): Posting | null {
  const key = titleKey(title);
  const exact = postings.find((p) => titleKey(p.title) === key);
  if (exact) return exact;
  const near = postings.filter((p) => {
    const other = titleKey(p.title);
    const [short, long] = other.length < key.length ? [other, key] : [key, other];
    return short.split(" ").length >= 3 && ` ${long} `.includes(` ${short} `);
  });
  return near.length === 1 ? near[0]! : null;
}

export interface FoundBoard {
  kind: AtsKind;
  slug: string;
  /** The job's own posting on the board. */
  posting: Posting;
  /** Everything on the board, so other jobs of the company can be matched without fetching it again. */
  postings: Posting[];
}

/** The company's board and its posting of this job, or null when no board under a likely slug lists it. */
export async function findBoard(company: string, title: string): Promise<FoundBoard | null> {
  for (const slug of slugCandidates(company)) {
    for (const kind of ORDER) {
      const postings = await ATS[kind](slug).catch(() => [] as Posting[]);
      const posting = sameJob(postings, title);
      if (posting) return { kind, slug, posting, postings };
    }
  }
  return null;
}
