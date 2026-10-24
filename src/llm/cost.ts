// What LLM calls cost at the configured list prices (USD per million tokens).
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Usage { model: string; input: number; output: number; cacheRead: number; cacheWrite: number }

export const costOf = (price: (model: string) => Price, rows: Usage[]) =>
  rows.reduce((sum, r) => {
    const p = price(r.model);
    return sum + (r.input * p.input + r.output * p.output + r.cacheRead * p.cacheRead + r.cacheWrite * p.cacheWrite) / 1e6;
  }, 0);
