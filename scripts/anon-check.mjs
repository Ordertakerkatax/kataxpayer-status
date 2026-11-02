// Proves, over the real REST API, what the public key can and cannot read.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/anon-check.mjs
//
// Run it against local (`supabase status -o env`) and again against production
// at launch. The base tables must refuse outright: an empty list would mean the
// grants were left in place and only RLS stands between them and the public.
// Prints statuses and error codes only, never a key or a row.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  process.exit(2);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, code: body?.code ?? null, rows: Array.isArray(body) ? body.length : null };
}

async function post(path, payload) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, code: body?.code ?? null };
}

const refused = (r) => r.status === 401 || r.status === 403 || r.code === '42501';

const checks = [
  ['reports: read refused', await get('reports?select=*'), refused],
  ['advisories: read refused', await get('advisories?select=*'), refused],
  ['settings: read refused', await get('settings?select=*'), refused],
  ['status_snapshots: read refused', await get('status_snapshots?select=*'), refused],
  ['admins: read refused', await get('admins?select=*'), refused],
  [
    'reports: insert refused',
    await post('reports', { system_key: 'efps', outcome: 'ok', device_hash: 'x', ip_hash: 'x' }),
    refused,
  ],
  ['compute_status: not callable', await post('rpc/compute_status', {}), (r) => r.status >= 400],
  ['v_live_status: readable', await get('v_live_status?select=*'), (r) => r.status === 200],
  ['v_recent_breakdown: readable', await get('v_recent_breakdown?select=*'), (r) => r.status === 200],
  ['v_public_advisories: readable', await get('v_public_advisories?select=*'), (r) => r.status === 200],
  ['v_monthly_availability: readable', await get('v_monthly_availability?select=*'), (r) => r.status === 200],
];

let failed = 0;
for (const [name, result, pass] of checks) {
  const ok = pass(result);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (HTTP ${result.status}${result.code ? `, ${result.code}` : ''})`);
}
console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
