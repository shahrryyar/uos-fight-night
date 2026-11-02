-- Bootstrap the first admin(s). Run in the Supabase SQL editor (or psql) AFTER the
-- person has signed up through /join with a valid invite.
-- Replace the username(s) below.

update public.profiles
   set role = 'admin'
 where username in ('first_admin_username', 'second_admin_username');

insert into public.admin_log (actor, action, details)
values (null, 'bootstrap_admin',
        jsonb_build_object('usernames', array['first_admin_username', 'second_admin_username']));
