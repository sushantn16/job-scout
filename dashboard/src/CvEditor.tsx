// The master CV, section by section, with a preview printed from the same HTML as the PDFs. Every tailored CV is cut
// from it and the fact check accepts nothing that isn't in it, so this is where a new skill or achievement goes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Cv } from "../../src/cv/schema";
import { getJson, post } from "./api";
import { Banner, Button, Card, cx, Field, H3, input, LinesField } from "./ui";

type Role = Cv["experience"][number];
type Project = NonNullable<Cv["projects"]>[number];

/** A4 at 96 dpi: the preview is drawn at print size and scaled down to fit. */
const PAGE_W = 794;
const PAGE_H = 1123;

/** A short ID like "ka-3" that nothing else uses. Tailoring and the fact check refer to items by these. */
function newId(cv: Cv, prefix: string): string {
  const taken = new Set([
    ...cv.skills.map((s) => s.id),
    ...cv.experience.flatMap((r) => [r.id, ...r.bullets.map((b) => b.id)]),
    ...(cv.projects ?? []).map((p) => p.id),
    ...cv.education.map((e) => e.id),
  ]);
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/** What the API gets: blank list lines dropped, empty optional fields left out. */
function clean(cv: Cv): Cv {
  const opt = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);
  const headlines = (cv.basics.headlines ?? []).map((h) => h.trim()).filter(Boolean);
  return {
    ...cv,
    basics: { ...cv.basics, website: opt(cv.basics.website), github: opt(cv.basics.github), headlines: headlines.length ? headlines : undefined },
    skills: cv.skills.map((s) => ({ ...s, items: s.items.map((i) => i.trim()).filter(Boolean) })),
    projects: cv.projects?.length ? cv.projects.map((p) => ({ ...p, stack: opt(p.stack), url: opt(p.url) })) : undefined,
  };
}

const move = <T,>(list: T[], i: number, by: number): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

/** Up, down and remove for one item of a list. */
function ItemTools({ i, n, onMove, onRemove, what }: { i: number; n: number; onMove: (by: number) => void; onRemove: () => void; what: string }) {
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => onMove(-1)} aria-label={`Move ${what} up`}>↑</Button>
      <Button size="sm" variant="ghost" disabled={i === n - 1} onClick={() => onMove(1)} aria-label={`Move ${what} down`}>↓</Button>
      <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>
    </span>
  );
}

function Item({ title, tools, children }: { title: ReactNode; tools: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <H3 className="m-0">{title}</H3>
        {tools}
      </div>
      {children}
    </div>
  );
}

function Preview({ html, error }: { html: string; error: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(PAGE_W);
  const [height, setHeight] = useState(PAGE_H);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, width / PAGE_W);
  const pages = Math.max(1, Math.ceil((height - 2) / PAGE_H));
  return (
    <Card title="Preview" aside={<span className={cx("text-xs font-normal", pages > 1 ? "text-critical" : "text-muted")}>{pages === 1 ? "1 page" : `${pages} pages: tailored CVs are cut to one`}</span>}>
      {error ? <Banner tone="warning" title="Can't preview this yet">{error}</Banner> : null}
      <div ref={box} style={{ height: height * scale }} className="overflow-hidden rounded border border-line bg-white">
        {/* Same origin and no scripts, so the page height can be read to count pages. */}
        <iframe
          title="CV preview"
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={(e) => setHeight(e.currentTarget.contentDocument?.documentElement.scrollHeight ?? PAGE_H)}
          style={{ width: PAGE_W, height, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }}
        />
      </div>
    </Card>
  );
}

export function CvEditor({ notify }: { notify: (m: string) => void }) {
  const [saved, setSaved] = useState<Cv | null>(null);
  const [draft, setDraft] = useState<Cv | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getJson<{ cv: Cv }>("/api/cv").then(({ cv }) => (setSaved(cv), setDraft(cv)), (e: Error) => setLoadError(e.message));
  }, []);
  // Re-render the preview a moment after typing stops.
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      post<{ html: string }>("/api/cv/preview", { cv: clean(draft) }).then(
        (r) => (setHtml(r.html), setPreviewError(null)),
        (e: Error) => setPreviewError(e.message),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [draft]);

  if (loadError) return <Banner tone="critical" title="Could not load the CV">{loadError}</Banner>;
  if (!draft || !saved) return <div className="text-muted">Loading…</div>;

  const dirty = JSON.stringify(clean(draft)) !== JSON.stringify(clean(saved));
  const set = (p: Partial<Cv>) => setDraft({ ...draft, ...p });
  const setBasics = (p: Partial<Cv["basics"]>) => set({ basics: { ...draft.basics, ...p } });
  const setRole = (i: number, p: Partial<Role>) => set({ experience: draft.experience.map((r, k) => (k === i ? { ...r, ...p } : r)) });
  const setProject = (i: number, p: Partial<Project>) => set({ projects: (draft.projects ?? []).map((r, k) => (k === i ? { ...r, ...p } : r)) });
  const projects = draft.projects ?? [];

  const save = async () => {
    setBusy(true);
    try {
      const cv = clean(draft);
      await post("/api/cv", { cv });
      setSaved(cv);
      setDraft(cv);
      notify("CV saved. The previous version is kept as cv-master.prev.json; CVs tailored from now on use this one.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const basic = (key: keyof Cv["basics"], label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className={input} value={(draft.basics[key] as string | undefined) ?? ""} onChange={(e) => setBasics({ [key]: e.target.value })} />
    </Field>
  );

  return (
    <div className="grid gap-5 pb-16">
      <div>
        <h1 className="text-xl">CV</h1>
        <p className="m-0 mt-1 text-muted">
          Your master CV. Every tailored CV is cut from it, and application text may only state facts it contains. Mark emphasis with **double asterisks**.
        </p>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        <div className="grid gap-5">
          <Card title="Basics">
            <div className="grid gap-4 md:grid-cols-2">
              {basic("name", "Name")}
              {basic("title", "Title")}
              {basic("email", "Email")}
              {basic("phone", "Phone")}
              {basic("location", "Location")}
              {basic("linkedin", "LinkedIn")}
              {basic("website", "Website", "Optional")}
              {basic("github", "GitHub", "Optional")}
              <LinesField
                label="Headlines"
                hint="One per line. Tailoring may pick one for a job; the first is the default"
                value={(draft.basics.headlines ?? []).join("\n")}
                onChange={(v) => setBasics({ headlines: v.split("\n") })}
                rows={3}
              />
            </div>
          </Card>

          <Card title="Profile">
            <textarea className={input} rows={5} value={draft.profile} onChange={(e) => set({ profile: e.target.value })} aria-label="Profile" />
          </Card>

          <Card title="Skills">
            <div className="grid gap-3">
              {draft.skills.map((s, i) => (
                <Item
                  key={s.id}
                  title={s.label || "New group"}
                  tools={<ItemTools i={i} n={draft.skills.length} what="group" onMove={(by) => set({ skills: move(draft.skills, i, by) })} onRemove={() => set({ skills: draft.skills.filter((_, k) => k !== i) })} />}
                >
                  <div className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
                    <Field label="Group">
                      <input className={input} value={s.label} onChange={(e) => set({ skills: draft.skills.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                    </Field>
                    <LinesField label="Skills" hint="One per line" rows={3} value={s.items.join("\n")} onChange={(v) => set({ skills: draft.skills.map((x, k) => (k === i ? { ...x, items: v.split("\n") } : x)) })} />
                  </div>
                </Item>
              ))}
              <Button className="justify-self-start" onClick={() => set({ skills: [...draft.skills, { id: newId(draft, "skills"), label: "", items: [] }] })}>Add a skill group</Button>
            </div>
          </Card>

          <Card title="Experience">
            <div className="grid gap-3">
              {draft.experience.map((r, i) => (
                <Item
                  key={r.id}
                  title={[r.title, r.company].filter(Boolean).join(", ") || "New role"}
                  tools={<ItemTools i={i} n={draft.experience.length} what="role" onMove={(by) => set({ experience: move(draft.experience, i, by) })} onRemove={() => set({ experience: draft.experience.filter((_, k) => k !== i) })} />}
                >
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Title"><input className={input} value={r.title} onChange={(e) => setRole(i, { title: e.target.value })} /></Field>
                    <Field label="Company"><input className={input} value={r.company} onChange={(e) => setRole(i, { company: e.target.value })} /></Field>
                    <Field label="Location"><input className={input} value={r.location} onChange={(e) => setRole(i, { location: e.target.value })} /></Field>
                    <Field label="From"><input className={input} value={r.start} onChange={(e) => setRole(i, { start: e.target.value })} /></Field>
                    <Field label="To"><input className={input} value={r.end} onChange={(e) => setRole(i, { end: e.target.value })} /></Field>
                  </div>
                  <div className="grid gap-2">
                    {r.bullets.map((b, j) => (
                      <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <label className="grid gap-0.5">
                          <span className="font-mono text-[11px] text-muted" title="Tailoring and the fact check refer to this bullet by its ID">{b.id}</span>
                          <textarea className={input} rows={2} value={b.text} onChange={(e) => setRole(i, { bullets: r.bullets.map((x, k) => (k === j ? { ...x, text: e.target.value } : x)) })} />
                        </label>
                        <div className="pt-4">
                          <ItemTools i={j} n={r.bullets.length} what="bullet" onMove={(by) => setRole(i, { bullets: move(r.bullets, j, by) })} onRemove={() => setRole(i, { bullets: r.bullets.filter((_, k) => k !== j) })} />
                        </div>
                      </div>
                    ))}
                    <Button size="sm" className="justify-self-start" onClick={() => setRole(i, { bullets: [...r.bullets, { id: newId(draft, r.id), text: "" }] })}>Add a bullet</Button>
                  </div>
                </Item>
              ))}
              <Button
                className="justify-self-start"
                onClick={() => {
                  const id = newId(draft, "role");
                  set({ experience: [{ id, title: "", company: "", start: "", end: "", location: "", bullets: [{ id: `${id}-b1`, text: "" }] }, ...draft.experience] });
                }}
              >
                Add a role at the top
              </Button>
            </div>
          </Card>

          <Card title="Projects" aside={<span className="text-xs font-normal text-muted">Optional; shown between experience and education</span>}>
            <div className="grid gap-3">
              {projects.map((p, i) => (
                <Item
                  key={p.id}
                  title={p.name || "New project"}
                  tools={<ItemTools i={i} n={projects.length} what="project" onMove={(by) => set({ projects: move(projects, i, by) })} onRemove={() => set({ projects: projects.filter((_, k) => k !== i) })} />}
                >
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Name"><input className={input} value={p.name} onChange={(e) => setProject(i, { name: e.target.value })} /></Field>
                    <Field label="Stack" hint="Optional"><input className={input} value={p.stack ?? ""} onChange={(e) => setProject(i, { stack: e.target.value })} /></Field>
                    <Field label="Link" hint="Optional"><input className={input} value={p.url ?? ""} onChange={(e) => setProject(i, { url: e.target.value })} /></Field>
                  </div>
                  <Field label="What it is"><textarea className={input} rows={2} value={p.text} onChange={(e) => setProject(i, { text: e.target.value })} /></Field>
                </Item>
              ))}
              <Button className="justify-self-start" onClick={() => set({ projects: [...projects, { id: newId(draft, "project"), name: "", text: "" }] })}>Add a project</Button>
            </div>
          </Card>

          <Card title="Education">
            <div className="grid gap-3">
              {draft.education.map((e, i) => (
                <Item
                  key={e.id}
                  title={e.degree || "New entry"}
                  tools={<ItemTools i={i} n={draft.education.length} what="entry" onMove={(by) => set({ education: move(draft.education, i, by) })} onRemove={() => set({ education: draft.education.filter((_, k) => k !== i) })} />}
                >
                  <div className="grid gap-3 md:grid-cols-4">
                    {(["degree", "school", "year", "location"] as const).map((k) => (
                      <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)}>
                        <input className={input} value={e[k]} onChange={(ev) => set({ education: draft.education.map((x, n) => (n === i ? { ...x, [k]: ev.target.value } : x)) })} />
                      </Field>
                    ))}
                  </div>
                </Item>
              ))}
              <Button className="justify-self-start" onClick={() => set({ education: [...draft.education, { id: newId(draft, "edu"), degree: "", school: "", year: "", location: "" }] })}>Add education</Button>
            </div>
          </Card>
        </div>

        <div className="xl:sticky xl:top-4">
          <Preview html={html} error={previewError} />
        </div>
      </div>

      <div className={cx("fixed inset-x-0 bottom-0 z-10 border-t border-line bg-raised/95 backdrop-blur", !dirty && "hidden")}>
        <div className="mx-auto flex max-w-[1200px] items-center justify-end gap-3 px-6 py-2.5">
          <H3 className="mr-auto">Unsaved changes{previewError ? `: ${previewError}` : ""}</H3>
          <Button variant="ghost" disabled={busy} onClick={() => setDraft(saved)}>Discard</Button>
          <Button variant="primary" disabled={busy || Boolean(previewError)} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
