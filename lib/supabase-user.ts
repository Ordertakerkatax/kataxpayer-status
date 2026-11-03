import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * A Supabase client acting as whoever is signed in, with the public key. The
 * admin pages read and write through this, not the service role, so the
 * database's own rule (RLS on advisories and settings, is_admin()) is checked
 * on every query as well as the app's ADMIN_EMAIL check.
 */
export async function userDb() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // A server component cannot set cookies; the middleware refreshes them.
        }
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}

export const adminEmail = () => (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();

/** 'admin', 'stranger' (signed in as anyone else) or 'anonymous'. */
export async function whoIsThis() {
  const supabase = await userDb();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase() ?? null;
  const allowed = adminEmail();
  if (!email) return { role: 'anonymous' as const, supabase };
  if (allowed && email === allowed) return { role: 'admin' as const, supabase, email };
  return { role: 'stranger' as const, supabase };
}
