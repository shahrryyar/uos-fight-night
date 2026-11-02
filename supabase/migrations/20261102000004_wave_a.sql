-- UoS Fight Night — WAVE A (CONTRACT.md ADDENDA):
--   C0  admin-created accounts: self-signup off, invites + hook removed, display_name required
--   A   match stats: weights, rounds, scores, finish move; fight_results view; ranking stats
--   B1  admin_correct_result (undo a settled result; payouts reversed via 'payout_reversal')
--   B2  fight consent (scheduled -> open), decline, admin_force_open, no contest
--   B3  bout order / main event / card_date (Asia/Baghdad)
--   +   review fixes: admins can't dodge participant checks by re-linking fighters
-- Every function: security definer, set search_path = '', fully-qualified names.

-- ===========================================================================
-- C0. Remove invite signup
-- ===========================================================================
drop function if exists public.admin_create_invite(int, timestamptz);
drop function if exists public.admin_revoke_invite(text);
drop function if exists public.hook_before_user_created(jsonb);
drop function if exists private.invite_hint(text);
drop table if exists public.invites cascade;

-- The auth server no longer reads public tables (no hook). The signup trigger
-- runs as its owner (security definer), so supabase_auth_admin needs nothing.
drop policy if exists profiles_select_auth_admin on public.profiles;
revoke select on public.profiles from supabase_auth_admin;

drop policy if exists admin_log_select on public.admin_log;
create policy admin_log_select on public.admin_log for select to authenticated
  using ((select public.is_member()));

-- profiles.display_name: required, 1-24 chars, shown on every screen.
alter table public.profiles drop constraint if exists profiles_display_name_check;
update public.profiles
   set display_name = btrim(left(coalesce(nullif(btrim(display_name), ''), username::text), 24))
 where display_name is null or btrim(display_name) = '' or char_length(display_name) > 24
    or display_name <> btrim(display_name);
alter table public.profiles alter column display_name set not null;
alter table public.profiles add constraint profiles_display_name_check
  check (char_length(btrim(display_name)) between 1 and 24 and display_name = btrim(display_name));

create index if not exists admin_log_target_idx on public.admin_log (target_id, action);

-- Signup trigger: only the service-role admin API creates users now (Edge
-- Function admin-create-user). Profile comes from user_metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display  text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if v_username !~ '^[a-z0-9_]{3,20}$'
     or lower(coalesce(new.email, '')) <> v_username || '@members.uosfight.local' then
    raise exception 'INVALID_USERNAME';
  end if;
  if v_display = '' then v_display := v_username; end if;
  if char_length(v_display) > 24 then
    raise exception 'INVALID_DISPLAY_NAME';
  end if;

  begin
    insert into public.profiles (id, username, display_name) values (new.id, v_username, v_display);
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN';
  end;

  insert into public.points_ledger (user_id, delta, reason, note)
  values (new.id, 1000, 'signup', 'Welcome to Fight Night');

  return new;
end;
$$;

-- ===========================================================================
-- Ledger: payout_reversal (B1). Balances may go negative after a reversal.
-- ===========================================================================
alter table public.points_ledger drop constraint if exists points_ledger_reason_check;
alter table public.points_ledger add constraint points_ledger_reason_check
  check (reason in ('signup', 'weekly', 'topup', 'bet', 'bet_cancel', 'payout', 'refund',
                    'admin_adjust', 'payout_reversal'));

-- ===========================================================================
-- Fights: new columns (A, B2, B3)
-- ===========================================================================
alter table public.fights
  add column if not exists red_weight_kg    numeric(5,1) null check (red_weight_kg is null or red_weight_kg > 0),
  add column if not exists blue_weight_kg   numeric(5,1) null check (blue_weight_kg is null or blue_weight_kg > 0),
  add column if not exists rounds           int  null check (rounds between 1 and 20),
  add column if not exists red_score        int  null check (red_score >= 0),
  add column if not exists blue_score       int  null check (blue_score >= 0),
  add column if not exists finish_move      text null check (char_length(finish_move) <= 60),
  add column if not exists red_accepted_at  timestamptz null,
  add column if not exists blue_accepted_at timestamptz null,
  add column if not exists cancel_kind      text null check (cancel_kind in ('cancelled', 'no_contest', 'declined')),
  add column if not exists bout_order       int  not null default 1 check (bout_order >= 1),
  add column if not exists is_main_event    boolean not null default false,
  add column if not exists card_date        date null;

alter table public.fights alter column status set default 'scheduled';

update public.fights set result_note = left(result_note, 200) where char_length(result_note) > 200;
alter table public.fights add constraint fights_result_note_check
  check (result_note is null or char_length(result_note) <= 200);

update public.fights set cancel_kind = 'cancelled' where status = 'cancelled' and cancel_kind is null;
alter table public.fights add constraint fights_cancel_kind_status_check
  check ((status = 'cancelled') = (cancel_kind is not null));

-- settled rows carry the full result (old rows are back-filled with rounds=1, 0-0)
update public.fights set rounds = coalesce(rounds, 1), red_score = coalesce(red_score, 0),
                         blue_score = coalesce(blue_score, 0)
 where status = 'settled';
alter table public.fights drop constraint if exists fights_check1;
alter table public.fights add constraint fights_settled_result_check
  check (status <> 'settled' or (winner_side is not null and method is not null and rounds is not null
                                 and red_score is not null and blue_score is not null));

-- card_date = Asia/Baghdad calendar date of scheduled_at; always derived.
create or replace function private.fights_set_card_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.card_date := (new.scheduled_at at time zone 'Asia/Baghdad')::date;
  return new;
end;
$$;

drop trigger if exists fights_set_card_date on public.fights;
create trigger fights_set_card_date
  before insert or update of scheduled_at on public.fights
  for each row execute function private.fights_set_card_date();

update public.fights set card_date = (scheduled_at at time zone 'Asia/Baghdad')::date where card_date is null;
update public.fights f set bout_order = o.n
  from (select id, row_number() over (partition by card_date order by scheduled_at, created_at, id)::int as n
          from public.fights) o
 where o.id = f.id;
update public.fights set red_weight_kg = r.weight_kg from public.fighters r
 where r.id = fights.red_fighter_id and fights.red_weight_kg is null;
update public.fights set blue_weight_kg = b.weight_kg from public.fighters b
 where b.id = fights.blue_fighter_id and fights.blue_weight_kg is null;
alter table public.fights alter column card_date set not null;

create index if not exists fights_card_idx on public.fights (card_date, bout_order);
create unique index if not exists fights_one_main_event_per_card
  on public.fights (card_date) where is_main_event and status <> 'cancelled';
create index if not exists fights_settled_at_idx on public.fights (settled_at) where status = 'settled';

-- ===========================================================================
-- Private helpers
-- ===========================================================================
-- True if p_uid is linked to either fighter now, OR ever was according to
-- admin_log (member_update / member_create rows). Closes the "unlink my
-- fighter, then settle my own fight" bypass.
create or replace function private.is_or_was_linked(p_uid uuid, p_red uuid, p_blue uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
           select 1 from public.profiles p
            where p.id = p_uid and p.fighter_id is not null and p.fighter_id in (p_red, p_blue))
      or exists (
           select 1 from public.admin_log l
            where l.target_id = p_uid
              and l.action in ('member_update', 'member_create')
              and (    l.details ->> 'fighter_id' in (p_red::text, p_blue::text)
                    or l.details -> 'prev' ->> 'fighter_id' in (p_red::text, p_blue::text)));
$$;

create or replace function private.check_weight(p_kg numeric)
returns void
language plpgsql immutable security definer set search_path = ''
as $$
begin
  if p_kg is not null and (p_kg <= 0 or p_kg >= 1000) then
    raise exception 'INVALID_WEIGHT';
  end if;
end;
$$;

-- ===========================================================================
-- Views: fight_results (A)
-- ===========================================================================
create or replace view public.fight_results with (security_invoker = on) as
  select f.id as fight_id,
         f.red_fighter_id as fighter_id,
         f.blue_fighter_id as opponent_id,
         'red'::text as side,
         case when f.winner_side = 'red' then 'W' else 'L' end::text as result,
         f.method, f.finish_move, f.rounds,
         f.red_score as score_for, f.blue_score as score_against,
         f.red_weight_kg as weight_kg, f.blue_weight_kg as opponent_weight_kg,
         f.elo_delta as elo_delta,
         f.settled_at, f.result_note
    from public.fights f
   where f.status = 'settled'
  union all
  select f.id, f.blue_fighter_id, f.red_fighter_id, 'blue'::text,
         case when f.winner_side = 'blue' then 'W' else 'L' end::text,
         f.method, f.finish_move, f.rounds,
         f.blue_score, f.red_score,
         f.blue_weight_kg, f.red_weight_kg,
         -f.elo_delta,
         f.settled_at, f.result_note
    from public.fights f
   where f.status = 'settled';

-- Streak recomputed from history (newest first): +n wins / -n losses in a row.
create or replace function private.compute_streak(p_fighter uuid)
returns int
language plpgsql stable security definer set search_path = ''
as $$
declare
  r      record;
  v_first text;
  v_n    int := 0;
begin
  for r in
    select fr.result from public.fight_results fr
     where fr.fighter_id = p_fighter
     order by fr.settled_at desc, fr.fight_id desc
  loop
    if v_first is null then v_first := r.result; end if;
    exit when r.result <> v_first;
    v_n := v_n + 1;
  end loop;
  return case when v_first = 'W' then v_n when v_first = 'L' then -v_n else 0 end;
end;
$$;

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
         x.weight_kg
    from (
      select f.id as fighter_id, f.nickname, f.elo, f.wins, f.losses, f.streak,
             (f.wins + f.losses) as fights, f.weight_kg
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

-- balances / leaderboard_bettors: add display_name (shown instead of username)
create or replace view public.balances with (security_invoker = on) as
  select l.user_id, p.username::text as username, sum(l.delta)::int as balance, p.display_name
    from public.points_ledger l
    join public.profiles p on p.id = l.user_id
   group by l.user_id, p.username, p.display_name;

drop view if exists public.leaderboard_bettors;
drop function if exists public.get_leaderboard_bettors();
create function public.get_leaderboard_bettors()
returns table (user_id uuid, username text, balance int, rank int, display_name text)
language sql stable security definer set search_path = ''
as $$
  select b.user_id, b.username, b.balance,
         (rank() over (order by b.balance desc))::int, b.display_name
    from (
      select p.id as user_id, p.username::text as username, p.display_name,
             coalesce(sum(l.delta), 0)::int as balance
        from public.profiles p
        left join public.points_ledger l on l.user_id = p.id
       where p.active and public.is_member()
       group by p.id, p.username, p.display_name
    ) b
   order by b.balance desc, b.display_name;
$$;
create view public.leaderboard_bettors with (security_invoker = on) as
  select user_id, username, balance, rank, display_name from public.get_leaderboard_bettors();

revoke all on public.fight_results, public.fighter_rankings, public.balances, public.leaderboard_bettors
  from anon, authenticated, public;
grant select on public.fight_results, public.fighter_rankings, public.balances, public.leaderboard_bettors
  to authenticated;

-- ===========================================================================
-- Public (anon) RPC — landing: nicknames + weights, no photos.
-- Prefers the main event of the nearest card with an open/locked fight.
-- ===========================================================================
drop function if exists public.public_next_fight();
create function public.public_next_fight()
returns table (id uuid, title text, lock_at timestamptz, scheduled_at timestamptz, status text,
               red_nickname text, blue_nickname text, red_weight_kg numeric, blue_weight_kg numeric,
               is_main_event boolean)
language sql stable security definer set search_path = ''
as $$
  select f.id, f.title, f.lock_at, f.scheduled_at, f.status, r.nickname, b.nickname,
         coalesce(f.red_weight_kg, r.weight_kg), coalesce(f.blue_weight_kg, b.weight_kg),
         f.is_main_event
    from public.fights f
    join public.fighters r on r.id = f.red_fighter_id
    join public.fighters b on b.id = f.blue_fighter_id
   where f.status in ('open', 'locked')
     and f.card_date = (select min(x.card_date) from public.fights x where x.status in ('open', 'locked'))
   order by f.is_main_event desc, f.scheduled_at asc, f.bout_order asc, f.created_at asc
   limit 1;
$$;

-- ===========================================================================
-- Admin: create fight (A + B2 + B3) — status 'scheduled'
-- ===========================================================================
drop function if exists public.admin_create_fight(uuid, uuid, timestamptz, timestamptz, text);
create or replace function public.admin_create_fight(
  p_red uuid, p_blue uuid, p_scheduled_at timestamptz, p_lock_at timestamptz, p_title text,
  p_red_weight_kg numeric default null, p_blue_weight_kg numeric default null,
  p_bout_order int default null, p_main_event boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_admin();
  v_id    uuid;
  v_red   public.fighters%rowtype;
  v_blue  public.fighters%rowtype;
  v_card  date;
  v_order int;
begin
  if p_red is null or p_blue is null or p_red = p_blue then
    raise exception 'INVALID_FIGHTERS';
  end if;
  select * into v_red  from public.fighters where id = p_red;
  if not found then raise exception 'FIGHTER_NOT_FOUND'; end if;
  select * into v_blue from public.fighters where id = p_blue;
  if not found then raise exception 'FIGHTER_NOT_FOUND'; end if;
  if p_scheduled_at is null or p_lock_at is null then
    raise exception 'INVALID_TIME';
  end if;
  perform private.check_weight(p_red_weight_kg);
  perform private.check_weight(p_blue_weight_kg);
  if p_bout_order is not null and p_bout_order < 1 then
    raise exception 'INVALID_BOUT_ORDER';
  end if;

  v_card := (p_scheduled_at at time zone 'Asia/Baghdad')::date;
  -- serialise numbering / main-event checks per card
  perform pg_advisory_xact_lock(hashtext('fight_card:' || v_card::text));

  if coalesce(p_main_event, false) and exists (
    select 1 from public.fights f
     where f.card_date = v_card and f.is_main_event and f.status <> 'cancelled'
  ) then
    raise exception 'MAIN_EVENT_EXISTS';
  end if;

  v_order := coalesce(p_bout_order, (
    select coalesce(max(f.bout_order), 0) + 1 from public.fights f
     where f.card_date = v_card and f.status <> 'cancelled'));

  begin
    insert into public.fights (title, red_fighter_id, blue_fighter_id, scheduled_at, lock_at, status,
                               created_by, red_weight_kg, blue_weight_kg, bout_order, is_main_event)
    values (nullif(btrim(p_title), ''), p_red, p_blue, p_scheduled_at, p_lock_at, 'scheduled',
            v_uid, coalesce(p_red_weight_kg, v_red.weight_kg), coalesce(p_blue_weight_kg, v_blue.weight_kg),
            v_order, coalesce(p_main_event, false))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'MAIN_EVENT_EXISTS';
  end;

  insert into public.fight_pools (fight_id) values (v_id);

  perform private.log(v_uid, 'fight_create', v_id, jsonb_build_object(
    'red', p_red, 'blue', p_blue, 'scheduled_at', p_scheduled_at, 'lock_at', p_lock_at, 'title', p_title,
    'card_date', v_card, 'bout_order', v_order, 'is_main_event', coalesce(p_main_event, false)));
  return v_id;
end;
$$;

-- Lock only from 'open' (a 'scheduled' fight still needs consent / force open).
create or replace function public.admin_lock_fight(p_fight_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_f   public.fights%rowtype;
begin
  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status = 'locked' then return; end if;
  if v_f.status <> 'open' then raise exception 'FIGHT_NOT_OPEN'; end if;

  update public.fights set status = 'locked' where id = p_fight_id;
  perform private.log(v_uid, 'fight_lock', p_fight_id, null);
end;
$$;

-- ===========================================================================
-- Admin: settle (A) — rounds + scores required
-- ===========================================================================
drop function if exists public.admin_settle_fight(uuid, text, text, text);
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

  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status = 'settled' then raise exception 'ALREADY_SETTLED'; end if;
  if v_f.status = 'cancelled' then raise exception 'FIGHT_CANCELLED'; end if;
  if v_f.status = 'scheduled' then raise exception 'FIGHT_NOT_OPEN'; end if;
  -- open (before or after lock_at) or locked: the fight row lock above already
  -- blocks any new bets/votes, and we flip it to settled below.

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
  -- Lock both fighters in id order (same order as admin_correct_result) so a
  -- settle and a correction / another settle never deadlock on opposite corners.
  perform 1 from public.fighters
   where id in (v_f.red_fighter_id, v_f.blue_fighter_id)
   order by id
     for update;
  select * into v_red  from public.fighters where id = v_f.red_fighter_id;
  select * into v_blue from public.fighters where id = v_f.blue_fighter_id;

  v_exp_red := 1 / (1 + power(10::numeric, (v_blue.elo - v_red.elo)::numeric / 400));
  v_delta := round(32 * ((case when p_winner_side = 'red' then 1 else 0 end) - v_exp_red))::int;

  update public.fighters
     set elo    = elo + v_delta,
         wins   = wins   + case when p_winner_side = 'red' then 1 else 0 end,
         losses = losses + case when p_winner_side = 'red' then 0 else 1 end,
         streak = case when p_winner_side = 'red'
                       then case when streak > 0 then streak + 1 else 1 end
                       else case when streak < 0 then streak - 1 else -1 end end
   where id = v_red.id;

  update public.fighters
     set elo    = elo - v_delta,
         wins   = wins   + case when p_winner_side = 'blue' then 1 else 0 end,
         losses = losses + case when p_winner_side = 'blue' then 0 else 1 end,
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
         settled_at      = clock_timestamp(),   -- strictly ordered, even within one transaction
         red_elo_before  = v_red.elo,
         blue_elo_before = v_blue.elo,
         elo_delta       = v_delta
   where id = p_fight_id;

  perform private.log(v_uid, 'fight_settle', p_fight_id, jsonb_build_object(
    'winner_side', p_winner_side, 'method', p_method, 'rounds', p_rounds,
    'red_score', p_red_score, 'blue_score', p_blue_score, 'finish_move', v_move,
    'total_pool', v_total, 'winning_pool', v_win_pool, 'dust', v_dust,
    'elo_delta', v_delta, 'refunded', v_refunded));

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
    'blue_elo_before', v_blue.elo);
end;
$$;

-- ===========================================================================
-- B1. Correct / undo a settled result
-- ===========================================================================
create or replace function public.admin_correct_result(p_fight_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := private.require_admin();
  v_reason    text := btrim(coalesce(p_reason, ''));
  v_f         public.fights%rowtype;
  b           record;
  v_reversed  bigint := 0;
  v_restored  int := 0;
  v_red_elo   int;
  v_blue_elo  int;
begin
  if char_length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 200 then raise exception 'INVALID_NOTE'; end if;

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

  -- Lock both fighters (id order, same as admin_settle_fight) BEFORE the
  -- LATER_FIGHT_EXISTS check. A concurrent settle of a newer fight of either
  -- fighter holds these locks until it commits; once we get them, the check
  -- below (a new statement under READ COMMITTED) sees that settle and refuses.
  -- Checking first would pass on a stale snapshot and then wipe the newer
  -- fight's Elo when the snapshot values are written back.
  perform 1 from public.fighters
   where id in (v_f.red_fighter_id, v_f.blue_fighter_id)
   order by id
     for update;

  -- Correct newest first: any later (or same-instant) settled fight of either
  -- fighter would make the Elo/streak chain inconsistent.
  if exists (
    select 1 from public.fights o
     where o.id <> v_f.id and o.status = 'settled'
       and o.settled_at >= v_f.settled_at
       and (o.red_fighter_id  in (v_f.red_fighter_id, v_f.blue_fighter_id)
         or o.blue_fighter_id in (v_f.red_fighter_id, v_f.blue_fighter_id))
  ) then
    raise exception 'LATER_FIGHT_EXISTS';
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
  end loop;

  -- ---- Fighters: Elo from snapshot, W/L back, streak from history ----------
  -- (fighter rows already locked above)
  update public.fights
     set status = 'locked', winner_side = null, method = null, result_note = null,
         rounds = null, red_score = null, blue_score = null, finish_move = null,
         recorded_by = null, settled_at = null,
         red_elo_before = null, blue_elo_before = null, elo_delta = null
   where id = p_fight_id;

  update public.fighters
     set elo    = v_f.red_elo_before,
         wins   = greatest(0, wins   - case when v_f.winner_side = 'red' then 1 else 0 end),
         losses = greatest(0, losses - case when v_f.winner_side = 'red' then 0 else 1 end),
         streak = private.compute_streak(v_f.red_fighter_id)
   where id = v_f.red_fighter_id
  returning elo into v_red_elo;

  update public.fighters
     set elo    = v_f.blue_elo_before,
         wins   = greatest(0, wins   - case when v_f.winner_side = 'blue' then 1 else 0 end),
         losses = greatest(0, losses - case when v_f.winner_side = 'blue' then 0 else 1 end),
         streak = private.compute_streak(v_f.blue_fighter_id)
   where id = v_f.blue_fighter_id
  returning elo into v_blue_elo;

  perform private.log(v_uid, 'fight_correct', p_fight_id, jsonb_build_object(
    'reason', v_reason,
    'prev', jsonb_build_object(
      'winner_side', v_f.winner_side, 'method', v_f.method, 'rounds', v_f.rounds,
      'red_score', v_f.red_score, 'blue_score', v_f.blue_score, 'finish_move', v_f.finish_move,
      'elo_delta', v_f.elo_delta, 'recorded_by', v_f.recorded_by, 'settled_at', v_f.settled_at),
    'reversed_payouts', v_reversed, 'bets_restored', v_restored));

  return jsonb_build_object(
    'fight_id', p_fight_id,
    'status', 'locked',
    'reversed_payouts', v_reversed,
    'bets_restored', v_restored,
    'red_elo', v_red_elo,
    'blue_elo', v_blue_elo);
end;
$$;

-- ===========================================================================
-- B2. Cancel / no contest (p_kind) — refunds all active bets, no record change
-- ===========================================================================
drop function if exists public.admin_cancel_fight(uuid, text);
create or replace function public.admin_cancel_fight(p_fight_id uuid, p_reason text, p_kind text default 'cancelled')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_admin();
  v_f      public.fights%rowtype;
  v_n      int;
  v_kind   text := coalesce(p_kind, 'cancelled');
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_kind not in ('cancelled', 'no_contest') then raise exception 'INVALID_KIND'; end if;
  if char_length(v_reason) > 200 then raise exception 'INVALID_NOTE'; end if;

  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status = 'settled' then raise exception 'ALREADY_SETTLED'; end if;
  if v_f.status = 'cancelled' then raise exception 'FIGHT_CANCELLED'; end if;
  if v_kind = 'no_contest' and v_f.status not in ('open', 'locked') then
    raise exception 'FIGHT_NOT_OPEN';
  end if;

  -- An admin whose fighter is (or was) in the bout, or who holds an active bet
  -- on it, must not be able to void the result. Another admin can.
  if private.is_or_was_linked(v_uid, v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;
  if exists (
    select 1 from public.bets bb
    where bb.fight_id = p_fight_id and bb.user_id = v_uid and bb.status = 'active'
  ) then
    raise exception 'ADMIN_HAS_BET';
  end if;

  v_n := private.refund_active_bets(p_fight_id,
           case when v_kind = 'no_contest' then 'No contest: refund' else 'Fight cancelled: refund' end);

  update public.fights
     set status = 'cancelled', cancel_kind = v_kind, result_note = v_reason,
         recorded_by = v_uid, settled_at = clock_timestamp()
   where id = p_fight_id;

  perform private.log(v_uid, case when v_kind = 'no_contest' then 'fight_no_contest' else 'fight_cancel' end,
                      p_fight_id, jsonb_build_object('reason', v_reason, 'kind', v_kind, 'refunded', v_n));
end;
$$;

-- ===========================================================================
-- B2. Consent
-- ===========================================================================
create or replace function public.accept_fight(p_fight_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := private.require_member();
  v_f    public.fights%rowtype;
  v_fid  uuid;
  v_side text;
begin
  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;

  select p.fighter_id into v_fid from public.profiles p where p.id = v_uid;
  v_side := case when v_fid is null then null
                 when v_fid = v_f.red_fighter_id then 'red'
                 when v_fid = v_f.blue_fighter_id then 'blue' end;
  if v_side is null then raise exception 'NOT_PARTICIPANT'; end if;
  if v_f.status <> 'scheduled' then raise exception 'NOT_SCHEDULED'; end if;

  if v_side = 'red' then
    update public.fights set red_accepted_at = coalesce(red_accepted_at, now()) where id = p_fight_id;
  else
    update public.fights set blue_accepted_at = coalesce(blue_accepted_at, now()) where id = p_fight_id;
  end if;

  update public.fights set status = 'open'
   where id = p_fight_id and red_accepted_at is not null and blue_accepted_at is not null;

  perform private.log(v_uid, 'fight_accept', p_fight_id, jsonb_build_object('side', v_side));
end;
$$;

create or replace function public.decline_fight(p_fight_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := private.require_member();
  v_f    public.fights%rowtype;
  v_fid  uuid;
  v_side text;
  v_n    int;
begin
  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;

  select p.fighter_id into v_fid from public.profiles p where p.id = v_uid;
  v_side := case when v_fid is null then null
                 when v_fid = v_f.red_fighter_id then 'red'
                 when v_fid = v_f.blue_fighter_id then 'blue' end;
  if v_side is null then raise exception 'NOT_PARTICIPANT'; end if;
  if v_f.status <> 'scheduled' then raise exception 'NOT_SCHEDULED'; end if;

  -- a scheduled fight takes no bets, but refund defensively
  v_n := private.refund_active_bets(p_fight_id, 'Fight declined: refund');

  update public.fights
     set status = 'cancelled', cancel_kind = 'declined',
         result_note = 'Declined by ' || v_side || ' corner', settled_at = clock_timestamp()
   where id = p_fight_id;

  perform private.log(v_uid, 'fight_decline', p_fight_id, jsonb_build_object('side', v_side, 'refunded', v_n));
end;
$$;

create or replace function public.admin_force_open(p_fight_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_admin();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_f      public.fights%rowtype;
begin
  if char_length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 200 then raise exception 'INVALID_NOTE'; end if;

  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status <> 'scheduled' then raise exception 'NOT_SCHEDULED'; end if;
  if private.is_or_was_linked(v_uid, v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;
  -- Force open is only for corners with no app account (Addendum B2). A
  -- corner that has not accepted but is linked to an active member must
  -- accept or decline it themselves.
  if (v_f.red_accepted_at is null and exists (
        select 1 from public.profiles p where p.fighter_id = v_f.red_fighter_id and p.active))
  or (v_f.blue_accepted_at is null and exists (
        select 1 from public.profiles p where p.fighter_id = v_f.blue_fighter_id and p.active)) then
    raise exception 'FIGHTER_HAS_ACCOUNT';
  end if;

  update public.fights set status = 'open' where id = p_fight_id;

  perform private.log(v_uid, 'fight_force_open', p_fight_id, jsonb_build_object(
    'reason', v_reason,
    'red_accepted', v_f.red_accepted_at is not null,
    'blue_accepted', v_f.blue_accepted_at is not null));
end;
$$;

-- ===========================================================================
-- B3. Bout order / main event
-- ===========================================================================
-- Listed fights get bout_order 1..n in the given order; any other fights on
-- that card keep their relative order after them.
create or replace function public.admin_reorder_card(p_card_date date, p_fight_ids uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_n   int := coalesce(cardinality(p_fight_ids), 0);
begin
  if p_card_date is null or v_n = 0 then raise exception 'INVALID_CARD'; end if;
  if (select count(distinct x) from unnest(p_fight_ids) x where x is not null) <> v_n then
    raise exception 'INVALID_CARD';
  end if;

  perform pg_advisory_xact_lock(hashtext('fight_card:' || p_card_date::text));
  perform 1 from public.fights where card_date = p_card_date for update;

  if (select count(*) from public.fights f where f.id = any (p_fight_ids) and f.card_date = p_card_date) <> v_n then
    raise exception 'INVALID_CARD';
  end if;

  update public.fights f set bout_order = o.n
    from (
      select z.id, row_number() over (order by z.listed_pos nulls last, z.bout_order, z.scheduled_at, z.id)::int as n
        from (
          select f2.id, f2.bout_order, f2.scheduled_at, a.ord as listed_pos
            from public.fights f2
            left join unnest(p_fight_ids) with ordinality as a(id, ord) on a.id = f2.id
           where f2.card_date = p_card_date
        ) z
    ) o
   where o.id = f.id and f.bout_order is distinct from o.n;

  perform private.log(v_uid, 'card_reorder', null,
                      jsonb_build_object('card_date', p_card_date, 'fight_ids', to_jsonb(p_fight_ids)));
end;
$$;

create or replace function public.admin_set_main_event(p_fight_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_f   public.fights%rowtype;
begin
  select * into v_f from public.fights where id = p_fight_id;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status = 'cancelled' then raise exception 'FIGHT_CANCELLED'; end if;

  perform pg_advisory_xact_lock(hashtext('fight_card:' || v_f.card_date::text));

  update public.fights set is_main_event = false
   where card_date = v_f.card_date and is_main_event and id <> p_fight_id;
  update public.fights set is_main_event = true where id = p_fight_id and not is_main_event;

  perform private.log(v_uid, 'card_main_event', p_fight_id, jsonb_build_object('card_date', v_f.card_date));
end;
$$;

-- ===========================================================================
-- Members admin (C0: display_name; review fix: no self fighter re-link mid-fight)
-- p_active / p_role / p_display_name: null = keep current. p_fighter_id is
-- always applied (null = unlink).
-- ===========================================================================
drop function if exists public.admin_set_member(uuid, boolean, text, uuid);
create or replace function public.admin_set_member(
  p_user_id uuid, p_active boolean, p_role text, p_fighter_id uuid, p_display_name text default null)
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
  if p_role is not null and p_role not in ('member', 'admin') then
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
-- Weekly points (cron): debt from a payout_reversal is NOT wiped.
-- +100 to every active member, then top anyone with 0..9 up to 100. A negative
-- balance (debt after admin_correct_result reversed a payout) only gets the
-- +100 bonus, so debt is repaid gradually instead of reset every Monday.
-- ===========================================================================
create or replace function private.weekly_points()
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  insert into public.points_ledger (user_id, delta, reason, note)
  select p.id, 100, 'weekly', 'Weekly bonus'
    from public.profiles p
   where p.active
     and not exists (
       select 1 from public.points_ledger l
        where l.user_id = p.id and l.reason = 'weekly'
          and l.created_at > now() - interval '6 days'
     );
  get diagnostics v_n = row_count;

  insert into public.points_ledger (user_id, delta, reason, note)
  select b.id, 100 - b.bal, 'topup', 'Weekly top-up to 100'
    from (
      select p.id, coalesce(sum(l.delta), 0)::int as bal
        from public.profiles p
        left join public.points_ledger l on l.user_id = p.id
       where p.active
       group by p.id
    ) b
   where b.bal >= 0 and b.bal < 10;

  return v_n;
end;
$$;

-- ===========================================================================
-- Review fix: place_bet / cast_vote use link HISTORY, not just the current
-- link. Unlinking a fighter's member (e.g. so admin_force_open passes
-- FIGHTER_HAS_ACCOUNT) or relinking them elsewhere must not let that member
-- bet on their own fight or have their vote counted in the crowd percentage.
-- ===========================================================================
create or replace function public.cast_vote(p_fight_id uuid, p_side text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_member();
  v_f   public.fights%rowtype;
begin
  if p_side is null or p_side not in ('red', 'blue') then
    raise exception 'INVALID_SIDE';
  end if;

  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status <> 'open' or now() >= v_f.lock_at then
    raise exception 'FIGHT_LOCKED';
  end if;

  insert into public.votes (fight_id, user_id, side, is_participant, updated_at)
  values (p_fight_id, v_uid, p_side,
          private.is_or_was_linked(v_uid, v_f.red_fighter_id, v_f.blue_fighter_id), now())
  on conflict (fight_id, user_id) do update
    set side = excluded.side,
        is_participant = excluded.is_participant,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.place_bet(p_fight_id uuid, p_side text, p_amount int)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := private.require_member();
  v_f       public.fights%rowtype;
  v_balance int;
  v_max     int;
  v_bet_id  uuid;
begin
  if p_side is null or p_side not in ('red', 'blue') then
    raise exception 'INVALID_SIDE';
  end if;
  if p_amount is null or p_amount < 10 then
    raise exception 'BET_TOO_SMALL';
  end if;

  -- lock order everywhere: fight row, then the caller's profile row
  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status <> 'open' or now() >= v_f.lock_at then
    raise exception 'FIGHT_LOCKED';
  end if;

  -- serialises all balance-spending operations for this user (no double-spend)
  perform 1 from public.profiles p where p.id = v_uid for update;
  if private.is_or_was_linked(v_uid, v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;

  if exists (
    select 1 from public.bets b
    where b.fight_id = p_fight_id and b.user_id = v_uid and b.status = 'active'
  ) then
    raise exception 'ALREADY_BET';
  end if;

  v_balance := private.balance_of(v_uid);
  if p_amount > v_balance then
    raise exception 'INSUFFICIENT_POINTS';
  end if;
  v_max := least(500, floor(v_balance * 0.5))::int;
  if p_amount > v_max then
    raise exception 'BET_TOO_LARGE';
  end if;

  insert into public.bets (fight_id, user_id, side, amount)
  values (p_fight_id, v_uid, p_side, p_amount)
  returning id into v_bet_id;

  insert into public.points_ledger (user_id, delta, reason, ref_id)
  values (v_uid, -p_amount, 'bet', v_bet_id);

  insert into public.fight_pools (fight_id) values (p_fight_id) on conflict do nothing;
  update public.fight_pools
     set red_total  = red_total  + case when p_side = 'red'  then p_amount else 0 end,
         red_count  = red_count  + case when p_side = 'red'  then 1 else 0 end,
         blue_total = blue_total + case when p_side = 'blue' then p_amount else 0 end,
         blue_count = blue_count + case when p_side = 'blue' then 1 else 0 end
   where fight_id = p_fight_id;

  return v_bet_id;
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
  public.my_balance(),
  public.cast_vote(uuid, text),
  public.place_bet(uuid, text, int),
  public.cancel_bet(uuid),
  public.toggle_reaction(uuid, text),
  public.get_fight_vote_totals(uuid),
  public.get_all_fight_vote_totals(),
  public.get_leaderboard_bettors(),
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
  public.admin_adjust_points(uuid, int, text)
to authenticated;

grant execute on function public.public_next_fight() to anon;
