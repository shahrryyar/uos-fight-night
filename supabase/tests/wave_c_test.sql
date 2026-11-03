-- pgTAP suite for WAVE C (CONTRACT.md ADDENDUM C, Wave C: C1 lockdown, C2 referee, C3 recap,
-- C4 Fight of the Night, C5 callouts, C6 shop, C7 Hall of Fame). Run: supabase test db.
-- One transaction, rolled back. Own fixtures (usernames tw_*, nicknames "TW *", cards >= 60 days
-- after the latest card in the DB). The lockdown section runs LAST, over all fixture rows.
-- Concurrency (no double-spend in the shop) lives in wave_c_shop_race_test.sql.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();
create schema twc;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function twc.uid(p text) returns uuid language sql immutable as $$
  select md5('tw-user:' || p)::uuid;
$$;
create or replace function twc.f(p text) returns uuid language sql immutable as $$
  select md5('tw-fighter:' || p)::uuid;
$$;
create or replace function twc.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', twc.uid(p), 'role', 'authenticated')::text, true);
$$;
create or replace function twc.mk_user(p text, p_display text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', twc.uid(p), 'authenticated', 'authenticated',
          'tw_' || p || '@members.uosfight.local', '',
          jsonb_build_object('username', 'tw_' || p, 'display_name', p_display),
          '{"provider":"email","providers":["email"]}', now(), now());
$$;
create or replace function twc.bal(p text) returns int language sql as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger where user_id = twc.uid(p);
$$;
create or replace function twc.put(k text, v text) returns text language sql as $$
  select set_config('twc.' || k, v, true);
$$;
create or replace function twc.g(k text) returns uuid language sql as $$
  select current_setting('twc.' || k)::uuid;
$$;
create or replace function twc.d(p_off int) returns date language sql as $$
  select current_setting('twc.d0')::date + p_off;
$$;
create or replace function twc.ts(p_off int, p_t time) returns timestamptz language sql as $$
  select (twc.d(p_off) + p_t) at time zone 'Asia/Baghdad';
$$;
-- create (as the admin in the claims) + open as if both fighters accepted (some have accounts,
-- so admin_force_open would refuse them)
create or replace function twc.fight(p_red text, p_blue text, p_off int, p_t time, p_main boolean default false)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  v := public.admin_create_fight(twc.f(p_red), twc.f(p_blue), twc.ts(p_off, p_t),
                                 twc.ts(p_off, p_t) - interval '15 minutes', 'TW ' || p_red || ' v ' || p_blue,
                                 null, null, null, p_main);
  update public.fights set red_accepted_at = now(), blue_accepted_at = now(), status = 'open' where id = v;
  return v;
end;
$$;
-- lock + settle (winner gets the higher score); caller must be an admin
create or replace function twc.settle(p_fight uuid, p_side text) returns jsonb language plpgsql as $$
begin
  perform public.admin_lock_fight(p_fight);
  return public.admin_settle_fight(p_fight, p_side, 'pin', null, 2,
                                   case p_side when 'red' then 3 else 1 end,
                                   case p_side when 'red' then 1 else 3 end);
end;
$$;
-- move every settle/cancel of a card back by 25h, i.e. close its FOTN window (now() is fixed in a test)
create or replace function twc.close_card(p_off int) returns void language sql as $$
  update public.fights set settled_at = settled_at - interval '25 hours'
   where card_date = twc.d(p_off) and status in ('settled', 'cancelled');
$$;
create or replace function twc.fotn_badges(p_fighter text) returns int language sql as $$
  select count(*)::int from public.fighter_badges where fighter_id = twc.f(p_fighter) and code = 'fight_of_the_night';
$$;
-- rows the CURRENT role can see in every selectable public table/view
create or replace function twc.visible_rows() returns table (rel text, n bigint) language plpgsql as $$
declare r record;
begin
  for r in
    select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
       and has_table_privilege(current_user, c.oid, 'select')
     order by 1
  loop
    rel := r.relname;
    execute format('select count(*) from public.%I', r.relname) into n;
    return next;
  end loop;
end;
$$;

grant usage on schema twc to authenticated, anon;
grant execute on all functions in schema twc to authenticated, anon;

select twc.put('d0', (select (coalesce(max(card_date), (now() at time zone 'Asia/Baghdad')::date) + 60)::text
                        from public.fights));

-- users: a1/a2 admins (a2 linked to fighter AL), ref/ref2 (referee; ref2 linked to R1),
-- m1..m3 linked to F1..F3, m4 no fighter, m5 linked to A1r, m6 (deactivated in C1)
select twc.mk_user('a1', 'Admin One');
select twc.mk_user('a2', 'Admin Two');
select twc.mk_user(u, 'User ' || u) from unnest(array['ref','ref2','m1','m2','m3','m4','m5','m6']) u;
update public.profiles set role = 'admin' where id in (twc.uid('a1'), twc.uid('a2'));

insert into public.fighters (id, nickname, weight_kg)
select twc.f(n), 'TW ' || n, 70.5
  from unnest(array['F1','F2','F3','F4','AL','FH','A1r','A1b','A2r','A2b','B1r','B1b','B2r','B2b',
                    'C1r','C1b','C2r','C2b','R1','R2','R3','R4','O1','O2','HS','HO1','HO2']) n;
update public.fighters set hidden = true where id = twc.f('FH');
update public.profiles set fighter_id = twc.f('F1')  where id = twc.uid('m1');
update public.profiles set fighter_id = twc.f('F2')  where id = twc.uid('m2');
update public.profiles set fighter_id = twc.f('F3')  where id = twc.uid('m3');
update public.profiles set fighter_id = twc.f('A1r') where id = twc.uid('m5');
update public.profiles set fighter_id = twc.f('AL')  where id = twc.uid('a2');
update public.profiles set fighter_id = twc.f('R1')  where id = twc.uid('ref2');

-- ===========================================================================
-- 0. Schema, privileges, realtime, cron
-- ===========================================================================
select has_table('public', t, t || ' table exists')
  from unnest(array['site_settings','fotn_votes','fotn_results','callouts','shop_items','user_items',
                    'title_requests']) t;
select has_view('public', v, v || ' view exists') from unnest(array['callout_board','member_cosmetics']) v;
select has_column('public', 'site_settings', c, 'site_settings.' || c)
  from unnest(array['id','lockdown','lockdown_message','updated_at','updated_by']) c;
select has_column('public', 'fotn_votes', c, 'fotn_votes.' || c) from unnest(array['card_date','user_id','fight_id']) c;
select col_is_pk('public', 'fotn_votes', array['card_date','user_id'], 'fotn_votes pk (card_date, user_id)');
select has_column('public', 'callouts', c, 'callouts.' || c)
  from unnest(array['id','challenger_fighter_id','target_fighter_id','message','status','created_by','created_at',
                    'rematch_of','fight_id']) c;
select has_column('public', 'shop_items', c, 'shop_items.' || c)
  from unnest(array['code','kind','label','value','price','active']) c;
select has_column('public', 'user_items', c, 'user_items.' || c)
  from unnest(array['user_id','code','purchased_at','equipped']) c;
select is((select string_agg(attname, ',' order by attnum) from pg_attribute
            where attrelid = 'public.member_cosmetics'::regclass and attnum between 1 and 4),
          'user_id,name_color,frame,title', 'member_cosmetics(user_id, name_color, frame, title)');
select is((select count(*)::int from public.site_settings), 1, 'site_settings singleton row');
select throws_ok($$ insert into public.site_settings (id) values (2) $$, '23514', null, 'site_settings id must be 1');
select ok((select pg_get_constraintdef(oid) like '%referee%' from pg_constraint where conname = 'profiles_role_check'),
          'profiles.role allows referee');
select ok((select pg_get_constraintdef(oid) like '%''shop''%' and pg_get_constraintdef(oid) like '%shop_refund%'
             from pg_constraint where conname = 'points_ledger_reason_check'), 'ledger reason allows shop + shop_refund');
select ok((select pg_get_constraintdef(oid) like '%season_reset%' and pg_get_constraintdef(oid) like '%payout_reversal%'
             from pg_constraint where conname = 'points_ledger_reason_check'), 'ledger reason keeps wave A/B reasons');
select results_eq($$ select kind, label, icon from public.badge_catalog where code = 'fight_of_the_night' $$,
                  $$ values ('fighter'::text, 'Fight of the Night'::text, 'Star'::text) $$,
                  'badge fight_of_the_night (fighter, icon name)');
select set_eq($$ select code, kind, price, value from public.shop_items where active $$,
              $$ values ('color_gold'::text, 'name_color'::text, 300, 'gold'::text), ('color_crimson', 'name_color', 200, 'crimson'),
                        ('color_ice_blue', 'name_color', 200, 'ice_blue'), ('color_neon_green', 'name_color', 250, 'neon_green'),
                        ('frame_flame', 'frame', 400, 'flame'), ('frame_chain', 'frame', 350, 'chain'),
                        ('frame_crown', 'frame', 800, 'crown'), ('title_custom', 'title', 500, null),
                        ('title_the_butcher', 'title', 300, 'The Butcher'), ('title_iron_grip', 'title', 300, 'Iron Grip'),
                        ('title_mat_rat', 'title', 150, 'Mat Rat') $$,
              'shop seeded per contract');
select is((select schedule from cron.job where jobname = 'fotn-finalize'), '*/10 * * * *', 'cron fotn-finalize every 10 min');
select is((select command from cron.job where jobname = 'fotn-finalize'), 'select private.fotn_finalize_due();',
          'cron runs private.fotn_finalize_due()');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t), t || ' is realtime')
  from unnest(array['site_settings','callouts']) t;
select is_empty($$ select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
                     and c.relname in ('callout_board','member_cosmetics')
                     and not coalesce(c.reloptions @> array['security_invoker=on'], false) $$,
                'wave C views are security_invoker');
select is_empty($$
  select p.oid::regprocedure from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('lockdown_on','is_member','is_locked_out','require_member','is_referee','public_site_status',
                       'admin_set_lockdown','public_next_fight','admin_set_member','fotn_window','fotn_finalize',
                       'fotn_finalize_due','fights_fotn_reset','fotn_state','get_fotn','cast_fotn_vote','get_card_recap',
                       'fighter_has_account','callout_prefill','create_callout','respond_callout','accept_callout',
                       'decline_callout','withdraw_callout','lock_callout_for_admin','callout_bookable',
                       'admin_approve_callout','admin_book_callout','admin_reject_callout','admin_delete_callout',
                       'buy_item','equip_item','unequip_item','request_title','lock_title_request',
                       'admin_approve_title','admin_reject_title','hall_of_fame')
     and not (p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""'])
$$, 'every wave C function is security definer with search_path = ''''');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1,
          f || ': exactly one overload')
  from unnest(array['public_site_status','admin_set_lockdown','is_locked_out','get_card_recap','get_fotn',
                    'cast_fotn_vote','create_callout','accept_callout','decline_callout','withdraw_callout',
                    'admin_approve_callout','admin_book_callout','admin_reject_callout','admin_delete_callout',
                    'buy_item','equip_item','unequip_item','request_title','admin_approve_title',
                    'admin_reject_title','hall_of_fame','admin_set_member','is_member','is_referee']) f;
select ok(has_function_privilege('authenticated', s, 'execute'), 'authenticated may execute ' || s)
  from unnest(array['public.public_site_status()','public.admin_set_lockdown(boolean,text)','public.is_locked_out()',
                    'public.get_card_recap(date)','public.get_fotn(date)','public.cast_fotn_vote(uuid)',
                    'public.create_callout(uuid,text,uuid)','public.accept_callout(uuid)','public.decline_callout(uuid)',
                    'public.withdraw_callout(uuid)','public.admin_approve_callout(uuid)',
                    'public.admin_book_callout(uuid,timestamptz,timestamptz,text,int,boolean)',
                    'public.admin_reject_callout(uuid,text)','public.admin_delete_callout(uuid,text)',
                    'public.buy_item(text)','public.equip_item(text)','public.unequip_item(text)',
                    'public.request_title(text)','public.admin_approve_title(uuid)',
                    'public.admin_reject_title(uuid,text)','public.hall_of_fame()']) s;
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
          array['public_next_fight','public_site_status'], 'anon may execute only public_next_fight + public_site_status');
select is_empty($$ select p.oid from pg_proc p where p.pronamespace = 'private'::regnamespace
                    and (has_function_privilege('authenticated', p.oid, 'execute')
                         or has_function_privilege('anon', p.oid, 'execute')) $$,
                'no private function is executable by clients');
select ok(has_table_privilege('authenticated', 'public.site_settings', 'select')
          and not has_table_privilege('anon', 'public.site_settings', 'select'),
          'site_settings: authenticated may select, anon may not');

set local role anon;
select is(public.public_site_status(), '{"lockdown": false, "message": null}'::jsonb, 'anon: public_site_status (off)');
select throws_ok(format('select * from public.%I', t), '42501', null, 'anon cannot select ' || t)
  from unnest(array['site_settings','fotn_votes','fotn_results','callouts','shop_items','user_items','title_requests',
                    'callout_board','member_cosmetics']) t;
select throws_ok(s, '42501', null, 'anon cannot run ' || s)
  from unnest(array['select public.get_fotn(current_date)', 'select public.cast_fotn_vote(gen_random_uuid())',
                    'select public.get_card_recap(current_date)', 'select public.hall_of_fame()',
                    'select public.buy_item(''color_gold'')', 'select public.create_callout(gen_random_uuid(), ''x'')',
                    'select public.admin_set_lockdown(true, null)', 'select public.is_locked_out()']) s;
reset role;

-- ===========================================================================
-- 1. C2 referee role
-- ===========================================================================
select twc.login('a1'); set local role authenticated;
select throws_ok(format($$ select public.admin_set_member(%L, null, 'boss', null) $$, twc.uid('ref')),
                 'P0001', 'INVALID_ROLE', 'admin_set_member: unknown role refused');
select lives_ok(format($$ select public.admin_set_member(%L, null, 'referee', null) $$, twc.uid('ref')),
                'admin_set_member assigns referee');
select lives_ok(format($$ select public.admin_set_member(%L, null, 'referee', %L) $$, twc.uid('ref2'), twc.f('R1')),
                'admin_set_member: referee linked to a fighter');
reset role;
select is((select role from public.profiles where id = twc.uid('ref')), 'referee', 'role stored as referee');
select is((select details ->> 'role' from public.admin_log where action = 'member_update' and target_id = twc.uid('ref')
            order by id desc limit 1), 'referee', 'member_update logged with role referee');

select twc.login('a1'); set local role authenticated;
select twc.put('rl', twc.fight('R1', 'R2', 0, '18:00')::text);   -- ref2 is linked to R1
select twc.put('rb', twc.fight('R3', 'R4', 0, '18:30')::text);   -- ref holds a pick here
reset role;

select twc.login('ref'); set local role authenticated;
select ok(public.is_referee(), 'referee: is_referee() true');
select ok(not public.is_admin(), 'referee: is_admin() false');
select ok(public.is_member(), 'referee is a member');
select lives_ok(format($$ select public.place_bet(%L, 'red', 20) $$, twc.g('rb')), 'referee may pick like a member');
reset role;

select twc.login('a1'); set local role authenticated;
select public.admin_lock_fight(twc.g('rl'));
select public.admin_lock_fight(twc.g('rb'));
reset role;

select twc.login('ref'); set local role authenticated;
select is((public.admin_live_update(twc.g('rl'), 'start') ->> 'running')::boolean, true,
          'referee runs the live scoreboard (start)');
select is((public.admin_live_update(twc.g('rl'), 'red_add', 2) ->> 'red_score')::int, 2, 'referee scores +2 red');
select throws_ok(format($$ select public.admin_live_update(%L, 'start') $$, twc.g('rb')),
                 'P0001', 'ADMIN_HAS_BET', 'referee holding a pick on the fight cannot score it');
-- every other admin_* RPC refuses a referee
select throws_ok(format('select public.%I(%s)', p.proname,
                        (select string_agg('null::' || format_type(t, null), ', ') from unnest(p.proargtypes) t)),
                 '42501', 'NOT_ADMIN', 'referee: ' || p.proname || ' -> NOT_ADMIN')
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%' and p.proname <> 'admin_live_update'
 order by p.proname;
select is((select count(*)::int from public.title_requests), 0, 'referee sees no admin-only rows (title_requests)');
reset role;
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname like 'admin\_%' and p.proname <> 'admin_live_update'), 20,
          '20 admin_* RPCs checked for referees');

select twc.login('ref2'); set local role authenticated;
select throws_ok(format($$ select public.admin_live_update(%L, 'pause') $$, twc.g('rl')),
                 'P0001', 'PARTICIPANT', 'referee linked to a fighter cannot score that fight');
reset role;
select twc.login('m1'); set local role authenticated;
select ok(not public.is_referee(), 'member is not a referee');
select throws_ok(format($$ select public.admin_live_update(%L, 'pause') $$, twc.g('rl')),
                 '42501', 'NOT_REFEREE', 'member cannot score');
reset role;

-- ===========================================================================
-- 2. C4 Fight of the Night
-- ===========================================================================
select twc.login('a1'); set local role authenticated;
select twc.put('a1f', twc.fight('A1r', 'A1b', 1, '20:00')::text);
select twc.put('a2f', twc.fight('A2r', 'A2b', 1, '21:00', true)::text);
select twc.settle(twc.g('a1f'), 'red');
select public.admin_lock_fight(twc.g('a2f'));
reset role;

select twc.login('m1'); set local role authenticated;
select throws_ok(format($$ select public.cast_fotn_vote(%L) $$, twc.g('a2f')),
                 'P0001', 'FOTN_NOT_ELIGIBLE', 'cannot vote for a bout that is not settled');
select throws_ok(format($$ select public.cast_fotn_vote(%L) $$, twc.g('a1f')),
                 'P0001', 'FOTN_NOT_OPEN', 'voting opens only when the whole card is done');
select throws_ok($$ select public.cast_fotn_vote(gen_random_uuid()) $$, 'P0001', 'FIGHT_NOT_FOUND', 'unknown fight');
select throws_ok($$ select public.get_fotn(null) $$, 'P0001', 'INVALID_DATE', 'get_fotn(null) refused');
select is(public.get_fotn(twc.d(1)) ->> 'status', 'not_ready', 'card in progress: not_ready');
select is(public.get_fotn(twc.d(1)) -> 'closes_at', 'null'::jsonb, 'not_ready: no closes_at');
reset role;

select twc.login('a1'); set local role authenticated;
select twc.settle(twc.g('a2f'), 'blue');
reset role;

select twc.login('m1'); set local role authenticated;
select is(public.cast_fotn_vote(twc.g('a1f')) ->> 'my_vote', twc.g('a1f')::text, 'm1 votes A1');
reset role;
select twc.login('m2'); set local role authenticated; select public.cast_fotn_vote(twc.g('a1f')); reset role;
select twc.login('m3'); set local role authenticated; select public.cast_fotn_vote(twc.g('a2f')); reset role;
select twc.login('m4'); set local role authenticated;
select public.cast_fotn_vote(twc.g('a2f'));
select is(public.cast_fotn_vote(twc.g('a1f')) ->> 'my_vote', twc.g('a1f')::text, 'vote can be changed in the window');
select is((select count(*)::int from public.fotn_votes), 1, 'one vote per user per card (changed, not added)');
reset role;
select twc.login('m5'); set local role authenticated;     -- linked to A1r
select throws_ok(format($$ select public.cast_fotn_vote(%L) $$, twc.g('a1f')),
                 'P0001', 'PARTICIPANT', 'a fighter cannot vote for their own bout');
select lives_ok(format($$ select public.cast_fotn_vote(%L) $$, twc.g('a2f')), 'a fighter may vote for another bout');
reset role;

select twc.login('m4'); set local role authenticated;
select is(public.get_fotn(twc.d(1)) ->> 'status', 'open', 'window open');
select is((public.get_fotn(twc.d(1)) ->> 'open')::boolean, true, 'open = true');
select is((public.get_fotn(twc.d(1)) ->> 'closes_at')::timestamptz,
          (select max(settled_at) + interval '24 hours' from public.fights where card_date = twc.d(1)),
          'closes 24h after the last settle');
select is(public.get_fotn(twc.d(1)) -> 'counts', 'null'::jsonb, 'counts hidden while open');
select is(public.get_fotn(twc.d(1)) -> 'winner_fight_id', 'null'::jsonb, 'winner hidden while open');
select is(public.get_fotn(twc.d(1)) -> 'total_votes', 'null'::jsonb, 'total hidden while open');
select is(public.get_fotn(twc.d(1)) -> 'candidates',
          jsonb_build_array(twc.g('a1f'), twc.g('a2f')), 'candidates = settled bouts in bout order');
select is((select count(*)::int from public.fotn_votes), 1, 'member sees only their own fotn vote');
select is((select count(*)::int from public.fotn_results where card_date = twc.d(1)), 0, 'no results row while open');
reset role;
select twc.login('a1'); set local role authenticated;
select is((select count(*)::int from public.fotn_votes), 0, 'admins cannot see other people''s fotn votes either');
reset role;
select is(private.fotn_finalize(twc.d(1)), false, 'finalize before the window closes does nothing');
select twc.login('m1'); set local role authenticated;
select throws_ok($$ select private.fotn_finalize_due() $$, '42501', null, 'members cannot run the cron body');
select throws_ok($$ insert into public.fotn_votes (card_date, user_id, fight_id) values (current_date, auth.uid(), gen_random_uuid()) $$,
                 '42501', null, 'no direct fotn_votes writes');
reset role;

-- close the window -> lazy finalize on read
select twc.close_card(1);
select twc.login('m3'); set local role authenticated;
select is(public.get_fotn(twc.d(1)) ->> 'status', 'closed', 'window closed');
select is(public.get_fotn(twc.d(1)) ->> 'winner_fight_id', twc.g('a1f')::text, 'winner = most votes (A1: 3 v 2)');
select is((public.get_fotn(twc.d(1)) ->> 'total_votes')::int, 5, 'total votes after close');
select is(public.get_fotn(twc.d(1)) -> 'counts',
          jsonb_build_array(jsonb_build_object('fight_id', twc.g('a1f'), 'votes', 3),
                            jsonb_build_object('fight_id', twc.g('a2f'), 'votes', 2)), 'counts after close');
select is(public.get_fotn(twc.d(1)) ->> 'my_vote', twc.g('a2f')::text, 'my_vote still shown after close');
select throws_ok(format($$ select public.cast_fotn_vote(%L) $$, twc.g('a2f')), 'P0001', 'FOTN_CLOSED', 'no votes after close');
select is((select count(*)::int from public.fotn_results where card_date = twc.d(1)), 1, 'members read fotn_results');
reset role;
select is(twc.fotn_badges('A1r') + twc.fotn_badges('A1b'), 2, 'both FOTN fighters get the badge');
select is(twc.fotn_badges('A2r') + twc.fotn_badges('A2b'), 0, 'losing bout gets none');
select is((select fight_id from public.fighter_badges where fighter_id = twc.f('A1r') and code = 'fight_of_the_night'),
          twc.g('a1f'), 'badge is tied to the winning fight');
select is(private.fotn_finalize(twc.d(1)), false, 'finalize is idempotent');
select is(twc.fotn_badges('A1r'), 1, 'no duplicate badge');
select is((select count(*)::int from public.admin_log where action = 'fotn_finalize' and details ->> 'card_date' = twc.d(1)::text),
          1, 'finalize logged once');

-- correction reopens the card's FOTN
select twc.login('a1'); set local role authenticated;
select lives_ok(format($$ select public.admin_correct_result(%L, 'wrong corner recorded') $$, twc.g('a1f')),
                'admin corrects a bout of a closed FOTN card');
reset role;
select is((select count(*)::int from public.fotn_results where card_date = twc.d(1)), 0, 'correction drops the card result');
select is(twc.fotn_badges('A1r') + twc.fotn_badges('A1b'), 0, 'correction strips the card''s FOTN badges');
select twc.login('m3'); set local role authenticated;
select is(public.get_fotn(twc.d(1)) ->> 'status', 'not_ready', 'card back to not_ready');
select is(public.get_fotn(twc.d(1)) ->> 'my_vote', twc.g('a2f')::text, 'votes are kept');
reset role;
select twc.login('a1'); set local role authenticated;
select public.admin_settle_fight(twc.g('a1f'), 'blue', 'decision', null, 3, 2, 4);
reset role;
select twc.login('m4'); set local role authenticated;
select is(public.get_fotn(twc.d(1)) ->> 'status', 'open', 're-settle opens a new window');
select is((public.get_fotn(twc.d(1)) ->> 'closes_at')::timestamptz,
          (select settled_at + interval '24 hours' from public.fights where id = twc.g('a1f')), 'new window = 24h from re-settle');
select is(public.get_fotn(twc.d(1)) ->> 'my_vote', twc.g('a1f')::text, 'old vote still counts');
select public.cast_fotn_vote(twc.g('a2f'));    -- A2 now leads 3 v 2
reset role;
select twc.close_card(1);
select is(private.fotn_finalize_due() >= 1, true, 'cron body finalizes due cards');
select is((select winner_fight_id from public.fotn_results where card_date = twc.d(1)), twc.g('a2f'), 're-finalized: A2 wins');
select is(twc.fotn_badges('A2r') + twc.fotn_badges('A2b'), 2, 'new winners badged');
select is(twc.fotn_badges('A1r') + twc.fotn_badges('A1b'), 0, 'old winners not re-badged');

-- tie -> main event; card with a cancelled bout and no votes -> no winner
select twc.login('a1'); set local role authenticated;
select twc.put('b1f', twc.fight('B1r', 'B1b', 2, '20:00')::text);
select twc.put('b2f', twc.fight('B2r', 'B2b', 2, '21:00', true)::text);
select twc.settle(twc.g('b2f'), 'red');      -- main event settled first: a tie must not fall to "later settle"
select twc.settle(twc.g('b1f'), 'red');
select twc.put('c1f', twc.fight('C1r', 'C1b', 3, '20:00')::text);
select twc.put('c2f', twc.fight('C2r', 'C2b', 3, '21:00')::text);
select twc.settle(twc.g('c1f'), 'blue');
select public.admin_cancel_fight(twc.g('c2f'), 'injury', 'cancelled');
reset role;
select twc.login('m1'); set local role authenticated; select public.cast_fotn_vote(twc.g('b1f'));
select throws_ok(format($$ select public.cast_fotn_vote(%L) $$, twc.g('c2f')), 'P0001', 'FOTN_NOT_ELIGIBLE',
                 'cancelled bouts are not candidates');
select is(public.get_fotn(twc.d(3)) ->> 'status', 'open', 'card with a cancelled bout is complete');
select is(public.get_fotn(twc.d(3)) -> 'candidates', jsonb_build_array(twc.g('c1f')), 'only the settled bout is a candidate');
reset role;
select twc.login('m2'); set local role authenticated; select public.cast_fotn_vote(twc.g('b2f')); reset role;
select twc.close_card(2);
select twc.close_card(3);
select private.fotn_finalize_due();
select is((select winner_fight_id from public.fotn_results where card_date = twc.d(2)), twc.g('b2f'), 'tie goes to the main event');
select results_eq($$ select winner_fight_id, total_votes from public.fotn_results where card_date = twc.d(3) $$,
                  $$ values (null::uuid, 0) $$, 'no votes: closed without a winner');
select is(twc.fotn_badges('C1r') + twc.fotn_badges('C1b'), 0, 'no winner, no badge');

-- ===========================================================================
-- 3. C3 card recap
-- ===========================================================================
update public.fighters set hidden = true where id = twc.f('A2b');
select twc.login('m1'); set local role authenticated;
select throws_ok($$ select public.get_card_recap(null) $$, 'P0001', 'INVALID_DATE', 'recap needs a date');
select is((public.get_card_recap(twc.d(1)) ->> 'complete')::boolean, true, 'recap: card complete');
select is((public.get_card_recap(twc.d(1)) ->> 'settled_count')::int, 2, 'recap: 2 settled');
select is(jsonb_array_length(public.get_card_recap(twc.d(1)) -> 'fights'), 2, 'recap: 2 fights');
select is(public.get_card_recap(twc.d(1)) -> 'fights' -> 0 ->> 'fight_id', twc.g('a1f')::text, 'recap: bout order');
select is(public.get_card_recap(twc.d(1)) -> 'fights' -> 0 -> 'red' ->> 'nickname', 'TW A1r', 'recap: red nickname');
select is((public.get_card_recap(twc.d(1)) -> 'fights' -> 0 -> 'red' ->> 'kg')::numeric, 70.5, 'recap: kg');
select is((public.get_card_recap(twc.d(1)) -> 'fights' -> 0 -> 'blue' ->> 'score')::int, 4, 'recap: score');
select is(public.get_card_recap(twc.d(1)) -> 'fights' -> 0 ->> 'winner_side', 'blue', 'recap: corrected winner');
select is(public.get_card_recap(twc.d(1)) -> 'fights' -> 0 ->> 'method', 'decision', 'recap: method');
select is((public.get_card_recap(twc.d(1)) -> 'fights' -> 0 ->> 'rounds')::int, 3, 'recap: rounds');
select is((public.get_card_recap(twc.d(1)) -> 'fights' -> 1 ->> 'is_main_event')::boolean, true, 'recap: main event flag');
select is((public.get_card_recap(twc.d(1)) -> 'fights' -> 1 ->> 'is_fotn')::boolean, true, 'recap: FOTN flag');
select is((public.get_card_recap(twc.d(1)) -> 'fights' -> 0 ->> 'is_fotn')::boolean, false, 'recap: not FOTN');
select is(public.get_card_recap(twc.d(1)) -> 'fotn' ->> 'winner_fight_id', twc.g('a2f')::text, 'recap: fotn winner');
select ok(public.get_card_recap(twc.d(1)) -> 'fights' -> 1 ? 'is_title_fight', 'recap: title flag present');
select is(public.get_card_recap(twc.d(1)) -> 'fights' -> 1 -> 'blue' -> 'nickname', 'null'::jsonb,
          'recap: hidden fighter nickname masked for members');
select is(public.get_card_recap(twc.d(1)) -> 'champion',
          (select case when c.fighter_id is null then 'null'::jsonb
                       else jsonb_build_object('fighter_id', c.fighter_id, 'nickname', c.nickname) end
             from (select 1) x left join public.current_champion c on true),
          'recap: current champion');
select is((public.get_card_recap(twc.d(3)) -> 'fights' -> 1 ->> 'status'), 'cancelled', 'recap lists cancelled bouts with status');
select is(public.get_card_recap(twc.d(400)), jsonb_build_object('card_date', twc.d(400), 'complete', false,
            'settled_count', 0, 'champion', public.get_card_recap(twc.d(400)) -> 'champion',
            'fotn', jsonb_build_object('status', 'not_ready', 'closes_at', null, 'winner_fight_id', null),
            'fights', '[]'::jsonb), 'recap: empty card');
reset role;
select twc.login('a1'); set local role authenticated;
select is(public.get_card_recap(twc.d(1)) -> 'fights' -> 1 -> 'blue' ->> 'nickname', 'TW A2b', 'recap: admins see hidden names');
reset role;
update public.fighters set hidden = false where id = twc.f('A2b');

-- ===========================================================================
-- 4. C5 callouts
-- ===========================================================================
select twc.login('m4'); set local role authenticated;
select throws_ok(format($$ select public.create_callout(%L, 'hi') $$, twc.f('F1')), 'P0001', 'NOT_A_FIGHTER',
                 'members without a fighter cannot call out');
reset role;
select twc.login('m1'); set local role authenticated;
select throws_ok(format($$ select public.create_callout(%L, %L) $$, twc.f('F2'), repeat('x', 141)),
                 'P0001', 'INVALID_MESSAGE', 'message over 140 chars refused');
select throws_ok(format($$ select public.create_callout(%L, %L) $$, twc.f('F2'), 'line' || chr(10) || 'break'),
                 'P0001', 'INVALID_MESSAGE', 'control characters refused');
select throws_ok(format($$ select public.create_callout(%L, 'me') $$, twc.f('F1')), 'P0001', 'SAME_FIGHTER', 'no self callout');
select throws_ok($$ select public.create_callout(gen_random_uuid(), 'x') $$, 'P0001', 'FIGHTER_NOT_FOUND', 'unknown target');
select throws_ok($$ select public.create_callout(null, 'x') $$, 'P0001', 'FIGHTER_NOT_FOUND', 'null target (no rematch)');
select throws_ok(format($$ select public.create_callout(%L, 'x') $$, twc.f('FH')), 'P0001', 'FIGHTER_HIDDEN', 'hidden target');
select twc.put('c12', public.create_callout(twc.f('F2'), '  See you on the mat  ')::text);
select results_eq(format($$ select status, message, created_by, challenger_fighter_id, target_fighter_id
                             from public.callouts where id = %L $$, twc.g('c12')),
                  format($$ values ('pending'::text, 'See you on the mat'::text, %L::uuid, %L::uuid, %L::uuid) $$,
                         twc.uid('m1'), twc.f('F1'), twc.f('F2')),
                  'callout created: pending, trimmed message');
select throws_ok(format($$ select public.create_callout(%L, 'again') $$, twc.f('F2')), 'P0001', 'CALLOUT_EXISTS',
                 'one open callout per pair');
select twc.put('c13', public.create_callout(twc.f('F3'), '   ')::text);
select is((select message from public.callouts where id = twc.g('c13')), null, 'blank message stored as null');
select twc.put('c14', public.create_callout(twc.f('F4'), 'You there?')::text);
select throws_ok(format($$ select public.create_callout(%L, 'one more') $$, twc.f('AL')), 'P0001', 'CALLOUT_LIMIT',
                 'max 3 open callouts per challenger');
reset role;
select twc.login('m2'); set local role authenticated;
select throws_ok(format($$ select public.create_callout(%L, 'reverse') $$, twc.f('F1')), 'P0001', 'CALLOUT_EXISTS',
                 'pair rule works in both directions');
reset role;

select twc.login('m3'); set local role authenticated;
select throws_ok(format($$ select public.accept_callout(%L) $$, twc.g('c12')), 'P0001', 'NOT_TARGET', 'only the target answers');
select throws_ok($$ select public.accept_callout(gen_random_uuid()) $$, 'P0001', 'CALLOUT_NOT_FOUND', 'unknown callout');
select lives_ok(format($$ select public.decline_callout(%L) $$, twc.g('c13')), 'target declines');
select throws_ok(format($$ select public.admin_approve_callout(%L) $$, twc.g('c12')), '42501', 'NOT_ADMIN', 'members cannot approve');
reset role;
select is((select status from public.callouts where id = twc.g('c13')), 'declined', 'declined stored');
select twc.login('m2'); set local role authenticated;
select lives_ok(format($$ select public.accept_callout(%L) $$, twc.g('c12')), 'target accepts');
select throws_ok(format($$ select public.accept_callout(%L) $$, twc.g('c12')), 'P0001', 'CALLOUT_BAD_STATE', 'accept twice refused');
select throws_ok(format($$ select public.decline_callout(%L) $$, twc.g('c12')), 'P0001', 'CALLOUT_BAD_STATE', 'decline after accept refused');
reset role;
select results_eq(format($$ select status, responded_by from public.callouts where id = %L $$, twc.g('c12')),
                  format($$ values ('accepted'::text, %L::uuid) $$, twc.uid('m2')), 'accepted + responded_by');

select twc.login('m1'); set local role authenticated;
select twc.put('c1al', public.create_callout(twc.f('AL'), 'Admin, step up')::text);   -- declined one freed a slot
reset role;
select twc.login('m2'); set local role authenticated;
select throws_ok(format($$ select public.withdraw_callout(%L) $$, twc.g('c1al')), 'P0001', 'NOT_CHALLENGER',
                 'only the challenger withdraws');
reset role;
select twc.login('m1'); set local role authenticated;
select lives_ok(format($$ select public.withdraw_callout(%L) $$, twc.g('c1al')), 'challenger withdraws');
select throws_ok(format($$ select public.withdraw_callout(%L) $$, twc.g('c13')), 'P0001', 'CALLOUT_BAD_STATE',
                 'cannot withdraw a declined callout');
select throws_ok($$ insert into public.callouts (challenger_fighter_id, target_fighter_id) values (gen_random_uuid(), gen_random_uuid()) $$,
                 '42501', null, 'no direct callout inserts');
select throws_ok($$ update public.callouts set status = 'booked' $$, '42501', null, 'no direct callout updates');
reset role;
select is((select count(*)::int from public.callouts where id = twc.g('c1al')), 0, 'withdrawn callout deleted');

-- admin side
select twc.login('m3'); set local role authenticated;
select twc.put('c32', public.create_callout(twc.f('F2'), 'Your turn')::text);
reset role;
select twc.login('m2'); set local role authenticated;
select twc.put('cal2', public.create_callout(twc.f('AL'), 'Admin fight')::text);
reset role;

select twc.login('a1'); set local role authenticated;
select throws_ok(format($$ select public.admin_approve_callout(%L) $$, twc.g('c13')), 'P0001', 'CALLOUT_BAD_STATE',
                 'cannot approve a declined callout');
select throws_ok(format($$ select public.admin_approve_callout(%L) $$, twc.g('c32')), 'P0001', 'CALLOUT_BAD_STATE',
                 'cannot approve before the target (with an account) accepts');
select is(public.admin_approve_callout(twc.g('c12')),
          jsonb_build_object('callout_id', twc.g('c12'), 'red_fighter_id', twc.f('F1'), 'blue_fighter_id', twc.f('F2'),
                             'red_nickname', 'TW F1', 'blue_nickname', 'TW F2', 'red_weight_kg', 70.5,
                             'blue_weight_kg', 70.5, 'title', 'TW F1 vs TW F2', 'rematch_of', null),
          'approve returns the create-fight prefill');
select throws_ok(format($$ select public.admin_approve_callout(%L) $$, twc.g('c12')), 'P0001', 'CALLOUT_BAD_STATE',
                 'approve twice refused');
select lives_ok(format($$ select public.admin_approve_callout(%L) $$, twc.g('c14')),
                'pending callout to a fighter without an account can be approved');
reset role;
select results_eq(format($$ select status, decided_by from public.callouts where id = %L $$, twc.g('c12')),
                  format($$ values ('approved'::text, %L::uuid) $$, twc.uid('a1')), 'approved + decided_by');

select twc.login('a2'); set local role authenticated;    -- linked to AL
select throws_ok(format($$ select public.admin_approve_callout(%L) $$, twc.g('cal2')), 'P0001', 'PARTICIPANT',
                 'linked admin cannot approve');
select throws_ok(format($$ select public.admin_reject_callout(%L) $$, twc.g('cal2')), 'P0001', 'PARTICIPANT',
                 'linked admin cannot reject');
select throws_ok(format($$ select public.admin_delete_callout(%L) $$, twc.g('cal2')), 'P0001', 'PARTICIPANT',
                 'linked admin cannot delete');
reset role;

select twc.login('a1'); set local role authenticated;
select twc.put('bf', public.admin_book_callout(twc.g('c12'), twc.ts(5, '20:00'), twc.ts(5, '19:45'))::text);
select throws_ok(format($$ select public.admin_book_callout(%L, now(), now()) $$, twc.g('c12')), 'P0001', 'CALLOUT_BAD_STATE',
                 'book twice refused');
select throws_ok(format($$ select public.admin_book_callout(%L, now(), now()) $$, twc.g('cal2')), 'P0001', 'CALLOUT_BAD_STATE',
                 'cannot book a pending callout whose target has an account');
reset role;
select results_eq(format($$ select status, fight_id from public.callouts where id = %L $$, twc.g('c12')),
                  format($$ values ('booked'::text, %L::uuid) $$, twc.g('bf')), 'callout booked with fight id');
select results_eq(format($$ select red_fighter_id, blue_fighter_id, status, red_accepted_at, blue_accepted_at, title
                             from public.fights where id = %L $$, twc.g('bf')),
                  format($$ values (%L::uuid, %L::uuid, 'scheduled'::text, null::timestamptz, null::timestamptz, 'TW F1 vs TW F2'::text) $$,
                         twc.f('F1'), twc.f('F2')),
                  'booked fight: scheduled, normal consent flow (nobody pre-accepted)');
select is((select count(*)::int from public.admin_log where action = 'callout_book' and target_id = twc.g('c12')), 1,
          'booking logged');

select twc.login('m2'); set local role authenticated; select public.accept_callout(twc.g('c32')); reset role;
select twc.login('a1'); set local role authenticated;
select twc.put('bf2', public.admin_book_callout(twc.g('c32'), twc.ts(5, '21:00'), twc.ts(5, '20:45'), 'Grudge Match')::text);
select throws_ok(format($$ select public.admin_reject_callout(%L, %L) $$, twc.g('cal2'), repeat('r', 201)),
                 'P0001', 'INVALID_REASON', 'reject reason max 200');
select lives_ok(format($$ select public.admin_reject_callout(%L, 'Not this week') $$, twc.g('cal2')), 'admin rejects');
select throws_ok(format($$ select public.admin_reject_callout(%L) $$, twc.g('cal2')), 'P0001', 'CALLOUT_BAD_STATE',
                 'reject twice refused');
select lives_ok(format($$ select public.admin_delete_callout(%L, 'spam') $$, twc.g('c14')), 'admin deletes a callout');
reset role;
select is((select title from public.fights where id = twc.g('bf2')), 'Grudge Match', 'book from accepted with a custom title');
select results_eq(format($$ select status, decision_note from public.callouts where id = %L $$, twc.g('cal2')),
                  $$ values ('rejected'::text, 'Not this week'::text) $$, 'rejected with note');
select is((select count(*)::int from public.callouts where id = twc.g('c14')), 0, 'deleted');
select is((select details ->> 'message_len' from public.admin_log where action = 'callout_delete' and target_id = twc.g('c14')),
          '10', 'delete logged with the message length only (20261103000033: no text in admin_log)');

-- rematch
select twc.login('a1'); set local role authenticated;
select twc.put('rm', twc.fight('F1', 'F2', 6, '20:00')::text);
select twc.settle(twc.g('rm'), 'blue');      -- F2 beats F1
reset role;
select twc.login('m2'); set local role authenticated;
select throws_ok(format($$ select public.create_callout(null, 'again?', %L) $$, twc.g('rm')), 'P0001', 'NOT_REMATCH_ELIGIBLE',
                 'the winner cannot ask for a rematch');
reset role;
select twc.login('m1'); set local role authenticated;
select throws_ok(format($$ select public.create_callout(%L, 'x', %L) $$, twc.f('F3'), twc.g('rm')), 'P0001',
                 'NOT_REMATCH_ELIGIBLE', 'rematch target must be the winner');
select throws_ok(format($$ select public.create_callout(null, 'x', %L) $$, twc.g('bf')), 'P0001',
                 'NOT_REMATCH_ELIGIBLE', 'rematch only of a settled fight');
select twc.put('crm', public.create_callout(null, 'Run it back', twc.g('rm'))::text);
reset role;
select results_eq(format($$ select target_fighter_id, rematch_of from public.callouts where id = %L $$, twc.g('crm')),
                  format($$ values (%L::uuid, %L::uuid) $$, twc.f('F2'), twc.g('rm')), 'rematch: target inferred, linked');
select twc.login('m2'); set local role authenticated; select public.accept_callout(twc.g('crm')); reset role;
select twc.login('a1'); set local role authenticated;
select is(public.admin_approve_callout(twc.g('crm')) ->> 'title', 'Rematch: TW F1 vs TW F2', 'rematch prefill title');
reset role;

-- visibility
insert into public.callouts (id, challenger_fighter_id, target_fighter_id, message)
values ('c0ffee00-0000-4000-8000-00000000000f', twc.f('FH'), twc.f('F3'), 'hidden');
select twc.login('m1'); set local role authenticated;
select is((select count(*)::int from public.callouts where id = 'c0ffee00-0000-4000-8000-00000000000f'), 0,
          'members do not see callouts involving hidden fighters');
select results_eq(format($$ select challenger_nickname, target_nickname, status, is_open from public.callout_board where id = %L $$,
                         twc.g('crm')),
                  $$ values ('TW F1'::text, 'TW F2'::text, 'approved'::text, true) $$, 'callout_board with nicknames');
reset role;
select twc.login('a1'); set local role authenticated;
select is((select count(*)::int from public.callouts where id = 'c0ffee00-0000-4000-8000-00000000000f'), 1,
          'admins see every callout');
reset role;

-- ===========================================================================
-- 5. C6 shop
-- ===========================================================================
select is(twc.bal('m1'), 1000, 'm1 starts at 1000');
select twc.login('m1'); set local role authenticated;
select is(public.buy_item('color_gold'),
          '{"code": "color_gold", "kind": "name_color", "price": 300, "balance": 700}'::jsonb, 'buy_item result');
select is(public.my_balance(), 700, 'price deducted');
select results_eq($$ select delta, reason, note from public.points_ledger where user_id = auth.uid() and reason = 'shop' $$,
                  $$ values (-300, 'shop'::text, 'color_gold'::text) $$, 'ledger row reason shop');
select results_eq($$ select code, kind, equipped from public.user_items where user_id = auth.uid() $$,
                  $$ values ('color_gold'::text, 'name_color'::text, false) $$, 'owned, not equipped');
select throws_ok($$ select public.buy_item('color_gold') $$, 'P0001', 'ALREADY_OWNED', 'cannot buy what you own');
select throws_ok($$ select public.buy_item('title_custom') $$, 'P0001', 'USE_TITLE_REQUEST', 'custom title goes through request_title');
select throws_ok($$ select public.buy_item('nope') $$, 'P0001', 'ITEM_NOT_FOUND', 'unknown item');
select throws_ok($$ select public.buy_item('frame_crown') $$, 'P0001', 'INSUFFICIENT_POINTS', 'not enough points (800 > 700)');
select is(public.my_balance(), 700, 'failed buy charged nothing');
reset role;
update public.shop_items set active = false where code = 'frame_flame';
select twc.login('m1'); set local role authenticated;
select throws_ok($$ select public.buy_item('frame_flame') $$, 'P0001', 'ITEM_NOT_FOUND', 'inactive items cannot be bought');
reset role;
update public.shop_items set active = true where code = 'frame_flame';

select twc.login('m1'); set local role authenticated;
select throws_ok($$ select public.equip_item('frame_flame') $$, 'P0001', 'NOT_OWNED', 'equip needs ownership');
select throws_ok($$ select public.equip_item('nope') $$, 'P0001', 'ITEM_NOT_FOUND', 'equip unknown item');
select lives_ok($$ select public.equip_item('color_gold') $$, 'equip gold');
select public.buy_item('color_crimson');
select lives_ok($$ select public.equip_item('color_crimson') $$, 'equip crimson');
select results_eq($$ select code, equipped from public.user_items where user_id = auth.uid() order by code $$,
                  $$ values ('color_crimson'::text, true), ('color_gold', false) $$, 'one equipped per kind');
select results_eq($$ select name_color, name_color_code, frame, title from public.member_cosmetics where user_id = auth.uid() $$,
                  $$ values ('crimson'::text, 'color_crimson'::text, null::text, null::text) $$, 'member_cosmetics shows equipped colour');
select throws_ok($$ select public.unequip_item('bogus') $$, 'P0001', 'INVALID_KIND', 'unequip unknown kind');
select public.unequip_item('name_color');
select is((select count(*)::int from public.member_cosmetics where user_id = auth.uid()), 0, 'nothing equipped -> no row');
select public.equip_item('color_crimson');
select is(public.my_balance(), 500, '1000 - 300 - 200');
reset role;
select twc.login('m2'); set local role authenticated;
select results_eq(format($$ select code from public.user_items where user_id = %L $$, twc.uid('m1')),
                  $$ values ('color_crimson'::text) $$, 'others see only equipped items');
select is((select name_color from public.member_cosmetics where user_id = twc.uid('m1')), 'crimson',
          'others read member_cosmetics');
select throws_ok($$ insert into public.user_items (user_id, code, kind) values (auth.uid(), 'frame_crown', 'frame') $$,
                 '42501', null, 'no direct user_items inserts');
select throws_ok($$ update public.user_items set equipped = true $$, '42501', null, 'no direct user_items updates');
select throws_ok($$ insert into public.points_ledger (user_id, delta, reason) values (auth.uid(), 1000, 'shop_refund') $$,
                 '42501', null, 'no direct ledger writes');
select throws_ok($$ update public.shop_items set price = 1 $$, '42501', null, 'no direct shop_items updates');
reset role;

-- custom titles
select twc.login('m1'); set local role authenticated;
select throws_ok($$ select public.request_title('This title is way too long') $$, 'P0001', 'INVALID_TITLE', 'title max 24 chars');
select throws_ok($$ select public.request_title('Mat ' || chr(128293)) $$, 'P0001', 'INVALID_TITLE', 'no emoji');
select throws_ok($$ select public.request_title('   ') $$, 'P0001', 'INVALID_TITLE', 'blank title');
select twc.put('t1', public.request_title('  The    Closer ')::text);
select is((select title from public.title_requests where id = twc.g('t1')), 'The Closer', 'title trimmed + spaces collapsed');
select is(public.my_balance(), 0, 'title request charged 500 up front');
select results_eq($$ select delta, reason, ref_id from public.points_ledger where user_id = auth.uid() and note = 'title_custom' $$,
                  format($$ values (-500, 'shop'::text, %L::uuid) $$, twc.g('t1')), 'charge linked to the request');
select throws_ok($$ select public.request_title('Another') $$, 'P0001', 'TITLE_PENDING', 'one pending request at a time');
select throws_ok($$ select public.buy_item('title_mat_rat') $$, 'P0001', 'INSUFFICIENT_POINTS', 'balance 0 buys nothing');
select is((select count(*)::int from public.title_requests), 1, 'member sees own request');
select throws_ok(format($$ select public.admin_approve_title(%L) $$, twc.g('t1')), '42501', 'NOT_ADMIN', 'members cannot approve titles');
reset role;
select twc.login('m2'); set local role authenticated;
select is((select count(*)::int from public.title_requests), 0, 'others cannot see the request');
reset role;

select twc.login('a1'); set local role authenticated;
select twc.put('ta', public.request_title('Boss Man')::text);
select throws_ok(format($$ select public.admin_approve_title(%L) $$, twc.g('ta')), 'P0001', 'OWN_REQUEST',
                 'admins cannot approve their own title');
select lives_ok(format($$ select public.admin_approve_title(%L) $$, twc.g('t1')), 'admin approves m1''s title');
select throws_ok(format($$ select public.admin_approve_title(%L) $$, twc.g('t1')), 'P0001', 'REQUEST_DECIDED', 'approve twice');
select throws_ok($$ select public.admin_approve_title(gen_random_uuid()) $$, 'P0001', 'REQUEST_NOT_FOUND', 'unknown request');
select ok((select count(*) from public.title_requests) >= 2, 'admins see all requests');
reset role;
select twc.login('a2'); set local role authenticated;
select lives_ok(format($$ select public.admin_approve_title(%L) $$, twc.g('ta')), 'another admin approves');
reset role;
select results_eq(format($$ select code, custom_value, equipped from public.user_items where user_id = %L and kind = 'title' $$, twc.uid('m1')),
                  $$ values ('title_custom'::text, 'The Closer'::text, true) $$, 'approved title granted and worn');
select is((select title from public.member_cosmetics where user_id = twc.uid('m1')), 'The Closer', 'cosmetics show the custom title');
select is((select count(*)::int from public.admin_log where action = 'title_approve' and target_id = twc.g('t1')), 1, 'approval logged');

select twc.login('m2'); set local role authenticated;
select twc.put('t2', public.request_title('Big Dog')::text);
select is(public.my_balance(), 500, 'm2 charged');
reset role;
select twc.login('a1'); set local role authenticated;
select throws_ok(format($$ select public.admin_reject_title(%L, %L) $$, twc.g('t2'), repeat('n', 201)), 'P0001',
                 'INVALID_REASON', 'reject reason max 200');
select lives_ok(format($$ select public.admin_reject_title(%L, 'Try again') $$, twc.g('t2')), 'admin rejects');
select throws_ok(format($$ select public.admin_reject_title(%L) $$, twc.g('t2')), 'P0001', 'REQUEST_DECIDED', 'reject twice');
reset role;
select is(twc.bal('m2'), 1000, 'rejected title refunded');
select results_eq(format($$ select delta, reason, ref_id from public.points_ledger where user_id = %L and reason = 'shop_refund' $$, twc.uid('m2')),
                  format($$ values (500, 'shop_refund'::text, %L::uuid) $$, twc.g('t2')), 'refund ledger row');
select results_eq(format($$ select status, decision_note from public.title_requests where id = %L $$, twc.g('t2')),
                  $$ values ('rejected'::text, 'Try again'::text) $$, 'rejected with note');
select is((select count(*)::int from public.user_items where user_id = twc.uid('m2')), 0, 'rejected title grants nothing');

select twc.login('a1'); set local role authenticated;
select public.admin_adjust_points(twc.uid('m1'), 300, 'shop test top up');
reset role;
select twc.login('m1'); set local role authenticated;
select public.buy_item('title_iron_grip');
select public.equip_item('title_iron_grip');
select results_eq($$ select code from public.user_items where user_id = auth.uid() and kind = 'title' and equipped $$,
                  $$ values ('title_iron_grip'::text) $$, 'equipping a preset title takes the custom one off');
select is((select title from public.member_cosmetics where user_id = auth.uid()), 'Iron Grip', 'preset title shown');
select public.equip_item('title_custom');
select is((select title from public.member_cosmetics where user_id = auth.uid()), 'The Closer', 'custom title re-equipped');
reset role;

-- ===========================================================================
-- 6. C7 Hall of Fame
-- ===========================================================================
-- HS: L, then 5 straight wins, 9 rounds each, one upset with a 900 Elo gap, 2 FOTN badges
insert into public.fights (id, title, red_fighter_id, blue_fighter_id, scheduled_at, lock_at, status, winner_side,
                           method, rounds, red_score, blue_score, settled_at, red_elo_before, blue_elo_before, elo_delta)
select md5('tw-hof:' || i)::uuid, 'TW HOF ' || i, twc.f('HS'), twc.f(case when i % 2 = 0 then 'HO1' else 'HO2' end),
       twc.ts(10 + i, '20:00'), twc.ts(10 + i, '19:45'), 'settled', case when i = 0 then 'blue' else 'red' end,
       'pin', 9, case when i = 0 then 0 else 2 end, case when i = 0 then 2 else 0 end,
       now() - make_interval(days => 400 - i), case when i = 3 then 800 else 1000 end,
       case when i = 3 then 1700 else 1000 end, 0
  from generate_series(0, 5) i;
update public.fighters set wins = 5000, losses = 1 where id = twc.f('HS');
insert into public.fighter_badges (fighter_id, code, fight_id, awarded_at)
values (twc.f('HS'), 'fight_of_the_night', md5('tw-hof:1')::uuid, now()),
       (twc.f('HS'), 'fight_of_the_night', md5('tw-hof:2')::uuid, now());
insert into public.seasons (name, started_at, ended_at, champion_fighter_id, top_bettor_user_id, snapshot)
values ('TW Old Season', now() - interval '900 days', now() - interval '899 days', twc.f('HO1'), twc.uid('m4'),
        '{"champion": {"source": "elo"}, "top_bettor": {"balance": 4321}}');
select twc.login('a1'); set local role authenticated;
select public.admin_adjust_points(twc.uid('m4'), 900000, 'hall of fame peak');
select public.admin_adjust_points(twc.uid('m4'), -800000, 'hall of fame back down');
reset role;

select twc.login('m1'); set local role authenticated;
select set_eq($$ select jsonb_object_keys(public.hall_of_fame()) $$,
              array['generated_at','champions','season_champions','records'], 'hall_of_fame top-level keys');
select set_eq($$ select jsonb_object_keys(public.hall_of_fame() -> 'records') $$,
              array['longest_win_streak','most_wins','most_rounds','most_fotn','biggest_upset','top_bettor_peak'],
              'hall_of_fame record keys');
select is(public.hall_of_fame() -> 'records' -> 'longest_win_streak' -> 0,
          jsonb_build_object('rank', 1, 'fighter_id', twc.f('HS'), 'nickname', 'TW HS', 'value', 5), 'longest win streak = 5');
select is(public.hall_of_fame() -> 'records' -> 'most_wins' -> 0 ->> 'value', '5000', 'most wins');
select is(public.hall_of_fame() -> 'records' -> 'most_rounds' -> 0 ->> 'nickname', 'TW HS', 'most rounds holder');
select ok((public.hall_of_fame() -> 'records' -> 'most_rounds' -> 0 ->> 'value')::int >= 54, 'most rounds >= 6 x 9');
select is(public.hall_of_fame() -> 'records' -> 'most_fotn' -> 0,
          jsonb_build_object('rank', 1, 'fighter_id', twc.f('HS'), 'nickname', 'TW HS', 'value', 2), 'most FOTN');
select results_eq($$ select (x ->> 'value')::int, x ->> 'winner_nickname', x ->> 'loser_nickname', (x ->> 'winner_elo_before')::int
                       from (select public.hall_of_fame() -> 'records' -> 'biggest_upset' -> 0 as x) s $$,
                  $$ values (900, 'TW HS'::text, 'TW HO2'::text, 800) $$, 'biggest upset (900 Elo gap)');
select results_eq($$ select x ->> 'user_id', (x ->> 'value')::int
                       from (select public.hall_of_fame() -> 'records' -> 'top_bettor_peak' -> 0 as x) s $$,
                  format($$ values (%L::text, 901000) $$, twc.uid('m4')), 'top bettor peak balance (not current)');
select ok(jsonb_array_length(public.hall_of_fame() -> 'records' -> 'most_wins') <= 3, 'records are top 3');
select is(public.hall_of_fame() -> 'season_champions' -> 0 ->> 'name', 'TW Old Season', 'season champions listed');
select is(public.hall_of_fame() -> 'season_champions' -> 0 ->> 'champion_nickname', 'TW HO1', 'season champion nickname');
select is(public.hall_of_fame() -> 'season_champions' -> 0 ->> 'top_bettor_balance', '4321', 'season top bettor balance');
select is(jsonb_array_length(public.hall_of_fame() -> 'champions'),
          (select count(*)::int from public.belt_reign_history), 'champions = every visible reign');
reset role;
update public.fighters set hidden = true where id = twc.f('HS');
select twc.login('m1'); set local role authenticated;
select is_empty($$ select 1 from jsonb_each(public.hall_of_fame() -> 'records') r, jsonb_array_elements(r.value) e
                    where e ->> 'fighter_id' = md5('tw-fighter:HS')::uuid::text
                       or e ->> 'winner_fighter_id' = md5('tw-fighter:HS')::uuid::text $$,
                'hidden fighters are left out for members');
reset role;
select twc.login('a1'); set local role authenticated;
select is(public.hall_of_fame() -> 'records' -> 'most_wins' -> 0 ->> 'nickname', 'TW HS', 'admins still see hidden fighters');
reset role;
update public.fighters set hidden = false where id = twc.f('HS');

-- ===========================================================================
-- 7. C1 lockdown (last: every fixture row above exists now)
-- ===========================================================================
-- m1 also holds a vote + an active pick + a reaction on an open fight
select twc.login('a1'); set local role authenticated;
select public.admin_adjust_points(twc.uid('m1'), 500, 'lockdown fixture');
select twc.put('of', twc.fight('O1', 'O2', 30, '20:00')::text);
reset role;
select twc.login('m1'); set local role authenticated;
select public.cast_vote(twc.g('of'), 'red');
select public.place_bet(twc.g('of'), 'red', 20);
select public.toggle_reaction(twc.g('of'), '🔥');
select is_empty($$ select rel from twc.visible_rows()
                    where rel in ('fights','fighters','votes','bets','points_ledger','profiles','user_items','title_requests',
                                  'fotn_votes','fotn_results','callouts','shop_items','badge_catalog','reactions',
                                  'callout_board','member_cosmetics','admin_log','balances','fighter_rankings')
                      and n = 0 $$,
                'before lockdown m1 sees rows in every member table/view');
select is((select count(*)::int from public.site_settings), 1, 'members read site_settings');
reset role;

select twc.login('m1'); set local role authenticated;
select throws_ok($$ select public.admin_set_lockdown(true, 'x') $$, '42501', 'NOT_ADMIN', 'members cannot lock down');
reset role;
select twc.login('ref'); set local role authenticated;
select throws_ok($$ select public.admin_set_lockdown(true, 'x') $$, '42501', 'NOT_ADMIN', 'referees cannot lock down');
reset role;
select twc.login('a1'); set local role authenticated;
select throws_ok($$ select public.admin_set_lockdown(null, 'x') $$, 'P0001', 'INVALID_VALUE', 'on/off required');
select throws_ok(format($$ select public.admin_set_lockdown(true, %L) $$, repeat('m', 201)), 'P0001', 'INVALID_MESSAGE',
                 'lockdown message max 200');
select results_eq($$ select (r ->> 'lockdown')::boolean, r ->> 'message'
                       from (select public.admin_set_lockdown(true, '  Back soon  ') as r) s $$,
                  $$ values (true, 'Back soon'::text) $$, 'admin turns lockdown on');
reset role;
update public.profiles set active = false where id = twc.uid('m6');
select results_eq(format($$ select actor, details ->> 'on', details ->> 'message' from public.admin_log
                           where action = 'site_lockdown' and actor = %L $$, twc.uid('a1')),
                  format($$ values (%L::uuid, 'true'::text, 'Back soon'::text) $$, twc.uid('a1')), 'lockdown logged');
select results_eq($$ select lockdown, lockdown_message, updated_by from public.site_settings $$,
                  format($$ values (true, 'Back soon'::text, %L::uuid) $$, twc.uid('a1')), 'site_settings updated');

set local role anon;
select is(public.public_site_status(), '{"lockdown": true, "message": "Back soon"}'::jsonb, 'anon: lockdown + message');
select is_empty($$ select * from public.public_next_fight() $$, 'anon: public_next_fight returns nothing');
reset role;

select twc.login('m1'); set local role authenticated;
select ok(not public.is_member(), 'lockdown: member is not a member');
select ok(public.is_locked_out(), 'lockdown: is_locked_out() true');
select is(public.public_site_status() ->> 'lockdown', 'true', 'member: public_site_status works');
select is_empty($$ select * from public.public_next_fight() $$, 'member: public_next_fight returns nothing');
select is_empty($$ select rel, n from twc.visible_rows() where n > 0 and rel <> 'site_settings' $$,
                'lockdown: a member reads nothing in any table/view (not even their own profile; only site_settings)');
select ok(not public.is_admin(), 'lockdown: is_admin() still answers (false)');
select is((select lockdown from public.site_settings), true, 'members can still read the lockdown flag');
select is_empty($$ select * from public.get_all_fight_vote_totals() $$, 'lockdown: vote totals empty');
select is_empty($$ select * from public.get_leaderboard_bettors() $$, 'lockdown: leaderboard empty');
select throws_ok(s, '42501', 'SITE_LOCKED', 'lockdown: ' || s)
  from unnest(array[
    'select public.my_balance()',
    format('select public.cast_vote(%L, ''blue'')', twc.g('of')),
    format('select public.place_bet(%L, ''red'', 10)', twc.g('of')),
    format('select public.cancel_bet(%L)', (select id from public.bets where user_id = twc.uid('m1') and status = 'active')),
    format('select public.toggle_reaction(%L, ''💀'')', twc.g('of')),
    format('select * from public.get_fight_vote_totals(%L)', twc.g('of')),
    format('select * from public.get_live_score(%L)', twc.g('rl')),
    format('select * from public.list_badges(''fighter'', %L)', twc.f('HS')),
    format('select public.accept_fight(%L)', twc.g('bf')),
    format('select public.decline_fight(%L)', twc.g('bf')),
    format('select public.get_fotn(%L)', twc.d(1)),
    format('select public.cast_fotn_vote(%L)', twc.g('a1f')),
    format('select public.get_card_recap(%L)', twc.d(1)),
    'select public.hall_of_fame()',
    'select public.buy_item(''frame_crown'')',
    'select public.equip_item(''color_gold'')',
    'select public.unequip_item(''frame'')',
    'select public.request_title(''Locked'')',
    format('select public.create_callout(%L, ''x'')', twc.f('F4')),
    format('select public.accept_callout(%L)', twc.g('crm')),
    format('select public.decline_callout(%L)', twc.g('crm')),
    format('select public.withdraw_callout(%L)', twc.g('crm'))]) s;
reset role;
select twc.login('ref'); set local role authenticated;
select ok(not public.is_referee(), 'lockdown: referee is not a referee');
select throws_ok(format($$ select public.admin_live_update(%L, 'pause') $$, twc.g('rl')), '42501', 'NOT_REFEREE',
                 'lockdown: referee cannot score');
select is_empty($$ select rel, n from twc.visible_rows() where n > 0 and rel <> 'site_settings' $$, 'lockdown: referee reads nothing either');
reset role;
select twc.login('m6'); set local role authenticated;
select throws_ok($$ select public.my_balance() $$, '42501', 'NOT_MEMBER', 'lockdown: deactivated users still get NOT_MEMBER');
reset role;
select twc.login('a1'); set local role authenticated;
select ok(public.is_member() and not public.is_locked_out(), 'lockdown: admins unaffected');
select ok((select count(*) from public.fights) > 0 and (select count(*) from public.profiles) > 1
          and (select count(*) from public.points_ledger) > 0, 'lockdown: admin reads league data');
select ok(public.my_balance() is not null, 'lockdown: admin RPCs work');
select ok(public.hall_of_fame() ? 'records', 'lockdown: admin member RPCs work');
select is_empty($$ select * from public.public_next_fight() $$, 'lockdown: public_next_fight empty for admins too');
select results_eq($$ select (r ->> 'lockdown')::boolean, r -> 'message'
                       from (select public.admin_set_lockdown(false, 'ignored') as r) s $$,
                  $$ values (false, 'null'::jsonb) $$, 'lockdown off clears the message');
reset role;
set local role anon;
select is(public.public_site_status(), '{"lockdown": false, "message": null}'::jsonb, 'anon: back to normal');
reset role;
select twc.login('m1'); set local role authenticated;
select ok(public.is_member() and not public.is_locked_out(), 'after lockdown: member again');
select is((select count(*)::int from public.votes), 1, 'after lockdown: own vote visible again');
select ok(public.my_balance() is not null, 'after lockdown: RPCs work again');
reset role;
select twc.login('ref'); set local role authenticated;
select ok(public.is_referee(), 'after lockdown: referee again');
reset role;

select * from finish();
rollback;
