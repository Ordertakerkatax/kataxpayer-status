'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { SYSTEMS } from '@/lib/catalogue';
import { SITE_URL } from '@/lib/site';
import { adminEmail, userDb, whoIsThis } from '@/lib/supabase-user';
import { fromManilaInput } from '@/lib/time';
import type { ConfirmProblem } from '@/lib/admin-review';

/**
 * Every action checks the signed-in address against ADMIN_EMAIL before it does
 * anything, and then writes as that user, so RLS checks it a second time.
 */
async function requireAdmin() {
  const who = await whoIsThis();
  if (who.role === 'anonymous') redirect('/admin');
  if (who.role !== 'admin') redirect('/admin/not-allowed');
  return who.supabase;
}

const back = (params: Record<string, string>, anchor?: string): never =>
  redirect(`/admin?${new URLSearchParams(params)}${anchor ? `#${anchor}` : ''}`);

// Sign in ----------------------------------------------------------------------

export async function signIn(form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const allowed = adminEmail();
  // Spec §9: nobody else may sign in, so nobody else is sent a link.
  if (!allowed || email !== allowed) redirect('/admin/not-allowed');
  const supabase = await userDb();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${SITE_URL}/auth/callback`, shouldCreateUser: true },
  });
  if (error) back({ error: 'send' });
  back({ sent: '1' });
}

export async function signOut() {
  const supabase = await userDb();
  await supabase.auth.signOut();
  redirect('/admin');
}

// Advisories -------------------------------------------------------------------

const systemKeys = SYSTEMS.map((s) => s.key) as [string, ...string[]];
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const fieldsSchema = z.object({
  title: z.string().trim().min(1).max(500),
  reference_no: z.preprocess(blankToNull, z.string().trim().regex(/^\d{6}-\d{4}-[A-Z]{2}$/).nullable()),
  issued_on: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  audience: z.enum(['external', 'internal', 'unknown']),
  kind: z.preprocess(blankToNull, z.enum(['unavailable', 'restored', 'extension', 'other']).nullable()),
  systems: z.array(z.enum(systemKeys)),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  related_advisory_id: z.preprocess(blankToNull, z.coerce.number().int().positive().nullable()),
});

function readFields(form: FormData) {
  return fieldsSchema.safeParse({
    title: form.get('title'),
    reference_no: form.get('reference_no'),
    issued_on: form.get('issued_on'),
    audience: form.get('audience'),
    kind: form.get('kind'),
    systems: form.getAll('systems'),
    starts_at: fromManilaInput(form.get('starts_at') as string),
    ends_at: fromManilaInput(form.get('ends_at') as string),
    related_advisory_id: form.get('related_advisory_id'),
  });
}

type Fields = z.infer<typeof fieldsSchema>;

/**
 * What must hold before an advisory can count on the board, as a code from
 * CONFIRM_PROBLEMS (lib/admin-review.ts). Only codes travel in the URL, so a
 * crafted link cannot put words of its own on this page.
 */
function confirmProblem(f: Fields): ConfirmProblem | null {
  if (!f.kind) return 'no-kind';
  if (f.kind === 'unavailable') {
    if (!f.systems.length) return 'outage-systems';
    if (!f.starts_at) return 'outage-start';
    if (f.ends_at && f.ends_at <= f.starts_at) return 'outage-order';
  }
  if (f.kind === 'restored') {
    if (!f.related_advisory_id) return 'restored-link';
    if (!f.starts_at) return 'restored-time';
  }
  return null;
}

/**
 * Save, Confirm or Reject one advisory, from the edit form on /admin. One
 * action per button (`formAction`), because a submit button's own name and
 * value did not reach the action's form data.
 */
export async function confirmAdvisory(form: FormData) {
  return review(form, 'confirm');
}
export async function rejectAdvisory(form: FormData) {
  return review(form, 'reject');
}
export async function saveAdvisory(form: FormData) {
  return review(form, 'save');
}

async function review(form: FormData, intent: 'confirm' | 'reject' | 'save') {
  const supabase = await requireAdmin();
  const id = Number(form.get('id'));
  const anchor = `adv-${id}`;
  if (!Number.isInteger(id) || id <= 0) back({ error: 'bad-id' });

  const parsed = readFields(form);
  if (!parsed.success) back({ error: 'fields', id: String(id) }, anchor);
  const f = parsed.data!;

  if (f.related_advisory_id === id) back({ error: 'self-link', id: String(id) }, anchor);
  if (intent === 'confirm') {
    const problem = confirmProblem(f);
    if (problem) back({ error: problem, id: String(id) }, anchor);
  }

  const status =
    intent === 'confirm' ? { review_status: 'confirmed', reviewed_at: new Date().toISOString() }
    : intent === 'reject' ? { review_status: 'rejected', reviewed_at: new Date().toISOString() }
    : {};

  const { error } = await supabase
    .from('advisories')
    .update({ ...f, related_advisory_id: f.kind === 'restored' ? f.related_advisory_id : null, ...status })
    .eq('id', id);
  if (error) back({ error: 'save', id: String(id) }, anchor);
  back({ done: intent, id: String(id) }, anchor);
}

/** Spec §9: an advisory or RMC the watcher missed, entered by hand. */
export async function addAdvisory(form: FormData) {
  const supabase = await requireAdmin();
  const parsed = readFields(form);
  const url = z.url({ protocol: /^https?$/ }).max(2000).safeParse(String(form.get('source_url') ?? '').trim());
  if (!parsed.success || !url.success) back({ error: 'add-fields' }, 'add');
  const f = parsed.data!;
  const confirmNow = form.get('confirm_now') === 'on';
  if (confirmNow) {
    const problem = confirmProblem(f);
    if (problem) back({ error: problem }, 'add');
  }
  const { data, error } = await supabase
    .from('advisories')
    .insert({
      ...f,
      related_advisory_id: f.kind === 'restored' ? f.related_advisory_id : null,
      source_url: url.data,
      parse_notes: ['Entered by hand.'],
      review_status: confirmNow ? 'confirmed' : 'pending',
      reviewed_at: confirmNow ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error) back({ error: error.code === '23505' ? 'add-duplicate' : 'add-save' }, 'add');
  back({ done: 'add', id: String(data!.id) }, `adv-${data!.id}`);
}

// Settings ---------------------------------------------------------------------

const RATIOS = new Set(['down_ratio', 'issues_ratio']);

export async function saveSettings(form: FormData) {
  const supabase = await requireAdmin();
  const { data: current, error } = await supabase.from('settings').select('key, value');
  if (error || !current) back({ error: 'settings' }, 'settings');

  for (const row of current!) {
    const raw = form.get(`setting:${row.key}`);
    if (raw === null) continue;
    const value = Number(raw);
    const ok = Number.isFinite(value) && value >= 0 && (!RATIOS.has(row.key) || value <= 1) && (RATIOS.has(row.key) || Number.isInteger(value));
    if (!ok) back({ error: 'settings-value', key: row.key }, 'settings');
    if (value === Number(row.value)) continue;
    const res = await supabase.from('settings').update({ value }).eq('key', row.key);
    if (res.error) back({ error: 'settings' }, 'settings');
  }
  back({ done: 'settings' }, 'settings');
}
