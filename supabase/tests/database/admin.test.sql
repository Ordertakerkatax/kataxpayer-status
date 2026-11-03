-- The admin rule in the database (spec §4, §9): a signed-in user whose address
-- is in public.admins can read and edit advisories and settings; any other
-- signed-in user sees nothing and changes nothing, whatever the app does.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into public.admins (email) values ('boss@example.test') on conflict do nothing;
insert into public.advisories (source_url, title, review_status)
values ('https://example.test/admin-test.pdf', 'Admin test', 'pending');

-- A stranger with a valid login.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "email": "stranger@example.test", "role": "authenticated"}';
select is((select count(*)::int from public.advisories), 0, 'a signed-in stranger sees no advisories');
select is((select count(*)::int from public.settings), 0, 'nor any settings');
update public.advisories set review_status = 'confirmed' where source_url = 'https://example.test/admin-test.pdf';
reset role;
select is((select review_status from public.advisories where source_url = 'https://example.test/admin-test.pdf'),
  'pending', 'and cannot confirm one');

-- The admin, matched case-insensitively.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000002", "email": "Boss@Example.test", "role": "authenticated"}';
select ok((select count(*)::int from public.advisories) >= 1, 'the admin sees advisories');
update public.advisories set review_status = 'rejected' where source_url = 'https://example.test/admin-test.pdf';
select is((select review_status from public.advisories where source_url = 'https://example.test/admin-test.pdf'),
  'rejected', 'and can review them');
select is((select count(*)::int from public.settings), 8, 'and reads the settings');
reset role;

select * from finish();
rollback;
