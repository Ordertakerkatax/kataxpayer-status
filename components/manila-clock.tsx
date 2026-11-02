'use client';

import { useEffect, useState } from 'react';
import { MANILA_TZ } from '@/lib/site';

const fmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: MANILA_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * The current time in Manila, whatever zone the reader's device is in, because
 * every BIR deadline is a Manila deadline. Rendered on the server too; the
 * minute may tick between the two renders, hence suppressHydrationWarning.
 */
export function ManilaClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <time dateTime={now.toISOString()} suppressHydrationWarning>
      {fmt.format(now)} Manila time
    </time>
  );
}
