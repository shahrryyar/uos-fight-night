-- pgTAP suite for WAVE A (CONTRACT ADDENDA A, B1, B2, B3, C0 + review fixes).
-- Run: supabase test db. One transaction, rolled back. Creates its own fixtures
-- (usernames tw_*, nicknames "TW *", cards >= 30 days after the latest card in
-- the DB) so it does not depend on an empty database or on seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();
create schema tw;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function tw.uid(p text) returns uuid language sql immutable as $$
  select md5('tw-user:' || p)::uuid;
$$;
create or replace function tw.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', tw.uid(p), 'role', 'authenticated')::text, true);
$$;
create or replace function tw.mk_user(p text, p_display text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', tw.uid(p), 'authenticated', 'authenticated',
          'tw_' || p || '@members.uosfight.local', '',
          jsonb_build_object('username', 'tw_' || p, 'display_name', p_display),
          '{"provider":"email","providers":["email"]}', now(), now());
$$;
create or replace function tw.bal(p text) returns int language sql as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger where user_id = tw.uid(p);
$$;
create or replace function tw.g(k text) returns uuid language sql as $$
  select current_setting('tw.' || k)::uuid;
$$;
create or replace function tw.d0() returns date language sql as $$
  select current_setting('tw.d0')::date;
$$;
-- Asia/Baghdad wall-clock time on card day d0 + p_off
create or replace function tw.ts(p_off int, p_t time) returns timestamptz language sql as $$
  select ((tw.d0() + p_off) + p_t) at time zone 'Asia/Baghdad';
$$;
-- sum of every ledger row tied to the bets of one fight
create or replace function tw.fight_ledger(p_fight uuid) returns int language sql as $$
  select coalesce(sum(l.delta), 0)::int from public.points_ledger l
   where l.ref_id in (select b.id from public.bets b where b.fight_id = p_fight);
$$;

grant usage on schema tw to authenticated, anon;
grant execute on all functions in schema tw to authenticated, anon;

select set_config('tw.d0', (select (coalesce(max(card_date), (now() at time zone 'Asia/Baghdad')::date) + 30)::text
                              from public.fights), true);

-- users: wa/wb/wc admins, m1..m8 members, fr1/fr2 linked fighters
select tw.mk_user('wa', 'Admin A');
select tw.mk_user('wb', 'Admin B');
select tw.mk_user('wc', 'Admin C');
select tw.mk_user('m1', 'Member 1');
select tw.mk_user('m2', 'Member 2');
select tw.mk_user('m3', 'Member 3');
select tw.mk_user('m4', 'Member 4');
select tw.mk_user('m5', 'Member 5');
select tw.mk_user('m6', 'Member 6');
select tw.mk_user('m7', 'Member 7');
select tw.mk_user('m8', 'Member 8');
select tw.mk_user('fr1', 'Red Corner Guy');
select tw.mk_user('fr2', 'Blue Corner Guy');
update public.profiles set role = 'admin' where id in (tw.uid('wa'), tw.uid('wb'), tw.uid('wc'));

-- ===========================================================================
-- 1. Schema
-- ===========================================================================
select has_column('public', 'fights', c, 'fights.' || c || ' exists')
  from unnest(array['red_weight_kg','blue_weight_kg','rounds','red_score','blue_score','finish_move',
                    'red_accepted_at','blue_accepted_at','cancel_kind','bout_order','is_main_event','card_date']) c;
select col_not_null('public', 'fights', 'bout_order', 'bout_order not null');
select col_not_null('public', 'fights', 'is_main_event', 'is_main_event not null');
select col_not_null('public', 'fights', 'card_date', 'card_date not null');
select col_default_is('public', 'fights', 'status', 'scheduled'::text, 'fights.status defaults to scheduled');
select has_view('public', 'fight_results', 'fight_results view exists');
select ok((select pg_get_constraintdef(oid) like '%payout_reversal%' from pg_constraint
            where conname = 'points_ledger_reason_check'), 'ledger reason allows payout_reversal');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1,
          f || ': exactly one overload')
  from unnest(array['admin_create_fight','admin_settle_fight','admin_cancel_fight','admin_set_member',
                    'public_next_fight','admin_correct_result','accept_fight','decline_fight',
                    'admin_force_open','admin_reorder_card','admin_set_main_event']) f;
select ok(has_function_privilege('authenticated', s, 'execute'), 'authenticated may execute ' || s)
  from unnest(array['public.admin_correct_result(uuid,text)', 'public.accept_fight(uuid)',
                    'public.decline_fight(uuid)', 'public.admin_force_open(uuid,text)',
                    'public.admin_reorder_card(date,uuid[])', 'public.admin_set_main_event(uuid)',
                    'public.admin_cancel_fight(uuid,text,text)',
                    'public.admin_set_member(uuid,boolean,text,uuid,text)',
                    'public.admin_create_fight(uuid,uuid,timestamptz,timestamptz,text,numeric,numeric,int,boolean)',
                    'public.admin_settle_fight(uuid,text,text,text,int,int,int,text,numeric,numeric)']) s;
select ok(not has_function_privilege('anon', s, 'execute'), 'anon may not execute ' || s)
  from unnest(array['public.admin_correct_result(uuid,text)', 'public.accept_fight(uuid)',
                    'public.decline_fight(uuid)', 'public.admin_force_open(uuid,text)']) s;

-- ===========================================================================
-- 2. Fighters (admin wa)
-- ===========================================================================
select tw.login('wa');
set local role authenticated;
select set_config('tw.fa', public.admin_upsert_fighter(null, 'TW A', 70.5, null, null, false)::text, true);
select set_config('tw.fb', public.admin_upsert_fighter(null, 'TW B', 80.0, null, null, false)::text, true);
select set_config('tw.fc', public.admin_upsert_fighter(null, 'TW C', 72.0, null, null, false)::text, true);
select set_config('tw.fd', public.admin_upsert_fighter(null, 'TW D', 75.0, null, null, false)::text, true);
select set_config('tw.fe', public.admin_upsert_fighter(null, 'TW E', 68.0, null, null, false)::text, true);
select set_config('tw.fg', public.admin_upsert_fighter(null, 'TW G', 66.6, null, null, false)::text, true);
select set_config('tw.fh', public.admin_upsert_fighter(null, 'TW H', 77.7, null, null, false)::text, true);
select set_config('tw.fi', public.admin_upsert_fighter(null, 'TW I', null, null, null, false)::text, true);
select set_config('tw.fj', public.admin_upsert_fighter(null, 'TW J', null, null, null, false)::text, true);
select set_config('tw.fk', public.admin_upsert_fighter(null, 'TW K', null, null, null, false)::text, true);
select set_config('tw.fl', public.admin_upsert_fighter(null, 'TW L', null, null, null, false)::text, true);
select set_config('tw.fm', public.admin_upsert_fighter(null, 'TW M', null, null, null, false)::text, true);
select set_config('tw.fn', public.admin_upsert_fighter(null, 'TW N', null, null, null, false)::text, true);
select set_config('tw.fs', public.admin_upsert_fighter(null, 'TW S', null, null, null, false)::text, true);
select public.admin_set_member(tw.uid('fr1'), null, null, tw.g('fa'));
select public.admin_set_member(tw.uid('fr2'), null, null, tw.g('fb'));
reset role;

-- ===========================================================================
-- 3. C0: display_name admin edit, members can't edit it
-- ===========================================================================
select tw.login('wa');
set local role authenticated;
select lives_ok($$ select public.admin_set_member(tw.uid('m1'), null, null, null, '  Fresh Name  ') $$,
                'admin sets display_name');
select is((select display_name from public.profiles where id = tw.uid('m1')), 'Fresh Name', 'display_name trimmed + saved');
select lives_ok($$ select public.admin_set_member(tw.uid('m1'), null, null, null) $$, 'null display_name keeps current');
select is((select display_name from public.profiles where id = tw.uid('m1')), 'Fresh Name', 'display_name kept');
select throws_ok($$ select public.admin_set_member(tw.uid('m1'), null, null, null, '   ') $$,
                 null, 'INVALID_DISPLAY_NAME', 'blank display_name rejected');
select throws_ok($$ select public.admin_set_member(tw.uid('m1'), null, null, null, repeat('x', 25)) $$,
                 null, 'INVALID_DISPLAY_NAME', '25-char display_name rejected');
select is((select details ->> 'display_name' || '|' || (details -> 'prev' ->> 'display_name')
             from public.admin_log where action = 'member_update' and target_id = tw.uid('m1')
            order by id limit 1), 'Fresh Name|Member 1', 'member_update log has display_name + prev');
reset role;

select tw.login('m1');
set local role authenticated;
select throws_ok($$ update public.profiles set display_name = 'Me' where id = tw.uid('m1') $$, '42501', null,
                 'member cannot update own display_name');
select is((select display_name from public.leaderboard_bettors where user_id = tw.uid('m2')), 'Member 2',
          'leaderboard_bettors exposes display_name');
select is((select display_name from public.balances where user_id = tw.uid('m1')), 'Fresh Name',
          'balances exposes display_name');
select is_empty($$ select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                    and has_function_privilege('authenticated', p.oid, 'execute')
                    and p.proname ~ '(display|rename|profile)' $$,
                'no member-callable display_name self-edit RPC exists');
reset role;

-- ===========================================================================
-- 4. B3: create fight -> scheduled, weights snapshot, card_date, bout order, main event
-- ===========================================================================
select tw.login('wa');
set local role authenticated;
-- card d0: b1 (auto 1), b2 main (auto 2), b3 explicit 5, b4 auto 6
select set_config('tw.b1', public.admin_create_fight(tw.g('fg'), tw.g('fh'), tw.ts(0, '19:00'), tw.ts(0, '18:45'), 'B1')::text, true);
select set_config('tw.b2', public.admin_create_fight(tw.g('fi'), tw.g('fj'), tw.ts(0, '22:00'), tw.ts(0, '21:45'), 'B2',
                                                     null, null, null, true)::text, true);
select set_config('tw.b3', public.admin_create_fight(tw.g('fg'), tw.g('fi'), tw.ts(0, '20:00'), tw.ts(0, '19:45'), 'B3',
                                                     71.25, null, 5, false)::text, true);
select set_config('tw.b4', public.admin_create_fight(tw.g('fh'), tw.g('fj'), tw.ts(0, '23:59'), tw.ts(0, '23:30'), 'B4')::text, true);
-- 01:30 Baghdad on d0+1 is 22:30 UTC on d0: card_date follows Baghdad
select set_config('tw.bx', public.admin_create_fight(tw.g('fg'), tw.g('fj'), tw.ts(1, '01:30'), tw.ts(1, '01:00'), 'After midnight')::text, true);
reset role;

select results_eq($$ select status, card_date, bout_order, is_main_event from public.fights where id = tw.g('b1') $$,
                  $$ values ('scheduled'::text, tw.d0(), 1, false) $$, 'b1: scheduled, card d0, bout 1');
select results_eq($$ select bout_order, is_main_event from public.fights where id = tw.g('b2') $$,
                  $$ values (2, true) $$, 'b2: bout 2, main event');
select results_eq($$ select bout_order from public.fights where id = tw.g('b3') $$, $$ values (5) $$, 'b3: explicit bout 5');
select results_eq($$ select bout_order from public.fights where id = tw.g('b4') $$, $$ values (6) $$, 'b4: next number after max');
select results_eq($$ select card_date, (scheduled_at at time zone 'UTC')::date, bout_order from public.fights where id = tw.g('bx') $$,
                  $$ values (tw.d0() + 1, tw.d0(), 1) $$, 'card_date is the Asia/Baghdad date (UTC date differs)');
select results_eq($$ select red_weight_kg, blue_weight_kg from public.fights where id = tw.g('b1') $$,
                  $$ values (66.6::numeric, 77.7::numeric) $$, 'weights snapshot from fighters');
select results_eq($$ select red_weight_kg, blue_weight_kg from public.fights where id = tw.g('b3') $$,
                  $$ values (71.3::numeric, null::numeric) $$, 'weight override param (numeric(5,1)) + null snapshot');
select is((select count(*)::int from public.fight_pools where fight_id = tw.g('b1')), 1, 'fight_pools row created');
select is((select details ->> 'card_date' from public.admin_log where action = 'fight_create' and target_id = tw.g('b1')),
          tw.d0()::text, 'fight_create log has card_date');

select tw.login('wa');
set local role authenticated;
select throws_ok($$ select public.admin_create_fight(tw.g('fg'), tw.g('fh'), tw.ts(0, '21:00'), tw.ts(0, '20:45'), 'dup main',
                                                    null, null, null, true) $$,
                 null, 'MAIN_EVENT_EXISTS', 'second main event on a card rejected');
select throws_ok($$ select public.admin_create_fight(tw.g('fg'), tw.g('fh'), tw.ts(0, '21:00'), tw.ts(0, '20:45'), 'x', -1) $$,
                 null, 'INVALID_WEIGHT', 'negative weight rejected');
select throws_ok($$ select public.admin_create_fight(tw.g('fg'), tw.g('fh'), tw.ts(0, '21:00'), tw.ts(0, '20:45'), 'x',
                                                    null, null, 0) $$,
                 null, 'INVALID_BOUT_ORDER', 'bout order < 1 rejected');

-- reorder: listed first, unlisted keep relative order after
select lives_ok($$ select public.admin_reorder_card(tw.d0(), array[tw.g('b4'), tw.g('b1')]) $$, 'partial reorder');
select results_eq($$ select id from public.fights where card_date = tw.d0() order by bout_order $$,
                  $$ values (tw.g('b4')), (tw.g('b1')), (tw.g('b2')), (tw.g('b3')) $$, 'partial reorder: listed then rest');
select lives_ok($$ select public.admin_reorder_card(tw.d0(), array[tw.g('b3'), tw.g('b2'), tw.g('b1'), tw.g('b4')]) $$, 'full reorder');
select results_eq($$ select id, bout_order from public.fights where card_date = tw.d0() order by bout_order $$,
                  $$ values (tw.g('b3'), 1), (tw.g('b2'), 2), (tw.g('b1'), 3), (tw.g('b4'), 4) $$, 'full reorder 1..n');
select throws_ok($$ select public.admin_reorder_card(tw.d0(), array[tw.g('b1'), tw.g('bx')]) $$,
                 null, 'INVALID_CARD', 'reorder with a fight from another card rejected');
select throws_ok($$ select public.admin_reorder_card(tw.d0(), array[tw.g('b1'), tw.g('b1')]) $$,
                 null, 'INVALID_CARD', 'reorder with duplicates rejected');
select throws_ok($$ select public.admin_reorder_card(tw.d0(), array[]::uuid[]) $$, null, 'INVALID_CARD', 'empty reorder rejected');
select throws_ok($$ select public.admin_reorder_card(null, array[tw.g('b1')]) $$, null, 'INVALID_CARD', 'null card date rejected');

-- main event switch
select lives_ok($$ select public.admin_set_main_event(tw.g('b3')) $$, 'set b3 as main event');
select results_eq($$ select id from public.fights where card_date = tw.d0() and is_main_event $$,
                  $$ values (tw.g('b3')) $$, 'exactly one main event (b3) on the card');
select lives_ok($$ select public.admin_set_main_event(tw.g('b3')) $$, 'set_main_event is idempotent');
select throws_ok($$ select public.admin_set_main_event(gen_random_uuid()) $$, null, 'FIGHT_NOT_FOUND', 'set_main_event unknown fight');
reset role;
select throws_ok($$ update public.fights set is_main_event = true where id = tw.g('b2') $$, '23505', null,
                 'unique index: one main event per card_date');
select is((select count(*)::int from public.admin_log where action in ('card_reorder', 'card_main_event')
            and (target_id = tw.g('b3') or details ->> 'card_date' = tw.d0()::text)), 4, 'reorder + main event logged');

-- a cancelled main event frees the slot
select tw.login('wa');
set local role authenticated;
select lives_ok($$ select public.admin_cancel_fight(tw.g('b3'), 'Venue flooded') $$, 'cancel main event b3');
select lives_ok($$ select public.admin_create_fight(tw.g('fg'), tw.g('fh'), tw.ts(0, '22:30'), tw.ts(0, '22:15'), 'New main',
                                                  null, null, null, true) $$,
                'new main event allowed after old one was cancelled');
select throws_ok($$ select public.admin_set_main_event(tw.g('b3')) $$, null, 'FIGHT_CANCELLED', 'cancelled fight cannot be main event');
reset role;

-- ===========================================================================
-- 5. B2: consent
-- ===========================================================================
select tw.login('wa');
set local role authenticated;
select set_config('tw.k1', public.admin_create_fight(tw.g('fa'), tw.g('fb'), tw.ts(2, '20:00'), tw.ts(2, '19:45'), 'K1')::text, true);
select set_config('tw.k2', public.admin_create_fight(tw.g('fa'), tw.g('fb'), tw.ts(2, '21:00'), tw.ts(2, '20:45'), 'K2')::text, true);
select set_config('tw.k3', public.admin_create_fight(tw.g('fa'), tw.g('fb'), tw.ts(2, '22:00'), tw.ts(2, '21:45'), 'K3')::text, true);
select set_config('tw.k4', public.admin_create_fight(tw.g('fa'), tw.g('fc'), tw.ts(2, '23:00'), tw.ts(2, '22:45'), 'K4')::text, true);
select set_config('tw.k6', public.admin_create_fight(tw.g('fk'), tw.g('fl'), tw.ts(2, '23:30'), tw.ts(2, '23:15'), 'K6')::text, true);
select throws_ok($$ select public.admin_lock_fight(tw.g('k1')) $$, null, 'FIGHT_NOT_OPEN', 'cannot lock a scheduled fight');
select throws_ok($$ select public.admin_settle_fight(tw.g('k1'), 'red', 'pin', null, 1, 1, 0) $$, null, 'FIGHT_NOT_OPEN',
                 'cannot settle a scheduled fight');
select throws_ok($$ select public.admin_cancel_fight(tw.g('k1'), 'hurt', 'no_contest') $$, null, 'FIGHT_NOT_OPEN',
                 'no contest needs open/locked');
reset role;

select tw.login('m1');
set local role authenticated;
select throws_ok($$ select public.cast_vote(tw.g('k1'), 'red') $$, null, 'FIGHT_LOCKED', 'no voting while scheduled');
select throws_ok($$ select public.place_bet(tw.g('k1'), 'red', 10) $$, null, 'FIGHT_LOCKED', 'no betting while scheduled');
select throws_ok($$ select public.accept_fight(tw.g('k1')) $$, null, 'NOT_PARTICIPANT', 'non-fighter cannot accept');
select throws_ok($$ select public.decline_fight(tw.g('k1')) $$, null, 'NOT_PARTICIPANT', 'non-fighter cannot decline');
select throws_ok($$ select public.accept_fight(gen_random_uuid()) $$, null, 'FIGHT_NOT_FOUND', 'accept unknown fight');
reset role;

select tw.login('fr1');
set local role authenticated;
select lives_ok($$ select public.accept_fight(tw.g('k1')) $$, 'red fighter accepts');
select results_eq($$ select status, red_accepted_at is not null, blue_accepted_at is null from public.fights where id = tw.g('k1') $$,
                  $$ values ('scheduled'::text, true, true) $$, 'one acceptance: still scheduled');
select lives_ok($$ select public.accept_fight(tw.g('k1')) $$, 'accepting twice is harmless');
reset role;
select tw.login('fr2');
set local role authenticated;
select lives_ok($$ select public.accept_fight(tw.g('k1')) $$, 'blue fighter accepts');
select results_eq($$ select status, blue_accepted_at is not null from public.fights where id = tw.g('k1') $$,
                  $$ values ('open'::text, true) $$, 'both accepted: fight opens');
select throws_ok($$ select public.accept_fight(tw.g('k1')) $$, null, 'NOT_SCHEDULED', 'accept on open fight rejected');
select throws_ok($$ select public.decline_fight(tw.g('k1')) $$, null, 'NOT_SCHEDULED', 'decline after open rejected');
select lives_ok($$ select public.decline_fight(tw.g('k2')) $$, 'blue fighter declines k2');
reset role;
select results_eq($$ select status, cancel_kind, result_note from public.fights where id = tw.g('k2') $$,
                  $$ values ('cancelled'::text, 'declined'::text, 'Declined by blue corner'::text) $$, 'decline -> cancelled/declined');
select is((select count(*)::int from public.admin_log where action = 'fight_accept' and target_id = tw.g('k1')), 2 + 1,
          'accepts logged');
select is((select details ->> 'side' from public.admin_log where action = 'fight_decline' and target_id = tw.g('k2')), 'blue',
          'decline logged with side');

select tw.login('fr1');
set local role authenticated;
select throws_ok($$ select public.accept_fight(tw.g('k2')) $$, null, 'NOT_SCHEDULED', 'cannot accept a declined fight');
select lives_ok($$ select public.accept_fight(tw.g('k3')) $$, 'red accepts k3');
select lives_ok($$ select public.decline_fight(tw.g('k3')) $$, 'red changes mind and declines k3 while still scheduled');
reset role;
select is((select cancel_kind from public.fights where id = tw.g('k3')), 'declined', 'k3 declined');

-- admin_force_open
select tw.login('m1');
set local role authenticated;
select throws_ok($$ select public.admin_force_open(tw.g('k4'), 'no account') $$, null, 'NOT_ADMIN', 'member cannot force open');
reset role;
select tw.login('wa');
set local role authenticated;
select throws_ok($$ select public.admin_force_open(tw.g('k4'), 'abcd') $$, null, 'REASON_REQUIRED', 'force open needs reason >= 5');
select throws_ok($$ select public.admin_force_open(tw.g('k4'), '  ab   ') $$, null, 'REASON_REQUIRED', 'reason is trimmed');
select throws_ok($$ select public.admin_force_open(tw.g('k4'), null) $$, null, 'REASON_REQUIRED', 'null reason rejected');
select throws_ok($$ select public.admin_force_open(gen_random_uuid(), 'whatever') $$, null, 'FIGHT_NOT_FOUND', 'force open unknown');
-- security: force open cannot override a linked, active fighter who has not accepted
select throws_ok($$ select public.admin_force_open(tw.g('k4'), 'TW A skipped consent') $$, null, 'FIGHTER_HAS_ACCOUNT',
                 'cannot force open over a red corner with an active account');
select set_config('tw.k7', public.admin_create_fight(tw.g('fc'), tw.g('fb'), tw.ts(6, '20:00'), tw.ts(6, '19:45'), 'K7')::text, true);
select throws_ok($$ select public.admin_force_open(tw.g('k7'), 'TW B skipped consent') $$, null, 'FIGHTER_HAS_ACCOUNT',
                 'cannot force open over a blue corner with an active account');
reset role;
select is((select status from public.fights where id = tw.g('k4')), 'scheduled', 'refused force open leaves k4 scheduled');
select tw.login('fr2'); set local role authenticated;
select lives_ok($$ select public.decline_fight(tw.g('k7')) $$, 'linked blue corner can still decline after refused force open');
reset role;
select tw.login('fr1'); set local role authenticated;
select lives_ok($$ select public.accept_fight(tw.g('k4')) $$, 'linked red corner accepts k4');
reset role;
select is((select status from public.fights where id = tw.g('k4')), 'scheduled', 'k4 still scheduled (blue has no account)');
select tw.login('wa'); set local role authenticated;
select lives_ok($$ select public.admin_force_open(tw.g('k4'), 'TW C has no app account') $$, 'admin force opens k4');
select is((select status from public.fights where id = tw.g('k4')), 'open', 'k4 open');
select throws_ok($$ select public.admin_force_open(tw.g('k4'), 'again please') $$, null, 'NOT_SCHEDULED', 'force open twice rejected');
select throws_ok($$ select public.admin_force_open(tw.g('k2'), 'declined one') $$, null, 'NOT_SCHEDULED', 'cannot force open a declined fight');
reset role;
select is((select details ->> 'reason' from public.admin_log where action = 'fight_force_open' and target_id = tw.g('k4')),
          'TW C has no app account', 'force open logged with reason');

-- ===========================================================================
-- 6. B2: no contest refunds, no record change; plain cancel of scheduled
-- ===========================================================================
select tw.login('m1'); set local role authenticated;
select set_config('tw.bet_m1_k1', public.place_bet(tw.g('k1'), 'red', 100)::text, true);
reset role;
select tw.login('m2'); set local role authenticated;
select public.place_bet(tw.g('k1'), 'blue', 50);
reset role;
select is(tw.bal('m1'), 900, 'm1 staked 100');
select set_config('tw.fa_wl', (select wins || '-' || losses || '-' || elo from public.fighters where id = tw.g('fa')), true);

select tw.login('wa'); set local role authenticated;
select throws_ok($$ select public.admin_cancel_fight(tw.g('k1'), 'x', 'bogus') $$, null, 'INVALID_KIND', 'invalid cancel kind');
select lives_ok($$ select public.admin_cancel_fight(tw.g('k1'), 'Injury stop: tapped neck', 'no_contest') $$, 'no contest k1');
select lives_ok($$ select public.admin_cancel_fight(tw.g('k6'), 'Rescheduled') $$, 'plain cancel of a scheduled fight');
reset role;
select results_eq($$ select status, cancel_kind, result_note from public.fights where id = tw.g('k1') $$,
                  $$ values ('cancelled'::text, 'no_contest'::text, 'Injury stop: tapped neck'::text) $$, 'k1 no contest');
select is((select count(*)::int from public.bets where fight_id = tw.g('k1') and status = 'refunded'), 2, 'no contest refunds all bets');
select is(tw.bal('m1'), 1000, 'm1 refunded');
select is(tw.bal('m2'), 1000, 'm2 refunded');
select is(tw.fight_ledger(tw.g('k1')), 0, 'no contest ledger nets to zero');
select is((select wins || '-' || losses || '-' || elo from public.fighters where id = tw.g('fa')), current_setting('tw.fa_wl'),
          'no record change on no contest');
select is((select count(*)::int from public.admin_log where action = 'fight_no_contest' and target_id = tw.g('k1')), 1,
          'no contest logged');
select is((select cancel_kind from public.fights where id = tw.g('k6')), 'cancelled', 'scheduled fight cancelled (kind cancelled)');

-- review fix (b): admin with an active bet cannot cancel / no-contest
select tw.login('wb'); set local role authenticated;
select public.place_bet(tw.g('k4'), 'red', 10);
select throws_ok($$ select public.admin_cancel_fight(tw.g('k4'), 'x') $$, null, 'ADMIN_HAS_BET', 'admin with bet cannot cancel');
select throws_ok($$ select public.admin_cancel_fight(tw.g('k4'), 'x', 'no_contest') $$, null, 'ADMIN_HAS_BET',
                 'admin with bet cannot no-contest');
reset role;

-- ===========================================================================
-- 7. A: settle with match stats + validation; fight_results; rankings
-- ===========================================================================
select tw.login('wa'); set local role authenticated;
select set_config('tw.p0', public.admin_create_fight(tw.g('fd'), tw.g('fe'), tw.ts(3, '18:00'), tw.ts(3, '17:45'), 'P0')::text, true);
select set_config('tw.s1', public.admin_create_fight(tw.g('fc'), tw.g('fd'), tw.ts(3, '19:00'), tw.ts(3, '18:45'), 'S1')::text, true);
select set_config('tw.s2', public.admin_create_fight(tw.g('fc'), tw.g('fe'), tw.ts(3, '20:00'), tw.ts(3, '19:45'), 'S2')::text, true);
select public.admin_force_open(id, 'Testing the fight flow') from public.fights where id in (tw.g('p0'), tw.g('s1'), tw.g('s2'));
-- p0: D beats E (both 1000 -> +16 / -16)
select lives_ok($$ select public.admin_settle_fight(tw.g('p0'), 'red', 'decision', null, 3, 4, 2) $$, 'settle p0');
reset role;

-- s1 bets: m3 red 100, m4 red 50, m5 blue 37, wb (admin) blue 13 -> pool 200, red pool 150
select tw.login('m3'); set local role authenticated; select set_config('tw.bm3', public.place_bet(tw.g('s1'), 'red', 100)::text, true); reset role;
select tw.login('m4'); set local role authenticated; select set_config('tw.bm4', public.place_bet(tw.g('s1'), 'red', 50)::text, true); reset role;
select tw.login('m5'); set local role authenticated; select set_config('tw.bm5', public.place_bet(tw.g('s1'), 'blue', 37)::text, true); reset role;
select tw.login('wb'); set local role authenticated; select set_config('tw.bwb', public.place_bet(tw.g('s1'), 'blue', 13)::text, true); reset role;

select tw.login('wa'); set local role authenticated;
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', null, 0, 1, 0) $$, null, 'INVALID_ROUNDS', 'rounds 0 rejected');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', null, 21, 1, 0) $$, null, 'INVALID_ROUNDS', 'rounds 21 rejected');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', null, null, 1, 0) $$, null, 'INVALID_ROUNDS', 'rounds required');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', null, 1, null, 0) $$, null, 'INVALID_SCORE', 'score required');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', null, 1, -1, 0) $$, null, 'INVALID_SCORE', 'negative score rejected');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'decision', null, 3, 2, 2) $$, null, 'SCORE_MISMATCH',
                 'decision winner must outscore (tie)');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'blue', 'decision', null, 3, 5, 2) $$, null, 'SCORE_MISMATCH',
                 'decision winner must outscore (blue lower)');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', null, 1, 1, 0, repeat('m', 61)) $$, null,
                 'INVALID_FINISH_MOVE', 'finish move over 60 chars rejected');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', repeat('n', 201), 1, 1, 0) $$, null,
                 'INVALID_NOTE', 'note over 200 chars rejected');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', null, 1, 1, 0, null, 0) $$, null,
                 'INVALID_WEIGHT', 'zero weight rejected at settle');
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'draw', null, 1, 1, 0) $$, null, 'INVALID_METHOD', 'no draws');
reset role;
select tw.login('wb'); set local role authenticated;
select throws_ok($$ select public.admin_settle_fight(tw.g('s1'), 'red', 'pin', null, 2, 1, 3) $$, null, 'ADMIN_HAS_BET',
                 'admin with a bet cannot settle');
reset role;

-- first (wrong) result: C (red) wins by pin despite lower score, 2 rounds, move, weight override
select tw.login('wa'); set local role authenticated;
select is((public.admin_settle_fight(tw.g('s1'), 'red', 'pin', '  Ref call  ', 2, 1, 3, ' half nelson ', 73.4) ->> 'dust')::int, 1,
          'settle s1 (pin with lower score allowed), dust 1');
reset role;
select results_eq($$ select status, winner_side, method, rounds, red_score, blue_score, finish_move, result_note,
                            red_weight_kg, blue_weight_kg, red_elo_before, blue_elo_before, elo_delta
                       from public.fights where id = tw.g('s1') $$,
                  $$ values ('settled'::text, 'red'::text, 'pin'::text, 2, 1, 3, 'half nelson'::text, 'Ref call'::text,
                             73.4::numeric, 75.0::numeric, 1000, 1016, 17) $$, 'settled row stores stats + elo');
select results_eq($$ select payout from public.bets where id in (tw.g('bm3'), tw.g('bm4'), tw.g('bm5'), tw.g('bwb'))
                      order by amount desc $$,
                  $$ values (134), (66), (0), (0) $$, 'first payouts: 133+1 dust, 66, losers 0');
select is(tw.bal('m3'), 1034, 'm3 1000-100+134');
select is(tw.bal('m4'), 1016, 'm4 1000-50+66');

select tw.login('m5'); set local role authenticated;
select results_eq($$ select side, result, method, finish_move, rounds, score_for, score_against, weight_kg, opponent_weight_kg, elo_delta,
                            opponent_id, result_note
                       from public.fight_results where fight_id = tw.g('s1') order by side $$,
                  $$ values ('blue'::text, 'L'::text, 'pin'::text, 'half nelson'::text, 2, 3, 1, 75.0::numeric, 73.4::numeric, -17,
                             tw.g('fc'), 'Ref call'::text),
                            ('red'::text, 'W'::text, 'pin'::text, 'half nelson'::text, 2, 1, 3, 73.4::numeric, 75.0::numeric, 17,
                             tw.g('fd'), 'Ref call'::text) $$,
                  'fight_results: one row per fighter perspective');
select results_eq($$ select total_rounds, points_for, points_against, wins_pin, wins_submission, wins_decision,
                            losses_pin, losses_submission, losses_decision, weight_kg
                       from public.fighter_rankings where fighter_id = tw.g('fd') $$,
                  $$ values (5, 7, 3, 0, 0, 1, 1, 0, 0, 75.0::numeric) $$, 'fighter_rankings stats for D (p0 W dec + s1 L pin)');
select results_eq($$ select total_rounds, points_for, points_against, wins_pin, losses_pin from public.fighter_rankings
                      where fighter_id = tw.g('fc') $$,
                  $$ values (2, 1, 3, 1, 0) $$, 'fighter_rankings stats for C');
select results_eq($$ select total_rounds, points_for, wins_pin, losses_pin from public.fighter_rankings where fighter_id = tw.g('fn') $$,
                  $$ values (0, 0, 0, 0) $$, 'fighter without fights: zeros');
reset role;

-- ===========================================================================
-- 8. B1: correct result -> reversal, re-settle, conservation
-- ===========================================================================
select set_config('tw.s1_ledger_settled', tw.fight_ledger(tw.g('s1'))::text, true);
select is(current_setting('tw.s1_ledger_settled')::int, 0, 'settled fight: bets + payouts net to zero');
select results_eq($$ select red_total, red_count, blue_total, blue_count from public.fight_pools where fight_id = tw.g('s1') $$,
                  $$ values (150, 2, 50, 2) $$, 'pool before correction');

select tw.login('m1'); set local role authenticated;
select throws_ok($$ select public.admin_correct_result(tw.g('s1'), 'wrong winner') $$, null, 'NOT_ADMIN', 'member cannot correct');
reset role;
select tw.login('wb'); set local role authenticated;
select throws_ok($$ select public.admin_correct_result(tw.g('s1'), 'wrong winner') $$, null, 'ADMIN_HAS_BET',
                 'admin who bet on the fight cannot correct it');
reset role;
select tw.login('wa'); set local role authenticated;
select throws_ok($$ select public.admin_correct_result(tw.g('s1'), 'oops') $$, null, 'REASON_REQUIRED', 'reason >= 5 chars');
select throws_ok($$ select public.admin_correct_result(tw.g('s1'), '   abcd   ') $$, null, 'REASON_REQUIRED', 'reason trimmed');
select throws_ok($$ select public.admin_correct_result(tw.g('s1'), null) $$, null, 'REASON_REQUIRED', 'reason required');
select throws_ok($$ select public.admin_correct_result(tw.g('k4'), 'not settled yet') $$, null, 'NOT_SETTLED', 'open fight: NOT_SETTLED');
select throws_ok($$ select public.admin_correct_result(tw.g('k1'), 'was a no contest') $$, null, 'NOT_SETTLED', 'cancelled fight: NOT_SETTLED');
select throws_ok($$ select public.admin_correct_result(gen_random_uuid(), 'no such fight') $$, null, 'FIGHT_NOT_FOUND', 'unknown fight');
select results_eq($$ select (r ->> 'reversed_payouts')::int, (r ->> 'bets_restored')::int, r ->> 'status',
                            (r ->> 'red_elo')::int, (r ->> 'blue_elo')::int
                       from (select public.admin_correct_result(tw.g('s1'), 'Ref saw the wrong shoulder') as r) x $$,
                  $$ values (200, 4, 'locked'::text, 1000, 1016) $$, 'correct s1: 200 reversed, 4 bets restored, elo restored');
select throws_ok($$ select public.admin_correct_result(tw.g('s1'), 'Ref saw the wrong shoulder') $$, null, 'NOT_SETTLED',
                 'correcting twice is rejected (idempotent)');
reset role;

select results_eq($$ select status, winner_side, method, rounds, red_score, blue_score, finish_move, result_note,
                            recorded_by, settled_at, red_elo_before, blue_elo_before, elo_delta, red_weight_kg
                       from public.fights where id = tw.g('s1') $$,
                  $$ values ('locked'::text, null::text, null::text, null::int, null::int, null::int, null::text, null::text,
                             null::uuid, null::timestamptz, null::int, null::int, null::int, 73.4::numeric) $$,
                  'result columns cleared, back to locked (weights kept)');
select is((select count(*)::int from public.bets where fight_id = tw.g('s1') and status = 'active' and payout is null), 4,
          'all 4 bets active again with stakes still held');
select is(tw.bal('m3'), 900, 'm3 payout reversed (stake still in play)');
select is(tw.bal('m4'), 950, 'm4 payout reversed');
select is(tw.bal('m5'), 963, 'm5 (loser) unchanged');
select is(tw.bal('wb'), 987 - 10, 'wb (loser) unchanged (also holds a 10 bet on k4)');
select results_eq($$ select user_id, delta from public.points_ledger where reason = 'payout_reversal'
                      and ref_id in (select id from public.bets where fight_id = tw.g('s1')) order by delta $$,
                  $$ values (tw.uid('m3'), -134), (tw.uid('m4'), -66) $$, 'payout_reversal ledger rows = -payout');
select is(tw.fight_ledger(tw.g('s1')), -200, 'after correction the 200 stake is held again');
select results_eq($$ select red_total, red_count, blue_total, blue_count from public.fight_pools where fight_id = tw.g('s1') $$,
                  $$ values (150, 2, 50, 2) $$, 'pool unchanged by correction');
select results_eq($$ select elo, wins, losses, streak from public.fighters where id = tw.g('fc') $$,
                  $$ values (1000, 0, 0, 0) $$, 'C restored: elo 1000, 0-0, streak 0');
select results_eq($$ select elo, wins, losses, streak from public.fighters where id = tw.g('fd') $$,
                  $$ values (1016, 1, 0, 1) $$, 'D restored: elo 1016, 1-0, streak recomputed from history (+1)');
select is_empty($$ select 1 from public.fight_results where fight_id = tw.g('s1') $$, 'corrected fight gone from fight_results');
select results_eq($$ select details ->> 'reason', details -> 'prev' ->> 'winner_side', (details ->> 'reversed_payouts')::int
                       from public.admin_log where action = 'fight_correct' and target_id = tw.g('s1') $$,
                  $$ values ('Ref saw the wrong shoulder'::text, 'red'::text, 200) $$, 'correction logged with reason + previous result');

-- members can't bet on the corrected (locked) fight
select tw.login('m6'); set local role authenticated;
select throws_ok($$ select public.place_bet(tw.g('s1'), 'red', 10) $$, null, 'FIGHT_LOCKED', 'no new bets after correction');
reset role;

-- re-settle: D (blue) wins by decision 5-2 -> blue pool 50: m5 floor(37*200/50)=148, wb floor(13*200/50)=52
select tw.login('wa'); set local role authenticated;
select results_eq($$ select (r ->> 'total_pool')::int, (r ->> 'winning_pool')::int, (r ->> 'dust')::int, (r ->> 'elo_delta')::int
                       from (select public.admin_settle_fight(tw.g('s1'), 'blue', 'decision', null, 3, 2, 5) as r) x $$,
                  $$ values (200, 50, 0, -15) $$, 're-settle after correction');
reset role;
select results_eq($$ select status, payout from public.bets where id in (tw.g('bm3'), tw.g('bm4'), tw.g('bm5'), tw.g('bwb'))
                      order by amount desc $$,
                  $$ values ('lost'::text, 0), ('lost'::text, 0), ('won'::text, 148), ('won'::text, 52) $$, 're-settle payouts');
select is(tw.bal('m3'), 900, 'm3 final: lost 100');
select is(tw.bal('m4'), 950, 'm4 final: lost 50');
select is(tw.bal('m5'), 1111, 'm5 final: 1000-37+148');
select is(tw.bal('wb'), 1039 - 10, 'wb final: 1000-13+52 (minus k4 stake)');
select is(tw.fight_ledger(tw.g('s1')), 0, 'conservation: every point of the fight ledger nets to zero');
select is(tw.bal('m3') + tw.bal('m4') + tw.bal('m5') + tw.bal('wb') + 10, 4000, 'conservation: bettors total unchanged');
select is((select count(*)::int from public.points_ledger where reason = 'payout'
            and ref_id in (select id from public.bets where fight_id = tw.g('s1'))), 4, '2 payouts per settle, 2 settles');
select results_eq($$ select elo, wins, losses, streak from public.fighters where id = tw.g('fd') $$,
                  $$ values (1031, 2, 0, 2) $$, 'D after re-settle: +15, streak 2');
select results_eq($$ select elo, losses, streak from public.fighters where id = tw.g('fc') $$,
                  $$ values (985, 1, -1) $$, 'C after re-settle: -15, streak -1');

-- LATER_FIGHT_EXISTS: s2 (C vs E) settled after s1
select tw.login('wa'); set local role authenticated;
select lives_ok($$ select public.admin_settle_fight(tw.g('s2'), 'blue', 'submission', null, 1, 0, 0, 'arm bar') $$, 'settle s2 (E wins)');
select throws_ok($$ select public.admin_correct_result(tw.g('s1'), 'second thoughts') $$, null, 'LATER_FIGHT_EXISTS',
                 'cannot correct s1 while a later settled fight of C exists');
select throws_ok($$ select public.admin_correct_result(tw.g('p0'), 'second thoughts') $$, null, 'LATER_FIGHT_EXISTS',
                 'cannot correct p0 while later fights of D/E exist');
reset role;
select results_eq($$ select streak from public.fighters where id in (tw.g('fc'), tw.g('fe')) order by nickname $$,
                  $$ values (-2), (1) $$, 'streaks after s2: C -2, E +1');
select tw.login('wa'); set local role authenticated;
select lives_ok($$ select public.admin_correct_result(tw.g('s2'), 'Tap was a slip') $$, 'correct newest (s2) first');
reset role;
select results_eq($$ select elo, losses, streak from public.fighters where id = tw.g('fc') $$,
                  $$ values (985, 1, -1) $$, 'C back to post-s1: streak from history (-1)');
select results_eq($$ select elo, wins, losses, streak from public.fighters where id = tw.g('fe') $$,
                  $$ values (984, 0, 1, -1) $$, 'E back to post-p0: streak from history (-1)');
select tw.login('wa'); set local role authenticated;
select lives_ok($$ select public.admin_correct_result(tw.g('s1'), 'Second correction') $$, 'then s1 can be corrected again');
reset role;
select results_eq($$ select elo, wins, losses, streak from public.fighters where id = tw.g('fd') $$,
                  $$ values (1016, 1, 0, 1) $$, 'D back to post-p0');
select results_eq($$ select elo, wins, losses, streak from public.fighters where id = tw.g('fc') $$,
                  $$ values (1000, 0, 0, 0) $$, 'C back to fresh');
select is(tw.bal('m5'), 963, 'm5 second payout reversed');
select is(tw.bal('wb'), 987 - 10, 'wb second payout reversed');
select is(tw.fight_ledger(tw.g('s1')), -200, 'stakes held again after 2nd correction');
-- a corrected fight can still be voided: no contest refunds everyone
select tw.login('wa'); set local role authenticated;
select lives_ok($$ select public.admin_cancel_fight(tw.g('s1'), 'Footage unclear', 'no_contest') $$, 'no contest after correction');
reset role;
select is(tw.fight_ledger(tw.g('s1')), 0, 'no contest after correction: ledger nets to zero');
select is(tw.bal('m3') + tw.bal('m4') + tw.bal('m5') + tw.bal('wb'), 4000 - 10, 'all four bettors whole again');

-- zero-winner refund settle, then correction reverses the refund too
select tw.login('wa'); set local role authenticated;
select set_config('tw.z1', public.admin_create_fight(tw.g('fi'), tw.g('fj'), tw.ts(4, '20:00'), tw.ts(4, '19:45'), 'Z1')::text, true);
select public.admin_force_open(tw.g('z1'), 'Testing refunds');
reset role;
select tw.login('m6'); set local role authenticated; select set_config('tw.bm6', public.place_bet(tw.g('z1'), 'blue', 40)::text, true); reset role;
select tw.login('wa'); set local role authenticated;
select is((public.admin_settle_fight(tw.g('z1'), 'red', 'pin', null, 1, 1, 0) ->> 'refunded')::int, 1, 'zero-winner pool refunded');
reset role;
select is(tw.bal('m6'), 1000, 'm6 refunded');
select tw.login('wa'); set local role authenticated;
select is((public.admin_correct_result(tw.g('z1'), 'Blue actually won') ->> 'reversed_payouts')::int, 40, 'refund reversed');
reset role;
select results_eq($$ select status, payout from public.bets where id = tw.g('bm6') $$, $$ values ('active'::text, null::int) $$,
                  'refunded bet active again');
select is(tw.bal('m6'), 960, 'm6 stake held again');
select tw.login('wa'); set local role authenticated;
select public.admin_settle_fight(tw.g('z1'), 'blue', 'pin', null, 1, 0, 1);
reset role;
select is(tw.bal('m6'), 1000, 'sole winner gets the whole pool back');
select is(tw.fight_ledger(tw.g('z1')), 0, 'z1 ledger nets to zero');

-- a reversal may leave a balance negative (allowed); betting then blocked
select tw.login('wa'); set local role authenticated;
select set_config('tw.n1', public.admin_create_fight(tw.g('fk'), tw.g('fl'), tw.ts(4, '21:00'), tw.ts(4, '20:45'), 'N1')::text, true);
select public.admin_force_open(tw.g('n1'), 'Testing debt');
reset role;
select tw.login('m7'); set local role authenticated; select public.place_bet(tw.g('n1'), 'red', 400); reset role;
select tw.login('m8'); set local role authenticated; select public.place_bet(tw.g('n1'), 'blue', 400); reset role;
select tw.login('wa'); set local role authenticated;
select public.admin_settle_fight(tw.g('n1'), 'red', 'pin', null, 1, 1, 0);
reset role;
select is(tw.bal('m7'), 1400, 'm7 won 800');
select tw.login('wa'); set local role authenticated;
select public.admin_adjust_points(tw.uid('m7'), -1300, 'spent it');
select lives_ok($$ select public.admin_correct_result(tw.g('n1'), 'Wrong corner recorded') $$, 'correct n1');
reset role;
select is(tw.bal('m7'), -700, 'balance may go negative after reversal');
select tw.login('m7'); set local role authenticated;
select is(public.my_balance(), -700, 'my_balance shows the debt');
select throws_ok($$ select public.place_bet(tw.g('k4'), 'red', 10) $$, null, 'INSUFFICIENT_POINTS', 'cannot bet while in debt');
reset role;

-- ===========================================================================
-- 9. Review fix (a): an admin can't dodge PARTICIPANT by moving their own link
-- ===========================================================================
select tw.login('wa'); set local role authenticated;
select lives_ok($$ select public.admin_set_member(tw.uid('wc'), null, null, tw.g('fs')) $$, 'wa links wc to fighter S');
select set_config('tw.k5', public.admin_create_fight(tw.g('fs'), tw.g('fm'), tw.ts(5, '20:00'), tw.ts(5, '19:45'), 'K5')::text, true);
reset role;

select tw.login('wc'); set local role authenticated;
select throws_ok($$ select public.admin_set_member(tw.uid('wc'), null, null, null) $$, null, 'PARTICIPANT',
                 'admin cannot unlink own fighter while it has a live fight');
select throws_ok($$ select public.admin_set_member(tw.uid('wc'), null, null, tw.g('fn')) $$, null, 'PARTICIPANT',
                 'admin cannot switch own fighter while the old one has a live fight');
select lives_ok($$ select public.admin_set_member(tw.uid('wc'), null, null, tw.g('fs'), 'Commish C') $$,
                'admin can rename self while keeping the same fighter link');
select throws_ok($$ select public.admin_force_open(tw.g('k5'), 'my own fight') $$, null, 'PARTICIPANT', 'participant cannot force open');
select throws_ok($$ select public.admin_cancel_fight(tw.g('k5'), 'scared') $$, null, 'PARTICIPANT', 'participant cannot cancel');
reset role;
select is((select fighter_id from public.profiles where id = tw.uid('wc')), tw.g('fs'), 'wc still linked to S');

select tw.login('wb'); set local role authenticated;
select throws_ok($$ select public.admin_set_member(tw.uid('wb'), null, null, tw.g('fm')) $$, null, 'PARTICIPANT',
                 'admin cannot link self to a fighter with a live fight');
select lives_ok($$ select public.admin_set_member(tw.uid('wb'), null, null, tw.g('fn')) $$, 'admin may link self to an idle fighter');
select lives_ok($$ select public.admin_set_member(tw.uid('wb'), null, null, null) $$, 'and unlink it again');
reset role;

-- another admin unlinks wc; wc is still barred from that fight (link history)
select tw.login('wa'); set local role authenticated;
select lives_ok($$ select public.admin_set_member(tw.uid('wc'), null, null, null) $$, 'another admin may unlink wc');
select lives_ok($$ select public.admin_force_open(tw.g('k5'), 'No app account for M') $$, 'wa force opens k5');
reset role;
select tw.login('wc'); set local role authenticated;
select throws_ok($$ select public.admin_settle_fight(tw.g('k5'), 'red', 'pin', null, 1, 1, 0) $$, null, 'PARTICIPANT',
                 'formerly linked admin cannot settle that fighter''s fight');
select throws_ok($$ select public.admin_cancel_fight(tw.g('k5'), 'void it', 'no_contest') $$, null, 'PARTICIPANT',
                 'formerly linked admin cannot no-contest it');
reset role;
select tw.login('wa'); set local role authenticated;
select lives_ok($$ select public.admin_settle_fight(tw.g('k5'), 'red', 'pin', null, 1, 1, 0) $$, 'neutral admin settles k5');
reset role;
select tw.login('wc'); set local role authenticated;
select throws_ok($$ select public.admin_correct_result(tw.g('k5'), 'I want a redo') $$, null, 'PARTICIPANT',
                 'formerly linked admin cannot correct it');
reset role;
select tw.login('wb'); set local role authenticated;
select lives_ok($$ select public.admin_correct_result(tw.g('k5'), 'Neutral review') $$, 'neutral admin may correct');
reset role;

-- ===========================================================================
-- 10. public_next_fight prefers the main event of the nearest card
-- ===========================================================================
-- clear the board inside this rolled-back txn so the test controls "nearest"
update public.fights set status = 'cancelled', cancel_kind = 'cancelled' where status in ('open', 'locked');
select tw.login('wa'); set local role authenticated;
select set_config('tw.g1', public.admin_create_fight(tw.g('fa'), tw.g('fb'), tw.ts(14, '20:00'), tw.ts(14, '19:45'), 'Only scheduled')::text, true);
select set_config('tw.e1', public.admin_create_fight(tw.g('fg'), tw.g('fh'), tw.ts(20, '19:00'), tw.ts(20, '18:45'), 'E1')::text, true);
select set_config('tw.e2', public.admin_create_fight(tw.g('fi'), tw.g('fj'), tw.ts(20, '21:00'), tw.ts(20, '20:45'), 'E2 main',
                                                     81.5, null, null, true)::text, true);
select set_config('tw.e3', public.admin_create_fight(tw.g('fk'), tw.g('fl'), tw.ts(20, '20:00'), tw.ts(20, '19:45'), 'E3')::text, true);
select set_config('tw.f1', public.admin_create_fight(tw.g('fm'), tw.g('fn'), tw.ts(25, '21:00'), tw.ts(25, '20:45'), 'F1 main',
                                                     null, null, null, true)::text, true);
select public.admin_force_open(id, 'Landing test card') from public.fights
 where id in (tw.g('e1'), tw.g('e2'), tw.g('e3'), tw.g('f1'));
reset role;

set local role anon;
select results_eq($$ select id, title, is_main_event, red_nickname, blue_nickname, red_weight_kg, blue_weight_kg
                       from public.public_next_fight() $$,
                  $$ values (tw.g('e2'), 'E2 main'::text, true, 'TW I'::text, 'TW J'::text, 81.5::numeric, null::numeric) $$,
                  'anon: main event of nearest card (scheduled-only card ignored)');
reset role;
select tw.login('wa'); set local role authenticated;
select public.admin_cancel_fight(tw.g('e2'), 'Main event off');
reset role;
set local role anon;
select results_eq($$ select id, is_main_event from public.public_next_fight() $$, $$ values (tw.g('e1'), false) $$,
                  'no main event: first open fight of nearest card by time');
reset role;
select tw.login('wa'); set local role authenticated;
select public.admin_lock_fight(tw.g('e1'));
select public.admin_cancel_fight(tw.g('e3'), 'off');
reset role;
set local role anon;
select results_eq($$ select id, status from public.public_next_fight() $$, $$ values (tw.g('e1'), 'locked'::text) $$,
                  'locked fight still shown');
reset role;
select tw.login('wa'); set local role authenticated;
select public.admin_settle_fight(tw.g('e1'), 'red', 'pin', null, 1, 1, 0);
reset role;
set local role anon;
select results_eq($$ select id from public.public_next_fight() $$, $$ values (tw.g('f1')) $$, 'falls through to next card');
select throws_ok($$ select * from public.fight_results $$, '42501', null, 'anon cannot read fight_results');
reset role;

-- ===========================================================================
-- 11. Debt from a payout_reversal survives the weekly top-up
--     (weekly_points tops up only balances 0..9; a negative balance gets the
--      +100 bonus and repays gradually)
-- ===========================================================================
insert into public.points_ledger (user_id, delta, reason, note)
select x.uid, 500 - tw.bal(x.p), 'admin_adjust', 'test: reset to 500'
  from (values ('m7', tw.uid('m7')), ('m8', tw.uid('m8'))) x(p, uid)
 where tw.bal(x.p) <> 500;
select tw.login('wa'); set local role authenticated;
select set_config('tw.fp', public.admin_upsert_fighter(null, 'TW P', null, null, null, false)::text, true);
select set_config('tw.fq', public.admin_upsert_fighter(null, 'TW Q', null, null, null, false)::text, true);
select set_config('tw.d1', public.admin_create_fight(tw.g('fp'), tw.g('fq'), tw.ts(30, '20:00'), tw.ts(30, '19:45'), 'Debt')::text, true);
select public.admin_force_open(tw.g('d1'), 'debt test card');
reset role;
select tw.login('m7'); set local role authenticated;
select public.place_bet(tw.g('d1'), 'red', 100);
reset role;
select tw.login('m8'); set local role authenticated;
select public.place_bet(tw.g('d1'), 'blue', 200);
reset role;
select tw.login('wa'); set local role authenticated;
select public.admin_settle_fight(tw.g('d1'), 'red', 'pin', null, 1, 1, 0);
reset role;
select is(tw.bal('m7'), 700, 'debt: m7 won 300 (400 + 300)');
select tw.login('wa'); set local role authenticated;
select public.admin_adjust_points(tw.uid('m7'), -650, 'spent elsewhere');
select results_eq($$ select (r ->> 'reversed_payouts')::int from
                      (select public.admin_correct_result(tw.g('d1'), 'wrong winner recorded') as r) x $$,
                  $$ values (300) $$, 'debt: correction reverses the 300 payout');
reset role;
select is(tw.bal('m7'), -250, 'debt: m7 goes negative after reversal');
select is(tw.bal('m8'), 300, 'debt: m8 stake held again');
select ok(private.weekly_points() >= 2, 'weekly run');
select is(tw.bal('m7'), -150, 'debt: weekly +100 only, debt not wiped');
select is_empty($$ select 1 from public.points_ledger where user_id = tw.uid('m7') and reason = 'topup' $$,
                'debt: no top-up for a negative balance');
select is(tw.bal('m8'), 400, 'debt: m8 gets the weekly +100');

-- ===========================================================================
-- 12. Security (review fix): unlinking / relinking a fighter's member so the
--     fight can be force-opened must not let that member bet on it or count
--     in the crowd vote. place_bet / cast_vote use link history.
-- ===========================================================================
select tw.mk_user('ux1', 'Unlinked Blue');
select tw.mk_user('ux2', 'Relinked Red');
select tw.mk_user('ux3', 'Plain Crowd');
select tw.login('wa'); set local role authenticated;
select set_config('tw.fu', public.admin_upsert_fighter(null, 'TW U', null, null, null, false)::text, true);
select set_config('tw.fv', public.admin_upsert_fighter(null, 'TW V', null, null, null, false)::text, true);
select set_config('tw.fw', public.admin_upsert_fighter(null, 'TW W', null, null, null, false)::text, true);
select set_config('tw.fy', public.admin_upsert_fighter(null, 'TW Y', null, null, null, false)::text, true);
select set_config('tw.fz', public.admin_upsert_fighter(null, 'TW Z', null, null, null, false)::text, true);
select public.admin_set_member(tw.uid('ux1'), null, null, tw.g('fv'));
select public.admin_set_member(tw.uid('ux2'), null, null, tw.g('fy'));
-- X: U (no account) vs V (ux1). Y: Y (ux2) vs Z (no account).
select set_config('tw.ux', public.admin_create_fight(tw.g('fu'), tw.g('fv'), tw.ts(40, '20:00'), tw.ts(40, '19:45'), 'UX')::text, true);
select set_config('tw.uy', public.admin_create_fight(tw.g('fy'), tw.g('fz'), tw.ts(40, '21:00'), tw.ts(40, '20:45'), 'UY')::text, true);
select throws_ok($$ select public.admin_force_open(tw.g('ux'), 'blue has an account') $$, null, 'FIGHTER_HAS_ACCOUNT',
                 'unlink: force open refused while blue is linked');
-- unlink ux1 mid-fight, relink ux2 to another fighter mid-fight, then force open both
select lives_ok($$ select public.admin_set_member(tw.uid('ux1'), null, null, null) $$, 'unlink: admin unlinks ux1');
select lives_ok($$ select public.admin_set_member(tw.uid('ux2'), null, null, tw.g('fw')) $$, 'relink: admin moves ux2 to TW W');
select lives_ok($$ select public.admin_force_open(tw.g('ux'), 'blue has no account now') $$, 'unlink: force open X');
select lives_ok($$ select public.admin_force_open(tw.g('uy'), 'red has no account now') $$, 'relink: force open Y');
reset role;

select tw.login('ux1'); set local role authenticated;
select throws_ok($$ select public.place_bet(tw.g('ux'), 'red', 400) $$, null, 'PARTICIPANT',
                 'unlink: former blue fighter cannot bet against themselves');
select throws_ok($$ select public.place_bet(tw.g('ux'), 'blue', 100) $$, null, 'PARTICIPANT',
                 'unlink: former blue fighter cannot bet on themselves either');
select lives_ok($$ select public.cast_vote(tw.g('ux'), 'red') $$, 'unlink: former fighter may still vote');
reset role;
select is((select is_participant from public.votes where fight_id = tw.g('ux') and user_id = tw.uid('ux1')), true,
          'unlink: former fighter vote is flagged participant (excluded from crowd %)');

select tw.login('ux2'); set local role authenticated;
select throws_ok($$ select public.place_bet(tw.g('uy'), 'blue', 100) $$, null, 'PARTICIPANT',
                 'relink: former red fighter cannot bet on their old fight');
select lives_ok($$ select public.cast_vote(tw.g('uy'), 'blue') $$, 'relink: former fighter may still vote');
reset role;
select is((select is_participant from public.votes where fight_id = tw.g('uy') and user_id = tw.uid('ux2')), true,
          'relink: former fighter vote is flagged participant');
select is_empty($$ select 1 from public.bets where user_id in (tw.uid('ux1'), tw.uid('ux2'))
                                               and fight_id in (tw.g('ux'), tw.g('uy')) $$,
                'unlink/relink: no bets recorded for former fighters');

-- an unrelated member is unaffected
select tw.login('ux3'); set local role authenticated;
select lives_ok($$ select public.place_bet(tw.g('ux'), 'red', 100) $$, 'crowd member can still bet on X');
select lives_ok($$ select public.cast_vote(tw.g('ux'), 'red') $$, 'crowd member can still vote on X');
reset role;
select is((select is_participant from public.votes where fight_id = tw.g('ux') and user_id = tw.uid('ux3')), false,
          'crowd member vote counts in crowd %');

select * from finish();
rollback;
