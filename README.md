# BIR Filing Status Board — status.kataxpayer.com

"Can I file right now?" for eFPS and eBIRForms, from community reports and BIR advisories.
Free, unofficial, and it says so on every page. The spec is Version 1, November 2026.

Separate repo and separate Vercel project from kataxpayer.com. No git remote yet.

## Commands

```bash
npm run dev                      # localhost:3000
npm run build                    # run before saying something works
node scripts/tokens-to-css.mjs   # regenerate app/tokens.css from design/tokens.json

supabase start                   # local Supabase in Docker (ports 553xx, see below)
supabase db reset                # rebuild the local database from supabase/migrations
supabase test db                 # the status logic tests (pgTAP)
supabase db lint --level warning

# Prove the public key cannot read the tables (local values from `supabase status -o env`;
# run it against production at launch too):
SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/anon-check.mjs
```

## Database

Schema lives in `supabase/migrations/`, applied in order. Unlike kataxpayer.com there is no
single hand-run `schema.sql`: the spec asks for migrations, and the CLI tracks which ran.

- **`20261102000100_tables.sql`**: the five spec tables, `admins`, the seed rows, and access.
- **`20261102000200_status.sql`**: `compute_status`, and the four public views.
- **`20261102000300_snapshots.sql`**: the 5-minute pg_cron job and history recompute.

How access works, since it is the thing most easily broken:

- **anon reads the four `v_*` views and nothing else.** Grants on the base tables are revoked
  as well as RLS being on, so a stray query fails with `42501 permission denied` instead of
  quietly returning an empty list. `scripts/anon-check.mjs` proves it over the API.
- **The views are `security_invoker` and read only from functions in the `private` schema**,
  which PostgREST does not expose. Those functions are security definer and return aggregates
  and confirmed advisories only. A view therefore cannot become a back door into a table.
- **`compute_status(system_key, at)` is the only status logic.** The live view and every
  snapshot call it, so the two cannot disagree. It lives in `private` and only the service role
  can call it directly.
- **Reports go in through `/api/report` with the service-role key.** Nothing else writes them.
- **The admin is a row in `public.admins`**, checked by RLS on `advisories` and `settings`. The
  app checks `ADMIN_EMAIL` too; the table makes the database refuse a stranger who holds a valid
  login. Add the address once per database, lower case, in the SQL editor:
  `insert into public.admins (email) values ('...');`
- **Confirming, editing or rejecting an outage or a restoration rewrites the snapshots in its
  window** (a trigger on `advisories`), so history follows the confirmed record.

Three readings of the spec worth knowing:

- **An outage closes at its restoration's time, not at the moment the restoration is
  confirmed.** For `kind = 'restored'`, `starts_at` is when the BIR says the system came back.
  Recomputed history keeps the outage for the hours it lasted.
- **The current month's official availability counts only the hours elapsed so far.** Spec §10
  divides by the hours in the month; on the 2nd of the month that would credit 28 days that
  have not happened yet.
- **An hour's state** walks from worst to best and takes the first state at which the snapshots
  seen so far reach half the hour. So 6 `down` and 6 `up` is `down`; 4 `down`, 4 `issues` and
  4 `up` is `issues`. `no_data` counts as best, so it only wins an hour that is mostly empty.

Local ports are 553xx, not Supabase's default 543xx, because another local project
(`tagatinda`) already holds those.

## Styling

`design/tokens.json` is a copy of the published KaTaxpayer design system, the same file
kataxpayer.com uses. `app/tokens.css` is generated from it: never hand-edit. Tailwind reads
the tokens through `@theme inline` in `app/globals.css`, so `bg-surface-brand`,
`text-ink-muted` and the rest are the brand's colours.

Two things that bite:

- `tokens.css` defines a global class per type style (`hero`, `display-1`..`3`, `price`,
  `body`, `body-lg`, `body-sm`, `caption`, `eyebrow`, `label`, `button`, `price-note`). Those
  names are reserved; do not use them for layout.
- Base element rules stay inside `@layer base`. Unlayered, they beat every Tailwind utility.

## Where things stand

- **Phase 0 done:** app shell, header with Manila time, disclaimer strip and footer on every
  page, `robots.txt`, `.env.example`, and the advisory source write-up in `docs/bir-source.md`.
- **Advisory source decided:** option A, the rendered home page (`docs/bir-source.md`).
- **The board will be a live report stream:** brief in `docs/board-motion.md`, built in Phase 2.
- **Phase 1 done** (locally): migrations, seed, RLS, `compute_status`, the four views, the
  snapshot job. Not yet applied to a hosted Supabase project.
- Phases 2 to 5 are not started. The board cards are a placeholder.
