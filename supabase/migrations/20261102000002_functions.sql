-- UoS Fight Night — auth hook, signup trigger, RPCs, views, function grants.
-- Every function: security definer, set search_path = '', fully-qualified names.
-- Error codes are raised as the exception message (e.g. 'FIGHT_LOCKED') and are
-- mapped to friendly text by src/lib/supabase.ts friendlyError().

-- ===========================================================================
-- Private helpers (schema private is not exposed and not granted to clients)
-- ===========================================================================
create or replace function private.require_member()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p where p.id = v_uid and p.active
  ) then
    raise exception 'NOT_MEMBER' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function private.require_admin()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p where p.id = v_uid and p.active and p.role = 'admin'
  ) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function private.balance_of(p_user uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.delta), 0)::int from public.points_ledger l where l.user_id = p_user;
$$;

create or replace function private.log(p_actor uuid, p_action text, p_target uuid, p_details jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.admin_log (actor, action, target_id, details)
  values (p_actor, p_action, p_target, p_details);
$$;

-- Masked invite code for admin_log: first 2 chars + '******'.
create or replace function private.invite_hint(p_code text)
returns text
language sql immutable security definer set search_path = ''
as $$
  select left(p_code, 2) || '******';
$$;

-- Refund every active bet of a fight (used by cancel and zero-winner settle).
create or replace function private.refund_active_bets(p_fight_id uuid, p_note text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
  n int := 0;
begin
  for b in
    select * from public.bets
    where fight_id = p_fight_id and status = 'active'
    order by created_at, id
    for update
  loop
    update public.bets set status = 'refunded', payout = b.amount where id = b.id;
    insert into public.points_ledger (user_id, delta, reason, ref_id, note)
    values (b.user_id, b.amount, 'refund', b.id, p_note);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ===========================================================================
-- Auth: before_user_created hook + handle_new_user trigger
-- ===========================================================================
-- Hook payload: { "metadata": {...}, "user": { "email": ..., "user_metadata": {...} } }
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_meta     jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
  v_username text  := lower(btrim(coalesce(v_meta ->> 'username', '')));
  v_code     text  := upper(btrim(coalesce(v_meta ->> 'invite_code', '')));
  v_email    text  := lower(coalesce(event -> 'user' ->> 'email', ''));
  v_inv      public.invites%rowtype;
begin
  if v_username !~ '^[a-z0-9_]{3,20}$'
     or v_email <> v_username || '@members.uosfight.local' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'INVALID_USERNAME'));
  end if;

  select * into v_inv from public.invites i where i.code = v_code;
  if not found
     or v_inv.revoked
     or v_inv.uses >= v_inv.max_uses
     or (v_inv.expires_at is not null and v_inv.expires_at <= now()) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'INVALID_INVITE'));
  end if;

  if exists (select 1 from public.profiles p where lower(p.username::text) = v_username) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'USERNAME_TAKEN'));
  end if;

  return '{}'::jsonb;
end;
$$;

-- Runs inside the auth.users insert transaction: re-validates the invite under a
-- row lock (so two racing signups can't both take the last use), creates the
-- profile and grants the 1000-point signup bonus.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_code     text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  v_inv      public.invites%rowtype;
begin
  -- same rules as the hook, so signup stays closed even if the hook is disabled
  if v_username !~ '^[a-z0-9_]{3,20}$'
     or lower(coalesce(new.email, '')) <> v_username || '@members.uosfight.local' then
    raise exception 'INVALID_USERNAME';
  end if;

  select * into v_inv from public.invites i where i.code = v_code for update;
  if not found
     or v_inv.revoked
     or v_inv.uses >= v_inv.max_uses
     or (v_inv.expires_at is not null and v_inv.expires_at <= now()) then
    raise exception 'INVALID_INVITE';
  end if;

  update public.invites set uses = uses + 1 where code = v_inv.code;

  begin
    insert into public.profiles (id, username) values (new.id, v_username);
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN';
  end;

  insert into public.points_ledger (user_id, delta, reason, note)
  values (new.id, 1000, 'signup', 'Welcome to Fight Night (invite ' || v_inv.code || ')');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- Member RPCs
-- ===========================================================================
create or replace function public.my_balance()
returns int
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_member();
begin
  return private.balance_of(v_uid);
end;
$$;

create or replace function public.cast_vote(p_fight_id uuid, p_side text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_member();
  v_f   public.fights%rowtype;
  v_fid uuid;
begin
  if p_side is null or p_side not in ('red', 'blue') then
    raise exception 'INVALID_SIDE';
  end if;

  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status <> 'open' or now() >= v_f.lock_at then
    raise exception 'FIGHT_LOCKED';
  end if;

  select p.fighter_id into v_fid from public.profiles p where p.id = v_uid;

  insert into public.votes (fight_id, user_id, side, is_participant, updated_at)
  values (p_fight_id, v_uid, p_side,
          coalesce(v_fid in (v_f.red_fighter_id, v_f.blue_fighter_id), false), now())
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
  v_fid     uuid;
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
  select p.fighter_id into v_fid from public.profiles p where p.id = v_uid for update;
  if v_fid is not null and v_fid in (v_f.red_fighter_id, v_f.blue_fighter_id) then
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

create or replace function public.cancel_bet(p_bet_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_member();
  v_fight uuid;
  v_f     public.fights%rowtype;
  v_b     public.bets%rowtype;
begin
  select b.fight_id into v_fight from public.bets b where b.id = p_bet_id and b.user_id = v_uid;
  if not found then raise exception 'BET_NOT_FOUND'; end if;

  select * into v_f from public.fights where id = v_fight for update;
  perform 1 from public.profiles p where p.id = v_uid for update;
  select * into v_b from public.bets where id = p_bet_id for update;

  if v_b.status <> 'active' then raise exception 'BET_NOT_ACTIVE'; end if;
  if v_f.status <> 'open' or now() >= v_f.lock_at then
    raise exception 'FIGHT_LOCKED';
  end if;

  update public.bets set status = 'cancelled', payout = null where id = p_bet_id;

  insert into public.points_ledger (user_id, delta, reason, ref_id)
  values (v_uid, v_b.amount, 'bet_cancel', p_bet_id);

  update public.fight_pools
     set red_total  = red_total  - case when v_b.side = 'red'  then v_b.amount else 0 end,
         red_count  = red_count  - case when v_b.side = 'red'  then 1 else 0 end,
         blue_total = blue_total - case when v_b.side = 'blue' then v_b.amount else 0 end,
         blue_count = blue_count - case when v_b.side = 'blue' then 1 else 0 end
   where fight_id = v_fight;
end;
$$;

create or replace function public.toggle_reaction(p_fight_id uuid, p_emoji text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_member();
begin
  if p_emoji is null or p_emoji not in ('🔥', '💀', '😂', '💪', '👑', '😱') then
    raise exception 'INVALID_EMOJI';
  end if;
  if not exists (select 1 from public.fights f where f.id = p_fight_id) then
    raise exception 'FIGHT_NOT_FOUND';
  end if;

  delete from public.reactions
   where fight_id = p_fight_id and user_id = v_uid and emoji = p_emoji;
  if found then
    return false;
  end if;

  insert into public.reactions (fight_id, user_id, emoji)
  values (p_fight_id, v_uid, p_emoji)
  on conflict do nothing;
  return true;
end;
$$;

-- Crowd totals: only for locked/settled fights; participant votes excluded.
create or replace function public.get_fight_vote_totals(p_fight_id uuid)
returns table (red_votes int, blue_votes int, red_pct numeric, blue_pct numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_member();
  return query
    select t.red_votes, t.blue_votes,
           case when t.red_votes + t.blue_votes = 0 then 0::numeric
                else round(100.0 * t.red_votes / (t.red_votes + t.blue_votes), 1) end,
           case when t.red_votes + t.blue_votes = 0 then 0::numeric
                else round(100.0 * t.blue_votes / (t.red_votes + t.blue_votes), 1) end
      from (
        select count(*) filter (where v.side = 'red'  and not v.is_participant)::int as red_votes,
               count(*) filter (where v.side = 'blue' and not v.is_participant)::int as blue_votes
          from public.fights f
          left join public.votes v on v.fight_id = f.id
         where f.id = p_fight_id and f.status in ('locked', 'settled')
         group by f.id
      ) t;
end;
$$;

-- Backs the fight_vote_totals view (all locked/settled fights at once).
create or replace function public.get_all_fight_vote_totals()
returns table (fight_id uuid, red_votes int, blue_votes int, red_pct numeric, blue_pct numeric)
language sql stable security definer set search_path = ''
as $$
  select t.fight_id, t.red_votes, t.blue_votes,
         case when t.red_votes + t.blue_votes = 0 then 0::numeric
              else round(100.0 * t.red_votes / (t.red_votes + t.blue_votes), 1) end,
         case when t.red_votes + t.blue_votes = 0 then 0::numeric
              else round(100.0 * t.blue_votes / (t.red_votes + t.blue_votes), 1) end
    from (
      select f.id as fight_id,
             count(v.*) filter (where v.side = 'red'  and not v.is_participant)::int as red_votes,
             count(v.*) filter (where v.side = 'blue' and not v.is_participant)::int as blue_votes
        from public.fights f
        left join public.votes v on v.fight_id = f.id
       where f.status in ('locked', 'settled') and public.is_member()
       group by f.id
    ) t;
$$;

-- Backs the leaderboard_bettors view: everyone's balance is public to members.
create or replace function public.get_leaderboard_bettors()
returns table (user_id uuid, username text, balance int, rank int)
language sql stable security definer set search_path = ''
as $$
  select b.user_id, b.username, b.balance,
         (rank() over (order by b.balance desc))::int
    from (
      select p.id as user_id, p.username::text as username,
             coalesce(sum(l.delta), 0)::int as balance
        from public.profiles p
        left join public.points_ledger l on l.user_id = p.id
       where p.active and public.is_member()
       group by p.id, p.username
    ) b
   order by b.balance desc, b.username;
$$;

-- ===========================================================================
-- Public (anon) RPC — landing page. Nicknames only, nothing else.
-- ===========================================================================
create or replace function public.public_next_fight()
returns table (id uuid, title text, lock_at timestamptz, scheduled_at timestamptz,
               status text, red_nickname text, blue_nickname text)
language sql stable security definer set search_path = ''
as $$
  select f.id, f.title, f.lock_at, f.scheduled_at, f.status, r.nickname, b.nickname
    from public.fights f
    join public.fighters r on r.id = f.red_fighter_id
    join public.fighters b on b.id = f.blue_fighter_id
   where f.status in ('open', 'locked')
   order by f.scheduled_at asc, f.created_at asc
   limit 1;
$$;

-- ===========================================================================
-- Admin RPCs (every one writes admin_log)
-- ===========================================================================
create or replace function public.admin_upsert_fighter(
  p_id uuid, p_nickname text, p_weight_kg numeric, p_catchphrase text,
  p_photo_path text, p_hidden boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_id  uuid;
  v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if v_nick = '' then raise exception 'INVALID_NICKNAME'; end if;
  if p_photo_path is not null and p_photo_path !~ '^fighters/[0-9a-f-]{36}/[^/]+\.(webp|jpg|jpeg|png)$' then
    raise exception 'INVALID_PHOTO_PATH';
  end if;

  begin
    if p_id is null then
      insert into public.fighters (nickname, weight_kg, catchphrase, photo_path, hidden)
      values (v_nick, p_weight_kg, nullif(btrim(p_catchphrase), ''), p_photo_path, coalesce(p_hidden, false))
      returning id into v_id;
      perform private.log(v_uid, 'fighter_create', v_id, jsonb_build_object('nickname', v_nick));
    else
      update public.fighters
         set nickname    = v_nick,
             weight_kg   = p_weight_kg,
             catchphrase = nullif(btrim(p_catchphrase), ''),
             photo_path  = p_photo_path,
             hidden      = coalesce(p_hidden, hidden)
       where id = p_id
      returning id into v_id;
      if v_id is null then raise exception 'FIGHTER_NOT_FOUND'; end if;
      perform private.log(v_uid, 'fighter_update', v_id, jsonb_build_object(
        'nickname', v_nick, 'weight_kg', p_weight_kg, 'hidden', p_hidden, 'photo_path', p_photo_path));
    end if;
  exception when unique_violation then
    raise exception 'NICKNAME_TAKEN';
  end;
  return v_id;
end;
$$;

create or replace function public.admin_create_fight(
  p_red uuid, p_blue uuid, p_scheduled_at timestamptz, p_lock_at timestamptz, p_title text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_id  uuid;
begin
  if p_red is null or p_blue is null or p_red = p_blue then
    raise exception 'INVALID_FIGHTERS';
  end if;
  if (select count(*) from public.fighters f where f.id in (p_red, p_blue)) <> 2 then
    raise exception 'FIGHTER_NOT_FOUND';
  end if;
  if p_scheduled_at is null or p_lock_at is null then
    raise exception 'INVALID_TIME';
  end if;

  insert into public.fights (title, red_fighter_id, blue_fighter_id, scheduled_at, lock_at, status, created_by)
  values (nullif(btrim(p_title), ''), p_red, p_blue, p_scheduled_at, p_lock_at, 'open', v_uid)
  returning id into v_id;

  insert into public.fight_pools (fight_id) values (v_id);

  perform private.log(v_uid, 'fight_create', v_id, jsonb_build_object(
    'red', p_red, 'blue', p_blue, 'scheduled_at', p_scheduled_at, 'lock_at', p_lock_at, 'title', p_title));
  return v_id;
end;
$$;

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
  if v_f.status not in ('open', 'scheduled') then raise exception 'FIGHT_NOT_OPEN'; end if;

  update public.fights set status = 'locked' where id = p_fight_id;
  perform private.log(v_uid, 'fight_lock', p_fight_id, null);
end;
$$;

create or replace function public.admin_settle_fight(
  p_fight_id uuid, p_winner_side text, p_method text, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := private.require_admin();
  v_f          public.fights%rowtype;
  v_my_fighter uuid;
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
begin
  if p_winner_side is null or p_winner_side not in ('red', 'blue') then
    raise exception 'INVALID_SIDE';
  end if;
  if p_method is null or p_method not in ('pin', 'submission', 'decision') then
    raise exception 'INVALID_METHOD';
  end if;

  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status = 'settled' then raise exception 'ALREADY_SETTLED'; end if;
  if v_f.status = 'cancelled' then raise exception 'FIGHT_CANCELLED'; end if;
  -- status open/scheduled (before or after lock_at): the fight row lock above
  -- already blocks any new bets/votes, and we flip it to settled below.

  select p.fighter_id into v_my_fighter from public.profiles p where p.id = v_uid;
  if v_my_fighter is not null and v_my_fighter in (v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;
  if exists (
    select 1 from public.bets bb
    where bb.fight_id = p_fight_id and bb.user_id = v_uid and bb.status = 'active'
  ) then
    raise exception 'ADMIN_HAS_BET';
  end if;

  -- ---- Elo / record --------------------------------------------------------
  select * into v_red  from public.fighters where id = v_f.red_fighter_id  for update;
  select * into v_blue from public.fighters where id = v_f.blue_fighter_id for update;

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
         result_note     = nullif(btrim(p_note), ''),
         recorded_by     = v_uid,
         settled_at      = now(),
         red_elo_before  = v_red.elo,
         blue_elo_before = v_blue.elo,
         elo_delta       = v_delta
   where id = p_fight_id;

  perform private.log(v_uid, 'fight_settle', p_fight_id, jsonb_build_object(
    'winner_side', p_winner_side, 'method', p_method, 'total_pool', v_total,
    'winning_pool', v_win_pool, 'dust', v_dust, 'elo_delta', v_delta, 'refunded', v_refunded));

  return jsonb_build_object(
    'fight_id', p_fight_id,
    'winner_side', p_winner_side,
    'method', p_method,
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

create or replace function public.admin_cancel_fight(p_fight_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_f   public.fights%rowtype;
  v_n   int;
  v_fid uuid;
begin
  select * into v_f from public.fights where id = p_fight_id for update;
  if not found then raise exception 'FIGHT_NOT_FOUND'; end if;
  if v_f.status = 'settled' then raise exception 'ALREADY_SETTLED'; end if;
  if v_f.status = 'cancelled' then raise exception 'FIGHT_CANCELLED'; end if;

  -- Same guards as admin_settle_fight: an admin whose fighter is in the bout,
  -- or who holds an active bet on it, must not be able to void the result
  -- (e.g. cancel a locked fight they know they lost). Another admin can.
  select p.fighter_id into v_fid from public.profiles p where p.id = v_uid;
  if v_fid is not null and v_fid in (v_f.red_fighter_id, v_f.blue_fighter_id) then
    raise exception 'PARTICIPANT';
  end if;
  if exists (
    select 1 from public.bets bb
    where bb.fight_id = p_fight_id and bb.user_id = v_uid and bb.status = 'active'
  ) then
    raise exception 'ADMIN_HAS_BET';
  end if;

  v_n := private.refund_active_bets(p_fight_id, 'Fight cancelled: refund');

  update public.fights
     set status = 'cancelled', result_note = nullif(btrim(p_reason), ''),
         recorded_by = v_uid, settled_at = now()
   where id = p_fight_id;

  perform private.log(v_uid, 'fight_cancel', p_fight_id,
                      jsonb_build_object('reason', p_reason, 'refunded', v_n));
end;
$$;

create or replace function public.admin_create_invite(p_max_uses int, p_expires_at timestamptz)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := private.require_admin();
  -- 32 symbols, no I/O/0/1: byte % 32 is unbiased
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    bytea;
  v_code     text;
  i          int;
begin
  if p_max_uses is not null and p_max_uses < 1 then raise exception 'INVALID_MAX_USES'; end if;
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.invites where code = v_code);
  end loop;

  insert into public.invites (code, created_by, max_uses, expires_at)
  values (v_code, v_uid, coalesce(p_max_uses, 1), p_expires_at);

  -- Never log the plaintext code: admin_log is readable beyond the invites
  -- table's admin-only RLS. A short hint is enough to tell codes apart.
  perform private.log(v_uid, 'invite_create', null, jsonb_build_object(
    'code_hint', private.invite_hint(v_code), 'max_uses', coalesce(p_max_uses, 1), 'expires_at', p_expires_at));
  return v_code;
end;
$$;

create or replace function public.admin_revoke_invite(p_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_admin();
begin
  update public.invites set revoked = true where code = upper(btrim(p_code));
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  perform private.log(v_uid, 'invite_revoke', null,
                      jsonb_build_object('code_hint', private.invite_hint(upper(btrim(p_code)))));
end;
$$;

-- p_active / p_role: null = keep current. p_fighter_id is always applied (null = unlink).
create or replace function public.admin_set_member(
  p_user_id uuid, p_active boolean, p_role text, p_fighter_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := private.require_admin();
  v_p          public.profiles%rowtype;
  v_new_role   text;
  v_new_active boolean;
begin
  if p_role is not null and p_role not in ('member', 'admin') then
    raise exception 'INVALID_ROLE';
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

  begin
    update public.profiles
       set role = v_new_role, active = v_new_active, fighter_id = p_fighter_id
     where id = p_user_id;
  exception when unique_violation then
    raise exception 'FIGHTER_ALREADY_LINKED';
  end;

  perform private.log(v_uid, 'member_update', p_user_id, jsonb_build_object(
    'active', v_new_active, 'role', v_new_role, 'fighter_id', p_fighter_id,
    'prev', jsonb_build_object('active', v_p.active, 'role', v_p.role, 'fighter_id', v_p.fighter_id)));
end;
$$;

create or replace function public.admin_adjust_points(p_user_id uuid, p_delta int, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_admin();
begin
  if p_delta is null or p_delta = 0 then raise exception 'INVALID_DELTA'; end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if private.balance_of(p_user_id) + p_delta < 0 then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  insert into public.points_ledger (user_id, delta, reason, note)
  values (p_user_id, p_delta, 'admin_adjust', nullif(btrim(p_note), ''));

  perform private.log(v_uid, 'points_adjust', p_user_id,
                      jsonb_build_object('delta', p_delta, 'note', p_note));
end;
$$;

-- ===========================================================================
-- Cron jobs (bodies; scheduled in 20261102000003)
-- ===========================================================================
create or replace function private.auto_lock_fights()
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  update public.fights set status = 'locked'
   where status = 'open' and lock_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- +100 to every active member, then top anyone below 10 up to 100.
-- Guarded so a duplicate run in the same week does nothing.
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
   where b.bal < 10;

  return v_n;
end;
$$;

-- ===========================================================================
-- Views (security_invoker = on)
-- ===========================================================================
create or replace view public.balances with (security_invoker = on) as
  select l.user_id, p.username::text as username, sum(l.delta)::int as balance
    from public.points_ledger l
    join public.profiles p on p.id = l.user_id
   group by l.user_id, p.username;

create or replace view public.leaderboard_bettors with (security_invoker = on) as
  select user_id, username, balance, rank from public.get_leaderboard_bettors();

create or replace view public.fighter_rankings with (security_invoker = on) as
  select x.fighter_id, x.nickname, x.elo, x.wins, x.losses, x.streak, x.fights,
         x.fights >= 3 as ranked,
         case when x.fights >= 3
              then (rank() over (partition by x.fights >= 3 order by x.elo desc))::int end as rank
    from (
      select f.id as fighter_id, f.nickname, f.elo, f.wins, f.losses, f.streak,
             (f.wins + f.losses) as fights
        from public.fighters f
       where not f.hidden
    ) x;

create or replace view public.fight_vote_totals with (security_invoker = on) as
  select fight_id, red_votes, blue_votes, red_pct, blue_pct from public.get_all_fight_vote_totals();

revoke all on public.balances, public.leaderboard_bettors, public.fighter_rankings,
              public.fight_vote_totals from anon, authenticated, public;
grant select on public.balances, public.leaderboard_bettors, public.fighter_rankings,
                public.fight_vote_totals to authenticated;

-- ===========================================================================
-- Function privileges
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
  public.admin_upsert_fighter(uuid, text, numeric, text, text, boolean),
  public.admin_create_fight(uuid, uuid, timestamptz, timestamptz, text),
  public.admin_lock_fight(uuid),
  public.admin_settle_fight(uuid, text, text, text),
  public.admin_cancel_fight(uuid, text),
  public.admin_create_invite(int, timestamptz),
  public.admin_revoke_invite(text),
  public.admin_set_member(uuid, boolean, text, uuid),
  public.admin_adjust_points(uuid, int, text)
to authenticated;

grant execute on function public.public_next_fight() to anon;

-- Auth hook: only the auth server may call it.
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
-- trigger function: not callable by clients (revoked above), runs as owner.
