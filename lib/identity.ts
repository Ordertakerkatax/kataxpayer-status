import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { manilaDay } from './time';

/** The `dev` cookie: a random 128-bit ID, 32 hex characters. */
export const DEVICE_COOKIE = 'dev';
const DEVICE_ID = /^[0-9a-f]{32}$/;

export const newDeviceId = () => randomBytes(16).toString('hex');
export const isDeviceId = (v: string | undefined): v is string => !!v && DEVICE_ID.test(v);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function salt(name: 'DEVICE_SALT' | 'IP_SALT'): string {
  const v = process.env[name];
  // Without a salt the hash of an IP is a lookup away from the IP. Refuse.
  if (!v || v.length < 16) throw new Error(`${name} must be set to a long random string.`);
  return v;
}

/** sha256(device_id || DEVICE_SALT), spec §4. */
export const deviceHash = (deviceId: string) => sha256(deviceId + salt('DEVICE_SALT'));

/**
 * sha256(ip || IP_SALT || yyyy-mm-dd), spec §4. The day is Manila's, so the
 * code changes at midnight where the filers are, not at 8 in the morning.
 */
export const ipHash = (ip: string, at: Date = new Date()) => sha256(ip + salt('IP_SALT') + manilaDay(at));

/** On Vercel, the first entry of x-forwarded-for is the client (spec §6 step 4). */
export function clientIp(headers: Headers): string {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip')?.trim() || 'unknown';
}
