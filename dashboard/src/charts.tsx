import type { Factor } from "./api";

/**
 * Score breakdown as meters: the track is the factor's weight, the fill is the points earned, both on one scale so
 * factor widths compare honestly. The row text carries every value, so the table is its own accessible view.
 */
export function ScoreBreakdown({ factors, total }: { factors: Factor[]; total: number }) {
  const scale = Math.max(...factors.map((f) => f.weight), 1);
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[34px] font-semibold">{total}</span>
        <span className="text-muted">of 100</span>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {factors.map((f) => (
            <tr key={f.factor} title={`${f.factor}: ${f.points} of ${f.weight} points (${f.basis})`} className="group">
              <td className="w-px whitespace-nowrap py-1 pr-3 text-ink-2">{f.factor}</td>
              <td className="py-1">
                <div className="relative h-3.5" role="img" aria-label={`${f.points} of ${f.weight} points`}>
                  <div className="absolute inset-y-0 left-0 rounded-r bg-meter-track" style={{ width: `${(f.weight / scale) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-r bg-accent group-hover:brightness-110" style={{ width: `${(f.points / scale) * 100}%`, minWidth: f.points > 0 ? 4 : 0 }} />
                </div>
              </td>
              <td className="w-px whitespace-nowrap py-1 pl-2.5 text-right tabular-nums">
                {f.points}
                <span className="text-muted"> / {f.weight}</span>
              </td>
              <td className="w-px whitespace-nowrap py-1 pl-3 text-xs text-muted">{f.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STEP = ["bg-neutral-bar", "bg-step-1", "bg-step-2", "bg-step-3"] as const;

/** Outcome funnel. Ordinal stages step light to dark on one validated ramp; rejections sit in neutral gray. */
export function Funnel({ stages }: { stages: { label: string; n: number; tone: 1 | 2 | 3 | 0 }[] }) {
  const max = Math.max(...stages.map((s) => s.n), 1);
  return (
    <table className="w-full border-collapse">
      <tbody>
        {stages.map((s) => (
          <tr key={s.label} title={`${s.label}: ${s.n}`}>
            <td className="w-px whitespace-nowrap py-1 pr-3 text-ink-2">{s.label}</td>
            <td className="py-1">
              <div className="relative h-3.5" role="img" aria-label={`${s.n} jobs`}>
                <div className={`absolute inset-y-0 left-0 rounded-r ${STEP[s.tone]}`} style={{ width: `${(s.n / max) * 100}%`, minWidth: s.n > 0 ? 4 : 0 }} />
              </div>
            </td>
            <td className="w-px whitespace-nowrap py-1 pl-2.5 text-right tabular-nums">{s.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
