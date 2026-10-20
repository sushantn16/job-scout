// The candidate as the vetter sees it: CV facts with stable bullet IDs, plus stated preferences.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { Cv } from "../cv/schema.ts";

export const Preferences = z.object({
  targetRoles: z.array(z.string()),
  languages: z.string(),
  location: z.string(),
  compensation: z.string(),
  culture: z.array(z.string()),
  experience: z.string(),
  knownGaps: z.array(z.string()),
  aiFocus: z.string(),
});
export type Preferences = z.infer<typeof Preferences>;

export interface Candidate {
  cv: Cv;
  prefs: Preferences;
  bulletIds: Set<string>;
  text: string;
}

export const PREFS_PATH = "data/private/preferences.json";

export const loadPreferences = (path = PREFS_PATH): Preferences | null => (existsSync(path) ? Preferences.parse(JSON.parse(readFileSync(path, "utf8"))) : null);

export function loadCandidate(cvPath = "data/private/cv-master.json", prefsPath = PREFS_PATH): Candidate {
  const cv = Cv.parse(JSON.parse(readFileSync(cvPath, "utf8")));
  const prefs = Preferences.parse(JSON.parse(readFileSync(prefsPath, "utf8")));
  const plain = (s: string) => s.replace(/\*\*/g, "");
  const text = [
    `Current title: ${cv.basics.title}`,
    `Profile: ${plain(cv.profile)}`,
    `Skills: ${cv.skills.map((s) => `${s.label}: ${s.items.join(", ")}`).join("; ")}`,
    "Experience (bullet IDs in brackets):",
    ...cv.experience.flatMap((r) => [`- ${r.title}, ${r.company} (${r.start} – ${r.end})`, ...r.bullets.map((b) => `  [${b.id}] ${plain(b.text)}`)]),
    `Education: ${cv.education.map((e) => `${e.degree}, ${e.school} (${e.year})`).join("; ")}`,
    `Experience summary: ${prefs.experience}`,
    `Target roles: ${prefs.targetRoles.join(" | ")}`,
    `Languages: ${prefs.languages}`,
    `Location: ${prefs.location}`,
    `AI focus: ${prefs.aiFocus}`,
    `Compensation: ${prefs.compensation}`,
    `Culture preferences: ${prefs.culture.join(" | ")}`,
    `Known gaps: ${prefs.knownGaps.join(" | ")}`,
  ].join("\n");
  return { cv, prefs, bulletIds: new Set(cv.experience.flatMap((r) => r.bullets.map((b) => b.id))), text };
}
