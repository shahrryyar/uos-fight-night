-- LOCAL DEV SEED ONLY (applied by `supabase db reset`; never by `supabase db push`).
-- Self-signup is disabled, so this creates accounts straight into auth.users
-- (the on_auth_user_created trigger builds each profile + 1000 signup points):
--   admin    / localadmin123   (role admin)
--   member1  / localmember123  (linked to fighter "The Hallway Hurricane")
--   member2  / localmember123  (linked to fighter "Mattress Mauler")
-- Wave B demo: "The Hallway Hurricane" holds the belt (won last week), badges,
-- and a locked "Tonight" bout with a running live score.
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

-- Wave B demo: last week's card (settled). Hurricane beat Laundry Day by pin and
-- holds the title belt; member2 won a 400-point pick (Bold Pick badge, code high_roller).
insert into public.fights (id, title, red_fighter_id, blue_fighter_id, scheduled_at, lock_at, status,
                           red_weight_kg, blue_weight_kg, red_accepted_at, blue_accepted_at, bout_order,
                           is_main_event, winner_side, method, rounds, red_score, blue_score, finish_move,
                           result_note, recorded_by, settled_at, red_elo_before, blue_elo_before, elo_delta,
                           created_by, is_title_fight)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Vacant Title',
        '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
        ((now() at time zone 'Asia/Baghdad')::date - 7 + time '21:00') at time zone 'Asia/Baghdad',
        ((now() at time zone 'Asia/Baghdad')::date - 7 + time '20:45') at time zone 'Asia/Baghdad', 'settled',
        78.5, 71.2, now() - interval '9 days', now() - interval '9 days', 1, true,
        'red', 'pin', 2, 3, 1, 'half nelson', 'Clean finish', '5eed0000-0000-4000-8000-000000000001',
        ((now() at time zone 'Asia/Baghdad')::date - 7 + time '21:20') at time zone 'Asia/Baghdad',
        1000, 1000, 16, '5eed0000-0000-4000-8000-000000000001', true)
on conflict (id) do nothing;
insert into public.fight_pools (fight_id, red_total, red_count)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 400, 1) on conflict do nothing;
insert into public.bets (id, fight_id, user_id, side, amount, status, payout, created_at)
values ('dddddddd-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        '5eed0000-0000-4000-8000-000000000003', 'red', 400, 'won', 400, now() - interval '8 days')
on conflict (id) do nothing;
insert into public.points_ledger (user_id, delta, reason, ref_id, note)
select '5eed0000-0000-4000-8000-000000000003', d, r, 'dddddddd-0000-4000-8000-000000000001', n
  from (values (-400, 'bet', null::text), (400, 'payout', 'Fight payout')) v(d, r, n)
 where not exists (select 1 from public.points_ledger where ref_id = 'dddddddd-0000-4000-8000-000000000001');
insert into public.votes (fight_id, user_id, side, is_participant)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '5eed0000-0000-4000-8000-000000000003', 'red', false)
on conflict do nothing;
update public.fighters set elo = 1016, wins = 1, streak = 1, season_wins = 1
 where id = '11111111-1111-4111-8111-111111111111' and wins = 0;
update public.fighters set elo = 984, losses = 1, streak = -1, season_losses = 1
 where id = '33333333-3333-4333-8333-333333333333' and losses = 0;
-- Season 1 starts before that card, so the result stays correctable
update public.seasons set started_at = least(started_at, now() - interval '30 days') where ended_at is null;
insert into public.belt_reigns (id, fighter_id, won_fight_id, started_at, note, awarded_by)
select 'beef0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
       'dddddddd-dddd-4ddd-8ddd-dddddddddddd', f.settled_at, 'Won the vacant title',
       '5eed0000-0000-4000-8000-000000000001'
  from public.fights f
 where f.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
   and not exists (select 1 from public.belt_reigns where ended_at is null);
insert into public.fighter_badges (fighter_id, code, fight_id, awarded_at)
select v.fighter_id, v.code, f.id, f.settled_at
  from public.fights f,
       (values ('11111111-1111-4111-8111-111111111111'::uuid, 'first_win'),
               ('11111111-1111-4111-8111-111111111111'::uuid, 'belt_holder')) v(fighter_id, code)
 where f.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
on conflict do nothing;
insert into public.user_badges (user_id, code, fight_id, awarded_at)
select '5eed0000-0000-4000-8000-000000000003', 'high_roller', f.id, f.settled_at
  from public.fights f where f.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
on conflict do nothing;

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

-- Wave B demo: tonight's bout is in progress (locked) with a running referee
-- clock: round 2, 3-1. The champion (Hurricane) makes the main event above a
-- title fight (is_title_fight is set by the insert trigger).
insert into public.fights (id, title, red_fighter_id, blue_fighter_id, scheduled_at, lock_at, status,
                           red_weight_kg, blue_weight_kg, red_accepted_at, blue_accepted_at, bout_order)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Tonight',
        '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
        now() - interval '5 minutes', now() - interval '20 minutes', 'locked',
        71.2, 69.8, now() - interval '1 day', now() - interval '1 day', 1)
on conflict (id) do nothing;
insert into public.fight_pools (fight_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc') on conflict do nothing;
insert into public.live_scores (fight_id, round, red_score, blue_score, round_started_at, accumulated_seconds,
                                round_seconds, running, updated_by)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 2, 3, 1, now() - interval '20 seconds', 0, 120, true,
        '5eed0000-0000-4000-8000-000000000001')
on conflict (fight_id) do nothing;
