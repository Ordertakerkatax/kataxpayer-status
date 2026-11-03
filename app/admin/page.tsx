import { redirect } from 'next/navigation';
import { SYSTEMS } from '@/lib/catalogue';
import { whoIsThis } from '@/lib/supabase-user';
import { manilaDate, manilaWhen, toManilaInput } from '@/lib/time';
import { CONFIRM_PROBLEMS } from '@/lib/admin-review';
import { addAdvisory, confirmAdvisory, rejectAdvisory, saveAdvisory, saveSettings, signIn, signOut } from './actions';

export const dynamic = 'force-dynamic';

type Advisory = {
  id: number;
  source_url: string;
  title: string;
  reference_no: string | null;
  issued_on: string | null;
  audience: 'external' | 'internal' | 'unknown' | null;
  kind: 'unavailable' | 'restored' | 'extension' | 'other' | null;
  systems: string[];
  starts_at: string | null;
  ends_at: string | null;
  related_advisory_id: number | null;
  raw_text: string | null;
  parse_confidence: 'high' | 'low' | null;
  parse_notes: string[];
  review_status: 'pending' | 'confirmed' | 'rejected';
  reviewed_at: string | null;
  created_at: string;
};

type Search = Record<string, string | undefined>;

const ERRORS: Record<string, string> = {
  ...CONFIRM_PROBLEMS,
  link: 'That sign-in link did not work. It may have expired or been used already. Ask for a new one.',
  send: 'The sign-in e-mail could not be sent. Try again in a minute.',
  fields: 'Something in that form was not valid. Reference numbers look like 202610-0031-SU.',
  save: 'That change could not be saved.',
  'self-link': 'An advisory cannot close itself.',
  'add-fields': 'Something in the new advisory was not valid. It needs a title and a full URL.',
  'add-duplicate': 'An advisory with that URL is already stored. Find it below and edit it there.',
  'add-save': 'The new advisory could not be saved.',
  settings: 'The settings could not be saved.',
  'settings-value': 'Settings take whole numbers of zero or more; the two ratios take a number from 0 to 1.',
};

const DONE: Record<string, string> = {
  confirm: 'Confirmed. The board and the history now follow it.',
  reject: 'Rejected. It no longer counts anywhere.',
  save: 'Saved.',
  add: 'Added.',
  settings: 'Settings saved. The board uses them from its next refresh.',
};

const KINDS = [
  ['unavailable', 'Outage (unavailable)'],
  ['restored', 'Restoration (back up)'],
  ['extension', 'Deadline extension'],
  ['other', 'Other'],
] as const;

/** /admin (spec §9): the review queue, a hand-entry form and the settings. */
export default async function Admin({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const who = await whoIsThis();
  if (who.role === 'stranger') redirect('/admin/not-allowed');
  if (who.role === 'anonymous') return <SignIn params={params} />;

  const db = who.supabase;
  const [pendingRes, reviewedRes, outagesRes, settingsRes] = await Promise.all([
    db.from('advisories').select('*').eq('review_status', 'pending').order('created_at', { ascending: false }).order('id', { ascending: false }),
    db.from('advisories').select('*').neq('review_status', 'pending').order('reviewed_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(20),
    db.from('advisories').select('id, reference_no, title, starts_at, review_status').eq('kind', 'unavailable').neq('review_status', 'rejected').order('starts_at', { ascending: false, nullsFirst: false }).limit(100),
    db.from('settings').select('key, value, note').order('key'),
  ]);
  if (pendingRes.error || reviewedRes.error || outagesRes.error || settingsRes.error) {
    // RLS said no: the address matches ADMIN_EMAIL but is not in public.admins.
    return (
      <div className="max-w-2xl flex flex-col gap-4">
        <h1 className="text-3xl">Admin</h1>
        <p>
          You are signed in as {who.email}, but the database does not list that address as an admin. Add it once in
          the Supabase SQL editor: <code>insert into public.admins (email) values (&apos;{who.email}&apos;);</code>
        </p>
      </div>
    );
  }
  const pending = pendingRes.data as Advisory[];
  const reviewed = reviewedRes.data as Advisory[];
  const outages = outagesRes.data as Pick<Advisory, 'id' | 'reference_no' | 'title' | 'starts_at' | 'review_status'>[];
  const settings = settingsRes.data as { key: string; value: number; note: string | null }[];

  const flash = params.error
    ? ERRORS[params.error] ?? 'Something went wrong.'
    : params.done
      ? DONE[params.done]
      : null;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Admin</h1>
          <p className="text-ink-muted text-sm">Signed in as {who.email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="btn-quiet">
            Sign out
          </button>
        </form>
      </div>

      {flash && (
        <p role={params.error ? 'alert' : 'status'} className={params.error ? 'admin-flash is-error' : 'admin-flash'}>
          {flash}
        </p>
      )}

      <section aria-labelledby="pending" className="flex flex-col gap-4">
        <h2 id="pending" className="text-2xl">
          Waiting for review <span className="text-ink-muted font-normal">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="text-ink-muted">Nothing waiting. The watcher adds new BIR advisories here every 30 minutes.</p>
        ) : (
          pending.map((a) => <Editor key={a.id} a={a} outages={outages} />)
        )}
      </section>

      <section aria-labelledby="add" id="add" className="flex flex-col gap-4">
        <h2 id="add-heading" className="text-2xl">
          Add an advisory or RMC by hand
        </h2>
        <p className="text-sm text-ink-muted">
          For notices the watcher misses: an RMC extending a deadline, or an outage that dropped off the BIR&apos;s list
          before it was read. Times are Manila time.
        </p>
        <form action={addAdvisory} className="admin-card flex flex-col gap-4">
          <Fields outages={outages} />
          <label className="admin-field">
            <span>Link to the PDF or page</span>
            <input name="source_url" type="url" required className="field" placeholder="https://bir-cdn.bir.gov.ph/…" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirm_now" defaultChecked /> Confirm now (it counts on the board at once)
          </label>
          <button type="submit" className="btn-primary self-start">
            Add advisory
          </button>
        </form>
      </section>

      <section aria-labelledby="reviewed" className="flex flex-col gap-4">
        <h2 id="reviewed" className="text-2xl">
          Recently reviewed
        </h2>
        <p className="text-sm text-ink-muted">
          Editing a confirmed advisory rewrites the history in its window. Rejecting it takes it off the board.
        </p>
        {reviewed.length === 0 ? (
          <p className="text-ink-muted">None yet.</p>
        ) : (
          reviewed.map((a) => <Editor key={a.id} a={a} outages={outages} />)
        )}
      </section>

      <section aria-labelledby="settings-heading" id="settings" className="flex flex-col gap-4">
        <h2 id="settings-heading" className="text-2xl">
          Settings
        </h2>
        <form action={saveSettings} className="admin-card flex flex-col gap-3">
          {settings.map((s) => (
            <label key={s.key} className="settings-row">
              <span>
                <code>{s.key}</code>
                {s.note && <span className="block text-sm text-ink-muted">{s.note}</span>}
              </span>
              <input
                name={`setting:${s.key}`}
                type="number"
                step={s.key.endsWith('_ratio') ? '0.01' : '1'}
                min="0"
                max={s.key.endsWith('_ratio') ? '1' : undefined}
                defaultValue={Number(s.value)}
                required
                className="field w-28"
              />
            </label>
          ))}
          <button type="submit" className="btn-primary self-start">
            Save settings
          </button>
        </form>
      </section>
    </div>
  );
}

function SignIn({ params }: { params: Search }) {
  return (
    <div className="max-w-md flex flex-col gap-4">
      <h1 className="text-3xl">Admin</h1>
      {params.sent ? (
        <p role="status">Check your e-mail for a sign-in link. It works once.</p>
      ) : (
        <form action={signIn} className="flex flex-col gap-3">
          <label className="admin-field">
            <span>E-mail address</span>
            <input name="email" type="email" required autoComplete="email" className="field" />
          </label>
          <button type="submit" className="btn-primary self-start">
            Send me a sign-in link
          </button>
        </form>
      )}
      {params.error && ERRORS[params.error] && <p role="alert" className="text-danger">{ERRORS[params.error]}</p>}
    </div>
  );
}

/** The editable fields, shared by the review editor and the hand-entry form. */
function Fields({ a, outages }: { a?: Advisory; outages: Pick<Advisory, 'id' | 'reference_no' | 'title' | 'starts_at' | 'review_status'>[] }) {
  return (
    <div className="admin-grid">
      <label className="admin-field sm:col-span-2">
        <span>Title</span>
        <input name="title" defaultValue={a?.title} required className="field" />
      </label>
      <label className="admin-field">
        <span>Reference no.</span>
        <input name="reference_no" defaultValue={a?.reference_no ?? ''} className="field" placeholder="202610-0031-SU" />
      </label>
      <label className="admin-field">
        <span>Issued on</span>
        <input name="issued_on" type="date" defaultValue={a?.issued_on ?? ''} className="field" />
      </label>
      <label className="admin-field">
        <span>Kind</span>
        <select name="kind" defaultValue={a?.kind ?? ''} className="field">
          <option value="">Not known</option>
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="admin-field">
        <span>Audience</span>
        <select name="audience" defaultValue={a?.audience ?? 'external'} className="field">
          <option value="external">External (counts on the board)</option>
          <option value="internal">Internal (ignored)</option>
          <option value="unknown">Unknown (ignored)</option>
        </select>
      </label>
      <fieldset className="admin-field sm:col-span-2">
        <legend>Systems</legend>
        <div className="flex gap-4">
          {SYSTEMS.map((s) => (
            <label key={s.key} className="flex items-center gap-2">
              <input type="checkbox" name="systems" value={s.key} defaultChecked={a?.systems.includes(s.key)} /> {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="admin-field">
        <span>Starts (outage) or came back (restoration)</span>
        <input name="starts_at" type="datetime-local" defaultValue={toManilaInput(a?.starts_at ?? null)} className="field" />
      </label>
      <label className="admin-field">
        <span>Ends (outage only; empty = until restored)</span>
        <input name="ends_at" type="datetime-local" defaultValue={toManilaInput(a?.ends_at ?? null)} className="field" />
      </label>
      <label className="admin-field sm:col-span-2">
        <span>Outage this restores (restorations only)</span>
        <select name="related_advisory_id" defaultValue={a?.related_advisory_id ?? ''} className="field">
          <option value="">None</option>
          {outages
            .filter((o) => o.id !== a?.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.reference_no ?? 'No number'} · {o.starts_at ? manilaDate(o.starts_at) : 'no start'} · {o.title.slice(0, 60)}
                {o.review_status === 'pending' ? ' (pending)' : ''}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}

function Editor({ a, outages }: { a: Advisory; outages: Pick<Advisory, 'id' | 'reference_no' | 'title' | 'starts_at' | 'review_status'>[] }) {
  return (
    <article id={`adv-${a.id}`} className="admin-card flex flex-col gap-4" aria-labelledby={`adv-${a.id}-title`}>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">
          <span className={`admin-badge is-${a.review_status}`}>{a.review_status}</span>{' '}
          {a.parse_confidence && <span className={`admin-badge is-${a.parse_confidence}`}>{a.parse_confidence} confidence</span>}{' '}
          Found {manilaWhen(a.created_at)}
          {a.reviewed_at && <> · reviewed {manilaWhen(a.reviewed_at)}</>}
        </p>
        <h3 id={`adv-${a.id}-title`} className="text-lg">
          {a.title}
        </h3>
        <p className="text-sm">
          <a href={a.source_url} target="_blank" rel="noopener">
            Open the PDF
          </a>
        </p>
        {a.parse_notes.length > 0 && (
          <ul className="admin-notes">
            {a.parse_notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      <form action={saveAdvisory} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={a.id} />
        <Fields a={a} outages={outages} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" formAction={confirmAdvisory} data-intent="confirm" className="btn-primary">
            {a.review_status === 'confirmed' ? 'Save, keep confirmed' : 'Confirm'}
          </button>
          {a.review_status !== 'rejected' && (
            <button type="submit" formAction={rejectAdvisory} data-intent="reject" className="btn-quiet">
              Reject
            </button>
          )}
          {a.review_status === 'pending' && (
            <button type="submit" formAction={saveAdvisory} data-intent="save" className="btn-quiet">
              Save, still pending
            </button>
          )}
        </div>
      </form>

      <details>
        <summary className="cursor-pointer text-sm font-semibold">Text read from the PDF</summary>
        <pre className="admin-raw">{a.raw_text ?? 'No text: the PDF has no text layer.'}</pre>
      </details>
    </article>
  );
}
