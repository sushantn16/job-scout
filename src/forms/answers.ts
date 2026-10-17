// Your saved answers to questions many forms ask (visa, salary, notice period, ...), in data/private/answers.json.
// Written once from the dashboard and reused for every form. The LLM may use them but never invents one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Keys the LLM may tag a question with, and what each one holds. */
export const STANDARD = {
  workAuthorization: "Where you may work without sponsorship (e.g. EU citizen, German work permit)",
  visaSponsorship: "Whether you need visa sponsorship, now or in the future",
  salaryExpectation: "Salary expectation as you'd state it in a form, e.g. a range",
  noticePeriod: "Notice period or earliest start date",
  workArrangement: "On-site, hybrid or remote: what you accept, e.g. office days per week",
  relocation: "Whether you'd relocate, and where to",
  basedIn: "Where you live: country, city, time zone",
  languages: "Languages and levels",
  yearsExperience: "Years of professional experience: total and per main technology",
  aiTools: "Which AI tools you use day to day, and how",
  howHeard: "How you heard about the role, when a form asks",
  github: "GitHub profile URL",
  website: "Personal website or portfolio URL",
  address: "Postal address, for forms that require one",
} as const;
export type StandardKey = keyof typeof STANDARD;
export const STANDARD_KEYS = Object.keys(STANDARD) as StandardKey[];
/** Topics the CV can also answer: without a saved answer, the answer is drafted from the CV's facts. */
export const CV_MAY_ANSWER = new Set<StandardKey>(["aiTools"]);

export const ANSWERS_PATH = "data/private/answers.json";

export function loadAnswers(path = ANSWERS_PATH): Record<string, string> {
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "" && !e[0].startsWith("$")));
}

export function saveAnswer(key: StandardKey, value: string, path = ANSWERS_PATH): Record<string, string> {
  const answers = { ...loadAnswers(path), [key]: value.trim() };
  if (!value.trim()) delete answers[key];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(answers, null, 2)}\n`);
  return answers;
}
