// One structured-output call path for every LLM role. Roles get no tools: a manipulated role has nothing to act with.
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export type Role = "screen" | "research" | "vet" | "tailor";
export type Effort = "low" | "medium" | "high";

export interface CallRecord {
  role: Role;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Billed separately from inputTokens: reads are cheap, writes cost a premium. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  ms: number;
  ok: boolean;
  error?: string;
}

export class LlmError extends Error {}

/** The model declined the request (safety classifier). Callers decide whether that fails open or closed. */
export class LlmRefusal extends LlmError {
  readonly category: string | null;
  readonly explanation: string | null;
  constructor(role: Role, category: string | null, explanation: string | null) {
    super(`${role}: refused (${category ?? "no category"})`);
    this.category = category;
    this.explanation = explanation;
  }
}

let client: AnthropicBedrock | undefined;
/** The model for a role: JOB_SCOUT_MODEL_<ROLE> (e.g. JOB_SCOUT_MODEL_SCREEN) if set, else JOB_SCOUT_MODEL. */
export const modelFor = (role: Role) => {
  const m = process.env[`JOB_SCOUT_MODEL_${role.toUpperCase()}`] || process.env.JOB_SCOUT_MODEL;
  if (!m) throw new LlmError("JOB_SCOUT_MODEL is not set (see .env.example)");
  return m;
};

/**
 * Call Claude with a fixed system prompt and untrusted `input`, returning schema-validated output.
 * `onRecord` receives usage for every call, successful or not, so cost tracking never misses one.
 */
export async function structured<S extends z.ZodType>(opts: {
  role: Role;
  system: string;
  /** Mark the system prompt cacheable: worth it when it is long and identical across calls in a run. */
  cacheSystem?: boolean;
  input: string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
  onRecord?: (r: CallRecord) => void;
}): Promise<z.infer<S>> {
  client ??= new AnthropicBedrock({ awsRegion: process.env.AWS_REGION });
  const started = Date.now();
  const model = modelFor(opts.role);
  // Bedrock IDs are often opaque profile ARNs; the response names the actual model, which is what pricing needs.
  let served = model;
  const record = (r: Omit<CallRecord, "role" | "model" | "ms">) => opts.onRecord?.({ role: opts.role, model: served, ms: Date.now() - started, ...r });
  try {
    const res = await client.messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.cacheSystem ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }] : opts.system,
      messages: [{ role: "user", content: opts.input }],
      output_config: { format: zodOutputFormat(opts.schema), effort: opts.effort ?? "low" },
    });
    served = res.model || model;
    const usage = {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
    if (res.stop_reason === "refusal") {
      const d = res.stop_details as { category?: string | null; explanation?: string | null } | null | undefined;
      record({ ...usage, ok: false, error: `refusal: ${d?.category ?? "?"}` });
      throw new LlmRefusal(opts.role, d?.category ?? null, d?.explanation ?? null);
    }
    if (res.stop_reason !== "end_turn" || res.parsed_output == null) {
      const error = `stop_reason=${res.stop_reason}${res.parsed_output == null ? ", no parsed output" : ""}`;
      record({ ...usage, ok: false, error });
      throw new LlmError(`${opts.role}: ${error}`);
    }
    record({ ...usage, ok: true });
    return res.parsed_output as z.infer<S>;
  } catch (e) {
    if (!(e instanceof LlmError)) record({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ok: false, error: (e as Error).message });
    throw e;
  }
}
