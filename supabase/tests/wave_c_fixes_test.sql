-- pgTAP for 20261103000014_wave_c_fixes.sql:
--   1. FOTN window opens when the card became complete (a late cancellation of the last
--      bout still gives a full 24h vote; correction + cancel too)
--   2. a custom-title request rejected after a season reset refunds 0 (balance stays 1000);
--      one made in the new season is still refunded
--   3. get_card_recap returns the champion as of the card, not today's
-- One transaction, rolled back. Own fixtures (usernames tf_*, nicknames "TF *", cards >= 90 days
-- after the latest card in the DB). Assertions only look at this file's own rows.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();
create schema twf;

create or replace function twf.uid(p text) returns uuid language sql immutable as $$
  select md5('tf-user:' || p)::uuid;
$$;
create or replace function twf.f(p text) returns uuid language sql immutable as $$
  select md5('tf-fighter:' || p)::uuid;
$$;
create or replace function twf.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', twf.uid(p), 'role', 'authenticated')::text, true);
$$;
create or replace function twf.mk_user(p text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', twf.uid(p), 'authenticated', 'authenticated',
          'tf_' || p || '@members.uosfight.local', '',
          jsonb_build_object('username', 'tf_' || p, 'display_name', 'TF ' || p),
          '{"provider":"email","providers":["email"]}', now(), now());
$$;
create or replace function twf.bal(p text) returns int language sql as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger where user_id = twf.uid(p);
$$;
create or replace function twf.put(k text, v text) returns text language sql as $$
  select set_config('twf.' || k, v, true);
$$;
create or replace function twf.g(k text) returns uuid language sql as $$
  select current_setting('twf.' || k)::uuid;
$$;
create or replace function twf.d(p_off int) returns date language sql as $$
  select current_setting('twf.d0')::date + p_off;
$$;
create or replace function twf.ts(p_off int, p_t time) returns timestamptz language sql as $$
  select (twf.d(p_off) + p_t) at time zone 'Asia/Baghdad';
$$;
create or replace function twf.fight(p_red text, p_blue text, p_off int, p_t time)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  v := public.admin_create_fight(twf.f(p_red), twf.f(p_blue), twf.ts(p_off, p_t),
                                 twf.ts(p_off, p_t) - interval '15 minutes', 'TF ' || p_red || ' v ' || p_blue,
                                 null, null, null, false);
  update public.fights set red_accepted_at = now(), blue_accepted_at = now(), status = 'open' where id = v;
  return v;
end;
$$;
create or replace function twf.settle(p_fight uuid, p_side text) returns jsonb language plpgsql as $$
begin
  perform public.admin_lock_fight(p_fight);
  return public.admin_settle_fight(p_fight, p_side, 'pin', null, 2,
                                   case p_side when 'red' then 3 else 1 end,
                                   case p_side when 'red' then 1 else 3 end);
end;
$$;
create or replace function twf.age(p_fight uuid, p_by interval) returns void language sql as $$
  update public.fights set settled_at = settled_at - p_by where id = p_fight;
$$;

grant usage on schema twf to authenticated, anon;
grant execute on all functions in schema twf to authenticated, anon;

select twf.put('d0', (select (coalesce(max(card_date), (now() at time zone 'Asia/Baghdad')::date) + 90)::text
                        from public.fights));

select twf.mk_user('a1');
select twf.mk_user(u) from unnest(array['m1', 'm2']) u;
update public.profiles set role = 'admin' where id = twf.uid('a1');
insert into public.fighters (id, nickname, weight_kg)
select twf.f(n), 'TF ' || n, 70.5
  from unnest(array['A','B','C','D','E','F','G','H','K','L','P1','P2']) n;

-- ===========================================================================
-- 1. FOTN window = 24h from when the card became complete
-- ===========================================================================
-- 1a. last bout cancelled 30h after the only settle
select twf.login('a1'); set local role authenticated;
select twf.put('ab', twf.fight('A', 'B', 1, '20:00')::text);
select twf.put('cd', twf.fight('C', 'D', 1, '21:00')::text);
select twf.settle(twf.g('ab'), 'red');
reset role;
select twf.age(twf.g('ab'), interval '30 hours');
select twf.login('m1'); set local role authenticated;
select is(public.get_fotn(twf.d(1)) ->> 'status', 'not_ready', 'late cancel: not ready while a bout is scheduled');
reset role;
select twf.login('a1'); set local role authenticated;
select public.admin_cancel_fight(twf.g('cd'), 'injury', 'cancelled');
reset role;
select is((select count(*)::int from public.fotn_results where card_date = twf.d(1)), 0,
          'late cancel: card not finalized on the spot');
select twf.login('m1'); set local role authenticated;
select is(public.get_fotn(twf.d(1)) ->> 'status', 'open', 'late cancel: voting is open');
select is((public.get_fotn(twf.d(1)) ->> 'opens_at')::timestamptz,
          (select settled_at from public.fights where id = twf.g('cd')), 'late cancel: opens when the last bout was cancelled');
select is((public.get_fotn(twf.d(1)) ->> 'closes_at')::timestamptz,
          (select settled_at + interval '24 hours' from public.fights where id = twf.g('cd')),
          'late cancel: closes 24h after the card became complete');
select ok((public.get_fotn(twf.d(1)) ->> 'closes_at')::timestamptz >= now() + interval '24 hours',
          'late cancel: a full 24h window remains');
select lives_ok(format($$ select public.cast_fotn_vote(%L) $$, twf.g('ab')), 'late cancel: member can vote');
select is(public.get_fotn(twf.d(1)) ->> 'my_vote', twf.g('ab')::text, 'late cancel: vote recorded');
reset role;
-- close the window: winner is the voted bout
update public.fights set settled_at = settled_at - interval '25 hours' where card_date = twf.d(1);
select is(private.fotn_finalize(twf.d(1)), true, 'late cancel: finalizes once the 24h are over');
select results_eq(format($$ select winner_fight_id, total_votes from public.fotn_results where card_date = %L $$, twf.d(1)),
                  format($$ values (%L::uuid, 1) $$, twf.g('ab')), 'late cancel: winner + vote count kept');

-- 1b. card closed (no votes), then a result is corrected and that bout cancelled
select twf.login('a1'); set local role authenticated;
select twf.put('ef', twf.fight('E', 'F', 2, '20:00')::text);
select twf.put('gh', twf.fight('G', 'H', 2, '21:00')::text);
select twf.settle(twf.g('ef'), 'red');
select twf.settle(twf.g('gh'), 'blue');
reset role;
update public.fights set settled_at = settled_at - interval '30 hours' where card_date = twf.d(2);
select twf.login('m1'); set local role authenticated;
select is(public.get_fotn(twf.d(2)) ->> 'status', 'closed', 'correction: old window is over');
reset role;
select is((select count(*)::int from public.fotn_results where card_date = twf.d(2)), 1, 'correction: closed card has a result row');
select twf.login('a1'); set local role authenticated;
select public.admin_correct_result(twf.g('gh'), 'wrong corner recorded');
select public.admin_cancel_fight(twf.g('gh'), 'void after review', 'no_contest');
reset role;
select is((select count(*)::int from public.fotn_results where card_date = twf.d(2)), 0,
          'correction + cancel: card not re-finalized on the spot');
select twf.login('m2'); set local role authenticated;
select is(public.get_fotn(twf.d(2)) ->> 'status', 'open', 'correction + cancel: a new 24h vote opens');
select is((public.get_fotn(twf.d(2)) ->> 'closes_at')::timestamptz,
          (select settled_at + interval '24 hours' from public.fights where id = twf.g('gh')),
          'correction + cancel: window counts from the cancel');
select lives_ok(format($$ select public.cast_fotn_vote(%L) $$, twf.g('ef')), 'correction + cancel: member can vote');
reset role;

-- 1c. cancellation a few hours after the last settle does not cut the window short
select twf.login('a1'); set local role authenticated;
select twf.put('kl', twf.fight('K', 'L', 3, '20:00')::text);
select twf.put('p12', twf.fight('P1', 'P2', 3, '21:00')::text);
select twf.settle(twf.g('kl'), 'red');
reset role;
select twf.age(twf.g('kl'), interval '20 hours');
select twf.login('a1'); set local role authenticated;
select public.admin_cancel_fight(twf.g('p12'), 'injury', 'cancelled');
reset role;
select twf.login('m1'); set local role authenticated;
select ok((public.get_fotn(twf.d(3)) ->> 'closes_at')::timestamptz >= now() + interval '24 hours',
          'cancel 20h after the settle: still 24h to vote (not 4h)');
reset role;

-- a card whose only "finished" bouts are cancellations is never complete
select is((select complete from private.fotn_window(twf.d(500))), false, 'empty card is not complete');

-- ===========================================================================
-- 2. Title request rejected after a season reset
-- ===========================================================================
select twf.login('a1'); set local role authenticated;
select public.admin_adjust_points(twf.uid('m1'), 300, 'tf: start at 1300');
reset role;
select is(twf.bal('m1'), 1300, 'season: m1 starts at 1300');
select twf.login('m1'); set local role authenticated;
select twf.put('t_old', public.request_title('Old Season')::text);
reset role;
select is(twf.bal('m1'), 800, 'season: request charged 500');

-- nothing may be in progress for the reset (these rows are rolled back with the test)
update public.fights set status = 'cancelled', cancel_kind = 'cancelled', settled_at = clock_timestamp()
 where status in ('open', 'locked');
select twf.login('a1'); set local role authenticated;
select lives_ok($$ select public.admin_end_season('END SEASON', 'TF Next') $$, 'season: admin ends the season');
reset role;
select is(twf.bal('m1'), 1000, 'season: reset to 1000');
select ok((select created_at from public.title_requests where id = twf.g('t_old'))
          < (select started_at from public.seasons where ended_at is null), 'season: request predates the new season');

select twf.login('a1'); set local role authenticated;
select lives_ok(format($$ select public.admin_reject_title(%L, 'Not this one') $$, twf.g('t_old')),
                'season: admin rejects the old-season request');
reset role;
select is(twf.bal('m1'), 1000, 'season: reject after reset leaves the balance at exactly 1000');
select is_empty(format($$ select 1 from public.points_ledger where ref_id = %L and reason = 'shop_refund' $$, twf.g('t_old')),
                'season: no refund row for an old-season request');
select results_eq(format($$ select status from public.title_requests where id = %L $$, twf.g('t_old')),
                  $$ values ('rejected'::text) $$, 'season: request is rejected');
select results_eq(format($$ select (details ->> 'refund')::int, (details ->> 'season_reset')::boolean
                              from public.admin_log where action = 'title_reject' and target_id = %L $$, twf.g('t_old')),
                  $$ values (0, true) $$, 'season: log records refund 0 + season_reset');

-- a request made in the new season is still refunded in full
select twf.login('m1'); set local role authenticated;
select twf.put('t_new', public.request_title('New Season')::text);
reset role;
select is(twf.bal('m1'), 500, 'season: new-season request charged 500');
select twf.login('a1'); set local role authenticated;
select lives_ok(format($$ select public.admin_reject_title(%L) $$, twf.g('t_new')), 'season: admin rejects the new request');
reset role;
select is(twf.bal('m1'), 1000, 'season: new-season request refunded');
select results_eq(format($$ select delta from public.points_ledger where ref_id = %L and reason = 'shop_refund' $$, twf.g('t_new')),
                  $$ values (500) $$, 'season: one refund row of 500');
select results_eq(format($$ select (details ->> 'refund')::int, (details ->> 'season_reset')::boolean
                              from public.admin_log where action = 'title_reject' and target_id = %L $$, twf.g('t_new')),
                  $$ values (500, false) $$, 'season: log records refund 500');

-- ===========================================================================
-- 3. get_card_recap champion as of the card
-- ===========================================================================
-- reigns: P1 from now-20d to now-5d (lost), then P2 since now-5d
update public.belt_reigns set ended_at = greatest(started_at, now() - interval '21 days'), end_reason = 'vacated'
 where ended_at is null;
insert into public.belt_reigns (fighter_id, started_at, ended_at, end_reason)
values (twf.f('P1'), now() - interval '20 days', now() - interval '5 days', 'lost'),
       (twf.f('P2'), now() - interval '5 days', null, null);

-- card 1 finished 10 days ago -> P1
update public.fights set settled_at = now() - interval '10 days' where card_date = twf.d(1);
-- card 2: its last settle is exactly when P2 took the belt -> P2
update public.fights set settled_at = now() - interval '6 days' where id = twf.g('ef');
update public.fights set settled_at = now() - interval '5 days' where id = twf.g('gh');
update public.fights set status = 'settled', cancel_kind = null, winner_side = 'blue', method = 'pin', rounds = 2,
                         red_score = 1, blue_score = 3
 where id = twf.g('gh');

select twf.login('m1'); set local role authenticated;
select is(public.get_card_recap(twf.d(1)) -> 'champion',
          jsonb_build_object('fighter_id', twf.f('P1'), 'nickname', 'TF P1'), 'recap: champion at the time of an old card');
select is(public.get_card_recap(twf.d(2)) -> 'champion',
          jsonb_build_object('fighter_id', twf.f('P2'), 'nickname', 'TF P2'),
          'recap: title won on the card''s last bout counts');
select is(public.get_card_recap(twf.d(400)) -> 'champion',
          jsonb_build_object('fighter_id', twf.f('P2'), 'nickname', 'TF P2'), 'recap: card with no result yet -> current champion');
reset role;

update public.fighters set hidden = true where id = twf.f('P1');
select twf.login('m1'); set local role authenticated;
select is(public.get_card_recap(twf.d(1)) -> 'champion', 'null'::jsonb, 'recap: hidden past champion masked for members');
reset role;
select twf.login('a1'); set local role authenticated;
select is(public.get_card_recap(twf.d(1)) -> 'champion' ->> 'nickname', 'TF P1', 'recap: admins see the hidden past champion');
reset role;
update public.fighters set hidden = false where id = twf.f('P1');

-- vacant belt at the time of the card -> null
update public.fights set settled_at = now() - interval '30 days' where card_date = twf.d(1);
select twf.login('m1'); set local role authenticated;
select is(public.get_card_recap(twf.d(1)) -> 'champion', 'null'::jsonb, 'recap: no champion when the belt was vacant');
reset role;

select * from finish();
rollback;
