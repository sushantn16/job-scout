// Top-level comments of the latest "Ask HN: Who is hiring?" thread, via the public Algolia HN API.
import { getJson } from "../http.ts";
import { htmlToText } from "../text.ts";
import { posting, type Posting } from "./types.ts";

interface HnHit { objectID: string; title: string }
interface HnItem { id: number; text?: string | null; created_at?: string; children?: HnItem[] }

export async function hnWhosHiring(): Promise<Posting[]> {
  const { hits } = await getJson<{ hits: HnHit[] }>(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring",
  );
  const story = hits.find((h) => h.title.startsWith("Ask HN: Who is hiring"));
  if (!story) return [];
  const thread = await getJson<HnItem>(`https://hn.algolia.com/api/v1/items/${story.objectID}`, { timeoutMs: 60_000 });
  return (thread.children ?? []).flatMap((c) => {
    const text = htmlToText(c.text ?? "");
    if (!text) return [];
    // Convention: "Company | Role | Location | ..." on the first line.
    const head = text.split("\n")[0] ?? "";
    const parts = head.split("|").map((s) => s.trim());
    return [
      posting({
        source: "hn",
        company: (parts[0] ?? head).slice(0, 60),
        title: parts.length > 1 ? parts.slice(1, 3).join(" | ").slice(0, 140) : head.slice(0, 140),
        location: head,
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        description: text,
        posted: c.created_at ?? "",
      }),
    ];
  });
}
