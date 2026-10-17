// Structured outputs guarantee the JSON shape, not length or count limits. Rejecting a slightly long answer wastes the
// call, so schemas state limits in their descriptions and this trims deterministically after parsing instead.

/** A string's max characters, an array's `[maxItems, itemSpec]`, or a nested object of specs. */
export type Spec = number | [number, Spec?] | { [key: string]: Spec };

export function clamp<T>(value: T, spec: Spec): T {
  if (value == null) return value;
  if (typeof spec === "number") {
    if (typeof value !== "string") return value;
    return (value.length > spec ? `${value.slice(0, spec - 1).trimEnd()}…` : value) as T;
  }
  if (Array.isArray(spec)) {
    if (!Array.isArray(value)) return value;
    const [max, item] = spec;
    return value.slice(0, max).map((v) => (item === undefined ? v : clamp(v, item))) as T;
  }
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [k, s] of Object.entries(spec)) if (k in out) out[k] = clamp(out[k], s);
  return out as T;
}
