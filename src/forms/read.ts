// Read a job's application form: the questions it asks. Nothing is ever filled in or submitted.
// Greenhouse and Ashby publish their forms as JSON. Other forms are read from the page itself, loaded with JavaScript
// off and nothing but the page fetched: in Docker the browser runs without Chromium's sandbox, so a page must not be
// able to run code in it.
import { chromium } from "playwright-core";
import { browserChannel } from "../cv/render-pdf.ts";
import { getJson } from "../http.ts";
import type { Posting } from "../sources/types.ts";
import { htmlToText } from "../text.ts";

export type FieldType = "text" | "textarea" | "choice" | "multi" | "boolean" | "file" | "email" | "tel" | "number" | "date" | "url";

export interface FormField {
  /** Stable within one reading of the form: "q1", "q2", ... */
  id: string;
  question: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  maxLength?: number;
  /** Help text under the question, if the form has any. */
  description?: string;
}

export interface FormRead {
  url: string;
  via: "greenhouse" | "ashby" | "page";
  fields: FormField[];
}

type Target = { via: "greenhouse"; board: string; jobId: string; url: string } | { via: "ashby"; org: string; jobId: string; url: string } | { via: "page"; url: string };

/** Where a job's form is. `override` is a URL pasted by you; otherwise only ATS sources know their form. */
export function formTarget(p: Pick<Posting, "source" | "company" | "url">, override?: string): Target | null {
  const url = override?.trim() || (["ashby", "greenhouse", "lever", "personio"].includes(p.source) ? p.url : "");
  if (!url) return null;
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, "");
  if (/(^|\.)greenhouse\.io$/.test(u.host)) {
    const m = path.match(/^\/(?:embed\/job_app)?\/?([^/]+)\/jobs\/(\d+)/);
    const jobId = m?.[2] ?? u.searchParams.get("token") ?? "";
    const board = m?.[1] ?? u.searchParams.get("for") ?? "";
    if (board && jobId) return { via: "greenhouse", board, jobId, url: `https://job-boards.greenhouse.io/${board}/jobs/${jobId}` };
  }
  // Greenhouse jobs on a company's own careers page carry the job ID as gh_jid.
  if (p.source === "greenhouse" && !override) {
    const jobId = u.searchParams.get("gh_jid") ?? path.match(/\/(\d{6,})$/)?.[1];
    if (jobId) return { via: "greenhouse", board: p.company, jobId, url };
  }
  if (u.host === "jobs.ashbyhq.com") {
    const m = path.match(/^\/([^/]+)\/([0-9a-f-]{36})/);
    if (m) return { via: "ashby", org: decodeURIComponent(m[1]!), jobId: m[2]!, url: `https://jobs.ashbyhq.com/${m[1]}/${m[2]}/application` };
  }
  if (u.host === "jobs.lever.co" && !path.endsWith("/apply")) return { via: "page", url: `${u.origin}${path}/apply` };
  // Teamtailor career sites (often on the company's own domain): /jobs/<id>-<slug>, form at /applications/new.
  if (/\/jobs\/\d+-[\w-]+$/.test(path)) return { via: "page", url: `${u.origin}${path}/applications/new` };
  return { via: "page", url: u.toString() };
}

// --- Greenhouse: the public job board API includes the form with ?questions=true.

interface GhField { name: string; type: string; values?: { label: string }[] }
interface GhQuestion { label: string; required: boolean; description?: string | null; fields: GhField[] }
interface GhJob {
  questions?: GhQuestion[];
  location_questions?: GhQuestion[];
  compliance?: { questions?: GhQuestion[] }[] | null;
  demographic_questions?: { questions?: { label: string; required: boolean; type: string; answer_options?: { label: string }[] }[] } | null;
}

const GH_TYPE: Record<string, FieldType> = {
  input_text: "text", textarea: "textarea", input_file: "file", multi_value_single_select: "choice", multi_value_multi_select: "multi",
};

export function greenhouseFields(job: GhJob): Omit<FormField, "id">[] {
  const out: Omit<FormField, "id">[] = [];
  const add = (q: GhQuestion) => {
    const f = q.fields.find((x) => x.type !== "input_hidden");
    if (!f) return;
    const options = f.values?.map((v) => v.label).filter(Boolean);
    out.push({
      question: q.label.trim(), type: GH_TYPE[f.type] ?? "text", required: q.required,
      ...(options?.length ? { options } : {}),
      ...(q.description ? { description: htmlToText(q.description).slice(0, 500) } : {}),
    });
  };
  for (const q of [...(job.questions ?? []), ...(job.location_questions ?? []), ...(job.compliance ?? []).flatMap((c) => c.questions ?? [])]) add(q);
  for (const q of job.demographic_questions?.questions ?? [])
    out.push({ question: q.label.trim(), type: q.type === "multi_value_multi_select" ? "multi" : "choice", required: q.required, options: q.answer_options?.map((o) => o.label) ?? [] });
  return out;
}

// --- Ashby: the hosted job page loads its form from this GraphQL endpoint.

interface AshbyField { title: string; type: string; selectableValues?: { label: string }[] | null }
interface AshbyForm { sections: { fieldEntries: { field?: AshbyField; isRequired?: boolean; descriptionHtml?: string | null }[] }[] }

const ASHBY_TYPE: Record<string, FieldType> = {
  String: "text", Email: "email", Phone: "tel", File: "file", LongText: "textarea", Boolean: "boolean", ValueSelect: "choice",
  MultiValueSelect: "multi", Number: "number", Date: "date", SocialLink: "url", Location: "text",
};

export function ashbyFields(form: AshbyForm): Omit<FormField, "id">[] {
  return form.sections.flatMap((s) =>
    s.fieldEntries.flatMap((e) => {
      if (!e.field?.title) return [];
      const options = e.field.selectableValues?.map((v) => v.label).filter(Boolean);
      return [{
        question: e.field.title.replace(/\s+/g, " ").trim(), type: ASHBY_TYPE[e.field.type] ?? "text", required: !!e.isRequired,
        ...(options?.length ? { options } : {}),
        ...(e.descriptionHtml ? { description: htmlToText(e.descriptionHtml).slice(0, 500) } : {}),
      }];
    }),
  );
}

const ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { field isRequired descriptionHtml } } } }
  }
}`;

async function ashbyForm(org: string, jobId: string): Promise<AshbyForm> {
  const res = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "job-scout (+https://github.com/sushantn16/job-scout)" },
    body: JSON.stringify({ operationName: "ApiJobPosting", variables: { organizationHostedJobsPageName: org, jobPostingId: jobId }, query: ASHBY_QUERY }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Ashby form: HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { jobPosting?: { applicationForm?: AshbyForm } | null }; errors?: { message: string }[] };
  const form = data.data?.jobPosting?.applicationForm;
  if (!form) throw new Error(`Ashby form: ${data.errors?.[0]?.message ?? "no form for this posting"}`);
  return form;
}

// --- Any other form page.

interface PageField { question: string; type: string; required: boolean; options?: string[]; maxLength?: number }

/**
 * Runs in the page (as a serialized function, so it may only use what it defines). Groups radios and checkboxes by
 * name, finds each field's question from its label, aria attributes or surrounding fieldset, and skips cookie banners
 * and hidden technical inputs.
 */
function extractFields(): PageField[] {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const text = (el: Element | null) => clean((el as HTMLElement | null)?.innerText ?? el?.textContent);
  const byIds = (ids: string) => clean(ids.split(/\s+/).map((id) => text(document.getElementById(id))).join(" "));
  const inBanner = (el: Element) => !!el.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent-banner" i],[id*="onetrust" i]');
  const shown = (el: HTMLElement) => {
    const type = (el as HTMLInputElement).type;
    if (type === "file") return true; // upload inputs usually hide behind a button
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && (el.offsetWidth > 0 || el.offsetHeight > 0 || type === "radio" || type === "checkbox");
  };
  const labelOf = (el: HTMLElement): string => {
    const by = el.getAttribute("aria-labelledby");
    if (by) return byIds(by);
    const labels = (el as HTMLInputElement).labels;
    if (labels?.length) return text(labels[0]!);
    return clean(el.getAttribute("aria-label") ?? el.getAttribute("placeholder"));
  };
  const groupQuestion = (el: HTMLElement): string => {
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend) return text(legend);
    const group = el.closest('[role="radiogroup"],[role="group"]');
    if (group?.getAttribute("aria-labelledby")) return byIds(group.getAttribute("aria-labelledby")!);
    if (group?.getAttribute("aria-label")) return clean(group.getAttribute("aria-label"));
    let node: Element | null = el.parentElement;
    for (let i = 0; node && i < 6; i++, node = node.parentElement) {
      const head = node.querySelector("legend,h3,h4,[class*='label' i],[class*='question' i]");
      if (head && !head.contains(el) && !head.querySelector("input") && text(head)) return text(head);
    }
    return "";
  };

  const out: PageField[] = [];
  const groups = new Map<string, PageField>();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("input,textarea,select"))) {
    const input = el as HTMLInputElement;
    const type = el.tagName === "INPUT" ? input.type : el.tagName.toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "search"].includes(type) || inBanner(el) || !shown(el)) continue;
    const required = input.required || el.getAttribute("aria-required") === "true";
    if (type === "radio" || type === "checkbox") {
      const key = `${type}:${input.name || groupQuestion(el)}`;
      const option = labelOf(el) || clean(input.value);
      const g = groups.get(key);
      if (g) {
        g.options!.push(option);
        g.required ||= required;
        continue;
      }
      const field: PageField = { question: groupQuestion(el) || option, type, required, options: [option] };
      groups.set(key, field);
      out.push(field);
      continue;
    }
    const field: PageField = { question: labelOf(el) || groupQuestion(el), type, required };
    if (el.tagName === "SELECT") field.options = Array.from((el as HTMLSelectElement).options).map((o) => clean(o.text)).filter((o) => o && !/^(select|please select|choose|--)/i.test(o));
    const max = input.maxLength;
    if (max > 0 && max < 100_000) field.maxLength = max;
    out.push(field);
  }
  return out;
}

const REQUIRED_MARK = /\s*(?:[*✱]\s*)?(?:\(?required\)?)?\s*[*✱]?\s*$/i;

/** A page field as a form field: required markers moved out of the question text, browser types mapped to ours. */
export function fromPage(f: PageField): Omit<FormField, "id"> | null {
  const marked = /[*✱]\s*$|[*✱]?\s*\(?required\)?\s*$|^\s*required\b/i.test(f.question);
  const question = f.question.replace(REQUIRED_MARK, "").replace(/^\s*required\.?\s*/i, "").replace(/\s+/g, " ").trim();
  if (!question || /autofill/i.test(question)) return null;
  const options = f.options?.map((o) => o.replace(REQUIRED_MARK, "").trim()).filter(Boolean);
  const type: FieldType =
    f.type === "radio" || f.type === "select" ? "choice"
    : f.type === "checkbox" ? (options && options.length > 1 ? "multi" : "boolean")
    : (["textarea", "file", "email", "tel", "number", "date", "url"] as const).find((t) => t === f.type) ?? "text";
  return {
    question, type, required: f.required || marked,
    ...(options?.length && type !== "boolean" ? { options } : {}),
    ...(f.maxLength ? { maxLength: f.maxLength } : {}),
  };
}

async function pageFields(url: string): Promise<{ url: string; fields: Omit<FormField, "id">[] }> {
  const browser = await chromium.launch({ channel: browserChannel() });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const read = async (target: string) => {
      const host = new URL(target).host;
      await context.unroute("**/*").catch(() => {});
      await context.route("**/*", (r) => (r.request().resourceType() === "document" && new URL(r.request().url()).host === host ? r.continue() : r.abort()));
      const page = await context.newPage();
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const fields = (await page.evaluate(extractFields)).map(fromPage).filter((f): f is Omit<FormField, "id"> => !!f);
        // A job page without the form itself: follow its "Apply" link once, on the same site.
        const apply = fields.length ? null : await page.evaluate(() => {
          const a = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).find((x) => /\b(apply|bewerben)\b/i.test(x.innerText) && x.host === location.host);
          return a?.href ?? null;
        });
        return { fields, apply };
      } finally {
        await page.close();
      }
    };
    const first = await read(url);
    if (first.fields.length || !first.apply || first.apply === url) return { url, fields: first.fields };
    return { url: first.apply, fields: (await read(first.apply)).fields };
  } finally {
    await browser.close();
  }
}

/** Consecutive repeats (a custom select often shows up as two inputs with one label) count once. */
const dedupe = (fields: Omit<FormField, "id">[]) =>
  fields.filter((f, i) => !(i > 0 && fields[i - 1]!.question === f.question && fields[i - 1]!.type === f.type));

export async function readForm(target: Target): Promise<FormRead> {
  let url = target.url;
  let fields: Omit<FormField, "id">[];
  if (target.via === "greenhouse") fields = greenhouseFields(await getJson<GhJob>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.board)}/jobs/${target.jobId}?questions=true`));
  else if (target.via === "ashby") fields = ashbyFields(await ashbyForm(target.org, target.jobId));
  else ({ url, fields } = await pageFields(target.url));
  return { url, via: target.via, fields: dedupe(fields).map((f, i) => ({ id: `q${i + 1}`, ...f })) };
}
