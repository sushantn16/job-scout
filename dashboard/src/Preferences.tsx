// What you're looking for, in one place: the search filters code applies before any LLM call, what the scorer reads
// about you, and the answers application forms get. One Save writes all three; the next run uses them.
import { useEffect, useState, type ReactNode } from "react";
import { getJson, post } from "./api";
import { joinTerms, lines, placePattern, terms, unlines } from "./patterns";
import { Banner, Button, Card, cx, H3 } from "./ui";

interface Prefs { targetRoles: string[]; languages: string; location: string; compensation: string; culture: string[]; experience: string; knownGaps: string[]; aiFocus: string }
interface SearchSettings {
  profile: { maxYearsRequired: number; minBandTopEur: number; germanBlocksAt: "required" | "plus" };
  locations: Record<string, string>;
  titleInclude: string;
  titleExclude: string;
  companyExclude: string;
  vet: { applyAt: number; maybeAt: number };
}
interface Draft { search: SearchSettings; prefs: Prefs; answers: Record<string, string> }
interface Loaded extends Omit<Draft, "prefs"> { prefs: Prefs | null; answerTopics: Record<string, string>; linkedinLocation: string }

const EMPTY_PREFS: Prefs = { targetRoles: [], languages: "", location: "", compensation: "", culture: [], experience: "", knownGaps: [], aiFocus: "" };

const input = "w-full rounded-md border border-line bg-raised px-2 py-1.5 text-ink";
const mono = `${input} font-mono text-[12.5px]`;

function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("grid content-start gap-1", className)}>
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

/** A textarea that edits a list as one item per line, keeping blank lines while you type. */
function LinesField({ label, hint, value, onChange, rows = 4, monospace }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; rows?: number; monospace?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <textarea className={monospace ? mono : input} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={!monospace} />
    </Field>
  );
}

export function Preferences({ notify, running }: { notify: (m: string) => void; running: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Lists are edited as text, one item per line; they become lists or patterns again on save.
  const [text, setText] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");
  const [city, setCity] = useState("");
  const [relocate, setRelocate] = useState(true);
  const [busy, setBusy] = useState(false);

  const reset = (d: Loaded) => {
    const prefs = d.prefs ?? EMPTY_PREFS;
    const t = {
      titleInclude: lines(terms(d.search.titleInclude)),
      titleExclude: lines(terms(d.search.titleExclude)),
      companyExclude: lines(terms(d.search.companyExclude)),
      targetRoles: lines(prefs.targetRoles),
      culture: lines(prefs.culture),
      knownGaps: lines(prefs.knownGaps),
    };
    setLoaded(d);
    setDraft({ search: d.search, prefs, answers: d.answers });
    setText(t);
    setSaved(JSON.stringify({ search: d.search, prefs, answers: d.answers, t }));
  };
  useEffect(() => {
    getJson<Loaded>("/api/preferences").then(reset, (e: Error) => setError(e.message));
  }, []);

  if (error) return <Banner tone="critical" title="Could not load your preferences">{error}</Banner>;
  if (!loaded || !draft) return <div className="text-muted">Loading…</div>;

  const { search, prefs, answers } = draft;
  const dirty = JSON.stringify({ search, prefs, answers, t: text }) !== saved;
  const setSearch = (s: Partial<SearchSettings>) => setDraft({ ...draft, search: { ...search, ...s } });
  const setProfile = (p: Partial<SearchSettings["profile"]>) => setSearch({ profile: { ...search.profile, ...p } });
  const setPrefs = (p: Partial<Prefs>) => setDraft({ ...draft, prefs: { ...prefs, ...p } });
  const setAnswer = (k: string, v: string) => setDraft({ ...draft, answers: { ...answers, [k]: v } });
  const setLines = (k: string) => (v: string) => setText({ ...text, [k]: v });

  const addCity = () => {
    const names = city.split(",").map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    const shown = names[0]!;
    let key = shown.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "place";
    while (search.locations[key]) key += "-2";
    const next: Draft = { ...draft, search: { ...search, locations: { ...search.locations, [key]: placePattern(names) } } };
    // Say it where the scorer and the forms read it too, so a job there isn't marked down for its location.
    if (relocate && !prefs.location.toLowerCase().includes(shown.toLowerCase())) next.prefs = { ...prefs, location: `${prefs.location.trim()} Open to relocating to ${shown}.`.trim() };
    const answer = answers.relocation ?? "";
    if (relocate && !answer.toLowerCase().includes(shown.toLowerCase())) next.answers = { ...answers, relocation: answer.trim() ? `${answer.trim()} Also open to ${shown}.` : `Yes, open to relocating to ${shown}.` };
    setDraft(next);
    setCity("");
    notify(relocate ? `Added ${shown}, and noted under Location and the relocation answer. Save to keep it.` : `Added ${shown}. Save to keep it.`);
  };

  const save = async () => {
    setBusy(true);
    try {
      await post("/api/preferences", {
        search: { ...search, titleInclude: joinTerms(text.titleInclude ?? ""), titleExclude: joinTerms(text.titleExclude ?? ""), companyExclude: joinTerms(text.companyExclude ?? "") },
        prefs: { ...prefs, targetRoles: unlines(text.targetRoles ?? ""), culture: unlines(text.culture ?? ""), knownGaps: unlines(text.knownGaps ?? "") },
        answers,
      });
      reset(await getJson<Loaded>("/api/preferences"));
      notify("Saved. The next run uses them.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rescreen = () => post("/api/actions/rescreen").then(() => notify("Re-checking stored jobs against your filters"), (e: Error) => notify(e.message));

  return (
    <div className="grid gap-5 pb-16">
      <div>
        <h1 className="text-xl">Preferences</h1>
        <p className="m-0 mt-1 text-muted">What you're looking for. Filters drop jobs before any LLM call; the scorer and the form answers read the rest.</p>
      </div>

      <Card title="Where you'd work" aside={<span className="text-xs font-normal text-muted">Search filter</span>}>
        <p className="mb-3 mt-0 text-[13px] text-ink-2">
          A job is kept when its location matches one of these. Add every city you'd move to. LinkedIn still searches around{" "}
          <strong>{loaded.linkedinLocation}</strong> (set in the config file); company boards and HN are searched everywhere.
        </p>
        <ul className="m-0 mb-3 grid list-none gap-1.5 p-0">
          {Object.entries(search.locations).map(([name, pattern]) => (
            <li key={name} className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-2">
              <span className="truncate font-semibold" title={name}>{name}</span>
              <input
                className={mono}
                aria-label={`Pattern for ${name}`}
                value={pattern}
                onChange={(e) => setSearch({ locations: { ...search.locations, [name]: e.target.value } })}
              />
              <Button size="sm" variant="ghost" onClick={() => setSearch({ locations: Object.fromEntries(Object.entries(search.locations).filter(([k]) => k !== name)) })}>Remove</Button>
            </li>
          ))}
        </ul>
        <form className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-3" onSubmit={(e) => (e.preventDefault(), addCity())}>
          <Field label="Add a city or region" hint="Every name it goes by, comma-separated" className="min-w-[260px] flex-1">
            <input className={input} placeholder="Munich, München" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 pb-6 text-[13px]">
            <input type="checkbox" checked={relocate} onChange={(e) => setRelocate(e.target.checked)} />
            I'd relocate there
          </label>
          <Button type="submit" className="mb-5" disabled={!city.trim()}>Add</Button>
        </form>
      </Card>

      <Card title="Hard rules" aside={<span className="text-xs font-normal text-muted">Search filter</span>}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Most years a job may ask for" hint="Jobs asking for more are dropped">
            <input className={input} type="number" min={0} max={30} value={search.profile.maxYearsRequired} onChange={(e) => setProfile({ maxYearsRequired: Number(e.target.value) })} />
          </Field>
          <Field label="Lowest acceptable top of a pay band (€)" hint="Only applies when a band is published">
            <input className={input} type="number" min={0} step={5000} value={search.profile.minBandTopEur} onChange={(e) => setProfile({ minBandTopEur: Number(e.target.value) })} />
          </Field>
          <Field label="Drop a job over German when it's">
            <select className={input} value={search.profile.germanBlocksAt} onChange={(e) => setProfile({ germanBlocksAt: e.target.value as "required" | "plus" })}>
              <option value="required">required</option>
              <option value="plus">required or a plus</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <LinesField label="Role titles to look for" hint="One per line; regular expressions work" value={text.titleInclude ?? ""} onChange={setLines("titleInclude")} rows={8} monospace />
          <LinesField label="Role titles to skip" hint="One per line; wins over the list on the left" value={text.titleExclude ?? ""} onChange={setLines("titleExclude")} rows={8} monospace />
          <LinesField label="Companies to skip" hint="One per line, e.g. recruiting agencies" value={text.companyExclude ?? ""} onChange={setLines("companyExclude")} rows={8} monospace />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Apply at a score of" hint="Scored jobs at or above this are tailored">
            <input className={input} type="number" min={0} max={100} value={search.vet.applyAt} onChange={(e) => setSearch({ vet: { ...search.vet, applyAt: Number(e.target.value) } })} />
          </Field>
          <Field label="Maybe at a score of" hint="Below this, a job is skipped">
            <input className={input} type="number" min={0} max={100} value={search.vet.maybeAt} onChange={(e) => setSearch({ vet: { ...search.vet, maybeAt: Number(e.target.value) } })} />
          </Field>
          <div className="grid content-end">
            <Button disabled={dirty || running} onClick={rescreen} title={dirty ? "Save first" : "Applies the filters to queued, filtered and older jobs; no LLM calls"}>
              Re-check stored jobs
            </Button>
          </div>
        </div>
      </Card>

      <Card title="What you want" aside={<span className="text-xs font-normal text-muted">Read by the scorer</span>}>
        <div className="grid gap-4 md:grid-cols-2">
          <LinesField label="Target roles" hint="One per line" value={text.targetRoles ?? ""} onChange={setLines("targetRoles")} />
          <Field label="Location and relocation" hint="Where you live, what you'd move for, remote or office">
            <textarea className={input} rows={4} value={prefs.location} onChange={(e) => setPrefs({ location: e.target.value })} />
          </Field>
          <Field label="Compensation">
            <textarea className={input} rows={2} value={prefs.compensation} onChange={(e) => setPrefs({ compensation: e.target.value })} />
          </Field>
          <Field label="Languages">
            <textarea className={input} rows={2} value={prefs.languages} onChange={(e) => setPrefs({ languages: e.target.value })} />
          </Field>
          <LinesField label="Culture you want" hint="One per line" value={text.culture ?? ""} onChange={setLines("culture")} />
          <Field label="AI focus">
            <textarea className={input} rows={4} value={prefs.aiFocus} onChange={(e) => setPrefs({ aiFocus: e.target.value })} />
          </Field>
          <Field label="Experience summary">
            <textarea className={input} rows={3} value={prefs.experience} onChange={(e) => setPrefs({ experience: e.target.value })} />
          </Field>
          <LinesField label="Known gaps" hint="One per line; the scorer won't count these against a job twice" value={text.knownGaps ?? ""} onChange={setLines("knownGaps")} rows={3} />
        </div>
      </Card>

      <Card title="Answers for application forms" aside={<span className="text-xs font-normal text-muted">Used as written, never guessed</span>}>
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(loaded.answerTopics).map(([key, about]) => (
            <Field key={key} label={about}>
              <textarea className={input} rows={2} value={answers[key] ?? ""} onChange={(e) => setAnswer(key, e.target.value)} />
            </Field>
          ))}
        </div>
      </Card>

      <div className={cx("fixed inset-x-0 bottom-0 z-10 border-t border-line bg-raised/95 backdrop-blur", !dirty && "hidden")}>
        <div className="mx-auto flex max-w-[1200px] items-center justify-end gap-3 px-6 py-2.5">
          <H3 className="mr-auto">Unsaved changes</H3>
          <Button variant="ghost" disabled={busy} onClick={() => reset(loaded)}>Discard</Button>
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
