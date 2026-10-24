// The few HTTP helpers the API's route files share.
import type { IncomingMessage, ServerResponse } from "node:http";

export type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, query: URLSearchParams) => Promise<void> | void;
export type Route = [string, RegExp, Handler];

export const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export const readBody = async (req: IncomingMessage, max = 10_000): Promise<unknown> => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > max) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
};
