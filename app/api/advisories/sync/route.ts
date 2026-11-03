import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pdfText } from '@/lib/advisory-pdf';
import { isRelevantTitle, parseAdvisory } from '@/lib/advisory-parser';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** New PDFs fetched per run. The rest wait for the next run, 30 minutes on. */
const MAX_NEW = 15;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_RAW_TEXT = 50_000;

const bodySchema = z.strictObject({
  items: z
    .array(z.strictObject({ title: z.string().trim().min(1).max(1000), url: z.string().max(2000) }))
    .max(300),
});

const reply = (status: number, body: object) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Unset is not "open": a missing secret refuses everyone.
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Only the BIR's own hosts, over https. The list comes from the GitHub Action,
 * but this route fetches whatever it is handed, so it must not be a way to make
 * our server request an arbitrary address.
 */
function birPdfUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'bir.gov.ph' && !u.hostname.endsWith('.bir.gov.ph')) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { 'User-Agent': process.env.BIR_USER_AGENT ?? 'KaTaxpayerStatusBot/1.0 (+https://status.kataxpayer.com/about)' },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_PDF_BYTES) throw new Error('too large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('too large');
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('not a PDF');
  return bytes;
}

/**
 * POST /api/advisories/sync (spec §8). The GitHub Action reads the BIR home
 * page in a headless browser and posts the "sentence + PDF link" pairs here
 * (docs/bir-source.md); this route does steps 2 to 6. Everything it saves is
 * pending until the admin confirms it.
 */
export async function POST(request: Request) {
  if (!authorised(request)) return reply(401, { error: 'Not allowed.' });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return reply(400, { error: 'Body must be JSON: { items: [{ title, url }] }.' });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return reply(400, { error: 'Body must be { items: [{ title, url }] }.' });

  const items = parsed.data.items;
  const summary = {
    fetched: items.length,
    relevant: 0,
    already_stored: 0,
    new: 0,
    high_confidence: 0,
    low_confidence: 0,
    deferred: 0,
    failed: [] as { url: string; error: string }[],
  };

  // Step 2: keep the system advisories, drop what is already stored.
  const seen = new Set<string>();
  const relevant: { title: string; url: string }[] = [];
  for (const item of items) {
    const url = birPdfUrl(item.url);
    if (!url || seen.has(url) || !isRelevantTitle(item.title)) continue;
    seen.add(url);
    relevant.push({ title: item.title.replace(/\s+/g, ' '), url });
  }
  summary.relevant = relevant.length;
  if (!relevant.length) return reply(200, summary);

  const client = db();
  const stored = await client.from('advisories').select('source_url').in('source_url', relevant.map((r) => r.url));
  if (stored.error) return reply(500, { error: 'Could not read stored advisories.' });
  const have = new Set((stored.data ?? []).map((r) => r.source_url as string));
  const fresh = relevant.filter((r) => !have.has(r.url));
  summary.already_stored = relevant.length - fresh.length;
  summary.deferred = Math.max(0, fresh.length - MAX_NEW);

  // Steps 3 to 5, one PDF at a time: a polite pace for the BIR's server.
  for (const item of fresh.slice(0, MAX_NEW)) {
    let text = '';
    try {
      const bytes = await download(item.url);
      try {
        text = await pdfText(bytes);
      } catch {
        text = ''; // An unreadable PDF is treated like a scan: stored, low, empty.
      }
    } catch (err) {
      summary.failed.push({ url: item.url, error: err instanceof Error ? err.message : 'download failed' });
      continue; // Not stored, so the next run tries again.
    }

    const a = parseAdvisory(text);
    let confidence = a.confidence;
    const notes = [...a.notes];

    // A restoration links to the outage it cites; when that outage was never
    // stored, it is kept anyway and the admin adds the outage by hand.
    let related: number | null = null;
    if (a.kind === 'restored' && a.citedReferenceNo) {
      const { data } = await client
        .from('advisories')
        .select('id')
        .eq('reference_no', a.citedReferenceNo)
        .order('id', { ascending: true })
        .limit(1);
      related = (data?.[0]?.id as number | undefined) ?? null;
      if (!related) {
        confidence = 'low';
        notes.push(`Cites ${a.citedReferenceNo}, which is not stored. Add that outage by hand, then link it.`);
      }
    }

    const { error } = await client.from('advisories').upsert(
      {
        source_url: item.url,
        title: item.title,
        reference_no: a.referenceNo,
        issued_on: a.issuedOn,
        audience: a.audience,
        kind: a.kind,
        systems: a.systems,
        starts_at: a.startsAt,
        ends_at: a.endsAt,
        related_advisory_id: related,
        raw_text: text.trim() ? text.slice(0, MAX_RAW_TEXT) : null,
        parse_confidence: confidence,
        parse_notes: notes,
        review_status: 'pending',
      },
      { onConflict: 'source_url', ignoreDuplicates: true },
    );
    if (error) {
      summary.failed.push({ url: item.url, error: 'could not save' });
      continue;
    }
    summary.new++;
    if (confidence === 'high') summary.high_confidence++;
    else summary.low_confidence++;
  }

  return reply(200, summary);
}
