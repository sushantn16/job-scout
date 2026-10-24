import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cvProblems, cvRoutes } from "../src/server/cv.ts";
import { Cv } from "../src/cv/schema.ts";

const example = () => Cv.parse(JSON.parse(readFileSync("config/cv-master.example.json", "utf8")));

/** Calls a route with a JSON body and returns its status and parsed body. */
async function call(routes: ReturnType<typeof cvRoutes>, method: string, path: string, body?: unknown) {
  const route = routes.find(([m, re]) => m === method && re.test(path));
  assert.ok(route, `${method} ${path}`);
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as unknown as IncomingMessage;
  let status = 0;
  let out = "";
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => (out = b) } as unknown as ServerResponse;
  await route[2](req, res, {}, new URLSearchParams());
  return { status, body: JSON.parse(out) as Record<string, unknown> };
}

test("the CV page loads, previews and saves the master CV, keeping the version it replaces", async () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-cv-"));
  try {
    const path = join(dir, "cv-master.json");
    const routes = cvRoutes(path);
    assert.equal((await call(routes, "GET", "/api/cv")).status, 404, "no CV yet");
    writeFileSync(path, JSON.stringify(example()));

    const { cv } = (await call(routes, "GET", "/api/cv")).body as { cv: Cv };
    const preview = await call(routes, "POST", "/api/cv/preview", { cv: { ...cv, profile: "Draft profile" } });
    assert.equal(preview.status, 200);
    assert.match(String(preview.body.html), /Draft profile/);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).profile, cv.profile, "a preview doesn't save");

    assert.equal((await call(routes, "POST", "/api/cv", { cv: { ...cv, profile: "New profile" } })).status, 200);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).profile, "New profile");
    assert.equal(JSON.parse(readFileSync(join(dir, "cv-master.prev.json"), "utf8")).profile, cv.profile, "the old version is kept");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a CV that fails the schema or reuses an ID isn't saved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-cv-"));
  try {
    const path = join(dir, "cv-master.json");
    const cv = example();
    writeFileSync(path, JSON.stringify(cv));
    const routes = cvRoutes(path);

    const noBullets = await call(routes, "POST", "/api/cv", { cv: { ...cv, experience: [{ ...cv.experience[0]!, bullets: [] }] } });
    assert.equal(noBullets.status, 400);
    assert.match(String(noBullets.body.error), /experience\.0\.bullets/);

    const role = cv.experience[0]!;
    const twice = { ...cv, experience: [{ ...role, bullets: [...role.bullets, { id: role.bullets[0]!.id, text: "Another" }] }, ...cv.experience.slice(1)] };
    assert.deepEqual(cvProblems(twice), [`the ID "${role.bullets[0]!.id}" is used more than once`]);
    assert.equal((await call(routes, "POST", "/api/cv", { cv: twice })).status, 400);
    assert.equal(existsSync(join(dir, "cv-master.prev.json")), false, "nothing was written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the preview embeds a photo only from the CV's own folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "job-scout-cv-"));
  try {
    const path = join(dir, "private", "cv-master.json");
    const routes = cvRoutes(path);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "private"));
    writeFileSync(join(dir, "private", "photo.jpg"), "fake-jpeg");
    writeFileSync(join(dir, "secret.txt"), "not for the page");
    const cv = example();
    const html = async (photo: string) => String((await call(routes, "POST", "/api/cv/preview", { cv: { ...cv, basics: { ...cv.basics, photo } } })).body.html);
    assert.match(await html("photo.jpg"), /data:image\/jpeg;base64,/);
    assert.doesNotMatch(await html("../secret.txt"), /data:image/, "outside the folder");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
