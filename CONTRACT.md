# UoS Fight Night — Build Contract (source of truth)

All agents MUST follow this contract exactly. Names, columns, RPC signatures here are binding.
If you need something not listed, add it to your own files and mention it in your final report — do NOT rename anything here.

## Product rules (locked)
- Dorm wrestling league, ~10-20 fighters, <100 users, all 18+. English only. Private: approved members only; `noindex` everywhere.
- **Login: invite code + username + password.** No email, no Google. Implementation: Supabase email/password auth with synthetic email `${username.toLowerCase()}@members.uosfight.local`. Email confirmations OFF. Username: 3-20 chars `[a-z0-9_]`, case-insensitive unique. Password min 8.
  - Signup passes `options.data = { username, invite_code }`. A `before_user_created` auth hook (`public.hook_before_user_created(event jsonb)`) rejects signup unless invite_code is valid (exists, not revoked, uses < max_uses, not expired) and username is free + valid.
  - Trigger `on auth.users insert` → `public.handle_new_user()` creates `profiles` row, consumes invite (uses+1), grants starting 1000 points via ledger. Member approved immediately (invite = approval).
  - Admin can reset a member's password via Edge Function `admin-reset-password` (service role, checks caller is admin) → body `{ user_id, new_password }`.
- Win methods: `pin`, `submission`, `decision`. No draws. Fight can be `cancelled` → all bets refunded, no record change.
- 2+ admins (`profiles.role = 'admin'`). Admin cannot record result of, nor bet on, a fight where their linked fighter is a participant. Admins can't bet on any fight they record (enforced: settle_fight caller must not have a bet on that fight).
- Fight lifecycle: `scheduled` → (`open`) → `locked` → `settled` | `cancelled`. Voting/betting allowed only when status='open' AND now() < lock_at. Admin `lock_fight` or pg_cron auto-lock every minute when now() >= lock_at. Never reopens.
- Voting: one vote per user per fight, changeable until lock, private (users read only their own vote rows). Totals visible only after lock via `fight_vote_totals`. Votes by users linked to a participant fighter are stored but excluded from crowd %.
- Betting (fun points, NO money anywhere in UI copy): pari-mutuel pool. One bet per user per fight; min 10; max = least(500, floor(balance*0.5)); cancel (full refund) any time before lock. Users whose profile is linked to a participant fighter cannot bet on that fight.
  - Settlement: winners get `floor(stake * total_pool / winning_side_pool)`; rounding dust goes to largest winning bettor (tie → earliest bet). If winning side pool = 0 → refund everyone. Cancelled → refund all.
  - Before lock: everyone sees pool total per side + bettor count per side (`fight_pools`). After lock: individual bets visible (who, side, amount).
- Points: start 1000. Weekly (Mon 00:00 Asia/Baghdad = Sun 21:00 UTC) +100 to everyone; also anyone below 10 after the bonus is topped to 100. All balance changes go through `points_ledger`; balance = sum(ledger). Never UPDATE a balance column directly.
- Elo: start 1000, K=32, updated on settle. Ranked if fights >= 3. Profile shows W-L, streak, Elo, last 5 fights, head-to-head, weight, catchphrase, nickname, photo.
- Emoji reactions on fights: fixed set `🔥 💀 😂 💪 👑 😱`. One row per (user, fight, emoji) toggle.
- Photos: admin uploads to private Storage bucket `fighter-photos`; members read via signed URLs (1h). Path `fighters/{fighter_id}/{uuid}.webp|jpg|png`.
- Public landing page (no login): branding, countdown to next fight, matchup by **nickname only, no photos**, "Got an invite? Join" CTA, Login. Data via public RPC `public_next_fight()` (security definer, anon-callable) returning only: fight id, lock_at, status, red nickname, blue nickname, title. Nothing else is anon-readable.

## Database schema (public)
```
profiles(id uuid pk refs auth.users on delete cascade, username citext unique not null, display_name text,
         role text not null default 'member' check (role in ('member','admin')),
         fighter_id uuid null unique refs fighters(id) on delete set null,
         active boolean not null default true, created_at timestamptz default now())
invites(code text pk, created_by uuid refs profiles(id), max_uses int not null default 1, uses int not null default 0,
        expires_at timestamptz null, revoked boolean not null default false, created_at timestamptz default now())
fighters(id uuid pk default gen_random_uuid(), nickname text not null unique, weight_kg numeric(5,1) null,
         catchphrase text null, photo_path text null, elo int not null default 1000,
         wins int not null default 0, losses int not null default 0, streak int not null default 0,  -- +n win streak, -n loss streak
         hidden boolean not null default false, created_at timestamptz default now())
fights(id uuid pk default gen_random_uuid(), title text null, red_fighter_id uuid not null refs fighters, blue_fighter_id uuid not null refs fighters,
       scheduled_at timestamptz not null, lock_at timestamptz not null,
       status text not null default 'open' check (status in ('scheduled','open','locked','settled','cancelled')),
       winner_side text null check (winner_side in ('red','blue')), method text null check (method in ('pin','submission','decision')),
       result_note text null, recorded_by uuid null refs profiles, settled_at timestamptz null,
       red_elo_before int null, blue_elo_before int null, elo_delta int null,
       created_by uuid refs profiles, created_at timestamptz default now(),
       check (red_fighter_id <> blue_fighter_id))
votes(fight_id uuid refs fights on delete cascade, user_id uuid refs profiles on delete cascade, side text check (side in ('red','blue')) not null,
      is_participant boolean not null default false, updated_at timestamptz default now(), primary key(fight_id,user_id))
bets(id uuid pk default gen_random_uuid(), fight_id uuid refs fights on delete cascade, user_id uuid refs profiles on delete cascade,
     side text not null check (side in ('red','blue')), amount int not null check (amount >= 10),
     status text not null default 'active' check (status in ('active','cancelled','won','lost','refunded')),
     payout int null, created_at timestamptz default now(), unique(fight_id,user_id) where status='active' -- partial unique index)
points_ledger(id bigserial pk, user_id uuid refs profiles on delete cascade, delta int not null,
              reason text not null check (reason in ('signup','weekly','topup','bet','bet_cancel','payout','refund','admin_adjust')),
              ref_id uuid null, note text null, created_at timestamptz default now())
fight_pools(fight_id uuid pk refs fights on delete cascade, red_total int not null default 0, blue_total int not null default 0,
            red_count int not null default 0, blue_count int not null default 0)   -- maintained by RPCs, readable by members; realtime-enabled
reactions(fight_id uuid refs fights on delete cascade, user_id uuid refs profiles on delete cascade, emoji text not null check (emoji in ('🔥','💀','😂','💪','👑','😱')),
          created_at timestamptz default now(), primary key(fight_id,user_id,emoji))
admin_log(id bigserial pk, actor uuid refs profiles, action text not null, target_id uuid null, details jsonb, created_at timestamptz default now())
```
Views (security_invoker = on):
- `balances(user_id, username, balance)` = sum(points_ledger.delta) per profile.
- `leaderboard_bettors(user_id, username, balance, rank)`.
- `fighter_rankings(fighter_id, nickname, elo, wins, losses, streak, fights, ranked boolean, rank)` (rank only for ranked, by elo desc).
- `fight_vote_totals(fight_id, red_votes, blue_votes, red_pct, blue_pct)` — counts exclude is_participant; returns rows ONLY for fights with status in ('locked','settled'). Implement as security definer function `get_fight_vote_totals(p_fight_id uuid)` returning that row (null-ish/empty when not locked) — do NOT expose raw votes.

## RLS (enable on every table; default deny)
Helper fns (security definer, stable, `set search_path = ''`): `public.is_member()` (auth.uid() has active profile), `public.is_admin()`.
- profiles: members select all (only id, username, display_name, role, fighter_id, active — no secrets exist). Update own display_name only via RPC. Admin updates via RPC.
- invites: admin only (select/insert/update). Anon none.
- fighters: members select where not hidden (admins all). Writes admin only.
- fights: members select. Writes only through RPCs (no direct insert/update grants to authenticated).
- votes: user selects own rows only. Writes only via RPC `cast_vote`.
- bets: user selects own; anyone member selects all bets of fights with status in ('locked','settled','cancelled'). Writes only via RPCs.
- points_ledger: user selects own; admin all. Writes only via security definer fns.
- fight_pools: members select. Writes only via fns.
- reactions: members select all; insert/delete own via RPC `toggle_reaction`.
- admin_log: members select (transparency); writes only via fns.
- Revoke all on all tables from anon. anon may only EXECUTE `public_next_fight()`.

## RPCs (all `security definer`, `set search_path = ''`, validate is_member()/is_admin(), use `now()` server clock, lock rows `for update` where needed). Return jsonb or void; raise exception with clear message codes like 'FIGHT_LOCKED'.
Member:
- `cast_vote(p_fight_id uuid, p_side text) returns void` (upsert; sets is_participant if caller's fighter_id in fight)
- `place_bet(p_fight_id uuid, p_side text, p_amount int) returns uuid` (bet id) — checks open & before lock, not participant, not already active bet, min/max, balance; writes ledger -amount reason 'bet'; updates fight_pools.
- `cancel_bet(p_bet_id uuid) returns void` — own, active, fight open & before lock; ledger +amount 'bet_cancel'; update pools.
- `toggle_reaction(p_fight_id uuid, p_emoji text) returns boolean` (true = now on)
- `get_fight_vote_totals(p_fight_id uuid) returns table(red_votes int, blue_votes int, red_pct numeric, blue_pct numeric)` — empty unless locked/settled.
- `my_balance() returns int`
Admin:
- `admin_upsert_fighter(p_id uuid, p_nickname text, p_weight_kg numeric, p_catchphrase text, p_photo_path text, p_hidden boolean) returns uuid`
- `admin_create_fight(p_red uuid, p_blue uuid, p_scheduled_at timestamptz, p_lock_at timestamptz, p_title text) returns uuid` (status 'open'; creates fight_pools row)
- `admin_lock_fight(p_fight_id uuid) returns void`
- `admin_settle_fight(p_fight_id uuid, p_winner_side text, p_method text, p_note text) returns jsonb` — requires status 'locked' (auto-lock first if open and past lock_at; if open and before lock_at, lock it now); caller not linked participant and has no bet on fight; updates W/L/streak/Elo (store before/delta), settles bets & ledger payouts atomically; idempotent: second call raises 'ALREADY_SETTLED'.
- `admin_cancel_fight(p_fight_id uuid, p_reason text) returns void` — from open/locked → cancelled, refunds active bets.
- `admin_create_invite(p_max_uses int, p_expires_at timestamptz) returns text` (random 8-char code A-Z2-9 no ambiguous chars)
- `admin_revoke_invite(p_code text) returns void`
- `admin_set_member(p_user_id uuid, p_active boolean, p_role text, p_fighter_id uuid) returns void` (cannot demote self if last admin)
- `admin_adjust_points(p_user_id uuid, p_delta int, p_note text) returns void`
- Every admin RPC inserts into admin_log.
Public:
- `public_next_fight() returns table(id uuid, title text, lock_at timestamptz, scheduled_at timestamptz, status text, red_nickname text, blue_nickname text)` — next fight with status in ('open','locked') ordered by scheduled_at, else null row set. Granted to anon.
Bootstrap:
- First admin: SQL snippet in `supabase/seed_admin.sql` documented in README: `update public.profiles set role='admin' where username='...'`. Plus seed one invite code `FIRSTFIGHT` max_uses 100 expiring in 30 days in the migration? NO — create via SQL in README instead.

Cron (pg_cron): `auto-lock` every minute: update fights set status='locked' where status='open' and lock_at <= now(). `weekly-points` `0 21 * * 0` UTC: +100 to each active profile, then top up below 10 to 100 (reason 'topup').

Realtime: add `fights`, `fight_pools`, `reactions` to `supabase_realtime` publication.

Storage: bucket `fighter-photos` private; policies: members select; admin insert/update/delete. Max 5MB, image mime types.

## Frontend (Vite + React 19 + TS + Tailwind v4 + react-router-dom v7 + @supabase/supabase-js v2)
Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (in .env.local, already present).
Shared files (owned by integrator, already created — import, don't rewrite): `src/lib/supabase.ts` (exports `supabase`), `src/lib/types.ts` (row types), `src/lib/auth.tsx` (AuthProvider, useAuth → {session, profile, isAdmin, loading, signIn(username,pw), signUp(username,pw,invite), signOut}), `src/App.tsx` (routes), `src/index.css` (theme tokens).
Routes:
- `/` Landing (public) — owner: landing agent. `src/pages/Landing.tsx`
- `/login`, `/join` (invite code prefilled from `?code=`) — owner: landing agent. `src/pages/Login.tsx`, `src/pages/Join.tsx`
- `/app` Tonight's fight card (open/locked fights, vote, bet, pools live, reactions, share poster) — owner: member agent. `src/pages/FightCard.tsx`
- `/app/fighters`, `/app/fighters/:id` profile w/ last 5 & head-to-head picker — member agent
- `/app/leaderboard` (fighter Elo rankings tab + bettors points tab) — member agent
- `/app/me` balance, my bets history, ledger, change password — member agent
- `/app/history` past fights — member agent
- `/admin/*` fighters CRUD + photo upload (client-side resize to ≤800px webp), fights create/lock/settle/cancel, invites, members, points adjust, admin log — admin agent. `src/pages/admin/*`
Pure logic in `src/lib/math.ts` (owner: math agent) with vitest tests `src/lib/math.test.ts`: `poolOdds(red,blue)`, `estimatePayout(stake, sideTotal, otherTotal)`, `maxBet(balance)`, `settlePool(bets, winnerSide)` (mirror of SQL, incl. dust rule), `eloUpdate(rA, rB, aWon, k=32)`, `formatStreak(n)`, `countdown(target, now)`. UI imports these for display; SQL is authoritative.
Share poster: `src/lib/poster.ts` (landing agent) — canvas 1080x1350 VS poster from two nicknames + optional photo URLs + title + time; returns Blob; `sharePoster()` uses Web Share API with file, fallback download + copy link.

## Design
Dark UFC fight-poster. Tokens in `src/index.css`: bg near-black `#0b0b0d`, surface `#16161a`, red `#d7192a`, gold `#e3b341`, blue corner `#2a6fdb`, text `#f4f1ea`, muted `#9a968e`. Fonts: "Bebas Neue" display (Google Fonts), "Inter" body. Big VS layouts, red vs blue corners, gold accents. Mobile-first (390px), tap targets ≥44px. No real money words ("$", "cash", "money", "wager") anywhere; say "points", "fun points — no cash value".
