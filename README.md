# UoS Fight Night

A private, invite-only web app for a dorm wrestling league (about 10 to 20 fighters, under
100 members, all 18+). Members get a fight card for each bout, vote for a corner, put fun
points on a side, react with emoji, and follow fighter records, Elo rankings and a points
leaderboard. Admins run the league: fighters and photos, fights (create, lock, settle,
cancel), invites, members, point adjustments and an audit log.

The points are fun points with no cash value. Nothing can be bought, sold or cashed out.

## Stack

- **Frontend:** Vite 8, React 19, TypeScript, Tailwind CSS v4, react-router-dom v7.
  The look is a dark fight poster: red corner against blue corner, gold accents, Bebas Neue
  headings. It is built for phones first (390px wide).
- **Backend:** Supabase (Postgres with RLS, Auth, Storage, Realtime, pg_cron, one Edge
  Function). All writes go through `security definer` RPCs. The browser never writes a table
  directly. See [`supabase/README.md`](supabase/README.md) for the security model, RPCs,
  error codes and cron jobs.
- **Hosting:** Cloudflare Pages (static `dist/`).
- **Tests:** Vitest for the point and Elo math (`src/lib/math.test.ts`), and pgTAP for the
  database (`supabase/tests/fight_night_test.sql`).

### Login

Members log in with a username and password, and joining needs an invite code. There is no
email and no Google sign-in. Behind the scenes each username maps to a placeholder email,
`<username>@members.uosfight.local`, that never receives mail. The
`hook_before_user_created` auth hook rejects any signup that lacks a valid invite or uses a
bad or taken username. Using an invite approves the member, and they start with 1000
points. Since there is no email, a forgotten password is reset by an admin, through the
`admin-reset-password` Edge Function.

### Routes

| Route | Who | What |
|---|---|---|
| `/` | public | Landing page: countdown to the next fight, matchup shown by nickname only (no photos), Join and Login buttons |
| `/join?code=XXXX` | public | Sign up with an invite code |
| `/login` | public | Username and password login |
| `/app` | members | Tonight's fight card: vote, points pool, reactions, share poster |
| `/app/fighters`, `/app/fighters/:id` | members | Fighter list and profiles (record, streak, Elo, last 5 fights, head-to-head) |
| `/app/leaderboard` | members | Elo rankings and points leaderboard |
| `/app/history` | members | Past fights |
| `/app/me` | members | Balance, bet history, points ledger, change password |
| `/admin/*` | admins | Fighters, fights, invites, members, points, admin log |

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

The local seed creates the invite code `LOCALDEV`, four fighters and one open fight. To try
it out:

1. Sign up at `http://localhost:5173/join?code=LOCALDEV`.
2. Make yourself an admin in Studio (http://127.0.0.1:54323) or psql:
   `update public.profiles set role = 'admin' where username = 'yourname';`

Checks:

```bash
npm run build           # tsc -b && vite build
npx vitest run          # math unit tests
npx oxlint src          # lint
supabase test db        # pgTAP database tests (run after supabase db reset)
supabase functions serve admin-reset-password   # optional: run the Edge Function locally
```

## Deploy

### 1. Supabase (backend)

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                                   # migrations only; seed.sql is NOT pushed
supabase config push                               # auth settings + before_user_created hook
supabase functions deploy admin-reset-password
```

Before running `config push`, open `supabase/config.toml` and set `[auth] site_url` to the
production address (for example `https://uos-fight-night.pages.dev`). The file currently
says `http://localhost:5173`, and `config push` copies that value to the live project.

After pushing, check these in the dashboard:

- **Authentication → Hooks:** *Before User Created* should point to
  `public.hook_before_user_created`.
- **Authentication → Providers → Email:** enabled, with *Confirm email* turned OFF.
- **Database → Extensions:** `pg_cron` is enabled. `select * from cron.job;` should list
  `auto-lock` and `weekly-points`.
- **Storage:** a private bucket named `fighter-photos` exists.

If the Edge Function rejects user tokens (this can happen on projects that use asymmetric
JWT signing keys), redeploy it with `--no-verify-jwt`. The function still checks the caller
itself: it verifies the JWT, then requires an active admin profile.

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

## Bootstrapping the first admin and the first invite

The production database starts with no invites and no admins. In the Supabase SQL editor:

1. **Create a bootstrap invite:**
   ```sql
   insert into public.invites (code, max_uses, expires_at)
   values ('FIRSTFIGHT', 100, now() + interval '30 days');
   ```
2. **Each founding admin signs up** at `https://<site>/join?code=FIRSTFIGHT`.
3. **Promote at least two admins.** This is the same as `supabase/seed_admin.sql`:
   ```sql
   update public.profiles set role = 'admin'
    where username in ('first_admin_username', 'second_admin_username');
   ```
4. **Send out invites from the app.** From then on, admins create single-use or limited
   invite codes under **Admin → Invites** and share `https://<site>/join?code=XXXXXXXX`.
   Once the founders are in, revoke the bootstrap code:
   ```sql
   update public.invites set revoked = true where code = 'FIRSTFIGHT';
   ```

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
- **18+ only.** Signup asks people to confirm they are 18 or older.
- **Wrestle safely.** The app tracks results. It does not organise or supervise fights.
  Keep bouts consensual, supervised and safe, and follow your residence rules.
- **Secrets.** Never commit `.env*` or `.secrets/`, and never put the service-role or secret
  key in frontend code. Only the Edge Function uses it, on the server.
