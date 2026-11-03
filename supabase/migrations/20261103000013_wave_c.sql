-- UoS Fight Night — WAVE C (CONTRACT.md ADDENDUM C, Wave C: C1-C7; C0 shipped in wave A).
--   C1 lockdown (site_settings, public_site_status, is_member/require_member honour it)
--   C2 referee role (profiles.role 'referee', is_referee, admin_set_member)
--   C3 card recap data (get_card_recap)
--   C4 Fight of the Night (fotn_votes, fotn_results, cast_fotn_vote, get_fotn, cron finalize)
--   C5 callouts / rematches (callouts, callout_board, fighter + admin RPCs)
--   C6 points shop (shop_items, user_items, title_requests, member_cosmetics, buy/equip/request)
--   C7 hall_of_fame()
-- Rules as before: every function security definer + search_path = '', errors are the exception
-- message, clients only SELECT (RLS) and call RPCs. anon: public_next_fight + public_site_status.
-- Frontend reference: scratchpad wavec/API.md, mirrored in supabase/README.md.

-- ===========================================================================
-- 0. Check constraints: role 'referee', ledger reasons 'shop' / 'shop_refund'
-- ===========================================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('member', 'admin', 'referee'));

alter table public.points_ledger drop constraint if exists points_ledger_reason_check;
alter table public.points_ledger add constraint points_ledger_reason_check
  check (reason in ('signup', 'weekly', 'topup', 'bet', 'bet_cancel', 'payout', 'refund', 'admin_adjust',
                    'payout_reversal', 'season_reset', 'shop', 'shop_refund'));

-- ===========================================================================
-- C1. Lockdown
-- ===========================================================================
create table public.site_settings (
  id               int primary key default 1 check (id = 1),
  lockdown         boolean not null default false,
  lockdown_message text null check (lockdown_message is null or char_length(lockdown_message) <= 200),
  updated_at       timestamptz not null default now(),
  updated_by       uuid null references public.profiles (id) on delete set null
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

create or replace function private.lockdown_on()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.lockdown from public.site_settings s where s.id = 1), false);
$$;

-- Members during lockdown: only admins count as members (all RLS + RPCs deny everyone else).
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.active
       and (p.role = 'admin' or not private.lockdown_on())
  );
$$;

-- true = lockdown is on and the caller is not an active admin (used by own-row policies).
create or replace function public.is_locked_out()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.lockdown_on() and not public.is_admin();
$$;

create or replace function private.require_member()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_active boolean;
begin
  if v_uid is not null then
    select p.role, p.active into v_role, v_active from public.profiles p where p.id = v_uid;
  end if;
  if v_uid is null or not coalesce(v_active, false) then
    raise exception 'NOT_MEMBER' using errcode = '42501';
  end if;
  if v_role <> 'admin' and private.lockdown_on() then
    raise exception 'SITE_LOCKED' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- C2: referees (non-admins) are locked out like every other non-admin.
create or replace function public.is_referee()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.active
       and (p.role = 'admin' or (p.role = 'referee' and not private.lockdown_on()))
  );
$$;

create or replace function public.public_site_status()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'lockdown', coalesce(s.lockdown, false),
    'message',  case when s.lockdown then s.lockdown_message end)
    from (select 1) x
    left join public.site_settings s on s.id = 1;
$$;

create or replace function public.admin_set_lockdown(p_on boolean, p_message text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := private.require_admin();
  v_msg  text := nullif(btrim(coalesce(p_message, '')), '');
  v_prev public.site_settings%rowtype;
  v_new  public.site_settings%rowtype;
begin
  if p_on is null then raise exception 'INVALID_VALUE'; end if;
  if v_msg is not null and char_length(v_msg) > 200 then raise exception 'INVALID_MESSAGE'; end if;
  if not p_on then v_msg := null; end if;

  insert into public.site_settings (id) values (1) on conflict (id) do nothing;
  select * into v_prev from public.site_settings where id = 1 for update;
  update public.site_settings
     set lockdown = p_on, lockdown_message = v_msg, updated_at = now(), updated_by = v_uid
   where id = 1
  returning * into v_new;

  perform private.log(v_uid, 'site_lockdown', null, jsonb_build_object(
    'on', p_on, 'message', v_msg, 'prev', jsonb_build_object('on', v_prev.lockdown, 'message', v_prev.lockdown_message)));
  return jsonb_build_object('lockdown', v_new.lockdown, 'message', v_new.lockdown_message,
                            'updated_at', v_new.updated_at);
end;
$$;

-- Landing data: nothing at all while locked down.
create or replace function public.public_next_fight()
returns table (id uuid, title text, lock_at timestamptz, scheduled_at timestamptz, status text,
               red_nickname text, blue_nickname text, red_weight_kg numeric, blue_weight_kg numeric,
               is_main_event boolean, is_title_fight boolean, champion_side text, champion_nickname text)
language sql stable security definer set search_path = ''
as $$
  select f.id, f.title, f.lock_at, f.scheduled_at, f.status, r.nickname, b.nickname,
         coalesce(f.red_weight_kg, r.weight_kg), coalesce(f.blue_weight_kg, b.weight_kg),
         f.is_main_event, f.is_title_fight,
         case c.fighter_id when f.red_fighter_id then 'red' when f.blue_fighter_id then 'blue' end,
         cf.nickname
    from public.fights f
    join public.fighters r on r.id = f.red_fighter_id
    join public.fighters b on b.id = f.blue_fighter_id
    left join public.belt_reigns c on c.ended_at is null
    left join public.fighters cf on cf.id = c.fighter_id and not cf.hidden
   where f.status in ('open', 'locked')
     and not private.lockdown_on()
     and f.card_date = (select min(x.card_date) from public.fights x where x.status in ('open', 'locked'))
   order by f.is_main_event desc, f.scheduled_at asc, f.bout_order asc, f.created_at asc
   limit 1;
$$;

-- Own-row policies did not go through is_member(): make them honour lockdown too
-- (deactivated users keep reading their own history, as before).
drop policy if exists votes_select_own on public.votes;
create policy votes_select_own on public.votes for select to authenticated
  using (user_id = (select auth.uid()) and not (select public.is_locked_out()));

drop policy if exists ledger_select on public.points_ledger;
create policy ledger_select on public.points_ledger for select to authenticated
  using ((user_id = (select auth.uid()) and not (select public.is_locked_out())) or (select public.is_admin()));

drop policy if exists bets_select on public.bets;
create policy bets_select on public.bets for select to authenticated
  using (
    (user_id = (select auth.uid()) and not (select public.is_locked_out()))
    or (
      (select public.is_member())
      and exists (
        select 1 from public.fights f
        where f.id = bets.fight_id and f.status in ('locked', 'settled', 'cancelled')
      )
    )
  );
-- Own profile row: still readable when deactivated (as before), but not while locked out.
-- The app learns about lockdown from public_site_status() / site_settings, and is_admin() works.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using ((id = (select auth.uid()) and not (select public.is_locked_out())) or (select public.is_member()));

-- ===========================================================================
-- C2. Referee role: admin_set_member accepts 'referee'
-- ===========================================================================
create or replace function public.admin_set_member(p_user_id uuid, p_active boolean, p_role text,
                                                   p_fighter_id uuid, p_display_name text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := private.require_admin();
  v_p          public.profiles%rowtype;
  v_new_role   text;
  v_new_active boolean;
  v_display    text := btrim(p_display_name);
begin
  if p_role is not null and p_role not in ('member', 'admin', 'referee') then
    raise exception 'INVALID_ROLE';
  end if;
  if p_display_name is not null and char_length(v_display) not between 1 and 24 then
    raise exception 'INVALID_DISPLAY_NAME';
  end if;

  -- serialise admin-set changes so two admins can't demote each other at once
  perform 1 from public.profiles where role = 'admin' for update;
  select * into v_p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;

  v_new_role   := coalesce(p_role, v_p.role);
  v_new_active := coalesce(p_active, v_p.active);

  if v_p.role = 'admin' and v_p.active and (v_new_role <> 'admin' or not v_new_active)
     and not exists (
       select 1 from public.profiles o
        where o.role = 'admin' and o.active and o.id <> p_user_id
     ) then
    raise exception 'LAST_ADMIN';
  end if;

  if p_fighter_id is not null and not exists (select 1 from public.fighters where id = p_fighter_id) then
    raise exception 'FIGHTER_NOT_FOUND';
  end if;

  -- An admin may not move their OWN fighter link while the old or new fighter
  -- has a live fight (scheduled/open/locked): that would dodge PARTICIPANT.
  if p_user_id = v_uid and p_fighter_id is distinct from v_p.fighter_id and exists (
    select 1 from public.fights f
     where f.status in ('scheduled', 'open', 'locked')
       and (f.red_fighter_id  in (v_p.fighter_id, p_fighter_id)
         or f.blue_fighter_id in (v_p.fighter_id, p_fighter_id))
  ) then
    raise exception 'PARTICIPANT';
  end if;

  begin
    update public.profiles
       set role = v_new_role, active = v_new_active, fighter_id = p_fighter_id,
           display_name = coalesce(v_display, display_name)
     where id = p_user_id;
  exception when unique_violation then
    raise exception 'FIGHTER_ALREADY_LINKED';
  end;

  perform private.log(v_uid, 'member_update', p_user_id, jsonb_build_object(
    'active', v_new_active, 'role', v_new_role, 'fighter_id', p_fighter_id,
    'display_name', coalesce(v_display, v_p.display_name),
    'prev', jsonb_build_object('active', v_p.active, 'role', v_p.role, 'fighter_id', v_p.fighter_id,
                               'display_name', v_p.display_name)));
end;
$$;

-- ===========================================================================
-- C4. Fight of the Night
-- ===========================================================================
insert into public.badge_catalog (code, kind, label, description, icon, sort)
values ('fight_of_the_night', 'fighter', 'Fight of the Night', 'Fans voted their bout Fight of the Night', 'Star', 80)
on conflict (code) do nothing;

create table public.fotn_votes (
  card_date  date not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  fight_id   uuid not null references public.fights (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (card_date, user_id)
);
create index fotn_votes_fight_idx on public.fotn_votes (fight_id);
create index fotn_votes_user_idx on public.fotn_votes (user_id);

create table public.fotn_results (
  card_date       date primary key,
  winner_fight_id uuid null references public.fights (id) on delete set null,
  counts          jsonb not null default '[]'::jsonb,
  total_votes     int not null default 0 check (total_votes >= 0),
  closes_at       timestamptz not null,
  finalized_at    timestamptz not null default now()
);

-- complete = >=1 settled fight and nothing scheduled/open/locked left on the card.
create or replace function private.fotn_window(p_card date)
returns table (complete boolean, settled int, opens_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select coalesce(count(*) filter (where f.status in ('scheduled', 'open', 'locked')) = 0
                  and count(*) filter (where f.status = 'settled') > 0, false),
         (count(*) filter (where f.status = 'settled'))::int,
         max(f.settled_at) filter (where f.status = 'settled'),
         max(f.settled_at) filter (where f.status = 'settled') + interval '24 hours'
    from public.fights f
   where f.card_date = p_card;
$$;

-- Idempotent: closes a complete card whose window is over. Returns true when it finalized now.
create or replace function private.fotn_finalize(p_card date)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  w        record;
  v_counts jsonb;
  v_total  int;
  v_winner uuid;
  v_f      public.fights%rowtype;
begin
  if p_card is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext('fotn:' || p_card::text));
  if exists (select 1 from public.fotn_results r where r.card_date = p_card) then return false; end if;
  select * into w from private.fotn_window(p_card);
  if not coalesce(w.complete, false) or now() < w.closes_at then return false; end if;

  with c as (
    select f.id, f.bout_order, f.settled_at,
           (select count(*) from public.fotn_votes v where v.card_date = p_card and v.fight_id = f.id)::int as votes
      from public.fights f
     where f.card_date = p_card and f.status = 'settled'
  )
  select coalesce(jsonb_agg(jsonb_build_object('fight_id', c.id, 'votes', c.votes)
                            order by c.bout_order, c.settled_at, c.id), '[]'::jsonb),
         coalesce(sum(c.votes), 0)::int
    into v_counts, v_total
    from c;

  -- most votes; ties: main event, then later bout, then later settle
  select f.id into v_winner
    from public.fights f
    join lateral (select count(*)::int as votes from public.fotn_votes v
                   where v.card_date = p_card and v.fight_id = f.id) n on true
   where f.card_date = p_card and f.status = 'settled' and n.votes > 0
   order by n.votes desc, f.is_main_event desc, f.bout_order desc, f.settled_at desc, f.id
   limit 1;

  insert into public.fotn_results (card_date, winner_fight_id, counts, total_votes, closes_at)
  values (p_card, v_winner, v_counts, v_total, w.closes_at);

  if v_winner is not null then
    select * into v_f from public.fights where id = v_winner;
    perform private.award_fighter_badge(v_f.red_fighter_id,  'fight_of_the_night', v_winner, w.closes_at);
    perform private.award_fighter_badge(v_f.blue_fighter_id, 'fight_of_the_night', v_winner, w.closes_at);
  end if;

  if v_total > 0 then      -- cards nobody voted on close silently (keeps the log feed clean)
    perform private.log(null, 'fotn_finalize', v_winner, jsonb_build_object(
      'card_date', p_card, 'winner_fight_id', v_winner, 'total_votes', v_total, 'closes_at', w.closes_at));
  end if;
  return true;
end;
$$;

-- pg_cron body: finalize every card whose window has closed.
create or replace function private.fotn_finalize_due()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_card date;
  v_n    int := 0;
begin
  for v_card in
    select distinct f.card_date from public.fights f
     where f.status = 'settled'
       and not exists (select 1 from public.fotn_results r where r.card_date = f.card_date)
     order by 1
  loop
    if private.fotn_finalize(v_card) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

-- B1 interplay: a fight leaving 'settled' (admin_correct_result) reopens its card's FOTN:
-- drop the card's result row and every fight_of_the_night badge earned on that card.
-- Votes stay; the new window opens when the card is complete again (24h from the new settle).
create or replace function private.fights_fotn_reset()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.fighter_badges b
   using public.fights f
   where b.code = 'fight_of_the_night' and b.fight_id = f.id and f.card_date = old.card_date;
  delete from public.fotn_results where card_date = old.card_date;
  return null;
end;
$$;

create trigger fights_fotn_reset
  after update of status on public.fights
  for each row
  when (old.status = 'settled' and new.status is distinct from 'settled')
  execute function private.fights_fotn_reset();

-- State object shared by get_fotn / cast_fotn_vote / get_card_recap (finalizes lazily).
create or replace function private.fotn_state(p_card date, p_uid uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  w        record;
  r        public.fotn_results%rowtype;
  v_status text;
  v_closes timestamptz;
  v_my     uuid;
  v_cands  jsonb;
begin
  perform private.fotn_finalize(p_card);
  select * into r from public.fotn_results where card_date = p_card;
  select * into w from private.fotn_window(p_card);

  if r.card_date is not null then
    v_status := 'closed';
    v_closes := r.closes_at;
  elsif coalesce(w.complete, false) then
    v_status := case when now() < w.closes_at then 'open' else 'closed' end;
    v_closes := w.closes_at;
  else
    v_status := 'not_ready';
  end if;

  select v.fight_id into v_my from public.fotn_votes v where v.card_date = p_card and v.user_id = p_uid;
  select coalesce(jsonb_agg(f.id order by f.bout_order, f.settled_at, f.id), '[]'::jsonb) into v_cands
    from public.fights f where f.card_date = p_card and f.status = 'settled';

  return jsonb_build_object(
    'card_date', p_card,
    'status', v_status,
    'open', v_status = 'open',
    'opens_at', case when coalesce(w.complete, false) then w.opens_at end,
    'closes_at', v_closes,
    'my_vote', v_my,
    'candidates', v_cands,
    'winner_fight_id', r.winner_fight_id,
    'counts', case when r.card_date is not null then r.counts end,
    'total_votes', case when r.card_date is not null then r.total_votes end);
end;
$$;

create or replace function public.get_fotn(p_card_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_member();
begin
  if p_card_date is null then raise exception 'INVALID_DATE'; end if;
  return private.fotn_state(p_card_date, v_uid);
end;
$$;

create or replace function public.cast_fotn_vote(p_fight_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_member();
  v_f   public.fights%rowtype;
  w     record;
begin
  select * into v_f from public.fights where id = p_fight_id;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status <> 'settled' then raise exception 'FOTN_NOT_ELIGIBLE'; end if;

  perform private.fotn_finalize(v_f.card_date);                       -- closes it if just due
  perform pg_advisory_xact_lock(hashtext('fotn:' || v_f.card_date::text));
  if exists (select 1 from public.fotn_results r where r.card_date = v_f.card_date) then
    raise exception 'FOTN_CLOSED';
  end if;
  select * into w from private.fotn_window(v_f.card_date);
  if not coalesce(w.complete, false) then raise exception 'FOTN_NOT_OPEN'; end if;
  if now() >= w.closes_at then raise exception 'FOTN_CLOSED'; end if;
  if private.is_or_was_linked(v_uid, v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;

  insert into public.fotn_votes (card_date, user_id, fight_id)
  values (v_f.card_date, v_uid, p_fight_id)
  on conflict (card_date, user_id)
  do update set fight_id = excluded.fight_id, updated_at = now();

  return private.fotn_state(v_f.card_date, v_uid);
end;
$$;

-- ===========================================================================
-- C3. Card recap (poster data)
-- ===========================================================================
create or replace function public.get_card_recap(p_card_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_member();
  v_admin  boolean := public.is_admin();
  v_fotn   jsonb;
  v_winner uuid;
  v_fights jsonb;
  v_champ  jsonb;
  v_open   int;
  v_total  int;
  v_settled int;
begin
  if p_card_date is null then raise exception 'INVALID_DATE'; end if;
  v_fotn := private.fotn_state(p_card_date, v_uid);
  v_winner := (v_fotn ->> 'winner_fight_id')::uuid;

  select count(*)::int,
         (count(*) filter (where f.status in ('scheduled', 'open', 'locked')))::int,
         (count(*) filter (where f.status = 'settled'))::int
    into v_total, v_open, v_settled
    from public.fights f where f.card_date = p_card_date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'fight_id', f.id, 'bout_order', f.bout_order, 'is_main_event', f.is_main_event,
           'is_title_fight', f.is_title_fight, 'title', f.title, 'status', f.status,
           'cancel_kind', f.cancel_kind, 'winner_side', f.winner_side, 'method', f.method,
           'finish_move', f.finish_move, 'rounds', f.rounds, 'settled_at', f.settled_at,
           'is_fotn', coalesce(f.id = v_winner, false),
           'red', jsonb_build_object(
              'fighter_id', r.id,
              'nickname', case when r.hidden and not v_admin then null else r.nickname end,
              'kg', coalesce(f.red_weight_kg, r.weight_kg), 'score', f.red_score),
           'blue', jsonb_build_object(
              'fighter_id', b.id,
              'nickname', case when b.hidden and not v_admin then null else b.nickname end,
              'kg', coalesce(f.blue_weight_kg, b.weight_kg), 'score', f.blue_score))
           order by f.bout_order, f.scheduled_at, f.created_at), '[]'::jsonb)
    into v_fights
    from public.fights f
    join public.fighters r on r.id = f.red_fighter_id
    join public.fighters b on b.id = f.blue_fighter_id
   where f.card_date = p_card_date;

  select jsonb_build_object('fighter_id', c.fighter_id, 'nickname', cf.nickname) into v_champ
    from public.belt_reigns c
    join public.fighters cf on cf.id = c.fighter_id
   where c.ended_at is null and (not cf.hidden or v_admin);

  return jsonb_build_object(
    'card_date', p_card_date,
    'complete', v_total > 0 and v_open = 0,
    'settled_count', v_settled,
    'champion', v_champ,
    'fotn', jsonb_build_object('status', v_fotn -> 'status', 'closes_at', v_fotn -> 'closes_at',
                               'winner_fight_id', v_fotn -> 'winner_fight_id'),
    'fights', v_fights);
end;
$$;

-- ===========================================================================
-- C5. Callouts / rematches
-- ===========================================================================
create table public.callouts (
  id                    uuid primary key default gen_random_uuid(),
  challenger_fighter_id uuid not null references public.fighters (id) on delete cascade,
  target_fighter_id     uuid not null references public.fighters (id) on delete cascade,
  message               text null check (message is null or char_length(message) between 1 and 140),
  status                text not null default 'pending'
                        check (status in ('pending', 'accepted', 'declined', 'approved', 'rejected', 'booked')),
  rematch_of            uuid null references public.fights (id) on delete set null,
  fight_id              uuid null references public.fights (id) on delete set null,
  created_by            uuid null references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  responded_at          timestamptz null,
  responded_by          uuid null references public.profiles (id) on delete set null,
  decided_at            timestamptz null,
  decided_by            uuid null references public.profiles (id) on delete set null,
  decision_note         text null check (decision_note is null or char_length(decision_note) <= 200),
  check (challenger_fighter_id <> target_fighter_id)
);
create index callouts_challenger_idx on public.callouts (challenger_fighter_id, status);
create index callouts_target_idx on public.callouts (target_fighter_id, status);
create index callouts_created_idx on public.callouts (created_at desc);

create or replace view public.callout_board with (security_invoker = on) as
select c.id, c.status, c.message,
       c.challenger_fighter_id, ch.nickname as challenger_nickname,
       c.target_fighter_id, t.nickname as target_nickname,
       c.rematch_of, c.fight_id, c.created_by, c.created_at, c.responded_at, c.decided_at,
       c.decision_note,
       c.status in ('pending', 'accepted', 'approved') as is_open
  from public.callouts c
  join public.fighters ch on ch.id = c.challenger_fighter_id
  join public.fighters t  on t.id  = c.target_fighter_id;

create or replace function private.fighter_has_account(p_fighter uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.fighter_id = p_fighter and p.active);
$$;

create or replace function private.callout_prefill(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'callout_id', c.id,
    'red_fighter_id', c.challenger_fighter_id, 'blue_fighter_id', c.target_fighter_id,
    'red_nickname', r.nickname, 'blue_nickname', b.nickname,
    'red_weight_kg', r.weight_kg, 'blue_weight_kg', b.weight_kg,
    'title', left(case when c.rematch_of is not null then 'Rematch: ' else '' end
                  || r.nickname || ' vs ' || b.nickname, 80),
    'rematch_of', c.rematch_of)
    from public.callouts c
    join public.fighters r on r.id = c.challenger_fighter_id
    join public.fighters b on b.id = c.target_fighter_id
   where c.id = p_id;
$$;

create or replace function public.create_callout(p_target_fighter_id uuid, p_message text,
                                                 p_rematch_of uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_member();
  v_me     uuid;
  v_target uuid := p_target_fighter_id;
  v_msg    text := nullif(btrim(coalesce(p_message, '')), '');
  v_f      public.fights%rowtype;
  v_winner uuid;
  v_loser  uuid;
  v_id     uuid;
begin
  select p.fighter_id into v_me from public.profiles p where p.id = v_uid;
  if v_me is null then raise exception 'NOT_A_FIGHTER'; end if;
  if v_msg is not null and (char_length(v_msg) > 140 or v_msg ~ '[[:cntrl:]]') then
    raise exception 'INVALID_MESSAGE';
  end if;

  if p_rematch_of is not null then
    select * into v_f from public.fights where id = p_rematch_of;
    if not found or v_f.status <> 'settled' then raise exception 'NOT_REMATCH_ELIGIBLE'; end if;
    v_winner := case v_f.winner_side when 'red' then v_f.red_fighter_id else v_f.blue_fighter_id end;
    v_loser  := case v_f.winner_side when 'red' then v_f.blue_fighter_id else v_f.red_fighter_id end;
    if v_loser <> v_me then raise exception 'NOT_REMATCH_ELIGIBLE'; end if;
    if v_target is null then
      v_target := v_winner;
    elsif v_target <> v_winner then
      raise exception 'NOT_REMATCH_ELIGIBLE';
    end if;
  end if;

  if v_target is null then raise exception 'FIGHTER_NOT_FOUND'; end if;
  if v_target = v_me then raise exception 'SAME_FIGHTER'; end if;
  if not exists (select 1 from public.fighters where id = v_target) then
    raise exception 'FIGHTER_NOT_FOUND';
  end if;
  if exists (select 1 from public.fighters where id in (v_me, v_target) and hidden) then
    raise exception 'FIGHTER_HIDDEN';
  end if;

  -- serialise per challenger (limit) and per pair (one open callout), fixed order
  perform pg_advisory_xact_lock(hashtext('callout_from:' || v_me::text));
  perform pg_advisory_xact_lock(hashtext('callout_pair:' || least(v_me, v_target)::text
                                          || ':' || greatest(v_me, v_target)::text));

  if exists (
    select 1 from public.callouts c
     where c.status in ('pending', 'accepted', 'approved')
       and ((c.challenger_fighter_id = v_me and c.target_fighter_id = v_target)
         or (c.challenger_fighter_id = v_target and c.target_fighter_id = v_me))
  ) then
    raise exception 'CALLOUT_EXISTS';
  end if;
  if (select count(*) from public.callouts c
       where c.challenger_fighter_id = v_me and c.status in ('pending', 'accepted', 'approved')) >= 3 then
    raise exception 'CALLOUT_LIMIT';
  end if;

  insert into public.callouts (challenger_fighter_id, target_fighter_id, message, rematch_of, created_by)
  values (v_me, v_target, v_msg, p_rematch_of, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.respond_callout(p_callout_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_member();
  v_c   public.callouts%rowtype;
  v_me  uuid;
begin
  select * into v_c from public.callouts where id = p_callout_id for update;
  if not found then raise exception 'CALLOUT_NOT_FOUND'; end if;
  select p.fighter_id into v_me from public.profiles p where p.id = v_uid;
  if v_me is null or v_me <> v_c.target_fighter_id then raise exception 'NOT_TARGET'; end if;
  if v_c.status <> 'pending' then raise exception 'CALLOUT_BAD_STATE'; end if;
  update public.callouts
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now(), responded_by = v_uid
   where id = p_callout_id;
end;
$$;

create or replace function public.accept_callout(p_callout_id uuid)
returns void
language sql security definer set search_path = ''
as $$ select private.respond_callout(p_callout_id, true); $$;

create or replace function public.decline_callout(p_callout_id uuid)
returns void
language sql security definer set search_path = ''
as $$ select private.respond_callout(p_callout_id, false); $$;

create or replace function public.withdraw_callout(p_callout_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_member();
  v_c   public.callouts%rowtype;
  v_me  uuid;
begin
  select * into v_c from public.callouts where id = p_callout_id for update;
  if not found then raise exception 'CALLOUT_NOT_FOUND'; end if;
  select p.fighter_id into v_me from public.profiles p where p.id = v_uid;
  if v_me is null or v_me <> v_c.challenger_fighter_id then raise exception 'NOT_CHALLENGER'; end if;
  if v_c.status not in ('pending', 'accepted') then raise exception 'CALLOUT_BAD_STATE'; end if;
  delete from public.callouts where id = p_callout_id;
end;
$$;

-- Admin side. Lock the callout, refuse admins linked to either fighter.
create or replace function private.lock_callout_for_admin(p_uid uuid, p_callout_id uuid)
returns public.callouts
language plpgsql security definer set search_path = ''
as $$
declare v_c public.callouts%rowtype;
begin
  select * into v_c from public.callouts where id = p_callout_id for update;
  if not found then raise exception 'CALLOUT_NOT_FOUND'; end if;
  if private.is_or_was_linked(p_uid, v_c.challenger_fighter_id, v_c.target_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;
  return v_c;
end;
$$;

-- bookable: accepted / approved, or still pending when the target fighter has no account to answer
create or replace function private.callout_bookable(p_c public.callouts, p_allow_approved boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_c.status = 'accepted'
      or (p_allow_approved and p_c.status = 'approved')
      or (p_c.status = 'pending' and not private.fighter_has_account(p_c.target_fighter_id));
$$;

create or replace function public.admin_approve_callout(p_callout_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_c   public.callouts%rowtype;
begin
  v_c := private.lock_callout_for_admin(v_uid, p_callout_id);
  if not private.callout_bookable(v_c, false) then raise exception 'CALLOUT_BAD_STATE'; end if;
  update public.callouts set status = 'approved', decided_at = now(), decided_by = v_uid
   where id = p_callout_id;
  perform private.log(v_uid, 'callout_approve', p_callout_id, jsonb_build_object(
    'challenger', v_c.challenger_fighter_id, 'target', v_c.target_fighter_id, 'prev_status', v_c.status));
  return private.callout_prefill(p_callout_id);
end;
$$;

create or replace function public.admin_book_callout(p_callout_id uuid, p_scheduled_at timestamptz,
                                                     p_lock_at timestamptz, p_title text default null,
                                                     p_bout_order int default null,
                                                     p_main_event boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_admin();
  v_c     public.callouts%rowtype;
  v_title text;
  v_fight uuid;
begin
  v_c := private.lock_callout_for_admin(v_uid, p_callout_id);
  if not private.callout_bookable(v_c, true) then raise exception 'CALLOUT_BAD_STATE'; end if;
  v_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''),
                      private.callout_prefill(p_callout_id) ->> 'title');
  -- normal fight: status 'scheduled', both fighters still have to accept (B2 consent flow)
  v_fight := public.admin_create_fight(v_c.challenger_fighter_id, v_c.target_fighter_id,
                                       p_scheduled_at, p_lock_at, v_title, null, null,
                                       p_bout_order, coalesce(p_main_event, false));
  update public.callouts
     set status = 'booked', fight_id = v_fight,
         decided_at = coalesce(decided_at, now()), decided_by = coalesce(decided_by, v_uid)
   where id = p_callout_id;
  perform private.log(v_uid, 'callout_book', p_callout_id, jsonb_build_object(
    'fight_id', v_fight, 'challenger', v_c.challenger_fighter_id, 'target', v_c.target_fighter_id,
    'prev_status', v_c.status));
  return v_fight;
end;
$$;

create or replace function public.admin_reject_callout(p_callout_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_admin();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_c      public.callouts%rowtype;
begin
  if v_reason is not null and char_length(v_reason) > 200 then raise exception 'INVALID_REASON'; end if;
  v_c := private.lock_callout_for_admin(v_uid, p_callout_id);
  if v_c.status not in ('pending', 'accepted', 'approved') then raise exception 'CALLOUT_BAD_STATE'; end if;
  update public.callouts
     set status = 'rejected', decided_at = now(), decided_by = v_uid, decision_note = v_reason
   where id = p_callout_id;
  perform private.log(v_uid, 'callout_reject', p_callout_id, jsonb_build_object(
    'reason', v_reason, 'prev_status', v_c.status));
end;
$$;

create or replace function public.admin_delete_callout(p_callout_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_admin();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_c      public.callouts%rowtype;
begin
  if v_reason is not null and char_length(v_reason) > 200 then raise exception 'INVALID_REASON'; end if;
  v_c := private.lock_callout_for_admin(v_uid, p_callout_id);
  delete from public.callouts where id = p_callout_id;
  perform private.log(v_uid, 'callout_delete', p_callout_id, jsonb_build_object(
    'reason', v_reason, 'status', v_c.status, 'message', v_c.message,
    'challenger', v_c.challenger_fighter_id, 'target', v_c.target_fighter_id));
end;
$$;

-- ===========================================================================
-- C6. Points shop (cosmetic, fun points only)
-- ===========================================================================
create table public.shop_items (
  code   text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  kind   text not null check (kind in ('name_color', 'frame', 'title')),
  label  text not null check (char_length(label) between 1 and 40),
  value  text null check (value is null or char_length(value) between 1 and 40),
  price  int not null check (price > 0),
  active boolean not null default true,
  sort   int not null default 0,
  unique (code, kind)
);

insert into public.shop_items (code, kind, label, value, price, sort) values
  ('color_gold',        'name_color', 'Gold',         'gold',        300, 10),
  ('color_crimson',     'name_color', 'Crimson',      'crimson',     200, 20),
  ('color_ice_blue',    'name_color', 'Ice Blue',     'ice_blue',    200, 30),
  ('color_neon_green',  'name_color', 'Neon Green',   'neon_green',  250, 40),
  ('frame_flame',       'frame',      'Flame',        'flame',       400, 10),
  ('frame_chain',       'frame',      'Chain',        'chain',       350, 20),
  ('frame_crown',       'frame',      'Crown',        'crown',       800, 30),
  ('title_custom',      'title',      'Custom title', null,          500, 10),
  ('title_the_butcher', 'title',      'The Butcher',  'The Butcher', 300, 20),
  ('title_iron_grip',   'title',      'Iron Grip',    'Iron Grip',   300, 30),
  ('title_mat_rat',     'title',      'Mat Rat',      'Mat Rat',     150, 40)
on conflict (code) do nothing;

create table public.user_items (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  code         text not null,
  kind         text not null,
  custom_value text null check (custom_value is null or char_length(custom_value) between 1 and 24),
  purchased_at timestamptz not null default now(),
  equipped     boolean not null default false,
  equipped_at  timestamptz null,
  primary key (user_id, code),
  foreign key (code, kind) references public.shop_items (code, kind)
);
create unique index user_items_one_equipped_per_kind on public.user_items (user_id, kind) where equipped;

create table public.title_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 24 and title = btrim(title)),
  price         int not null check (price >= 0),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz null,
  decided_by    uuid null references public.profiles (id) on delete set null,
  decision_note text null check (decision_note is null or char_length(decision_note) <= 200)
);
create unique index title_requests_one_pending on public.title_requests (user_id) where status = 'pending';
create index title_requests_status_idx on public.title_requests (status, created_at);

create or replace view public.member_cosmetics with (security_invoker = on) as
select p.id as user_id,
       max(si.value) filter (where ui.kind = 'name_color')                       as name_color,
       max(si.value) filter (where ui.kind = 'frame')                            as frame,
       max(coalesce(ui.custom_value, si.value)) filter (where ui.kind = 'title') as title,
       max(ui.code) filter (where ui.kind = 'name_color')                        as name_color_code,
       max(ui.code) filter (where ui.kind = 'frame')                             as frame_code,
       max(ui.code) filter (where ui.kind = 'title')                             as title_code
  from public.profiles p
  join public.user_items ui on ui.user_id = p.id and ui.equipped
  join public.shop_items si on si.code = ui.code
 where p.active
 group by p.id;

create or replace function public.buy_item(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_member();
  v_i   public.shop_items%rowtype;
  v_bal int;
begin
  select * into v_i from public.shop_items where code = p_code;
  if not found or not v_i.active then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_i.code = 'title_custom' then raise exception 'USE_TITLE_REQUEST'; end if;

  -- serialises all balance-spending operations for this user (same lock as place_bet)
  perform 1 from public.profiles p where p.id = v_uid for update;
  if exists (select 1 from public.user_items ui where ui.user_id = v_uid and ui.code = v_i.code) then
    raise exception 'ALREADY_OWNED';
  end if;
  v_bal := private.balance_of(v_uid);
  if v_bal < v_i.price then raise exception 'INSUFFICIENT_POINTS'; end if;

  insert into public.user_items (user_id, code, kind) values (v_uid, v_i.code, v_i.kind);
  insert into public.points_ledger (user_id, delta, reason, ref_id, note)
  values (v_uid, -v_i.price, 'shop', null, v_i.code);

  return jsonb_build_object('code', v_i.code, 'kind', v_i.kind, 'price', v_i.price,
                            'balance', v_bal - v_i.price);
end;
$$;

create or replace function public.equip_item(p_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := private.require_member();
  v_kind text;
begin
  select si.kind into v_kind from public.shop_items si where si.code = p_code;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform 1 from public.profiles p where p.id = v_uid for update;
  if not exists (select 1 from public.user_items ui where ui.user_id = v_uid and ui.code = p_code) then
    raise exception 'NOT_OWNED';
  end if;
  update public.user_items set equipped = false, equipped_at = null
   where user_id = v_uid and kind = v_kind and code <> p_code and equipped;
  update public.user_items set equipped = true, equipped_at = coalesce(equipped_at, now())
   where user_id = v_uid and code = p_code and not equipped;
end;
$$;

create or replace function public.unequip_item(p_kind text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_member();
begin
  if p_kind is null or p_kind not in ('name_color', 'frame', 'title') then raise exception 'INVALID_KIND'; end if;
  update public.user_items set equipped = false, equipped_at = null
   where user_id = v_uid and kind = p_kind and equipped;
end;
$$;

create or replace function public.request_title(p_title text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_member();
  v_title text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_i     public.shop_items%rowtype;
  v_id    uuid;
begin
  if v_title !~ '^[A-Za-z0-9 ''.,!?&-]{1,24}$' then raise exception 'INVALID_TITLE'; end if;
  select * into v_i from public.shop_items where code = 'title_custom';
  if not found or not v_i.active then raise exception 'ITEM_NOT_FOUND'; end if;

  perform 1 from public.profiles p where p.id = v_uid for update;
  if exists (select 1 from public.title_requests t where t.user_id = v_uid and t.status = 'pending') then
    raise exception 'TITLE_PENDING';
  end if;
  if private.balance_of(v_uid) < v_i.price then raise exception 'INSUFFICIENT_POINTS'; end if;

  insert into public.title_requests (user_id, title, price) values (v_uid, v_title, v_i.price)
  returning id into v_id;
  insert into public.points_ledger (user_id, delta, reason, ref_id, note)
  values (v_uid, -v_i.price, 'shop', v_id, 'title_custom');
  return v_id;
end;
$$;

create or replace function private.lock_title_request(p_uid uuid, p_request_id uuid)
returns public.title_requests
language plpgsql security definer set search_path = ''
as $$
declare v_t public.title_requests%rowtype;
begin
  select * into v_t from public.title_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_t.status <> 'pending' then raise exception 'REQUEST_DECIDED'; end if;
  if v_t.user_id = p_uid then raise exception 'OWN_REQUEST'; end if;
  return v_t;
end;
$$;

create or replace function public.admin_approve_title(p_request_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_t   public.title_requests%rowtype;
begin
  v_t := private.lock_title_request(v_uid, p_request_id);
  update public.title_requests set status = 'approved', decided_at = now(), decided_by = v_uid
   where id = p_request_id;
  perform 1 from public.profiles p where p.id = v_t.user_id for update;
  insert into public.user_items (user_id, code, kind, custom_value)
  values (v_t.user_id, 'title_custom', 'title', v_t.title)
  on conflict (user_id, code) do update set custom_value = excluded.custom_value, purchased_at = now();
  -- wear it straight away unless another title is on
  update public.user_items ui set equipped = true, equipped_at = now()
   where ui.user_id = v_t.user_id and ui.code = 'title_custom' and not ui.equipped
     and not exists (select 1 from public.user_items o
                      where o.user_id = v_t.user_id and o.kind = 'title' and o.equipped);
  perform private.log(v_uid, 'title_approve', p_request_id, jsonb_build_object(
    'user_id', v_t.user_id, 'title', v_t.title));
end;
$$;

create or replace function public.admin_reject_title(p_request_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_admin();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_t      public.title_requests%rowtype;
begin
  if v_reason is not null and char_length(v_reason) > 200 then raise exception 'INVALID_REASON'; end if;
  v_t := private.lock_title_request(v_uid, p_request_id);
  update public.title_requests
     set status = 'rejected', decided_at = now(), decided_by = v_uid, decision_note = v_reason
   where id = p_request_id;
  if v_t.price > 0 then
    insert into public.points_ledger (user_id, delta, reason, ref_id, note)
    values (v_t.user_id, v_t.price, 'shop_refund', p_request_id, 'title_custom');
  end if;
  perform private.log(v_uid, 'title_reject', p_request_id, jsonb_build_object(
    'user_id', v_t.user_id, 'title', v_t.title, 'reason', v_reason, 'refund', v_t.price));
end;
$$;

-- ===========================================================================
-- C7. Hall of Fame
-- ===========================================================================
create or replace function public.hall_of_fame()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := private.require_member();
  v_admin   boolean := public.is_admin();
  v_reigns  jsonb;
  v_seasons jsonb;
  v_streak  jsonb;
  v_wins    jsonb;
  v_rounds  jsonb;
  v_fotn    jsonb;
  v_upset   jsonb;
  v_peak    jsonb;
begin
  perform private.fotn_finalize_due();

  select coalesce(jsonb_agg(jsonb_build_object(
           'reign_id', h.reign_id, 'fighter_id', h.fighter_id, 'nickname', h.nickname,
           'started_at', h.started_at, 'ended_at', h.ended_at, 'end_reason', h.end_reason,
           'defenses', h.defenses, 'is_current', h.is_current, 'won_fight_id', h.won_fight_id)
           order by h.started_at desc), '[]'::jsonb)
    into v_reigns
    from public.belt_reign_history h
    join public.fighters f on f.id = h.fighter_id
   where not f.hidden or v_admin;

  select coalesce(jsonb_agg(jsonb_build_object(
           'season_id', s.id, 'name', s.name, 'started_at', s.started_at, 'ended_at', s.ended_at,
           'champion_fighter_id', case when cf.id is not null then s.champion_fighter_id end,
           'champion_nickname', cf.nickname,
           'champion_source', s.snapshot -> 'champion' ->> 'source',
           'top_bettor_user_id', s.top_bettor_user_id,
           'top_bettor_display_name', tp.display_name,
           'top_bettor_balance', (s.snapshot -> 'top_bettor' ->> 'balance')::int)
           order by s.ended_at desc, s.id desc), '[]'::jsonb)
    into v_seasons
    from public.seasons s
    left join public.fighters cf on cf.id = s.champion_fighter_id and (not cf.hidden or v_admin)
    left join public.profiles tp on tp.id = s.top_bettor_user_id
   where s.ended_at is not null;

  -- longest win streak (all-time, gaps and islands over settled fights)
  with fr as (
    select r.fighter_id, r.result, r.settled_at, r.fight_id from public.fight_results r
  ), g as (
    select fr.fighter_id, fr.result,
           row_number() over (partition by fr.fighter_id order by fr.settled_at, fr.fight_id)
         - row_number() over (partition by fr.fighter_id, fr.result order by fr.settled_at, fr.fight_id) as grp
      from fr
  ), best as (
    select x.fighter_id, max(x.len)::int as value
      from (select g.fighter_id, count(*) as len from g where g.result = 'W' group by g.fighter_id, g.grp) x
     group by x.fighter_id
  ), t as (
    select rank() over (order by b.value desc)::int as rank, b.fighter_id, f.nickname, b.value
      from best b join public.fighters f on f.id = b.fighter_id
     where (not f.hidden or v_admin) and b.value > 0
     order by b.value desc, f.nickname
     limit 3
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.nickname), '[]'::jsonb) into v_streak from t;

  with t as (
    select rank() over (order by f.wins desc)::int as rank, f.id as fighter_id, f.nickname, f.wins as value
      from public.fighters f
     where (not f.hidden or v_admin) and f.wins > 0
     order by f.wins desc, f.nickname
     limit 3
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.nickname), '[]'::jsonb) into v_wins from t;

  with x as (
    select r.fighter_id, coalesce(sum(r.rounds), 0)::int as value from public.fight_results r group by r.fighter_id
  ), t as (
    select rank() over (order by x.value desc)::int as rank, x.fighter_id, f.nickname, x.value
      from x join public.fighters f on f.id = x.fighter_id
     where (not f.hidden or v_admin) and x.value > 0
     order by x.value desc, f.nickname
     limit 3
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.nickname), '[]'::jsonb) into v_rounds from t;

  with x as (
    select b.fighter_id, count(*)::int as value from public.fighter_badges b
     where b.code = 'fight_of_the_night' group by b.fighter_id
  ), t as (
    select rank() over (order by x.value desc)::int as rank, x.fighter_id, f.nickname, x.value
      from x join public.fighters f on f.id = x.fighter_id
     where not f.hidden or v_admin
     order by x.value desc, f.nickname
     limit 3
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.nickname), '[]'::jsonb) into v_fotn from t;

  with x as (
    select fi.id as fight_id, fi.card_date, fi.settled_at,
           case fi.winner_side when 'red' then fi.red_fighter_id else fi.blue_fighter_id end as winner_id,
           case fi.winner_side when 'red' then fi.blue_fighter_id else fi.red_fighter_id end as loser_id,
           case fi.winner_side when 'red' then fi.red_elo_before else fi.blue_elo_before end as winner_elo,
           case fi.winner_side when 'red' then fi.blue_elo_before else fi.red_elo_before end as loser_elo
      from public.fights fi
     where fi.status = 'settled' and fi.red_elo_before is not null and fi.blue_elo_before is not null
  ), t as (
    select rank() over (order by (x.loser_elo - x.winner_elo) desc)::int as rank,
           x.fight_id, x.card_date, x.settled_at, (x.loser_elo - x.winner_elo) as value,
           x.winner_id as winner_fighter_id, w.nickname as winner_nickname, x.winner_elo as winner_elo_before,
           x.loser_id as loser_fighter_id, l.nickname as loser_nickname, x.loser_elo as loser_elo_before
      from x
      join public.fighters w on w.id = x.winner_id
      join public.fighters l on l.id = x.loser_id
     where x.loser_elo > x.winner_elo and ((not w.hidden and not l.hidden) or v_admin)
     order by (x.loser_elo - x.winner_elo) desc, x.settled_at
     limit 3
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.settled_at), '[]'::jsonb) into v_upset from t;

  with l as (
    select pl.user_id, pl.created_at,
           sum(pl.delta) over (partition by pl.user_id order by pl.created_at, pl.id) as bal
      from public.points_ledger pl
  ), pk as (
    select distinct on (l.user_id) l.user_id, l.bal, l.created_at
      from l order by l.user_id, l.bal desc, l.created_at
  ), t as (
    select rank() over (order by pk.bal desc)::int as rank, pk.user_id, p.display_name,
           pk.bal::int as value, pk.created_at as at
      from pk join public.profiles p on p.id = pk.user_id and p.active
     where pk.bal > 0
     order by pk.bal desc, pk.created_at
     limit 3
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.at), '[]'::jsonb) into v_peak from t;

  return jsonb_build_object(
    'generated_at', now(),
    'champions', v_reigns,
    'season_champions', v_seasons,
    'records', jsonb_build_object(
      'longest_win_streak', v_streak,
      'most_wins', v_wins,
      'most_rounds', v_rounds,
      'most_fotn', v_fotn,
      'biggest_upset', v_upset,
      'top_bettor_peak', v_peak));
end;
$$;

-- ===========================================================================
-- RLS + table privileges
-- ===========================================================================
alter table public.site_settings  enable row level security;
alter table public.fotn_votes     enable row level security;
alter table public.fotn_results   enable row level security;
alter table public.callouts       enable row level security;
alter table public.shop_items     enable row level security;
alter table public.user_items     enable row level security;
alter table public.title_requests enable row level security;

-- lockdown state itself is readable by every signed-in user (app shell + realtime)
create policy site_settings_select on public.site_settings for select to authenticated using (true);
create policy fotn_votes_select_own on public.fotn_votes for select to authenticated
  using ((select public.is_member()) and user_id = (select auth.uid()));
create policy fotn_results_select on public.fotn_results for select to authenticated
  using ((select public.is_member()));
create policy callouts_select on public.callouts for select to authenticated
  using ((select public.is_member())
         and ((select public.is_admin())
              or (    exists (select 1 from public.fighters f where f.id = callouts.challenger_fighter_id and not f.hidden)
                  and exists (select 1 from public.fighters f where f.id = callouts.target_fighter_id and not f.hidden))));
create policy shop_items_select on public.shop_items for select to authenticated
  using ((select public.is_member()));
create policy user_items_select on public.user_items for select to authenticated
  using ((select public.is_member())
         and (user_id = (select auth.uid()) or equipped or (select public.is_admin())));
create policy title_requests_select on public.title_requests for select to authenticated
  using ((select public.is_member())
         and (user_id = (select auth.uid()) or (select public.is_admin())));

revoke all on public.site_settings, public.fotn_votes, public.fotn_results, public.callouts,
              public.shop_items, public.user_items, public.title_requests,
              public.callout_board, public.member_cosmetics
  from anon, authenticated, public;
grant select on public.site_settings, public.fotn_votes, public.fotn_results, public.callouts, public.shop_items,
                public.user_items, public.title_requests, public.callout_board, public.member_cosmetics
  to authenticated;

-- ===========================================================================
-- Cron + realtime
-- ===========================================================================
select cron.schedule('fotn-finalize', '*/10 * * * *', $$select private.fotn_finalize_due();$$);

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_settings') then
    alter publication supabase_realtime add table public.site_settings;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'callouts') then
    alter publication supabase_realtime add table public.callouts;
  end if;
end;
$$;

-- ===========================================================================
-- Function privileges (re-applied: new functions default to EXECUTE for PUBLIC)
-- ===========================================================================
revoke execute on all functions in schema public  from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.is_member(),
  public.is_admin(),
  public.is_referee(),
  public.is_locked_out(),
  public.public_site_status(),
  public.my_balance(),
  public.cast_vote(uuid, text),
  public.place_bet(uuid, text, int),
  public.cancel_bet(uuid),
  public.toggle_reaction(uuid, text),
  public.get_fight_vote_totals(uuid),
  public.get_all_fight_vote_totals(),
  public.get_leaderboard_bettors(),
  public.get_live_score(uuid),
  public.list_badges(text, uuid),
  public.public_next_fight(),
  public.accept_fight(uuid),
  public.decline_fight(uuid),
  -- wave C member RPCs
  public.get_card_recap(date),
  public.get_fotn(date),
  public.cast_fotn_vote(uuid),
  public.create_callout(uuid, text, uuid),
  public.accept_callout(uuid),
  public.decline_callout(uuid),
  public.withdraw_callout(uuid),
  public.buy_item(text),
  public.equip_item(text),
  public.unequip_item(text),
  public.request_title(text),
  public.hall_of_fame(),
  -- admin RPCs
  public.admin_upsert_fighter(uuid, text, numeric, text, text, boolean),
  public.admin_create_fight(uuid, uuid, timestamptz, timestamptz, text, numeric, numeric, int, boolean),
  public.admin_lock_fight(uuid),
  public.admin_settle_fight(uuid, text, text, text, int, int, int, text, numeric, numeric),
  public.admin_correct_result(uuid, text),
  public.admin_cancel_fight(uuid, text, text),
  public.admin_force_open(uuid, text),
  public.admin_reorder_card(date, uuid[]),
  public.admin_set_main_event(uuid),
  public.admin_set_member(uuid, boolean, text, uuid, text),
  public.admin_adjust_points(uuid, int, text),
  public.admin_live_update(uuid, text, int),
  public.admin_award_belt(uuid, text),
  public.admin_end_season(text, text),
  public.admin_set_lockdown(boolean, text),
  public.admin_approve_callout(uuid),
  public.admin_book_callout(uuid, timestamptz, timestamptz, text, int, boolean),
  public.admin_reject_callout(uuid, text),
  public.admin_delete_callout(uuid, text),
  public.admin_approve_title(uuid),
  public.admin_reject_title(uuid, text)
to authenticated;

grant execute on function public.public_next_fight(), public.public_site_status() to anon;

-- Close any card whose voting window is already over (older cards: no votes, no winner).
select private.fotn_finalize_due();
