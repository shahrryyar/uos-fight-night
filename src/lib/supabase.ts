import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY')

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@members.uosfight.local`

/**
 * Error codes raised by `raise exception '<CODE>'` in supabase/migrations/*.sql
 * and returned as `{ error: '<CODE>' }` by the edge functions.
 * Matched as whole tokens, so NOT_PARTICIPANT never falls through to PARTICIPANT.
 */
const CODES: Record<string, string> = {
  // auth / membership
  NOT_MEMBER: 'You need to be an active member to do that.',
  NOT_ADMIN: 'Admins only.',
  MEMBER_NOT_FOUND: 'That member no longer exists.',
  INVALID_USER: 'That member no longer exists.',
  LAST_ADMIN: "You can't remove the last admin. Make someone else admin first.",
  INVALID_ROLE: 'Pick a valid role.',
  USERNAME_TAKEN: 'That username is taken.',
  INVALID_USERNAME: 'Username must be 3–20 characters: a–z, 0–9 or _.',
  INVALID_DISPLAY_NAME: 'Display name must be 1–24 characters.',
  DISPLAY_NAME_TAKEN: 'That display name is already used.',
  WEAK_PASSWORD: 'Password must be at least 8 characters.',
  FIGHTER_ALREADY_LINKED: 'That fighter is already linked to another member.',
  FIGHTER_HAS_ACCOUNT: 'This fighter has an app account and must accept the fight themselves.',
  // legacy invite flow (removed, kept so old errors still read well)
  INVALID_INVITE: 'Sign-ups are closed. Ask an admin for your login.',
  INVITE_NOT_FOUND: 'Sign-ups are closed. Ask an admin for your login.',
  INVALID_MAX_USES: 'Sign-ups are closed. Ask an admin for your login.',
  // fighters
  FIGHTER_NOT_FOUND: 'That fighter no longer exists.',
  NICKNAME_TAKEN: 'Another fighter already has that nickname.',
  INVALID_NICKNAME: 'Nickname must be 1–40 characters.',
  INVALID_PHOTO_PATH: "That photo couldn't be saved. Try uploading again.",
  INVALID_WEIGHT: 'Weight must be a sensible number of kg.',
  // fights: booking + card
  FIGHT_NOT_FOUND: 'That fight no longer exists.',
  INVALID_FIGHTERS: 'Pick two different fighters.',
  INVALID_TIME: 'Picks must lock before (or when) the fight starts, and in the future.',
  MAIN_EVENT_EXISTS: 'That card already has a main event.',
  INVALID_BOUT_ORDER: 'Bout order must be a positive number.',
  INVALID_CARD: 'Those fights are not all on that card.',
  CARD_MISMATCH: 'Those fights are not all on that card.',
  // fights: consent + lifecycle
  NOT_PARTICIPANT: "You're not booked in this fight.",
  NOT_SCHEDULED: 'This fight is no longer waiting for fighters to accept.',
  ALREADY_ACCEPTED: 'You already accepted this fight.',
  FIGHT_NOT_OPEN: "Picks aren't open for this fight yet.",
  FIGHT_LOCKED: 'Picks are locked for this fight.',
  FIGHT_CANCELLED: 'This fight was called off.',
  NOT_LOCKED: 'Lock the fight before doing that.',
  INVALID_STATUS: "That can't be done at this stage of the fight.",
  INVALID_KIND: 'Pick cancelled or no contest.',
  REASON_REQUIRED: 'Add a reason (at least 5 characters).',
  // fights: results
  ALREADY_SETTLED: 'This fight is already settled.',
  NOT_SETTLED: "This fight hasn't been settled yet.",
  INVALID_SIDE: 'Pick red or blue.',
  INVALID_METHOD: 'Pick pin, submission or decision.',
  INVALID_ROUNDS: 'Rounds must be between 1 and 20.',
  INVALID_SCORE: "Scores can't be negative.",
  SCORE_MISMATCH: 'For a decision, the winner needs the higher score.',
  INVALID_FINISH_MOVE: 'Finish move must be 60 characters or less.',
  NOTE_TOO_LONG: 'Note must be 200 characters or less.',
  INVALID_NOTE: 'Notes and reasons must be 200 characters or less.',
  LATER_FIGHT_EXISTS: 'One of these fighters has a newer settled fight. Correct the newest one first.',
  ADMIN_HAS_BET: "You have a bet on this fight, so another admin has to record it.",
  PARTICIPANT: "You can't do that on your own fight.",
  // bets / points / reactions
  INSUFFICIENT_POINTS: 'Not enough points.',
  BET_TOO_SMALL: 'Minimum bet is 10 points.',
  BET_TOO_LARGE: "That's over your max bet.",
  ALREADY_BET: 'You already have a bet on this fight.',
  BET_NOT_FOUND: 'That bet no longer exists.',
  BET_NOT_ACTIVE: 'That bet is already closed.',
  INVALID_DELTA: 'Enter a non-zero number of points.',
  INVALID_EMOJI: "That reaction isn't available.",
  // edge functions
  INVALID_BODY: 'Some fields are missing or invalid.',
  METHOD_NOT_ALLOWED: 'Something went wrong. Please try again.',
  UPDATE_FAILED: "Couldn't save that. Please try again.",
  CREATE_FAILED: "Couldn't create that account. Please try again.",
  SERVER_ERROR: 'Server error. Please try again.',
  SERVER_MISCONFIGURED: 'The server is not set up correctly. Tell an admin.',
}

/** Non-code messages (Supabase Auth / PostgREST / network), matched case-insensitively. */
const PHRASES: [RegExp, string][] = [
  [/invalid login credentials/i, 'Wrong username or password.'],
  [/signups? not allowed|signup is disabled/i, 'Sign-ups are closed. Ask an admin for your login.'],
  [/user already registered|already been registered|already exists/i, 'That username is taken.'],
  [/new password should be different/i, 'Pick a password you haven’t used before.'],
  [/password should be at least|password is too short/i, 'Password must be at least 8 characters.'],
  [/rate limit|too many requests/i, 'Too many tries. Wait a minute and try again.'],
  [/jwt expired|invalid jwt|session.*(missing|not found)|refresh token/i, 'Your session expired. Log in again.'],
  [/permission denied|row-level security/i, "You don't have access to that."],
  [/failed to fetch|networkerror|network request failed|load failed/i, "Can't reach the server. Check your connection."],
  [/edge function returned a non-2xx/i, 'Something went wrong. Please try again.'],
]

const CODE_TOKEN = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{4,}/g

/** Maps Postgres/RPC/Auth error messages (e.g. 'FIGHT_LOCKED') to friendly text. */
export function friendlyError(e: unknown): string {
  const raw = typeof e === 'string' ? e : (e as { message?: string; error?: string })?.message ?? (e as { error?: string })?.error ?? String(e)
  const msg = String(raw ?? '')
  for (const tok of msg.match(CODE_TOKEN) ?? []) if (CODES[tok]) return CODES[tok]
  for (const [re, text] of PHRASES) if (re.test(msg)) return text
  // Unknown bare CODE → readable sentence instead of SHOUTY_SNAKE
  if (/^[A-Z][A-Z0-9_]+$/.test(msg.trim())) {
    const s = msg.trim().toLowerCase().replace(/_/g, ' ')
    return `${s[0].toUpperCase()}${s.slice(1)}.`
  }
  return msg || 'Something went wrong. Please try again.'
}

/**
 * For `supabase.functions.invoke` errors: reads the `{ error: CODE }` JSON body
 * from the failed response (FunctionsHttpError.context) and maps it.
 */
export async function friendlyFunctionError(e: unknown): Promise<string> {
  const ctx = (e as { context?: unknown })?.context
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = await (ctx as Response).clone().json() as { error?: string; message?: string }
      if (body?.error || body?.message) return friendlyError(body.error ?? body.message)
    } catch { /* not JSON */ }
  }
  return friendlyError(e)
}
