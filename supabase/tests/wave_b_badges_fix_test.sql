-- pgTAP: WAVE B belt-badges review fixes (stale comeback after correction;
-- high_roller = stake >= 400 decision). Own transaction, rolled back.
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
-- 1. Correcting an EARLIER fight prunes a comeback earned on a LATER fight
--    that only existed because of the reversed payout.
-- ===========================================================================
update public.fights set status = 'cancelled', cancel_kind = 'cancelled'
 where status in ('open', 'locked', 'scheduled');
select tb.login('ba');
select public.admin_adjust_points(tb.uid('m1'), 40 - tb.bal('m1'), 'test dip');
select public.admin_adjust_points(tb.uid('m1'), 560, 'test refill');
select is(tb.bal('m1'), 600, 'm1 at 600 after a dip to 40');
select tb.put('f1', tb.fight('H', 'I', 0, '18:00'));
select tb.put('f2', tb.fight('J', 'K', 0, '19:00'));
select tb.login('m1');
select public.place_bet(tb.g('f1'), 'red', 300);
select public.place_bet(tb.g('f2'), 'red', 100);
select tb.login('u2');
select public.place_bet(tb.g('f1'), 'blue', 150);
select public.place_bet(tb.g('f2'), 'blue', 300);
select tb.login('ba');
select tb.settle(tb.g('f1'), 'red', 1, 0);
select is(tb.bal('m1'), 650, 'm1 650 after f1 (no comeback yet)');
select is(tb.ub('m1', 'comeback'), 0, 'no comeback below 1000');
select tb.settle(tb.g('f2'), 'red', 1, 0);
select is(tb.bal('m1'), 1050, 'm1 1050 after f2');
select is(tb.ub('m1', 'comeback'), 1, 'comeback earned on f2');
select is((select fight_id from public.user_badges where user_id = tb.uid('m1') and code = 'comeback'),
          tb.g('f2'), 'comeback tied to f2');

select is((public.admin_correct_result(tb.g('f1'), 'wrong winner') ->> 'user_badges_removed')::int, 1,
          'correcting f1 reports the pruned later comeback');
select is(tb.ub('m1', 'comeback'), 0, 'f2 comeback pruned: without the f1 payout m1 never reached 1000');
select is(tb.bal('m1'), 600, 'f1 payout reversed');

-- re-settle other side: m1 loses f1, still no comeback
select tb.settle(tb.g('f1'), 'blue', 0, 1);
select is(tb.bal('m1'), 600, 'm1 600 after f1 goes blue');
select is(tb.ub('m1', 'comeback'), 0, 'no comeback after re-settle for the other side');
select is(tb.ub('u2', 'comeback'), 0, 'u2 never dipped: no comeback');

-- correct again and re-settle red: the comeback comes back, now credited to f1
select public.admin_correct_result(tb.g('f1'), 'judges reversed');
select tb.settle(tb.g('f1'), 'red', 1, 0);
select is(tb.bal('m1'), 1050, 'm1 1050 again');
select is(tb.ub('m1', 'comeback'), 1, 'exactly one comeback after re-settle for red');
select is((select fight_id from public.user_badges where user_id = tb.uid('m1') and code = 'comeback'),
          tb.g('f1'), 'comeback now tied to f1 (the payout that crossed 1000)');

-- a correction never awards: helper is delete-only and idempotent
select is(private.prune_comeback(tb.uid('m1')), 0, 'prune_comeback keeps a valid comeback');
select is(private.is_comeback(tb.uid('m1'),
            (select min(l.id) from public.points_ledger l join public.bets b on b.id = l.ref_id
              where l.user_id = tb.uid('m1') and l.reason = 'payout' and b.fight_id = tb.g('f1'))),
          false, 'a reversed payout row never counts as a comeback');

-- ===========================================================================
-- 2. high_roller is decided on the STAKE (>= 400), not the payout.
-- ===========================================================================
select tb.put('hr', tb.fight('M', 'N', 1, '18:00'));
select tb.login('u5'); select public.place_bet(tb.g('hr'), 'red', 200);
select tb.login('u6'); select public.place_bet(tb.g('hr'), 'blue', 400);
select tb.login('ba'); select tb.settle(tb.g('hr'), 'red', 1, 0);
select is((select payout from public.bets where fight_id = tb.g('hr') and user_id = tb.uid('u5')), 600,
          'u5 payout 600 on a 200 stake');
select is(tb.ub('u5', 'high_roller'), 0, 'payout >= 400 on a 200 stake is not a Bold Pick');
select is(tb.ub('u6', 'high_roller'), 0, 'a lost 400 stake is not a Bold Pick');
select tb.put('hr2', tb.fight('O', 'Q', 1, '19:00'));
select tb.login('u5'); select public.place_bet(tb.g('hr2'), 'red', 400);
select tb.login('u6'); select public.place_bet(tb.g('hr2'), 'blue', 50);
select tb.login('ba'); select tb.settle(tb.g('hr2'), 'red', 1, 0);
select is(tb.ub('u5', 'high_roller'), 1, 'a won 400 stake is a Bold Pick');
select is((select description from public.badge_catalog where code = 'high_roller'),
          'Won a pick of 400+ points', 'catalog copy matches the stake rule');

select * from finish();
rollback;
