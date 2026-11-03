/** C5 callouts: copy, error text and small pure helpers shared by the member board and the admin queue. */
import { friendlyError } from '../../lib/supabase'
import { CALLOUT_MESSAGE_MAX, type CalloutBoardRow, type CalloutStatus } from '../../lib/types'

export { CALLOUT_MESSAGE_MAX }

/**
 * callout_board row plus the booked fight's state (20261103000033: appended view columns). Optional so
 * rows from an older server still type-check; null when nothing is booked.
 */
export type BoardRow = CalloutBoardRow & {
  fight_status?: 'scheduled' | 'open' | 'locked' | 'settled' | 'cancelled' | null
  fight_cancel_kind?: 'cancelled' | 'no_contest' | 'declined' | null
  fight_scheduled_at?: string | null
}

/** Booked, but the fight it made was declined or cancelled: the board says "Called off". */
export const isCalledOff = (c: BoardRow) => c.status === 'booked' && c.fight_status === 'cancelled'
/** API: a challenger may hold at most 3 open callouts (pending / accepted / approved). */
export const CALLOUT_OPEN_LIMIT = 3

export type RematchFight = {
  id: string
  status: string
  winner_side: string | null
  red_fighter_id: string
  blue_fighter_id: string
}

export function isRematchLoser(fight: RematchFight, fighterId: string | null | undefined): boolean {
  if (!fighterId || fight.status !== 'settled' || !fight.winner_side) return false
  const loser = fight.winner_side === 'red' ? fight.blue_fighter_id : fight.red_fighter_id
  return loser === fighterId
}

/** Stamp text per status. Every stamp is real state (DESIGN 11.7). */
export const CALLOUT_STAMP: Record<CalloutStatus, string> = {
  pending: 'Called out',
  accepted: 'Accepted',
  approved: 'Approved',
  booked: 'Booked',
  declined: 'Declined',
  rejected: 'Not booked',
}

/** Stamp for a board row: the status stamp, or "Called off" for a booked callout whose fight is off. */
export const calloutStamp = (c: BoardRow) => (isCalledOff(c) ? 'Called off' : CALLOUT_STAMP[c.status])

export const isOpenStatus = (s: CalloutStatus) => s === 'pending' || s === 'accepted' || s === 'approved'

/** Refusals from API.md "New error codes" (C5), then the app-wide map. Never shows a raw code. */
const CODES: Record<string, string> = {
  SITE_LOCKED: "We're down for maintenance. Check back later.",
  INVALID_MESSAGE: `Keep it under ${CALLOUT_MESSAGE_MAX} characters, on one line, with no hidden characters.`,
  NOT_A_FIGHTER: 'Only fighters can call someone out.',
  SAME_FIGHTER: "You can't call yourself out.",
  FIGHTER_HIDDEN: "That fighter isn't on the board right now.",
  NOT_REMATCH_ELIGIBLE: 'Only the fighter who lost can ask for a rematch.',
  CALLOUT_LIMIT: `You already have ${CALLOUT_OPEN_LIMIT} open callouts. Withdraw one or wait for an answer.`,
  CALLOUT_EXISTS: "There's already an open callout between you two.",
  CALLOUT_COOLDOWN: 'Too soon to call this fighter out again. Give it a few days.',
  CALLOUT_DAILY_LIMIT: "That's 5 callouts today. Try again tomorrow.",
  CALLOUT_NOT_FOUND: 'That callout is gone.',
  CALLOUT_BAD_STATE: 'That callout has already moved on. The board is up to date now.',
  NOT_TARGET: 'Only the fighter called out can answer.',
  NOT_CHALLENGER: 'Only the fighter who made the callout can withdraw it.',
  INVALID_REASON: 'Keep the reason under 200 characters, on one line, with no hidden characters.',
  PARTICIPANT: "You're one of these fighters, so another admin has to handle this callout.",
}

export function calloutError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{4,}/g) ?? []) if (CODES[tok]) return CODES[tok]
  return friendlyError(e)
}

/**
 * Invisible / direction-control characters the server refuses (private.has_hidden_chars): zero-width
 * spaces, LRM/RLM, embeddings and overrides, isolates, BOM, soft hyphen, Hangul fillers, tag characters.
 * ZWJ (U+200D) and variation selectors stay: emoji need them.
 */
// eslint-disable-next-line eslint/no-misleading-character-class
const HIDDEN = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u200C\u200E\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu

/** Drops characters that would hide or reverse text on the board. */
export const stripHidden = (s: string) => s.replace(HIDDEN, '')

/** Message as typed, with line breaks folded to spaces and hidden characters dropped (the server refuses both). */
export const oneLine = (s: string) => stripHidden(s).replace(/[\r\n\t]+/g, ' ')

/** Curly quotes around a stored message. */
export const quoted = (s: string) => `“${s.trim()}”`

/** "A vs B" / "Rematch: A vs B": the same title admin_approve_callout builds (red = challenger). */
export const calloutTitle = (c: Pick<CalloutBoardRow, 'challenger_nickname' | 'target_nickname' | 'rematch_of'>) =>
  `${c.rematch_of ? 'Rematch: ' : ''}${c.challenger_nickname} vs ${c.target_nickname}`

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', day: 'numeric', month: 'short' })
/** "2 Nov" */
export const fmtShortDay = (iso: string | null | undefined) => (iso ? dayFmt.format(new Date(iso)) : '')

/** The status sentence under a board row (names stay in <bdi> at the call site, so this returns parts). */
export function statusLine(c: CalloutBoardRow): string {
  switch (c.status) {
    case 'pending': return 'Waiting on an answer.'
    case 'accepted': return 'Both fighters want it. Waiting on an admin to book it.'
    case 'approved': return 'Approved. An admin is setting the date.'
    case 'booked': return 'Booked. Both fighters still say yes on Tonight before picks open.'
    case 'declined': return 'Turned down.'
    case 'rejected': return 'An admin passed on this one.'
  }
}
