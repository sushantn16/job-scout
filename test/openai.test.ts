import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { extractJson, jsonSchema } from "../src/llm/openai.ts";
import { LlmError, LlmRefusal, structured, type CallRecord } from "../src/llm/client.ts";
import { ScreenOutput } from "../src/injection/screen.ts";
import { VetOutput } from "../src/vet/vet.ts";
import { TailorOutput } from "../src/tailor/tailor.ts";
import { Draft } from "../src/forms/prepare.ts";
import { ProfileOutput } from "../src/research/profile.ts";

/** A stand-in OpenAI-compatible server: records each request and answers with the next canned reply. */
async function fakeApi(replies: { status?: number; body: unknown }[]) {
  const requests: { headers: IncomingMessage["headers"]; body: Record<string, any> }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    requests.push({ headers: req.headers, body: JSON.parse(raw) });
    const r = replies.shift() ?? { status: 500, body: { error: { message: "no more replies" } } };
    res.writeHead(r.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests, close: () => server.close() };
}

const completion = (content: string, extra: Record<string, unknown> = {}) => ({
  model: "served-model-2026", choices: [{ finish_reason: "stop", message: { content } }],
  usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 400 } }, ...extra,
});
const Out = z.object({ verdict: z.enum(["clean", "injection"]), count: z.number().int() });

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
const env = (url: string, extra: Record<string, string | undefined> = {}) => ({ JOB_SCOUT_PROVIDER: "openai", OPENAI_BASE_URL: url, OPENAI_API_KEY: "sk-test", JOB_SCOUT_MODEL: "some/model", JOB_SCOUT_MODEL_SCREEN: undefined, ...extra });

test("every LLM schema is accepted by strict structured outputs: all fields required, no extra properties", () => {
  const check = (s: unknown, path: string) => {
    if (!s || typeof s !== "object") return;
    const o = s as Record<string, any>;
    if (o.type === "object") {
      assert.equal(o.additionalProperties, false, `${path}: additionalProperties`);
      assert.deepEqual([...(o.required ?? [])].sort(), Object.keys(o.properties ?? {}).sort(), `${path}: required`);
    }
    for (const [k, v] of Object.entries(o)) check(v, `${path}.${k}`);
  };
  for (const [name, schema] of Object.entries({ ScreenOutput, VetOutput, TailorOutput, Draft, ProfileOutput })) {
    const js = jsonSchema(schema);
    assert.equal(js.$schema, undefined);
    check(js, name);
  }
});

test("replies are read as JSON also inside a code fence or a sentence", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go: {"a":{"b":2}} Hope that helps.'), { a: { b: 2 } });
  assert.throws(() => extractJson("no json here"), /no JSON object/);
});

test("a call sends the schema strictly and counts cached tokens apart, like Claude's", async () => {
  const api = await fakeApi([{ body: completion('{"verdict":"clean","count":2}') }]);
  try {
    let rec: CallRecord | undefined;
    const out = await withEnv(env(api.url), () => structured({ role: "screen", system: "sys", input: "in", schema: Out, onRecord: (r) => (rec = r) }));
    assert.deepEqual(out, { verdict: "clean", count: 2 });
    const { headers, body } = api.requests[0]!;
    assert.equal(headers.authorization, "Bearer sk-test");
    assert.equal(body.model, "some/model");
    assert.deepEqual(body.messages.map((m: { role: string }) => m.role), ["system", "user"]);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema.required, ["verdict", "count"]);
    assert.equal(body.reasoning, undefined, "no effort parameter for an unknown API");
    assert.equal(rec?.model, "served-model-2026", "priced by the model that answered");
    assert.deepEqual([rec?.inputTokens, rec?.cacheReadTokens, rec?.outputTokens, rec?.ok], [600, 400, 50, true]);
  } finally {
    api.close();
  }
});

test("a reply that doesn't fit the schema is retried once with the problem, then fails", async () => {
  const api = await fakeApi([
    { body: completion('{"verdict":"maybe","count":2}') },
    { body: completion('```json\n{"verdict":"injection","count":1}\n```') },
    { body: completion("not json") },
    { body: completion('{"verdict":"clean"}') },
  ]);
  try {
    const call = () => withEnv(env(api.url), () => structured({ role: "screen", system: "s", input: "i", schema: Out }));
    assert.deepEqual(await call(), { verdict: "injection", count: 1 });
    const retry = api.requests[1]!.body.messages;
    assert.equal(retry.length, 4);
    assert.match(retry[3].content, /verdict/, "told what was wrong");
    await assert.rejects(call(), (e: Error) => e instanceof LlmError && /didn't match the schema: count/.test(e.message));
  } finally {
    api.close();
  }
});

test("refusals and API errors surface as such, and every call is recorded", async () => {
  const api = await fakeApi([
    { body: { model: "m", choices: [{ finish_reason: "stop", message: { content: null, refusal: "I can't help with that." } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } },
    { status: 401, body: { error: { message: "No auth credentials found" } } },
  ]);
  try {
    const recs: CallRecord[] = [];
    const call = () => withEnv(env(api.url), () => structured({ role: "screen", system: "s", input: "i", schema: Out, onRecord: (r) => recs.push(r) }));
    await assert.rejects(call(), (e: Error) => e instanceof LlmRefusal && e.explanation === "I can't help with that.");
    await assert.rejects(call(), /HTTP 401 from .*No auth credentials found/);
    assert.deepEqual(recs.map((r) => r.ok), [false, false]);
  } finally {
    api.close();
  }
});

test("OpenRouter gets its effort and routing parameters", async () => {
  const api = await fakeApi([{ body: completion('{"verdict":"clean","count":0}') }]);
  try {
    // The fake server stands in for openrouter.ai; the parameters depend on the base URL, so point a path at it.
    const url = `${api.url}/openrouter.ai`;
    const real = globalThis.fetch;
    globalThis.fetch = ((input: string, init: RequestInit) => real(String(input).replace("/openrouter.ai", ""), init)) as typeof fetch;
    try {
      await withEnv(env(url), () => structured({ role: "screen", system: "s", input: "i", schema: Out, effort: "medium" }));
    } finally {
      globalThis.fetch = real;
    }
    const { headers, body } = api.requests[0]!;
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.deepEqual(body.provider, { require_parameters: true }, "only providers that support structured outputs");
    assert.equal(headers["x-title"], "job-scout");
  } finally {
    api.close();
  }
});

test("an unknown provider is refused", async () => {
  await assert.rejects(withEnv({ JOB_SCOUT_PROVIDER: "gemini", JOB_SCOUT_MODEL: "m" }, () => structured({ role: "screen", system: "s", input: "i", schema: Out })), /must be "bedrock" or "openai"/);
});
