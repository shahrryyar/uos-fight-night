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




---
# ADDENDA (2026-11-02) — these SUPERSEDE the base contract wherever they conflict.
Wave scoping: WAVE A = Addendum A (match stats) + C0 (admin-created accounts) + B1 (correct/undo, minus belt/badge reversal) + B2 (consent/injury) + B3 (bout order).
WAVE B = B4-B8 (+ extend B1 to reverse belt & badges). WAVE C = C1-C7.
Invite-based signup from the base contract is REMOVED by C0.

## ADDENDUM A — Match stats (binding, appended to CONTRACT.md)

User request: profiles, current matches and previous matches must show each player's kg, rounds played, match score points, and how they lost.

### Schema (new migration, after existing ones)
fights add columns:
- `red_weight_kg numeric(5,1) null`, `blue_weight_kg numeric(5,1) null` — weight snapshot for that match. Set at create from fighters.weight_kg (or override param). Editable at settle.
- `rounds int null check (rounds between 1 and 20)` — rounds fought. Required at settle.
- `red_score int null check (red_score >= 0)`, `blue_score int null check (blue_score >= 0)` — match score points. Required at settle. (Winner by pin/submission may have lower score — allowed. For method='decision' winner score must be > loser score, else raise 'SCORE_MISMATCH'.)
- `finish_move text null check (char_length(finish_move) <= 60)` — e.g. "half nelson", "headlock". Optional.
- existing `result_note` = optional referee note (≤200 chars).

### RPC changes (replace signatures; drop old overloads)
- `admin_create_fight(p_red uuid, p_blue uuid, p_scheduled_at timestamptz, p_lock_at timestamptz, p_title text, p_red_weight_kg numeric default null, p_blue_weight_kg numeric default null) returns uuid` — null weight → snapshot fighters.weight_kg.
- `admin_settle_fight(p_fight_id uuid, p_winner_side text, p_method text, p_note text, p_rounds int, p_red_score int, p_blue_score int, p_finish_move text default null, p_red_weight_kg numeric default null, p_blue_weight_kg numeric default null) returns jsonb` — non-null weight params overwrite snapshot. All other settle rules unchanged.
- `public_next_fight()` also returns `red_weight_kg, blue_weight_kg` (numbers only, still no photos).

### Views
- `fighter_rankings` add: `total_rounds int`, `points_for int`, `points_against int`, `losses_pin int`, `losses_submission int`, `losses_decision int`, `wins_pin int`, `wins_submission int`, `wins_decision int` (over settled fights).
- New view `fight_results` (security_invoker): one row per settled fight per fighter perspective: `fight_id, fighter_id, opponent_id, side, result ('W'|'L'), method, finish_move, rounds, score_for, score_against, weight_kg, opponent_weight_kg, elo_delta (signed for that fighter), settled_at, result_note`. Used by profile last-5, head-to-head, history.

### UI
- Fight card (VsCard): under each nickname show `72.5 kg` (snapshot, fallback current). After settle: big score `6 – 3`, `3 rounds`, `WIN by PIN (half nelson)` on winner, loser side shows `Lost by pin`. Note in small text.
- Fighter profile: current kg, total rounds, points for/against, W/L breakdown by method ("Losses: 2 pin · 1 submission · 0 decision"), last 5 rows: W/L, vs opponent (their kg), score, rounds, method + move, date. Head-to-head shows the same rows filtered.
- Fighters grid: kg on each card.
- History: score, rounds, both kgs, method + move, loser "lost by …".
- Leaderboard fighters tab: add kg and rounds columns (compact).
- Admin settle form: rounds (stepper, default 1), red score / blue score (number), method, finish move (text with suggestions: half nelson, headlock, cradle, arm bar, rear naked choke, body lock), weights prefilled from snapshot (editable), referee note. Admin create fight: weights prefilled from fighters, editable.
- Landing: show kg under nicknames.
- poster.ts: optional `redKg`, `blueKg` in opts → drawn under names.


## ADDENDUM B — Extra features chosen by user 2026-11-02 (binding, append to CONTRACT.md)

### B1. Correct / undo result (PRE-DEPLOY, wave A)
- `admin_correct_result(p_fight_id uuid, p_reason text) returns jsonb` — only for status 'settled'. Atomically reverses: payouts (ledger reason 'refund' negative of payout? NO — use new ledger reasons 'payout_reversal' (−payout) and restore stakes to active bets), W/L/streak/Elo for both fighters (restore from red_elo_before/blue_elo_before; recompute streak from fight_results history), belt changes (B5), badges awarded by that fight (B6). Sets fight status back to 'locked', clears result columns. Logs admin_log with reason (required, ≥5 chars). Then admin re-settles normally. Must refuse if a LATER settled fight involves either fighter (raise 'LATER_FIGHT_EXISTS' — correct newest first) to keep Elo/streak chain valid.
- Add 'payout_reversal' to points_ledger reason check. A user may go negative after reversal — allowed (shown as debt; can't bet until ≥ MIN_BET).
- UI: admin Fights tab → settled fight → "Correct result" with reason; confirm dialog explains reversal.

### B2. Fight consent + injury stop (PRE-DEPLOY, wave A)
- fights add `red_accepted_at timestamptz null`, `blue_accepted_at timestamptz null`. New fights created with status 'scheduled' (not 'open'). Fight auto-transitions to 'open' when both accepted (or admin `admin_force_open(p_fight_id, p_reason)` for fighters without app accounts — logged). Voting/betting only when 'open'.
- `accept_fight(p_fight_id uuid) returns void` — caller's profiles.fighter_id must be red or blue participant; sets corresponding accepted_at. `decline_fight(p_fight_id uuid)` → fight cancelled (refunds none needed since not open) with log.
- Injury stop: `admin_no_contest(p_fight_id uuid, p_reason text)` from open/locked → status 'cancelled' with `cancel_kind = 'no_contest'` (new column `cancel_kind text check in ('cancelled','no_contest','declined')`), refunds all bets, no record change. (Can reuse admin_cancel_fight with kind param.)
- UI: fighter sees "You're booked: Accept / Decline" banner on FightCard; card shows "Waiting for fighters to accept ✅/⏳". Rules box text: tap = stop, referee's call final, no strikes, 18+, opt-in.

### B3. Bout order / main event (PRE-DEPLOY, wave A)
- fights add `bout_order int not null default 1`, `is_main_event boolean not null default false`, `card_date date not null` (Asia/Baghdad date of scheduled_at; set by RPC). At most one main event per card_date (partial unique index).
- admin_create_fight gains `p_bout_order int default null` (null → next number for that card_date), `p_main_event boolean default false`. `admin_reorder_card(p_card_date date, p_fight_ids uuid[])` sets order; `admin_set_main_event(p_fight_id)`.
- UI: FightCard groups by card_date, sorted bout_order; main event last & visually biggest ("MAIN EVENT" gold banner). Landing shows the main event (or first open fight) as NEXT UP.

### B4. Referee live scoring (wave B, after first deploy)
- Table `live_scores(fight_id pk refs fights, round int not null default 1, red_score int default 0, blue_score int default 0, round_started_at timestamptz null, round_seconds int not null default 120, running boolean default false, updated_at timestamptz default now(), updated_by uuid)`. Members select; realtime-enabled. Writes via `admin_live_update(p_fight_id, p_action text, p_value int)` actions: 'start','pause','next_round','red_add','blue_add','set_round_seconds','reset'. Only admins (or role 'referee' — keep admin only for now) not participants. Only when fight status 'locked'.
- Referee screen `/admin/ref/:fightId`: huge buttons +1/+2/−1 per corner, round timer with start/pause/next, keeps screen awake (navigator.wakeLock), "Finish → Settle" pre-fills rounds & scores in settle form.
- Members: FightCard shows LIVE score + round + timer when live_scores row running/updated in last 10 min.

### B5. Title belt (wave B)
- Table `belt_reigns(id uuid pk, fighter_id refs fighters, won_fight_id uuid null refs fights, lost_fight_id uuid null refs fights, started_at timestamptz, ended_at timestamptz null)`. Current champion = reign with ended_at null. Admin `admin_award_belt(p_fighter_id, p_note)` for the first champ (or vacate). Fights get `is_title_fight boolean default false` (set at create; requires current champ as participant). On settle of a title fight where champ loses → end reign, start new reign for winner. (Non-title loss doesn't move belt — user said "loses belt by losing a fight": treat ANY loss by the champ as belt change? Decide: ANY settled loss by champion transfers belt to the winner. Simpler and matches user wording. So is_title_fight is just a display flag = auto true when champ fights.)
- Undo (B1) must restore belt.
- UI: 👑 belt icon next to champ everywhere; profile shows reigns; Leaderboard header "CURRENT CHAMPION" card; landing shows champ nickname.

### B6. Badges (wave B)
- Table `badges(fighter_or_user ...)` → split: `fighter_badges(fighter_id, code, fight_id null, awarded_at, primary key(fighter_id, code, fight_id))` and `user_badges(user_id, code, fight_id null, awarded_at)`. Awarded inside settle (and reversed by B1).
- Fighter codes: `first_win`, `streak_3`, `streak_5`, `upset` (won with elo_before ≥100 lower), `iron_man` (10 fights), `shutout` (won with opponent score 0), `belt_holder`.
- User codes: `sharp_eye` (correct vote 5 fights in a row), `high_roller` (won a bet ≥400), `perfect_night` (correct vote on every fight of a card_date with ≥2 fights), `comeback` (balance from <50 to ≥1000).
- UI: badge chips with emoji + tooltip on profile & Me page.

### B7. Semester reset (wave B)
- Table `seasons(id serial pk, name text, started_at, ended_at null, champion_fighter_id null, top_bettor_user_id null, snapshot jsonb)`. `admin_end_season(p_name_next text)`: snapshot rankings & balances into seasons.snapshot, set champion = current belt holder (else top Elo), top bettor; then reset points: ledger 'season_reset' entry bringing each balance to 1000; reset fighters.elo to 1000 and season W/L counters (add `season_wins`, `season_losses` columns? Keep all-time wins/losses; add season_* columns used by leaderboard). Logged. Requires confirm text "END SEASON".
- UI: Leaderboard "Season" vs "All-time" toggle; History of seasons with champions.

### B8. Visitor stats (wave B)
- Cloudflare Web Analytics: user must enable in Cloudflare dashboard (Pages project → Metrics → Web Analytics → enable) — automatic injection for Pages, no code, no cookies. Document in README; nothing to build. If token-based snippet needed, add to index.html.


## ADDENDUM C — decided by user 2026-11-02 (binding, append to CONTRACT.md)

### C0. LOGIN MODEL CHANGE — admin-created accounts (PRE-DEPLOY, wave A — supersedes invite signup)
User: "admin decides the nickname of users which will appear on screens. They just log in to their account." + "let admin be able to make the account themselves for second admin".
- Public self-signup DISABLED: supabase/config.toml `[auth] enable_signup = false`. Remove /join route & Join page (redirect /join → /login). Invites table + invite RPCs + before_user_created hook: remove (or leave hook disabled & drop invites) — keep it clean; nothing should accept signups.
- Edge Function `admin-create-user` (service role; verify caller JWT → active admin): body `{ username, display_name, password, role: 'member'|'admin', fighter_id?: uuid|null }`. Validates username `[a-z0-9_]{3,20}` unique, display_name 1-24 chars, password ≥8. Creates auth user with synthetic email `${username}@members.uosfight.local`, email_confirm: true, then the `handle_new_user` trigger creates profile (username from user_metadata) + 1000 signup points; function then sets display_name/role/fighter_id via service role and writes admin_log. Returns `{ user_id, username }`.
- `display_name` is REQUIRED (not null) and is the name shown on every screen (leaderboards, bets lists, admin log, header). Members can NOT change display_name or username (remove any self-edit RPC). Admin edits display_name via `admin_set_member(... p_display_name text ...)` (extend signature).
- Admin can delete/deactivate accounts (`active=false`); edge function `admin-reset-password` stays.
- Login page: username + password only; footer "No account? Ask an admin." Landing CTA "Got your login? Enter" → /login (no Join).
- Bootstrap first admin: no signup exists → README + pipeline step: create first admin via `supabase` service-role call (curl auth admin API with secret key from `supabase projects api-keys`, run locally, never committed) then set role='admin'. Print username + temp password to user ONCE; tell them to change it.
- Admin UI Members tab: "Create account" form (username, display name shown on screens, temp password generator + copy, role, link fighter), list with edit display_name/role/active/fighter, reset password.

### Wave C (after first deploy)
- C1. Panic button / lockdown: table `site_settings(id int pk default 1 check(id=1), lockdown boolean default false, lockdown_message text, updated_at, updated_by)`. anon+members read via `public_site_status()` RPC (anon-executable, returns lockdown + message only). When lockdown: landing shows only a neutral "Maintenance" page (no league name in visible copy, generic title); app for non-admins shows maintenance; public_next_fight returns nothing; members' data RPCs/RLS still work for admins only (add `and not lockdown` to is_member() for non-admins). Admin toggle `admin_set_lockdown(p_on boolean, p_message text)` with big red button + confirm. Logged.
- C2. Referee role: profiles.role check add 'referee'. Referee may use B4 live scoring RPC + referee screen; cannot settle/cancel/manage. Admin can assign via admin_set_member / create-user.
- C3. Results recap poster: `src/lib/poster.ts` `renderRecap({ cardDate, fights:[{red,blue,winner,method,move,score,rounds,kg, title?}], champion?, fightOfNight? })` 1080x1350 (or taller if >4 fights, 1080x1920), share via same sharePoster flow. Button on FightCard after all fights of the card settled, and in History per card_date.
- C4. Fight of the Night: after all fights of a card_date settled, members vote 24h window: table `fotn_votes(card_date date, user_id, fight_id, primary key(card_date,user_id))`; `cast_fotn_vote(p_fight_id)`; winner computed after window (cron or on read) → both fighters get fighter badge `fight_of_the_night`. Results visible after window closes.
- C5. Callouts / rematches: table `callouts(id uuid pk, challenger_fighter_id, target_fighter_id, message text ≤140 (preset-ish, no free-text abuse? allow ≤140 with nickname-filter-free; admin can delete), status ('pending','accepted','declined','approved','rejected','booked'), created_by user, created_at)`. Fighter (linked profile) creates callout; target fighter accepts/declines; admin approves → prefilled create-fight form; booked links fight id. "Rematch" button on settled fight for the loser → callout prefilled. Members see public callout board.
- C6. Points shop (cosmetics, fun points, no cash): table `shop_items(code pk, kind ('name_color','frame','title'), label, value text, price int, active)`, `user_items(user_id, code, purchased_at, equipped boolean)`. `buy_item(p_code)` deducts via ledger reason 'shop' (add to check); `equip_item(p_code)`. Seed items: name colors (gold 300, crimson 200, ice blue 200, neon green 250), frames (flame 400, chain 350, crown 800), titles (admin-approved custom title request 500 → `title_requests` table admin approves text; plus preset titles "The Butcher" 300, "Iron Grip" 300, "Mat Rat" 150). Display name rendered with equipped color/frame/title everywhere (component `<MemberName userId/>`). Copy: "Fun points — no cash value. Items are cosmetic."
- C7. Hall of Fame page `/app/hall-of-fame`: past champions & reigns (B5), season champions (B7), records: longest win streak, most wins, most rounds, biggest upset (largest elo gap win), most Fight of the Night, top bettor peak balance. Computed by SQL view/RPC `hall_of_fame()`.

Declined by user (do NOT build): backup/export, rules & privacy page, nickname filter, weight-gap warning, pick-accuracy board, self-delete account, matchmaking hint, deeper stats, invite QR.
