// What LLM calls cost at the configured list prices (USD per million tokens).
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Usage { model: string; input: number; output: number; cacheRead: number; cacheWrite: number }

/**
 * The price for a model: its own entry, else the longest entry it starts with ("anthropic/claude-sonnet-4.5-20250929"
 * matches "anthropic/claude-sonnet-4.5", "gpt-5-2025-08-07" matches "gpt-5"), else "default".
 */
export function priceFor(pricing: Record<string, Price>, model: string): Price {
  if (pricing[model]) return pricing[model];
  const prefix = Object.keys(pricing).filter((k) => k !== "default" && model.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return pricing[prefix ?? "default"]!;
}

export const costOf = (price: (model: string) => Price, rows: Usage[]) =>
  rows.reduce((sum, r) => {
    const p = price(r.model);
    return sum + (r.input * p.input + r.output * p.output + r.cacheRead * p.cacheRead + r.cacheWrite * p.cacheWrite) / 1e6;
  }, 0);
