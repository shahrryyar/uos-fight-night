-- pgTAP: WAVE B review fix 20261103000012 (round clock keeps sub-second time across
-- pauses instead of flooring each running segment). Own transaction, rolled back.
-- now() is fixed inside a transaction, so time is simulated by moving round_started_at back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();
create schema tc;

create or replace function tc.uid(p text) returns uuid language sql immutable as $$
  select md5('tc-user:' || p)::uuid;
$$;
create or replace function tc.f(p text) returns uuid language sql immutable as $$
  select md5('tc-fighter:' || p)::uuid;
$$;
create or replace function tc.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', tc.uid(p), 'role', 'authenticated')::text, true);
$$;
create or replace function tc.put(k text, v uuid) returns uuid language sql as $$
  select set_config('tc.' || k, v::text, true)::uuid;
$$;
create or replace function tc.g(k text) returns uuid language sql as $$
  select current_setting('tc.' || k)::uuid;
$$;
create or replace function tc.u(p_action text, p_value int default null) returns jsonb language sql as $$
  select public.admin_live_update(tc.g('lv'), p_action, p_value);
$$;
-- run the current segment for p_ms milliseconds (as the test owner, outside the RPC)
create or replace function tc.run(p_ms int) returns void language sql as $$
  update public.live_scores set round_started_at = round_started_at - make_interval(secs => p_ms / 1000.0)
   where fight_id = tc.g('lv') and running;
$$;
create or replace function tc.bank() returns table (acc int, frac int) language sql as $$
  select accumulated_seconds, accumulated_frac_ms from public.live_scores where fight_id = tc.g('lv');
$$;
grant usage on schema tc to authenticated;
grant execute on all functions in schema tc to authenticated;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', tc.uid('ref'), 'authenticated', 'authenticated',
        'tc_ref@members.uosfight.local', '',
        jsonb_build_object('username', 'tc_ref', 'display_name', 'TC Ref'),
        '{"provider":"email","providers":["email"]}', now(), now()),
       ('00000000-0000-0000-0000-000000000000', tc.uid('m'), 'authenticated', 'authenticated',
        'tc_m@members.uosfight.local', '',
        jsonb_build_object('username', 'tc_m', 'display_name', 'TC Member'),
        '{"provider":"email","providers":["email"]}', now(), now());
update public.profiles set role = 'admin' where id = tc.uid('ref');
insert into public.fighters (id, nickname) values (tc.f('R'), 'TC Red'), (tc.f('B'), 'TC Blue');

-- ---------------------------------------------------------------------------
-- schema and privileges
-- ---------------------------------------------------------------------------
select has_column('public', 'live_scores', 'accumulated_frac_ms', 'live_scores.accumulated_frac_ms');
select col_type_is('public', 'live_scores', 'accumulated_seconds', 'integer', 'accumulated_seconds stays int');
select col_not_null('public', 'live_scores', 'accumulated_frac_ms', 'accumulated_frac_ms is not null');
select col_default_is('public', 'live_scores', 'accumulated_frac_ms', '0', 'accumulated_frac_ms defaults to 0');
select has_column('public', 'live_score_state', c, 'live_score_state.' || c)
  from unnest(array['accumulated_frac_ms', 'elapsed_ms', 'elapsed_seconds', 'remaining_seconds', 'time_up', 'server_now']) c;
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'get_live_score'), 1,
          'get_live_score: one overload');
select ok((select p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']
             from pg_proc p where p.oid = 'public.get_live_score(uuid)'::regprocedure),
          'get_live_score is security definer with search_path = ''''');
select ok(has_function_privilege('authenticated', 'public.get_live_score(uuid)', 'execute'), 'authenticated may execute get_live_score');
select ok(not has_function_privilege('anon', 'public.get_live_score(uuid)', 'execute'), 'anon may not execute get_live_score');
select ok(not has_function_privilege('public', 'public.get_live_score(uuid)', 'execute'), 'public may not execute get_live_score');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
          array['public_next_fight','public_site_status'], 'anon still may execute only public_next_fight (+ wave C public_site_status)');
set local role anon;
select throws_ok($$ select * from public.get_live_score(gen_random_uuid()) $$, '42501', null, 'anon: get_live_score refused');
select throws_ok($$ select * from public.live_score_state $$, '42501', null, 'anon: live_score_state refused');
reset role;

-- fixture: an open fight already past lock_at (the first live call locks it)
select tc.login('ref'); set local role authenticated;
select tc.put('lv', public.admin_create_fight(tc.f('R'), tc.f('B'), now() + interval '40 days',
                                             now() - interval '1 minute', 'TC clock'));
select public.admin_force_open(tc.g('lv'), 'live clock fixture');

-- ---------------------------------------------------------------------------
-- the reviewer's scenario: 30.6 s, then ten 0.9 s bursts
-- ---------------------------------------------------------------------------
select tc.u('start');
reset role;
select tc.run(30600);
select tc.login('ref'); set local role authenticated;
select results_eq($$ select (r ->> 'elapsed_seconds')::int, (r ->> 'remaining_seconds')::int, (r ->> 'elapsed_ms')::bigint,
                            (r ->> 'accumulated_seconds')::int, (r ->> 'accumulated_frac_ms')::int
                       from (select tc.u('pause') r) z $$,
                  $$ values (30, 90, 30600::bigint, 30, 600) $$, 'pause after 30.6 s banks 30 s + 600 ms');
reset role;
select results_eq($$ select * from tc.bank() $$, $$ values (30, 600) $$, 'row: 30 s + 600 ms');

do $$
begin
  for i in 1..10 loop
    perform tc.login('ref');
    set local role authenticated;
    perform tc.u('start');
    reset role;
    perform tc.run(900);
    perform tc.login('ref');
    set local role authenticated;
    perform tc.u('pause');
    reset role;
  end loop;
end;
$$;
select results_eq($$ select * from tc.bank() $$, $$ values (39, 600) $$,
                  'ten 0.9 s bursts add 9 s (39.6 s banked, nothing lost to flooring)');
select tc.login('m'); set local role authenticated;
select results_eq($$ select running, elapsed_seconds, remaining_seconds, time_up, elapsed_ms, accumulated_frac_ms
                       from public.get_live_score(tc.g('lv')) $$,
                  $$ values (false, 39, 81, false, 39600::bigint, 600) $$, 'member get_live_score: 39 s used, 81 s left');
select results_eq($$ select elapsed_seconds, remaining_seconds, elapsed_ms from public.live_score_state where fight_id = tc.g('lv') $$,
                  $$ values (39, 81, 39600::bigint) $$, 'live_score_state agrees');
reset role;

-- a stoppage under a second is counted, and the running clock includes the banked fraction
select tc.login('ref'); set local role authenticated;
select tc.u('start');
reset role;
select tc.run(400);    -- 39.6 + 0.4 = 40.0
select tc.login('m'); set local role authenticated;
select results_eq($$ select running, elapsed_seconds, remaining_seconds, elapsed_ms from public.get_live_score(tc.g('lv')) $$,
                  $$ values (true, 40, 80, 40000::bigint) $$, 'running: banked 600 ms + 400 ms segment = 40 s');
reset role;
select tc.login('ref'); set local role authenticated;
select tc.u('pause');
reset role;
select results_eq($$ select * from tc.bank() $$, $$ values (40, 0) $$, 'fractions carry into whole seconds');

-- ---------------------------------------------------------------------------
-- set_round_seconds keeps the fraction; the cap leaves no remainder
-- ---------------------------------------------------------------------------
select tc.login('ref'); set local role authenticated;
select tc.u('start');
reset role;
select tc.run(2250);   -- 42.25 s
select tc.login('ref'); set local role authenticated;
select results_eq($$ select (r ->> 'elapsed_ms')::bigint, (r ->> 'running')::boolean, (r ->> 'round_seconds')::int,
                            (r ->> 'remaining_seconds')::int
                       from (select tc.u('set_round_seconds', 150) r) z $$,
                  $$ values (42250::bigint, true, 150, 108) $$, 'set_round_seconds while running keeps 42.25 s');
reset role;
select results_eq($$ select * from tc.bank() $$, $$ values (42, 250) $$, 'set_round_seconds banks the fraction');
select tc.run(500);    -- 42.75 s, still running
select tc.login('ref'); set local role authenticated;
select results_eq($$ select (r ->> 'elapsed_ms')::bigint, (r ->> 'round_seconds')::int, (r ->> 'time_up')::boolean
                       from (select tc.u('set_round_seconds', 40) r) z $$,
                  $$ values (40000::bigint, 40, true) $$, 'shortening below the time used caps at the new length');
reset role;
select results_eq($$ select * from tc.bank() $$, $$ values (40, 0) $$, 'capped bank has no remainder');
select tc.login('ref'); set local role authenticated;
select tc.u('pause');
select throws_ok($$ select tc.u('start') $$, null, 'ROUND_OVER', 'start after time is up still refused');
select results_eq($$ select (r ->> 'round')::int, (r ->> 'elapsed_ms')::bigint, (r ->> 'accumulated_frac_ms')::int
                       from (select tc.u('next_round') r) z $$,
                  $$ values (2, 0::bigint, 0) $$, 'next_round clears the fraction');
select tc.u('start');
reset role;
select tc.run(123);
select tc.login('ref'); set local role authenticated;
select tc.u('pause');
reset role;
select results_eq($$ select * from tc.bank() $$, $$ values (0, 123) $$, 'a 123 ms segment is banked, not dropped');
select tc.login('ref'); set local role authenticated;
select results_eq($$ select (r ->> 'round')::int, (r ->> 'elapsed_ms')::bigint, (r ->> 'accumulated_frac_ms')::int
                       from (select tc.u('reset') r) z $$,
                  $$ values (1, 0::bigint, 0) $$, 'reset clears the fraction');

-- an opening start that ran for a fraction of a second is no longer an "opening bell" on resume
select tc.u('start');
reset role;
select tc.run(300);
select tc.login('ref'); set local role authenticated;
select tc.u('pause');
select tc.u('start');
reset role;
select is((select count(*)::int from public.admin_log
            where action = 'live_update' and target_id = tc.g('lv') and details ->> 'action' = 'start'
              and id > (select max(id) from public.admin_log where action = 'live_update'
                                                              and target_id = tc.g('lv') and details ->> 'action' = 'reset')),
          1, 'resume after a 0.3 s opening segment is not logged as a second opening bell');

-- ---------------------------------------------------------------------------
-- constraints
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.live_scores set accumulated_frac_ms = 1000 where fight_id = tc.g('lv') $$,
                 '23514', null, 'accumulated_frac_ms above 999 rejected');
select throws_ok($$ update public.live_scores set accumulated_frac_ms = -1 where fight_id = tc.g('lv') $$,
                 '23514', null, 'negative accumulated_frac_ms rejected');
select throws_ok($$ update public.live_scores set running = false, round_started_at = null,
                          accumulated_seconds = round_seconds, accumulated_frac_ms = 1 where fight_id = tc.g('lv') $$,
                 '23514', null, 'banked time cannot exceed the round length');
select tc.login('m'); set local role authenticated;
select throws_ok($$ update public.live_scores set accumulated_frac_ms = 0 where fight_id = tc.g('lv') $$,
                 '42501', null, 'members cannot write live_scores');
reset role;

select * from finish();
rollback;
