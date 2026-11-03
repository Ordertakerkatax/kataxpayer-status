import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { renderMarkdown } from '@/lib/markdown';
import { BIR_URL, DISCLAIMER, MAIN_SITE_URL, PRIVACY_EMAIL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'About',
  description: 'What the BIR Filing Status Board is, how it decides whether eFPS or eBIRForms is working, and what it keeps.',
  alternates: { canonical: '/about' },
};

/** The thresholds as the status function reads them, so this page cannot drift from the board. */
async function thresholds() {
  const { data } = await db().from('settings').select('key, value');
  const v = (k: string, fallback: number) => Number(data?.find((r) => r.key === k)?.value ?? fallback);
  return {
    window: v('window_minutes', 60),
    min: v('min_reports', 3),
    downFails: v('down_min_fails', 5),
    downRatio: v('down_ratio', 0.6),
    issueFails: v('issues_min_fails', 3),
    issueRatio: v('issues_ratio', 0.3),
    cooldown: v('cooldown_minutes', 15),
  };
}

const percent = (r: number) => `${Math.round(r * 100)}%`;

/** /about (spec §11): what this is, how the status is worked out, privacy, contact. */
export default async function About() {
  const [t, privacy] = await Promise.all([
    thresholds(),
    readFile(path.join(process.cwd(), 'content', 'privacy.md'), 'utf8'),
  ]);

  return (
    <div className="flex flex-col gap-10 max-w-2xl">
      <section className="flex flex-col gap-3" aria-labelledby="what">
        <h1 id="what" className="text-3xl sm:text-4xl">
          About this board
        </h1>
        <p>
          On a deadline night it is hard to tell whether eFPS or eBIRForms is down for everyone or only for you. This
          board answers &ldquo;Can I file right now?&rdquo; from two sources: what other filers report in the last hour,
          and the BIR&apos;s own advisories about system outages.
        </p>
        <p>
          It is free. {DISCLAIMER} For the BIR&apos;s own word, see <a href={BIR_URL}>bir.gov.ph</a>.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="how">
        <h2 id="how" className="text-2xl">
          How the status is worked out
        </h2>
        <p>
          <strong>A BIR advisory comes first.</strong> When the BIR posts that a system is unavailable to the public, the
          board says so and links the advisory, whatever filers report, until its stated end or until the BIR says the
          system is back. Advisories are read automatically from bir.gov.ph and shown only after a person has checked
          each one against the BIR&apos;s PDF.
        </p>
        <p>Otherwise the board counts filers&apos; reports from the last {t.window} minutes:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>
            <strong>Not enough reports</strong> when there are fewer than {t.min}. The card then shows the last state it
            knew and when.
          </li>
          <li>
            <strong>Likely down</strong> when at least {t.downFails} failed and they are at least{' '}
            {percent(t.downRatio)} of all reports.
          </li>
          <li>
            <strong>Having problems</strong> when at least {t.issueFails} failed and they are at least{' '}
            {percent(t.issueRatio)} of all reports.
          </li>
          <li>
            <strong>Working</strong> otherwise.
          </li>
        </ul>
        <p>
          Each browser can report once per system every {t.cooldown} minutes, and each network a limited number of times,
          so one person cannot tip the board. The same rules decide every five-minute snapshot that the{' '}
          <Link href="/history">history page</Link> is built from.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="privacy" id="privacy">
        <h2 id="privacy-heading" className="text-2xl">
          Privacy
        </h2>
        <div className="prose-block">{renderMarkdown(privacy)}</div>
        <p>
          Questions about your data:{' '}
          {PRIVACY_EMAIL ? (
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
          ) : (
            <>
              contact KaTaxpayer through <a href={MAIN_SITE_URL}>kataxpayer.com</a>
            </>
          )}
          .
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="who">
        <h2 id="who" className="text-2xl">
          Who runs it
        </h2>
        <p>
          The board is a free service from <a href={MAIN_SITE_URL}>KaTaxpayer</a>. It is not affiliated with, endorsed
          by or run for the Bureau of Internal Revenue.
        </p>
      </section>
    </div>
  );
}
