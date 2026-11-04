# BIR Filing Status Board — status.kataxpayer.com

"Can I file right now?" for eFPS and eBIRForms, from community reports and BIR advisories.
Free, unofficial, and it says so on every page. The spec is Version 1, November 2026.

Separate repo and separate Vercel project from kataxpayer.com. No git remote yet.

## Commands

```bash
npm run dev                      # localhost:3000
npm run build                    # run before saying something works
node scripts/tokens-to-css.mjs   # regenerate app/tokens.css from design/tokens.json
npm run test:parser              # the advisory parser against real BIR text

# The watcher, by hand (one page view of bir.gov.ph):
cd watcher && npm ci && npx playwright install chromium
DRY_RUN=1 node watch.mjs                                  # print what it reads
SYNC_URL=http://localhost:3000/api/advisories/sync CRON_SECRET=... node watch.mjs

supabase start                   # local Supabase in Docker (ports 553xx, see below)
supabase db reset                # rebuild the local database from supabase/migrations
supabase test db                 # status logic and report limit tests (pgTAP)
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
- **`20261103000100_report.sql`**: `submit_report`, the rate limit and the insert in one
  transaction.
- **`20261103000200_parse_notes.sql`**: why the parser was unsure, for the admin only.

`supabase/seed.sql` adds a local admin, `admin@kataxpayer.test`, on `db reset` only. Its magic
links land in the local mail catcher at http://localhost:55324.

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
  The route calls `submit_report`, which locks the network and then the device before counting,
  so two taps in the same instant cannot both pass the 15-minute cooldown. Its execute grant is
  revoked from anon and authenticated; callable with the public key it would skip Turnstile.
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

One test is asked of the catalogue (`has_function_privilege`) rather than by calling the
function as anon: pgTAP's `throws_ok` catching a function permission error as anon segfaults
the local Postgres 17.6. And a bare `select` that returns rows reading `ok` is a TAP line to
pg_prove, so setup calls that return text are counted inside an assertion.

Local ports are 553xx, not Supabase's default 543xx, because another local project
(`tagatinda`) already holds those.

## The board

`/` is the live board (spec §7) as a report stream (`docs/board-motion.md`).

- **`lib/board.ts` builds the board once** for the first render, the 30-second poll
  (`/api/status`) and the reply to a report, so the three cannot disagree. Reports leave it as
  bare points, time rounded down to the minute, no hash or ID.
- **`/api/status` is cached at the edge for 15 seconds** and not in the browser. The board keeps
  whichever answer has the later server `generatedAt`, so an edge copy from before your own
  report cannot put the old counts back.
- **Times are formatted by hand in `lib/time.ts`** (Manila is UTC+8, no DST), so server and
  browser print the same string and React reports no hydration mismatch.
- **"What to do now" is `content/what-to-do.md`.** Plain paragraphs, `- ` lists, `**bold**` and
  links; a line starting `TODO:` is never shown. The text there is placeholder until Emel
  approves it, and the TODO line says so.
- **Motion** is all in the Motion section at the end of `app/globals.css`, inside
  `prefers-reduced-motion: no-preference`. With reduced motion the strip redraws only when data
  arrives.
- **Turnstile locally** uses Cloudflare's published test keys (in `.env.local`, which is not
  committed). The test secret `1x...AA` passes every token; set `TURNSTILE_SECRET_KEY` to
  `2x0000000000000000000000000000000AA` to see the 403. Do not run two `next dev` in this folder
  at once: they share `.next` and the first starts answering 404.

## Advisories and the admin

- **The watcher** is `.github/workflows/advisory-watch.yml`, every 30 minutes: headless Chromium
  reads the BIR home page's list (`watcher/watch.mjs`) and posts it to `/api/advisories/sync`
  with the `CRON_SECRET` bearer. A run that reads nothing fails red. Details in
  `docs/bir-source.md`.
- **The sync route** fetches only `https://*.bir.gov.ph` URLs, at most 15 new PDFs a run, one at
  a time, parses them (`lib/advisory-parser.ts`) and saves them as pending. A download that fails
  is not stored, so the next run tries again.
- **`/admin` signs in by magic link** and only `ADMIN_EMAIL` is sent one; anyone else gets "Not
  allowed" and no e-mail. The admin pages read and write as the signed-in user, not the service
  role, so `public.admins` and RLS check every query too.
- **Confirm refuses what would silently do nothing**: an outage with no system or start, a
  restoration with no outage to close. Error and success messages travel as codes in the URL,
  never as text, so a crafted link cannot put words on the page.
- **Each button has its own server action** (`formAction`). A submit button's name and value did
  not reach a single shared action, and every Confirm was quietly saved as a plain edit.
- Locally, `supabase/config.toml` allows 30 auth e-mails an hour instead of 2, so sign-in can be
  tested more than twice. Production's limit is set in the hosted project.

## History, advisories and about

- **`/history`** reads `v_monthly_availability` for the active systems only (the view also
  covers inactive and test systems). Two charts, official and community, never one blended
  figure; bars start at zero. The table under them is the accessible version and carries every
  number. `/history/export?year=` is the same table as CSV, built with `lib/csv.ts` (the
  formula guard from kataxpayer.com).
- **Chart colours** are `--series-0` and `--series-1` in `app/globals.css`, checked with the
  dataviz validator: `#0a7d55` and `#d9a20d` pass on white. `brand-600` failed the chroma check
  (it reads as grey in a bar), and the status colours are not used because a system is an
  identity, not a state.
- **`supabase/tests/database/history.test.sql`** is the Phase 4 check: one seeded month with the
  hand calculation written beside each assertion (97.36% official, 57.14% community over 7
  hours, and the October share of a cross-month outage).
- **`/advisories`** filters with a plain GET form (system, year) plus `month` from a history row.
- **`/about`** states the thresholds by reading `settings`, so it cannot drift from the board.
  Its privacy notice is `content/privacy.md`, placeholder until Emel approves it, and the
  question address is `PRIVACY_EMAIL` in `lib/site.ts`, null (the page points to kataxpayer.com)
  until one is chosen.

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
- **Phase 2 done** (locally): `/api/report`, `/api/status`, the report dialog, the live board,
  "What to do now" and the latest advisories. `content/what-to-do.md` awaits Emel's approval.
  The dialog links `/about`, which arrives in Phase 4.
- **Phase 3 done** (locally): parser and its tests, the sync route, the GitHub Actions watcher
  and `/admin`.
- **Phase 4 done** (locally): `/history` with charts and CSV, `/advisories`, `/about`. Awaiting
  Emel: `content/privacy.md` wording and a privacy contact address.
- **Phase 5, launch, part done** (4 Nov 2026):
  - **Live at https://kataxpayer-status.vercel.app.** Supabase project `kataxpayer-status`
    (ref `izfctlgzwgqwibohhhcb`, Singapore) has every migration, the admin row, and the
    5-minute snapshot job running. `scripts/anon-check.mjs` passes against it.
  - `vercel.json` pins the Next.js framework. The project was made from the CLI with the
    "Other" preset, which served the build as static files and 404'd every page.
  - The repo is public at github.com/Ordertakerkatax/kataxpayer-status. The watcher runs
    every 30 minutes; its first run read 103 items and stored 6 pending advisories.
    `SYNC_URL` points at the vercel.app address; delete the variable once
    `status.kataxpayer.com` resolves and the workflow falls back to it.
  - Still to do: the A record `status` → `76.76.21.21` at Namecheap; a Cloudflare Turnstile
    widget (until then `/api/report` answers 503 and nothing is saved); the Auth site URL and
    redirect URLs in the Supabase dashboard (not `supabase config push`, which would send the
    local settings); and probably custom SMTP, since Supabase's default sender only mails
    org members. The footer link on kataxpayer.com builds and waits for the DNS.
