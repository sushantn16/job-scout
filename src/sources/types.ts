/** `manual` is a job you added from the dashboard with details you pasted (see src/sources/manual.ts). */
export type SourceKind = "ashby" | "greenhouse" | "lever" | "personio" | "hn" | "linkedin" | "manual";

/** A job posting normalized across sources. `description` is untrusted text from the posting. */
export interface Posting {
  source: SourceKind;
  /** Board slug for ATS sources, company name as shown for others. */
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  /** Pay band as published, e.g. "€90K – €140K • Offers Equity". Empty when not posted. */
  comp: string;
  workplace: string;
  /** LinkedIn's applicant caption, e.g. "Over 200 applicants". */
  applicants: string;
  /** Text hidden from human readers of the posting page (HTML comments, invisible elements), found at fetch time. */
  hiddenText: string[];
  /** When the job was first published: an ISO timestamp, or a bare YYYY-MM-DD where the source only gives a date (LinkedIn). */
  posted: string;
}

export const posting = (p: Partial<Posting> & Pick<Posting, "source" | "company" | "title" | "url">): Posting => ({
  location: "",
  description: "",
  comp: "",
  workplace: "",
  applicants: "",
  posted: "",
  hiddenText: [],
  ...p,
  title: p.title.trim(),
});

export interface SourceResult {
  postings: Posting[];
  errors: string[];
}
