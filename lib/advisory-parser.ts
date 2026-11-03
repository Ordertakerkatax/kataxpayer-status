/**
 * Reads a BIR system advisory's text (spec §8 step 4). Pure, and free of
 * imports, so `node --test` runs it straight from the .ts file.
 *
 * The PDFs are a form, but the extracted text does not keep its layout: a value
 * can come before its label ("…5:00 PMStart Date / Time"), the closing lines can
 * come before the fields, and a "duplicate copy" can repeat the whole advisory.
 * So fields are read between the labels that do survive in order (SYSTEM/S
 * AFFECTED, REASON, PERIOD COVERED, DATE APPLICATION), and dates are found by
 * pattern after the label that governs them. tests/fixtures holds real text.
 */

export type Audience = 'external' | 'internal' | 'unknown';
export type Kind = 'unavailable' | 'restored' | 'extension' | 'other';

export type ParsedAdvisory = {
  referenceNo: string | null;
  issuedOn: string | null; // yyyy-mm-dd
  audience: Audience;
  kind: Kind | null;
  systems: string[];
  /** For 'restored', when the BIR says the system came back. */
  startsAt: string | null;
  endsAt: string | null;
  /** For 'restored', the outage advisory it closes. */
  citedReferenceNo: string | null;
  /** Before linking: the sync route lowers this when a cited outage is not stored. */
  confidence: 'high' | 'low';
  /** Why confidence is low, for the admin. */
  notes: string[];
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH = `(${MONTHS.join('|')})`;
const REF = /\b\d{6}-\d{4}-[A-Z]{2}\b/g;

/**
 * "October 29, 2026 (Thursday) 5:00 pm", "(Friday) - 5:00 PM", "(Tuesday)/5:00 PM",
 * "03:40PM". No word boundary after the M: extraction glues the next label on
 * ("5:00 PMStart Date / Time").
 */
const DATE_TIME = new RegExp(
  `${MONTH}\\s+(\\d{1,2}),\\s*(\\d{4})\\s*(?:\\([A-Za-z]+\\))?\\s*[-–—/]?\\s*(\\d{1,2}):(\\d{2})\\s*([AP])\\.?\\s*M\\.?`,
  'gi',
);
const DATE_ONLY = new RegExp(`${MONTH}\\s+(\\d{1,2}),\\s*(\\d{4})`, 'i');

/** Manila is UTC+8 all year, so a Manila wall time is a fixed offset from UTC. */
function manilaToIso(y: number, mo: number, d: number, h: number, mi: number): string {
  return new Date(Date.UTC(y, mo, d, h - 8, mi)).toISOString();
}

function dateTimesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DATE_TIME)) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    let h = Number(m[4]);
    const mi = Number(m[5]);
    if (h < 1 || h > 12 || mi > 59) continue;
    const pm = m[6].toUpperCase() === 'P';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    out.push(manilaToIso(Number(m[3]), mo, Number(m[2]), h, mi));
  }
  return out;
}

/** The text after `label` up to the first of `until`, or null when the label is absent. */
function field(text: string, label: RegExp, until: RegExp): string | null {
  const start = text.search(label);
  if (start < 0) return null;
  const rest = text.slice(start).replace(label, '');
  const end = rest.search(until);
  return (end < 0 ? rest : rest.slice(0, end)).replace(/\s+/g, ' ').trim();
}

const SYSTEMS_LABEL = /SYSTEMS?(?:\/S)?\s+AFFECTED/i;
const AFTER_SYSTEMS = /SITE\/?S?\s+AFFECTED|\bREASON\b|PERIOD COVERED/i;
const REASON_LABEL = /\bREASON\b/;
const AFTER_REASON = /PERIOD COVERED|DATE APPLICATION|Start Date|End Date|Kindly disseminate|\bTO\b\s/;
const TO_LABEL = /(?:^|\n)\s*TO\b/;
const AFTER_TO = /SYSTEMS?(?:\/S)?\s+AFFECTED|\n/i;

function audienceOf(to: string | null): Audience {
  if (!to) return 'unknown';
  const t = to.toLowerCase();
  // Spec §8: "External users" is external. Decided defaults (docs/bir-source.md):
  // "All Users" and "Taxpayers" reach the public too, so they count as external.
  if (/\bexternal\b|\btaxpayers?\b|\ball users\b/.test(t)) return 'external';
  if (/\binternal\b|\bbir users\b/.test(t)) return 'internal';
  return 'unknown';
}

function systemsOf(text: string): { systems: string[]; broad: boolean } {
  const s = new Set<string>();
  if (/electronic filing and payment system|\befps\b/i.test(text)) s.add('efps');
  if (/electronic bir forms|\bebirforms\b/i.test(text)) s.add('ebirforms');
  // "All BIR Systems" covers both, but it is a reading, so it is never high confidence.
  const broad = /\ball bir systems\b/i.test(text);
  if (broad) {
    s.add('efps');
    s.add('ebirforms');
  }
  return { systems: [...s].sort(), broad };
}

export function parseAdvisory(raw: string): ParsedAdvisory {
  const text = raw.replace(/\r/g, '');
  const notes: string[] = [];

  if (text.replace(/\s/g, '').length < 40) {
    return {
      referenceNo: null, issuedOn: null, audience: 'unknown', kind: null, systems: [],
      startsAt: null, endsAt: null, citedReferenceNo: null, confidence: 'low',
      notes: ['No text layer: probably a scan. Read the PDF and fill the fields by hand.'],
    };
  }

  const referenceNo = text.match(/REFERENCE NO\.?:?\s*(\d{6}-\d{4}-[A-Z]{2})/)?.[1] ?? text.match(REF)?.[0] ?? null;

  const dateLine = text.match(new RegExp(`\\bDATE\\s+${MONTH}\\s+(\\d{1,2}),\\s*(\\d{4})`, 'i'));
  const issuedOn = dateLine
    ? `${dateLine[3]}-${String(MONTHS.indexOf(dateLine[1].toLowerCase()) + 1).padStart(2, '0')}-${dateLine[2].padStart(2, '0')}`
    : null;

  const audience = audienceOf(field(text, TO_LABEL, AFTER_TO));

  const systemsField = field(text, SYSTEMS_LABEL, AFTER_SYSTEMS);
  const { systems, broad } = systemsOf(systemsField ?? text);
  if (!systemsField) notes.push('No "System/s affected" field; systems were read from the whole text.');
  if (broad) notes.push('Says "All BIR Systems"; eFPS and eBIRForms were assumed.');

  const reason = field(text, REASON_LABEL, AFTER_REASON) ?? '';
  const cited =
    [...reason.matchAll(REF)].map((m) => m[0]).find((r) => r !== referenceNo) ??
    null;

  const upLabel = /ARE\s+UP\s*\/?\s*AVAILABLE/i.test(text) || /DATE APPLICATION/i.test(text);
  const nowAvailable = /\bnow\s+available\b|\bavailable\s*(?:and|\/)\s*accessible\b|\bcompleted\b/i.test(reason);
  const goingDown = /will not be available|\bunavailable\b|\binaccessible\b/i.test(reason || text);

  // Spec §8: read the text, never the reference suffix alone.
  let kind: Kind | null = null;
  if ((nowAvailable || upLabel) && cited && !goingDown) kind = 'restored';
  else if (goingDown) kind = 'unavailable';
  else if (/\bextend/i.test(text) && /\bdeadline/i.test(text)) kind = 'extension';
  else if (nowAvailable || upLabel) {
    kind = 'restored';
    notes.push('Reads as a restoration but cites no earlier advisory number.');
  }

  let startsAt: string | null = null;
  let endsAt: string | null = null;
  if (kind === 'restored') {
    const at = text.search(/DATE APPLICATION/i);
    startsAt = dateTimesIn(at >= 0 ? text.slice(at) : text)[0] ?? null;
  } else {
    const at = text.search(/PERIOD COVERED/i);
    // The first two after the label are start and end; a duplicate copy below repeats them.
    const found = dateTimesIn(at >= 0 ? text.slice(at) : text);
    startsAt = found[0] ?? null;
    endsAt = found[1] ?? null;
    if (startsAt && endsAt && endsAt <= startsAt) {
      notes.push('The end time is not after the start time.');
      endsAt = null;
    }
  }

  if (!kind) notes.push('Could not tell whether this is an outage, a restoration or an extension.');
  if (!systems.length) notes.push('Names neither eFPS nor eBIRForms.');
  if (!startsAt) notes.push(DATE_ONLY.test(text) ? 'A date was found but no time with it.' : 'No date and time found.');

  const confidence =
    kind && systems.length && startsAt && !broad && (kind !== 'restored' || cited) ? 'high' : 'low';

  return {
    referenceNo,
    issuedOn,
    audience,
    kind,
    systems,
    startsAt,
    endsAt,
    citedReferenceNo: kind === 'restored' ? cited : null,
    confidence,
    notes,
  };
}

/** Spec §8 step 2: which list items are worth fetching at all. */
export function isRelevantTitle(title: string): boolean {
  return /\b(?:un)?availability\b|\befps\b|\bebirforms\b|\beservices\b|electronic filing and payment|electronic bir forms/i.test(
    title,
  );
}
