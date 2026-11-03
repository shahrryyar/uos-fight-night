-- C5 callouts fixes (on top of 20261103000013_wave_c.sql). RPC signatures and grants unchanged.
--
-- 1. Moderated text no longer leaks through admin_log (readable by every member).
--    A BEFORE INSERT trigger on admin_log strips details.message from 'callout_delete' and
--    details.title from 'title_reject' (whichever migration last defined those RPCs), keeping only
--    the length. Existing rows are redacted the same way. The moderation record keeps who, when,
--    status, fighters and the admin's reason.
-- 2. Callout spam limits in create_callout:
--    - CALLOUT_COOLDOWN: the same challenger -> target pair had a callout declined or rejected in
--      the last 7 days, or the challenger already made 2 callouts to that target in the last 24h
--      (withdrawn and admin-deleted ones count).
--    - CALLOUT_DAILY_LIMIT: the challenger already made 5 callouts in the last 24h, any status.
--    Every successful create is recorded in private.callout_attempts, which survives
--    withdraw_callout / admin_delete_callout (both still hard-delete the callout row).
-- 3. Invisible / bidi-control characters (zero-width, LRM/RLM, LRE..RLO, LRI..PDI, BOM, soft
--    hyphen, Hangul fillers, tag characters) are refused with INVALID_MESSAGE in callout messages
--    and INVALID_REASON in admin reject/delete reasons. A message of only spaces/no-break spaces is
--    stored as null (like a blank one).
-- 4. callout_board exposes the booked fight's state: fight_status, fight_cancel_kind,
--    fight_scheduled_at (appended columns), so a booked callout whose fight was declined or
--    cancelled can read "Called off".

-- ---------------------------------------------------------------------------
-- 1. admin_log redaction
-- ---------------------------------------------------------------------------
create or replace function private.redact_admin_log_details(p_action text, p_details jsonb)
returns jsonb
language sql immutable security definer set search_path = ''
as $$
  select case
    when p_details is null or jsonb_typeof(p_details) <> 'object' then p_details
    when p_action = 'callout_delete' and p_details ? 'message' then
      (p_details - 'message') || jsonb_build_object('message_len', char_length(p_details ->> 'message'))
    when p_action = 'title_reject' and p_details ? 'title' then
      (p_details - 'title') || jsonb_build_object('title_len', char_length(p_details ->> 'title'))
    else p_details
  end;
$$;

create or replace function private.admin_log_redact()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.details := private.redact_admin_log_details(new.action, new.details);
  return new;
end;
$$;

drop trigger if exists admin_log_redact on public.admin_log;
create trigger admin_log_redact before insert or update on public.admin_log
  for each row execute function private.admin_log_redact();

update public.admin_log
   set details = private.redact_admin_log_details(action, details)
 where (action = 'callout_delete' and details ? 'message')
    or (action = 'title_reject' and details ? 'title');

-- ---------------------------------------------------------------------------
-- 3. text hygiene helper
-- ---------------------------------------------------------------------------
-- true when p has a Unicode format / invisible character that can hide or reverse board text.
-- ZWJ (U+200D) and variation selectors stay allowed: emoji sequences need them.
create or replace function private.has_hidden_chars(p text)
returns boolean
language sql immutable security definer set search_path = ''
as $$
  select coalesce(p ~ '[­͏؜ᅟᅠ឴឵᠎​‌‎‏ -‮⁠-⁯ㅤ﻿ﾠ￹-￻\U000E0000-\U000E007F]', false);
$$;

-- ---------------------------------------------------------------------------
-- 2. attempts ledger + create_callout with limits
-- ---------------------------------------------------------------------------
create table if not exists private.callout_attempts (
  id                    bigserial primary key,
  challenger_fighter_id uuid not null references public.fighters (id) on delete cascade,
  target_fighter_id     uuid not null references public.fighters (id) on delete cascade,
  created_at            timestamptz not null default now()
);
create index if not exists callout_attempts_challenger_idx
  on private.callout_attempts (challenger_fighter_id, created_at desc);
revoke all on private.callout_attempts from public, anon, authenticated;
revoke all on sequence private.callout_attempts_id_seq from public, anon, authenticated;

-- existing callouts count as attempts (so the limits hold from the first deploy)
insert into private.callout_attempts (challenger_fighter_id, target_fighter_id, created_at)
select c.challenger_fighter_id, c.target_fighter_id, c.created_at
  from public.callouts c
 where c.created_at > now() - interval '24 hours'
   and not exists (select 1 from private.callout_attempts a
                    where a.challenger_fighter_id = c.challenger_fighter_id
                      and a.target_fighter_id = c.target_fighter_id
                      and a.created_at = c.created_at);

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
  if v_msg is not null and (char_length(v_msg) > 140 or v_msg ~ '[[:cntrl:]]' or private.has_hidden_chars(v_msg)) then
    raise exception 'INVALID_MESSAGE';
  end if;
  -- only spaces / no-break spaces / joiners: same as no message
  if v_msg is not null and v_msg !~ '[^[:space:]   - ‍  　︀-️]' then
    v_msg := null;
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

  -- serialise per challenger (limits) and per pair (one open callout), fixed order
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
  -- the target (or an admin) said no recently
  if exists (
    select 1 from public.callouts c
     where c.challenger_fighter_id = v_me and c.target_fighter_id = v_target
       and ((c.status = 'declined' and coalesce(c.responded_at, c.created_at) > now() - interval '7 days')
         or (c.status = 'rejected' and coalesce(c.decided_at, c.created_at) > now() - interval '7 days'))
  ) then
    raise exception 'CALLOUT_COOLDOWN';
  end if;
  -- withdraw + resend loops on one target
  if (select count(*) from private.callout_attempts a
       where a.challenger_fighter_id = v_me and a.target_fighter_id = v_target
         and a.created_at > now() - interval '24 hours') >= 2 then
    raise exception 'CALLOUT_COOLDOWN';
  end if;
  if (select count(*) from private.callout_attempts a
       where a.challenger_fighter_id = v_me and a.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'CALLOUT_DAILY_LIMIT';
  end if;

  insert into public.callouts (challenger_fighter_id, target_fighter_id, message, rematch_of, created_by)
  values (v_me, v_target, v_msg, p_rematch_of, v_uid)
  returning id into v_id;
  insert into private.callout_attempts (challenger_fighter_id, target_fighter_id)
  values (v_me, v_target);
  return v_id;
end;
$$;

-- reasons: same hygiene as messages
create or replace function public.admin_reject_callout(p_callout_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_admin();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_c      public.callouts%rowtype;
begin
  if v_reason is not null and (char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]'
                               or private.has_hidden_chars(v_reason)) then
    raise exception 'INVALID_REASON';
  end if;
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
  if v_reason is not null and (char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]'
                               or private.has_hidden_chars(v_reason)) then
    raise exception 'INVALID_REASON';
  end if;
  v_c := private.lock_callout_for_admin(v_uid, p_callout_id);
  delete from public.callouts where id = p_callout_id;
  -- never the message text: admin_log is readable by every member
  perform private.log(v_uid, 'callout_delete', p_callout_id, jsonb_build_object(
    'reason', v_reason, 'status', v_c.status, 'message_len', char_length(v_c.message),
    'challenger', v_c.challenger_fighter_id, 'target', v_c.target_fighter_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. callout_board: booked fight state (appended columns; existing ones unchanged)
-- ---------------------------------------------------------------------------
create or replace view public.callout_board with (security_invoker = on) as
select c.id, c.status, c.message,
       c.challenger_fighter_id, ch.nickname as challenger_nickname,
       c.target_fighter_id, t.nickname as target_nickname,
       c.rematch_of, c.fight_id, c.created_by, c.created_at, c.responded_at, c.decided_at,
       c.decision_note,
       c.status in ('pending', 'accepted', 'approved') as is_open,
       f.status as fight_status,
       f.cancel_kind as fight_cancel_kind,
       f.scheduled_at as fight_scheduled_at
  from public.callouts c
  join public.fighters ch on ch.id = c.challenger_fighter_id
  join public.fighters t  on t.id  = c.target_fighter_id
  left join public.fights f on f.id = c.fight_id;

revoke all on public.callout_board from anon, public;
grant select on public.callout_board to authenticated;

-- private helpers stay internal (trigger functions are not checked at fire time). They are security
-- definer only to match the project-wide rule (fight_night_test); none reads or writes tables.
revoke execute on function private.redact_admin_log_details(text, jsonb), private.admin_log_redact(),
                           private.has_hidden_chars(text)
  from public, anon, authenticated;
