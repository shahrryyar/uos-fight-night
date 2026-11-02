-- pgTAP suite for UoS Fight Night. Run: supabase test db
-- Everything runs in one transaction and is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();
create schema tests;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function tests.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'a1'    then '00000000-0000-4000-a000-0000000000a1'
    when 'a2'    then '00000000-0000-4000-a000-0000000000a2'
    when 'u1'    then '00000000-0000-4000-a000-000000000001'
    when 'u2'    then '00000000-0000-4000-a000-000000000002'
    when 'u3'    then '00000000-0000-4000-a000-000000000003'
    when 'u4'    then '00000000-0000-4000-a000-000000000004'
    when 'p1'    then '00000000-0000-4000-a000-000000000005'
    when 'poor'  then '00000000-0000-4000-a000-000000000006'
    when 'broke' then '00000000-0000-4000-a000-000000000007'
    when 'gone'  then '00000000-0000-4000-a000-000000000008'
  end)::uuid;
$$;

-- impersonate a signed-in user (caller must then `set local role authenticated`)
create or replace function tests.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', tests.uid(p_name), 'role', 'authenticated')::text, true);
$$;

create or replace function tests.mk_user(p_name text, p_username text, p_code text) returns void
language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', tests.uid(p_name), 'authenticated', 'authenticated',
          p_username || '@members.uosfight.local', '',
          jsonb_build_object('username', p_username, 'invite_code', p_code),
          '{"provider":"email","providers":["email"]}', now(), now());
$$;

create or replace function tests.hook(p_username text, p_code text, p_email text default null)
returns jsonb language sql as $$
  select public.hook_before_user_created(jsonb_build_object(
    'metadata', jsonb_build_object('name', 'before-user-created'),
    'user', jsonb_build_object(
      'email', coalesce(p_email, p_username || '@members.uosfight.local'),
      'user_metadata', jsonb_build_object('username', p_username, 'invite_code', p_code))));
$$;

create or replace function tests.bal(p_name text) returns int language sql as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger where user_id = tests.uid(p_name);
$$;

create or replace function tests.g(p_key text) returns uuid language sql as $$
  select current_setting('t.' || p_key)::uuid;
$$;

grant usage on schema tests to authenticated, anon;
grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Invites fixture
-- ---------------------------------------------------------------------------
insert into public.invites (code, max_uses, uses, expires_at, revoked) values
  ('TESTINV1', 100, 0, null, false),
  ('TESTUSED', 1,   1, null, false),
  ('TESTREVK', 5,   0, null, true),
  ('TESTEXPD', 5,   0, now() - interval '1 hour', false),
  ('TESTONCE', 1,   0, now() + interval '1 day', false);

-- ===========================================================================
-- 1. before_user_created hook
-- ===========================================================================
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
          'supabase_auth_admin can execute the hook');
select ok(not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute'),
          'clients cannot execute the hook');
select is(tests.hook('newbie', 'TESTINV1'), '{}'::jsonb, 'hook: valid invite + username allowed');
select is(tests.hook('newbie', 'testinv1'), '{}'::jsonb, 'hook: invite code is case-insensitive');
select is(tests.hook('newbie', 'NOPE1234') -> 'error' ->> 'message', 'INVALID_INVITE', 'hook: unknown invite rejected');
select is((tests.hook('newbie', 'NOPE1234') -> 'error' ->> 'http_code')::int, 400, 'hook: rejection is http 400');
select is(tests.hook('newbie', 'TESTUSED') -> 'error' ->> 'message', 'INVALID_INVITE', 'hook: used-up invite rejected');
select is(tests.hook('newbie', 'TESTREVK') -> 'error' ->> 'message', 'INVALID_INVITE', 'hook: revoked invite rejected');
select is(tests.hook('newbie', 'TESTEXPD') -> 'error' ->> 'message', 'INVALID_INVITE', 'hook: expired invite rejected');
select is(tests.hook('newbie', null) -> 'error' ->> 'message', 'INVALID_INVITE', 'hook: missing invite rejected');
select is(tests.hook('ab', 'TESTINV1') -> 'error' ->> 'message', 'INVALID_USERNAME', 'hook: too-short username rejected');
select is(tests.hook('bad-name!', 'TESTINV1') -> 'error' ->> 'message', 'INVALID_USERNAME', 'hook: bad chars rejected');
select is(tests.hook('newbie', 'TESTINV1', 'someone@gmail.com') -> 'error' ->> 'message', 'INVALID_USERNAME',
          'hook: email not matching synthetic username email rejected');
reset role;

set local role authenticated;
select throws_ok($$ select tests.hook('newbie', 'TESTINV1') $$, '42501', null,
                 'authenticated cannot execute the auth hook');
reset role;

-- ===========================================================================
-- 2. Signup trigger
-- ===========================================================================
select lives_ok($$ select tests.mk_user('a1', 'admin_one', 'TESTINV1') $$, 'signup a1');
select tests.mk_user('a2', 'admin_two', 'testinv1');
select tests.mk_user('u1', 'user_one', 'TESTINV1');
select tests.mk_user('u2', 'user_two', 'TESTINV1');
select tests.mk_user('u3', 'user_three', 'TESTINV1');
select tests.mk_user('u4', 'user_four', 'TESTINV1');
select tests.mk_user('p1', 'fighter_guy', 'TESTINV1');
select tests.mk_user('poor', 'poor_guy', 'TESTINV1');
select tests.mk_user('broke', 'broke_guy', 'TESTINV1');
select lives_ok($$ select tests.mk_user('gone', 'gone_guy', 'TESTONCE') $$, 'signup consumes last use of single-use invite');

select is((select uses from public.invites where code = 'TESTINV1'), 9, 'invite uses incremented per signup');
select is((select uses from public.invites where code = 'TESTONCE'), 1, 'single-use invite now used');
select is((select username::text from public.profiles where id = tests.uid('u1')), 'user_one', 'profile created with username');
select is((select role from public.profiles where id = tests.uid('u1')), 'member', 'new profile is member');
select is(tests.bal('u1'), 1000, 'signup grants 1000 points');
select is((select reason from public.points_ledger where user_id = tests.uid('u1')), 'signup', 'signup ledger reason');

select is(tests.hook('user_one', 'TESTINV1') -> 'error' ->> 'message', 'USERNAME_TAKEN', 'hook: taken username rejected');
select is(tests.hook('USER_ONE', 'TESTINV1', 'user_one@members.uosfight.local') -> 'error' ->> 'message',
          'USERNAME_TAKEN', 'hook: username uniqueness is case-insensitive');
select is(tests.hook('newbie', 'TESTONCE') -> 'error' ->> 'message', 'INVALID_INVITE', 'hook: invite rejected once used up');
reset role;

select throws_ok($$
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'late@members.uosfight.local', '{"username":"late","invite_code":"TESTONCE"}')
$$, null, 'INVALID_INVITE', 'trigger rejects used invite even if hook was bypassed (race)');
select throws_ok($$
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'User_One@members.uosfight.local', '{"username":"User_One","invite_code":"TESTINV1"}')
$$, null, 'USERNAME_TAKEN', 'trigger rejects duplicate username');
select throws_ok($$
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'someone@gmail.com', '{"username":"someone","invite_code":"TESTINV1"}')
$$, null, 'INVALID_USERNAME', 'trigger rejects non-synthetic email (hook disabled/bypassed)');

update public.profiles set role = 'admin' where id in (tests.uid('a1'), tests.uid('a2'));
update public.profiles set active = false where id = tests.uid('gone');

-- ===========================================================================
-- 3. anon: nothing readable, only public_next_fight()
-- ===========================================================================
set local role anon;
select throws_ok('select * from public.profiles',      '42501', null, 'anon cannot select profiles');
select throws_ok('select * from public.invites',       '42501', null, 'anon cannot select invites');
select throws_ok('select * from public.fighters',      '42501', null, 'anon cannot select fighters');
select throws_ok('select * from public.fights',        '42501', null, 'anon cannot select fights');
select throws_ok('select * from public.votes',         '42501', null, 'anon cannot select votes');
select throws_ok('select * from public.bets',          '42501', null, 'anon cannot select bets');
select throws_ok('select * from public.points_ledger', '42501', null, 'anon cannot select points_ledger');
select throws_ok('select * from public.fight_pools',   '42501', null, 'anon cannot select fight_pools');
select throws_ok('select * from public.reactions',     '42501', null, 'anon cannot select reactions');
select throws_ok('select * from public.admin_log',     '42501', null, 'anon cannot select admin_log');
select throws_ok('select * from public.balances',            '42501', null, 'anon cannot select balances');
select throws_ok('select * from public.leaderboard_bettors', '42501', null, 'anon cannot select leaderboard_bettors');
select throws_ok('select * from public.fighter_rankings',    '42501', null, 'anon cannot select fighter_rankings');
select throws_ok('select * from public.fight_vote_totals',   '42501', null, 'anon cannot select fight_vote_totals');
select throws_ok($$ select public.cast_vote(gen_random_uuid(), 'red') $$, '42501', null, 'anon cannot execute cast_vote');
select throws_ok($$ select public.place_bet(gen_random_uuid(), 'red', 10) $$, '42501', null, 'anon cannot execute place_bet');
select throws_ok($$ select public.admin_create_invite(1, null) $$, '42501', null, 'anon cannot execute admin RPCs');
select throws_ok($$ select public.is_member() $$, '42501', null, 'anon cannot execute is_member');
select lives_ok('select * from public.public_next_fight()', 'anon can call public_next_fight');
reset role;

select is(
  (select array_to_string(proargnames, ',') from pg_proc where proname = 'public_next_fight' and pronamespace = 'public'::regnamespace),
  'id,title,lock_at,scheduled_at,status,red_nickname,blue_nickname',
  'public_next_fight returns only id/title/times/status/nicknames');

-- ===========================================================================
-- 4. Admin setup: fighters + fights
-- ===========================================================================
select tests.login('a1');
set local role authenticated;
select set_config('t.fr', public.admin_upsert_fighter(null, 'Test Red', 80.5, 'Red!', null, false)::text, true);
select set_config('t.fb', public.admin_upsert_fighter(null, 'Test Blue', 79, 'Blue!', null, false)::text, true);
select set_config('t.f3', public.admin_upsert_fighter(null, 'Test Three', null, null, null, false)::text, true);
select set_config('t.f4', public.admin_upsert_fighter(null, 'Test Four', null, null, null, false)::text, true);
select set_config('t.f6', public.admin_upsert_fighter(null, 'Admin Fighter', null, null, null, false)::text, true);
select set_config('t.fh', public.admin_upsert_fighter(null, 'Secret Hidden', null, null, null, true)::text, true);
select throws_ok($$ select public.admin_upsert_fighter(null, 'Test Red', null, null, null, false) $$,
                 null, 'NICKNAME_TAKEN', 'duplicate nickname rejected');
select lives_ok($$ select public.admin_upsert_fighter(tests.g('f3'), 'Test Three', 70.0, 'Three!',
                   'fighters/' || tests.g('f3') || '/' || gen_random_uuid() || '.webp', false) $$,
                'admin updates fighter with photo path');
select throws_ok($$ select public.admin_upsert_fighter(tests.g('f3'), 'Test Three', null, null, '../etc/passwd', false) $$,
                 null, 'INVALID_PHOTO_PATH', 'bad photo path rejected');

select lives_ok($$ select public.admin_set_member(tests.uid('p1'), true, 'member', tests.g('fr')) $$,
                'admin links p1 to red fighter');
select lives_ok($$ select public.admin_set_member(tests.uid('a2'), null, null, tests.g('f6')) $$,
                'admin links a2 to admin fighter');
select throws_ok($$ select public.admin_set_member(tests.uid('u4'), null, null, tests.g('fr')) $$,
                 null, 'FIGHTER_ALREADY_LINKED', 'fighter can be linked to one profile only');
select throws_ok($$ select public.admin_create_fight(tests.g('fr'), tests.g('fr'), now(), now(), null) $$,
                 null, 'INVALID_FIGHTERS', 'fighter cannot fight themselves');

-- F1: main test fight (future lock)
select set_config('t.fight1', public.admin_create_fight(tests.g('fr'), tests.g('fb'),
  now() + interval '1 day', now() + interval '1 day' - interval '10 minutes', 'Main')::text, true);
-- F2: time-lock fight
select set_config('t.fight2', public.admin_create_fight(tests.g('f3'), tests.g('f4'),
  now() + interval '1 day', now() + interval '1 day', 'Time lock')::text, true);
-- F3: dust tie fight (FR vs FB again)
select set_config('t.fight3', public.admin_create_fight(tests.g('fr'), tests.g('fb'),
  now() + interval '2 day', now() + interval '2 day', 'Rematch')::text, true);
-- F4: zero-winner fight
select set_config('t.fight4', public.admin_create_fight(tests.g('f3'), tests.g('f4'),
  now() + interval '3 day', now() + interval '3 day', 'Zero')::text, true);
-- F5: cancel fight
select set_config('t.fight5', public.admin_create_fight(tests.g('f3'), tests.g('f4'),
  now() + interval '4 day', now() + interval '4 day', 'Cancel me')::text, true);
-- F6: admin participant fight
select set_config('t.fight6', public.admin_create_fight(tests.g('f6'), tests.g('f3'),
  now() + interval '5 day', now() + interval '5 day', 'Admin fight')::text, true);
-- F7: already past lock at creation
select set_config('t.fight7', public.admin_create_fight(tests.g('f3'), tests.g('f4'),
  now() + interval '1 hour', now() - interval '1 minute', 'Past lock')::text, true);

select is((select status from public.fights where id = tests.g('fight1')), 'open', 'new fight is open');
select is((select count(*)::int from public.fight_pools where fight_id = tests.g('fight1')), 1, 'fight_pools row created');
reset role;

-- ===========================================================================
-- 5. Member visibility
-- ===========================================================================
select tests.login('u1');
set local role authenticated;
select ok((select count(*) from public.profiles) >= 9, 'members can see profiles');
select is((select count(*)::int from public.invites), 0, 'members cannot see invites');
select is((select count(*)::int from public.fighters where id = tests.g('fh')), 0, 'members cannot see hidden fighter');
select is((select count(*)::int from public.fighter_rankings where fighter_id = tests.g('fh')), 0, 'hidden fighter not ranked');
select ok((select count(*) from public.fights where id = tests.g('fight1')) = 1, 'members can see fights');
select is((select count(distinct user_id)::int from public.points_ledger), 1, 'members see only own ledger');
select is((select count(*)::int from public.balances), 1, 'balances view shows only own row to a member');
select ok((select count(*) from public.leaderboard_bettors) >= 9, 'leaderboard shows all active members');
select is((select balance from public.leaderboard_bettors where user_id = tests.uid('u2')), 1000, 'leaderboard shows others balances');
select is(public.my_balance(), 1000, 'my_balance');
select throws_ok($$ insert into public.points_ledger (user_id, delta, reason) values (tests.uid('u1'), 99999, 'admin_adjust') $$,
                 '42501', null, 'members cannot insert ledger rows');
select throws_ok($$ update public.profiles set role = 'admin' where id = tests.uid('u1') $$,
                 '42501', null, 'members cannot update profiles');
select throws_ok($$ insert into public.bets (fight_id, user_id, side, amount) values (tests.g('fight1'), tests.uid('u1'), 'red', 10) $$,
                 '42501', null, 'members cannot insert bets directly');
select throws_ok($$ delete from public.fights $$, '42501', null, 'members cannot delete fights');
select throws_ok($$ select private.weekly_points() $$, '42501', null, 'members cannot run cron bodies');
reset role;

select tests.login('a1');
set local role authenticated;
select ok((select count(*) from public.invites) >= 5, 'admin sees invites');
select ok((select count(*) from public.fighters where id = tests.g('fh')) = 1, 'admin sees hidden fighter');
select ok((select count(distinct user_id) from public.points_ledger) >= 9, 'admin sees all ledger rows');
reset role;

select tests.login('gone');
set local role authenticated;
select is((select count(*)::int from public.profiles), 1, 'deactivated user only sees own profile');
select is((select count(*)::int from public.fights), 0, 'deactivated user sees no fights');
select throws_ok($$ select public.cast_vote(tests.g('fight1'), 'red') $$, null, 'NOT_MEMBER', 'deactivated user cannot vote');
select throws_ok($$ select public.place_bet(tests.g('fight1'), 'red', 10) $$, null, 'NOT_MEMBER', 'deactivated user cannot bet');
reset role;

-- ===========================================================================
-- 6. Votes: upsert + privacy + totals hidden before lock
-- ===========================================================================
select tests.login('u1');
set local role authenticated;
select lives_ok($$ select public.cast_vote(tests.g('fight1'), 'red') $$, 'u1 votes red');
select lives_ok($$ select public.cast_vote(tests.g('fight1'), 'blue') $$, 'u1 changes vote to blue');
select throws_ok($$ select public.cast_vote(tests.g('fight1'), 'green') $$, null, 'INVALID_SIDE', 'invalid side rejected');
select results_eq($$ select side from public.votes where fight_id = tests.g('fight1') $$,
                  $$ values ('blue'::text) $$, 'vote upserted: single row, latest side');
reset role;

select tests.login('u2');
set local role authenticated;
select public.cast_vote(tests.g('fight1'), 'red');
select is((select count(*)::int from public.votes where user_id = tests.uid('u1')), 0, 'votes are private: u2 cannot see u1 vote');
select is((select count(*)::int from public.votes), 1, 'u2 sees only own vote');
select is_empty($$ select * from public.get_fight_vote_totals(tests.g('fight1')) $$, 'vote totals hidden before lock');
select is_empty($$ select * from public.fight_vote_totals where fight_id = tests.g('fight1') $$, 'vote totals view hidden before lock');
reset role;

select tests.login('p1');
set local role authenticated;
select lives_ok($$ select public.cast_vote(tests.g('fight1'), 'red') $$, 'participant can vote (stored)');
reset role;
select is((select is_participant from public.votes where fight_id = tests.g('fight1') and user_id = tests.uid('p1')),
          true, 'participant vote flagged');

-- ===========================================================================
-- 7. Bets: min / max / balance / one-per-fight / participant
-- ===========================================================================
select tests.login('u1');
set local role authenticated;
select throws_ok($$ select public.place_bet(tests.g('fight1'), 'red', 9) $$, null, 'BET_TOO_SMALL', 'bet below 10 rejected');
select throws_ok($$ select public.place_bet(tests.g('fight1'), 'red', 501) $$, null, 'BET_TOO_LARGE', 'bet above 500 cap rejected');
select set_config('t.b_u1_f1', public.place_bet(tests.g('fight1'), 'red', 100)::text, true);
select is(public.my_balance(), 900, 'bet deducted from balance');
select throws_ok($$ select public.place_bet(tests.g('fight1'), 'blue', 10) $$, null, 'ALREADY_BET', 'one active bet per fight');
select results_eq($$ select red_total, red_count, blue_total, blue_count from public.fight_pools where fight_id = tests.g('fight1') $$,
                  $$ values (100, 1, 0, 0) $$, 'pool updated');
select throws_ok($$ select public.place_bet(gen_random_uuid(), 'red', 10) $$, null, 'FIGHT_NOT_FOUND', 'unknown fight');
reset role;
select is((select reason from public.points_ledger where ref_id = tests.g('b_u1_f1')), 'bet', 'bet ledger row');

select tests.login('u2');
set local role authenticated;
select is((select count(*)::int from public.bets where fight_id = tests.g('fight1')), 0, 'others bets hidden before lock');
select set_config('t.b_u2_f1', public.place_bet(tests.g('fight1'), 'red', 50)::text, true);
select results_eq($$ select red_total, red_count from public.fight_pools where fight_id = tests.g('fight1') $$,
                  $$ values (150, 2) $$, 'members see pool totals before lock');
reset role;

select tests.login('u3');
set local role authenticated;
select set_config('t.b_u3_f1', public.place_bet(tests.g('fight1'), 'blue', 37)::text, true);
select throws_ok($$ select public.place_bet(tests.g('fight4'), 'blue', 482) $$, null, 'BET_TOO_LARGE', 'max bet is floor(50%) of balance (963 -> 481)');
select lives_ok($$ select public.place_bet(tests.g('fight4'), 'blue', 481) $$, 'bet of exactly max allowed');
reset role;

select tests.login('p1');
set local role authenticated;
select throws_ok($$ select public.place_bet(tests.g('fight1'), 'blue', 10) $$, null, 'PARTICIPANT', 'participant cannot bet on own fight');
select lives_ok($$ select public.place_bet(tests.g('fight2'), 'blue', 10) $$, 'participant can bet on other fights');
reset role;

-- poor: balance 15 → max bet 7
select tests.login('a1');
set local role authenticated;
select lives_ok($$ select public.admin_adjust_points(tests.uid('poor'), -985, 'test') $$, 'admin adjusts points down');
select throws_ok($$ select public.admin_adjust_points(tests.uid('poor'), -16, 'test') $$, null, 'INSUFFICIENT_POINTS',
                 'cannot adjust below zero');
reset role;
select is(tests.bal('poor'), 15, 'poor balance 15');
select tests.login('poor');
set local role authenticated;
select throws_ok($$ select public.place_bet(tests.g('fight1'), 'red', 16) $$, null, 'INSUFFICIENT_POINTS', 'cannot bet more than balance');
select throws_ok($$ select public.place_bet(tests.g('fight1'), 'red', 10) $$, null, 'BET_TOO_LARGE', 'cannot bet over 50% of balance');
reset role;

-- ===========================================================================
-- 8. Cancel bet refund
-- ===========================================================================
select tests.login('u4');
set local role authenticated;
select set_config('t.b_u4_f1', public.place_bet(tests.g('fight1'), 'blue', 40)::text, true);
select results_eq($$ select blue_total, blue_count from public.fight_pools where fight_id = tests.g('fight1') $$,
                  $$ values (77, 2) $$, 'pool includes u4');
select is(public.my_balance(), 960, 'u4 balance after bet');
select lives_ok($$ select public.cancel_bet(tests.g('b_u4_f1')) $$, 'u4 cancels bet');
select is(public.my_balance(), 1000, 'cancel refunds in full');
select results_eq($$ select blue_total, blue_count from public.fight_pools where fight_id = tests.g('fight1') $$,
                  $$ values (37, 1) $$, 'pool decremented on cancel');
select is((select status from public.bets where id = tests.g('b_u4_f1')), 'cancelled', 'bet marked cancelled');
select throws_ok($$ select public.cancel_bet(tests.g('b_u4_f1')) $$, null, 'BET_NOT_ACTIVE', 'cannot cancel twice');
reset role;
select is((select count(*)::int from public.points_ledger where ref_id = tests.g('b_u4_f1') and reason = 'bet_cancel'), 1,
          'bet_cancel ledger row');

select tests.login('u1');
set local role authenticated;
select throws_ok($$ select public.cancel_bet(tests.g('b_u4_f1')) $$, null, 'BET_NOT_FOUND', 'cannot cancel someone else''s bet');
reset role;

-- ===========================================================================
-- 9. Lock by time (now() >= lock_at even if status still 'open')
-- ===========================================================================
select tests.login('u1');
set local role authenticated;
select set_config('t.b_u1_f2', public.place_bet(tests.g('fight2'), 'red', 20)::text, true);
select throws_ok($$ select public.place_bet(tests.g('fight7'), 'red', 10) $$, null, 'FIGHT_LOCKED', 'bet rejected after lock_at (status open)');
select throws_ok($$ select public.cast_vote(tests.g('fight7'), 'red') $$, null, 'FIGHT_LOCKED', 'vote rejected after lock_at (status open)');
reset role;

update public.fights set lock_at = now() - interval '1 second' where id = tests.g('fight2');
select is((select status from public.fights where id = tests.g('fight2')), 'open', 'fight2 still open (cron not run)');

select tests.login('u1');
set local role authenticated;
select throws_ok($$ select public.cancel_bet(tests.g('b_u1_f2')) $$, null, 'FIGHT_LOCKED', 'cancel rejected after lock_at');
select throws_ok($$ select public.cast_vote(tests.g('fight2'), 'blue') $$, null, 'FIGHT_LOCKED', 'vote change rejected after lock_at');
reset role;
select tests.login('u2');
set local role authenticated;
select throws_ok($$ select public.place_bet(tests.g('fight2'), 'red', 10) $$, null, 'FIGHT_LOCKED', 'new bet rejected after lock_at');
reset role;

select ok(private.auto_lock_fights() >= 2, 'auto-lock job locks past-lock fights');
select is((select status from public.fights where id = tests.g('fight2')), 'locked', 'fight2 locked by cron body');
select is((select status from public.fights where id = tests.g('fight1')), 'open', 'future fight untouched by auto-lock');

-- ===========================================================================
-- 10. Admin-only RPCs reject members
-- ===========================================================================
select tests.login('u1');
set local role authenticated;
select throws_ok($$ select public.admin_upsert_fighter(null, 'X', null, null, null, false) $$, null, 'NOT_ADMIN', 'member: upsert_fighter');
select throws_ok($$ select public.admin_create_fight(tests.g('f3'), tests.g('f4'), now(), now(), null) $$, null, 'NOT_ADMIN', 'member: create_fight');
select throws_ok($$ select public.admin_lock_fight(tests.g('fight1')) $$, null, 'NOT_ADMIN', 'member: lock_fight');
select throws_ok($$ select public.admin_settle_fight(tests.g('fight1'), 'red', 'pin', null) $$, null, 'NOT_ADMIN', 'member: settle_fight');
select throws_ok($$ select public.admin_cancel_fight(tests.g('fight1'), 'x') $$, null, 'NOT_ADMIN', 'member: cancel_fight');
select throws_ok($$ select public.admin_create_invite(1, null) $$, null, 'NOT_ADMIN', 'member: create_invite');
select throws_ok($$ select public.admin_revoke_invite('TESTINV1') $$, null, 'NOT_ADMIN', 'member: revoke_invite');
select throws_ok($$ select public.admin_set_member(tests.uid('u1'), true, 'admin', null) $$, null, 'NOT_ADMIN', 'member: set_member (self-promote)');
select throws_ok($$ select public.admin_adjust_points(tests.uid('u1'), 1000, 'x') $$, null, 'NOT_ADMIN', 'member: adjust_points');
reset role;

-- ===========================================================================
-- 11. Lock + vote totals after lock + bets visible after lock
-- ===========================================================================
select tests.login('a1');
set local role authenticated;
select lives_ok($$ select public.admin_lock_fight(tests.g('fight1')) $$, 'admin locks fight1');
reset role;

select tests.login('u2');
set local role authenticated;
select results_eq($$ select red_votes, blue_votes, red_pct, blue_pct from public.get_fight_vote_totals(tests.g('fight1')) $$,
                  $$ values (1, 1, 50.0::numeric, 50.0::numeric) $$, 'totals after lock exclude participant vote');
select results_eq($$ select red_votes, blue_votes from public.fight_vote_totals where fight_id = tests.g('fight1') $$,
                  $$ values (1, 1) $$, 'fight_vote_totals view after lock');
select is((select count(*)::int from public.votes), 1, 'raw votes still private after lock');
select is((select count(*)::int from public.bets where fight_id = tests.g('fight1') and status = 'active'), 3,
          'all bets visible after lock');
select throws_ok($$ select public.place_bet(tests.g('fight1'), 'red', 10) $$, null, 'FIGHT_LOCKED', 'no bets after admin lock');
reset role;

-- ===========================================================================
-- 12. Settlement math + dust + Elo + idempotency
-- ===========================================================================
-- fight1: red U1 100, red U2 50, blue U3 37. total 187, win pool 150.
-- U1 floor(124.67)=124 (+1 dust, largest) = 125; U2 floor(62.33)=62; U3 lost.
select tests.login('a1');
set local role authenticated;
select is((public.admin_settle_fight(tests.g('fight1'), 'red', 'pin', 'Clean pin') ->> 'dust')::int, 1, 'settle returns dust 1');
select throws_ok($$ select public.admin_settle_fight(tests.g('fight1'), 'blue', 'pin', null) $$, null, 'ALREADY_SETTLED',
                 'second settle rejected (idempotent)');
reset role;

select results_eq($$ select status, payout from public.bets where id = tests.g('b_u1_f1') $$, $$ values ('won'::text, 125) $$, 'u1 payout incl dust');
select results_eq($$ select status, payout from public.bets where id = tests.g('b_u2_f1') $$, $$ values ('won'::text, 62) $$, 'u2 payout floor');
select results_eq($$ select status, payout from public.bets where id = tests.g('b_u3_f1') $$, $$ values ('lost'::text, 0) $$, 'u3 lost');
select is((select sum(payout)::int from public.bets where fight_id = tests.g('fight1') and status in ('won','lost')), 187,
          'payouts sum to total pool');
select is((select count(*)::int from public.points_ledger where reason = 'payout' and ref_id in (tests.g('b_u1_f1'), tests.g('b_u2_f1'))), 2,
          'payout ledger rows');
select is(tests.bal('u2'), 1012, 'u2 balance 1000-50+62');
select is((select count(*)::int from public.points_ledger where reason = 'payout' and ref_id = tests.g('b_u1_f1')), 1,
          'no double payout after second settle attempt');
select results_eq($$ select status, winner_side, method, red_elo_before, blue_elo_before, elo_delta, recorded_by
                     from public.fights where id = tests.g('fight1') $$,
                  $$ values ('settled'::text, 'red'::text, 'pin'::text, 1000, 1000, 16, tests.uid('a1')) $$, 'fight row settled + elo stored');
select results_eq($$ select elo, wins, losses, streak from public.fighters where id = tests.g('fr') $$,
                  $$ values (1016, 1, 0, 1) $$, 'red fighter: elo +16, W1, streak +1');
select results_eq($$ select elo, wins, losses, streak from public.fighters where id = tests.g('fb') $$,
                  $$ values (984, 0, 1, -1) $$, 'blue fighter: elo -16, L1, streak -1');
select is((select count(*)::int from public.admin_log where action = 'fight_settle' and target_id = tests.g('fight1')), 1,
          'settle logged');

-- fight3: tie on largest stake → earliest gets dust. red U1 30, red U2 30 (U2 earlier), blue U3 11.
select tests.login('u1'); set local role authenticated;
select set_config('t.b_u1_f3', public.place_bet(tests.g('fight3'), 'red', 30)::text, true);
reset role;
select tests.login('u2'); set local role authenticated;
select set_config('t.b_u2_f3', public.place_bet(tests.g('fight3'), 'red', 30)::text, true);
reset role;
select tests.login('u3'); set local role authenticated;
select public.place_bet(tests.g('fight3'), 'blue', 11);
reset role;
update public.bets set created_at = now() - interval '1 hour' where id = tests.g('b_u2_f3');

select tests.login('a1'); set local role authenticated;
select lives_ok($$ select public.admin_settle_fight(tests.g('fight3'), 'red', 'decision', null) $$, 'settle open fight (auto-lock) works');
reset role;
select results_eq($$ select payout from public.bets where id = tests.g('b_u2_f3') $$, $$ values (36) $$, 'tie: earliest bet gets dust');
select results_eq($$ select payout from public.bets where id = tests.g('b_u1_f3') $$, $$ values (35) $$, 'tie: later bet floor only');
-- Elo 1016 vs 984: exp = 1/(1+10^(-32/400)) = 0.5459 → round(32*0.4541)=15
select results_eq($$ select elo, wins, streak from public.fighters where id = tests.g('fr') $$,
                  $$ values (1031, 2, 2) $$, 'red streak +2, elo +15');
select results_eq($$ select elo, losses, streak from public.fighters where id = tests.g('fb') $$,
                  $$ values (969, 2, -2) $$, 'blue streak -2, elo -15');

-- fight4: zero-winner pool → refund all. U3 already bet blue 481. add U1 blue 20. red wins.
select tests.login('u1'); set local role authenticated;
select set_config('t.b_u1_f4', public.place_bet(tests.g('fight4'), 'blue', 20)::text, true);
reset role;
select set_config('t.u3_before_f4', (tests.bal('u3') + 481)::text, true);
select tests.login('a1'); set local role authenticated;
select is((public.admin_settle_fight(tests.g('fight4'), 'red', 'submission', null) ->> 'refunded')::int, 2,
          'zero winning pool: everyone refunded');
reset role;
select is((select count(*)::int from public.bets where fight_id = tests.g('fight4') and status = 'refunded'), 2, 'bets marked refunded');
select is((select payout from public.bets where id = tests.g('b_u1_f4')), 20, 'refund payout = stake');
select is(tests.bal('u3'), current_setting('t.u3_before_f4')::int, 'u3 fully refunded');
select is((select count(*)::int from public.points_ledger where reason = 'refund' and ref_id = tests.g('b_u1_f4')), 1, 'refund ledger row');

-- admin restrictions on settle
select tests.login('a2'); set local role authenticated;
select throws_ok($$ select public.place_bet(tests.g('fight6'), 'red', 10) $$, null, 'PARTICIPANT', 'admin cannot bet on own fight');
select throws_ok($$ select public.admin_settle_fight(tests.g('fight6'), 'red', 'pin', null) $$, null, 'PARTICIPANT',
                 'admin cannot record own fight');
select public.place_bet(tests.g('fight5'), 'red', 10);
select throws_ok($$ select public.admin_settle_fight(tests.g('fight5'), 'red', 'pin', null) $$, null, 'ADMIN_HAS_BET',
                 'admin with a bet cannot settle that fight');
reset role;

-- ===========================================================================
-- 13. Cancel fight refunds
-- ===========================================================================
select tests.login('u1'); set local role authenticated;
select set_config('t.b_u1_f5', public.place_bet(tests.g('fight5'), 'blue', 25)::text, true);
reset role;
select set_config('t.u1_before_f5', (tests.bal('u1') + 25)::text, true);
select set_config('t.f3_wins', (select wins::text from public.fighters where id = tests.g('f3')), true);

-- Finding: an admin with a bet (or a linked participant) must not be able to
-- void a locked fight via cancel. a2 holds an active 10-point bet on fight5
-- and is linked to f6 (fight6).
select tests.login('a1'); set local role authenticated;
select lives_ok($$ select public.admin_lock_fight(tests.g('fight5')) $$, 'admin locks fight5 before cancel');
reset role;
select set_config('t.a2_before_cancel', tests.bal('a2')::text, true);
select tests.login('a2'); set local role authenticated;
select throws_ok($$ select public.admin_cancel_fight(tests.g('fight5'), 'x') $$, null, 'ADMIN_HAS_BET',
                 'admin with an active bet cannot cancel a locked fight');
select throws_ok($$ select public.admin_cancel_fight(tests.g('fight6'), 'x') $$, null, 'PARTICIPANT',
                 'admin cannot cancel a fight their own fighter is in');
reset role;
select is((select status from public.fights where id = tests.g('fight5')), 'locked', 'blocked cancel leaves fight locked');
select is(tests.bal('a2'), current_setting('t.a2_before_cancel')::int, 'blocked cancel refunds nothing to the betting admin');
select is((select count(*)::int from public.bets where fight_id = tests.g('fight5') and status = 'active'), 2,
          'blocked cancel leaves bets active');
select isnt((select status from public.fights where id = tests.g('fight6')), 'cancelled', 'participant cancel blocked');

select tests.login('a1'); set local role authenticated;
select lives_ok($$ select public.admin_cancel_fight(tests.g('fight5'), 'Fire alarm') $$, 'other admin cancels locked fight');
select throws_ok($$ select public.admin_cancel_fight(tests.g('fight5'), 'again') $$, null, 'FIGHT_CANCELLED', 'cannot cancel twice');
select throws_ok($$ select public.admin_settle_fight(tests.g('fight5'), 'red', 'pin', null) $$, null, 'FIGHT_CANCELLED', 'cannot settle cancelled');
select throws_ok($$ select public.admin_cancel_fight(tests.g('fight1'), 'late') $$, null, 'ALREADY_SETTLED', 'cannot cancel settled');
reset role;
select is((select status from public.fights where id = tests.g('fight5')), 'cancelled', 'fight cancelled');
select is((select count(*)::int from public.bets where fight_id = tests.g('fight5') and status = 'refunded'), 2, 'all active bets refunded');
select is(tests.bal('u1'), current_setting('t.u1_before_f5')::int, 'u1 refunded on cancel');
select is((select wins::text from public.fighters where id = tests.g('f3')), current_setting('t.f3_wins'), 'no record change on cancel');
select tests.login('u1'); set local role authenticated;
select throws_ok($$ select public.place_bet(tests.g('fight5'), 'red', 10) $$, null, 'FIGHT_LOCKED', 'no bets on cancelled fight');
select is((select count(*)::int from public.bets where fight_id = tests.g('fight5')), 2, 'bets of cancelled fight visible');
reset role;

-- ===========================================================================
-- 14. Reactions
-- ===========================================================================
select tests.login('u1'); set local role authenticated;
select is(public.toggle_reaction(tests.g('fight1'), '🔥'), true, 'reaction on');
select is(public.toggle_reaction(tests.g('fight1'), '🔥'), false, 'reaction off');
select is(public.toggle_reaction(tests.g('fight1'), '👑'), true, 'other reaction on');
select throws_ok($$ select public.toggle_reaction(tests.g('fight1'), '🍕') $$, null, 'INVALID_EMOJI', 'emoji outside fixed set rejected');
select is((select count(*)::int from public.reactions where fight_id = tests.g('fight1')), 1, 'reactions readable');
reset role;

-- ===========================================================================
-- 15. Invites + members admin
-- ===========================================================================
select tests.login('a1'); set local role authenticated;
select set_config('t.code', public.admin_create_invite(3, now() + interval '7 days'), true);
select matches(current_setting('t.code'), '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$', 'invite code: 8 chars, no ambiguous chars');
select lives_ok($$ select public.admin_revoke_invite(current_setting('t.code')) $$, 'admin revokes invite');
select throws_ok($$ select public.admin_revoke_invite('NOSUCHCODE') $$, null, 'INVITE_NOT_FOUND', 'revoke unknown invite');
reset role;
select is(tests.hook('newbie', current_setting('t.code')) -> 'error' ->> 'message', 'INVALID_INVITE', 'revoked invite rejected by hook');
reset role;
select ok((select count(*) from public.admin_log where action in ('invite_create', 'invite_revoke')) >= 2, 'invite actions logged');

-- Finding: invite codes must not leak to members through admin_log.
select is_empty($$ select id from public.admin_log
                    where action like 'invite%' and (details ? 'code' or details::text like '%' || current_setting('t.code') || '%') $$,
                'admin_log never stores the plaintext invite code');
select is((select details ->> 'code_hint' from public.admin_log where action = 'invite_create' order by id desc limit 1),
          left(current_setting('t.code'), 2) || '******', 'invite log stores a masked hint');
select tests.login('a1'); set local role authenticated;
select set_config('t.code2', public.admin_create_invite(5, null), true);
select ok((select count(*) from public.admin_log where action like 'invite%') >= 3, 'admins still see invite log rows');
reset role;
select tests.login('u1'); set local role authenticated;
select is((select count(*)::int from public.admin_log where action like 'invite%'), 0, 'members cannot see invite log rows');
select is((select count(*)::int from public.admin_log where details::text like '%' || current_setting('t.code2') || '%'), 0,
          'members cannot find a live invite code anywhere in admin_log');
select ok((select count(*) from public.admin_log where action = 'fight_settle') >= 1, 'members still see other log rows');
reset role;

-- last admin protection
select tests.login('a2'); set local role authenticated;
select lives_ok($$ select public.admin_set_member(tests.uid('a2'), true, 'member', tests.g('f6')) $$, 'a2 demotes self (a1 remains)');
reset role;
select tests.login('a1'); set local role authenticated;
select throws_ok($$ select public.admin_set_member(tests.uid('a1'), true, 'member', null) $$, null, 'LAST_ADMIN', 'last admin cannot demote self');
select throws_ok($$ select public.admin_set_member(tests.uid('a1'), false, null, null) $$, null, 'LAST_ADMIN', 'last admin cannot deactivate self');
reset role;

-- ===========================================================================
-- 16. Weekly points cron body
-- ===========================================================================
-- simulate a negative balance so the top-up path is exercised
insert into public.points_ledger (user_id, delta, reason, note) values (tests.uid('broke'), -1200, 'admin_adjust', 'test');
select set_config('t.u2_before_weekly', tests.bal('u2')::text, true);
select ok(private.weekly_points() >= 9, 'weekly bonus granted to active members');
select is(tests.bal('u2'), current_setting('t.u2_before_weekly')::int + 100, 'weekly +100');
select is(tests.bal('broke'), 100, 'below 10 after bonus topped up to 100');
select is((select count(*)::int from public.points_ledger where user_id = tests.uid('gone') and reason = 'weekly'), 0,
          'inactive members get no weekly bonus');
select is(private.weekly_points(), 0, 'weekly job is idempotent within the week');

-- ===========================================================================
-- 17. Infra: cron jobs, realtime, storage, function hygiene
-- ===========================================================================
select is((select string_agg(jobname || '=' || schedule, ';' order by jobname) from cron.job
            where jobname in ('auto-lock','weekly-points')),
          'auto-lock=* * * * *;weekly-points=0 21 * * 0', 'cron jobs scheduled');
select is((select string_agg(tablename::text, ',' order by tablename::text) from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public'),
          'fight_pools,fights,reactions', 'realtime publication tables');
select results_eq($$ select public, file_size_limit::bigint from storage.buckets where id = 'fighter-photos' $$,
                  $$ values (false, 5242880::bigint) $$, 'private fighter-photos bucket, 5MB');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))
$$, 'every public/private function is security definer with empty search_path');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname <> 'public_next_fight'
$$, 'anon can execute only public_next_fight');
select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
$$, 'RLS enabled on every public table');
select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v')
     and (has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
          or has_table_privilege('authenticated', c.oid, 'delete') or has_table_privilege('anon', c.oid, 'select'))
$$, 'no client write grants; no anon select');

select * from finish();
rollback;
