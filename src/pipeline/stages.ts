// The pipeline's stages, in order: the one definition behind the run summary (src/server/pipeline.ts), the API and
// the dashboard's diagram and stage cards. A stage's `key` is also the `stage` of the events it logs, which is how the
// run summary tells how far a run got. Keep descriptions to two lines of a diagram block: check the Pipeline page.

export interface StageDef {
  key: string;
  name: string;
  /** "code" stages are deterministic; "LLM" stages call Claude and are skipped when no model is configured. */
  kind: "code" | "LLM";
  does: string;
  /** Only full scans fetch and filter; `pnpm vet` and the dashboard's single-stage runs start at the screen. */
  scanOnly?: boolean;
}

const DEFS = [
  { key: "fetch", name: "Fetch", kind: "code", does: "Company job boards, HN and LinkedIn", scanOnly: true },
  { key: "filter", name: "Filter", kind: "code", does: "Title, location, German, years, pay band, freshness", scanOnly: true },
  { key: "screen", name: "Injection screen", kind: "LLM", does: "Text aimed at AI: patterns, then an LLM check" },
  { key: "research", name: "Research", kind: "LLM", does: "Website, news and HN; every claim cited" },
  { key: "vet", name: "Score", kind: "LLM", does: "The LLM rates the rubric; the formula decides" },
  { key: "tailor", name: "Tailor", kind: "LLM", does: "CV, why-us, note and form answers, fact-checked" },
  { key: "ready", name: "Ready", kind: "code", does: "Application folder written, waiting for you" },
  { key: "inbox", name: "Inbox", kind: "code", does: "Replies matched to jobs; rules only, read-only" },
  { key: "outcomes", name: "Outcomes", kind: "code", does: "Applied, interview, rejected: the funnel" },
] as const satisfies readonly StageDef[];

export type StageKey = (typeof DEFS)[number]["key"];
export const STAGES: readonly (StageDef & { key: StageKey })[] = DEFS;

/** What an event can be logged under: a stage, or one of the steps around them. */
export type EventStage = StageKey | "run" | "aws" | "form" | "dashboard";
