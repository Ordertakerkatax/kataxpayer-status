/**
 * Facts the pages state, kept in one place. Where a fact is not known yet the
 * value is null and the page leaves it out rather than guessing.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://status.kataxpayer.com';

export const MAIN_SITE_URL = 'https://kataxpayer.com';

/** The BIR page readers are sent to for the official word. */
export const BIR_URL = 'https://www.bir.gov.ph';

/** Every page carries this, word for word (spec §7). */
export const DISCLAIMER =
  'Community-reported and unofficial. This is not a BIR advisory and does not by itself excuse late filing.';

export const MANILA_TZ = 'Asia/Manila';

export const NAV_LINKS = [
  { href: '/', label: 'Board' },
  { href: '/history', label: 'History' },
  { href: '/advisories', label: 'Advisories' },
  { href: '/about', label: 'About' },
] as const;

/**
 * Where privacy questions go, under the Data Privacy Act. Not decided yet:
 * while it is null the about page sends readers to kataxpayer.com instead of
 * printing a guessed address. Emel to fill in.
 */
export const PRIVACY_EMAIL: string | null = null;
