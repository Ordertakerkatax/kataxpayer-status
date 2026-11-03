import { NextResponse } from 'next/server';
import { userDb } from '@/lib/supabase-user';

export const dynamic = 'force-dynamic';

/** Where the magic link lands: trade the code for a session, then go to /admin. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await userDb();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/admin', url.origin));
    console.error('magic link exchange failed:', error.code ?? error.message);
  }
  return NextResponse.redirect(new URL('/admin?error=link', url.origin));
}
