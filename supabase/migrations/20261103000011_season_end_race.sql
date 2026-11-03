-- WAVE B fix (on top of 20261103000005_wave_b.sql): admin_end_season race.
--
-- The FIGHTS_IN_PROGRESS check ran before any fight, fighter or profile lock was
-- taken. A fight opened and a pick placed in the window between that check and
-- the reset INSERT were counted in the reset: the member's stake came back as
-- part of "back to 1000" while the pick stayed active (free points), and the
-- season closed with a fight open.
--
-- Now:
--   1. every fight that can still change state (scheduled/open/locked) is locked
--      FOR UPDATE right after the belt lock. accept_fight, admin_force_open,
--      place_bet, cast_vote and cancel_bet all take the fight row FOR UPDATE
--      first, so none of them can run on those fights until the reset commits;
--   2. the FIGHTS_IN_PROGRESS check runs after that lock;
--   3. after every profile row is locked (place_bet / cancel_bet lock the
--      caller's profile before touching the ledger, so no pick can land after
--      this), the check runs again and also refuses any active pick on a fight
--      that is not finished. This covers a fight created and opened after
--      step 1 (new rows are not covered by the step-1 lock).
-- Lock order stays fight -> fighters -> profiles, the same as every other RPC.
-- Signature, grants and return shape are unchanged.
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

  -- freeze every fight that could still open, take picks or lock (all fight
  -- RPCs lock the fight row first), then check - a fresh snapshot per statement
  perform 1 from public.fights f where f.status in ('scheduled', 'open', 'locked') order by f.id for update;
  if exists (select 1 from public.fights f where f.status in ('open', 'locked')) then
    raise exception 'FIGHTS_IN_PROGRESS';
  end if;

  perform 1 from public.fighters order by id for update;
  -- lock every profile: inactive members are reset too, so a later reactivation
  -- can't carry last season's balance into the new one
  perform 1 from public.profiles order by id for update;

  -- every balance is frozen now (picks lock the member's profile row first).
  -- Re-check: a fight created after the fight lock may have opened and taken
  -- picks while we waited for the fighter / profile locks.
  if exists (select 1 from public.fights f where f.status in ('open', 'locked'))
     or exists (select 1 from public.bets b join public.fights f on f.id = b.fight_id
                 where b.status = 'active' and f.status not in ('settled', 'cancelled')) then
    raise exception 'FIGHTS_IN_PROGRESS';
  end if;
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
