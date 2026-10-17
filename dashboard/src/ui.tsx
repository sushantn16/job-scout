import type { ButtonHTMLAttributes, ReactNode } from "react";
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

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="text-[12.5px] text-ink-2">{label}</div>
      <div className="mt-0.5 text-[26px] font-semibold">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function Banner({ tone, title, children }: { tone: "warning" | "critical"; title: string; children?: ReactNode }) {
  return (
    <div className={cx("grid gap-1 rounded-lg border px-3 py-2.5", tone === "warning" ? "border-warning bg-warning-wash" : "border-critical bg-critical-wash")}>
      <strong>⚠ {title}</strong>
      {children}
    </div>
  );
}

export const H3 = ({ children, className }: { children: ReactNode; className?: string }) => <h3 className={cx("text-[13px] text-ink-2", className)}>{children}</h3>;
export const List = ({ children }: { children: ReactNode }) => <ul className="m-0 grid list-disc gap-1 pl-[18px]">{children}</ul>;
