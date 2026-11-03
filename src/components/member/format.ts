/** Tonight helpers (formatting, order, copy). Pure functions, no components. */
import { countdown } from '../../lib/math'
import { friendlyError } from '../../lib/supabase'
import { METHOD_LABEL, type FightRow } from '../../lib/hooks'
import type { Fighter, Side } from '../../lib/types'

// ---------- formatting (24h, Asia/Baghdad, the app's one clock) ----------

const TZ = 'Asia/Baghdad'
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const cardDayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })

/** "23:15" */
export const fmtTime = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '')
/** "Thu 6 Nov" */
export const fmtDay = (iso: string | null | undefined) => (iso ? dayFmt.format(new Date(iso)).replace(',', '') : '')
/** "Thu 6 Nov" for a YYYY-MM-DD card date (no timezone shift). */
export function fmtCardDay(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return cardDayFmt.format(new Date(Date.UTC(y, m - 1, day))).replace(',', '')
}

/** "6–1" (en dash inside record numerals only, DESIGN 4). */
export const fmtRecord = (f: Pick<Fighter, 'wins' | 'losses'> | null | undefined) => (f ? `${f.wins}–${f.losses}` : '0–0')

/** Time left until lock: "3d 4h", "1h 05m", "42m"; seconds only in the last 10 minutes (DESIGN 9). null when past. */
export function lockLeft(lockAt: string, now: Date): string | null {
  const c = countdown(lockAt, now)
  if (c.done) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  if (c.days) return `${c.days}d ${c.hours}h`
  if (c.hours) return `${c.hours}h ${pad(c.minutes)}m`
  if (c.minutes >= 10) return `${c.minutes}m`
  return `${c.minutes}m ${pad(c.seconds)}s`
}

/** "Main event" or "Bout 2" */
export const boutLabel = (f: FightRow) => (f.is_main_event ? 'Main event' : `Bout ${f.bout_order ?? 1}`)

export const sideWord = (s: Side) => (s === 'red' ? 'Red' : 'Blue')

export const isLiveBout = (f: FightRow) => f.status === 'scheduled' || f.status === 'open' || f.status === 'locked'
export const boutsLabel = (n: number) => `${n} bout${n === 1 ? '' : 's'}`

/**
 * Partitions card fights into featured (main event), undercard (live non-main bouts),
 * and finished (results). Main event is excluded from undercard.
 */
export function partitionCardBouts(cardFights: FightRow[], now: Date = new Date()) {
  const sort = tonightSort(now)
  const list = [...cardFights].sort(sort)
  const live = list.filter(isLiveBout)
  const done = list.filter(f => !isLiveBout(f))
  const featured = live.find(f => f.is_main_event)
    ?? (live.length === 0 ? done.find(f => f.is_main_event && f.status === 'settled') : undefined)
  const undercard = live.filter(f => f !== featured)
  const results = done.filter(f => f !== featured)
    .sort((a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled') || (a.bout_order ?? 0) - (b.bout_order ?? 0))
  return { featured, undercard, results }
}

/** Tonight order (P0, DESIGN 11.3): open main, open by bout order, locked, scheduled, settled, cancelled. */
const RANK: Record<string, number> = { open: 0, locked: 1, scheduled: 2, settled: 3, cancelled: 4 }
export function tonightRank(f: FightRow, now: Date) {
  const pastLock = f.status === 'open' && countdown(f.lock_at, now).done
  return pastLock ? RANK.locked : RANK[f.status] ?? 5
}
export function tonightSort(now: Date) {
  return (a: FightRow, b: FightRow) =>
    tonightRank(a, now) - tonightRank(b, now)
    || Number(!!b.is_main_event) - Number(!!a.is_main_event)
    || (a.bout_order ?? 1e6) - (b.bout_order ?? 1e6)
    || a.scheduled_at.localeCompare(b.scheduled_at)
}

export function accepted(fight: FightRow) {
  return { red: !!fight.red_accepted_at, blue: !!fight.blue_accepted_at }
}

/** "Curfew Breaker beat The Landlord 6 to 3 by pin, half nelson, in 3 rounds" */
export function resultSentence(fight: FightRow, redName: string, blueName: string) {
  if (fight.status !== 'settled' || !fight.winner_side) return ''
  const [w, l] = fight.winner_side === 'red' ? [redName, blueName] : [blueName, redName]
  const [ws, ls] = fight.winner_side === 'red' ? [fight.red_score, fight.blue_score] : [fight.blue_score, fight.red_score]
  const score = ws != null && ls != null ? ` ${ws} to ${ls}` : ''
  const how = fight.method ? ` by ${METHOD_LABEL[fight.method]?.toLowerCase() ?? fight.method}` : ''
  const move = fight.finish_move?.trim() ? `, ${fight.finish_move.trim()}` : ''
  const rds = fight.rounds ? `, in ${fight.rounds} round${fight.rounds === 1 ? '' : 's'}` : ''
  return `${w} beat ${l}${score}${how}${move}${rds}`
}

// ---------- error copy for pick actions (member-specific wording on top of friendlyError) ----------

const PICK_CODES: Record<string, string> = {
  BET_TOO_SMALL: 'Put in at least 10 pts, or just pick.',
  BET_TOO_LARGE: "That's more than you can put in right now.",
  ALREADY_BET: 'You already have points on this bout. Take them back first to change them.',
  BET_NOT_FOUND: 'That pick no longer exists.',
  BET_NOT_ACTIVE: 'That pick is already closed.',
  INSUFFICIENT_POINTS: "You don't have enough points for that.",
  FIGHT_LOCKED: 'Picks are locked for this bout.',
  PARTICIPANT: 'Picks and points are off for fighters in their own bout.',
}

export function pickError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g) ?? []) if (PICK_CODES[tok]) return PICK_CODES[tok]
  return friendlyError(e)
}
