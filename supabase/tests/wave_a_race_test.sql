-- pgTAP: two-session races between admin_settle_fight and admin_correct_result.
-- Regression for: the LATER_FIGHT_EXISTS check ran before the fighter rows were
-- locked, so a correction racing a newer settle wiped that settle's Elo.
--
-- A race needs data that other sessions can see, so the fixtures (usernames
-- tr_*, nicknames "TR *", fights 3 years out) are COMMITTED through a dblink
-- loopback connection and deleted again at the end (and at the start, in case
-- an earlier run died half way). The main test transaction is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;
set local lock_timeout = '15s';   -- a regression fails instead of hanging

select no_plan();
create schema tr;

create or replace function tr.uid(p text) returns uuid language sql immutable as $$
  select md5('tr-race:' || p)::uuid;
$$;
create or replace function tr.claims(p text) returns text language sql immutable as $$
  select json_build_object('sub', tr.uid(p), 'role', 'authenticated')::text;
$$;

-- Open a loopback dblink connection. Password auth is required for non-superusers,
-- which the local socket does not use, so connect over TCP to the server address.
create or replace function tr.connect(p_name text, p_as text) returns boolean
language plpgsql as $$
declare
  v_host text;
  v_ok   boolean := false;
begin
  foreach v_host in array array_remove(array[
      case when inet_server_addr() is not null and host(inet_server_addr()) not in ('127.0.0.1', '::1')
           then host(inet_server_addr()) end,
      'db', 'supabase_db', 'host.docker.internal'], null)
  loop
    begin
      perform extensions.dblink_connect(p_name, format(
        'host=%s port=%s dbname=%s user=postgres password=postgres application_name=%s connect_timeout=3',
        v_host, current_setting('port'), current_database(), 'tr_race_' || p_name));
      v_ok := true;
      exit;
    exception when others then
      null;
    end;
  end loop;
  if v_ok then
    perform extensions.dblink_exec(p_name, 'set lock_timeout = ''8s''');
    perform extensions.dblink_exec(p_name, 'set statement_timeout = ''20s''');
    if p_as is not null then
      perform extensions.dblink_exec(p_name, format('set request.jwt.claims = %L', tr.claims(p_as)));
    end if;
  end if;
  return v_ok;
end;
$$;

-- Wait (max ~10 s) until the named dblink session is sleeping inside pg_sleep,
-- i.e. it has run its RPC and holds that RPC's locks.
create or replace function tr.wait_sleeping(p_name text) returns boolean
language plpgsql as $$
begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();   -- pg_stat_activity is cached per transaction
    if exists (select 1 from pg_stat_activity
                where application_name = 'tr_race_' || p_name and wait_event = 'PgSleep') then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end;
$$;

-- Evaluate one expression over a dblink connection; returns it as text.
create or replace function tr.run(p_name text, p_expr text) returns text language sql as $$
  select t.x from extensions.dblink(p_name, 'select (' || p_expr || ')::text') as t(x text);
$$;

create or replace function tr.cleanup() returns void language plpgsql as $$
begin
  perform extensions.dblink_exec('setup', $q$
    delete from public.admin_log
     where actor in (select id from public.profiles where username like 'tr\_%')
        or target_id in (select f.id from public.fights f join public.fighters x
                           on x.id in (f.red_fighter_id, f.blue_fighter_id) where x.nickname like 'TR %');
    delete from public.fights
     where red_fighter_id in (select id from public.fighters where nickname like 'TR %')
        or blue_fighter_id in (select id from public.fighters where nickname like 'TR %');
    delete from public.fighters where nickname like 'TR %';
    delete from auth.users where id in (select id from public.profiles where username like 'tr\_%');
  $q$);
end;
$$;

-- Runs over 'setup' as admin tr_adm1 and returns the new fight id (force-opened).
create or replace function tr.mk_fight(p_red text, p_blue text, p_hour int) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  v_id := tr.run('setup', format(
    'public.admin_create_fight(%L, %L, %L, %L, %L)',
    tr.uid(p_red), tr.uid(p_blue),
    date_trunc('day', now() + interval '3 years') + make_interval(hours => p_hour),
    date_trunc('day', now() + interval '3 years') + make_interval(hours => p_hour) - interval '15 minutes',
    'TR race ' || p_red || ' vs ' || p_blue))::uuid;
  perform tr.run('setup', format('public.admin_force_open(%L, ''race fixture'')', v_id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (committed through 'setup')
-- ---------------------------------------------------------------------------
select ok(tr.connect('setup', null), 'dblink loopback connection (setup)');
select tr.cleanup();
select extensions.dblink_exec('setup', format($q$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.name || '@members.uosfight.local', '',
         jsonb_build_object('username', u.name, 'display_name', u.name),
         '{"provider":"email","providers":["email"]}', now(), now()
    from (values (%L::uuid, 'tr_adm1'), (%L::uuid, 'tr_adm2')) u(id, name);
$q$, tr.uid('adm1'), tr.uid('adm2')));
select extensions.dblink_exec('setup', format(
  'update public.profiles set role = ''admin'' where id in (%L, %L)', tr.uid('adm1'), tr.uid('adm2')));
select extensions.dblink_exec('setup', format($q$
  insert into public.fighters (id, nickname)
  values (%L, 'TR B'), (%L, 'TR C'), (%L, 'TR D'), (%L, 'TR E'), (%L, 'TR F'), (%L, 'TR G');
$q$, tr.uid('b'), tr.uid('c'), tr.uid('d'), tr.uid('e'), tr.uid('f'), tr.uid('g')));
select extensions.dblink_exec('setup', format('set request.jwt.claims = %L', tr.claims('adm1')));

-- Scenario 1: X = C vs D (settled, C wins), Y = C vs B (open)
select set_config('tr.x', tr.mk_fight('c', 'd', 18)::text, true);
select set_config('tr.y', tr.mk_fight('c', 'b', 19)::text, true);
select tr.run('setup', format(
  'public.admin_settle_fight(%L, ''red'', ''pin'', null, 1, 2, 0)', current_setting('tr.x')));
-- Scenario 2: P = E vs F (settled, E wins), Q = E vs G (open)
select set_config('tr.p', tr.mk_fight('e', 'f', 20)::text, true);
select set_config('tr.q', tr.mk_fight('e', 'g', 21)::text, true);
select tr.run('setup', format(
  'public.admin_settle_fight(%L, ''red'', ''pin'', null, 1, 2, 0)', current_setting('tr.p')));

select results_eq($$ select nickname, elo from public.fighters where nickname like 'TR %' order by nickname $$,
                  $$ values ('TR B'::text, 1000), ('TR C', 1016), ('TR D', 984), ('TR E', 1016), ('TR F', 984), ('TR G', 1000) $$,
                  'fixtures committed and visible: X and P settled');

-- ===========================================================================
-- 1. Settle of newer fight Y in flight, then correct older fight X
--    -> must refuse with LATER_FIGHT_EXISTS once Y commits (was: succeeded and
--       wrote X's snapshot Elo over Y's result)
-- ===========================================================================
select ok(tr.connect('s1', 'adm1'), 'dblink session s1 (adm1)');
select extensions.dblink_send_query('s1', format(
  'select public.admin_settle_fight(%L, ''red'', ''pin'', null, 1, 2, 0)::text, pg_sleep(2)::text',
  current_setting('tr.y')));
select ok(tr.wait_sleeping('s1'), 's1 settled Y and holds its locks (transaction still open)');

select set_config('request.jwt.claims', tr.claims('adm2'), true);
set local role authenticated;
select throws_ok(format($$ select public.admin_correct_result(%L, 'wrong winner recorded') $$, current_setting('tr.x')),
                 null, 'LATER_FIGHT_EXISTS',
                 'correcting X waits for the in-flight settle of newer fight Y, then refuses');
reset role;

select is((select (r::jsonb ->> 'red_elo_before')::int
             from extensions.dblink_get_result('s1') as t(r text, s text)), 1016,
          's1 settle of Y committed (C elo before = 1016)');
select is((select count(*)::int from extensions.dblink_get_result('s1') as t(r text, s text)), 0, 's1 drained');

select results_eq($$ select status, red_elo_before, blue_elo_before, elo_delta from public.fights
                      where id in (current_setting('tr.x')::uuid, current_setting('tr.y')::uuid) order by settled_at $$,
                  $$ values ('settled'::text, 1000, 1000, 16), ('settled'::text, 1016, 1000, 15) $$,
                  'X still settled; Y settled on top of X');
select results_eq($$ select nickname, elo, wins, losses, streak from public.fighters
                      where nickname in ('TR B', 'TR C', 'TR D') order by nickname $$,
                  $$ values ('TR B'::text, 985, 0, 1, -1), ('TR C', 1031, 2, 0, 2), ('TR D', 984, 0, 1, -1) $$,
                  'Elo chain intact: C kept +15 from Y');
select is((select sum(elo)::int from public.fighters where nickname in ('TR B', 'TR C', 'TR D')), 3000,
          'Elo conserved across B/C/D');

-- ===========================================================================
-- 2. Correction of P in flight, then settle of newer fight Q (same fighter E)
--    -> settle waits and builds on the restored Elo
-- ===========================================================================
select ok(tr.connect('s2', 'adm2'), 'dblink session s2 (adm2)');
select ok(tr.connect('s3', 'adm1'), 'dblink session s3 (adm1)');
select extensions.dblink_send_query('s2', format(
  'select public.admin_correct_result(%L, ''race test reverse'')::text, pg_sleep(2)::text',
  current_setting('tr.p')));
select ok(tr.wait_sleeping('s2'), 's2 corrected P and holds its locks');
select extensions.dblink_send_query('s3', format(
  'select public.admin_settle_fight(%L, ''red'', ''pin'', null, 1, 2, 0)::text', current_setting('tr.q')));

select is((select (r::jsonb ->> 'status') from extensions.dblink_get_result('s2') as t(r text, s text)), 'locked',
          's2 correction of P committed');
select is((select count(*)::int from extensions.dblink_get_result('s2') as t(r text, s text)), 0, 's2 drained');
select is((select (r::jsonb ->> 'red_elo_before')::int from extensions.dblink_get_result('s3') as t(r text)), 1000,
          's3 settle of Q waited and used E''s restored Elo (1000)');
select is((select count(*)::int from extensions.dblink_get_result('s3') as t(r text)), 0, 's3 drained');

select results_eq($$ select nickname, elo, wins, losses, streak from public.fighters
                      where nickname in ('TR E', 'TR F', 'TR G') order by nickname $$,
                  $$ values ('TR E'::text, 1016, 1, 0, 1), ('TR F', 1000, 0, 0, 0), ('TR G', 984, 0, 1, -1) $$,
                  'E/F/G consistent: P undone, Q applied on top');
select is((select status from public.fights where id = current_setting('tr.p')::uuid), 'locked', 'P back to locked');

-- ---------------------------------------------------------------------------
-- Cleanup of the committed fixtures
-- ---------------------------------------------------------------------------
select tr.cleanup();
select is((select count(*)::int from public.fighters where nickname like 'TR %'), 0, 'race fixtures removed');
select extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c;

select * from finish();
rollback;
