-- WAVE C fixes (on top of 20261103000013_wave_c.sql). Signatures, grants and return shapes unchanged.
--
-- 1. FOTN window starts when the card became complete, not at the last settle.
--    A card is complete once nothing is scheduled/open/locked. The last bout to
--    leave that state may be a cancellation (admin_cancel_fight / decline_fight),
--    which already stamps fights.settled_at = clock_timestamp() on cancelled rows.
--    The window now opens at max(settled_at) over settled AND cancelled bouts, so
--    cancelling the last bout hours after the other settles still gives members a
--    full 24h vote (it used to close instantly with 0 votes).
--    Cards that 20261103000013 closed at migrate time with no votes but whose
--    corrected window is still open get their (empty) result row dropped.
--
-- 2. admin_reject_title after a season reset refunds 0.
--    admin_end_season resets every balance to exactly 1000, which already
--    absorbs the 500 debit of a pending request made in the old season.
--    Refunding it again in the new season created points. A request created
--    before the current season started is now rejected with refund 0 (no ledger
--    row; admin_log details.refund = 0, details.season_reset = true).
--    request_title now stamps created_at = clock_timestamp() AFTER taking the
--    member's profile lock (admin_end_season locks every profile and stamps the
--    new season's started_at with clock_timestamp() after those locks), so
--    "created before the season started" == "debit counted in the reset", even
--    when the two race.
--
-- 3. get_card_recap returns the champion as of the card, not today's.
--    champion = the reign live at the card's last settle
--    (started_at <= v_end and (ended_at is null or ended_at > v_end)). A title
--    change on the card's last bout counts (reign started_at = settled_at).
--    A card with no settled bout yet (upcoming / in progress before the first
--    result) still shows the current champion. Hidden-fighter filter kept.

-- ---------------------------------------------------------------------------
-- 1. FOTN window
-- ---------------------------------------------------------------------------
create or replace function private.fotn_window(p_card date)
returns table (complete boolean, settled int, opens_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select coalesce(count(*) filter (where f.status in ('scheduled', 'open', 'locked')) = 0
                  and count(*) filter (where f.status = 'settled') > 0, false),
         (count(*) filter (where f.status = 'settled'))::int,
         max(f.settled_at) filter (where f.status in ('settled', 'cancelled')),
         max(f.settled_at) filter (where f.status in ('settled', 'cancelled')) + interval '24 hours'
    from public.fights f
   where f.card_date = p_card;
$$;

-- undo empty early closes made with the old window (no votes -> no winner, no badges, no log)
delete from public.fotn_results r
 where r.winner_fight_id is null
   and r.total_votes = 0
   and (select w.closes_at from private.fotn_window(r.card_date) w) > now();

-- ---------------------------------------------------------------------------
-- 2. Title request rejected after a season reset
-- ---------------------------------------------------------------------------
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

  insert into public.title_requests (user_id, title, price, created_at)
  values (v_uid, v_title, v_i.price, clock_timestamp())
  returning id into v_id;
  insert into public.points_ledger (user_id, delta, reason, ref_id, note)
  values (v_uid, -v_i.price, 'shop', v_id, 'title_custom');
  return v_id;
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
  v_start  timestamptz;
  v_reset  boolean;
  v_refund int;
begin
  if v_reason is not null and char_length(v_reason) > 200 then raise exception 'INVALID_REASON'; end if;
  v_t := private.lock_title_request(v_uid, p_request_id);
  -- the member's profile row serializes against admin_end_season (it locks every profile)
  perform 1 from public.profiles p where p.id = v_t.user_id for update;
  select s.started_at into v_start from public.seasons s where s.ended_at is null;
  v_reset  := v_start is not null and v_t.created_at < v_start;
  v_refund := case when v_reset then 0 else v_t.price end;

  update public.title_requests
     set status = 'rejected', decided_at = now(), decided_by = v_uid, decision_note = v_reason
   where id = p_request_id;
  if v_refund > 0 then
    insert into public.points_ledger (user_id, delta, reason, ref_id, note)
    values (v_t.user_id, v_refund, 'shop_refund', p_request_id, 'title_custom');
  end if;
  perform private.log(v_uid, 'title_reject', p_request_id, jsonb_build_object(
    'user_id', v_t.user_id, 'title', v_t.title, 'reason', v_reason, 'refund', v_refund,
    'season_reset', v_reset));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Card recap champion as of the card
-- ---------------------------------------------------------------------------
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
  v_end    timestamptz;
begin
  if p_card_date is null then raise exception 'INVALID_DATE'; end if;
  v_fotn := private.fotn_state(p_card_date, v_uid);
  v_winner := (v_fotn ->> 'winner_fight_id')::uuid;

  select count(*)::int,
         (count(*) filter (where f.status in ('scheduled', 'open', 'locked')))::int,
         (count(*) filter (where f.status = 'settled'))::int,
         max(f.settled_at) filter (where f.status = 'settled')
    into v_total, v_open, v_settled, v_end
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
   where (not cf.hidden or v_admin)
     and case when v_end is null then c.ended_at is null
              else c.started_at <= v_end and (c.ended_at is null or c.ended_at > v_end) end
   order by c.started_at desc
   limit 1;

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
