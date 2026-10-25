// Dashboard server: JSON API plus the built dashboard (dashboard/dist), on 127.0.0.1 only.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { loadConfig } from "../config.ts";
import { Store } from "../db/store.ts";
import { routes } from "./api.ts";

const PORT = Number(process.env.JOB_SCOUT_PORT ?? 8765);
// 127.0.0.1 on the host; a container sets JOB_SCOUT_HOST=0.0.0.0 and publishes the port on the host's 127.0.0.1 only.
const HOST = process.env.JOB_SCOUT_HOST ?? "127.0.0.1";
const REPO = resolve(".");
const DIST = resolve("dashboard/dist");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
// Writes are accepted only from the dashboard itself (and the Vite dev server). Any web page can send requests to
// localhost; requiring this origin plus a JSON body (which needs a CORS preflight we never answer) blocks that.
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, "http://localhost:5173", "http://127.0.0.1:5173"]);

const store = new Store();
const table = routes(store, loadConfig(), REPO);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (req.method !== "GET") {
        const origin = req.headers.origin;
        if (!origin || !ALLOWED_ORIGINS.has(origin) || !String(req.headers["content-type"]).startsWith("application/json")) {
          res.writeHead(403, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "writes are accepted only from the dashboard" }));
        }
      }
      for (const [method, re, handler] of table) {
        const m = req.method === method && url.pathname.match(re);
        if (m) return await handler(req, res, m.groups ?? {}, url.searchParams);
      }
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not found" }));
    }
    // Static files, with index.html as the fallback for client-side routes.
    let file = normalize(join(DIST, url.pathname));
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    if (!existsSync(file)) {
      res.writeHead(503, { "content-type": "text/plain" });
      return res.end("Dashboard not built yet: run `pnpm dashboard:build`.");
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    // Once a response has started (a PDF being sent), a 500 can't be written; writing one would throw and end the server.
    if (res.headersSent) return res.destroy();
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
});

server.listen(PORT, HOST, () => console.log(`job-scout dashboard on http://127.0.0.1:${PORT} (listening on ${HOST})`));
