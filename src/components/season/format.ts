/**
 * Season helpers (CONTRACT B7). Dates are Asia/Baghdad, day-month order, no em or en dashes
 * in ranges (DESIGN 4: the en dash is reserved for score and record numerals).
 */
import type { Season, SeasonSnapshot } from '../../lib/types'

const TZ = 'Asia/Baghdad'
const parts = (iso: string, o: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).formatToParts(new Date(iso))
    .map(p => [p.type, p.value])) as Record<string, string>

/** "4 Oct 2026" */
export const fmtSeasonDay = (iso: string, withYear = true) => {
  const p = parts(iso, { day: 'numeric', month: 'short', year: 'numeric' })
  return withYear ? `${p.day} ${p.month} ${p.year}` : `${p.day} ${p.month}`
}

/** "4 Oct to 3 Nov 2026" / "20 Dec 2025 to 3 Feb 2026" */
export const fmtSeasonRange = (from: string, to: string) => {
  const sameYear = parts(from, { year: 'numeric' }).year === parts(to, { year: 'numeric' }).year
  return `${fmtSeasonDay(from, !sameYear)} to ${fmtSeasonDay(to)}`
}

/** Whole weeks (or days under two weeks) between two instants: "5 weeks", "9 days", "1 day". */
export const fmtSpan = (from: string, to: string | number = Date.now()) => {
  const days = Math.max(0, Math.floor(((typeof to === 'number' ? to : Date.parse(to)) - Date.parse(from)) / 86_400_000))
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  const w = Math.floor(days / 7)
  return `${w} weeks`
}

/** Suggested next name: "Season 1" → "Season 2". Only a small trailing counter is bumped; a year is left alone. */
export const nextSeasonName = (name: string) => {
  const m = /^(.*?)(\d+)\s*$/.exec(name.trim())
  if (!m) return ''
  const n = Number(m[2])
  // a trailing year (2026) is not a counter, so leave the field for the admin
  if (n >= 1900) return ''
  return `${m[1]}${n + 1}`
}

export type SnapFighter = SeasonSnapshot['fighters'][number]
export type SnapPicker = SeasonSnapshot['bettors'][number]

/** Final top N fighters: only fighters who fought that season carry a rank. */
export const topFighters = (s: SeasonSnapshot | null, n = 5): SnapFighter[] =>
  (s?.fighters ?? []).filter(f => f.rank != null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.nickname.localeCompare(b.nickname)).slice(0, n)

export const pickerName = (p: { display_name?: string | null; username?: string | null } | null | undefined) =>
  p?.display_name?.trim() || p?.username?.trim() || 'Member'

export const isOpen = (s: Pick<Season, 'ended_at'>) => s.ended_at == null
