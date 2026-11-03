-- pgTAP suite for WAVE B (CONTRACT ADDENDA B4 live scoring, B5 belt, B6 badges,
-- B7 seasons, B1 extension: correct_result reverses belt + badges + season counters).
-- Run: supabase test db. One transaction, rolled back. Own fixtures (usernames
-- tb_*, nicknames "TB *", cards >= 30 days after the latest card in the DB).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();
create schema tb;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function tb.uid(p text) returns uuid language sql immutable as $$
  select md5('tb-user:' || p)::uuid;
$$;
create or replace function tb.f(p text) returns uuid language sql immutable as $$
  select md5('tb-fighter:' || p)::uuid;
$$;
create or replace function tb.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', tb.uid(p), 'role', 'authenticated')::text, true);
$$;
create or replace function tb.mk_user(p text, p_display text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', tb.uid(p), 'authenticated', 'authenticated',
          'tb_' || p || '@members.uosfight.local', '',
          jsonb_build_object('username', 'tb_' || p, 'display_name', p_display),
          '{"provider":"email","providers":["email"]}', now(), now());
$$;
create or replace function tb.bal(p text) returns int language sql as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger where user_id = tb.uid(p);
$$;
create or replace function tb.put(k text, v uuid) returns uuid language sql as $$
  select set_config('tb.' || k, v::text, true)::uuid;
$$;
create or replace function tb.g(k text) returns uuid language sql as $$
  select current_setting('tb.' || k)::uuid;
$$;
create or replace function tb.d0() returns date language sql as $$
  select current_setting('tb.d0')::date;
$$;
create or replace function tb.ts(p_off int, p_t time) returns timestamptz language sql as $$
  select ((tb.d0() + p_off) + p_t) at time zone 'Asia/Baghdad';
$$;
-- create only (status scheduled); caller must be an admin
create or replace function tb.mkfight(p_red text, p_blue text, p_off int, p_t time) returns uuid
language sql as $$
  select public.admin_create_fight(tb.f(p_red), tb.f(p_blue), tb.ts(p_off, p_t),
                                   tb.ts(p_off, p_t) - interval '15 minutes', 'TB ' || p_red || ' v ' || p_blue);
$$;
-- create + force open; caller must be an admin
create or replace function tb.fight(p_red text, p_blue text, p_off int, p_t time) returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := tb.mkfight(p_red, p_blue, p_off, p_t);
  perform public.admin_force_open(v, 'wave b fixture');
  return v;
end;
$$;
create or replace function tb.settle(p_fight uuid, p_side text, p_rs int, p_bs int) returns jsonb language sql as $$
  select public.admin_settle_fight(p_fight, p_side, 'pin', null, 1, p_rs, p_bs);
$$;
create or replace function tb.fb(p_fighter text, p_code text) returns int language sql as $$
  select count(*)::int from public.fighter_badges where fighter_id = tb.f(p_fighter) and code = p_code;
$$;
create or replace function tb.ub(p_user text, p_code text) returns int language sql as $$
  select count(*)::int from public.user_badges where user_id = tb.uid(p_user) and code = p_code;
$$;
create or replace function tb.champ() returns uuid language sql as $$
  select fighter_id from public.belt_reigns where ended_at is null;
$$;
create or replace function tb.title(p_fight uuid) returns boolean language sql as $$
  select is_title_fight from public.fights where id = p_fight;
$$;

grant usage on schema tb to authenticated, anon;
grant execute on all functions in schema tb to authenticated, anon;

select set_config('tb.d0', (select (coalesce(max(card_date), (now() at time zone 'Asia/Baghdad')::date) + 30)::text
                              from public.fights), true);

-- users: ba/bb/bl admins (bl linked to fighter L), m1, u1..u6, mp (linked to fighter P1)
select tb.mk_user('ba', 'Admin BA');
select tb.mk_user('bb', 'Admin BB');
select tb.mk_user('bl', 'Admin Linked');
select tb.mk_user('m1', 'Member One');
select tb.mk_user(u, 'User ' || u) from unnest(array['u1','u2','u3','u4','u5','u6','mp']) u;
update public.profiles set role = 'admin' where id in (tb.uid('ba'), tb.uid('bb'), tb.uid('bl'));

insert into public.fighters (id, nickname)
select tb.f(n), 'TB ' || n
  from unnest(array['A','B','C','D','E','G',
                    'H','I','J','K','M','N','O','Q','R','S','T','U','V',
                    'X1','X2','X3','X4','X5','X6','X7','X8','X9','X10',
                    'P1','P2','P3','P4','P5','P6',
                    'L','LA','LB','LC','LD','LE','LF','LG']) n;
update public.profiles set fighter_id = tb.f('L')  where id = tb.uid('bl');
update public.profiles set fighter_id = tb.f('P1') where id = tb.uid('mp');

-- ===========================================================================
-- 1. Schema, privileges, realtime
-- ===========================================================================
select has_table('public', t, t || ' table exists')
  from unnest(array['live_scores','belt_reigns','badge_catalog','fighter_badges','user_badges','seasons']) t;
select has_view('public', v, v || ' view exists')
  from unnest(array['current_champion','belt_reign_history','live_score_state']) v;
select has_column('public', 'live_scores', c, 'live_scores.' || c)
  from unnest(array['fight_id','round','red_score','blue_score','round_started_at','accumulated_seconds',
                    'round_seconds','running','updated_at','updated_by']) c;
select has_column('public', 'belt_reigns', c, 'belt_reigns.' || c)
  from unnest(array['id','fighter_id','won_fight_id','lost_fight_id','started_at','ended_at']) c;
select has_column('public', 'seasons', c, 'seasons.' || c)
  from unnest(array['id','name','started_at','ended_at','champion_fighter_id','top_bettor_user_id','snapshot']) c;
select has_column('public', 'fighters', 'season_wins', 'fighters.season_wins');
select has_column('public', 'fighters', 'season_losses', 'fighters.season_losses');
select has_column('public', 'fights', 'is_title_fight', 'fights.is_title_fight');
select col_not_null('public', 'fights', 'is_title_fight', 'is_title_fight not null');
select has_column('public', 'fighter_rankings', c, 'fighter_rankings.' || c)
  from unnest(array['season_wins','season_losses','season_fights','season_ranked','season_rank','is_champion']) c;
select is((select string_agg(attname, ',' order by attnum) from pg_attribute
            where attrelid = 'public.fighter_rankings'::regclass and attnum between 1 and 19),
          'fighter_id,nickname,elo,wins,losses,streak,fights,ranked,rank,total_rounds,points_for,points_against,'
          || 'wins_pin,wins_submission,wins_decision,losses_pin,losses_submission,losses_decision,weight_kg',
          'fighter_rankings keeps its existing columns first, in order');
select is((select string_agg(attname, ',' order by attnum) from pg_attribute
            where attrelid = 'public.current_champion'::regclass and attnum between 1 and 4),
          'fighter_id,nickname,since,defenses', 'current_champion(fighter_id, nickname, since, defenses)');
select ok((select pg_get_constraintdef(oid) like '%season_reset%' from pg_constraint
            where conname = 'points_ledger_reason_check'), 'ledger reason allows season_reset');
select ok((select pg_get_constraintdef(oid) like '%payout_reversal%' from pg_constraint
            where conname = 'points_ledger_reason_check'), 'ledger reason still allows payout_reversal');
select ok(exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_scores'),
          'live_scores is in the realtime publication');
select is((select count(*)::int from public.badge_catalog), 12, 'badge catalog: 7 fighter + 4 user codes (+ wave C fight_of_the_night)');
select set_eq($$ select code from public.badge_catalog where kind = 'fighter' $$,
              array['first_win','streak_3','streak_5','upset','iron_man','shutout','belt_holder','fight_of_the_night'], 'fighter codes (+ wave C)');
select set_eq($$ select code from public.badge_catalog where kind = 'user' $$,
              array['sharp_eye','high_roller','perfect_night','comeback'], 'user codes');
select is_empty($$ select code from public.badge_catalog where icon !~ '^[A-Za-z]+$' or label !~ '^[A-Za-z ]+$' $$,
                'badge icons are icon names and labels are plain words (no emoji)');
select is((select count(*)::int from public.seasons where ended_at is null), 1, 'exactly one open season');

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1,
          f || ': exactly one overload')
  from unnest(array['admin_live_update','get_live_score','admin_award_belt','list_badges','admin_end_season',
                    'is_referee','public_next_fight','admin_settle_fight','admin_correct_result']) f;
select is_empty($$
  select p.oid::regprocedure from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('is_referee','require_referee','lock_belt','current_champion_id','refresh_title_flags',
                       'fights_set_title_flag','award_fighter_badge','award_fight_badges','sharp_eye_awards',
                       'sync_sharp_eye','perfect_night_awards','sync_perfect_night','is_comeback',
                       'award_user_badges','fights_badge_sync','get_live_score','admin_live_update',
                       'admin_end_season','admin_award_belt','admin_settle_fight','admin_correct_result',
                       'list_badges','public_next_fight')
     and not (p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""'])
$$, 'every wave B function is security definer with search_path = ''''');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('is_referee','get_live_score','admin_live_update','admin_end_season',
                                'admin_award_belt','list_badges')), 6, 'six new public functions');

select ok(has_function_privilege('authenticated', s, 'execute'), 'authenticated may execute ' || s)
  from unnest(array['public.admin_live_update(uuid,text,int)', 'public.get_live_score(uuid)',
                    'public.admin_award_belt(uuid,text)', 'public.list_badges(text,uuid)',
                    'public.admin_end_season(text,text)', 'public.is_referee()', 'public.public_next_fight()']) s;
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
          array['public_next_fight','public_site_status'], 'anon may execute only public_next_fight (+ wave C public_site_status)');
select is_empty($$ select p.oid from pg_proc p where p.pronamespace = 'private'::regnamespace
                    and (has_function_privilege('authenticated', p.oid, 'execute')
                         or has_function_privilege('anon', p.oid, 'execute')) $$,
                'no private function is executable by clients');

set local role anon;
select throws_ok(format('select * from public.%I', t), '42501', null, 'anon cannot select ' || t)
  from unnest(array['live_scores','belt_reigns','badge_catalog','fighter_badges','user_badges','seasons',
                    'current_champion','belt_reign_history','live_score_state']) t;
select throws_ok($$ select public.admin_live_update(gen_random_uuid(), 'start') $$, '42501', null,
                 'anon cannot execute admin_live_update');
select throws_ok($$ select * from public.get_live_score(gen_random_uuid()) $$, '42501', null,
                 'anon cannot execute get_live_score');
select throws_ok($$ select * from public.list_badges('fighter', gen_random_uuid()) $$, '42501', null,
                 'anon cannot execute list_badges');
reset role;

select tb.login('m1');
set local role authenticated;
select lives_ok($$ select * from public.live_scores $$, 'member reads live_scores');
select lives_ok($$ select * from public.belt_reigns $$, 'member reads belt_reigns');
select lives_ok($$ select * from public.seasons $$, 'member reads seasons');
select lives_ok($$ select * from public.fighter_badges $$, 'member reads fighter_badges');
select lives_ok($$ select * from public.user_badges $$, 'member reads user_badges');
select is(public.is_referee(), false, 'member is not a referee');
select throws_ok($$ insert into public.live_scores (fight_id) values (gen_random_uuid()) $$, '42501', null,
                 'member cannot insert live_scores');
select throws_ok($$ update public.belt_reigns set ended_at = now() $$, '42501', null, 'member cannot update belt_reigns');
select throws_ok($$ insert into public.fighter_badges (fighter_id, code) values (tb.f('A'), 'first_win') $$, '42501', null,
                 'member cannot insert fighter_badges');
select throws_ok($$ delete from public.user_badges $$, '42501', null, 'member cannot delete user_badges');
select throws_ok($$ update public.seasons set name = 'x' $$, '42501', null, 'member cannot update seasons');
reset role;
select tb.login('ba');
set local role authenticated;
select is(public.is_referee(), true, 'admin is a referee (wave B: referee = admin)');
reset role;

-- ===========================================================================
-- 2. B5 belt: award, title flags, defense, transfer, undo, BELT_CHANGED, vacate
-- ===========================================================================
select tb.login('ba');
set local role authenticated;
select public.admin_award_belt(null, 'wave b test reset') where exists (select 1 from public.belt_reigns where ended_at is null);
select is(tb.champ(), null::uuid, 'start without a champion');
select throws_ok($$ select public.admin_award_belt(null, null) $$, null, 'NO_CHAMPION', 'vacate with no champion');
select throws_ok($$ select public.admin_award_belt(gen_random_uuid(), null) $$, null, 'FIGHTER_NOT_FOUND', 'unknown fighter');
select throws_ok($$ select public.admin_award_belt(tb.f('A'), repeat('n', 201)) $$, null, 'INVALID_NOTE', 'note too long');
select tb.put('reignA', (public.admin_award_belt(tb.f('A'), '  Inaugural  ') ->> 'reign_id')::uuid);
select throws_ok($$ select public.admin_award_belt(tb.f('A'), null) $$, null, 'ALREADY_CHAMPION', 'already champion');
reset role;
select tb.login('m1'); set local role authenticated;
select throws_ok($$ select public.admin_award_belt(tb.f('B'), null) $$, null, 'NOT_ADMIN', 'member cannot award the belt');
select results_eq($$ select fighter_id, nickname, defenses, reign_id, won_fight_id from public.current_champion $$,
                  $$ values (tb.f('A'), 'TB A'::text, 0, tb.g('reignA'), null::uuid) $$, 'member sees current champion A');
reset role;
select tb.login('bl'); set local role authenticated;
select throws_ok($$ select public.admin_award_belt(tb.f('L'), null) $$, null, 'PARTICIPANT',
                 'admin cannot give the belt to their own fighter');
reset role;
select results_eq($$ select note, awarded_by, won_fight_id, end_reason from public.belt_reigns where id = tb.g('reignA') $$,
                  $$ values ('Inaugural'::text, tb.uid('ba'), null::uuid, null::text) $$, 'reign row: note, awarded_by');
select is(tb.fb('A', 'belt_holder'), 1, 'admin award gives belt_holder badge (fight_id null)');
select is((select fight_id from public.fighter_badges where fighter_id = tb.f('A') and code = 'belt_holder'), null::uuid,
          'belt_holder from admin award has no fight');
select is((select count(*)::int from public.admin_log where action = 'belt_award' and target_id = tb.f('A')), 1, 'belt_award logged');

select tb.login('ba'); set local role authenticated;
select tb.put('t1', tb.fight('A', 'B', 0, '18:00'));
select tb.put('t2', tb.fight('A', 'C', 0, '19:00'));
select tb.put('t3', tb.fight('C', 'E', 0, '20:00'));
select tb.put('t4', tb.fight('D', 'E', 0, '21:00'));
select tb.put('t5', tb.fight('A', 'D', 0, '22:00'));
select tb.put('t3s', tb.mkfight('C', 'G', 0, '23:00'));   -- stays scheduled
reset role;
select results_eq($$ select tb.title(tb.g('t1')), tb.title(tb.g('t2')), tb.title(tb.g('t3')), tb.title(tb.g('t4')),
                            tb.title(tb.g('t5')), tb.title(tb.g('t3s')) $$,
                  $$ values (true, true, false, false, true, false) $$, 'is_title_fight set at create (champ A in t1,t2,t5)');

select tb.login('ba'); set local role authenticated;
select results_eq($$ select r ->> 'belt', (r ->> 'is_title_fight')::boolean from (select tb.settle(tb.g('t1'), 'red', 2, 1) r) z $$,
                  $$ values ('defended'::text, true) $$, 't1: A beats B -> defended');
reset role;
select is((select defenses from public.current_champion), 1, 'A has 1 defense');
select is(tb.champ(), tb.f('A'), 'A still champion');

select tb.login('ba'); set local role authenticated;
select results_eq($$ select r ->> 'belt', (r ->> 'is_title_fight')::boolean,
                            r -> 'fighter_badges' @> jsonb_build_array(jsonb_build_object('fighter_id', tb.f('C'), 'code', 'belt_holder'))
                       from (select tb.settle(tb.g('t2'), 'blue', 2, 1) r) z $$,
                  $$ values ('changed'::text, true, true) $$, 't2: C beats champ A -> belt changes, belt_holder in result');
reset role;
select is(tb.champ(), tb.f('C'), 'C is the new champion');
select results_eq($$ select ended_at is not null, end_reason, lost_fight_id from public.belt_reigns where id = tb.g('reignA') $$,
                  $$ values (true, 'lost'::text, tb.g('t2')) $$, 'A reign ended: lost at t2');
select results_eq($$ select fighter_id, won_fight_id, defenses, since = (select settled_at from public.fights where id = tb.g('t2'))
                       from public.current_champion $$,
                  $$ values (tb.f('C'), tb.g('t2'), 0, true) $$, 'C reign: won at t2, since = settle time, 0 defenses');
select is((select defenses from public.belt_reign_history where reign_id = tb.g('reignA')), 1, 'history: A reign had 1 defense');
select is((select fight_id from public.fighter_badges where fighter_id = tb.f('C') and code = 'belt_holder'), tb.g('t2'),
          'C belt_holder badge tied to t2');
select results_eq($$ select tb.title(tb.g('t3')), tb.title(tb.g('t5')), tb.title(tb.g('t3s')), tb.title(tb.g('t1')) $$,
                  $$ values (true, false, true, true) $$,
                  'pending flags refreshed (C fights now title, A v D not); settled t1 frozen');

-- correct the title fight: belt goes back to A, C's reign + badges removed
select tb.login('ba'); set local role authenticated;
select results_eq($$ select (r ->> 'belt_restored')::boolean, r ->> 'status', (r ->> 'fighter_badges_removed')::int
                       from (select public.admin_correct_result(tb.g('t2'), 'wrong corner raised') r) z $$,
                  $$ values (true, 'locked'::text, 2) $$, 'correct t2: belt restored, 2 fighter badges removed (belt_holder + first_win)');
reset role;
select is(tb.champ(), tb.f('A'), 'A champion again after correction');
select results_eq($$ select reign_id, defenses from public.current_champion $$, $$ values (tb.g('reignA'), 1) $$,
                  'original A reign reopened, defenses back to 1');
select results_eq($$ select ended_at, end_reason, lost_fight_id from public.belt_reigns where id = tb.g('reignA') $$,
                  $$ values (null::timestamptz, null::text, null::uuid) $$, 'A reign: ended/lost cleared');
select is((select count(*)::int from public.belt_reigns where won_fight_id = tb.g('t2')), 0, 'C reign deleted');
select is(tb.fb('C', 'belt_holder'), 0, 'C belt_holder badge removed');
select is(tb.fb('C', 'first_win'), 0, 'C first_win from t2 removed');
select results_eq($$ select tb.title(tb.g('t2')), tb.title(tb.g('t3')), tb.title(tb.g('t5')), tb.title(tb.g('t3s')) $$,
                  $$ values (true, false, true, false) $$, 'flags refreshed back after correction');
select is((select (details ->> 'belt_restored')::boolean from public.admin_log
            where action = 'fight_correct' and target_id = tb.g('t2')), true, 'fight_correct log has belt_restored');

select tb.login('ba'); set local role authenticated;
select is(tb.settle(tb.g('t2'), 'red', 2, 1) ->> 'belt', 'defended', 're-settle t2: A wins -> defended');
reset role;
select is((select defenses from public.current_champion), 2, 'A has 2 defenses');

-- transfer to D, D defends, then the transfer can't be undone (LATER_FIGHT_EXISTS)
select tb.login('ba'); set local role authenticated;
select is(tb.settle(tb.g('t5'), 'blue', 2, 1) ->> 'belt', 'changed', 't5: D beats A -> D champion');
select is(tb.settle(tb.g('t4'), 'red', 2, 1) ->> 'belt', 'defended', 't4: D beats E -> defended');
select throws_ok($$ select public.admin_correct_result(tb.g('t5'), 'try undo transfer') $$, null, 'LATER_FIGHT_EXISTS',
                 'title fight with a later fight of the new champ cannot be corrected');
reset role;
select results_eq($$ select fighter_id, defenses from public.current_champion $$, $$ values (tb.f('D'), 1) $$, 'D 1 defense');

-- admin reassigns the belt to G; correcting the defense keeps G; correcting the transfer -> BELT_CHANGED
select tb.login('ba'); set local role authenticated;
select lives_ok($$ select public.admin_award_belt(tb.f('G'), 'Stripped for no-show') $$, 'reassign belt to G');
reset role;
select is((select end_reason from public.belt_reigns where won_fight_id = tb.g('t5')), 'reassigned', 'D reign ended: reassigned');
select is(tb.title(tb.g('t3s')), true, 'pending C v G is now a title fight (G champ)');
select tb.login('ba'); set local role authenticated;
select is((public.admin_correct_result(tb.g('t4'), 'defense was wrong') ->> 'belt_restored')::boolean, false,
          'correct a defense: belt untouched');
select is(tb.champ(), tb.f('G'), 'G still champion');
select throws_ok($$ select public.admin_correct_result(tb.g('t5'), 'undo old transfer') $$, null, 'BELT_CHANGED',
                 'transfer fight cannot be corrected once the belt moved on');
-- vacate
select is((public.admin_award_belt(null, 'Vacated') ->> 'prev_fighter_id')::uuid, tb.f('G'), 'vacate returns prev champion');
reset role;
select is(tb.champ(), null::uuid, 'belt vacant');
select is((select end_reason from public.belt_reigns where fighter_id = tb.f('G') order by started_at desc limit 1), 'vacated',
          'G reign ended: vacated');
select is_empty($$ select 1 from public.current_champion $$, 'current_champion empty when vacant');
select is(tb.title(tb.g('t3s')), false, 'pending flags cleared after vacate');
select is((select count(*)::int from public.admin_log where action = 'belt_vacate'), 2, 'belt_vacate logged (test reset + vacate)')
 where exists (select 1 from public.admin_log where action = 'belt_vacate' and details ->> 'note' = 'wave b test reset');
select tb.login('ba'); set local role authenticated;
select is(tb.settle(tb.g('t3'), 'red', 2, 1) ->> 'belt', 'none', 'no champion: belt none');
reset role;

-- ===========================================================================
-- 3. B6 fighter badges
-- ===========================================================================
select tb.login('ba'); set local role authenticated;
select tb.put('h1', tb.fight('H', 'I', 2, '18:00'));
select tb.put('h2', tb.fight('H', 'J', 2, '18:30'));
select tb.put('h3', tb.fight('H', 'K', 2, '19:00'));
select tb.put('h4', tb.fight('H', 'M', 2, '19:30'));
select tb.put('h5', tb.fight('H', 'N', 2, '20:00'));
select tb.put('o1', tb.fight('O', 'I', 2, '20:30'));
select tb.put('q1', tb.fight('Q', 'R', 2, '21:00'));
select tb.put('s1', tb.fight('S', 'T', 2, '21:30'));
select tb.put('v1', tb.fight('U', 'V', 2, '22:00'));
select ok(tb.settle(tb.g('h1'), 'red', 2, 1) -> 'fighter_badges'
            @> jsonb_build_array(jsonb_build_object('fighter_id', tb.f('H'), 'code', 'first_win')), 'h1 result lists first_win');
reset role;
select is(tb.fb('H', 'first_win'), 1, 'H first_win');
select is((select fight_id from public.fighter_badges where fighter_id = tb.f('H') and code = 'first_win'), tb.g('h1'),
          'first_win tied to h1');
select is(tb.fb('I', 'first_win'), 0, 'loser I gets no first_win');
select is(tb.fb('H', 'shutout'), 0, 'no shutout when loser scored');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('h2'), 'red', 2, 1);
reset role;
select is(tb.fb('H', 'first_win'), 1, 'first_win only once');
select is(tb.fb('H', 'streak_3'), 0, 'no streak_3 at 2');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('h3'), 'red', 2, 1);
reset role;
select is(tb.fb('H', 'streak_3'), 1, 'streak_3 at 3 wins in a row');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('h4'), 'red', 2, 1);
select tb.settle(tb.g('h5'), 'red', 2, 1);
reset role;
select is(tb.fb('H', 'streak_5'), 1, 'streak_5 at 5');
select is(tb.fb('H', 'streak_3'), 1, 'streak_3 not repeated at 4/5');
select is((select fight_id from public.fighter_badges where fighter_id = tb.f('H') and code = 'streak_5'), tb.g('h5'), 'streak_5 at h5');

-- shutout + first_win for O
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('o1'), 'red', 3, 0);
reset role;
select is(tb.fb('O', 'shutout'), 1, 'shutout when loser scored 0');
select is(tb.fb('O', 'first_win'), 1, 'O first_win');

-- upset: 900 beats 1000 (gap 100) -> upset; 901 beats 1000 (gap 99) -> none
update public.fighters set elo = 900 where id = tb.f('Q');
update public.fighters set elo = 901 where id = tb.f('S');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('q1'), 'red', 2, 1);
select tb.settle(tb.g('s1'), 'red', 2, 1);
reset role;
select is(tb.fb('Q', 'upset'), 1, 'upset at exactly 100 Elo gap');
select is(tb.fb('S', 'upset'), 0, 'no upset at 99 gap');

-- iron_man for both corners at fight 10
update public.fighters set wins = 5, losses = 4 where id = tb.f('U');
update public.fighters set wins = 4, losses = 5 where id = tb.f('V');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('v1'), 'red', 2, 1);
reset role;
select is(tb.fb('U', 'iron_man'), 1, 'iron_man for winner at 10 fights');
select is(tb.fb('V', 'iron_man'), 1, 'iron_man for loser at 10 fights');
select is(tb.fb('U', 'first_win'), 0, 'no first_win at 6th win');

-- idempotent: awarding again changes nothing
select is(private.award_fight_badges(tb.g('h5')), '[]'::jsonb, 're-award returns nothing new');
select is((select count(*)::int from public.fighter_badges where fight_id = tb.g('h5')), 1, 'still one badge for h5');

-- undo + re-award
select tb.login('ba'); set local role authenticated;
select is((public.admin_correct_result(tb.g('h5'), 'scorer mixup') ->> 'fighter_badges_removed')::int, 1, 'correct h5 removes streak_5');
reset role;
select is(tb.fb('H', 'streak_5'), 0, 'streak_5 gone');
select is((select streak from public.fighters where id = tb.f('H')), 4, 'streak back to 4');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('h5'), 'red', 2, 1);
reset role;
select is(tb.fb('H', 'streak_5'), 1, 'streak_5 re-awarded once on re-settle');

-- list_badges
select tb.login('m1'); set local role authenticated;
select results_eq($$ select code, label, icon, times, last_fight_id from public.list_badges('fighter', tb.f('H')) $$,
                  $$ values ('first_win'::text, 'First Blood'::text, 'HandFist'::text, 1, tb.g('h1')),
                            ('streak_3', 'Heating Up', 'Fire', 1, tb.g('h3')),
                            ('streak_5', 'Unstoppable', 'Lightning', 1, tb.g('h5')) $$,
                  'list_badges(fighter, H) in catalog order');
select throws_ok($$ select * from public.list_badges('team', tb.f('H')) $$, null, 'INVALID_KIND', 'list_badges kind check');
select is_empty($$ select * from public.list_badges('user', tb.uid('m1')) $$, 'user with no badges -> empty');
reset role;
update public.fighters set hidden = true where id = tb.f('O');
select tb.login('m1'); set local role authenticated;
select is_empty($$ select * from public.list_badges('fighter', tb.f('O')) $$, 'hidden fighter badges hidden from members');
select is((select count(*)::int from public.fighter_badges where fighter_id = tb.f('O')), 0,
          'hidden fighter badges hidden from members on direct select');
reset role;
select ok((select count(*) from public.fighter_badges where fighter_id = tb.f('O')) > 0, 'fixture: O has fighter_badges rows');
select tb.login('ba'); set local role authenticated;
select is((select count(*)::int from public.list_badges('fighter', tb.f('O'))), 2, 'admin sees hidden fighter badges');
select ok((select count(*) from public.fighter_badges where fighter_id = tb.f('O')) > 0,
          'admin reads hidden fighter badges on direct select');
reset role;
update public.fighters set hidden = false where id = tb.f('O');

-- ===========================================================================
-- 4. B6 user badges: sharp_eye, high_roller, comeback, perfect_night
-- ===========================================================================
-- five single-fight cards (days 4..8); red wins every one
select tb.login('ba'); set local role authenticated;
select tb.put('e' || i, tb.fight('X' || (2 * i - 1), 'X' || (2 * i), 3 + i, '20:00')) from generate_series(1, 5) i;
-- comeback setup for u5: 1000 -> 40 -> 940
select public.admin_adjust_points(tb.uid('u5'), -960, 'test dip');
select public.admin_adjust_points(tb.uid('u5'), 900, 'test refill');
reset role;

-- u1: red on all 5; u2: red on 1-4, blue on 5
select tb.login('u1'); set local role authenticated;
select public.cast_vote(tb.g('e' || i), 'red') from generate_series(1, 5) i;
reset role;
select tb.login('u2'); set local role authenticated;
select public.cast_vote(tb.g('e' || i), case when i = 5 then 'blue' else 'red' end) from generate_series(1, 5) i;
reset role;
-- bets: u3 400 red on e5 (high roller), u4 399 red on e5; u5 20 red on e4, u6 200 blue on e4
select tb.login('u3'); set local role authenticated; select public.place_bet(tb.g('e5'), 'red', 400); reset role;
select tb.login('u4'); set local role authenticated; select public.place_bet(tb.g('e5'), 'red', 399); reset role;
select tb.login('u5'); set local role authenticated; select public.place_bet(tb.g('e4'), 'red', 20); reset role;
select tb.login('u6'); set local role authenticated; select public.place_bet(tb.g('e4'), 'blue', 200); reset role;

select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('e' || i), 'red', 2, 1) from generate_series(1, 4) i;
reset role;
select is(tb.ub('u1', 'sharp_eye'), 0, 'no sharp_eye after 4 correct picks');
select is(tb.ub('u5', 'comeback'), 1, 'comeback: 40 -> 1140 after winning e4');
select is((select fight_id from public.user_badges where user_id = tb.uid('u5') and code = 'comeback'), tb.g('e4'), 'comeback tied to e4');
select is(tb.bal('u5'), 1140, 'u5 balance 940 - 20 + 220');
select is(tb.ub('u6', 'comeback'), 0, 'loser gets no comeback');

select tb.login('ba'); set local role authenticated;
select is((tb.settle(tb.g('e5'), 'red', 2, 1) ->> 'user_badges')::int, 1, 'e5 settle: 1 bet-based user badge (high_roller)');
reset role;
select is(tb.ub('u1', 'sharp_eye'), 1, 'sharp_eye after 5 correct picks in a row');
select is((select fight_id from public.user_badges where user_id = tb.uid('u1') and code = 'sharp_eye'), tb.g('e5'), 'sharp_eye at e5');
select is(tb.ub('u2', 'sharp_eye'), 0, 'run broken at 5th pick: no sharp_eye');
select is(tb.ub('u3', 'high_roller'), 1, 'high_roller for a 400 winning pick');
select is(tb.ub('u4', 'high_roller'), 0, 'no high_roller at 399');
select is(tb.ub('u3', 'comeback'), 0, 'no comeback without a dip under 50');
select is(private.award_user_badges(tb.g('e5')), 0, 'user badges idempotent');
select is(tb.ub('u1', 'sharp_eye'), 1, 'still one sharp_eye after re-run');

-- undo e5 -> sharp_eye + high_roller removed; re-settle -> back
select tb.login('ba'); set local role authenticated;
select is((public.admin_correct_result(tb.g('e5'), 'pick audit') ->> 'user_badges_removed')::int, 2,
          'correct e5 removes 2 user badges (sharp_eye + high_roller)');
reset role;
select is(tb.ub('u1', 'sharp_eye') + tb.ub('u3', 'high_roller'), 0, 'badges gone after correction');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('e5'), 'red', 2, 1);
reset role;
select is(tb.ub('u1', 'sharp_eye') + tb.ub('u3', 'high_roller'), 2, 'badges back after re-settle');
-- undo e4 -> comeback removed (payout reversed)
select tb.login('ba'); set local role authenticated;
select public.admin_correct_result(tb.g('e4'), 'pool audit');
reset role;
select is(tb.ub('u5', 'comeback'), 0, 'comeback removed with the payout');
select is(tb.bal('u5'), 920, 'u5 payout reversed');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('e4'), 'red', 2, 1);
reset role;
select is(tb.ub('u5', 'comeback'), 1, 'comeback back after re-settle');

-- perfect_night: card day 10, PN1 + PN2 + PN3 (scheduled). mp is linked to P1.
select tb.login('ba'); set local role authenticated;
select tb.put('pn1', tb.mkfight('P1', 'P2', 10, '18:00'));
select tb.put('pn2', tb.fight('P3', 'P4', 10, '19:00'));
select tb.put('pn3', tb.mkfight('P5', 'P6', 10, '20:00'));
reset role;
select tb.login('mp'); set local role authenticated; select public.accept_fight(tb.g('pn1')); reset role;
select tb.login('ba'); set local role authenticated; select public.admin_force_open(tb.g('pn1'), 'other corner no account'); reset role;
select tb.login('u1'); set local role authenticated;
select public.cast_vote(tb.g('pn1'), 'red'); select public.cast_vote(tb.g('pn2'), 'blue'); reset role;
select tb.login('u2'); set local role authenticated;
select public.cast_vote(tb.g('pn1'), 'red'); select public.cast_vote(tb.g('pn2'), 'red'); reset role;
select tb.login('mp'); set local role authenticated;
select public.cast_vote(tb.g('pn1'), 'red'); select public.cast_vote(tb.g('pn2'), 'blue'); reset role;
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('pn1'), 'red', 2, 1);
select tb.settle(tb.g('pn2'), 'blue', 1, 2);
reset role;
select is(tb.ub('u1', 'perfect_night'), 0, 'card not complete while PN3 is scheduled');
select tb.login('ba'); set local role authenticated;
select public.admin_cancel_fight(tb.g('pn3'), 'no show');
reset role;
select is(tb.ub('u1', 'perfect_night'), 1, 'perfect_night once the last fight is cancelled');
select is((select fight_id from public.user_badges where user_id = tb.uid('u1') and code = 'perfect_night'), tb.g('pn2'),
          'credited to the last settled fight');
select is(tb.ub('u2', 'perfect_night'), 0, 'one wrong pick: no perfect_night');
select is(tb.ub('mp', 'perfect_night'), 0, 'participant vote does not count');
select tb.login('ba'); set local role authenticated;
select public.admin_correct_result(tb.g('pn1'), 'card fix');
reset role;
select is(tb.ub('u1', 'perfect_night'), 0, 'perfect_night removed when a card fight is corrected');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('pn1'), 'red', 2, 1);
reset role;
select is((select fight_id from public.user_badges where user_id = tb.uid('u1') and code = 'perfect_night'), tb.g('pn1'),
          'perfect_night back, credited to the now-last settled fight');
select tb.login('u1'); set local role authenticated;
select results_eq($$ select code, times from public.list_badges('user', tb.uid('u1')) $$,
                  $$ values ('sharp_eye'::text, 1), ('perfect_night', 1) $$, 'user lists their own badges');
select is((select count(*)::int from public.user_badges where user_id = tb.uid('u1')), 2, 'user reads own user_badges rows');
reset role;
-- privacy: perfect_night / sharp_eye are derived from private votes
select tb.login('u2'); set local role authenticated;
select is_empty($$ select * from public.list_badges('user', tb.uid('u1')) $$,
                'list_badges(user) of another member is empty');
select is((select count(*)::int from public.user_badges where user_id = tb.uid('u1')), 0,
          'member cannot read another user''s user_badges rows');
select is((select count(*)::int from public.user_badges where user_id <> tb.uid('u2')), 0,
          'member sees only their own user_badges rows');
select is_empty($$ select * from public.user_badges where code = 'perfect_night' and user_id = tb.uid('u1') $$,
                'perfect_night of another member not visible (vote inference blocked)');
reset role;
select tb.login('ba'); set local role authenticated;
select results_eq($$ select code, times from public.list_badges('user', tb.uid('u1')) $$,
                  $$ values ('sharp_eye'::text, 1), ('perfect_night', 1) $$, 'admin lists any user''s badges');
select is((select count(*)::int from public.user_badges where user_id = tb.uid('u1')), 2, 'admin reads any user_badges rows');
reset role;

-- ===========================================================================
-- 5. B4 live scoring: permissions, status rules, state machine
-- ===========================================================================
select tb.login('ba'); set local role authenticated;
select tb.put('lv_sched', tb.mkfight('LA', 'LB', 12, '18:00'));            -- scheduled
select tb.put('lv_open', tb.fight('LC', 'LD', 12, '19:00'));               -- open, before lock
select tb.put('lv', public.admin_create_fight(tb.f('LA'), tb.f('LB'), tb.ts(12, '20:00'),
                                             now() - interval '1 minute', 'TB live'));
select public.admin_force_open(tb.g('lv'), 'live fixture');               -- open, past lock_at
select tb.put('lv_bet', tb.fight('LE', 'LF', 12, '21:00'));
reset role;
select tb.login('bl'); set local role authenticated;
select tb.put('lv_own', public.admin_create_fight(tb.f('L'), tb.f('LG'), tb.ts(12, '22:00'), tb.ts(12, '21:45'), 'TB own'));
select public.accept_fight(tb.g('lv_own'));
reset role;
select tb.login('ba'); set local role authenticated;
select public.admin_force_open(tb.g('lv_own'), 'other corner no account');
select public.admin_lock_fight(tb.g('lv_own'));
reset role;
select tb.login('bb'); set local role authenticated; select public.place_bet(tb.g('lv_bet'), 'red', 50); reset role;
select tb.login('ba'); set local role authenticated; select public.admin_lock_fight(tb.g('lv_bet')); reset role;

select tb.login('m1'); set local role authenticated;
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'start') $$, '42501', 'NOT_REFEREE', 'member is not a referee');
reset role;
select tb.login('bl'); set local role authenticated;
select throws_ok($$ select public.admin_live_update(tb.g('lv_own'), 'start') $$, null, 'PARTICIPANT',
                 'linked admin cannot score own fight');
reset role;
-- an admin whose fighter link was removed still can't (link history)
select tb.login('ba'); set local role authenticated;
select public.admin_set_member(tb.uid('bl'), null, null, null);
reset role;
select tb.login('bl'); set local role authenticated;
select throws_ok($$ select public.admin_live_update(tb.g('lv_own'), 'red_add', 1) $$, null, 'PARTICIPANT',
                 'formerly linked admin still cannot score that fight');
reset role;
select tb.login('bb'); set local role authenticated;
select throws_ok($$ select public.admin_live_update(tb.g('lv_bet'), 'start') $$, null, 'ADMIN_HAS_BET',
                 'admin with a pick on the fight cannot score it');
reset role;
select tb.login('ba'); set local role authenticated;
select throws_ok($$ select public.admin_live_update(tb.g('lv_sched'), 'start') $$, null, 'FIGHT_NOT_LOCKED', 'scheduled fight');
select throws_ok($$ select public.admin_live_update(tb.g('lv_open'), 'start') $$, null, 'FIGHT_NOT_LOCKED', 'open before lock_at');
select throws_ok($$ select public.admin_live_update(gen_random_uuid(), 'start') $$, null, 'FIGHT_NOT_FOUND', 'unknown fight');
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'explode') $$, null, 'INVALID_ACTION', 'unknown action');
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'red_add') $$, null, 'INVALID_VALUE', 'red_add needs a value');
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'red_add', 0) $$, null, 'INVALID_VALUE', 'red_add 0 rejected');
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'blue_add', 21) $$, null, 'INVALID_VALUE', 'blue_add 21 rejected');
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'set_round_seconds', 5) $$, null, 'INVALID_VALUE', 'round too short');
select is_empty($$ select 1 from public.live_scores where fight_id in (tb.g('lv_sched'), tb.g('lv_open'), tb.g('lv')) $$,
                'rejected calls create no live row');
select is((select status from public.fights where id = tb.g('lv')), 'open', 'lv still open (rejections rolled back)');

select results_eq($$ select (r ->> 'running')::boolean, (r ->> 'round')::int, (r ->> 'remaining_seconds')::int,
                            (r ->> 'red_score')::int, (r ->> 'blue_score')::int
                       from (select public.admin_live_update(tb.g('lv'), 'START') r) z $$,
                  $$ values (true, 1, 120, 0, 0) $$, 'start (case-insensitive): running, round 1, 120 s left');
reset role;
select is((select status from public.fights where id = tb.g('lv')), 'locked', 'open fight past lock_at auto-locked by live start');
select is((select (details ->> 'auto')::boolean from public.admin_log where action = 'fight_lock' and target_id = tb.g('lv')), true,
          'auto lock logged');
select results_eq($$ select running, round_started_at = now(), accumulated_seconds, updated_by from public.live_scores
                      where fight_id = tb.g('lv') $$,
                  $$ values (true, true, 0, tb.uid('ba')) $$, 'live row: running from now()');

-- simulate 30 s on the clock
update public.live_scores set round_started_at = round_started_at - interval '30 seconds' where fight_id = tb.g('lv');
select tb.login('m1'); set local role authenticated;
select results_eq($$ select running, elapsed_seconds, remaining_seconds, time_up, is_live, server_now = now()
                       from public.get_live_score(tb.g('lv')) $$,
                  $$ values (true, 30, 90, false, true, true) $$, 'member: get_live_score computes elapsed on the server');
select results_eq($$ select elapsed_seconds, remaining_seconds from public.live_score_state where fight_id = tb.g('lv') $$,
                  $$ values (30, 90) $$, 'live_score_state view agrees');
select is_empty($$ select * from public.get_live_score(tb.g('lv_open')) $$, 'no live row -> empty');
reset role;

select tb.login('ba'); set local role authenticated;
select lives_ok($$ select public.admin_live_update(tb.g('lv'), 'start') $$, 'start while running is a no-op');
reset role;
select is((select accumulated_seconds from public.live_scores where fight_id = tb.g('lv')), 0, 'no-op start keeps segment');
select tb.login('ba'); set local role authenticated;
select results_eq($$ select (r ->> 'running')::boolean, (r ->> 'elapsed_seconds')::int, (r ->> 'remaining_seconds')::int
                       from (select public.admin_live_update(tb.g('lv'), 'pause') r) z $$,
                  $$ values (false, 30, 90) $$, 'pause banks 30 s');
select lives_ok($$ select public.admin_live_update(tb.g('lv'), 'pause') $$, 'pause while paused is a no-op');
reset role;
select results_eq($$ select running, round_started_at, accumulated_seconds from public.live_scores where fight_id = tb.g('lv') $$,
                  $$ values (false, null::timestamptz, 30) $$, 'paused: accumulated 30, no segment');
select tb.login('ba'); set local role authenticated;
select public.admin_live_update(tb.g('lv'), 'start');
reset role;
update public.live_scores set round_started_at = round_started_at - interval '100 seconds' where fight_id = tb.g('lv');
select tb.login('m1'); set local role authenticated;
select results_eq($$ select elapsed_seconds, remaining_seconds, time_up from public.get_live_score(tb.g('lv')) $$,
                  $$ values (120, 0, true) $$, 'clock caps at round_seconds: time up');
reset role;
select tb.login('ba'); set local role authenticated;
select public.admin_live_update(tb.g('lv'), 'pause');
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'start') $$, null, 'ROUND_OVER', 'cannot start a finished round');
select results_eq($$ select (r ->> 'round')::int, (r ->> 'running')::boolean, (r ->> 'remaining_seconds')::int
                       from (select public.admin_live_update(tb.g('lv'), 'next_round') r) z $$,
                  $$ values (2, false, 120) $$, 'next_round: round 2, clock reset, stopped');
select public.admin_live_update(tb.g('lv'), 'red_add', 2);
select public.admin_live_update(tb.g('lv'), 'red_add', -1);
select public.admin_live_update(tb.g('lv'), 'blue_add', 3);
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'red_add', -2) $$, null, 'INVALID_SCORE', 'score cannot go below 0');
select results_eq($$ select (r ->> 'red_score')::int, (r ->> 'blue_score')::int, (r ->> 'round_seconds')::int
                       from (select public.admin_live_update(tb.g('lv'), 'set_round_seconds', 180) r) z $$,
                  $$ values (1, 3, 180) $$, 'scores 1-3, round length 180');
-- set_round_seconds while running keeps elapsed time
select public.admin_live_update(tb.g('lv'), 'start');
reset role;
update public.live_scores set round_started_at = round_started_at - interval '40 seconds' where fight_id = tb.g('lv');
select tb.login('ba'); set local role authenticated;
select results_eq($$ select (r ->> 'elapsed_seconds')::int, (r ->> 'running')::boolean, (r ->> 'round_seconds')::int
                       from (select public.admin_live_update(tb.g('lv'), 'set_round_seconds', 150) r) z $$,
                  $$ values (40, true, 150) $$, 'set_round_seconds while running keeps 40 s elapsed');
reset role;
update public.live_scores set round = 20, running = false, round_started_at = null where fight_id = tb.g('lv');
select tb.login('ba'); set local role authenticated;
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'next_round') $$, null, 'INVALID_ROUNDS', 'max 20 rounds');
select results_eq($$ select (r ->> 'round')::int, (r ->> 'red_score')::int, (r ->> 'blue_score')::int, (r ->> 'running')::boolean,
                            (r ->> 'elapsed_seconds')::int, (r ->> 'round_seconds')::int
                       from (select public.admin_live_update(tb.g('lv'), 'reset') r) z $$,
                  $$ values (1, 0, 0, false, 0, 150) $$, 'reset: round 1, 0-0, stopped, keeps round length');
reset role;
-- 20261103000007: only the opening bell, next round, a changed round length and reset are logged
select results_eq($$ select details ->> 'action' from public.admin_log where action = 'live_update' and target_id = tb.g('lv')
                      order by id $$,
                  $$ values ('start'), ('next_round'), ('set_round_seconds'), ('set_round_seconds'), ('reset') $$,
                  'live updates that change the bout are logged; taps, pause and resume are not');
select is((select details ->> 'action' from public.admin_log where action = 'live_update' and target_id = tb.g('lv')
            order by id desc limit 1), 'reset', 'log carries the action');

-- after settle / cancel
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('lv'), 'blue', 0, 3);
select throws_ok($$ select public.admin_live_update(tb.g('lv'), 'start') $$, null, 'ALREADY_SETTLED', 'no live scoring after settle');
select public.admin_cancel_fight(tb.g('lv_open'), 'off');
select throws_ok($$ select public.admin_live_update(tb.g('lv_open'), 'start') $$, null, 'FIGHT_CANCELLED', 'no live scoring when cancelled');
reset role;
select is((select count(*)::int from public.live_scores where fight_id = tb.g('lv')), 1, 'live row kept after settle (final display)');

-- ===========================================================================
-- 6. public_next_fight: title flag + champion (anon)
-- ===========================================================================
update public.fights set status = 'cancelled', cancel_kind = 'cancelled' where status in ('open', 'locked');
select tb.login('ba'); set local role authenticated;
select public.admin_award_belt(tb.f('A'), 'Back on top');
select tb.put('pub', tb.fight('B', 'A', 13, '20:00'));
reset role;
set local role anon;
select results_eq($$ select id, is_title_fight, champion_side, champion_nickname from public.public_next_fight() $$,
                  $$ values (tb.g('pub'), true, 'blue'::text, 'TB A'::text) $$, 'anon: title fight, champion in blue corner');
reset role;
select tb.login('ba'); set local role authenticated;
select public.admin_award_belt(null, 'vacate for landing test');
reset role;
set local role anon;
select results_eq($$ select is_title_fight, champion_side, champion_nickname from public.public_next_fight() $$,
                  $$ values (false, null::text, null::text) $$, 'anon: no champion -> no title, null champion');
reset role;
select tb.login('ba'); set local role authenticated;
select public.admin_award_belt(tb.f('A'), 'Back again');
select public.admin_cancel_fight(tb.g('pub'), 'landing test done');
reset role;

-- ===========================================================================
-- 7. B7 seasons
-- ===========================================================================
select tb.login('m1'); set local role authenticated;
select throws_ok($$ select public.admin_end_season('END SEASON', 'Next') $$, '42501', 'NOT_ADMIN', 'member cannot end season');
reset role;
select tb.login('ba'); set local role authenticated;
select tb.put('busy', tb.fight('J', 'K', 14, '20:00'));
select throws_ok($$ select public.admin_end_season('end season', 'Next') $$, null, 'CONFIRM_REQUIRED', 'confirm text is exact');
select throws_ok($$ select public.admin_end_season(null, 'Next') $$, null, 'CONFIRM_REQUIRED', 'confirm required');
select throws_ok($$ select public.admin_end_season('END SEASON', '   ') $$, null, 'INVALID_NAME', 'next name required');
select throws_ok($$ select public.admin_end_season('END SEASON', repeat('x', 41)) $$, null, 'INVALID_NAME', 'next name max 40');
select throws_ok($$ select public.admin_end_season('END SEASON', 'Next') $$, null, 'FIGHTS_IN_PROGRESS', 'open fight blocks reset');
select public.admin_cancel_fight(tb.g('busy'), 'season wrap');
-- make u3 the clear top bettor; give u6 a big balance, then deactivate u6
select public.admin_adjust_points(tb.uid('u3'), 50000, 'test top bettor');
select public.admin_adjust_points(tb.uid('u6'), 4000, 'test inactive hoard');
select public.admin_set_member(tb.uid('u6'), false, null, null);
reset role;
update public.fights set status = 'cancelled', cancel_kind = 'cancelled' where status in ('open', 'locked');

-- the reset covers every profile, active or not
select set_config('tb.pre_sum', (select coalesce(sum(l.delta), 0)::text from public.points_ledger l
                                   join public.profiles p on p.id = l.user_id), true);
select set_config('tb.n_active', (select count(*)::text from public.profiles), true);
select set_config('tb.n_off', (select count(*)::text from (
                                 select p.id from public.profiles p left join public.points_ledger l on l.user_id = p.id
                                  group by p.id having coalesce(sum(l.delta), 0) <> 1000) z), true);
select set_config('tb.u6_bal', tb.bal('u6')::text, true);
select set_config('tb.u3_bal', tb.bal('u3')::text, true);
select set_config('tb.h_wins', (select wins || '-' || losses || '-' || season_wins from public.fighters where id = tb.f('H')), true);
select set_config('tb.s1', (select id::text from public.seasons where ended_at is null), true);
select set_config('tb.s1_name', (select name from public.seasons where ended_at is null), true);

select tb.login('ba'); set local role authenticated;
select set_config('tb.end1', public.admin_end_season('END SEASON', '  Spring 2027  ')::text, true);
reset role;
select results_eq($$ select (r ->> 'champion_fighter_id')::uuid, r ->> 'champion_source', (r ->> 'top_bettor_user_id')::uuid,
                            r ->> 'next_season_name', (r ->> 'members_reset')::int, (r ->> 'points_delta')::bigint
                       from (select current_setting('tb.end1')::jsonb r) z $$,
                  $$ values (tb.f('A'), 'belt'::text, tb.uid('u3'), 'Spring 2027'::text,
                             current_setting('tb.n_off')::int,
                             1000 * current_setting('tb.n_active')::bigint - current_setting('tb.pre_sum')::bigint) $$,
                  'end season result: belt champion, top bettor, reset count, delta');
select is_empty($$ select p.id from public.profiles p left join public.points_ledger l on l.user_id = p.id
                    group by p.id having coalesce(sum(l.delta), 0) <> 1000 $$,
                'every balance (active or not) is exactly 1000');
select is((select coalesce(sum(l.delta), 0)::bigint from public.points_ledger l join public.profiles p on p.id = l.user_id
           ), 1000 * current_setting('tb.n_active')::bigint, 'conservation: total = 1000 x members');
select is((select coalesce(sum(delta), 0)::bigint from public.points_ledger where reason = 'season_reset'),
          1000 * current_setting('tb.n_active')::bigint - current_setting('tb.pre_sum')::bigint,
          'season_reset deltas = exactly the gap to 1000 each');
select is((select count(*)::int from public.points_ledger where reason = 'season_reset'), current_setting('tb.n_off')::int,
          'one season_reset row per member not already at 1000');
select ok(current_setting('tb.u6_bal')::int > 1000, 'precondition: inactive u6 held more than 1000 before reset');
select is(tb.bal('u6'), 1000, 'inactive member balance also reset to 1000');
select is((select delta from public.points_ledger where reason = 'season_reset' and user_id = tb.uid('u6')),
          1000 - current_setting('tb.u6_bal')::int, 'one reset row for inactive member, exact gap');
select ok(not exists (select 1 from public.seasons s, jsonb_array_elements(s.snapshot -> 'bettors') e
                       where s.id = current_setting('tb.s1')::int and e ->> 'user_id' = tb.uid('u6')::text),
          'inactive member left out of the season snapshot');
-- reactivating after the reset brings no old balance back (no rank-1 carry-over)
select tb.login('ba'); set local role authenticated;
select public.admin_set_member(tb.uid('u6'), true, null, null);
reset role;
select is(tb.bal('u6'), 1000, 'reactivated member starts the new season at 1000');
select tb.login('ba'); set local role authenticated;
select public.admin_set_member(tb.uid('u6'), false, null, null);
reset role;
select is_empty($$ select 1 from public.fighters where elo <> 1000 or season_wins <> 0 or season_losses <> 0 $$,
                'all fighters back to 1000 Elo, 0-0 season record');
select is((select wins || '-' || losses from public.fighters where id = tb.f('H')),
          split_part(current_setting('tb.h_wins'), '-', 1) || '-' || split_part(current_setting('tb.h_wins'), '-', 2),
          'all-time W-L kept');
select results_eq($$ select ended_at is not null, champion_fighter_id, top_bettor_user_id, ended_by,
                            snapshot -> 'champion' ->> 'source', snapshot -> 'season' ->> 'name'
                       from public.seasons where id = current_setting('tb.s1')::int $$,
                  $$ values (true, tb.f('A'), tb.uid('u3'), tb.uid('ba'), 'belt'::text, current_setting('tb.s1_name')) $$,
                  'old season closed with champion, top bettor, snapshot');
select is((select (e ->> 'season_wins')::int from public.seasons s, jsonb_array_elements(s.snapshot -> 'fighters') e
            where s.id = current_setting('tb.s1')::int and e ->> 'fighter_id' = tb.f('H')::text),
          split_part(current_setting('tb.h_wins'), '-', 3)::int, 'snapshot keeps H season wins');
select is((select (e ->> 'balance')::int from public.seasons s, jsonb_array_elements(s.snapshot -> 'bettors') e
            where s.id = current_setting('tb.s1')::int and e ->> 'user_id' = tb.uid('u3')::text),
          current_setting('tb.u3_bal')::int, 'snapshot keeps u3 pre-reset balance');
select is((select (snapshot -> 'top_bettor' ->> 'balance')::int from public.seasons where id = current_setting('tb.s1')::int),
          current_setting('tb.u3_bal')::int, 'snapshot top_bettor');
select results_eq($$ select name, ended_at from public.seasons where ended_at is null $$,
                  $$ values ('Spring 2027'::text, null::timestamptz) $$, 'new season open');
select is((select count(*)::int from public.admin_log where action = 'season_end'), 1, 'season_end logged');
select is(tb.champ(), tb.f('A'), 'belt survives the season reset');

-- results from the closed season are final
select tb.login('ba'); set local role authenticated;
select throws_ok($$ select public.admin_correct_result(tb.g('h5'), 'too late now') $$, null, 'SEASON_CLOSED',
                 'cannot correct a fight from a closed season');
-- new season: settle counts both all-time and season
select tb.put('ns1', tb.fight('H', 'I', 15, '20:00'));
select tb.settle(tb.g('ns1'), 'red', 2, 1);
reset role;
select results_eq($$ select wins - split_part(current_setting('tb.h_wins'), '-', 1)::int, season_wins, season_losses, elo
                       from public.fighters where id = tb.f('H') $$,
                  $$ values (1, 1, 0, 1016) $$, 'settle increments all-time and season counters');
select results_eq($$ select season_wins, season_losses, season_fights, season_ranked, season_rank
                       from public.fighter_rankings where fighter_id in (tb.f('H'), tb.f('I')) order by season_rank $$,
                  $$ values (1, 0, 1, true, 1), (0, 1, 1, true, 2) $$, 'fighter_rankings season columns');
select is((select count(*)::int from public.fighter_rankings where season_ranked and fighter_id not in (tb.f('H'), tb.f('I'))), 0,
          'only fighters with a season fight are season-ranked');
select is((select is_champion from public.fighter_rankings where fighter_id = tb.f('A')), true, 'fighter_rankings.is_champion');
select tb.login('ba'); set local role authenticated;
select public.admin_correct_result(tb.g('ns1'), 'new season fix');
reset role;
select results_eq($$ select wins - split_part(current_setting('tb.h_wins'), '-', 1)::int, season_wins, elo
                       from public.fighters where id = tb.f('H') $$,
                  $$ values (0, 0, 1000) $$, 'correct reverses season counters too');
select tb.login('ba'); set local role authenticated;
select tb.settle(tb.g('ns1'), 'red', 2, 1);
-- second reset with no belt: champion = top Elo among fighters who fought this season
select public.admin_award_belt(null, 'vacate before season 2 end');
select results_eq($$ select (r ->> 'champion_fighter_id')::uuid, r ->> 'champion_source'
                       from (select public.admin_end_season('END SEASON', 'Fall 2027') r) z $$,
                  $$ values (tb.f('H'), 'elo'::text) $$, 'no belt: champion = top Elo of the season');
reset role;
select is((select count(*)::int from public.seasons where ended_at is null), 1, 'still exactly one open season');
select tb.login('m1'); set local role authenticated;
select ok((select count(*) from public.seasons) >= 3, 'members read season history');
reset role;

-- privacy: belt reigns of a hidden fighter are hidden from members on direct select
select ok((select count(*) from public.belt_reigns where fighter_id = tb.f('G')) > 0, 'fixture: G has belt_reigns rows');
update public.fighters set hidden = true where id = tb.f('G');
select tb.login('m1'); set local role authenticated;
select is((select count(*)::int from public.belt_reigns where fighter_id = tb.f('G')), 0,
          'hidden fighter belt reigns hidden from members');
select ok((select count(*) from public.belt_reigns) > 0, 'members still read visible fighters'' reigns');
reset role;
select tb.login('ba'); set local role authenticated;
select ok((select count(*) from public.belt_reigns where fighter_id = tb.f('G')) > 0, 'admin reads hidden fighter belt reigns');
reset role;
update public.fighters set hidden = false where id = tb.f('G');

select * from finish();
rollback;
