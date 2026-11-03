-- Local development only: `supabase db reset` runs this; a push to the hosted
-- project does not. The admin address matches ADMIN_EMAIL in .env.local, and
-- its magic links land in the local mail catcher (http://localhost:55324).
-- Production gets its own row by hand, as the README says.
insert into public.admins (email) values ('admin@kataxpayer.test') on conflict do nothing;
