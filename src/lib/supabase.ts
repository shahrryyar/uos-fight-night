import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY')

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@members.uosfight.local`

/** Maps Postgres/RPC error messages (e.g. 'FIGHT_LOCKED') to friendly text. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e)
  const map: Record<string, string> = {
    FIGHT_LOCKED: 'Picks are locked for this fight.',
    NOT_MEMBER: 'You need to be a member.',
    NOT_ADMIN: 'Admins only.',
    INSUFFICIENT_POINTS: 'Not enough points.',
    BET_TOO_SMALL: 'Minimum bet is 10 points.',
    BET_TOO_LARGE: 'That is over your max bet.',
    ALREADY_BET: 'You already have a bet on this fight.',
    PARTICIPANT: "You can't bet on your own fight.",
    ALREADY_SETTLED: 'This fight is already settled.',
    INVALID_INVITE: 'That invite code is not valid.',
    USERNAME_TAKEN: 'That username is taken.',
    'Invalid login credentials': 'Wrong username or password.',
  }
  for (const [k, v] of Object.entries(map)) if (msg.includes(k)) return v
  return msg
}
