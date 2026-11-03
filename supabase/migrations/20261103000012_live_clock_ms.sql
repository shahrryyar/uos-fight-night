-- WAVE B review fix: the referee round clock ran slow.
--
-- live_scores.accumulated_seconds is an int and admin_live_update banked
-- floor(now() - round_started_at) on every pause (and on set_round_seconds while
-- running), so the fractional part of every running segment was thrown away:
-- a 0.9 s burst between pauses banked 0 s, and a round with N pauses ran about
-- N * 0.5 s longer than round_seconds.
--
-- Fix: keep accumulated_seconds as the whole seconds (int, unchanged for every
-- existing reader) and bank the sub-second remainder in a new column
-- accumulated_frac_ms (0..999). Banked time = accumulated_seconds + accumulated_frac_ms / 1000.
-- All clock math (admin_live_update, live_score_state, get_live_score) now runs in
-- milliseconds and floors only for the elapsed_seconds / remaining_seconds outputs.
--
--   live_scores.accumulated_frac_ms   new, int, default 0, realtime carries it
--   live_score_state                  same columns, plus accumulated_frac_ms and elapsed_ms at the end
--   get_live_score(uuid)              same columns, plus accumulated_frac_ms and elapsed_ms at the end
--                                     (return type changed: dropped and recreated, grants re-applied)
--   admin_live_update(...)            signature, grants, logging and error codes unchanged

alter table public.live_scores
  add column accumulated_frac_ms int not null default 0
    check (accumulated_frac_ms between 0 and 999);
-- a capped clock (accumulated = round length) has no remainder
alter table public.live_scores
  add constraint live_scores_banked_within_round
    check (accumulated_seconds * 1000 + accumulated_frac_ms <= round_seconds * 1000);

-- Existing columns keep name, type and order; the new ones are appended.
create or replace view public.live_score_state with (security_invoker = on) as
  select s.fight_id, s.round, s.red_score, s.blue_score, s.running, s.round_seconds,
         (e.ms / 1000)::int as elapsed_seconds,
         greatest(0, s.round_seconds - (e.ms / 1000))::int as remaining_seconds,
         (e.ms >= s.round_seconds::bigint * 1000) as time_up,
         s.round_started_at, s.accumulated_seconds, s.updated_at, s.updated_by,
         (s.running or s.updated_at > now() - interval '10 minutes') as is_live,
         now() as server_now,
         s.accumulated_frac_ms,
         e.ms as elapsed_ms
    from public.live_scores s
    cross join lateral (
      -- banked + running time in ms, capped at the round length
      select least(s.round_seconds::bigint * 1000,
                   s.accumulated_seconds::bigint * 1000 + s.accumulated_frac_ms
                   + case when s.running
                          then greatest(0, floor(extract(epoch from (now() - s.round_started_at)) * 1000))::bigint
                          else 0 end) as ms
    ) e;
-- create or replace keeps the view's grants (select to authenticated only)

drop function public.get_live_score(uuid);
create function public.get_live_score(p_fight_id uuid)
returns table (fight_id uuid, round int, red_score int, blue_score int, running boolean, round_seconds int,
               elapsed_seconds int, remaining_seconds int, time_up boolean, round_started_at timestamptz,
               accumulated_seconds int, updated_at timestamptz, updated_by uuid, is_live boolean,
               server_now timestamptz, accumulated_frac_ms int, elapsed_ms bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_member();
  return query
    select l.fight_id, l.round, l.red_score, l.blue_score, l.running, l.round_seconds,
           l.elapsed_seconds, l.remaining_seconds, l.time_up, l.round_started_at,
           l.accumulated_seconds, l.updated_at, l.updated_by, l.is_live, l.server_now,
           l.accumulated_frac_ms, l.elapsed_ms
      from public.live_score_state l
     where l.fight_id = p_fight_id;
end;
$$;
revoke execute on function public.get_live_score(uuid) from public, anon, authenticated;
grant execute on function public.get_live_score(uuid) to authenticated;

create or replace function public.admin_live_update(p_fight_id uuid, p_action text, p_value int default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := private.require_referee();
  v_action  text := lower(btrim(coalesce(p_action, '')));
  v_f       public.fights%rowtype;
  v_s       public.live_scores%rowtype;
  v_ms      bigint;     -- time used this round, ms, capped at the round length
  v_bank    bigint;     -- ms to bank into accumulated_seconds / accumulated_frac_ms
  v_out     jsonb;
  v_log     boolean := false;
  v_prev_round int;
  v_prev_red   int;
  v_prev_blue  int;
  v_prev_len   int;
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

  v_prev_round := v_s.round; v_prev_red := v_s.red_score;
  v_prev_blue := v_s.blue_score; v_prev_len := v_s.round_seconds;

  -- same rule as live_score_state: banked + running ms, capped at the round length, no truncation
  v_ms := least(v_s.round_seconds::bigint * 1000,
                v_s.accumulated_seconds::bigint * 1000 + v_s.accumulated_frac_ms
                + case when v_s.running
                       then greatest(0, floor(extract(epoch from (now() - v_s.round_started_at)) * 1000))::bigint
                       else 0 end);
  v_bank := null;

  if v_action = 'start' then
    if not v_s.running then
      if v_ms >= v_s.round_seconds::bigint * 1000 then raise exception 'ROUND_OVER'; end if;
      v_log := v_s.round = 1 and v_ms = 0;               -- the opening bell, not a resume
      v_s.running := true;
      v_s.round_started_at := now();
    end if;
  elsif v_action = 'pause' then
    if v_s.running then
      v_bank := v_ms;
      v_s.running := false;
      v_s.round_started_at := null;
    end if;
  elsif v_action = 'next_round' then
    if v_s.round >= 20 then raise exception 'INVALID_ROUNDS'; end if;
    v_s.round := v_s.round + 1;
    v_log := true;
    v_bank := 0;
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
    v_log := p_value <> v_s.round_seconds;
    v_s.round_seconds := p_value;
    v_bank := least(v_ms, p_value::bigint * 1000);
    if v_s.running then v_s.round_started_at := now(); end if;
  elsif v_action = 'reset' then
    v_log := true;
    v_s.round := 1;
    v_s.red_score := 0;
    v_s.blue_score := 0;
    v_bank := 0;
    v_s.running := false;
    v_s.round_started_at := null;
  end if;

  if v_bank is not null then
    v_s.accumulated_seconds := (v_bank / 1000)::int;
    v_s.accumulated_frac_ms := (v_bank % 1000)::int;
  end if;

  update public.live_scores
     set round = v_s.round, red_score = v_s.red_score, blue_score = v_s.blue_score,
         round_started_at = v_s.round_started_at, accumulated_seconds = v_s.accumulated_seconds,
         accumulated_frac_ms = v_s.accumulated_frac_ms,
         round_seconds = v_s.round_seconds, running = v_s.running,
         updated_at = now(), updated_by = v_uid
   where fight_id = p_fight_id;

  select to_jsonb(l) into v_out from public.live_score_state l where l.fight_id = p_fight_id;

  -- Only the moments that change the bout are logged (20261103000007): the opening bell,
  -- next round, a changed round length, and a reset.
  if v_log then
    perform private.log(v_uid, 'live_update', p_fight_id, jsonb_build_object(
      'action', v_action, 'value', p_value, 'round', v_s.round,
      'red_score', v_s.red_score, 'blue_score', v_s.blue_score, 'running', v_s.running,
      'prev_round', v_prev_round, 'prev_red_score', v_prev_red, 'prev_blue_score', v_prev_blue,
      'prev_round_seconds', v_prev_len));
  end if;
  return v_out;
end;
$$;
