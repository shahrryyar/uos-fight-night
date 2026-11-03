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
