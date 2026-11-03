import type { ReactNode } from 'react';

/**
 * Just enough Markdown for content/what-to-do.md: paragraphs, "- " lists,
 * **bold** and [links](https://...). It builds React elements, never HTML, so
 * nothing in the file can inject markup. A line starting "TODO:" is a note to
 * the editor and is never shown.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
    else out.push(<a key={`${key}-${i++}`} href={m[3]}>{m[2]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(src: string): ReactNode {
  const blocks = src
    .split(/\n\s*\n/)
    .map((b) => b.split('\n').filter((l) => !/^\s*TODO:/.test(l)))
    .filter((lines) => lines.some((l) => l.trim()));
  return blocks.map((lines, n) => {
    if (lines.every((l) => /^\s*- /.test(l))) {
      return (
        <ul key={n}>
          {lines.map((l, j) => (
            <li key={j}>{inline(l.replace(/^\s*- /, ''), `${n}-${j}`)}</li>
          ))}
        </ul>
      );
    }
    return <p key={n}>{inline(lines.join(' '), String(n))}</p>;
  });
}
