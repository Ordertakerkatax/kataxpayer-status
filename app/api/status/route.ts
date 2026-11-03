import { getBoard } from '@/lib/board';

export const dynamic = 'force-dynamic';

/**
 * GET /api/status, polled by the board every 30 seconds (spec §7). The edge
 * keeps a copy for 15 seconds, so a deadline-night crowd costs the database
 * four reads a minute, not one per reader. Browsers keep nothing.
 */
export async function GET() {
  try {
    const board = await getBoard();
    return Response.json(board, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15' },
    });
  } catch (err) {
    console.error('status failed', err);
    return Response.json({ error: 'The board could not be read just now.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
