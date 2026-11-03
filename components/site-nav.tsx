'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_LINKS } from '@/lib/site';

/** A client component for one reason: only the route knows which link is the current page. */
export function SiteNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {NAV_LINKS.map((l) => {
        const current = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={current ? 'page' : undefined}
            className="text-ink-inverse underline-offset-4 hover:underline aria-[current=page]:underline aria-[current=page]:font-bold"
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
