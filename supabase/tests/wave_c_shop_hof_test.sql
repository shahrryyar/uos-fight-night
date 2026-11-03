-- pgTAP (shop-hof fixes). One transaction, rolled back. Uses the seeded member2 title request
-- ('Couch Commando', 500 pts) and the seeded admin.
--  1. Season reset then reject: the reset already absorbed the debit, so no refund (no new points).
--     Fix lives in 20261103000014_wave_c_fixes.sql (admin_reject_title); this guards it.
--  2. The name colour item formerly labelled 'Gold' is 'Copper' (20261103000041_shop_copper_label.sql).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

create schema tsh;
create or replace function tsh.bal(p uuid) returns int language sql as $$
  select coalesce(sum(delta), 0)::int from public.points_ledger where user_id = p;
$$;
create or replace function tsh.login(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- member2 = 5eed...0003, admin = first active admin
select set_config('tsh.m2', '5eed0000-0000-4000-8000-000000000003', true);
select set_config('tsh.admin', (select id::text from public.profiles where role = 'admin' and active order by created_at limit 1), true);
select set_config('tsh.req', (select id::text from public.title_requests
                               where user_id = current_setting('tsh.m2')::uuid and status = 'pending'), true);

select isnt(nullif(current_setting('tsh.req'), ''), null, 'seed: member2 has a pending title request');
select is(tsh.bal(current_setting('tsh.m2')::uuid), 500, 'seed: member2 is on 500 after the 500 pt request');

-- nothing may block the season end in this rolled-back run
update public.fights set status = 'cancelled', cancel_kind = 'cancelled', settled_at = coalesce(settled_at, now()) where status in ('open', 'locked');

select tsh.login(current_setting('tsh.admin')::uuid);
select lives_ok($$ select public.admin_end_season('END SEASON', 'TSH Season') $$, 'admin ends the season');
select is(tsh.bal(current_setting('tsh.m2')::uuid), 1000, 'season reset puts member2 on 1000');

select lives_ok(format($$ select public.admin_reject_title(%L::uuid, 'not this one') $$, current_setting('tsh.req')),
                'admin turns down the old-season request');
select is(tsh.bal(current_setting('tsh.m2')::uuid), 1000, 'member2 still on 1000: no refund on top of the reset');
select is((select count(*)::int from public.points_ledger
            where ref_id = current_setting('tsh.req')::uuid and reason = 'shop_refund'), 0,
          'no shop_refund ledger row for an old-season request');

select results_eq($$ select label, value from public.shop_items where code = 'color_gold' $$,
                  $$ values ('Copper'::text, 'gold'::text) $$, 'name colour reads Copper, value key unchanged');

select * from finish();
rollback;
