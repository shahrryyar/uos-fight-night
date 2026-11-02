-- Bootstrap the FIRST admin (production). Self-signup is disabled, so:
--
-- 1. Create the auth user with the service-role Admin API, run from your own
--    machine (never commit the key). Get the secret key with:
--      supabase projects api-keys --project-ref <ref>
--
--    curl -X POST "https://<ref>.supabase.co/auth/v1/admin/users" \
--      -H "apikey: <SECRET_OR_SERVICE_ROLE_KEY>" \
--      -H "Authorization: Bearer <SECRET_OR_SERVICE_ROLE_KEY>" \
--      -H "Content-Type: application/json" \
--      -d '{"email":"<username>@members.uosfight.local","password":"<temp password>",
--           "email_confirm":true,"user_metadata":{"username":"<username>","display_name":"<Shown Name>"}}'
--
--    The on_auth_user_created trigger creates the profile (+1000 signup points).
--
-- 2. Promote that user (SQL editor or psql). Replace the username:

update public.profiles
   set role = 'admin'
 where username = 'first_admin_username';

insert into public.admin_log (actor, action, target_id, details)
select null, 'bootstrap_admin', p.id, jsonb_build_object('username', p.username)
  from public.profiles p
 where p.username = 'first_admin_username';

-- 3. From then on, admins create every other account (including a second
--    admin) in the app: Admin -> Members -> Create account, which calls the
--    admin-create-user Edge Function.
