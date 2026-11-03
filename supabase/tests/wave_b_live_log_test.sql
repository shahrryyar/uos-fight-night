-- pgTAP: WAVE B review fix 20261103000007 (admin_live_update logs only the
-- moments that change the bout, not every score tap). Own transaction, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();
create schema tl;

create or replace function tl.uid(p text) returns uuid language sql immutable as $$
  select md5('tl-user:' || p)::uuid;
$$;
create or replace function tl.f(p text) returns uuid language sql immutable as $$
  select md5('tl-fighter:' || p)::uuid;
$$;
create or replace function tl.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', tl.uid(p), 'role', 'authenticated')::text, true);
$$;
create or replace function tl.put(k text, v uuid) returns uuid language sql as $$
  select set_config('tl.' || k, v::text, true)::uuid;
$$;
create or replace function tl.g(k text) returns uuid language sql as $$
  select current_setting('tl.' || k)::uuid;
$$;
-- number of live_update rows for the test fight
create or replace function tl.n() returns int language sql as $$
  select count(*)::int from public.admin_log where action = 'live_update' and target_id = tl.g('lv');
$$;
create or replace function tl.last() returns jsonb language sql as $$
  select details from public.admin_log where action = 'live_update' and target_id = tl.g('lv')
   order by id desc limit 1;
$$;
create or replace function tl.u(p_action text, p_value int default null) returns jsonb language sql as $$
  select public.admin_live_update(tl.g('lv'), p_action, p_value);
$$;
grant usage on schema tl to authenticated;
grant execute on all functions in schema tl to authenticated;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', tl.uid('ref'), 'authenticated', 'authenticated',
        'tl_ref@members.uosfight.local', '',
        jsonb_build_object('username', 'tl_ref', 'display_name', 'TL Ref'),
        '{"provider":"email","providers":["email"]}', now(), now());
update public.profiles set role = 'admin' where id = tl.uid('ref');
insert into public.fighters (id, nickname) values (tl.f('R'), 'TL Red'), (tl.f('B'), 'TL Blue');

-- an open fight already past lock_at: the first live call locks it
select tl.login('ref'); set local role authenticated;
select tl.put('lv', public.admin_create_fight(tl.f('R'), tl.f('B'), now() + interval '40 days',
                                             now() - interval '1 minute', 'TL live'));
select public.admin_force_open(tl.g('lv'), 'live log fixture');
reset role;
select is(tl.n(), 0, 'no live_update rows before the first call');

select tl.login('ref'); set local role authenticated;
select tl.u('start');
reset role;
select is(tl.n(), 1, 'opening bell (round 1, clock at 0) is logged');
select is(tl.last() ->> 'action', 'start', 'opening bell row says start');
select is((tl.last() ->> 'round')::int, 1, 'opening bell row carries round 1');

-- now() is fixed inside a transaction: move the running segment 10 s into the past
update public.live_scores set round_started_at = round_started_at - interval '10 seconds' where fight_id = tl.g('lv');

-- score taps, pause and resume: no rows
select tl.login('ref'); set local role authenticated;
select tl.u('red_add', 1);
select tl.u('red_add', 2);
select tl.u('blue_add', 1);
select tl.u('red_add', -1);
select tl.u('pause');
select tl.u('start');            -- resume
select tl.u('pause');
select tl.u('start');            -- resume again
select tl.u('start');            -- no-op while running
reset role;
select is(tl.n(), 1, 'score taps, pause, resume and a no-op start are not logged');
select results_eq($$ select red_score, blue_score, updated_by from public.live_scores where fight_id = tl.g('lv') $$,
                  $$ values (2, 1, tl.uid('ref')) $$, 'taps still land; updated_by records the referee');

-- round length: logged only when it changes
select tl.login('ref'); set local role authenticated;
select tl.u('set_round_seconds', 120);   -- default is 120: unchanged
reset role;
select is(tl.n(), 1, 'setting the same round length is not logged');
select tl.login('ref'); set local role authenticated;
select tl.u('set_round_seconds', 180);
reset role;
select is(tl.n(), 2, 'changing the round length is logged');
select results_eq($$ select tl.last() ->> 'action', (tl.last() ->> 'value')::int, (tl.last() ->> 'prev_round_seconds')::int $$,
                  $$ values ('set_round_seconds', 180, 120) $$, 'length row carries new and previous length');

-- next round: logged
select tl.login('ref'); set local role authenticated;
select tl.u('next_round');
reset role;
select is(tl.n(), 3, 'next round is logged');
select results_eq($$ select tl.last() ->> 'action', (tl.last() ->> 'round')::int, (tl.last() ->> 'prev_round')::int $$,
                  $$ values ('next_round', 2, 1) $$, 'next round row carries round 2 (from 1)');

-- the first start of round 2 is not the opening bell
select tl.login('ref'); set local role authenticated;
select tl.u('start');
select tl.u('blue_add', 2);
reset role;
select is(tl.n(), 3, 'starting round 2 and scoring in it are not logged');

-- reset: logged with what was wiped
select tl.login('ref'); set local role authenticated;
select tl.u('reset');
reset role;
select is(tl.n(), 4, 'reset is logged');
select results_eq($$ select tl.last() ->> 'action', (tl.last() ->> 'prev_round')::int,
                            (tl.last() ->> 'prev_red_score')::int, (tl.last() ->> 'prev_blue_score')::int,
                            (tl.last() ->> 'red_score')::int, (tl.last() ->> 'blue_score')::int $$,
                  $$ values ('reset', 2, 2, 3, 0, 0) $$, 'reset row carries round 2, 2-3 before, 0-0 after');

-- after a reset the next start is a fresh opening bell
select tl.login('ref'); set local role authenticated;
select tl.u('start');
reset role;
select is(tl.n(), 5, 'start after a reset is a new opening bell and is logged');

-- a refused call writes nothing
select tl.login('ref'); set local role authenticated;
select throws_ok($$ select tl.u('red_add', -50) $$, null, 'INVALID_VALUE', 'out of range tap refused');
reset role;
select is(tl.n(), 5, 'refused call is not logged');

-- the auto lock from the first call is still logged once
select is((select count(*)::int from public.admin_log where action = 'fight_lock' and target_id = tl.g('lv')), 1,
          'auto lock still logged once');

-- grants survived create or replace
select ok(not has_function_privilege('anon', 'public.admin_live_update(uuid,text,int)', 'execute'),
          'anon still cannot execute admin_live_update');
select ok(has_function_privilege('authenticated', 'public.admin_live_update(uuid,text,int)', 'execute'),
          'authenticated can still call admin_live_update (it checks is_referee)');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'admin_live_update'),
          'admin_live_update stays security definer with an empty search_path');

select * from finish();
rollback;
