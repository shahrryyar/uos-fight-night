-- pgTAP: two-session races on the points shop (C6). buy_item / request_title must never
-- double-spend: they lock the caller's profile row (same lock as place_bet) before reading the
-- balance, so a second purchase waits for the first one and then sees the lower balance.
--
-- Fixtures (username twr_buyer, an admin twr_adm) are COMMITTED through a dblink loopback
-- connection and deleted again at the end (and at the start, in case an earlier run died).
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;
set local lock_timeout = '15s';

select no_plan();
create schema twr;

create or replace function twr.uid(p text) returns uuid language sql immutable as $$
  select md5('twr-race:' || p)::uuid;
$$;
create or replace function twr.claims(p text) returns text language sql immutable as $$
  select json_build_object('sub', twr.uid(p), 'role', 'authenticated')::text;
$$;
create or replace function twr.connect(p_name text, p_as text) returns boolean
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
        v_host, current_setting('port'), current_database(), 'twr_race_' || p_name));
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
      perform extensions.dblink_exec(p_name, 'set role authenticated');
      perform extensions.dblink_exec(p_name, format('set request.jwt.claims = %L', twr.claims(p_as)));
    end if;
  end if;
  return v_ok;
end;
$$;
create or replace function twr.wait_sleeping(p_name text) returns boolean
language plpgsql as $$
begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity
                where application_name = 'twr_race_' || p_name and wait_event = 'PgSleep') then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end;
$$;
create or replace function twr.cleanup() returns void language plpgsql as $$
begin
  perform extensions.dblink_exec('setup', $q$
    delete from public.admin_log where actor in (select id from public.profiles where username like 'twr\_%')
                                    or target_id in (select id from public.profiles where username like 'twr\_%');
    delete from auth.users where id in (select id from public.profiles where username like 'twr\_%');
  $q$);
end;
$$;
create or replace function twr.bal() returns int language sql as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger where user_id = twr.uid('buyer');
$$;
create or replace function twr.shop_rows() returns int language sql as $$
  select count(*)::int from public.points_ledger where user_id = twr.uid('buyer') and reason = 'shop';
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (committed through 'setup'): buyer starts at 1000 -> trimmed to 400
-- ---------------------------------------------------------------------------
select ok(twr.connect('setup', null), 'dblink loopback connection (setup)');
select twr.cleanup();
select extensions.dblink_exec('setup', format($q$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.name || '@members.uosfight.local', '',
         jsonb_build_object('username', u.name, 'display_name', u.name),
         '{"provider":"email","providers":["email"]}', now(), now()
    from (values (%L::uuid, 'twr_buyer'), (%L::uuid, 'twr_adm')) u(id, name);
$q$, twr.uid('buyer'), twr.uid('adm')));
select extensions.dblink_exec('setup', format(
  'update public.profiles set role = ''admin'' where id = %L', twr.uid('adm')));
select extensions.dblink_exec('setup', format(
  'insert into public.points_ledger (user_id, delta, reason, note) values (%L, -600, ''admin_adjust'', ''race fixture'')',
  twr.uid('buyer')));
select is(twr.bal(), 400, 'fixture committed: buyer has 400 points');

-- ===========================================================================
-- 1. Two different items, only one affordable: 300 in flight, then 350 -> INSUFFICIENT_POINTS
-- ===========================================================================
select ok(twr.connect('s1', 'buyer'), 'dblink session s1 (buyer)');
select extensions.dblink_send_query('s1',
  'select public.buy_item(''color_gold'')::text, pg_sleep(2)::text');
select ok(twr.wait_sleeping('s1'), 's1 bought gold and holds the profile lock (not committed yet)');

select set_config('request.jwt.claims', twr.claims('buyer'), true);
set local role authenticated;
select throws_ok($$ select public.buy_item('frame_chain') $$, 'P0001', 'INSUFFICIENT_POINTS',
                 'second purchase waits for the first, then sees 100 points and is refused');
reset role;
select is((select (r::jsonb ->> 'balance')::int from extensions.dblink_get_result('s1') as t(r text, s text)), 100,
          's1 purchase committed (balance 100)');
select is((select count(*)::int from extensions.dblink_get_result('s1') as t(r text, s text)), 0, 's1 drained');
select is(twr.bal(), 100, 'no double spend: 400 - 300');
select is(twr.shop_rows(), 1, 'exactly one shop ledger row');

-- ===========================================================================
-- 2. Same item twice at once -> one ALREADY_OWNED, charged once
-- ===========================================================================
select extensions.dblink_exec('setup', format(
  'insert into public.points_ledger (user_id, delta, reason, note) values (%L, 900, ''admin_adjust'', ''race fixture'')',
  twr.uid('buyer')));
select extensions.dblink_send_query('s1',
  'select public.buy_item(''color_crimson'')::text, pg_sleep(2)::text');
select ok(twr.wait_sleeping('s1'), 's1 bought crimson and holds the lock');
select set_config('request.jwt.claims', twr.claims('buyer'), true);
set local role authenticated;
select throws_ok($$ select public.buy_item('color_crimson') $$, 'P0001', 'ALREADY_OWNED',
                 'same item in parallel: the second call waits and finds it owned');
reset role;
select is((select (r::jsonb ->> 'balance')::int from extensions.dblink_get_result('s1') as t(r text, s text)), 800,
          's1 crimson committed (1000 - 200)');
select is((select count(*)::int from extensions.dblink_get_result('s1') as t(r text, s text)), 0, 's1 drained');
select is(twr.bal(), 800, 'charged once');
select is((select count(*)::int from public.user_items where user_id = twr.uid('buyer') and code = 'color_crimson'), 1,
          'owned once');

-- ===========================================================================
-- 3. Custom title request (500) in flight, then an 800 frame -> INSUFFICIENT_POINTS
-- ===========================================================================
select extensions.dblink_send_query('s1',
  'select public.request_title(''Race Winner'')::text, pg_sleep(2)::text');
select ok(twr.wait_sleeping('s1'), 's1 requested a title and holds the lock');
select set_config('request.jwt.claims', twr.claims('buyer'), true);
set local role authenticated;
select throws_ok($$ select public.buy_item('frame_crown') $$, 'P0001', 'INSUFFICIENT_POINTS',
                 'title request and purchase share the lock: 300 left after the request, crown refused');
reset role;
select is((select count(*)::int from extensions.dblink_get_result('s1') as t(r text, s text)), 1, 's1 request committed');
select is((select count(*)::int from extensions.dblink_get_result('s1') as t(r text, s text)), 0, 's1 drained');
select is(twr.bal(), 300, 'balance 800 - 500');
select ok(twr.bal() >= 0, 'balance never negative');

-- ---------------------------------------------------------------------------
-- Cleanup of the committed fixtures
-- ---------------------------------------------------------------------------
select twr.cleanup();
select is((select count(*)::int from public.profiles where username like 'twr\_%'), 0, 'race fixtures removed');
select extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c;

select * from finish();
rollback;
