const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with a timeout; retries 429 and 5xx with linear backoff. 404 and other 4xx fail immediately. */
export async function getText(url: string, { tries = 3, timeoutMs = 25_000, backoffMs = 5_000 } = {}): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= tries) throw new HttpError(res.status, url);
    } catch (e) {
      if (e instanceof HttpError || attempt >= tries) throw e;
    }
    await sleep(backoffMs * attempt);
  }
}

export const getJson = async <T>(url: string, opts?: Parameters<typeof getText>[1]): Promise<T> =>
  JSON.parse(await getText(url, opts)) as T;

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
