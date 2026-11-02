import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { ManilaClock } from '@/components/manila-clock';
import { DISCLAIMER, MAIN_SITE_URL, NAV_LINKS, SITE_URL } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Can I file right now? · BIR Filing Status Board',
    template: '%s · BIR Filing Status Board',
  },
  description:
    'Is eFPS or eBIRForms down for everyone or just for you? Community reports and BIR advisories. Unofficial.',
  alternates: { canonical: '/' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-PH" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <a href="#content" className="skip-link">
          Skip to content
        </a>

        <header className="bg-surface-brand text-ink-inverse">
          <div className="mx-auto w-full max-w-5xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            {/* On the brand bar the lockup inverts, as on kataxpayer.com: a
                brand circle on a brand bar would be invisible. */}
            <Link
              href="/"
              className="flex items-center gap-3 text-ink-inverse no-underline"
              style={{ ['--logo-bubble' as string]: 'var(--surface-brand)' }}
            >
              <Logo size={36} />
              <span className="font-extrabold text-lg leading-tight">Can I file right now?</span>
            </Link>
            <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-ink-inverse underline-offset-4 hover:underline"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <p className="sm:ml-auto text-sm opacity-90">
              <ManilaClock />
            </p>
          </div>
        </header>

        <div role="note" className="bg-gold text-ink-on-gold">
          <p className="mx-auto max-w-5xl px-4 py-2 text-sm font-semibold">{DISCLAIMER}</p>
        </div>

        <main id="content" className="flex-1 mx-auto w-full max-w-5xl px-4 py-8">
          {children}
        </main>

        <footer className="border-t border-border bg-surface-sunken">
          <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-ink-muted flex flex-col gap-2">
            <p>{DISCLAIMER}</p>
            <p>
              A free service from <a href={MAIN_SITE_URL}>KaTaxpayer</a>. Not affiliated with the
              Bureau of Internal Revenue.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
