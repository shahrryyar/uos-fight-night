-- pgTAP: C5 callouts fixes (20261103000033_callouts_fixes.sql).
--   1. moderated text (callout_delete message, title_reject title) never reaches admin_log
--   2. CALLOUT_COOLDOWN / CALLOUT_DAILY_LIMIT spam limits
--   3. invisible / bidi-control characters refused
--   4. callout_board exposes the booked fight's state
-- One transaction, rolled back. Own fixtures (usernames tcf_*, nicknames "TCF *").
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();
create schema tcf;

create or replace function tcf.uid(p text) returns uuid language sql immutable as $$
  select md5('tcf-user:' || p)::uuid;
$$;
create or replace function tcf.f(p text) returns uuid language sql immutable as $$
  select md5('tcf-fighter:' || p)::uuid;
$$;
create or replace function tcf.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', tcf.uid(p), 'role', 'authenticated')::text, true);
$$;
create or replace function tcf.mk_user(p text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', tcf.uid(p), 'authenticated', 'authenticated',
          'tcf_' || p || '@members.uosfight.local', '',
          jsonb_build_object('username', 'tcf_' || p, 'display_name', 'TCF ' || p),
          '{"provider":"email","providers":["email"]}', now(), now());
$$;
create or replace function tcf.put(k text, v text) returns text language sql as $$
  select set_config('tcf.' || k, v, true);
$$;
create or replace function tcf.g(k text) returns uuid language sql as $$
  select current_setting('tcf.' || k)::uuid;
$$;
-- withdraw as the current user (helper keeps the test lines short)
create or replace function tcf.wd(k text) returns void language sql as $$
  select public.withdraw_callout(tcf.g(k));
$$;
grant usage on schema tcf to authenticated, anon;
grant execute on all functions in schema tcf to authenticated, anon;

-- a1 admin; m1..m7 linked to F1..F7; F8 has no account
select tcf.mk_user(u) from unnest(array['a1','m1','m2','m3','m4','m5','m6','m7']) u;
update public.profiles set role = 'admin' where id = tcf.uid('a1');
insert into public.fighters (id, nickname, weight_kg)
select tcf.f(n), 'TCF ' || n, 70 from unnest(array['F1','F2','F3','F4','F5','F6','F7','F8']) n;
update public.profiles p set fighter_id = tcf.f('F' || substr(u, 2))
  from unnest(array['m1','m2','m3','m4','m5','m6','m7']) u where p.id = tcf.uid(u);

-- ===========================================================================
-- 1. admin_log redaction
-- ===========================================================================
select has_trigger('public', 'admin_log', 'admin_log_redact', 'admin_log has the redaction trigger');

select tcf.login('m1'); set local role authenticated;
select tcf.put('abuse', public.create_callout(tcf.f('F2'), 'ABUSIVE TEXT HERE')::text);
reset role;
select tcf.login('a1'); set local role authenticated;
select lives_ok(format($$ select public.admin_delete_callout(%L, 'abuse') $$, tcf.g('abuse')), 'admin deletes the callout');
reset role;
select tcf.login('m2'); set local role authenticated;
select is((select count(*)::int from public.callouts where id = tcf.g('abuse')), 0, 'deleted callout gone for members');
select is((select count(*)::int from public.admin_log where action = 'callout_delete' and target_id = tcf.g('abuse')), 1,
          'members still see that a delete happened');
select ok(not (select details ? 'message' from public.admin_log where action = 'callout_delete' and target_id = tcf.g('abuse')),
          'callout_delete log has no message key');
select is((select details ->> 'message_len' from public.admin_log where action = 'callout_delete' and target_id = tcf.g('abuse')),
          '17', 'callout_delete log keeps the length only');
select is((select details ->> 'reason' from public.admin_log where action = 'callout_delete' and target_id = tcf.g('abuse')),
          'abuse', 'admin reason kept');
select is((select count(*)::int from public.admin_log where details::text like '%ABUSIVE TEXT%'), 0,
          'the deleted text appears nowhere in admin_log');
reset role;

-- any writer (older function bodies, future code) is redacted by the trigger, on insert and update
select private.log(tcf.uid('a1'), 'callout_delete', tcf.f('F1'), '{"message":"raw insert","status":"pending"}');
select is((select details from public.admin_log where action = 'callout_delete' and target_id = tcf.f('F1')),
          '{"status":"pending","message_len":10}'::jsonb, 'trigger strips message on insert');
update public.admin_log set details = details || '{"message":"sneaky"}' where action = 'callout_delete' and target_id = tcf.f('F1');
select ok(not (select details ? 'message' from public.admin_log where action = 'callout_delete' and target_id = tcf.f('F1')),
          'trigger strips message on update');
select private.log(tcf.uid('a1'), 'title_reject', tcf.f('F2'), '{"title":"Rude Words","refund":500}');
select is((select details from public.admin_log where action = 'title_reject' and target_id = tcf.f('F2')),
          '{"refund":500,"title_len":10}'::jsonb, 'trigger strips title from title_reject');
select private.log(tcf.uid('a1'), 'callout_reject', tcf.f('F3'), '{"reason":"Not this week","message":"kept"}');
select is((select details ->> 'message' from public.admin_log where action = 'callout_reject' and target_id = tcf.f('F3')),
          'kept', 'other actions untouched');
select is(private.redact_admin_log_details('callout_delete', null), null, 'null details pass through');

-- title_reject through the real RPC
select tcf.login('m3'); set local role authenticated;
select tcf.put('tr', public.request_title('Rude Words')::text);
reset role;
select tcf.login('a1'); set local role authenticated;
select lives_ok(format($$ select public.admin_reject_title(%L, 'no') $$, tcf.g('tr')), 'admin rejects the title');
reset role;
select tcf.login('m2'); set local role authenticated;
select is((select count(*)::int from public.admin_log where action = 'title_reject' and target_id = tcf.g('tr')), 1,
          'title_reject visible as an event');
select ok(not (select details ? 'title' from public.admin_log where action = 'title_reject' and target_id = tcf.g('tr')),
          'title_reject log has no title text');
select is((select count(*)::int from public.admin_log where details::text like '%Rude Words%'), 0,
          'the rejected title appears nowhere in admin_log');
reset role;

-- ===========================================================================
-- 2. cooldowns and daily limit
-- ===========================================================================
select has_table('private', 'callout_attempts', 'attempts ledger exists');
select tcf.login('m1'); set local role authenticated;
select throws_ok($$ select count(*) from private.callout_attempts $$, '42501', null, 'members cannot read the attempts ledger');
select tcf.put('c13', public.create_callout(tcf.f('F3'), 'You and me')::text);
reset role;
select tcf.login('m3'); set local role authenticated;
select public.decline_callout(tcf.g('c13'));
reset role;
select tcf.login('m1'); set local role authenticated;
select throws_ok(format($$ select public.create_callout(%L, 'Again') $$, tcf.f('F3')), 'P0001', 'CALLOUT_COOLDOWN',
                 'no new callout to a target who declined in the last 7 days');
reset role;
select tcf.login('m3'); set local role authenticated;
select lives_ok(format($$ select public.create_callout(%L, 'My turn') $$, tcf.f('F1')),
                'the target may still call the challenger out');
reset role;
update public.callouts set responded_at = now() - interval '8 days' where id = tcf.g('c13');
-- clear the reverse callout so only the cooldown rules are in play
delete from public.callouts where challenger_fighter_id = tcf.f('F3') and target_fighter_id = tcf.f('F1');
select tcf.login('m1'); set local role authenticated;
select tcf.put('c13b', public.create_callout(tcf.f('F3'), 'Round two')::text);
select ok(tcf.g('c13b') is not null, 'decline cooldown ends after 7 days');
select tcf.wd('c13b');
select throws_ok(format($$ select public.create_callout(%L, 'Round three') $$, tcf.f('F3')), 'P0001', 'CALLOUT_COOLDOWN',
                 'withdraw + resend loop: max 2 callouts to one target per 24h');
reset role;

-- admin rejection starts the same cooldown
select tcf.login('m4'); set local role authenticated;
select tcf.put('c45', public.create_callout(tcf.f('F5'), null)::text);
reset role;
select tcf.login('a1'); set local role authenticated;
select public.admin_reject_callout(tcf.g('c45'), 'Not now');
reset role;
select tcf.login('m4'); set local role authenticated;
select throws_ok(format($$ select public.create_callout(%L, 'Please') $$, tcf.f('F5')), 'P0001', 'CALLOUT_COOLDOWN',
                 'no new callout for 7 days after an admin rejection');
reset role;

-- daily limit: 5 per challenger per 24h, any status (withdrawn ones count)
select tcf.login('m6'); set local role authenticated;
do $$ begin
  for n in 1..5 loop
    perform public.withdraw_callout(public.create_callout(tcf.f('F' || n), 'Daily ' || n));
  end loop;
end $$;
select is((select count(*)::int from public.callouts where challenger_fighter_id = tcf.f('F6')), 0, 'all 5 withdrawn');
select throws_ok(format($$ select public.create_callout(%L, 'Sixth') $$, tcf.f('F7')), 'P0001', 'CALLOUT_DAILY_LIMIT',
                 'sixth callout in 24h refused');
reset role;
update private.callout_attempts set created_at = created_at - interval '25 hours'
 where challenger_fighter_id = tcf.f('F6');
select tcf.login('m6'); set local role authenticated;
select lives_ok(format($$ select public.create_callout(%L, 'Next day') $$, tcf.f('F7')), 'limit resets after 24h');
reset role;
select is((select count(*)::int from private.callout_attempts where challenger_fighter_id = tcf.f('F6')), 6,
          'every successful create is recorded');

-- ===========================================================================
-- 3. hidden characters
-- ===========================================================================
select tcf.login('m7'); set local role authenticated;
select throws_ok(format($$ select public.create_callout(%L, %L) $$, tcf.f('F8'), m), 'P0001', 'INVALID_MESSAGE', 'refused: ' || label)
  from (values (E'‮gnp.exe', 'right-to-left override'),
               (E'​​​', 'zero-width spaces only'),
               (E'hi​there', 'zero-width space inside'),
               (E'a‏b', 'right-to-left mark'),
               (E'⁦x⁩', 'isolates'),
               (E'﻿hey', 'byte order mark'),
               (E'x\U000E0041', 'tag character'),
               (E'ㅤ', 'Hangul filler'),
               (E'line two', 'line separator')) v(m, label);
select tcf.put('emoji', public.create_callout(tcf.f('F8'), E'\U0001F44A️ come get it \U0001F468‍\U0001F469')::text);
select is((select message from public.callouts where id = tcf.g('emoji')),
          E'\U0001F44A️ come get it \U0001F468‍\U0001F469', 'emoji with ZWJ / variation selector allowed');
select tcf.wd('emoji');
select tcf.put('blank', public.create_callout(tcf.f('F1'), E' ‍　')::text);
select is((select message from public.callouts where id = tcf.g('blank')), null, 'blank-looking message stored as null');
reset role;
select tcf.login('a1'); set local role authenticated;
select throws_ok(format($$ select public.admin_reject_callout(%L, %L) $$, tcf.g('blank'), E'‮no'), 'P0001', 'INVALID_REASON',
                 'reject reason with bidi override refused');
select throws_ok(format($$ select public.admin_delete_callout(%L, %L) $$, tcf.g('blank'), E'x​'), 'P0001', 'INVALID_REASON',
                 'delete reason with zero-width space refused');
select throws_ok(format($$ select public.admin_reject_callout(%L, %L) $$, tcf.g('blank'), E'a\nb'), 'P0001', 'INVALID_REASON',
                 'reject reason with a line break refused');
reset role;

-- ===========================================================================
-- 4. callout_board: booked fight state
-- ===========================================================================
select has_column('public', 'callout_board', c, 'callout_board.' || c)
  from unnest(array['fight_status', 'fight_cancel_kind', 'fight_scheduled_at']) c;
select tcf.login('m2'); set local role authenticated;
select tcf.put('c28', public.create_callout(tcf.f('F8'), 'Booked one')::text);   -- F8 has no account: bookable
reset role;
select tcf.login('a1'); set local role authenticated;
select tcf.put('bf', public.admin_book_callout(tcf.g('c28'), now() + interval '400 days',
                                               now() + interval '400 days' - interval '15 minutes')::text);
reset role;
select tcf.login('m1'); set local role authenticated;
select results_eq(format($$ select status, fight_id, fight_status, fight_cancel_kind from public.callout_board where id = %L $$, tcf.g('c28')),
                  format($$ values ('booked'::text, %L::uuid, 'scheduled'::text, null::text) $$, tcf.g('bf')),
                  'board shows the booked fight as scheduled');
select is((select fight_scheduled_at from public.callout_board where id = tcf.g('c28')),
          (select scheduled_at from public.fights where id = tcf.g('bf')), 'board shows the fight time');
reset role;
select tcf.login('m2'); set local role authenticated;
select lives_ok(format($$ select public.decline_fight(%L) $$, tcf.g('bf')), 'challenger declines the booked fight');
reset role;
select tcf.login('m1'); set local role authenticated;
select results_eq(format($$ select status, fight_status, fight_cancel_kind from public.callout_board where id = %L $$, tcf.g('c28')),
                  $$ values ('booked'::text, 'cancelled'::text, 'declined'::text) $$,
                  'board shows a booked callout whose fight was called off');
select is((select count(*)::int from public.callout_board where fight_id is null and fight_status is not null), 0,
          'unbooked rows have no fight state');
reset role;
select tcf.login('m1'); set local role anon;
select throws_ok($$ select * from public.callout_board $$, '42501', null, 'anon cannot read the board');
reset role;

select * from finish();
rollback;
