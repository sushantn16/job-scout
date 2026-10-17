import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/llm/clamp.ts";

test("clamp trims strings and arrays per spec, recursively", () => {
  const v = { a: "abcdefghij", list: ["x".repeat(20), "ok", "three"], nested: { s: "hello world" }, untouched: "long text here" };
  const out = clamp(v, { a: 5, list: [2, 10], nested: { s: 5 } });
  assert.deepEqual(out, { a: "abcd…", list: ["xxxxxxxxx…", "ok"], nested: { s: "hell…" }, untouched: "long text here" });
});

test("clamp leaves short values and nulls alone", () => {
  assert.deepEqual(clamp({ a: "hi", b: null }, { a: 5, b: 5 }), { a: "hi", b: null });
});
