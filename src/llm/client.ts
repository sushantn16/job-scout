// One structured-output call path for every LLM role. Roles get no tools: a manipulated role has nothing to act with.
// Two providers: Claude on Amazon Bedrock (the default) and any OpenAI-compatible API (src/llm/openai.ts).
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { openaiCall, type Reply } from "./openai.ts";

export type Role = "screen" | "research" | "vet" | "tailor" | "form";
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

export type Provider = "bedrock" | "openai";

/** JOB_SCOUT_PROVIDER: "bedrock" (default) or "openai" for any OpenAI-compatible API (OpenRouter, OpenAI, a local server). */
export function provider(): Provider {
  const p = (process.env.JOB_SCOUT_PROVIDER || "bedrock").toLowerCase();
  if (p !== "bedrock" && p !== "openai") throw new LlmError(`JOB_SCOUT_PROVIDER must be "bedrock" or "openai", not "${p}"`);
  return p;
}

/**
 * The model for a role: JOB_SCOUT_MODEL_<ROLE> (e.g. JOB_SCOUT_MODEL_SCREEN) if set, else JOB_SCOUT_MODEL. Form answers
 * are text employers read, so without their own setting they use the tailor's model.
 */
export const modelFor = (role: Role) => {
  const env = process.env;
  const m = env[`JOB_SCOUT_MODEL_${role.toUpperCase()}`] || (role === "form" ? env.JOB_SCOUT_MODEL_TAILOR : "") || env.JOB_SCOUT_MODEL;
  if (!m) throw new LlmError("JOB_SCOUT_MODEL is not set (see .env.example)");
  return m;
};

interface Call<S extends z.ZodType> { model: string; system: string; cacheSystem?: boolean; input: string; schema: S; effort: Effort; maxTokens: number }

let bedrock: AnthropicBedrock | undefined;
async function bedrockCall<S extends z.ZodType>(o: Call<S>): Promise<Reply<z.infer<S>>> {
  bedrock ??= new AnthropicBedrock({ awsRegion: process.env.AWS_REGION });
  const res = await bedrock.messages.parse({
    model: o.model,
    max_tokens: o.maxTokens,
    system: o.cacheSystem ? [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }] : o.system,
    messages: [{ role: "user", content: o.input }],
    output_config: { format: zodOutputFormat(o.schema), effort: o.effort },
  });
  // Bedrock IDs are often opaque profile ARNs; the response names the actual model, which is what pricing needs.
  const served = res.model || o.model;
  const usage = {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
  };
  if (res.stop_reason === "refusal") {
    const d = res.stop_details as { category?: string | null; explanation?: string | null } | null | undefined;
    return { served, usage, outcome: { kind: "refusal", category: d?.category ?? null, explanation: d?.explanation ?? null } };
  }
  if (res.stop_reason !== "end_turn" || res.parsed_output == null) {
    return { served, usage, outcome: { kind: "error", error: `stop_reason=${res.stop_reason}${res.parsed_output == null ? ", no parsed output" : ""}` } };
  }
  return { served, usage, outcome: { kind: "ok", value: res.parsed_output as z.infer<S> } };
}

/**
 * Call the model with a fixed system prompt and untrusted `input`, returning schema-validated output.
 * `onRecord` receives usage for every call, successful or not, so cost tracking never misses one.
 */
export async function structured<S extends z.ZodType>(opts: {
  role: Role;
  system: string;
  /** Mark the system prompt cacheable: worth it when it is long and identical across calls in a run. OpenAI-compatible
   * APIs cache long prompts on their own, so it only changes the Bedrock request. */
  cacheSystem?: boolean;
  input: string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
  onRecord?: (r: CallRecord) => void;
}): Promise<z.infer<S>> {
  const started = Date.now();
  const model = modelFor(opts.role);
  let served = model;
  const record = (r: Omit<CallRecord, "role" | "model" | "ms">) => opts.onRecord?.({ role: opts.role, model: served, ms: Date.now() - started, ...r });
  try {
    const call = { model, system: opts.system, cacheSystem: opts.cacheSystem, input: opts.input, schema: opts.schema, effort: opts.effort ?? "low", maxTokens: opts.maxTokens ?? 8000 };
    const reply = provider() === "openai" ? await openaiCall(call) : await bedrockCall(call);
    served = reply.served;
    const { outcome, usage } = reply;
    if (outcome.kind === "refusal") {
      record({ ...usage, ok: false, error: `refusal: ${outcome.category ?? "?"}` });
      throw new LlmRefusal(opts.role, outcome.category, outcome.explanation);
    }
    if (outcome.kind === "error") {
      record({ ...usage, ok: false, error: outcome.error });
      throw new LlmError(`${opts.role}: ${outcome.error}`);
    }
    record({ ...usage, ok: true });
    return outcome.value;
  } catch (e) {
    if (!(e instanceof LlmError)) record({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ok: false, error: (e as Error).message });
    throw e;
  }
}
