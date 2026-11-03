import 'server-only';

export type TurnstileResult = 'pass' | 'fail' | 'unavailable';

/**
 * Spec §6 step 2. A token Cloudflare rejects is 'fail' (the route answers 403);
 * Cloudflare not answering is 'unavailable' (503), so a reader on a bad night is
 * told to try again rather than that they look like a robot. Neither lets a
 * report through: with no secret configured, nothing passes.
 */
export async function verifyTurnstile(token: string, ip: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return 'unavailable';
  const body = new URLSearchParams({ secret, response: token });
  if (ip !== 'unknown') body.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 'unavailable';
    const json = (await res.json()) as { success?: boolean };
    return json.success === true ? 'pass' : 'fail';
  } catch {
    return 'unavailable';
  }
}
