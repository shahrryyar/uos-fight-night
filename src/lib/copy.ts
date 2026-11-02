/**
 * Single home of shared user-facing strings (DESIGN.md section 12: fun points, never money words;
 * no em dashes). Screen builders: import from here instead of hard-coding labels.
 */
import type { BetStatus, CancelKind, FightStatus, LedgerReason, WinMethod } from './types'

/** The one disclaimer line (footer). Replaces the old NO_CASH subtitles. */
export const FUN_POINTS_LINE = "Fun points only. They're for bragging rights, nothing else."

export const CREDIT_URL = 'https://regalabs.dev'

/** Stamp label for a fight state (DESIGN 11.3 stamp text map). */
export function statusStampText(status: FightStatus, opts: { cancelKind?: CancelKind | null; pastLock?: boolean } = {}): string {
  switch (status) {
    case 'scheduled': return 'Booked'
    case 'open': return opts.pastLock ? 'Locked' : 'Picks open'
    case 'locked': return 'Locked'
    case 'settled': return 'Final'
    case 'cancelled': return opts.cancelKind === 'no_contest' ? 'No contest' : 'Called off'
  }
}

/** Static map for simple lookups (cancelled defaults to "Called off"). */
export const STATUS_STAMP: Record<FightStatus, string> = {
  scheduled: 'Booked',
  open: 'Picks open',
  locked: 'Locked',
  settled: 'Final',
  cancelled: 'Called off',
}

/** "Win by pin" / "Win by submission" / "Win by decision" (result stamp on the winner photo). */
export function resultStampText(method: WinMethod | string | null | undefined): string {
  return method ? `Win by ${String(method).toLowerCase()}` : 'Win'
}

/** Points log reasons (Me > Points log). */
export const LEDGER_REASON: Record<LedgerReason, string> = {
  signup: 'Welcome points',
  weekly: 'Weekly points',
  topup: 'Low-balance top-up',
  bet: 'Pick placed',
  bet_cancel: 'Pick taken back',
  payout: 'Pick won',
  refund: 'Points came back',
  payout_reversal: 'Result fixed: points taken back',
  admin_adjust: 'Admin change',
}

/** Status of a points pick (Me > Picks). */
export const BET_STATUS: Record<BetStatus, string> = {
  active: 'Live',
  won: 'Won',
  lost: 'Lost',
  refunded: 'Came back',
  cancelled: 'Taken back',
}

/** Cancelled-bout copy in plain fun-points words, no em dashes (replaces hooks.cancelCopy for new UI). */
export function cancelCopy(kind: CancelKind | null | undefined): { stamp: string; sub: string } {
  switch (kind) {
    case 'no_contest': return { stamp: 'No contest', sub: 'Stopped with no result. No record change. Every pick came back in full.' }
    case 'declined': return { stamp: 'Called off', sub: 'A fighter passed on this booking. No record change.' }
    default: return { stamp: 'Called off', sub: 'Cancelled. Every pick came back in full.' }
  }
}

/** 1240 -> "1,240" (Intl thousands separators, WIG). */
export const fmtNum = (n: number | null | undefined) => new Intl.NumberFormat('en-GB').format(n ?? 0)

/** Signed delta with a true minus: 14 -> "+14", -14 -> "−14", 0 -> "0". */
export const fmtDelta = (n: number) => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? `−${fmtNum(-n)}` : '0')
