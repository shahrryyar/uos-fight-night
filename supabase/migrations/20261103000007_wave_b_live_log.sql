-- WAVE B review fix: the admin log was flooded by the referee scoreboard.
--
-- 20261103000005_wave_b.sql logged every admin_live_update call (each +1 / +2 / -1
-- and every pause/resume), so one short bout wrote ~50 "live update" rows and
-- pushed the real events off /admin/log (DESIGN 11.16: one human sentence per event).
--
-- admin_live_update now logs only:
--   start              the opening bell (round 1, clock at 0), not a resume
--   next_round         always
--   set_round_seconds  only when the length actually changes
--   reset              always
-- Details gain prev_round / prev_red_score / prev_blue_score / prev_round_seconds so the
-- log sentence for a reset can say what was wiped. Signature, grants and behaviour of the
-- scoreboard itself are unchanged (create or replace keeps the existing grants).

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

  v_elapsed := least(v_s.round_seconds, v_s.accumulated_seconds
                 + case when v_s.running
                        then greatest(0, floor(extract(epoch from (now() - v_s.round_started_at))))::int
                        else 0 end);

  if v_action = 'start' then
    if not v_s.running then
      if v_elapsed >= v_s.round_seconds then raise exception 'ROUND_OVER'; end if;
      v_log := v_s.round = 1 and v_elapsed = 0;          -- the opening bell, not a resume
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
    v_log := true;
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
    v_log := p_value <> v_s.round_seconds;
    v_s.round_seconds := p_value;
    v_s.accumulated_seconds := least(v_elapsed, p_value);
    if v_s.running then v_s.round_started_at := now(); end if;
  elsif v_action = 'reset' then
    v_log := true;
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

  -- Only the moments that change the bout are logged: the opening bell (first start of round 1),
  -- moving to the next round, changing the round length, and a reset. Score taps and pause/resume
  -- are not: live_scores.updated_by / updated_at already say who touched the board last.
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
