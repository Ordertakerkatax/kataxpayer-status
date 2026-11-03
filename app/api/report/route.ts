import { cookies } from 'next/headers';
import { getBoard } from '@/lib/board';
import { db } from '@/lib/db';
import { DEVICE_COOKIE, clientIp, deviceHash, ipHash, isDeviceId, newDeviceId } from '@/lib/identity';
import { reportSchema } from '@/lib/report-schema';
import { verifyTurnstile } from '@/lib/turnstile';

export const dynamic = 'force-dynamic';

const FOUR_HUNDRED_DAYS = 400 * 24 * 60 * 60;

const reply = (status: number, body: object) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/report, spec §6, in the spec's order. Nothing it returns carries a
 * hash or the cookie's value.
 */
export async function POST(request: Request) {
  // 1. The body, against the catalogues.
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return reply(400, { ok: false, error: 'That report could not be read.' });
  }
  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) {
    return reply(400, { ok: false, error: 'Something in that report was not recognised.' });
  }
  const r = parsed.data;

  // 2. Turnstile.
  const ip = clientIp(request.headers);
  const human = await verifyTurnstile(r.turnstile_token, ip);
  if (human === 'fail') {
    return reply(403, { ok: false, error: 'We could not confirm the report came from a person. Please try again.' });
  }
  if (human === 'unavailable') {
    return reply(503, { ok: false, error: 'The spam check is not answering. Please try again in a minute.' });
  }

  // 3. The device cookie: host-only (no Domain), so it stays on this subdomain.
  const jar = await cookies();
  let deviceId = jar.get(DEVICE_COOKIE)?.value;
  if (!isDeviceId(deviceId)) {
    deviceId = newDeviceId();
    jar.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: FOUR_HUNDRED_DAYS,
    });
  }

  // 4 to 6. Hashes, then the rate limit and the insert in one transaction.
  let result: string;
  try {
    const res = await db().rpc('submit_report', {
      p_system_key: r.system_key,
      p_outcome: r.outcome,
      p_failure_type: r.outcome === 'fail' ? r.failure_type : null,
      p_form_code: r.form_code ?? null,
      p_device_hash: deviceHash(deviceId),
      p_ip_hash: ipHash(ip),
    });
    if (res.error) throw new Error(res.error.message);
    result = res.data as string;
  } catch (err) {
    console.error('report failed', err);
    return reply(500, { ok: false, error: 'Your report could not be saved. Please try again.' });
  }

  if (result !== 'ok') {
    const { data } = await db().from('settings').select('value').eq('key', 'cooldown_minutes').single();
    const minutes = Number(data?.value ?? 15);
    return reply(429, {
      ok: false,
      error:
        result === 'device_cooldown'
          ? `You already reported in the last ${minutes} minutes. Thanks!`
          : `Too many reports from your network in the last ${minutes} minutes. Please try again later.`,
    });
  }

  // 7. The fresh status for that system. The report is in either way, so a
  // failure to read it back is not the reader's problem.
  try {
    const board = await getBoard(r.system_key);
    return reply(200, { ok: true, status: board.systems[0] ?? null, generatedAt: board.generatedAt });
  } catch (err) {
    console.error('status after report failed', err);
    return reply(200, { ok: true, status: null });
  }
}
