-- LOCAL DEV SEED ONLY (applied by `supabase db reset`; never by `supabase db push`).
-- Self-signup is disabled, so this creates accounts straight into auth.users
-- (the on_auth_user_created trigger builds each profile + 1000 signup points):
--   admin    / localadmin123   (role admin)
--   member1  / localmember123  (linked to fighter "The Hallway Hurricane")
--   member2  / localmember123  (linked to fighter "Mattress Mauler")
-- Log in at http://localhost:5173/login with the username + password.
-- Production accounts are made with the admin-create-user Edge Function instead.

create or replace function pg_temp.seed_user(p_id uuid, p_username text, p_display text, p_password text)
returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          p_username || '@members.uosfight.local',
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}',
          jsonb_build_object('username', p_username, 'display_name', p_display),
          now(), now(), '', '', '', '', '', '', '', '')
  on conflict (id) do nothing;

  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id::text, p_id,
          jsonb_build_object('sub', p_id::text, 'email', p_username || '@members.uosfight.local',
                             'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;
$$;

select pg_temp.seed_user('5eed0000-0000-4000-8000-000000000001', 'admin',   'Commissioner', 'localadmin123');
select pg_temp.seed_user('5eed0000-0000-4000-8000-000000000002', 'member1', 'Hallway Guy',  'localmember123');
select pg_temp.seed_user('5eed0000-0000-4000-8000-000000000003', 'member2', 'Mat Fan',      'localmember123');

insert into public.fighters (id, nickname, weight_kg, catchphrase) values
  ('11111111-1111-4111-8111-111111111111', 'The Hallway Hurricane', 78.5, 'Lights out, quiet hours.'),
  ('22222222-2222-4222-8222-222222222222', 'Mattress Mauler',       84.0, 'I sleep on the mat.'),
  ('33333333-3333-4333-8333-333333333333', 'Laundry Day',           71.2, 'Spin cycle incoming.'),
  ('44444444-4444-4444-8444-444444444444', 'Ramen Ronin',           69.8, 'Two minutes. That is all I need.')
on conflict (id) do nothing;

update public.profiles set role = 'admin' where id = '5eed0000-0000-4000-8000-000000000001';
update public.profiles set fighter_id = '11111111-1111-4111-8111-111111111111'
 where id = '5eed0000-0000-4000-8000-000000000002';
update public.profiles set fighter_id = '22222222-2222-4222-8222-222222222222'
 where id = '5eed0000-0000-4000-8000-000000000003';

-- One card two days out (Asia/Baghdad evening): an open main event (both fighters accepted) and an
-- undercard bout still waiting for consent.
insert into public.fights (id, title, red_fighter_id, blue_fighter_id, scheduled_at, lock_at, status,
                           red_weight_kg, blue_weight_kg, red_accepted_at, blue_accepted_at,
                           bout_order, is_main_event)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Main Event',
   '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
   ((now() at time zone 'Asia/Baghdad')::date + 2 + time '21:00') at time zone 'Asia/Baghdad',
   ((now() at time zone 'Asia/Baghdad')::date + 2 + time '20:45') at time zone 'Asia/Baghdad', 'open',
   78.5, 84.0, now(), now(), 2, true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Undercard',
   '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
   ((now() at time zone 'Asia/Baghdad')::date + 2 + time '20:30') at time zone 'Asia/Baghdad',
   ((now() at time zone 'Asia/Baghdad')::date + 2 + time '20:15') at time zone 'Asia/Baghdad', 'scheduled',
   71.2, 69.8, null, null, 1, false)
on conflict (id) do nothing;

insert into public.fight_pools (fight_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
on conflict do nothing;
