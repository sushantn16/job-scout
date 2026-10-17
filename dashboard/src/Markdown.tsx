import type { ReactNode } from "react";

// Minimal markdown for application.md: headings, bullets (two levels), quotes, bold, inline code and links.
// Renders React elements only, never HTML strings: the file holds LLM output and quotes from job postings.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={k}>{m[2]}</code>);
    else out.push(<a key={k} href={m[4]} target="_blank" rel="noreferrer">{m[3]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let list: { text: string; sub: string[] }[] = [];
  const flush = (i: number) => {
    if (!list.length) return;
    blocks.push(
      <ul className="m-0 grid list-disc gap-1 pl-[18px]" key={`ul-${i}`}>
        {list.map((li, j) => (
          <li key={j}>
            {inline(li.text, `li-${i}-${j}`)}
            {li.sub.length ? <ul className="m-0 grid list-disc gap-1 pl-[18px]">{li.sub.map((s, k) => <li key={k}>{inline(s, `sub-${i}-${j}-${k}`)}</li>)}</ul> : null}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  source.split("\n").forEach((line, i) => {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const top = line.match(/^- (.*)$/);
    const sub = line.match(/^\s{2,}- (.*)$/);
    const quote = line.match(/^\s*> ?(.*)$/);
    if (sub && list.length) return void list[list.length - 1]!.sub.push(sub[1]!);
    if (top) return void list.push({ text: top[1]!, sub: [] });
    if (quote && list.length) return void list[list.length - 1]!.sub.push(quote[1]!);
    flush(i);
    if (h) blocks.push(h[1]!.length === 1 ? <h2 key={i} className="text-[15px]">{h[2]}</h2> : <h3 key={i} className="mt-3 text-[13px] text-ink-2">{h[2]}</h3>);
    else if (quote) blocks.push(<blockquote key={i} className="my-1 text-ink-2">{inline(quote[1]!, `q-${i}`)}</blockquote>);
    else if (line.trim()) blocks.push(<p key={i} className="m-0">{inline(line, `p-${i}`)}</p>);
  });
  flush(-1);
  return <div className="grid gap-2">{blocks}</div>;
}
