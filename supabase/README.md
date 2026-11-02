# UoS Fight Night: Supabase backend

Everything server-side lives here: schema, RLS, RPCs, cron, realtime, storage, the
signup hook, and the `admin-reset-password` Edge Function.

```
migrations/
  20261102000001_schema.sql               tables, indexes, RLS policies, table grants
  20261102000002_functions.sql            auth hook + signup trigger, all RPCs, views, function grants
  20261102000003_cron_realtime_storage.sql pg_cron jobs, realtime publication, fighter-photos bucket
functions/admin-reset-password/index.ts   admin sets a member's password (service role)
tests/fight_night_test.sql                pgTAP suite (supabase test db)
seed.sql                                  LOCAL ONLY dev data (invite LOCALDEV, 4 fighters, 1 fight)
seed_admin.sql                            snippet to promote the first admins
config.toml                               auth: signup on, min password 8, no confirmations, before_user_created hook
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
- Signup = invite. `hook_before_user_created` rejects bad invites and bad or taken usernames
  (and any email that is not `<username>@members.uosfight.local`). Then the
  `on_auth_user_created` trigger takes the invite under a row lock (so a racing signup
  can't take the last use twice), creates the profile and adds the +1000 signup points.

Error codes are raised as the exception message and mapped in `src/lib/supabase.ts`:
`NOT_MEMBER, NOT_ADMIN, FIGHT_NOT_FOUND, FIGHT_LOCKED, INVALID_SIDE, BET_TOO_SMALL,
BET_TOO_LARGE, INSUFFICIENT_POINTS, ALREADY_BET, PARTICIPANT, BET_NOT_FOUND, BET_NOT_ACTIVE,
ALREADY_SETTLED, FIGHT_CANCELLED, ADMIN_HAS_BET, INVALID_METHOD, INVALID_EMOJI,
INVALID_INVITE, INVALID_USERNAME, USERNAME_TAKEN, NICKNAME_TAKEN, INVALID_PHOTO_PATH,
FIGHTER_NOT_FOUND, FIGHTER_ALREADY_LINKED, INVALID_FIGHTERS, INVITE_NOT_FOUND,
MEMBER_NOT_FOUND, LAST_ADMIN, INVALID_ROLE, INVALID_DELTA, INVALID_MAX_USES, FIGHT_NOT_OPEN`.

## Local development

```bash
supabase start            # first run pulls Docker images
supabase db reset         # applies migrations + seed.sql
supabase test db          # runs supabase/tests/*.sql (pgTAP)
supabase functions serve admin-reset-password   # optional, local edge function
```

Local dev invite: `LOCALDEV`. Sign up at `http://localhost:5173/join?code=LOCALDEV`, then
run `update public.profiles set role = 'admin' where username = 'you';` in Studio
(http://127.0.0.1:54323) or psql.

## Deploy to the linked project

```bash
supabase link --project-ref <ref>          # once
supabase db push                           # migrations (seed.sql is NOT pushed)
supabase config push                       # auth settings + before_user_created hook
supabase functions deploy admin-reset-password
```

After `config push`, check **Authentication → Hooks** in the dashboard. *Before User
Created* should point to `public.hook_before_user_created`. Also check **Authentication →
Providers → Email**: enabled, with "Confirm email" OFF.

If the Edge Function gateway rejects user tokens (this can happen on projects that use the
new asymmetric JWT signing keys), deploy with
`supabase functions deploy admin-reset-password --no-verify-jwt`. The function still verifies
the caller itself (`auth.getUser(jwt)`, then checks for an active admin profile).

Call it from the browser:

```ts
await supabase.functions.invoke('admin-reset-password', { body: { user_id, new_password } })
// -> { ok: true } | { error: 'NOT_ADMIN' | 'WEAK_PASSWORD' | 'MEMBER_NOT_FOUND' | ... }
```

## Bootstrap the first admins

1. Create an invite in the SQL editor:
   ```sql
   insert into public.invites (code, max_uses, expires_at)
   values ('FIRSTFIGHT', 100, now() + interval '30 days');
   ```
2. Each founding admin signs up at `/join?code=FIRSTFIGHT`.
3. Promote them by running `supabase/seed_admin.sql` with the real usernames:
   ```sql
   update public.profiles set role = 'admin' where username in ('alice', 'bob');
   ```
4. From then on, admins create invites in the app (`admin_create_invite`). Once everyone
   is in, revoke the bootstrap code instead of waiting for it to expire:
   `update public.invites set revoked = true where code = 'FIRSTFIGHT';`.

## Cron (pg_cron)

| job | schedule (UTC) | does |
|---|---|---|
| `auto-lock` | `* * * * *` | `private.auto_lock_fights()`: sets `status='locked'` on open fights whose `lock_at <= now()` |
| `weekly-points` | `0 21 * * 0` | `private.weekly_points()`: +100 (`weekly`) to every active member, then tops anyone still below 10 up to 100 (`topup`) |

Sunday 21:00 UTC is Monday 00:00 in Asia/Baghdad (UTC+3, no DST). The weekly job skips anyone
who already got a `weekly` row in the last 6 days, so a manual or duplicate run is harmless.
The RPCs never rely on cron for locking. Every vote, bet and cancel checks
`status = 'open' and now() < lock_at`, so a fight counts as locked the moment `lock_at`
passes even if the cron tick hasn't run yet.

Inspect jobs with `select * from cron.job;` and runs with
`select * from cron.job_run_details order by start_time desc limit 20;`.

## Behaviour notes for frontend agents

- `admin_set_member(p_user_id, p_active, p_role, p_fighter_id)`: a `null` active or role means
  "keep current". `p_fighter_id` is always applied, so `null` unlinks the fighter. Always pass
  the fighter you want linked.
- `admin_settle_fight` accepts an `open` fight (before or after `lock_at`) and settles it
  directly. It returns `{fight_id, winner_side, method, total_pool, winning_pool, winners,
  dust, refunded, elo_delta, red_elo_before, blue_elo_before}`.
- `fights.elo_delta` is the change applied to **red**. Blue got `-elo_delta`. This matches
  `eloUpdate(red, blue, redWon).delta` in `src/lib/math.ts`.
- `admin_cancel_fight` stores the reason in `fights.result_note`.
- `admin_upsert_fighter` with `p_id = null` creates a fighter. A `p_photo_path` must look like
  `fighters/<fighter uuid>/<name>.webp|jpg|jpeg|png`.
- Extra read helpers (security definer, member-only): `get_leaderboard_bettors()` (backs
  the `leaderboard_bettors` view) and `get_all_fight_vote_totals()` (backs the
  `fight_vote_totals` view).
- Realtime: subscribe to `postgres_changes` on `fights`, `fight_pools` and `reactions`.
  RLS applies, so only members get events.
