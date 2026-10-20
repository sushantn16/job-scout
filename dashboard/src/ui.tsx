import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import type { Status } from "./api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Tone = "good" | "warning" | "critical" | "info" | "neutral";
const DOT: Record<Tone, string> = { good: "bg-good", warning: "bg-warning", critical: "bg-critical", info: "bg-accent", neutral: "bg-muted" };

/** A status always pairs its color dot with words, so color is never the only signal. */
export function Pill({ tone = "neutral", children, pulse }: { tone?: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2 py-px text-xs text-ink-2">
      <span className={cx("size-[7px] rounded-full", DOT[tone], pulse && "animate-pulse motion-reduce:animate-none")} />
      {children}
    </span>
  );
}

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  new: { label: "Queued", tone: "info" },
  screened: { label: "Screened", tone: "info" },
  needs_review: { label: "Needs review", tone: "warning" },
  apply: { label: "Apply", tone: "good" },
  cv_ready: { label: "CV ready", tone: "good" },
  maybe: { label: "Maybe", tone: "neutral" },
  skip: { label: "Skip", tone: "neutral" },
  filtered: { label: "Filtered", tone: "neutral" },
  stale: { label: "Older", tone: "neutral" },
  applied: { label: "Applied", tone: "info" },
  interview: { label: "Interview", tone: "good" },
  rejected: { label: "Rejected", tone: "critical" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

export const statusLabel = (s: Status) => STATUS[s]?.label ?? s;
export const StatusPill = ({ status }: { status: Status }) => <Pill tone={STATUS[status]?.tone}>{statusLabel(status)}</Pill>;

export function RunPill({ status }: { status: "running" | "done" | "failed" }) {
  return status === "running" ? <Pill tone="info" pulse>Running</Pill> : status === "done" ? <Pill tone="good">Done</Pill> : <Pill tone="critical">Failed</Pill>;
}

export function Button({ variant = "default", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "cursor-pointer rounded-lg border transition-colors disabled:cursor-default disabled:opacity-50",
        size === "sm" ? "px-2.5 py-0.5 text-[12.5px]" : "px-3 py-1.5",
        variant === "primary" && "border-accent bg-accent text-white hover:enabled:brightness-110",
        variant === "default" && "border-line bg-raised text-ink hover:enabled:bg-hover",
        variant === "ghost" && "border-transparent bg-transparent text-ink hover:enabled:bg-hover aria-[current=page]:bg-hover aria-[current=page]:font-semibold",
        className,
      )}
    />
  );
}

export function Card({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface p-4", className)}>
      {title ? (
        <h2 className="mb-3 flex items-baseline justify-between gap-3 text-[15px]">
          <span>{title}</span>
          {aside}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/** A row of headline numbers in one bordered strip. */
export function Stats({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="bg-surface px-4 py-3">
          <div className="text-[12.5px] text-ink-2">{i.label}</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">{i.value}</div>
          {i.sub ? <div className="mt-0.5 text-xs text-muted">{i.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** A titled block on a page, with an optional count and right-hand aside. */
export function Section({ title, count, aside, children }: { title: string; count?: number; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 px-0.5">
        <h2 className="text-[15px]">{title}</h2>
        {count != null ? <span className="text-[13px] tabular-nums text-muted">{count}</span> : null}
        <span className="flex-1" />
        {aside ? <span className="text-[12.5px] text-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Tabs over one panel. Arrow keys move between tabs, as in the WAI-ARIA tabs pattern. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const i = (tabs.findIndex((t) => t.id === value) + step + tabs.length) % tabs.length;
    onChange(tabs[i]!.id);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[i]?.focus();
  };
  return (
    <div role="tablist" ref={list} onKeyDown={onKey} className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px cursor-pointer border-b-2 px-3 py-2 hover:text-ink",
            t.id === value ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A short-lived message at the bottom of the screen, for the result of an action. */
export function useNotice(): [ReactNode, (text: string) => void] {
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const node = notice ? (
    <div role="status" className="fixed bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-line bg-raised px-3.5 py-2 text-ink shadow-lg">
      {notice.text}
    </div>
  ) : null;
  return [node, (text) => setNotice({ text, at: Date.now() })];
}

export const th = "border-b border-grid px-2 py-1.5 text-left font-medium text-muted";
export const td = "border-b border-grid px-2 py-1.5 align-top";

export function Banner({ tone, title, children }: { tone: "info" | "warning" | "critical"; title: string; children?: ReactNode }) {
  return (
    <div className={cx("grid gap-1 rounded-lg border px-3 py-2.5", tone === "info" ? "border-accent bg-accent-wash" : tone === "warning" ? "border-warning bg-warning-wash" : "border-critical bg-critical-wash")}>
      <strong>{tone === "info" ? "" : "⚠ "}{title}</strong>
      {children}
    </div>
  );
}

export const H3 = ({ children, className }: { children: ReactNode; className?: string }) => <h3 className={cx("text-[13px] text-ink-2", className)}>{children}</h3>;
export const List = ({ children }: { children: ReactNode }) => <ul className="m-0 grid list-disc gap-1 pl-[18px]">{children}</ul>;

/** Text with a copy button, for pasting into application forms. */
export function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative whitespace-pre-wrap rounded-lg border border-line bg-raised px-3.5 py-3 pr-20">
      <Button size="sm" className="absolute right-2 top-2" onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}>
        {done ? "Copied" : "Copy"}
      </Button>
      {text}
    </div>
  );
}
