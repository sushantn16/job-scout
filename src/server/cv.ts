// The master CV, edited from the dashboard's CV page. Saving validates it against the schema and keeps the version it
// replaces as cv-master.prev.json; the preview renders a draft with the same HTML the PDFs are printed from.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderCvHtml } from "../cv/render-html.ts";
import { Cv } from "../cv/schema.ts";
import { writeJson } from "../files.ts";
import { CV_PATH } from "../vet/candidate.ts";
import { json, readBody, type Route } from "./http.ts";

const MAX_BODY = 200_000;

/** Problems the schema can't see: tailoring and the fact check refer to items by ID, so IDs must be unique. */
export function cvProblems(cv: Cv): string[] {
  const ids = [
    ...cv.skills.map((s) => s.id),
    ...cv.experience.flatMap((r) => [r.id, ...r.bullets.map((b) => b.id)]),
    ...(cv.projects ?? []).map((p) => p.id),
    ...cv.education.map((e) => e.id),
  ];
  const dupes = [...new Set(ids.filter((id, i) => !id.trim() || ids.indexOf(id) !== i))];
  return dupes.map((id) => (id.trim() ? `the ID "${id}" is used more than once` : "an item has no ID"));
}

/** The photo, only if it's inside the private folder: the path comes from the CV, which the page edits. */
function photoPath(cv: Cv, cvPath: string): string | undefined {
  if (!cv.basics.photo) return undefined;
  const root = resolve(dirname(cvPath));
  const file = resolve(root, cv.basics.photo);
  return file.startsWith(`${root}/`) && existsSync(file) ? file : undefined;
}

const parse = (body: unknown): { cv: Cv } | { error: string } => {
  const r = Cv.safeParse((body as { cv?: unknown }).cv);
  if (!r.success) return { error: r.error.issues.map((i) => `${i.path.join(".") || "cv"}: ${i.message}`).join("; ") };
  const problems = cvProblems(r.data);
  return problems.length ? { error: problems.join("; ") } : { cv: r.data };
};

export function cvRoutes(cvPath = CV_PATH): Route[] {
  return [
    ["GET", /^\/api\/cv$/, (_req, res) => {
      if (!existsSync(cvPath)) return json(res, 404, { error: "no master CV yet (see Setup in the README)" });
      json(res, 200, { cv: JSON.parse(readFileSync(cvPath, "utf8")) });
    }],

    ["POST", /^\/api\/cv$/, async (req, res) => {
      const r = parse(await readBody(req, MAX_BODY));
      if ("error" in r) return json(res, 400, { error: r.error });
      writeJson(cvPath, r.cv);
      json(res, 200, { ok: true });
    }],

    // Renders the draft without saving it.
    ["POST", /^\/api\/cv\/preview$/, async (req, res) => {
      const r = parse(await readBody(req, MAX_BODY));
      if ("error" in r) return json(res, 400, { error: r.error });
      json(res, 200, { html: renderCvHtml(r.cv, photoPath(r.cv, cvPath)) });
    }],
  ];
}
