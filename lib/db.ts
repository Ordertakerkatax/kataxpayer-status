import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * The service-role client. Server only: `server-only` fails the build if a
 * client component ever imports this file, so the key cannot reach a bundle.
 *
 * Every request is `no-store`. Next keeps what a patched `fetch` returns in a
 * Data Cache that outlives restarts, and a status board served from that cache
 * would be wrong in exactly the way it exists to prevent.
 */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return client;
}
