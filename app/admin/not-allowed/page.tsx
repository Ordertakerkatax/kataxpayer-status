import Link from 'next/link';
import { signOut } from '../actions';

export const dynamic = 'force-dynamic';

/** Spec §9: anyone but ADMIN_EMAIL gets a plain "not allowed". */
export default function NotAllowed() {
  return (
    <div className="max-w-xl flex flex-col gap-4">
      <h1 className="text-3xl">Not allowed</h1>
      <p>This page is for the board&apos;s administrator only.</p>
      <p>
        <Link href="/">Back to the board</Link>
      </p>
      <form action={signOut}>
        <button type="submit" className="btn-quiet">
          Sign out
        </button>
      </form>
    </div>
  );
}
