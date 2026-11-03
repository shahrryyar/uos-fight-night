-- pgTAP: two-session race between admin_end_season and opening a fight / placing
-- a pick. Regression for: the FIGHTS_IN_PROGRESS check ran before any lock, so a
-- fight opened and a pick placed while the reset waited for the fighter/profile
-- locks were counted in the reset (stake came back as part of "back to 1000",
-- the pick stayed active = free points; season closed with a fight open).
--
-- Fixtures (usernames sr_*, nicknames "SR *", fights 3 years out) are COMMITTED
-- through a dblink loopback connection and deleted again at the end (and at the
-- start, in case an earlier run died half way). The end_season session always
-- runs inside an explicit transaction that is ROLLED BACK, so no season is ever
-- really ended, whatever the outcome. The main test transaction is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;
set local lock_timeout = '15s';   -- a regression fails instead of hanging

select no_plan();
create schema sr;

create or replace function sr.uid(p text) returns uuid language sql immutable as $$
  select md5('sr-race:' || p)::uuid;
$$;
create or replace function sr.claims(p text) returns text language sql immutable as $$
  select json_build_object('sub', sr.uid(p), 'role', 'authenticated')::text;
$$;

-- Loopback dblink connection over TCP (password auth; see wave_a_race_test.sql).
create or replace function sr.connect(p_name text, p_as text) returns boolean
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
        v_host, current_setting('port'), current_database(), 'sr_race_' || p_name));
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
      perform extensions.dblink_exec(p_name, format('set request.jwt.claims = %L', sr.claims(p_as)));
    end if;
  end if;
  return v_ok;
end;
$$;

-- Wait (max ~10 s) until the named session is blocked on a row/tuple lock.
create or replace function sr.wait_blocked(p_name text) returns boolean
language plpgsql as $$
begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity
                where application_name = 'sr_race_' || p_name and wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end;
$$;

create or replace function sr.run(p_name text, p_expr text) returns text language sql as $$
  select t.x from extensions.dblink(p_name, 'select (' || p_expr || ')::text') as t(x text);
$$;

create or replace function sr.cleanup() returns void language plpgsql as $$
begin
  perform extensions.dblink_exec('setup', $q$
    delete from public.admin_log
     where actor in (select id from public.profiles where username like 'sr\_%')
        or target_id in (select f.id from public.fights f join public.fighters x
                           on x.id in (f.red_fighter_id, f.blue_fighter_id) where x.nickname like 'SR %');
    delete from public.fights
     where red_fighter_id in (select id from public.fighters where nickname like 'SR %')
        or blue_fighter_id in (select id from public.fighters where nickname like 'SR %');
    delete from public.fighters where nickname like 'SR %';
    delete from auth.users where id in (select id from public.profiles where username like 'sr\_%');
  $q$);
end;
$$;

-- Runs over p_conn (an admin session); returns the new, still scheduled, fight id.
create or replace function sr.mk_fight(p_conn text, p_red uuid, p_blue uuid, p_hour int) returns uuid
language sql as $$
  select sr.run(p_conn, format(
    'public.admin_create_fight(%L, %L, %L, %L, %L)',
    p_red, p_blue,
    date_trunc('day', now() + interval '3 years') + make_interval(hours => p_hour),
    date_trunc('day', now() + interval '3 years') + make_interval(hours => p_hour) - interval '15 minutes',
    'SR race ' || p_hour))::uuid;
$$;

create or replace function sr.mem_bal() returns int language sql as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger where user_id = sr.uid('mem');
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (committed through 'setup')
-- ---------------------------------------------------------------------------
select ok(sr.connect('setup', null), 'dblink loopback connection (setup)');
select sr.cleanup();
select extensions.dblink_exec('setup', format($q$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.name || '@members.uosfight.local', '',
         jsonb_build_object('username', u.name, 'display_name', u.name),
         '{"provider":"email","providers":["email"]}', now(), now()
    from (values (%L::uuid, 'sr_adm'), (%L::uuid, 'sr_mem')) u(id, name);
$q$, sr.uid('adm'), sr.uid('mem')));
select extensions.dblink_exec('setup', format(
  'update public.profiles set role = ''admin'' where id = %L', sr.uid('adm')));
select extensions.dblink_exec('setup', format($q$
  insert into public.fighters (id, nickname)
  values (%L, 'SR A'), (%L, 'SR B'), (%L, 'SR C'), (%L, 'SR D');
$q$, sr.uid('fa'), sr.uid('fb'), sr.uid('fc'), sr.uid('fd')));
select extensions.dblink_exec('setup', format('set request.jwt.claims = %L', sr.claims('adm')));

-- X = the lowest fighter id overall: s1 holds it so end_season stalls on its
-- ordered fighter lock while holding only ids < X (none). F uses the two lowest
-- SR fighters (so X, if it is an SR fighter, is in F); G uses the other two.
select set_config('sr.x', (select id::text from public.fighters order by id limit 1), true);
select set_config('sr.f_red',  (select id::text from public.fighters where nickname like 'SR %' order by id offset 0 limit 1), true);
select set_config('sr.f_blue', (select id::text from public.fighters where nickname like 'SR %' order by id offset 1 limit 1), true);
select set_config('sr.g_red',  (select id::text from public.fighters where nickname like 'SR %' order by id offset 2 limit 1), true);
select set_config('sr.g_blue', (select id::text from public.fighters where nickname like 'SR %' order by id offset 3 limit 1), true);
select ok(current_setting('sr.x') not in (current_setting('sr.g_red'), current_setting('sr.g_blue')),
          'G fighters are above the held fighter lock');

select set_config('sr.f', sr.mk_fight('setup', current_setting('sr.f_red')::uuid,
                                      current_setting('sr.f_blue')::uuid, 18)::text, true);
select is((select status from public.fights where id = current_setting('sr.f')::uuid), 'scheduled',
          'fixture: fight F committed, scheduled');
select is(sr.mem_bal(), 1000, 'fixture: sr_mem starts at 1000');
select set_config('sr.season', (select id::text from public.seasons where ended_at is null), true);

-- ===========================================================================
-- s1 holds fighter X; s2 runs admin_end_season and stalls on X
-- ===========================================================================
select ok(sr.connect('s1', null), 'dblink session s1 (lock holder)');
select ok(sr.connect('s2', 'adm'), 'dblink session s2 (adm: end season)');
select ok(sr.connect('s3', 'adm'), 'dblink session s3 (adm: open fights)');
select ok(sr.connect('s4', 'mem'), 'dblink session s4 (mem: picks)');
select extensions.dblink_exec('s3', 'set lock_timeout = ''1s''');

select extensions.dblink_exec('s1', 'begin');
select is((select t.x from extensions.dblink('s1', format(
            'select id::text from public.fighters where id = %L for update', current_setting('sr.x'))) as t(x text)),
          current_setting('sr.x'), 's1 holds the row lock on fighter X (transaction open)');

-- s2: own transaction (always rolled back). Clear whatever else the local DB
-- has in progress (seed fights) inside it, so only the race decides the result.
select extensions.dblink_exec('s2', 'begin');
select extensions.dblink_exec('s2', $q$
  update public.bets b set status = 'refunded'
    from public.fights f
   where f.id = b.fight_id and b.status = 'active' and f.status in ('open', 'locked');
  update public.fights set status = 'cancelled', cancel_kind = 'cancelled' where status in ('open', 'locked');
$q$);
select extensions.dblink_send_query('s2', $q$ select public.admin_end_season('END SEASON', 'SR Race Season')::text $q$);
select ok(sr.wait_blocked('s2'), 's2 end_season is in flight, waiting for fighter X');

-- 1. a scheduled fight cannot be opened while the reset is in flight
--    (was: opened at once, then took picks that the reset refunded)
select throws_ok(format($$ select sr.run('s3', format('public.admin_force_open(%%L, ''race test open'')', %L)) $$,
                        current_setting('sr.f')),
                 '55P03', null,
                 'opening scheduled fight F waits for end_season (blocked on its fight lock)');
select is((select status from public.fights where id = current_setting('sr.f')::uuid), 'scheduled',
          'F still scheduled');

-- 2. a fight created after the fight lock, opened, and picked on before the
--    reset reaches the profile locks -> reset must refuse
select set_config('sr.g', sr.mk_fight('s3', current_setting('sr.g_red')::uuid,
                                      current_setting('sr.g_blue')::uuid, 19)::text, true);
select lives_ok(format($$ select sr.run('s3', format('public.admin_force_open(%%L, ''race test open'')', %L)) $$,
                       current_setting('sr.g')),
                'new fight G (not covered by the fight lock) opens');
select isnt(sr.run('s4', format('public.place_bet(%L, ''red'', 400)', current_setting('sr.g'))), null,
            'sr_mem places a 400 pick on G while end_season waits');
select is(sr.mem_bal(), 600, 'sr_mem balance 600 after the pick');

select extensions.dblink_exec('s1', 'commit');   -- release X: s2 continues
select throws_ok($$ select r from extensions.dblink_get_result('s2') as t(r text) $$,
                 null, 'FIGHTS_IN_PROGRESS',
                 'end_season re-checks after locking every profile and refuses (fight G open / active pick)');
select is((select count(*)::int from extensions.dblink_get_result('s2', false) as t(r text)), 0, 's2 drained');
select extensions.dblink_exec('s2', 'rollback');

select is((select id::text from public.seasons where ended_at is null), current_setting('sr.season'),
          'season not ended');
select is((select count(*)::int from public.points_ledger
            where user_id = sr.uid('mem') and reason = 'season_reset'), 0,
          'no season_reset row for sr_mem: the stake was not handed back');
select is(sr.mem_bal(), 600, 'sr_mem balance still 600 with one active pick');
select is((select count(*)::int from public.bets where user_id = sr.uid('mem') and status = 'active'), 1,
          'the pick on G is still active');

-- ---------------------------------------------------------------------------
-- Cleanup of the committed fixtures
-- ---------------------------------------------------------------------------
select extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c where c <> 'setup';
select sr.cleanup();
select is((select count(*)::int from public.fighters where nickname like 'SR %'), 0, 'race fixtures removed');
select is((select count(*)::int from public.profiles where username like 'sr\_%'), 0, 'race users removed');
select extensions.dblink_disconnect('setup');

select * from finish();
rollback;
