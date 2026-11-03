// The advisory parser against real BIR advisory text (spec §8, "Parser tests").
//
//   node --test tests/
//
// Fixtures are the text unpdf extracts from the real PDFs, which is what the
// sync route sees; the layout-* pair is pdftotext's view of two of them, kept
// so the parser does not come to depend on one extractor's ordering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRelevantTitle, parseAdvisory } from '../lib/advisory-parser.ts';
import { pdfText } from '../lib/advisory-pdf.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('an outage with start and end times: eFPS and eBIRForms, 202509-0037-SU', () => {
  const a = parseAdvisory(fixture('202509-0037-SU-efps-ebirforms-unavailable.txt'));
  assert.equal(a.referenceNo, '202509-0037-SU');
  assert.equal(a.issuedOn, '2025-09-23');
  assert.equal(a.audience, 'external'); // "All External and Internal users"
  assert.equal(a.kind, 'unavailable');
  assert.deepEqual(a.systems, ['ebirforms', 'efps']);
  assert.equal(a.startsAt, '2025-09-26T09:00:00.000Z'); // 5:00 PM Manila
  assert.equal(a.endsAt, '2025-09-28T15:00:00.000Z'); // 11:00 PM Manila
  assert.equal(a.citedReferenceNo, null);
  assert.equal(a.confidence, 'high');
});

test('a restoration that cites the outage it closes: eFPS, 202610-0031-SA', () => {
  const a = parseAdvisory(fixture('202610-0031-SA-efps-restored.txt'));
  assert.equal(a.referenceNo, '202610-0031-SA');
  assert.equal(a.issuedOn, '2026-10-28');
  assert.equal(a.audience, 'external'); // "All Users", the decided default
  assert.equal(a.kind, 'restored');
  assert.deepEqual(a.systems, ['efps']);
  assert.equal(a.citedReferenceNo, '202610-0031-SU');
  assert.equal(a.startsAt, '2026-10-27T14:00:00.000Z'); // came back 10:00 PM Manila
  assert.equal(a.endsAt, null);
  assert.equal(a.confidence, 'high');
});

test('an internal-users advisory: BIR website, 202610-0033-SA', () => {
  const a = parseAdvisory(fixture('202610-0033-SA-website-bir-users.txt'));
  assert.equal(a.audience, 'internal'); // "BIR Users"
  assert.equal(a.kind, 'restored');
  assert.equal(a.citedReferenceNo, '202610-0033-SU');
  assert.equal(a.startsAt, '2026-10-28T19:19:00.000Z'); // "(Thursday) – 3:19 AM"
  assert.deepEqual(a.systems, []);
  assert.equal(a.confidence, 'low');
});

test('a scan with no text layer is low confidence with empty fields', async () => {
  const text = await pdfText(new Uint8Array(readFileSync(new URL('./fixtures/scan-no-text-layer.pdf', import.meta.url))));
  assert.equal(text.trim(), '');
  const a = parseAdvisory(text);
  assert.equal(a.confidence, 'low');
  assert.equal(a.kind, null);
  assert.deepEqual(a.systems, []);
  assert.equal(a.startsAt, null);
  assert.match(a.notes[0], /scan/);
});

test('an outage for a system we do not track: low, but dates still read', () => {
  const a = parseAdvisory(fixture('202610-0034-SU-cor-qr-unavailable.txt'));
  assert.equal(a.kind, 'unavailable');
  assert.equal(a.audience, 'external'); // "All Internal and External users"
  assert.deepEqual(a.systems, []);
  assert.equal(a.startsAt, '2026-10-29T09:00:00.000Z'); // lower-case "pm"
  assert.equal(a.endsAt, '2026-11-02T09:00:00.000Z');
  assert.equal(a.confidence, 'low');
});

test('a duplicate copy and a label after its value: eCAR, 202610-0032-SU', () => {
  const a = parseAdvisory(fixture('202610-0032-SU-ecar-duplicate-copy.txt'));
  assert.equal(a.referenceNo, '202610-0032-SU');
  assert.equal(a.audience, 'external'); // "Taxpayers and BIR Users"
  assert.equal(a.kind, 'unavailable');
  assert.equal(a.startsAt, '2026-10-27T09:00:00.000Z'); // "(Tuesday)/5:00 PMStart Date / Time"
  assert.equal(a.endsAt, '2026-10-30T15:59:00.000Z'); // 11:59 PM
});

test('"All BIR Systems" restored: both systems assumed, never high', () => {
  const a = parseAdvisory(fixture('202609-0028-SA-all-bir-systems-restored.txt'));
  assert.equal(a.kind, 'restored');
  // The cited number is the one in REASON, not the exceptions listed under systems.
  assert.equal(a.citedReferenceNo, '202609-0028-SU');
  assert.deepEqual(a.systems, ['ebirforms', 'efps']);
  assert.equal(a.startsAt, '2026-09-19T07:40:00.000Z'); // "03:40PM", no space
  assert.equal(a.confidence, 'low');
});

test('pdftotext layout reads the same as unpdf', () => {
  const r = parseAdvisory(fixture('layout-202610-0031-SA-efps-restored.txt'));
  assert.equal(r.kind, 'restored');
  assert.equal(r.citedReferenceNo, '202610-0031-SU');
  assert.equal(r.startsAt, '2026-10-27T14:00:00.000Z');
  assert.deepEqual(r.systems, ['efps']);
  const o = parseAdvisory(fixture('layout-202610-0034-SU-cor-qr-unavailable.txt'));
  assert.equal(o.kind, 'unavailable');
  assert.equal(o.startsAt, '2026-10-29T09:00:00.000Z');
  assert.equal(o.endsAt, '2026-11-02T09:00:00.000Z');
});

test('the kind comes from the text, not the reference suffix', () => {
  // An "-SA" number on an outage notice is still an outage.
  const a = parseAdvisory(
    'REFERENCE NO: 202611-0040-SA\nDATE November 3, 2026\nTO All Users\nSYSTEM/S AFFECTED eFPS\nREASON eFPS will be unavailable due to maintenance.\nPERIOD COVERED\nStart Date / Time November 4, 2026 (Wednesday) 12:00 AM\nEnd Date / Time November 4, 2026 (Wednesday) 12:00 PM',
  );
  assert.equal(a.kind, 'unavailable');
  assert.equal(a.startsAt, '2026-11-03T16:00:00.000Z'); // 12:00 AM is midnight
  assert.equal(a.endsAt, '2026-11-04T04:00:00.000Z'); // 12:00 PM is noon
});

test('which list titles are fetched', () => {
  assert.ok(isRelevantTitle('Advisory on Availability/Accessibility of the Electronic Filing and Payment System (eFPS).'));
  assert.ok(isRelevantTitle('Advisory on Unavailability/Inaccessibility of COR QR Code Verifier.'));
  assert.ok(isRelevantTitle('eBIRForms package update'));
  assert.ok(!isRelevantTitle('Public Advisory: The Registered Business Enterprises Taxpayer Service (RBETS) will be temporarily relocated'));
  assert.ok(!isRelevantTitle('Tax Advisory: The BIR invites interested entities ... as Electronic Invoicing Service Providers'));
});
