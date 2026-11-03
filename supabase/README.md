# UoS Fight Night: Supabase backend

Everything server-side lives here: schema, RLS, RPCs, cron, realtime, storage, and the
`admin-create-user` / `admin-reset-password` Edge Functions. There is no public signup:
admins create every account.

```
migrations/
  20261102000001_schema.sql               tables, indexes, RLS policies, table grants
  20261102000002_functions.sql            auth hook + signup trigger, all RPCs, views, function grants
  20261102000003_cron_realtime_storage.sql pg_cron jobs, realtime publication, fighter-photos bucket
  20261102000004_wave_a.sql               Wave A: admin-created accounts (invites/hook dropped), match
                                          stats, correct result, consent/no contest, bout order
  20261103000005_wave_b.sql               Wave B: live scoring, title belt, badges, seasons;
                                          correct result also undoes belt/badges/season counters
functions/admin-create-user/index.ts      admin creates an account (service role)
functions/admin-reset-password/index.ts   admin sets a member's password (service role)
tests/fight_night_test.sql                pgTAP core suite (supabase test db)
tests/wave_a_test.sql                     pgTAP Wave A suite
tests/wave_a_race_test.sql                pgTAP concurrency test (correct vs settle), uses dblink
tests/wave_b_test.sql                     pgTAP Wave B suite (live scores, belt, badges, seasons)
tests/http_auth_edge_test.sh              curl checks: signup disabled, admin-create-user
seed.sql                                  LOCAL ONLY dev data (3 accounts, 4 fighters, 3 cards, a
                                          champion, badges, a running live score)
seed_admin.sql                            how to bootstrap the first production admin
config.toml                               auth: signup OFF, min password 8, no confirmations, no hooks
```

## Security model, briefly

- Clients never write tables. `anon` and `authenticated` have **no** insert/update/delete
  grant on any public table. Every change goes through a `security definer` RPC with
  `set search_path = ''` that checks `is_member()` / `is_admin()` and locks rows `for update`.
- `anon` can do exactly one thing: `select * from public_next_fight()` (nicknames, times,
  status, title). Every table and view is closed to `anon`.
- Votes are private. Crowd totals only come from `get_fight_vote_totals()` / the
  `fight_vote_totals` view, and only once a fight is `locked` or `settled`. Votes from
  users linked to a participant fighter are stored but not counted.
- Points are a ledger. A balance is `sum(points_ledger.delta)`, and nothing updates a
  balance column directly.
- Accounts = admin-made. `enable_signup = false`, so `POST /auth/v1/signup` fails with
  `signup_disabled`. The `admin-create-user` Edge Function (caller must be an active admin)
  creates the auth user via the service-role Admin API with the synthetic email
  `<username>@members.uosfight.local`. The `on_auth_user_created` trigger builds the
  profile from `user_metadata` (`username`, `display_name`) and adds +1000 signup points.
  `profiles.display_name` is required (1-24 chars) and is what every screen shows.
  Only admins change it, via `admin_set_member(..., p_display_name)`.
- Participant rule is history-aware. Settle, cancel/no contest, correct and force open
  refuse an admin who is linked to either fighter now or ever was (from `member_update` /
  `member_create` rows in `admin_log`). An admin also can't change their own fighter link
  while the old or new fighter has a scheduled/open/locked fight (`PARTICIPANT`).

Error codes are raised as the exception message and mapped in `src/lib/supabase.ts`:
`NOT_MEMBER, NOT_ADMIN, FIGHT_NOT_FOUND, FIGHT_LOCKED, INVALID_SIDE, BET_TOO_SMALL,
BET_TOO_LARGE, INSUFFICIENT_POINTS, ALREADY_BET, PARTICIPANT, BET_NOT_FOUND, BET_NOT_ACTIVE,
ALREADY_SETTLED, FIGHT_CANCELLED, ADMIN_HAS_BET, INVALID_METHOD, INVALID_EMOJI,
INVALID_USERNAME, USERNAME_TAKEN, NICKNAME_TAKEN, INVALID_PHOTO_PATH,
FIGHTER_NOT_FOUND, FIGHTER_ALREADY_LINKED, INVALID_FIGHTERS, INVALID_TIME,
MEMBER_NOT_FOUND, LAST_ADMIN, INVALID_ROLE, INVALID_DELTA, FIGHT_NOT_OPEN`.
Wave A adds: `SCORE_MISMATCH, LATER_FIGHT_EXISTS, NOT_PARTICIPANT, NOT_SCHEDULED, NOT_SETTLED,
REASON_REQUIRED, MAIN_EVENT_EXISTS, WEAK_PASSWORD` plus `INVALID_ROUNDS, INVALID_SCORE,
INVALID_WEIGHT, INVALID_NOTE, INVALID_FINISH_MOVE, INVALID_BOUT_ORDER, INVALID_CARD,
INVALID_KIND, INVALID_DISPLAY_NAME`.
Wave B adds: `NOT_REFEREE, FIGHT_NOT_LOCKED, INVALID_ACTION, INVALID_VALUE, ROUND_OVER,
NO_CHAMPION, ALREADY_CHAMPION, BELT_CHANGED, SEASON_CLOSED, CONFIRM_REQUIRED, INVALID_NAME,
NO_SEASON, FIGHTS_IN_PROGRESS` (and reuses `INVALID_SCORE, INVALID_ROUNDS, INVALID_KIND,
INVALID_NOTE, PARTICIPANT, ADMIN_HAS_BET, ALREADY_SETTLED, FIGHT_CANCELLED, FIGHT_NOT_FOUND,
FIGHTER_NOT_FOUND`).

## Local development

```bash
supabase start            # first run pulls Docker images
supabase db reset         # applies migrations + seed.sql
supabase test db          # runs supabase/tests/*.sql (pgTAP)
supabase functions serve  # optional: serves admin-create-user + admin-reset-password
```

`supabase functions serve` serves both functions at
`http://127.0.0.1:54321/functions/v1/<name>`. After changing `config.toml` (auth settings)
run `supabase stop && supabase start` so the auth container picks it up.

Local accounts from `seed.sql` (log in at `http://localhost:5173/login`):

| username | password | role |
|---|---|---|
| `admin` | `localadmin123` | admin |
| `member1` | `localmember123` | member, linked to fighter "The Hallway Hurricane" |
| `member2` | `localmember123` | member, linked to fighter "Mattress Mauler" |

Wave B demo data in the seed: "The Hallway Hurricane" holds the belt (won "Vacant Title" last
week, badges `first_win` + `belt_holder`), member2 has `high_roller`, the open main event is a
title fight, and a locked "Tonight" bout has a running live score (round 2, 3-1).

These exist only locally. `db push` never runs `seed.sql`.

## Deploy to the linked project

```bash
supabase link --project-ref <ref>          # once
supabase db push                           # migrations (seed.sql is NOT pushed)
supabase config push                       # auth: signup OFF, site_url, redirect URLs
supabase functions deploy admin-create-user
supabase functions deploy admin-reset-password
```

After `config push`, check the dashboard. **Authentication → Sign In / Providers**: "Allow
new users to sign up" should be OFF and Email enabled with "Confirm email" OFF.
**Authentication → Hooks**: no *Before User Created* hook (the function no longer exists).
If one was set up earlier, delete it, or account creation will fail.

If the Edge Function gateway rejects user tokens (this can happen on projects that use the
new asymmetric JWT signing keys), deploy with `--no-verify-jwt`. Both functions still verify
the caller themselves (`auth.getUser(jwt)`, then check for an active admin profile).

Call them from the browser:

```ts
await supabase.functions.invoke('admin-create-user', {
  body: { username, display_name, password, role: 'member', fighter_id: null } })
// -> { user_id, username }
//  | { error: 'NOT_ADMIN' | 'INVALID_USERNAME' | 'USERNAME_TAKEN' | 'INVALID_DISPLAY_NAME'
//            | 'WEAK_PASSWORD' | 'INVALID_ROLE' | 'FIGHTER_NOT_FOUND' | 'FIGHTER_ALREADY_LINKED'
//            | 'CREATE_FAILED' }
await supabase.functions.invoke('admin-reset-password', { body: { user_id, new_password } })
// -> { ok: true } | { error: 'NOT_ADMIN' | 'WEAK_PASSWORD' | 'MEMBER_NOT_FOUND' | ... }
```
With `functions.invoke`, a non-2xx reply comes back as `error` (a `FunctionsHttpError`).
Read the code with `await error.context.json()`.

## Bootstrap the first admin

Nobody can sign up, so the first admin is created by hand, once. See `seed_admin.sql`:

1. On your machine, get the secret key (`supabase projects api-keys --project-ref <ref>`). Never
   commit it.
2. `curl -X POST https://<ref>.supabase.co/auth/v1/admin/users` with that key, body
   `{"email":"<username>@members.uosfight.local","password":"<temp>","email_confirm":true,
   "user_metadata":{"username":"<username>","display_name":"<Shown Name>"}}`.
3. Run `update public.profiles set role = 'admin' where username = '<username>';`.
4. That admin logs in, changes the temp password, and creates everyone else (a second admin
   too) under Admin → Members → Create account.

## Cron (pg_cron)

| job | schedule (UTC) | does |
|---|---|---|
| `auto-lock` | `* * * * *` | `private.auto_lock_fights()`: sets `status='locked'` on open fights whose `lock_at <= now()` |
| `fotn-finalize` | `*/10 * * * *` | `private.fotn_finalize_due()`: closes every card whose Fight of the Night window (last settle + 24h) is over, picks the winner, awards `fight_of_the_night` badges. Idempotent; reads (`get_fotn`, `get_card_recap`, `hall_of_fame`) also finalize lazily |
| `weekly-points` | `0 21 * * 0` | `private.weekly_points()`: +100 (`weekly`) to every active member, then tops anyone at 0-9 up to 100 (`topup`). A negative balance (debt after `admin_correct_result`) gets the +100 but no top-up |

Sunday 21:00 UTC is Monday 00:00 in Asia/Baghdad (UTC+3, no DST). The weekly job skips anyone
who already got a `weekly` row in the last 6 days, so a manual or duplicate run is harmless.
The RPCs never rely on cron for locking. Every vote, bet and cancel checks
`status = 'open' and now() < lock_at`, so a fight counts as locked the moment `lock_at`
passes even if the cron tick hasn't run yet.

Inspect jobs with `select * from cron.job;` and runs with
`select * from cron.job_run_details order by start_time desc limit 20;`.

## Behaviour notes for frontend agents

- Fight lifecycle: `scheduled` → `open` → `locked` → `settled` | `cancelled`.
  `admin_create_fight` makes a **scheduled** fight. It opens when both linked fighters call
  `accept_fight`, or when an admin calls `admin_force_open(id, reason)` (reason at least 5
  chars, logged). Force open is only for corners without an app account: it raises
  `FIGHTER_HAS_ACCOUNT` if a corner that has not accepted is linked to an active profile.
  `decline_fight` sets it to `cancelled` with `cancel_kind = 'declined'`.
  Voting and betting need `open`. `admin_lock_fight` only works on `open`, and settling a
  `scheduled` fight raises `FIGHT_NOT_OPEN`.
- `admin_create_fight(p_red, p_blue, p_scheduled_at, p_lock_at, p_title, p_red_weight_kg, p_blue_weight_kg,
  p_bout_order, p_main_event)`: null weights take the fighters' current `weight_kg`, and a null
  bout order means the next number on that card. `card_date` is always the Asia/Baghdad date
  of `scheduled_at` (a trigger sets it). A second main event on a card raises
  `MAIN_EVENT_EXISTS`. Cancelled fights don't count.
- `admin_settle_fight(p_fight_id, p_winner_side, p_method, p_note, p_rounds, p_red_score, p_blue_score,
  p_finish_move, p_red_weight_kg, p_blue_weight_kg)`: rounds 1-20 and both scores are
  required. With `decision`, the winner must outscore the loser (`SCORE_MISMATCH`). Non-null
  weights overwrite the snapshot. It returns `{fight_id, winner_side, method, rounds, red_score,
  blue_score, total_pool, winning_pool, winners, dust, refunded, elo_delta, red_elo_before,
  blue_elo_before}`. `settled_at` uses `clock_timestamp()`, so it is strictly ordered.
- `admin_correct_result(p_fight_id, p_reason)`: works on `settled` fights only
  (`NOT_SETTLED` otherwise). The reason must be at least 5 chars (`REASON_REQUIRED`). It
  writes a `payout_reversal` (−payout) for every won or refunded bet and sets all bets back
  to `active` with their stakes still held. It restores Elo from `*_elo_before`, takes the
  W/L back off and rebuilds each streak from `fight_results`. The fight goes back to
  `locked`. It raises `LATER_FIGHT_EXISTS` if either fighter has a later settled fight (fix
  the newest first). Then settle again normally, or cancel / no contest. A balance can go
  negative after this, and betting is blocked until it is back up. Returns
  `{fight_id, status, reversed_payouts, bets_restored, red_elo, blue_elo}`.
- `admin_cancel_fight(p_fight_id, p_reason, p_kind default 'cancelled')`: `p_kind` is
  `'cancelled'` (from scheduled/open/locked) or `'no_contest'` (from open/locked only, else
  `FIGHT_NOT_OPEN`). It refunds all active bets and sets `cancel_kind`. The reason goes in
  `result_note` (≤200 chars).
- `admin_reorder_card(p_card_date, p_fight_ids)`: listed fights get bout_order 1..n in the
  given order, and any other fights on that card follow in their old order. A foreign,
  duplicate or empty list raises `INVALID_CARD`. `admin_set_main_event(p_fight_id)` moves the
  main-event flag to that fight. The UI renders the main event last.
- `admin_set_member(p_user_id, p_active, p_role, p_fighter_id, p_display_name default null)`:
  a null active, role or display_name means "keep current". `p_fighter_id` is always
  applied, so `null` unlinks the fighter. Always pass the fighter you want linked.
- `accept_fight` / `decline_fight` raise `NOT_PARTICIPANT` for anyone who isn't one of the two
  fighters' linked profiles, and `NOT_SCHEDULED` once the fight is no longer scheduled.
- `public_next_fight()` returns `(id, title, lock_at, scheduled_at, status, red_nickname, blue_nickname,
  red_weight_kg, blue_weight_kg, is_main_event)`. It picks from the nearest card that has an
  open/locked fight: the main event if it is open/locked, else the earliest such fight.
  Scheduled (unconsented) fights are never shown to anon.
- Views: `fight_results` has one row per settled fight per fighter (`result`, `score_for`,
  `elo_delta` signed for that fighter, ...). `fighter_rankings` adds `total_rounds,
  points_for, points_against, wins_*/losses_*` by method, plus `weight_kg`. `balances` and
  `leaderboard_bettors` gain a `display_name` column.
- `fights.elo_delta` is the change applied to **red**. Blue got `-elo_delta`. This matches
  `eloUpdate(red, blue, redWon).delta` in `src/lib/math.ts`.
- `admin_upsert_fighter` with `p_id = null` creates a fighter. A `p_photo_path` must look like
  `fighters/<fighter uuid>/<name>.webp|jpg|jpeg|png`.
- Extra read helpers (security definer, member-only): `get_leaderboard_bettors()` (backs
  the `leaderboard_bettors` view) and `get_all_fight_vote_totals()` (backs the
  `fight_vote_totals` view).
- Realtime: subscribe to `postgres_changes` on `fights`, `fight_pools`, `reactions`,
  `live_scores`, `callouts` and `site_settings`. RLS applies, so only members get events
  (Supabase does not RLS-filter DELETE events; they carry only the primary key).

### Wave B (live scoring, belt, badges, seasons)

- **Live scoring (B4).** `admin_live_update(p_fight_id, p_action, p_value default null)` with
  `start | pause | next_round | red_add | blue_add | set_round_seconds | reset`. Allowed for
  `is_referee()` (admins today; wave C adds the referee role there), never for a participant
  (current or past link) or for an admin with an active pick on the fight (`ADMIN_HAS_BET`).
  The fight must be `locked`; an `open` fight past `lock_at` is locked on the spot, anything
  else raises `FIGHT_NOT_LOCKED`. The clock is server-side: `round_started_at` (start of the
  running segment) + `accumulated_seconds`. Read `get_live_score(p_fight_id)` or the
  `live_score_state` view for `elapsed_seconds / remaining_seconds / time_up / is_live /
  server_now`. Every call is logged as `live_update`.
- **Title belt (B5).** `belt_reigns` (one open reign at most). ANY settled loss by the
  champion moves the belt to the winner (`lost_fight_id` / `won_fight_id`).
  `admin_award_belt(p_fighter_id, p_note)` crowns a champion or, with `null`, vacates.
  `fights.is_title_fight` = champion in the fight: set on insert, refreshed for
  scheduled/open/locked fights whenever the belt moves, frozen at settle. Views
  `current_champion(fighter_id, nickname, since, defenses, ...)` and `belt_reign_history`.
  `public_next_fight()` also returns `is_title_fight, champion_side, champion_nickname`.
- **Badges (B6).** `badge_catalog` (label, description, Phosphor icon name), `fighter_badges`,
  `user_badges`; one row per award with the `fight_id` that earned it. Awarded inside
  `admin_settle_fight`; `perfect_night` is re-synced by a trigger on every fight status change
  (so a cancelled last bout completes the card). `list_badges(p_kind, p_id)` returns one row per
  code. Existing history was back-filled by the migration.
- **Seasons (B7).** `seasons` (one open). `admin_end_season('END SEASON', p_name_next)` needs no
  open/locked fight, snapshots rankings + balances, records the champion (belt holder, else top
  Elo of the season) and top bettor, writes one `season_reset` ledger row per active member to
  bring them to exactly 1000, resets every fighter to Elo 1000 and 0-0 `season_wins /
  season_losses` (all-time W-L kept), then opens the next season. The belt is kept.
  `fighter_rankings` gains `season_wins, season_losses, season_fights, season_ranked,
  season_rank, is_champion` (existing columns unchanged).
- **Correct result (B1, extended).** Also undoes a belt transfer made by the fight (the old
  reign reopens), deletes badges earned by it, re-syncs `sharp_eye` / `perfect_night`, and
  takes back season counters. Refuses with `BELT_CHANGED` if the belt won in that fight has
  since been reassigned/vacated, and `SEASON_CLOSED` for a fight settled before the current
  season started.
- **Locks.** settle, correct, award belt and end season take one advisory lock
  (`private.lock_belt()`) before any row lock, so they run one at a time.

### Wave C (lockdown, referee, recap, Fight of the Night, callouts, shop, Hall of Fame)

Migration `20261103000013_wave_c.sql`. Full frontend reference (signatures, JSON shapes, error
codes, copy hints): `scratchpad/wavec/API.md`; row types in `src/lib/types.ts`.

- **Lockdown (C1).** Singleton `site_settings`. `public_site_status()` (anon + members) returns
  only `{lockdown, message}`. `admin_set_lockdown(p_on, p_message)` (logged `site_lockdown`).
  While on, `is_member()` is false for every non-admin, so every RLS policy, view, storage read
  and realtime stream denies them; `private.require_member()` raises `SITE_LOCKED`; own-row
  policies (`profiles`, `votes`, `bets`, `points_ledger`) check `is_locked_out()`;
  `public_next_fight()` returns nothing for anyone. Admins are unaffected. Non-admins can still
  read `site_settings` (to show the maintenance page) and call `is_admin()`.
- **Referee (C2).** `profiles.role` adds `'referee'`. `is_referee()` = active and (admin or
  referee) and not locked out. Referees are members plus `admin_live_update`; every other
  `admin_*` RPC raises `NOT_ADMIN`. Assign via `admin_set_member(..., 'referee', ...)` or the
  `admin-create-user` Edge Function (`role: 'referee'`).
- **Recap (C3).** `get_card_recap(p_card_date)` → JSON of the card's fights (names, kg, scores,
  rounds, method, move, winner, title/main flags, FOTN), current champion, FOTN state.
- **Fight of the Night (C4).** `fotn_votes` (own row only), `fotn_results` (closed cards).
  A card is complete when it has a settled fight and nothing scheduled/open/locked; voting runs
  until `max(settled_at) + 24h`, one vote per member per card (re-voting changes it), not for a
  bout you are or were linked to. `cast_fotn_vote(p_fight_id)`, `get_fotn(p_card_date)`; counts
  and winner only after close. Ties: main event, then later bout. Both fighters get
  `fight_of_the_night`. When a fight of the card leaves `settled` (`admin_correct_result`) a
  trigger drops the card's result and FOTN badges; votes stay, and a new 24h window opens at the
  re-settle.
- **Callouts (C5).** `callouts` + `callout_board` view. Fighters (linked members):
  `create_callout(p_target, p_message ≤140, p_rematch_of default null)` (max 3 open per
  challenger, one open per pair; rematch only by the loser of that settled fight),
  `accept_callout`, `decline_callout`, `withdraw_callout`. Admins: `admin_approve_callout`
  (returns create-fight prefill), `admin_book_callout(id, scheduled_at, lock_at, title, bout_order,
  main_event)` (creates a normal `scheduled` fight; both fighters still accept), `admin_reject_callout`,
  `admin_delete_callout`. Admins linked to either fighter get `PARTICIPANT`.
- **Shop (C6).** `shop_items` (seeded), `user_items`, `title_requests`, view `member_cosmetics`.
  `buy_item(p_code)` locks the caller's profile row (same lock as `place_bet`) → ledger
  `shop`; `equip_item` / `unequip_item` (one per kind); `request_title(p_title)` charges 500 up
  front, `admin_approve_title` grants it, `admin_reject_title` refunds (`shop_refund`).
  Copy: "Fun points — no cash value. Items are cosmetic."
- **Hall of Fame (C7).** `hall_of_fame()` → champions/reigns, season champions, top-3 records
  (longest win streak, most wins, most rounds, most FOTN, biggest upset, peak balance).

## Visitor stats (B8)

Nothing to build or deploy. In the Cloudflare dashboard: Workers & Pages → the Pages project →
Metrics → Web Analytics → Enable. Cloudflare injects its beacon on Pages automatically; it sets
no cookies and needs no code or consent banner. Only enable a token-based snippet in
`index.html` if the automatic setup is unavailable.

## Tests

```bash
supabase db reset && supabase test db      # pgTAP: fight_night_test, wave_a_*, wave_b_*, wave_c_*
supabase functions serve &                  # then, HTTP checks (signup disabled, admin-create-user):
bash supabase/tests/http_auth_edge_test.sh
```
The suites build their own fixtures (`tq_*` / `tw_*` users, `TQ *` / `TW *` fighters, cards
30+ days after the latest card in the DB) inside one rolled-back transaction. They don't need
an empty DB. Exception: `wave_a_race_test.sql` needs real concurrent sessions, so it commits
its `tr_*` / `TR *` fixtures through a dblink loopback and deletes them at the start and end
of the run. It creates the `dblink` extension inside its own rolled-back transaction.
`wave_b_season_race_test.sql` and `wave_c_shop_race_test.sql` (`twr_*` users: parallel
purchases must not double-spend) work the same way.
