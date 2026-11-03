import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Board } from '@/components/board';
import { getBoard } from '@/lib/board';
import { renderMarkdown } from '@/lib/markdown';

// The board is the current state of the world or it is wrong.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const [board, whatToDo] = await Promise.all([
    getBoard(),
    readFile(path.join(process.cwd(), 'content', 'what-to-do.md'), 'utf8'),
  ]);
  return <Board initial={board} whatToDo={renderMarkdown(whatToDo)} />;
}
