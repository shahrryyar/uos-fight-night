/** Reign copy helpers (plain words, data in Courier by the caller). */
import type { BeltEndReason } from '../../lib/types'

const DAY = 86_400_000

/** Whole days between two instants (end defaults to now). */
export const reignDays = (startIso: string, endIso?: string | null, now = Date.now()) =>
  Math.max(0, Math.floor(((endIso ? Date.parse(endIso) : now) - Date.parse(startIso)) / DAY))

/** "7 days" / "1 day" / "Under a day" */
export const daysText = (n: number) => (n <= 0 ? 'Under a day' : n === 1 ? '1 day' : `${n.toLocaleString('en-GB')} days`)

/** "No defenses yet" / "1 defense" / "3 defenses" */
export const defensesText = (n: number, none = 'No defenses yet') =>
  n <= 0 ? none : n === 1 ? '1 defense' : `${n} defenses`

/** How a reign began. */
export const wonHow = (wonFightId: string | null) => (wonFightId ? 'Won it in a fight' : 'Awarded by an admin')

/** How a reign ended (null = still holds it). */
export const endHow = (reason: BeltEndReason | null) =>
  reason === 'lost' ? 'Lost it in a fight'
  : reason === 'vacated' ? 'Belt vacated by an admin'
  : reason === 'reassigned' ? 'Belt moved by an admin'
  : 'Still holds it'

export const BELT_CODES: Record<string, string> = {
  NO_CHAMPION: 'Nobody holds the belt, so there is nothing to vacate.',
  ALREADY_CHAMPION: 'That fighter already holds the belt.',
  INVALID_NOTE: 'Keep the note to 200 characters.',
  PARTICIPANT: 'You are linked to this fighter or the champion, so another admin has to move the belt.',
  FIGHTER_NOT_FOUND: 'That fighter no longer exists.',
}

export function beltError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g) ?? []) if (BELT_CODES[tok]) return BELT_CODES[tok]
  return raw || 'Failed to update title belt.'
}

