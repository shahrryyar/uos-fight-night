-- UoS Fight Night — schema, indexes, RLS, table grants.
-- Source of truth: CONTRACT.md. All mutations go through security definer RPCs
-- (see 20261102000002_functions.sql); clients only ever SELECT, filtered by RLS.

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Internal helpers live here; never exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.fighters (
  id          uuid primary key default gen_random_uuid(),
  nickname    text not null unique check (length(btrim(nickname)) between 1 and 40),
  weight_kg   numeric(5,1) null check (weight_kg is null or weight_kg > 0),
  catchphrase text null check (catchphrase is null or length(catchphrase) <= 200),
  photo_path  text null,
  elo         int not null default 1000,
  wins        int not null default 0,
  losses      int not null default 0,
  streak      int not null default 0,  -- +n win streak, -n loss streak
  hidden      boolean not null default false,
  created_at  timestamptz default now()
);

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     extensions.citext unique not null check (username::text ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (display_name is null or length(display_name) <= 40),
  role         text not null default 'member' check (role in ('member', 'admin')),
  fighter_id   uuid null unique references public.fighters (id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz default now()
);

create table public.invites (
  code       text primary key check (code ~ '^[A-Z0-9]{4,32}$'),
  created_by uuid references public.profiles (id) on delete set null,
  max_uses   int not null default 1 check (max_uses >= 1),
  uses       int not null default 0 check (uses >= 0),
  expires_at timestamptz null,
  revoked    boolean not null default false,
  created_at timestamptz default now()
);

create table public.fights (
  id              uuid primary key default gen_random_uuid(),
  title           text null check (title is null or length(title) <= 80),
  red_fighter_id  uuid not null references public.fighters (id),
  blue_fighter_id uuid not null references public.fighters (id),
  scheduled_at    timestamptz not null,
  lock_at         timestamptz not null,
  status          text not null default 'open'
                  check (status in ('scheduled', 'open', 'locked', 'settled', 'cancelled')),
  winner_side     text null check (winner_side in ('red', 'blue')),
  method          text null check (method in ('pin', 'submission', 'decision')),
  result_note     text null,
  recorded_by     uuid null references public.profiles (id) on delete set null,
  settled_at      timestamptz null,
  red_elo_before  int null,
  blue_elo_before int null,
  elo_delta       int null,   -- change applied to red (blue got -elo_delta)
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz default now(),
  check (red_fighter_id <> blue_fighter_id),
  check (status <> 'settled' or (winner_side is not null and method is not null))
);
create index fights_status_scheduled_idx on public.fights (status, scheduled_at);
create index fights_red_idx on public.fights (red_fighter_id);
create index fights_blue_idx on public.fights (blue_fighter_id);

create table public.votes (
  fight_id       uuid references public.fights (id) on delete cascade,
  user_id        uuid references public.profiles (id) on delete cascade,
  side           text not null check (side in ('red', 'blue')),
  is_participant boolean not null default false,
  updated_at     timestamptz default now(),
  primary key (fight_id, user_id)
);
create index votes_user_idx on public.votes (user_id);

create table public.bets (
  id         uuid primary key default gen_random_uuid(),
  fight_id   uuid not null references public.fights (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  side       text not null check (side in ('red', 'blue')),
  amount     int not null check (amount >= 10),
  status     text not null default 'active'
             check (status in ('active', 'cancelled', 'won', 'lost', 'refunded')),
  payout     int null,
  created_at timestamptz default now()
);
create unique index bets_one_active_per_fight on public.bets (fight_id, user_id) where status = 'active';
create index bets_fight_idx on public.bets (fight_id);
create index bets_user_idx on public.bets (user_id);

create table public.points_ledger (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  delta      int not null,
  reason     text not null check (reason in ('signup', 'weekly', 'topup', 'bet', 'bet_cancel',
                                             'payout', 'refund', 'admin_adjust')),
  ref_id     uuid null,
  note       text null,
  created_at timestamptz default now()
);
create index points_ledger_user_idx on public.points_ledger (user_id, created_at desc);

create table public.fight_pools (
  fight_id   uuid primary key references public.fights (id) on delete cascade,
  red_total  int not null default 0 check (red_total >= 0),
  blue_total int not null default 0 check (blue_total >= 0),
  red_count  int not null default 0 check (red_count >= 0),
  blue_count int not null default 0 check (blue_count >= 0)
);

create table public.reactions (
  fight_id   uuid references public.fights (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  emoji      text not null check (emoji in ('🔥', '💀', '😂', '💪', '👑', '😱')),
  created_at timestamptz default now(),
  primary key (fight_id, user_id, emoji)
);

create table public.admin_log (
  id         bigserial primary key,
  actor      uuid references public.profiles (id) on delete set null,
  action     text not null,
  target_id  uuid null,
  details    jsonb,
  created_at timestamptz default now()
);
create index admin_log_created_idx on public.admin_log (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS (default deny; SELECT-only policies — no client writes at all)
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.invites       enable row level security;
alter table public.fighters      enable row level security;
alter table public.fights        enable row level security;
alter table public.votes         enable row level security;
alter table public.bets          enable row level security;
alter table public.points_ledger enable row level security;
alter table public.fight_pools   enable row level security;
alter table public.reactions     enable row level security;
alter table public.admin_log     enable row level security;

-- own row always readable (so a deactivated user can see they are deactivated)
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_member()));

create policy invites_select_admin on public.invites for select to authenticated
  using ((select public.is_admin()));

create policy fighters_select on public.fighters for select to authenticated
  using ((select public.is_member()) and (not hidden or (select public.is_admin())));

create policy fights_select on public.fights for select to authenticated
  using ((select public.is_member()));

create policy votes_select_own on public.votes for select to authenticated
  using (user_id = (select auth.uid()));

create policy bets_select on public.bets for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select public.is_member())
      and exists (
        select 1 from public.fights f
        where f.id = bets.fight_id and f.status in ('locked', 'settled', 'cancelled')
      )
    )
  );

create policy ledger_select on public.points_ledger for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy fight_pools_select on public.fight_pools for select to authenticated
  using ((select public.is_member()));

create policy reactions_select on public.reactions for select to authenticated
  using ((select public.is_member()));

-- Members see the log for transparency, except invite_* rows (admin only,
-- matching the invites table). Codes are also masked in the details.
create policy admin_log_select on public.admin_log for select to authenticated
  using ((select public.is_member()) and (action not like 'invite\_%' or (select public.is_admin())));

-- ---------------------------------------------------------------------------
-- Table privileges: anon gets nothing; authenticated gets SELECT only.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;

grant select on public.profiles, public.invites, public.fighters, public.fights, public.votes,
                public.bets, public.points_ledger, public.fight_pools, public.reactions,
                public.admin_log
  to authenticated;

-- The before_user_created hook runs as supabase_auth_admin. The hook itself is
-- security definer, but grant read access as defence in depth.
grant usage on schema public to supabase_auth_admin;
grant select on public.invites, public.profiles to supabase_auth_admin;
create policy invites_select_auth_admin on public.invites for select to supabase_auth_admin using (true);
create policy profiles_select_auth_admin on public.profiles for select to supabase_auth_admin using (true);
