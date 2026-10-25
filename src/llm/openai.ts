// Any OpenAI-compatible chat completions API: OpenAI, OpenRouter, Groq, Together, DeepSeek, or a local server such as
// Ollama or LM Studio. Plain fetch, no SDK. Structured output is requested as a strict JSON schema; models and gateways
// that honour it less strictly still get their reply parsed tolerantly and checked against the schema in code.
import { z } from "zod";

export interface Reply<T> {
  served: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  outcome: { kind: "ok"; value: T } | { kind: "refusal"; category: string | null; explanation: string | null } | { kind: "error"; error: string };
}

interface Completion {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null };
  error?: { message?: string };
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** JSON schema for the API: Zod's output already lists every field as required with no extras, as strict mode needs. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** The JSON object in a reply, also when a model wraps it in a ```json fence or adds a sentence around it. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const body = (fenced ?? text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
    return JSON.parse(body.slice(start, end + 1));
  }
}

/**
 * How effort is passed differs per API: OpenRouter takes `reasoning.effort` for any model and ignores it where it
 * doesn't apply; OpenAI takes `reasoning_effort` but rejects it for non-reasoning models; others get nothing.
 */
function effortParams(baseUrl: string, model: string, effort: string): Record<string, unknown> {
  if (/openrouter\.ai/.test(baseUrl)) return { reasoning: { effort }, provider: { require_parameters: true } };
  if (/api\.openai\.com/.test(baseUrl) && /^(o\d|gpt-5)/.test(model)) return { reasoning_effort: effort };
  return {};
}

export async function openaiCall<S extends z.ZodType>(o: {
  model: string;
  system: string;
  input: string;
  schema: S;
  effort: string;
  maxTokens: number;
}): Promise<Reply<z.infer<S>>> {
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const key = process.env.OPENAI_API_KEY;
  // Local servers usually need no key; hosted ones answer 401 without it, which is reported as is.
  const headers: Record<string, string> = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
  // OpenRouter shows these on its dashboard; other APIs ignore them.
  if (/openrouter\.ai/.test(baseUrl)) Object.assign(headers, { "http-referer": "https://github.com/sushantn16/job-scout", "x-title": "job-scout" });

  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let served = o.model;
  const messages: { role: string; content: string }[] = [{ role: "system", content: o.system }, { role: "user", content: o.input }];
  // A reply that doesn't fit the schema gets one retry, told what was wrong: weaker models often fix it.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: o.model,
        messages,
        response_format: { type: "json_schema", json_schema: { name: "output", strict: true, schema: jsonSchema(o.schema) } },
        max_completion_tokens: o.maxTokens,
        ...effortParams(baseUrl, o.model, o.effort),
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const data = (await res.json().catch(() => ({}))) as Completion;
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}: ${data.error?.message ?? res.statusText}`);
    served = data.model || served;
    // Cached prompt tokens are part of prompt_tokens here; they're counted apart, as with Claude.
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    usage.inputTokens += (data.usage?.prompt_tokens ?? 0) - cached;
    usage.outputTokens += data.usage?.completion_tokens ?? 0;
    usage.cacheReadTokens += cached;

    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (msg?.refusal || choice?.finish_reason === "content_filter") return { served, usage, outcome: { kind: "refusal", category: null, explanation: msg?.refusal ?? null } };
    if (choice?.finish_reason === "length") return { served, usage, outcome: { kind: "error", error: "finish_reason=length" } };
    let problem: string;
    try {
      const parsed = o.schema.safeParse(extractJson(msg?.content ?? ""));
      if (parsed.success) return { served, usage, outcome: { kind: "ok", value: parsed.data } };
      problem = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "output"}: ${i.message}`).join("; ");
    } catch (e) {
      problem = (e as Error).message;
    }
    if (attempt >= 2) return { served, usage, outcome: { kind: "error", error: `output didn't match the schema: ${problem}` } };
    messages.push({ role: "assistant", content: msg?.content ?? "" }, { role: "user", content: `That reply doesn't match the required JSON schema (${problem}). Reply with the corrected JSON object only.` });
  }
}
