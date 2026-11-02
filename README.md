# UoS Fight Night

A private web app for a dorm wrestling league (about 10 to 20 fighters, under 100 members,
all 18+). There is no public signup: admins create every account. Members get a fight card
for each bout, vote for a corner, put fun points on a side, react with emoji, and follow
fighter records, match stats, Elo rankings and a points leaderboard. Admins run the league:
fighters and photos, fights (create, order the card, force open, lock, settle, correct a
result, cancel or no contest), member accounts, point adjustments and an audit log.

Fighters with an app account accept or decline each fight before it opens. Everyone is shown
by their `display_name` (set by an admin), not their login username.

The points are fun points with no cash value. Nothing can be bought, sold or cashed out.

## Stack

- **Frontend:** Vite 8, React 19, TypeScript, Tailwind CSS v4, react-router-dom v7.
  The look is a dark fight poster: red corner against blue corner, gold accents, Bebas Neue
  headings. It is built for phones first (390px wide).
- **Backend:** Supabase (Postgres with RLS, Auth, Storage, Realtime, pg_cron, two Edge
  Functions: `admin-create-user` and `admin-reset-password`). All writes go through `security definer` RPCs. The browser never writes a table
  directly. See [`supabase/README.md`](supabase/README.md) for the security model, RPCs,
  error codes and cron jobs.
- **Hosting:** Cloudflare Pages (static `dist/`).
- **Tests:** Vitest (`src/**/*.test.ts(x)`: point and Elo math, card order, admin tabs),
  pgTAP for the database (`supabase/tests/*.sql`), and a curl script for auth and the Edge
  Functions (`supabase/tests/http_auth_edge_test.sh`).

### Login

Members log in with a username and password. There is no email, no Google sign-in, no
invite codes and no self-signup: `enable_signup = false` in `supabase/config.toml`, so
`POST /auth/v1/signup` is rejected. An admin creates each account under **Admin → Members →
Create account** (username, display name, temporary password, role, optional fighter link),
which calls the `admin-create-user` Edge Function. Behind the scenes each username maps to a
placeholder email, `<username>@members.uosfight.local`, that never receives mail. A new
account starts with 1000 points. A forgotten password is reset by an admin, through the
`admin-reset-password` Edge Function.

### Routes

| Route | Who | What |
|---|---|---|
| `/` | public | Landing page: countdown to the next fight, matchup shown by nickname only (no photos), Login button |
| `/login` | public | Username and password login (old `/join` links redirect here) |
| `/app` | members | Tonight's fight card: vote, points pool, reactions, share poster |
| `/app/fighters`, `/app/fighters/:id` | members | Fighter list and profiles (record, streak, Elo, match stats, last 5 fights, head-to-head) |
| `/app/leaderboard` | members | Elo rankings and points leaderboard |
| `/app/history` | members | Past fights |
| `/app/me` | members | Balance, bet history, points ledger, change password |
| `/admin/*` | admins | Fighters, fights (card order, main event), members (create accounts), points, admin log |

## Local development

You need Node 20 or later, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm i
supabase start          # starts the local stack (Docker); the first run pulls images
supabase db reset       # applies supabase/migrations/* and supabase/seed.sql
```

Create `.env.local` in the project root. Take the values from `supabase status`
(`API_URL` and `PUBLISHABLE_KEY`):

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Then:

```bash
npm run dev             # http://localhost:5173
```

The local seed (`supabase/seed.sql`, local only) creates three accounts, four fighters and
one card. Log in at `http://localhost:5173/login` with:

| username | password | role |
|---|---|---|
| `admin` | `localadmin123` | admin |
| `member1` | `localmember123` | member, linked to "The Hallway Hurricane" |
| `member2` | `localmember123` | member, linked to "Mattress Mauler" |

Create more accounts as `admin` under Admin → Members. That needs the Edge Functions running
locally (`supabase functions serve`).

Checks:

```bash
npm run build           # tsc -b && vite build
npx vitest run          # unit tests
npx oxlint src          # lint
supabase test db        # pgTAP database tests (run after supabase db reset)
supabase functions serve                      # serves admin-create-user + admin-reset-password
bash supabase/tests/http_auth_edge_test.sh    # signup disabled + admin-create-user checks (needs functions serve)
```

## Deploy

### 1. Supabase (backend)

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                                   # migrations only; seed.sql is NOT pushed
supabase config push                               # auth settings: signup OFF, site_url, redirect URLs
supabase functions deploy admin-create-user
supabase functions deploy admin-reset-password
```

`supabase/config.toml` sets `[auth] site_url = "https://uos-fight-night.pages.dev"` and
`enable_signup = false`, and `config push` copies both to the live project. Change
`site_url` first if you host somewhere else.

After pushing, check these in the dashboard:

- **Authentication → Sign In / Providers:** "Allow new users to sign up" is OFF. Email is
  enabled with *Confirm email* turned OFF.
- **Authentication → Hooks:** there is **no** *Before User Created* hook. The Wave A
  migration drops `public.hook_before_user_created`, so if one was configured earlier,
  delete it or account creation will fail.
- **Database → Extensions:** `pg_cron` is enabled. `select * from cron.job;` should list
  `auto-lock` and `weekly-points`.
- **Storage:** a private bucket named `fighter-photos` exists.

If the Edge Functions reject user tokens (this can happen on projects that use asymmetric
JWT signing keys), redeploy them with `--no-verify-jwt`. Each function still checks the
caller itself: it verifies the JWT, then requires an active admin profile.

### 2. Cloudflare Pages (frontend)

Create `.env.production.local` (or set the variables in your shell) with the production
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Vite bakes these values into the
build. Use the publishable key, never the secret or service-role key.

```bash
npx wrangler login      # once
npm run deploy          # npm run build && wrangler pages deploy dist --project-name uos-fight-night
```

The site is served at `https://uos-fight-night.pages.dev`. If you move it to a custom domain,
update the four absolute `og:` / `twitter:` URLs in `index.html` so link previews keep
working. Also add the new domain to `site_url` and `additional_redirect_urls` in
`supabase/config.toml`, then run `supabase config push` again.

## Bootstrapping the first admin

Nobody can sign up, so the first admin is created by hand, once, with the Auth Admin API and
the project's secret key. Run this from your own machine. Never commit the key, never put it
in `.env*` files that Vite reads, and never paste it into frontend code.

1. **Get the secret key** (`sb_secret_...`, or the legacy `service_role` key):
   `supabase projects api-keys --project-ref <project-ref>`, or Dashboard → Project
   Settings → API Keys.
2. **Create the auth user.** The `on_auth_user_created` trigger builds the profile from
   `user_metadata` and adds the 1000 starting points.
   ```bash
   export SB_SECRET='<secret key>'      # only in this shell
   curl -X POST "https://<project-ref>.supabase.co/auth/v1/admin/users" \
     -H "apikey: $SB_SECRET" -H "Authorization: Bearer $SB_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"email":"<username>@members.uosfight.local","password":"<temp password, 8+ chars>",
          "email_confirm":true,
          "user_metadata":{"username":"<username>","display_name":"<Shown Name>"}}'
   unset SB_SECRET
   ```
   The username must be 3 to 20 characters of `[a-z0-9_]`, and the display name 1 to 24
   characters.
3. **Promote it** in the SQL editor. `supabase/seed_admin.sql` has this plus an
   `admin_log` entry:
   ```sql
   update public.profiles set role = 'admin' where username = '<username>';
   ```
4. **Log in and create everyone else.** The first admin logs in at `https://<site>/login`,
   changes the temporary password under **Me**, and creates the other accounts under
   **Admin → Members → Create account**, including at least one more admin. Hand each person
   their username and temporary password in person, and ask them to change it.

Two or more admins are needed for fair play. An admin cannot settle or cancel a fight their
own linked fighter is in, or a fight they have an active bet on. Another admin has to do it.

## Safety and privacy

- **Private.** Only approved members can see anything. Logged-out visitors (`anon`) can call
  exactly one function, `public_next_fight()`, which returns the next fight's title, times,
  status and the two nicknames. Every table and view is closed to them. Every page carries
  `noindex, nofollow`. The landing page never shows photos or real names.
- **Points only.** The points are fun points with no cash value. They cannot be bought,
  sold, transferred or cashed out. Never add real-money features, payment links or prizes
  tied to points. Every balance change is a row in `points_ledger`, and admin adjustments
  are written to the admin log.
- **Votes stay private** until a fight locks. After that, only the totals are shown. Votes
  from people linked to one of the fighters are stored but left out of the crowd numbers.
- **Photos only with consent.** Upload a fighter's photo only if that person has said yes,
  and remove it right away if they change their mind (Admin → Fighters). Photos sit in a
  private storage bucket and members see them through signed links that expire after 1 hour.
  Use nicknames, not real names.
- **18+ only.** Admins only create accounts for people they know are 18 or older.
- **Consent per fight.** A fight with linked fighters stays `scheduled` until both have
  accepted it in the app, and either one can decline. Admins can force open a fight only
  for a corner that has no active app account, and must give a reason, which is logged.
- **Wrestle safely.** The app tracks results. It does not organise or supervise fights.
  Keep bouts consensual, supervised and safe, and follow your residence rules.
- **Secrets.** Never commit `.env*` or `.secrets/`, and never put the service-role or secret
  key in frontend code. Only the Edge Function uses it, on the server.
