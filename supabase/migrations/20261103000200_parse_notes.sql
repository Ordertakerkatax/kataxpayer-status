-- Why the parser was unsure, in words, shown to the admin beside the fields
-- ("Names neither eFPS nor eBIRForms", "Cites 202610-0031-SU, which is not
-- stored"). Never shown publicly: v_public_advisories does not select it.
alter table public.advisories add column if not exists parse_notes text[] not null default '{}';
