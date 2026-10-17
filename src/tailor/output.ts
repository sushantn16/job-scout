// Write one application folder: the tailored CV (PDF + JSON) and application.md with everything needed to apply.
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { Cv } from "../cv/schema.ts";
import type { ScreenResult } from "../injection/screen.ts";
import type { CompanyProfile } from "../research/profile.ts";
import type { Posting } from "../sources/types.ts";
import type { VetResult } from "../vet/vet.ts";
import type { Tailored } from "./tailor.ts";

const safe = (s: string) => s.replace(/[/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
const plain = (s: string) => s.replace(/\*\*/g, "");

export const outputRoot = () => process.env.JOB_SCOUT_OUTPUT_DIR || "data/private/applications";

/** Paths are stored relative to the output root, so the folder can move (e.g. into a Docker volume). */
export const toStored = (path: string) => relative(outputRoot(), path);
/** A stored path as a real one; absolute paths from before relative storage still resolve as they are. */
export const resolveOutput = (stored: string) => (isAbsolute(stored) ? stored : join(outputRoot(), stored));

export function applicationDir(companyName: string, title: string, date = new Date()): string {
  return join(outputRoot(), date.toISOString().slice(0, 10), safe(`${companyName} - ${title}`));
}

function cvChanges(master: Cv, cv: Cv): string[] {
  const lines: string[] = [];
  if (cv.basics.title !== master.basics.title) lines.push(`- Headline: "${master.basics.title}" → "${cv.basics.title}"`);
  if (cv.profile !== master.profile) lines.push(`- Profile rewritten:\n  > ${plain(cv.profile)}`);
  const order = cv.skills.map((s) => s.label).join(", ");
  if (order !== master.skills.map((s) => s.label).join(", ")) lines.push(`- Skill groups reordered: ${order}`);
  for (const role of cv.experience) {
    const m = master.experience.find((r) => r.id === role.id)!;
    const shown = role.bullets.map((b) => b.id);
    const hidden = m.bullets.filter((b) => !shown.includes(b.id)).map((b) => b.id);
    if (shown.join() !== m.bullets.map((b) => b.id).join()) lines.push(`- ${m.company}: bullets ${shown.join(", ")}${hidden.length ? ` (left out: ${hidden.join(", ")})` : ""}`);
    for (const b of role.bullets) {
      const mb = m.bullets.find((x) => x.id === b.id)!;
      if (b.text !== mb.text) lines.push(`- Reworded ${b.id}:\n  - before: ${plain(mb.text)}\n  - after: ${plain(b.text)}`);
    }
  }
  return lines.length ? lines : ["- No changes: the master CV is used as is."];
}

export function writeApplication(args: {
  dir: string;
  cvFile: string;
  posting: Posting;
  companyName: string;
  master: Cv;
  tailored: Tailored;
  finalCv: Cv;
  dropped: string[];
  added: string[];
  vet: VetResult;
  screen: ScreenResult | null;
  company: CompanyProfile | null;
}): string {
  const { dir, posting: p, tailored: t, vet: v } = args;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cv.json"), JSON.stringify(args.finalCv, null, 2));
  const traps = (args.screen?.findings ?? []).filter((f) => f.kind !== "invisible-unicode");
  const md = [
    `# ${args.companyName}: ${p.title}`,
    "",
    `- Posting: ${p.url}`,
    `- Fit score **${v.fitScore}** (${v.decision}): ${v.factors.map((f) => `${f.factor} ${f.points}/${f.weight}`).join(" · ")}`,
    `- ${v.summary}`,
    args.company ? `- Company: ${args.company.oneLiner} Reviews: [Glassdoor](${args.company.reviewLinks.glassdoor}) · [kununu](${args.company.reviewLinks.kununu})` : "- Company research: not available",
    `- CV: \`${args.cvFile}\``,
    "",
    ...(traps.length
      ? ["## ⚠ Text aimed at AI in this posting", "", "Write the application form yourself. The posting contains:", "", ...traps.map((f) => `- (${f.kind}) ${f.quote}`), ""]
      : []),
    ...(t.needsEdit.length
      ? ["## ⚠ Needs an edit before use", "", "These claims in the text below aren't backed by your CV or the company research:", "", ...t.needsEdit.map((x) => `- ${x.where}: ${x.problem}`), ""]
      : []),
    "## Why us",
    "",
    t.whyUs,
    "",
    "## Note to the hiring manager",
    "",
    t.note,
    "",
    "## What the CV emphasises",
    "",
    t.emphasis,
    "",
    "## Changes from your master CV",
    "",
    ...cvChanges(args.master, args.finalCv),
    ...(args.dropped.length ? [`- Trimmed to fit one page: ${args.dropped.join(", ")}`] : []),
    ...(args.added.length ? [`- Added back to fill the page: ${args.added.join(", ")}`] : []),
    ...(t.reverted.length ? ["", "Reverted to the original wording because they failed validation:", ...t.reverted.map((x) => `- ${x.where}: ${x.problem}`)] : []),
    "",
    "## Gaps to prepare for",
    "",
    ...(v.gaps.length ? v.gaps.map((g) => `- (${g.severity}) ${g.point}`) : ["- None identified."]),
    "",
  ].join("\n");
  writeFileSync(join(dir, "application.md"), md);
  return md;
}
