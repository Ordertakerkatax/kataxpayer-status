/**
 * The pick lists from spec §3. The systems also live in the `systems` table so
 * eAFS or ORUS can be added without code; this copy is the v1 seed and the
 * fallback for pages that render before the database answers.
 */
export const SYSTEMS = [
  { key: 'efps', label: 'eFPS' },
  { key: 'ebirforms', label: 'eBIRForms' },
] as const;

export type SystemKey = (typeof SYSTEMS)[number]['key'];

export const FORM_CODES = [
  '1601-C', '0619-E', '0619-F', '1601-EQ', '1601-FQ', '1604-C', '1604-E', '1604-F',
  '2550Q', '2551Q', '1701Q', '1701', '1701A', '1702Q', '1702-RT', '1702-EX', '1702-MX',
  '2000', '2000-OT', '1606', '1707', '0605', 'Other',
] as const;

export const FAILURE_TYPES = [
  { key: 'site_unreachable', label: "Site won't load or times out", systems: ['efps', 'ebirforms'] },
  { key: 'login_failed', label: "Can't log in", systems: ['efps'] },
  { key: 'form_wont_open', label: "Return won't open or validate", systems: ['efps', 'ebirforms'] },
  { key: 'submit_failed', label: 'Submit fails or hangs', systems: ['efps', 'ebirforms'] },
  { key: 'no_confirmation', label: 'Submitted, but no confirmation or email', systems: ['efps', 'ebirforms'] },
  { key: 'payment_failed', label: 'Payment step fails', systems: ['efps'] },
  { key: 'package_error', label: "Offline package won't install or open", systems: ['ebirforms'] },
  { key: 'other', label: 'Something else', systems: ['efps', 'ebirforms'] },
] as const;
