-- pgTAP: get_card_recap() -> "champion" is the belt holder at the END of that card, not today's
-- (fix in migration 20261103000014_wave_c_fixes.sql, section 3). One transaction, rolled back.
-- Own fixtures: usernames trc_*, nicknames "TRC *", cards in 2031 (far after any real card).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);
create schema trc;

create or replace function trc.uid(p text) returns uuid language sql immutable as $$
  select md5('trc-user:' || p)::uuid;
$$;
create or replace function trc.f(p text) returns uuid language sql immutable as $$
  select md5('trc-fighter:' || p)::uuid;
$$;
create or replace function trc.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', trc.uid(p), 'role', 'authenticated')::text, true);
$$;
-- one bout of a card, already settled (or cancelled) at p_settled
create or replace function trc.bout(p_red text, p_blue text, p_day date, p_order int, p_settled timestamptz,
                                    p_status text default 'settled')
returns uuid language sql as $$
  insert into public.fights (red_fighter_id, blue_fighter_id, scheduled_at, lock_at, status, winner_side,
                             method, rounds, red_score, blue_score, settled_at, bout_order, cancel_kind)
  values (trc.f(p_red), trc.f(p_blue), (p_day + time '20:00') at time zone 'Asia/Baghdad',
          (p_day + time '19:45') at time zone 'Asia/Baghdad', p_status,
          case when p_status = 'settled' then 'red' end, case when p_status = 'settled' then 'pin' end,
          case when p_status = 'settled' then 2 end, case when p_status = 'settled' then 3 end,
          case when p_status = 'settled' then 1 end,
          case when p_status = 'settled' then p_settled end, p_order,
          case when p_status = 'cancelled' then 'cancelled' end)
  returning id;
$$;
create or replace function trc.champ(p_day date) returns text language sql as $$
  select public.get_card_recap(p_day) -> 'champion' ->> 'nickname';
$$;
grant usage on schema trc to authenticated;
grant execute on all functions in schema trc to authenticated;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', trc.uid(u), 'authenticated', 'authenticated',
       'trc_' || u || '@members.uosfight.local', '',
       jsonb_build_object('username', 'trc_' || u, 'display_name', 'TRC ' || u),
       '{"provider":"email","providers":["email"]}', now(), now()
  from unnest(array['adm', 'mem']) u;
update public.profiles set role = 'admin' where id = trc.uid('adm');

insert into public.fighters (id, nickname, weight_kg)
select trc.f(n), 'TRC ' || n, 70 from unnest(array['X', 'Y', 'Z', 'P1', 'P2', 'Q1', 'Q2']) n;

-- Belt history in 2031: vacant -> X (Feb 1) -> Y (Mar 1, the instant a bout on card 03-01 settled) -> now.
-- Close whatever reign is current today before 2031 so it can't cover these cards.
update public.belt_reigns set ended_at = greatest(started_at, timestamptz '2030-12-31 00:00Z'),
                              end_reason = 'vacated'
 where ended_at is null;
insert into public.belt_reigns (fighter_id, started_at, ended_at, end_reason)
values (trc.f('X'), '2031-02-01 18:00Z', '2031-03-01 18:00Z', 'lost'),
       (trc.f('Y'), '2031-03-01 18:00Z', null, null);

select trc.bout('P1', 'P2', '2031-01-10', 1, '2031-01-10 18:00Z');   -- before any 2031 reign
select trc.bout('P1', 'P2', '2031-02-10', 1, '2031-02-10 17:00Z');   -- X's reign
select trc.bout('Q1', 'Q2', '2031-02-10', 2, '2031-02-10 18:00Z');
select trc.bout('X',  'Y',  '2031-03-01', 1, '2031-03-01 17:00Z');   -- card where the belt changed:
select trc.bout('Q1', 'Q2', '2031-03-01', 2, '2031-03-01 18:00Z');   -- last settle = the change instant
select trc.bout('P1', 'P2', '2031-04-01', 1, '2031-04-01 18:00Z');   -- current reign
select trc.bout('P1', 'P2', '2031-05-01', 1, null, 'cancelled');     -- nothing settled

select trc.login('mem'); set local role authenticated;
select is(trc.champ('2031-02-10'), 'TRC X', 'past card: the champion at that card, not today''s');
select is(trc.champ('2031-04-01'), 'TRC Y', 'card in the current reign: current champion');
select is(trc.champ('2031-03-01'), 'TRC Y', 'belt changed on this card: the new champion after the night');
select is(public.get_card_recap('2031-01-10') -> 'champion', 'null'::jsonb, 'no reign covered the card: null');
select is(trc.champ('2031-05-01'), 'TRC Y', 'no settled bout yet: the current champion');
select is(trc.champ('2031-06-01'), 'TRC Y', 'unknown date: the current champion');
select is(public.get_card_recap('2031-02-10') -> 'champion' ->> 'fighter_id', trc.f('X')::text,
          'champion carries the fighter id');
reset role;

-- a later settle on the same card moves the end of the card past the change
update public.fights set settled_at = '2031-03-01 17:30Z'
 where card_date = '2031-03-01' and red_fighter_id = trc.f('Q1');
select trc.login('mem'); set local role authenticated;
select is(trc.champ('2031-03-01'), 'TRC X', 'card ended before the belt changed: the old champion');
reset role;

-- hidden champion: masked for members (no fallback to an older reign), shown to admins
update public.fighters set hidden = true where id = trc.f('X');
select trc.login('mem'); set local role authenticated;
select is(public.get_card_recap('2031-02-10') -> 'champion', 'null'::jsonb, 'hidden champion masked for members');
select is(trc.champ('2031-04-01'), 'TRC Y', 'other cards unaffected by the hidden fighter');
reset role;
select trc.login('adm'); set local role authenticated;
select is(trc.champ('2031-02-10'), 'TRC X', 'admins see the hidden champion');
reset role;

-- the grants survived CREATE OR REPLACE
select ok(not has_function_privilege('anon', 'public.get_card_recap(date)', 'execute'), 'anon still cannot call it');

select * from finish();
rollback;
