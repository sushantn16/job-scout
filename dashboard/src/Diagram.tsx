// The whole pipeline as one block diagram, loop included: job boards in, the main line inside the pipeline boundary
// (wrapping onto a second row), you apply, replies come back through Gmail into the Inbox, and outcomes feed back into
// scoring. Live: each block shows its status and key number for the selected run; the stage cards below carry the same
// numbers as text. Stage names, descriptions and kinds come from the API (src/pipeline/stages.ts); only the layout and
// the three blocks outside the pipeline are defined here.
import type { PipelineStage as Stage } from "./api";
import { cx } from "./ui";

type Kind = Stage["kind"] | "outside";
type Block = { key: string; x: number; y: number; title: string; does: string; kind: Kind };

const W = 168;
const H = 110;
const ROW = [92, 272, 452];
/** Where each stage's block sits. */
const AT: Record<string, { x: number; y: number }> = {
  fetch: { x: 232, y: ROW[0]! }, filter: { x: 426, y: ROW[0]! }, screen: { x: 620, y: ROW[0]! }, research: { x: 814, y: ROW[0]! },
  vet: { x: 329, y: ROW[1]! }, tailor: { x: 523, y: ROW[1]! }, ready: { x: 717, y: ROW[1]! },
  inbox: { x: 717, y: ROW[2]! }, outcomes: { x: 523, y: ROW[2]! },
};
const OUTSIDE: Block[] = [
  { key: "in", x: 16, y: ROW[0]!, title: "Job boards", does: "Ashby, Greenhouse, Lever, Personio, HN, LinkedIn", kind: "outside" },
  { key: "you", x: 1032, y: ROW[1]!, title: "You", does: "Review, then apply on the company's site", kind: "outside" },
  { key: "gmail", x: 1032, y: ROW[2]!, title: "Gmail", does: "Replies: confirmations, rejections, interviews", kind: "outside" },
];

export const KindTag = ({ kind }: { kind: Stage["kind"] }) => (
  <span className={cx("rounded-full border px-1.5 text-[10.5px] font-medium", kind === "LLM" ? "border-accent text-accent-ink" : "border-line text-ink-2")}>{kind}</span>
);

const RECT: Record<string, string> = {
  done: "fill-raised stroke-accent",
  running: "fill-raised stroke-accent [stroke-width:3] animate-pulse motion-reduce:animate-none",
  failed: "fill-raised stroke-critical [stroke-width:2]",
  idle: "fill-raised stroke-axis [stroke-dasharray:4_3]",
  skipped: "fill-raised stroke-axis [stroke-dasharray:4_3]",
  waiting: "fill-raised stroke-axis",
  outside: "fill-hover stroke-axis",
};

export function Diagram({ stages }: { stages: Stage[] }) {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const BLOCKS: Block[] = [...OUTSIDE, ...stages.filter((s) => AT[s.key]).map((s) => ({ key: s.key, ...AT[s.key]!, title: s.name, does: s.does, kind: s.kind }))];
  const at = (key: string) => BLOCKS.find((b) => b.key === key)!;
  const status = (b: Block) => (b.kind === "outside" ? "outside" : (byKey.get(b.key)?.status ?? "waiting"));
  const flowed = (key: string) => {
    const b = at(key);
    return b.kind === "outside" || ["done", "idle"].includes(status(b));
  };
  const arrow = (key: string, d: string, opts: { dashed?: boolean } = {}) => (
    <path
      key={`${key}-${d}`}
      d={d}
      fill="none"
      strokeWidth={3}
      strokeLinejoin="round"
      className={cx(flowed(key) && !opts.dashed ? "stroke-accent" : "stroke-axis", opts.dashed && "[stroke-dasharray:7_5]")}
      markerEnd={`url(#${flowed(key) && !opts.dashed ? "head-done" : "head"})`}
    />
  );
  const mid = (b: Block) => b.y + H / 2;
  const right = (a: string, b: string) => arrow(a, `M${at(a).x + W} ${mid(at(a))} H${at(b).x - 4}`);
  const left = (a: string, b: string) => arrow(a, `M${at(a).x} ${mid(at(a))} H${at(b).x + W + 4}`);
  const r = at("research");
  const v = at("vet");
  const you = at("you");
  const o = at("outcomes");
  const summary = stages.map((s) => `${s.name}: ${s.status}${s.headline ? `, ${s.headline}` : ""}`).join("; ");

  return (
    <svg className="block h-auto w-full" viewBox="0 0 1216 620" role="img" aria-label={`Pipeline: ${summary}`}>
      <defs>
        {(["head", "head-done"] as const).map((id) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className={id === "head-done" ? "fill-accent" : "fill-axis"} />
          </marker>
        ))}
      </defs>
      <rect x="208" y="40" width="808" height="568" rx="10" className="fill-accent-wash stroke-axis [stroke-dasharray:6_4] [stroke-width:1.5]" />
      <text x="612" y="68" textAnchor="middle" className="fill-ink text-[15px] font-semibold">job-scout pipeline</text>
      <text x="612" y="596" textAnchor="middle" className="fill-muted text-xs">Every stage records its results and events in SQLite; the dashboard reads them live.</text>

      {right("in", "fetch")}
      {right("fetch", "filter")}
      {right("filter", "screen")}
      {right("screen", "research")}
      {/* Wrap: out of Research on the right, down, back left, and into Score from above. */}
      {arrow("research", `M${r.x + W} ${mid(r)} H${r.x + W + 14} V${r.y + H + 35} H${v.x + W / 2} V${v.y - 4}`)}
      {right("vet", "tailor")}
      {right("tailor", "ready")}
      {right("ready", "you")}
      {/* The loop: you apply, replies land in Gmail, the Inbox matches them, outcomes update. */}
      {arrow("you", `M${you.x + W / 2} ${you.y + H} V${at("gmail").y - 4}`)}
      {left("gmail", "inbox")}
      {left("inbox", "outcomes")}
      {/* Feedback into scoring is planned, not built: drawn dashed and labelled. */}
      {arrow("outcomes", `M${o.x} ${mid(o)} H${v.x + W / 2} V${v.y + H + 4}`, { dashed: true })}
      <text x={v.x + W / 2 - 10} y={mid(o) - 10} textAnchor="end" className="fill-muted text-[11.5px]">
        learn which scores lead to interviews (planned)
      </text>

      {BLOCKS.map((b) => {
        const s = byKey.get(b.key);
        const st = status(b);
        const headline = s?.headline;
        return (
          <g key={b.key} className={cx(["waiting", "idle", "skipped"].includes(st) && "opacity-60")}>
            <title>{`${b.title}: ${b.does}${s ? `. ${s.status}. ${s.metrics.join(", ")}` : ""}`}</title>
            <rect x={b.x} y={b.y} width={W} height={H} rx="8" strokeWidth={1.5} className={RECT[st] ?? RECT.waiting} />
            <foreignObject x={b.x} y={b.y} width={W} height={H}>
              <div className="box-border flex h-full flex-col gap-[3px] px-2.5 py-2 text-xs text-ink">
                <div className="flex items-center justify-between gap-1.5 text-[13px] font-semibold">
                  <span>{b.title}</span>
                  {b.kind !== "outside" ? <KindTag kind={b.kind} /> : null}
                </div>
                <div className="text-[11.5px] leading-snug text-muted">{b.does}</div>
                {headline ? <div className="mt-auto text-[12.5px] font-semibold">{headline}</div> : null}
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}
