-- UoS Fight Night — WAVE B (CONTRACT.md ADDENDA):
--   B4  referee live scoring: live_scores, admin_live_update, get_live_score, live_score_state
--   B5  title belt: belt_reigns, admin_award_belt, fights.is_title_fight, current_champion
--   B6  badges: badge_catalog, fighter_badges, user_badges, list_badges (awarded inside settle)
--   B7  semester reset: seasons, admin_end_season, season_wins/season_losses, ledger 'season_reset'
--   B1+ admin_correct_result also reverses belt transfer, badges and season counters
-- Every function: security definer, set search_path = '', fully-qualified names.
--
-- Lock order (to stay deadlock-free): belt advisory lock -> fight row(s) -> fighter
-- rows (id order) -> bets / profiles. settle, correct, award_belt and end_season
-- all take the belt lock FIRST.

-- ===========================================================================
-- Roles: referee helper (wave C adds profiles.role 'referee' and extends this)
-- ===========================================================================
create or replace function public.is_referee()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin();
$$;

create or replace function private.require_referee()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_referee() then
    raise exception 'NOT_REFEREE' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function private.lock_belt()
returns void
language sql security definer set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtext('fight_night:belt'));
$$;

-- ===========================================================================
-- Ledger: season_reset (B7)
-- ===========================================================================
alter table public.points_ledger drop constraint if exists points_ledger_reason_check;
alter table public.points_ledger add constraint points_ledger_reason_check
  check (reason in ('signup', 'weekly', 'topup', 'bet', 'bet_cancel', 'payout', 'refund',
                    'admin_adjust', 'payout_reversal', 'season_reset'));

-- ===========================================================================
-- Columns
-- ===========================================================================
alter table public.fighters
  add column if not exists season_wins   int not null default 0 check (season_wins >= 0),
  add column if not exists season_losses int not null default 0 check (season_losses >= 0);
-- Season 1 covers everything played so far.
update public.fighters set season_wins = wins, season_losses = losses
 where season_wins <> wins or season_losses <> losses;

alter table public.fights
  add column if not exists is_title_fight boolean not null default false;

-- ===========================================================================
-- B5. Title belt
-- ===========================================================================
create table public.belt_reigns (
  id            uuid primary key default gen_random_uuid(),
  fighter_id    uuid not null references public.fighters (id) on delete cascade,
  won_fight_id  uuid null references public.fights (id) on delete set null,
  lost_fight_id uuid null references public.fights (id) on delete set null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz null,
  end_reason    text null check (end_reason in ('lost', 'vacated', 'reassigned')),
  note          text null check (note is null or char_length(note) <= 200),
  awarded_by    uuid null references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((ended_at is null) = (end_reason is null)),
  check (ended_at is null or ended_at >= started_at)
);
create unique index belt_reigns_one_current on public.belt_reigns ((true)) where ended_at is null;
create index belt_reigns_fighter_idx on public.belt_reigns (fighter_id, started_at desc);
create index belt_reigns_won_idx  on public.belt_reigns (won_fight_id)  where won_fight_id is not null;
create index belt_reigns_lost_idx on public.belt_reigns (lost_fight_id) where lost_fight_id is not null;

create or replace function private.current_champion_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select r.fighter_id from public.belt_reigns r where r.ended_at is null;
$$;

-- is_title_fight = the current champion is in the fight. Frozen once settled or
-- cancelled; refreshed for live (scheduled/open/locked) fights whenever the belt moves.
create or replace function private.refresh_title_flags()
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_champ uuid := private.current_champion_id();
begin
  update public.fights f
     set is_title_fight = coalesce(v_champ in (f.red_fighter_id, f.blue_fighter_id), false)
   where f.status in ('scheduled', 'open', 'locked')
     and f.is_title_fight is distinct from coalesce(v_champ in (f.red_fighter_id, f.blue_fighter_id), false);
end;
$$;

create or replace function private.fights_set_title_flag()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.is_title_fight := exists (
    select 1 from public.belt_reigns r
     where r.ended_at is null and r.fighter_id in (new.red_fighter_id, new.blue_fighter_id));
  return new;
end;
$$;

drop trigger if exists fights_set_title_flag on public.fights;
create trigger fights_set_title_flag
  before insert on public.fights
  for each row execute function private.fights_set_title_flag();

-- ===========================================================================
-- B6. Badges
-- ===========================================================================
create table public.badge_catalog (
  code        text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  kind        text not null check (kind in ('fighter', 'user')),
  label       text not null,
  description text not null,
  icon        text not null,   -- Phosphor icon name (components/ui Icon set), never an emoji
  sort        int  not null default 100
);

insert into public.badge_catalog (code, kind, label, description, icon, sort) values
  ('first_win',     'fighter', 'First Blood',   'Won their first fight',                              'HandFist',      10),
  ('streak_3',      'fighter', 'Heating Up',    'Won 3 fights in a row',                              'Fire',          20),
  ('streak_5',      'fighter', 'Unstoppable',   'Won 5 fights in a row',                              'Lightning',     30),
  ('upset',         'fighter', 'Giant Killer',  'Beat an opponent rated 100+ Elo higher',             'TrendUp',       40),
  ('shutout',       'fighter', 'Shutout',       'Won without the opponent scoring a point',           'ShieldCheck',   50),
  ('iron_man',      'fighter', 'Iron Man',      'Fought 10 fights',                                   'Barbell',       60),
  ('belt_holder',   'fighter', 'Belt Holder',   'Held the title belt',                                'Crown',         70),
  ('sharp_eye',     'user',    'Sharp Eye',     'Picked the winner 5 fights in a row',                'Eye',           10),
  ('high_roller',   'user',    'Bold Pick',     'Won a pick of 400+ points',                          'Trophy',        20),
  ('perfect_night', 'user',    'Perfect Night', 'Picked every winner on a fight night (2+ fights)',   'Target',        30),
  ('comeback',      'user',    'Comeback Kid',  'Climbed from under 50 points back to 1000+',         'ArrowFatLinesUp', 40)
on conflict (code) do update
  set kind = excluded.kind, label = excluded.label, description = excluded.description,
      icon = excluded.icon, sort = excluded.sort;

-- One row per award. fight_id = the settled fight that earned it (null = admin
-- award, e.g. belt_holder via admin_award_belt). Reversed by admin_correct_result.
create table public.fighter_badges (
  id         bigserial primary key,
  fighter_id uuid not null references public.fighters (id) on delete cascade,
  code       text not null references public.badge_catalog (code),
  fight_id   uuid null references public.fights (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  unique nulls not distinct (fighter_id, code, fight_id)
);
create index fighter_badges_fight_idx on public.fighter_badges (fight_id) where fight_id is not null;

create table public.user_badges (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  code       text not null references public.badge_catalog (code),
  fight_id   uuid null references public.fights (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  unique nulls not distinct (user_id, code, fight_id)
);
create index user_badges_fight_idx on public.user_badges (fight_id) where fight_id is not null;

create or replace function private.award_fighter_badge(p_fighter uuid, p_code text, p_fight uuid, p_at timestamptz)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  insert into public.fighter_badges (fighter_id, code, fight_id, awarded_at)
  values (p_fighter, p_code, p_fight, coalesce(p_at, now()))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Fighter badges for one freshly settled fight (fighters already updated).
-- Exact-transition rules, so re-running is a no-op and history stays exact:
--   first_win  wins hit 1        streak_3 / streak_5  streak hit 3 / 5
--   upset      winner's elo_before <= loser's elo_before - 100
--   shutout    loser scored 0    iron_man  wins + losses hit 10 (both corners)
create or replace function private.award_fight_badges(p_fight_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_f      public.fights%rowtype;
  v_w      public.fighters%rowtype;
  v_l      public.fighters%rowtype;
  v_w_elo  int;
  v_l_elo  int;
  v_l_pts  int;
  v_out    jsonb := '[]'::jsonb;
begin
  select * into v_f from public.fights where id = p_fight_id;
  if not found or v_f.status <> 'settled' then return v_out; end if;

  select * into v_w from public.fighters
   where id = case when v_f.winner_side = 'red' then v_f.red_fighter_id else v_f.blue_fighter_id end;
  select * into v_l from public.fighters
   where id = case when v_f.winner_side = 'red' then v_f.blue_fighter_id else v_f.red_fighter_id end;
  v_w_elo := case when v_f.winner_side = 'red' then v_f.red_elo_before else v_f.blue_elo_before end;
  v_l_elo := case when v_f.winner_side = 'red' then v_f.blue_elo_before else v_f.red_elo_before end;
  v_l_pts := case when v_f.winner_side = 'red' then v_f.blue_score else v_f.red_score end;

  if v_w.wins = 1 and private.award_fighter_badge(v_w.id, 'first_win', p_fight_id, v_f.settled_at) > 0 then
    v_out := v_out || jsonb_build_object('fighter_id', v_w.id, 'code', 'first_win');
  end if;
  if v_w.streak = 3 and private.award_fighter_badge(v_w.id, 'streak_3', p_fight_id, v_f.settled_at) > 0 then
    v_out := v_out || jsonb_build_object('fighter_id', v_w.id, 'code', 'streak_3');
  end if;
  if v_w.streak = 5 and private.award_fighter_badge(v_w.id, 'streak_5', p_fight_id, v_f.settled_at) > 0 then
    v_out := v_out || jsonb_build_object('fighter_id', v_w.id, 'code', 'streak_5');
  end if;
  if v_w_elo <= v_l_elo - 100
     and private.award_fighter_badge(v_w.id, 'upset', p_fight_id, v_f.settled_at) > 0 then
    v_out := v_out || jsonb_build_object('fighter_id', v_w.id, 'code', 'upset');
  end if;
  if v_l_pts = 0 and private.award_fighter_badge(v_w.id, 'shutout', p_fight_id, v_f.settled_at) > 0 then
    v_out := v_out || jsonb_build_object('fighter_id', v_w.id, 'code', 'shutout');
  end if;
  if v_w.wins + v_w.losses = 10
     and private.award_fighter_badge(v_w.id, 'iron_man', p_fight_id, v_f.settled_at) > 0 then
    v_out := v_out || jsonb_build_object('fighter_id', v_w.id, 'code', 'iron_man');
  end if;
  if v_l.wins + v_l.losses = 10
     and private.award_fighter_badge(v_l.id, 'iron_man', p_fight_id, v_f.settled_at) > 0 then
    v_out := v_out || jsonb_build_object('fighter_id', v_l.id, 'code', 'iron_man');
  end if;
  return v_out;
end;
$$;

-- sharp_eye: the 5th correct pick of every run of consecutive correct picks
-- (over the user's non-participant votes on settled fights, by settled_at).
create or replace function private.sharp_eye_awards(p_user uuid)
returns table (fight_id uuid, awarded_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select z.fight_id, z.settled_at
    from (
      select y.*, row_number() over (partition by y.hit, y.grp order by y.rn) as pos
        from (
          select x.*, x.rn - row_number() over (partition by x.hit order by x.rn) as grp
            from (
              select v.fight_id, f.settled_at, (v.side = f.winner_side) as hit,
                     row_number() over (order by f.settled_at, f.id) as rn
                from public.votes v
                join public.fights f on f.id = v.fight_id
               where v.user_id = p_user and not v.is_participant and f.status = 'settled'
            ) x
        ) y
    ) z
   where z.hit and z.pos = 5;
$$;

create or replace function private.sync_sharp_eye(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.user_badges ub
   where ub.user_id = p_user and ub.code = 'sharp_eye'
     and (ub.fight_id is null
          or ub.fight_id not in (select s.fight_id from private.sharp_eye_awards(p_user) s));
  insert into public.user_badges (user_id, code, fight_id, awarded_at)
  select p_user, 'sharp_eye', s.fight_id, s.awarded_at from private.sharp_eye_awards(p_user) s
  on conflict do nothing;
end;
$$;

-- perfect_night: card is complete (no scheduled/open/locked fight left), has 2+
-- settled fights, and the user picked every winner (non-participant votes).
-- Credited to the card's last settled fight. Re-synced on every status change.
create or replace function private.perfect_night_awards(p_card date)
returns table (user_id uuid, fight_id uuid, awarded_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with card as (
    select count(*) filter (where f.status = 'settled') as n_settled,
           bool_or(f.status in ('scheduled', 'open', 'locked')) as pending
      from public.fights f where f.card_date = p_card
  ), last_fight as (
    select f.id, f.settled_at from public.fights f
     where f.card_date = p_card and f.status = 'settled'
     order by f.settled_at desc, f.id desc limit 1
  )
  select v.user_id, (select lf.id from last_fight lf), (select lf.settled_at from last_fight lf)
    from public.votes v
    join public.fights f on f.id = v.fight_id
   cross join card c
   where f.card_date = p_card and f.status = 'settled' and not v.is_participant
     and not c.pending and c.n_settled >= 2
   group by v.user_id, c.n_settled
  having count(*) filter (where v.side = f.winner_side) = c.n_settled;
$$;

create or replace function private.sync_perfect_night(p_card date)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.user_badges ub
   where ub.code = 'perfect_night'
     and ub.fight_id in (select f.id from public.fights f where f.card_date = p_card)
     and not exists (select 1 from private.perfect_night_awards(p_card) w
                      where w.user_id = ub.user_id and w.fight_id = ub.fight_id);
  insert into public.user_badges (user_id, code, fight_id, awarded_at)
  select w.user_id, 'perfect_night', w.fight_id, w.awarded_at from private.perfect_night_awards(p_card) w
  on conflict do nothing;
end;
$$;

-- comeback: at payout row p_ledger_id the balance is >= 1000, and since the
-- last time the balance was >= 1000 it dipped below 50. Credits that a
-- correction reversed (payout/refund + its payout_reversal) are ignored, so
-- re-settling a corrected fight gives the same answer as the first settle.
-- Reversals are matched over the WHOLE ledger (not only rows <= p_ledger_id):
-- a correction made later retroactively removes the credit from every later
-- payout's running balance, so prune_comeback can drop a comeback that only
-- existed because of a now-reversed payout (fix: stale comeback on a later fight).
create or replace function private.is_comeback(p_user uuid, p_ledger_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with raw as (
    select x.id, x.delta, x.reason, x.ref_id
      from public.points_ledger x
     where x.user_id = p_user
  ), rev as (
    select r.ref_id, count(*) as n from raw r where r.reason = 'payout_reversal' group by r.ref_id
  ), credits as (
    select r.id, r.ref_id, row_number() over (partition by r.ref_id order by r.id) as rn
      from raw r where r.reason in ('payout', 'refund') and r.ref_id in (select v.ref_id from rev v)
  ), l as (
    select r.id, sum(r.delta) over (order by r.id) as bal
      from raw r
     where r.reason <> 'payout_reversal'
       and not exists (select 1 from credits c join rev v on v.ref_id = c.ref_id
                        where c.id = r.id and c.rn <= v.n)
  )
  select coalesce((select l.bal >= 1000 from l where l.id = p_ledger_id), false)
     and exists (
       select 1 from l
        where l.id < p_ledger_id and l.bal < 50
          and l.id > coalesce((select max(l2.id) from l l2 where l2.id < p_ledger_id and l2.bal >= 1000), 0));
$$;

-- Drop every comeback badge of p_user whose fight no longer has a payout row
-- that passes is_comeback (called by admin_correct_result for each bettor whose
-- credit was reversed). Delete-only: a correction never hands out new badges.
create or replace function private.prune_comeback(p_user uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  delete from public.user_badges ub
   where ub.user_id = p_user and ub.code = 'comeback'
     and not exists (
       select 1
         from public.points_ledger l
         join public.bets b on b.id = l.ref_id
         join public.fights f on f.id = b.fight_id
        where l.user_id = p_user and l.reason = 'payout'
          and b.fight_id = ub.fight_id and b.status = 'won' and f.status = 'settled'
          and private.is_comeback(p_user, l.id));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- User badges for one freshly settled fight (bets + ledger already written).
create or replace function private.award_user_badges(p_fight_id uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_at timestamptz;
  v_n  int := 0;
  v_k  int;
  r    record;
begin
  select f.settled_at into v_at from public.fights f where f.id = p_fight_id and f.status = 'settled';
  if not found then return 0; end if;

  -- high_roller = a WON pick whose STAKE (bets.amount) was >= 400. Decision:
  -- CONTRACT B6 "won a bet >=400" read as the bet size, not the payout (a 200
  -- stake paying 600 does not qualify). Same rule in the backfill below.
  insert into public.user_badges (user_id, code, fight_id, awarded_at)
  select b.user_id, 'high_roller', p_fight_id, v_at
    from public.bets b
   where b.fight_id = p_fight_id and b.status = 'won' and b.amount >= 400
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  for r in
    select l.user_id, l.id from public.points_ledger l
     where l.reason = 'payout'
       and l.ref_id in (select b.id from public.bets b where b.fight_id = p_fight_id and b.status = 'won')
  loop
    if private.is_comeback(r.user_id, r.id) then
      insert into public.user_badges (user_id, code, fight_id, awarded_at)
      values (r.user_id, 'comeback', p_fight_id, v_at)
      on conflict do nothing;
      get diagnostics v_k = row_count;
      v_n := v_n + v_k;
    end if;
  end loop;

  for r in select v.user_id from public.votes v where v.fight_id = p_fight_id and not v.is_participant loop
    perform private.sync_sharp_eye(r.user_id);
  end loop;
  return v_n;
end;
$$;

-- Keep perfect_night right on settle, correct (unsettle) and cancel/decline.
create or replace function private.fights_badge_sync()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sync_perfect_night(new.card_date);
  return null;
end;
$$;

drop trigger if exists fights_badge_sync on public.fights;
create trigger fights_badge_sync
  after update of status on public.fights
  for each row
  when ((old.status = 'settled') is distinct from (new.status = 'settled')
        or (new.status = 'cancelled' and old.status is distinct from 'cancelled'))
  execute function private.fights_badge_sync();

-- ===========================================================================
-- B4. Live scores
-- ===========================================================================
create table public.live_scores (
  fight_id            uuid primary key references public.fights (id) on delete cascade,
  round               int  not null default 1 check (round between 1 and 20),
  red_score           int  not null default 0 check (red_score between 0 and 999),
  blue_score          int  not null default 0 check (blue_score between 0 and 999),
  round_started_at    timestamptz null,   -- start of the current running segment (null when paused)
  accumulated_seconds int  not null default 0 check (accumulated_seconds >= 0),  -- elapsed before that segment
  round_seconds       int  not null default 120 check (round_seconds between 10 and 1800),
  running             boolean not null default false,
  updated_at          timestamptz not null default now(),
  updated_by          uuid null references public.profiles (id) on delete set null,
  check (running = (round_started_at is not null))
);

create or replace view public.live_score_state with (security_invoker = on) as
  select s.fight_id, s.round, s.red_score, s.blue_score, s.running, s.round_seconds,
         e.elapsed as elapsed_seconds,
         greatest(0, s.round_seconds - e.elapsed)::int as remaining_seconds,
         (e.elapsed >= s.round_seconds) as time_up,
         s.round_started_at, s.accumulated_seconds, s.updated_at, s.updated_by,
         (s.running or s.updated_at > now() - interval '10 minutes') as is_live,
         now() as server_now
    from public.live_scores s
    cross join lateral (
      select least(s.round_seconds,
                   s.accumulated_seconds
                   + case when s.running
                          then greatest(0, floor(extract(epoch from (now() - s.round_started_at))))::int
                          else 0 end)::int as elapsed
    ) e;

create or replace function public.get_live_score(p_fight_id uuid)
returns table (fight_id uuid, round int, red_score int, blue_score int, running boolean, round_seconds int,
               elapsed_seconds int, remaining_seconds int, time_up boolean, round_started_at timestamptz,
               accumulated_seconds int, updated_at timestamptz, updated_by uuid, is_live boolean,
               server_now timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_member();
  return query
    select l.fight_id, l.round, l.red_score, l.blue_score, l.running, l.round_seconds,
           l.elapsed_seconds, l.remaining_seconds, l.time_up, l.round_started_at,
           l.accumulated_seconds, l.updated_at, l.updated_by, l.is_live, l.server_now
      from public.live_score_state l
     where l.fight_id = p_fight_id;
end;
$$;

-- actions: start | pause | next_round | red_add | blue_add | set_round_seconds | reset
create or replace function public.admin_live_update(p_fight_id uuid, p_action text, p_value int default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := private.require_referee();
  v_action  text := lower(btrim(coalesce(p_action, '')));
  v_f       public.fights%rowtype;
  v_s       public.live_scores%rowtype;
  v_elapsed int;
  v_out     jsonb;
begin
  if v_action not in ('start', 'pause', 'next_round', 'red_add', 'blue_add', 'set_round_seconds', 'reset') then
    raise exception 'INVALID_ACTION';
  end if;
  if v_action in ('red_add', 'blue_add')
     and (p_value is null or p_value = 0 or p_value not between -20 and 20) then
    raise exception 'INVALID_VALUE';
  end if;
  if v_action = 'set_round_seconds' and (p_value is null or p_value not between 10 and 1800) then
    raise exception 'INVALID_VALUE';
  end if;

  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status = 'settled' then raise exception 'ALREADY_SETTLED'; end if;
  if v_f.status = 'cancelled' then raise exception 'FIGHT_CANCELLED'; end if;
  if private.is_or_was_linked(v_uid, v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;
  if exists (
    select 1 from public.bets bb
     where bb.fight_id = p_fight_id and bb.user_id = v_uid and bb.status = 'active'
  ) then
    raise exception 'ADMIN_HAS_BET';
  end if;
  if v_f.status = 'open' and now() >= v_f.lock_at then
    update public.fights set status = 'locked' where id = p_fight_id;
    perform private.log(v_uid, 'fight_lock', p_fight_id, jsonb_build_object('auto', true, 'via', 'live_update'));
  elsif v_f.status <> 'locked' then
    raise exception 'FIGHT_NOT_LOCKED';
  end if;

  insert into public.live_scores (fight_id, updated_by) values (p_fight_id, v_uid) on conflict do nothing;
  select * into v_s from public.live_scores where fight_id = p_fight_id for update;

  v_elapsed := least(v_s.round_seconds, v_s.accumulated_seconds
                 + case when v_s.running
                        then greatest(0, floor(extract(epoch from (now() - v_s.round_started_at))))::int
                        else 0 end);

  if v_action = 'start' then
    if not v_s.running then
      if v_elapsed >= v_s.round_seconds then raise exception 'ROUND_OVER'; end if;
      v_s.running := true;
      v_s.round_started_at := now();
    end if;
  elsif v_action = 'pause' then
    if v_s.running then
      v_s.accumulated_seconds := v_elapsed;
      v_s.running := false;
      v_s.round_started_at := null;
    end if;
  elsif v_action = 'next_round' then
    if v_s.round >= 20 then raise exception 'INVALID_ROUNDS'; end if;
    v_s.round := v_s.round + 1;
    v_s.accumulated_seconds := 0;
    v_s.running := false;
    v_s.round_started_at := null;
  elsif v_action in ('red_add', 'blue_add') then
    if v_action = 'red_add' then
      if v_s.red_score + p_value not between 0 and 999 then raise exception 'INVALID_SCORE'; end if;
      v_s.red_score := v_s.red_score + p_value;
    else
      if v_s.blue_score + p_value not between 0 and 999 then raise exception 'INVALID_SCORE'; end if;
      v_s.blue_score := v_s.blue_score + p_value;
    end if;
  elsif v_action = 'set_round_seconds' then
    -- keep the elapsed time; a running clock restarts its segment at now()
    v_s.round_seconds := p_value;
    v_s.accumulated_seconds := least(v_elapsed, p_value);
    if v_s.running then v_s.round_started_at := now(); end if;
  elsif v_action = 'reset' then
    v_s.round := 1;
    v_s.red_score := 0;
    v_s.blue_score := 0;
    v_s.accumulated_seconds := 0;
    v_s.running := false;
    v_s.round_started_at := null;
  end if;

  update public.live_scores
     set round = v_s.round, red_score = v_s.red_score, blue_score = v_s.blue_score,
         round_started_at = v_s.round_started_at, accumulated_seconds = v_s.accumulated_seconds,
         round_seconds = v_s.round_seconds, running = v_s.running,
         updated_at = now(), updated_by = v_uid
   where fight_id = p_fight_id;

  select to_jsonb(l) into v_out from public.live_score_state l where l.fight_id = p_fight_id;

  perform private.log(v_uid, 'live_update', p_fight_id, jsonb_build_object(
    'action', v_action, 'value', p_value, 'round', v_s.round,
    'red_score', v_s.red_score, 'blue_score', v_s.blue_score, 'running', v_s.running));
  return v_out;
end;
$$;

-- ===========================================================================
-- B7. Seasons
-- ===========================================================================
create table public.seasons (
  id                  serial primary key,
  name                text not null check (char_length(btrim(name)) between 1 and 40),
  started_at          timestamptz not null default now(),
  ended_at            timestamptz null,
  champion_fighter_id uuid null references public.fighters (id) on delete set null,
  top_bettor_user_id  uuid null references public.profiles (id) on delete set null,
  snapshot            jsonb null,
  ended_by            uuid null references public.profiles (id) on delete set null,
  check (ended_at is null or ended_at >= started_at)
);
create unique index seasons_one_current on public.seasons ((true)) where ended_at is null;

-- Season 1 covers every fight so far (so existing results stay correctable).
insert into public.seasons (name, started_at)
select 'Season 1', least(now(), coalesce((select min(f.created_at) from public.fights f), now()))
 where not exists (select 1 from public.seasons);

create or replace function public.admin_end_season(p_confirm text, p_name_next text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := private.require_admin();
  v_name       text := btrim(coalesce(p_name_next, ''));
  v_now        timestamptz;
  v_season     public.seasons%rowtype;
  v_next_id    int;
  v_champ      uuid;
  v_champ_src  text;
  v_top        uuid;
  v_fighters   jsonb;
  v_bettors    jsonb;
  v_snapshot   jsonb;
  v_users      int;
  v_delta      bigint;
begin
  if p_confirm is distinct from 'END SEASON' then raise exception 'CONFIRM_REQUIRED'; end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'INVALID_NAME'; end if;

  perform private.lock_belt();
  select * into v_season from public.seasons where ended_at is null for update;
  if not found then raise exception 'NO_SEASON'; end if;
  if exists (select 1 from public.fights f where f.status in ('open', 'locked')) then
    raise exception 'FIGHTS_IN_PROGRESS';
  end if;

  perform 1 from public.fighters order by id for update;
  -- lock every profile: inactive members are reset too, so a later reactivation
  -- can't carry last season's balance into the new one
  perform 1 from public.profiles order by id for update;
  v_now := clock_timestamp();

  -- champion: belt holder, else top Elo among fighters who fought this season
  v_champ := private.current_champion_id();
  if v_champ is not null then
    v_champ_src := 'belt';
  else
    select f.id into v_champ from public.fighters f
     where not f.hidden and f.season_wins + f.season_losses > 0
     order by f.elo desc, f.season_wins desc, f.nickname
     limit 1;
    if v_champ is not null then v_champ_src := 'elo'; end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'fighter_id', x.id, 'nickname', x.nickname, 'elo', x.elo,
           'season_wins', x.season_wins, 'season_losses', x.season_losses,
           'wins', x.wins, 'losses', x.losses, 'streak', x.streak,
           'is_champion', x.id = v_champ and v_champ_src = 'belt',
           'rank', x.rnk) order by x.rnk nulls last, x.nickname), '[]'::jsonb)
    into v_fighters
    from (
      select f.*, case when f.season_wins + f.season_losses > 0
                       then rank() over (partition by f.season_wins + f.season_losses > 0 order by f.elo desc)
                  end::int as rnk
        from public.fighters f
       where not f.hidden
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', b.id, 'username', b.username, 'display_name', b.display_name,
           'balance', b.bal, 'rank', b.rnk) order by b.rnk, b.display_name), '[]'::jsonb),
         (array_agg(b.id order by b.bal desc, b.display_name, b.id))[1]
    into v_bettors, v_top
    from (
      select p.id, p.username::text as username, p.display_name, coalesce(sum(l.delta), 0)::int as bal,
             rank() over (order by coalesce(sum(l.delta), 0) desc)::int as rnk
        from public.profiles p
        left join public.points_ledger l on l.user_id = p.id
       where p.active
       group by p.id, p.username, p.display_name
    ) b;

  v_snapshot := jsonb_build_object(
    'season', jsonb_build_object('id', v_season.id, 'name', v_season.name,
                                 'started_at', v_season.started_at, 'ended_at', v_now),
    'champion', case when v_champ is null then null else (
      select jsonb_build_object('fighter_id', f.id, 'nickname', f.nickname, 'source', v_champ_src, 'elo', f.elo,
                                'season_wins', f.season_wins, 'season_losses', f.season_losses)
        from public.fighters f where f.id = v_champ) end,
    'top_bettor', case when v_top is null then null else (
      select e from jsonb_array_elements(v_bettors) e where e ->> 'user_id' = v_top::text) end,
    'fighters', v_fighters,
    'bettors', v_bettors);

  update public.seasons
     set ended_at = v_now, champion_fighter_id = v_champ, top_bettor_user_id = v_top,
         snapshot = v_snapshot, ended_by = v_uid
   where id = v_season.id;

  -- points: every balance (active or not) back to exactly 1000, one ledger row each.
  -- The snapshot above stays active-only; the reset must not, or deactivate ->
  -- reset -> reactivate would keep a member's old balance (and rank 1).
  with ins as (
    insert into public.points_ledger (user_id, delta, reason, note)
    select b.id, 1000 - b.bal, 'season_reset', 'Season reset: ' || v_season.name
      from (
        select p.id, coalesce(sum(l.delta), 0)::int as bal
          from public.profiles p
          left join public.points_ledger l on l.user_id = p.id
         group by p.id
      ) b
     where b.bal <> 1000
    returning delta
  )
  select count(*)::int, coalesce(sum(ins.delta), 0) into v_users, v_delta from ins;

  update public.fighters set elo = 1000, season_wins = 0, season_losses = 0
   where elo <> 1000 or season_wins <> 0 or season_losses <> 0;

  insert into public.seasons (name, started_at) values (v_name, clock_timestamp()) returning id into v_next_id;

  perform private.log(v_uid, 'season_end', null, jsonb_build_object(
    'season_id', v_season.id, 'season_name', v_season.name, 'next_season_id', v_next_id,
    'next_season_name', v_name, 'champion_fighter_id', v_champ, 'champion_source', v_champ_src,
    'top_bettor_user_id', v_top, 'members_reset', v_users, 'points_delta', v_delta));

  return jsonb_build_object(
    'ended_season_id', v_season.id, 'ended_season_name', v_season.name,
    'next_season_id', v_next_id, 'next_season_name', v_name,
    'champion_fighter_id', v_champ, 'champion_source', v_champ_src,
    'top_bettor_user_id', v_top, 'members_reset', v_users, 'points_delta', v_delta);
end;
$$;

-- ===========================================================================
-- B5. Admin: award / vacate the belt
-- ===========================================================================
create or replace function public.admin_award_belt(p_fighter_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_admin();
  v_note  text := nullif(btrim(p_note), '');
  v_cur   public.belt_reigns%rowtype;
  v_now   timestamptz;
  v_id    uuid;
begin
  if char_length(v_note) > 200 then raise exception 'INVALID_NOTE'; end if;

  perform private.lock_belt();
  select * into v_cur from public.belt_reigns where ended_at is null for update;

  if p_fighter_id is null then
    if v_cur.id is null then raise exception 'NO_CHAMPION'; end if;
  else
    if not exists (select 1 from public.fighters where id = p_fighter_id) then
      raise exception 'FIGHTER_NOT_FOUND';
    end if;
    if v_cur.fighter_id = p_fighter_id then raise exception 'ALREADY_CHAMPION'; end if;
  end if;
  -- an admin can't hand the belt to (or take it from) their own fighter
  if private.is_or_was_linked(v_uid, coalesce(p_fighter_id, v_cur.fighter_id), coalesce(v_cur.fighter_id, p_fighter_id)) then
    raise exception 'PARTICIPANT';
  end if;

  v_now := clock_timestamp();
  if v_cur.id is not null then
    update public.belt_reigns
       set ended_at = v_now, end_reason = case when p_fighter_id is null then 'vacated' else 'reassigned' end
     where id = v_cur.id;
  end if;

  if p_fighter_id is not null then
    insert into public.belt_reigns (fighter_id, started_at, note, awarded_by)
    values (p_fighter_id, v_now, v_note, v_uid)
    returning id into v_id;
    perform private.award_fighter_badge(p_fighter_id, 'belt_holder', null, v_now);
  end if;

  perform private.refresh_title_flags();

  perform private.log(v_uid, case when p_fighter_id is null then 'belt_vacate' else 'belt_award' end,
                      p_fighter_id, jsonb_build_object('note', v_note, 'reign_id', v_id,
                                                       'prev_fighter_id', v_cur.fighter_id, 'prev_reign_id', v_cur.id));
  return jsonb_build_object('reign_id', v_id, 'fighter_id', p_fighter_id,
                            'prev_fighter_id', v_cur.fighter_id, 'prev_reign_id', v_cur.id);
end;
$$;

-- ===========================================================================
-- Admin: settle (A + B5 belt + B6 badges + B7 season counters)
-- Signature unchanged; result gains is_title_fight, belt, fighter_badges, user_badges.
-- ===========================================================================
create or replace function public.admin_settle_fight(
  p_fight_id uuid, p_winner_side text, p_method text, p_note text,
  p_rounds int, p_red_score int, p_blue_score int, p_finish_move text default null,
  p_red_weight_kg numeric default null, p_blue_weight_kg numeric default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := private.require_admin();
  v_f          public.fights%rowtype;
  v_red        public.fighters%rowtype;
  v_blue       public.fighters%rowtype;
  v_exp_red    numeric;
  v_delta      int;      -- applied to red; blue gets -v_delta
  v_total      bigint;
  v_win_pool   bigint;
  v_paid       bigint := 0;
  v_dust       int := 0;
  v_top        uuid;
  v_refunded   int := 0;
  v_winners    int := 0;
  b            record;
  v_payout     int;
  v_note       text := nullif(btrim(p_note), '');
  v_move       text := nullif(btrim(p_finish_move), '');
  v_now        timestamptz;
  v_champ      uuid;
  v_title      boolean;
  v_winner_id  uuid;
  v_loser_id   uuid;
  v_belt       text := 'none';
  v_fbadges    jsonb := '[]'::jsonb;
  v_ubadges    int := 0;
begin
  if p_winner_side is null or p_winner_side not in ('red', 'blue') then
    raise exception 'INVALID_SIDE';
  end if;
  if p_method is null or p_method not in ('pin', 'submission', 'decision') then
    raise exception 'INVALID_METHOD';
  end if;
  if p_rounds is null or p_rounds < 1 or p_rounds > 20 then
    raise exception 'INVALID_ROUNDS';
  end if;
  if p_red_score is null or p_blue_score is null or p_red_score < 0 or p_blue_score < 0 then
    raise exception 'INVALID_SCORE';
  end if;
  if p_method = 'decision' and (
       (p_winner_side = 'red'  and p_red_score  <= p_blue_score) or
       (p_winner_side = 'blue' and p_blue_score <= p_red_score)) then
    raise exception 'SCORE_MISMATCH';
  end if;
  if char_length(v_note) > 200 then raise exception 'INVALID_NOTE'; end if;
  if char_length(v_move) > 60 then raise exception 'INVALID_FINISH_MOVE'; end if;
  perform private.check_weight(p_red_weight_kg);
  perform private.check_weight(p_blue_weight_kg);

  perform private.lock_belt();
  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status = 'settled' then raise exception 'ALREADY_SETTLED'; end if;
  if v_f.status = 'cancelled' then raise exception 'FIGHT_CANCELLED'; end if;
  if v_f.status = 'scheduled' then raise exception 'FIGHT_NOT_OPEN'; end if;

  if private.is_or_was_linked(v_uid, v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;
  if exists (
    select 1 from public.bets bb
    where bb.fight_id = p_fight_id and bb.user_id = v_uid and bb.status = 'active'
  ) then
    raise exception 'ADMIN_HAS_BET';
  end if;

  -- ---- Elo / record --------------------------------------------------------
  perform 1 from public.fighters
   where id in (v_f.red_fighter_id, v_f.blue_fighter_id)
   order by id
     for update;
  select * into v_red  from public.fighters where id = v_f.red_fighter_id;
  select * into v_blue from public.fighters where id = v_f.blue_fighter_id;

  v_exp_red := 1 / (1 + power(10::numeric, (v_blue.elo - v_red.elo)::numeric / 400));
  v_delta := round(32 * ((case when p_winner_side = 'red' then 1 else 0 end) - v_exp_red))::int;

  update public.fighters
     set elo           = elo + v_delta,
         wins          = wins          + case when p_winner_side = 'red' then 1 else 0 end,
         losses        = losses        + case when p_winner_side = 'red' then 0 else 1 end,
         season_wins   = season_wins   + case when p_winner_side = 'red' then 1 else 0 end,
         season_losses = season_losses + case when p_winner_side = 'red' then 0 else 1 end,
         streak = case when p_winner_side = 'red'
                       then case when streak > 0 then streak + 1 else 1 end
                       else case when streak < 0 then streak - 1 else -1 end end
   where id = v_red.id;

  update public.fighters
     set elo           = elo - v_delta,
         wins          = wins          + case when p_winner_side = 'blue' then 1 else 0 end,
         losses        = losses        + case when p_winner_side = 'blue' then 0 else 1 end,
         season_wins   = season_wins   + case when p_winner_side = 'blue' then 1 else 0 end,
         season_losses = season_losses + case when p_winner_side = 'blue' then 0 else 1 end,
         streak = case when p_winner_side = 'blue'
                       then case when streak > 0 then streak + 1 else 1 end
                       else case when streak < 0 then streak - 1 else -1 end end
   where id = v_blue.id;

  -- ---- Pari-mutuel settlement ---------------------------------------------
  perform 1 from public.bets where fight_id = p_fight_id and status = 'active' for update;

  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where side = p_winner_side), 0)
    into v_total, v_win_pool
    from public.bets
   where fight_id = p_fight_id and status = 'active';

  if v_win_pool = 0 then
    v_refunded := private.refund_active_bets(p_fight_id, 'No winning picks: refund');
  else
    for b in
      select * from public.bets
       where fight_id = p_fight_id and status = 'active' and side = p_winner_side
       order by amount desc, created_at asc, id asc
    loop
      if v_top is null then v_top := b.id; end if;  -- largest stake, earliest on tie
      v_payout := floor(b.amount::bigint * v_total / v_win_pool)::int;
      v_paid := v_paid + v_payout;
      update public.bets set status = 'won', payout = v_payout where id = b.id;
      v_winners := v_winners + 1;
    end loop;

    v_dust := (v_total - v_paid)::int;
    if v_dust > 0 then
      update public.bets set payout = payout + v_dust where id = v_top;
    end if;

    insert into public.points_ledger (user_id, delta, reason, ref_id, note)
    select bb.user_id, bb.payout, 'payout', bb.id, 'Fight payout'
      from public.bets bb
     where bb.fight_id = p_fight_id and bb.status = 'won' and bb.payout > 0;

    update public.bets set status = 'lost', payout = 0
     where fight_id = p_fight_id and status = 'active' and side <> p_winner_side;
  end if;

  -- ---- Belt (B5): ANY settled loss by the champion moves the belt ----------
  v_now := clock_timestamp();
  v_champ := private.current_champion_id();
  v_title := coalesce(v_champ in (v_f.red_fighter_id, v_f.blue_fighter_id), false);
  v_winner_id := case when p_winner_side = 'red' then v_f.red_fighter_id else v_f.blue_fighter_id end;
  v_loser_id  := case when p_winner_side = 'red' then v_f.blue_fighter_id else v_f.red_fighter_id end;

  update public.fights
     set status          = 'settled',
         winner_side     = p_winner_side,
         method          = p_method,
         result_note     = v_note,
         rounds          = p_rounds,
         red_score       = p_red_score,
         blue_score      = p_blue_score,
         finish_move     = v_move,
         red_weight_kg   = coalesce(p_red_weight_kg, red_weight_kg),
         blue_weight_kg  = coalesce(p_blue_weight_kg, blue_weight_kg),
         recorded_by     = v_uid,
         settled_at      = v_now,   -- clock_timestamp(): strictly ordered, even within one transaction
         red_elo_before  = v_red.elo,
         blue_elo_before = v_blue.elo,
         elo_delta       = v_delta,
         is_title_fight  = v_title
   where id = p_fight_id;

  if v_title and v_champ = v_loser_id then
    update public.belt_reigns
       set ended_at = v_now, end_reason = 'lost', lost_fight_id = p_fight_id
     where ended_at is null;
    insert into public.belt_reigns (fighter_id, won_fight_id, started_at, awarded_by)
    values (v_winner_id, p_fight_id, v_now, v_uid);
    if private.award_fighter_badge(v_winner_id, 'belt_holder', p_fight_id, v_now) > 0 then
      v_fbadges := v_fbadges || jsonb_build_object('fighter_id', v_winner_id, 'code', 'belt_holder');
    end if;
    v_belt := 'changed';
    perform private.refresh_title_flags();
  elsif v_title then
    v_belt := 'defended';
  end if;

  -- ---- Badges (B6) ---------------------------------------------------------
  v_fbadges := v_fbadges || private.award_fight_badges(p_fight_id);
  v_ubadges := private.award_user_badges(p_fight_id);

  perform private.log(v_uid, 'fight_settle', p_fight_id, jsonb_build_object(
    'winner_side', p_winner_side, 'method', p_method, 'rounds', p_rounds,
    'red_score', p_red_score, 'blue_score', p_blue_score, 'finish_move', v_move,
    'total_pool', v_total, 'winning_pool', v_win_pool, 'dust', v_dust,
    'elo_delta', v_delta, 'refunded', v_refunded,
    'is_title_fight', v_title, 'belt', v_belt, 'fighter_badges', v_fbadges));

  return jsonb_build_object(
    'fight_id', p_fight_id,
    'winner_side', p_winner_side,
    'method', p_method,
    'rounds', p_rounds,
    'red_score', p_red_score,
    'blue_score', p_blue_score,
    'total_pool', v_total,
    'winning_pool', v_win_pool,
    'winners', v_winners,
    'dust', v_dust,
    'refunded', v_refunded,
    'elo_delta', v_delta,
    'red_elo_before', v_red.elo,
    'blue_elo_before', v_blue.elo,
    'is_title_fight', v_title,
    'belt', v_belt,
    'fighter_badges', v_fbadges,
    'user_badges', v_ubadges);
end;
$$;

-- ===========================================================================
-- B1 (extended). Correct / undo a settled result: + belt, badges, season counters
-- ===========================================================================
create or replace function public.admin_correct_result(p_fight_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := private.require_admin();
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_f          public.fights%rowtype;
  b            record;
  v_reversed   bigint := 0;
  v_restored   int := 0;
  v_red_elo    int;
  v_blue_elo   int;
  v_won_reign  public.belt_reigns%rowtype;
  v_belt       boolean := false;
  v_fb         int;
  v_ub         int;
  v_voters     uuid[];
  v_bettors    uuid[] := '{}';
begin
  if char_length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 200 then raise exception 'INVALID_NOTE'; end if;

  perform private.lock_belt();
  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status <> 'settled' then raise exception 'NOT_SETTLED'; end if;

  if private.is_or_was_linked(v_uid, v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;
  if exists (
    select 1 from public.bets bb
     where bb.fight_id = p_fight_id and bb.user_id = v_uid and bb.status <> 'cancelled'
  ) then
    raise exception 'ADMIN_HAS_BET';
  end if;

  -- A season reset (Elo + points) happened after this result: it is final.
  if v_f.settled_at < (select s.started_at from public.seasons s where s.ended_at is null) then
    raise exception 'SEASON_CLOSED';
  end if;

  -- Lock both fighters (id order, same as admin_settle_fight) BEFORE the
  -- LATER_FIGHT_EXISTS check (see wave A).
  perform 1 from public.fighters
   where id in (v_f.red_fighter_id, v_f.blue_fighter_id)
   order by id
     for update;

  if exists (
    select 1 from public.fights o
     where o.id <> v_f.id and o.status = 'settled'
       and o.settled_at >= v_f.settled_at
       and (o.red_fighter_id  in (v_f.red_fighter_id, v_f.blue_fighter_id)
         or o.blue_fighter_id in (v_f.red_fighter_id, v_f.blue_fighter_id))
  ) then
    raise exception 'LATER_FIGHT_EXISTS';
  end if;

  -- ---- Belt: undo a transfer made by this fight ----------------------------
  select * into v_won_reign from public.belt_reigns where won_fight_id = p_fight_id for update;
  if found then
    if v_won_reign.ended_at is not null
       or exists (select 1 from public.belt_reigns r where r.started_at > v_won_reign.started_at) then
      raise exception 'BELT_CHANGED';
    end if;
    delete from public.belt_reigns where id = v_won_reign.id;
    update public.belt_reigns
       set ended_at = null, end_reason = null, lost_fight_id = null
     where lost_fight_id = p_fight_id;
    v_belt := true;
  end if;

  -- ---- Points: reverse every credit of the settle, put stakes back in play ---
  for b in
    select * from public.bets
     where fight_id = p_fight_id and status in ('won', 'lost', 'refunded')
     order by created_at, id
     for update
  loop
    if b.status in ('won', 'refunded') and coalesce(b.payout, 0) > 0 then
      insert into public.points_ledger (user_id, delta, reason, ref_id, note)
      values (b.user_id, -b.payout, 'payout_reversal', b.id, 'Result corrected: ' || v_reason);
      v_reversed := v_reversed + b.payout;
    end if;
    update public.bets set status = 'active', payout = null where id = b.id;
    v_restored := v_restored + 1;
    if not b.user_id = any (v_bettors) then v_bettors := v_bettors || b.user_id; end if;
  end loop;

  -- ---- Fight back to locked (trigger re-syncs perfect_night for the card) ---
  update public.fights
     set status = 'locked', winner_side = null, method = null, result_note = null,
         rounds = null, red_score = null, blue_score = null, finish_move = null,
         recorded_by = null, settled_at = null,
         red_elo_before = null, blue_elo_before = null, elo_delta = null
   where id = p_fight_id;

  update public.fighters
     set elo           = v_f.red_elo_before,
         wins          = greatest(0, wins          - case when v_f.winner_side = 'red' then 1 else 0 end),
         losses        = greatest(0, losses        - case when v_f.winner_side = 'red' then 0 else 1 end),
         season_wins   = greatest(0, season_wins   - case when v_f.winner_side = 'red' then 1 else 0 end),
         season_losses = greatest(0, season_losses - case when v_f.winner_side = 'red' then 0 else 1 end),
         streak = private.compute_streak(v_f.red_fighter_id)
   where id = v_f.red_fighter_id
  returning elo into v_red_elo;

  update public.fighters
     set elo           = v_f.blue_elo_before,
         wins          = greatest(0, wins          - case when v_f.winner_side = 'blue' then 1 else 0 end),
         losses        = greatest(0, losses        - case when v_f.winner_side = 'blue' then 0 else 1 end),
         season_wins   = greatest(0, season_wins   - case when v_f.winner_side = 'blue' then 1 else 0 end),
         season_losses = greatest(0, season_losses - case when v_f.winner_side = 'blue' then 0 else 1 end),
         streak = private.compute_streak(v_f.blue_fighter_id)
   where id = v_f.blue_fighter_id
  returning elo into v_blue_elo;

  -- ---- Badges earned by this fight -----------------------------------------
  delete from public.fighter_badges where fight_id = p_fight_id;
  get diagnostics v_fb = row_count;
  delete from public.user_badges where fight_id = p_fight_id and code <> 'perfect_night';
  get diagnostics v_ub = row_count;
  select coalesce(array_agg(v.user_id), '{}') into v_voters
    from public.votes v where v.fight_id = p_fight_id and not v.is_participant;
  perform private.sync_sharp_eye(u) from unnest(v_voters) u;
  -- comeback badges on LATER fights that relied on a credit reversed above
  select v_ub + coalesce(sum(private.prune_comeback(u)), 0) into v_ub from unnest(v_bettors) u;

  perform private.refresh_title_flags();

  perform private.log(v_uid, 'fight_correct', p_fight_id, jsonb_build_object(
    'reason', v_reason,
    'prev', jsonb_build_object(
      'winner_side', v_f.winner_side, 'method', v_f.method, 'rounds', v_f.rounds,
      'red_score', v_f.red_score, 'blue_score', v_f.blue_score, 'finish_move', v_f.finish_move,
      'elo_delta', v_f.elo_delta, 'recorded_by', v_f.recorded_by, 'settled_at', v_f.settled_at,
      'is_title_fight', v_f.is_title_fight),
    'reversed_payouts', v_reversed, 'bets_restored', v_restored,
    'belt_restored', v_belt, 'fighter_badges_removed', v_fb, 'user_badges_removed', v_ub));

  return jsonb_build_object(
    'fight_id', p_fight_id,
    'status', 'locked',
    'reversed_payouts', v_reversed,
    'bets_restored', v_restored,
    'red_elo', v_red_elo,
    'blue_elo', v_blue_elo,
    'belt_restored', v_belt,
    'fighter_badges_removed', v_fb,
    'user_badges_removed', v_ub);
end;
$$;

-- ===========================================================================
-- Read helpers / views
-- ===========================================================================
create or replace function public.list_badges(p_kind text, p_id uuid)
returns table (code text, label text, description text, icon text, times int,
               first_awarded_at timestamptz, last_awarded_at timestamptz, last_fight_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_member();
  if p_kind is null or p_kind not in ('fighter', 'user') then raise exception 'INVALID_KIND'; end if;

  if p_kind = 'fighter' then
    if not public.is_admin() and exists (select 1 from public.fighters f where f.id = p_id and f.hidden) then
      return;
    end if;
    return query
      select c.code, c.label, c.description, c.icon, count(*)::int,
             min(b.awarded_at), max(b.awarded_at),
             (array_agg(b.fight_id order by b.awarded_at desc, b.id desc))[1]
        from public.fighter_badges b
        join public.badge_catalog c on c.code = b.code
       where b.fighter_id = p_id
       group by c.code, c.label, c.description, c.icon, c.sort
       order by c.sort, c.code;
  else
    return query
      select c.code, c.label, c.description, c.icon, count(*)::int,
             min(b.awarded_at), max(b.awarded_at),
             (array_agg(b.fight_id order by b.awarded_at desc, b.id desc))[1]
        from public.user_badges b
        join public.badge_catalog c on c.code = b.code
       where b.user_id = p_id
       group by c.code, c.label, c.description, c.icon, c.sort
       order by c.sort, c.code;
  end if;
end;
$$;

-- Defenses = fights the holder won during the reign (any fight with the champ
-- is a title fight; the fight that won the belt is not a defense).
create or replace view public.belt_reign_history with (security_invoker = on) as
  select r.id as reign_id, r.fighter_id, f.nickname, r.started_at, r.ended_at, r.end_reason,
         r.won_fight_id, r.lost_fight_id, r.note,
         (select count(*) from public.fights x
           where x.status = 'settled'
             and x.settled_at > r.started_at
             and x.settled_at < coalesce(r.ended_at, 'infinity'::timestamptz)
             and x.id is distinct from r.won_fight_id
             and ((x.winner_side = 'red'  and x.red_fighter_id  = r.fighter_id)
               or (x.winner_side = 'blue' and x.blue_fighter_id = r.fighter_id)))::int as defenses,
         (r.ended_at is null) as is_current
    from public.belt_reigns r
    join public.fighters f on f.id = r.fighter_id;

create or replace view public.current_champion with (security_invoker = on) as
  select h.fighter_id, h.nickname, h.started_at as since, h.defenses, h.reign_id, h.won_fight_id
    from public.belt_reign_history h
   where h.is_current;

-- fighter_rankings: existing columns unchanged; season_* and is_champion appended.
create or replace view public.fighter_rankings with (security_invoker = on) as
  select x.fighter_id, x.nickname, x.elo, x.wins, x.losses, x.streak, x.fights,
         x.fights >= 3 as ranked,
         case when x.fights >= 3
              then (rank() over (partition by x.fights >= 3 order by x.elo desc))::int end as rank,
         coalesce(s.total_rounds, 0)::int      as total_rounds,
         coalesce(s.points_for, 0)::int        as points_for,
         coalesce(s.points_against, 0)::int    as points_against,
         coalesce(s.wins_pin, 0)::int          as wins_pin,
         coalesce(s.wins_submission, 0)::int   as wins_submission,
         coalesce(s.wins_decision, 0)::int     as wins_decision,
         coalesce(s.losses_pin, 0)::int        as losses_pin,
         coalesce(s.losses_submission, 0)::int as losses_submission,
         coalesce(s.losses_decision, 0)::int   as losses_decision,
         x.weight_kg,
         x.season_wins,
         x.season_losses,
         x.season_fights,
         x.season_fights >= 1 as season_ranked,
         case when x.season_fights >= 1
              then (rank() over (partition by x.season_fights >= 1 order by x.elo desc))::int end as season_rank,
         exists (select 1 from public.belt_reigns r where r.ended_at is null and r.fighter_id = x.fighter_id)
           as is_champion
    from (
      select f.id as fighter_id, f.nickname, f.elo, f.wins, f.losses, f.streak,
             (f.wins + f.losses) as fights, f.weight_kg,
             f.season_wins, f.season_losses, (f.season_wins + f.season_losses) as season_fights
        from public.fighters f
       where not f.hidden
    ) x
    left join lateral (
      select sum(fr.rounds) as total_rounds,
             sum(fr.score_for) as points_for,
             sum(fr.score_against) as points_against,
             count(*) filter (where fr.result = 'W' and fr.method = 'pin')        as wins_pin,
             count(*) filter (where fr.result = 'W' and fr.method = 'submission') as wins_submission,
             count(*) filter (where fr.result = 'W' and fr.method = 'decision')   as wins_decision,
             count(*) filter (where fr.result = 'L' and fr.method = 'pin')        as losses_pin,
             count(*) filter (where fr.result = 'L' and fr.method = 'submission') as losses_submission,
             count(*) filter (where fr.result = 'L' and fr.method = 'decision')   as losses_decision
        from public.fight_results fr
       where fr.fighter_id = x.fighter_id
    ) s on true;

-- ===========================================================================
-- Public (anon) RPC: + is_title_fight, champion_side, champion_nickname
-- ===========================================================================
drop function if exists public.public_next_fight();
create function public.public_next_fight()
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
     and f.card_date = (select min(x.card_date) from public.fights x where x.status in ('open', 'locked'))
   order by f.is_main_event desc, f.scheduled_at asc, f.bout_order asc, f.created_at asc
   limit 1;
$$;

-- ===========================================================================
-- Backfill (production already has history): badges from settled fights
-- ===========================================================================
with h as (
  select fr.fighter_id, fr.fight_id, fr.result, fr.score_against, fr.settled_at,
         case when fr.side = 'red' then f.red_elo_before else f.blue_elo_before end as my_elo,
         case when fr.side = 'red' then f.blue_elo_before else f.red_elo_before end as opp_elo,
         row_number() over (partition by fr.fighter_id order by fr.settled_at, fr.fight_id) as n,
         count(*) filter (where fr.result = 'W')
           over (partition by fr.fighter_id order by fr.settled_at, fr.fight_id) as wins_so_far
    from public.fight_results fr
    join public.fights f on f.id = fr.fight_id
), g as (
  select h.*, h.n - row_number() over (partition by h.fighter_id, h.result order by h.n) as grp from h
), s as (
  select g.*, row_number() over (partition by g.fighter_id, g.result, g.grp order by g.n) as run from g
)
insert into public.fighter_badges (fighter_id, code, fight_id, awarded_at)
select fighter_id, 'first_win', fight_id, settled_at from s where result = 'W' and wins_so_far = 1
union all select fighter_id, 'streak_3', fight_id, settled_at from s where result = 'W' and run = 3
union all select fighter_id, 'streak_5', fight_id, settled_at from s where result = 'W' and run = 5
union all select fighter_id, 'upset', fight_id, settled_at from s where result = 'W' and my_elo <= opp_elo - 100
union all select fighter_id, 'shutout', fight_id, settled_at from s where result = 'W' and score_against = 0
union all select fighter_id, 'iron_man', fight_id, settled_at from s where n = 10
on conflict do nothing;

insert into public.user_badges (user_id, code, fight_id, awarded_at)
select b.user_id, 'high_roller', b.fight_id, f.settled_at
  from public.bets b join public.fights f on f.id = b.fight_id
 where b.status = 'won' and b.amount >= 400 and f.status = 'settled'
on conflict do nothing;

insert into public.user_badges (user_id, code, fight_id, awarded_at)
select l.user_id, 'comeback', b.fight_id, f.settled_at
  from public.points_ledger l
  join public.bets b on b.id = l.ref_id
  join public.fights f on f.id = b.fight_id
 where l.reason = 'payout' and b.status = 'won' and f.status = 'settled'
   and private.is_comeback(l.user_id, l.id)
on conflict do nothing;

select private.sync_sharp_eye(u.user_id) from (select distinct v.user_id from public.votes v) u;
select private.sync_perfect_night(c.card_date)
  from (select distinct f.card_date from public.fights f where f.status = 'settled') c;

-- ===========================================================================
-- RLS + table privileges (members read; writes only through RPCs)
-- ===========================================================================
alter table public.belt_reigns    enable row level security;
alter table public.badge_catalog  enable row level security;
alter table public.fighter_badges enable row level security;
alter table public.user_badges    enable row level security;
alter table public.live_scores    enable row level security;
alter table public.seasons        enable row level security;

create policy belt_reigns_select    on public.belt_reigns    for select to authenticated using ((select public.is_member()));
create policy badge_catalog_select  on public.badge_catalog  for select to authenticated using ((select public.is_member()));
create policy fighter_badges_select on public.fighter_badges for select to authenticated using ((select public.is_member()));
create policy user_badges_select    on public.user_badges    for select to authenticated using ((select public.is_member()));
create policy live_scores_select    on public.live_scores    for select to authenticated using ((select public.is_member()));
create policy seasons_select        on public.seasons        for select to authenticated using ((select public.is_member()));

revoke all on public.belt_reigns, public.badge_catalog, public.fighter_badges, public.user_badges,
              public.live_scores, public.seasons,
              public.live_score_state, public.belt_reign_history, public.current_champion, public.fighter_rankings
  from anon, authenticated, public;
grant select on public.belt_reigns, public.badge_catalog, public.fighter_badges, public.user_badges,
                public.live_scores, public.seasons,
                public.live_score_state, public.belt_reign_history, public.current_champion, public.fighter_rankings
  to authenticated;
revoke all on sequence public.fighter_badges_id_seq, public.user_badges_id_seq, public.seasons_id_seq
  from anon, authenticated, public;

-- ===========================================================================
-- Realtime: live scores
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_scores') then
    alter publication supabase_realtime add table public.live_scores;
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
  public.admin_end_season(text, text)
to authenticated;

grant execute on function public.public_next_fight() to anon;
