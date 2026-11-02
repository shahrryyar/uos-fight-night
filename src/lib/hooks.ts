import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import type { Fight, Fighter, FighterRanking, Profile, Side, WinMethod } from './types'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Runs an async loader on mount and whenever deps change.
 * `reload()` refetches silently (keeps old data visible, no loading flash).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn })
  const seq = useRef(0)

  const run = useCallback(async (silent: boolean) => {
    const id = ++seq.current
    if (!silent) setLoading(true)
    try {
      const v = await fnRef.current()
      if (id === seq.current) { setData(v); setError(null) }
    } catch (e) {
      if (id === seq.current) setError(friendlyError(e))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void run(false) }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => run(true), [run])
  return { data, error, loading, reload }
}

/** Throws the supabase error if present, otherwise returns data. */
export function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

/** Re-renders every `ms` and returns the current Date (for countdowns). */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Calls `fn` every `ms` while the tab is visible. */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') ref.current() }, ms)
    const onVis = () => { if (document.visibilityState === 'visible') ref.current() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [ms, enabled])
}

type PgEvent = 'INSERT' | 'UPDATE' | 'DELETE'
export interface RealtimeSub {
  table: string
  /** postgres_changes filter, e.g. `fight_id=eq.<uuid>` (not applied to DELETE by Supabase). */
  filter?: string
  /** Optional client-side check on the raw payload (new/old records). */
  match?: (row: Record<string, unknown>) => boolean
}

/**
 * Subscribes to postgres_changes for the given tables and calls `onChange`
 * (debounced 250ms) whenever any matching row changes.
 */
export function useRealtime(key: string, subs: RealtimeSub[], onChange: () => void, enabled = true) {
  const cb = useRef(onChange)
  const subsRef = useRef(subs)
  useEffect(() => { cb.current = onChange; subsRef.current = subs })
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const fire = () => { clearTimeout(timer); timer = setTimeout(() => cb.current(), 250) }
    const ch = supabase.channel(`rt:${key}:${Math.random().toString(36).slice(2, 8)}`)
    for (const s of subsRef.current) {
      ch.on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) } as never,
        ((payload: { eventType: PgEvent; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          if (s.match) {
            const row = payload.eventType === 'DELETE' ? payload.old : payload.new
            if (row && Object.keys(row).length && !s.match(row)) return
          }
          fire()
        }) as never,
      )
    }
    ch.subscribe()
    return () => { clearTimeout(timer); void supabase.removeChannel(ch) }
  }, [key, enabled])
}

/** Current user's balance via my_balance() RPC. */
export function useBalance() {
  const st = useAsync(async () => {
    const r = await supabase.rpc('my_balance')
    if (r.error) throw r.error
    return Number(r.data ?? 0)
  }, [])
  return { balance: st.data, error: st.error, loading: st.loading, reload: st.reload }
}

/** Loads fighters by id (or all visible when ids omitted) into a Map. */
export function useFightersMap(ids?: string[]) {
  const key = ids ? [...new Set(ids)].sort().join(',') : '*'
  return useAsync(async () => {
    let q = supabase.from('fighters').select('*')
    if (ids) {
      if (!ids.length) return new Map<string, Fighter>()
      q = q.in('id', [...new Set(ids)])
    }
    const rows = must(await q) as Fighter[]
    return new Map(rows.map(f => [f.id, f]))
  }, [key])
}

/** Loads display names (and usernames) for a set of profile ids. */
export function useProfilesMap(ids: string[]) {
  const key = [...new Set(ids.filter(Boolean))].sort().join(',')
  return useAsync(async () => {
    if (!key) return new Map<string, Pick<Profile, 'id' | 'username' | 'display_name'>>()
    const rows = must(await supabase.from('profiles').select('id,username,display_name').in('id', key.split(','))) as Pick<Profile, 'id' | 'username' | 'display_name'>[]
    return new Map(rows.map(p => [p.id, p]))
  }, [key])
}

/** The name shown on every screen: display_name (admin-set), never the login username. */
export const displayName = (p: Pick<Profile, 'display_name'> & { username?: string | null } | null | undefined, fallback = 'Member') =>
  p?.display_name?.trim() || fallback

/** Map of profile id → display name. */
export function useDisplayNames(ids: string[]) {
  const st = useProfilesMap(ids)
  const map = new Map<string, string>()
  for (const [k, v] of st.data ?? []) map.set(k, displayName(v))
  return map
}

// ---------- Wave A row types (columns added by Addendum A / B2 / B3) ----------

export type CancelKind = 'cancelled' | 'no_contest' | 'declined'

/** fights row incl. match-stats, consent and bout-order columns. */
export type FightRow = Fight & {
  red_weight_kg?: number | string | null
  blue_weight_kg?: number | string | null
  rounds?: number | null
  red_score?: number | null
  blue_score?: number | null
  finish_move?: string | null
  red_accepted_at?: string | null
  blue_accepted_at?: string | null
  cancel_kind?: CancelKind | null
  bout_order?: number | null
  is_main_event?: boolean | null
  card_date?: string | null
}

/** One row of view `fight_results` (one per settled fight per fighter perspective). */
export interface FightResult {
  fight_id: string
  fighter_id: string
  opponent_id: string
  side: Side
  result: 'W' | 'L'
  method: WinMethod | null
  finish_move: string | null
  rounds: number | null
  score_for: number | null
  score_against: number | null
  weight_kg: number | string | null
  opponent_weight_kg: number | string | null
  elo_delta: number | null
  settled_at: string | null
  result_note: string | null
}

/** fighter_rankings incl. Addendum A totals. */
export type FighterStats = FighterRanking & {
  total_rounds?: number | null
  points_for?: number | null
  points_against?: number | null
  wins_pin?: number | null
  wins_submission?: number | null
  wins_decision?: number | null
  losses_pin?: number | null
  losses_submission?: number | null
  losses_decision?: number | null
  weight_kg?: number | string | null
}

/** numeric columns arrive as strings from PostgREST; normalise. */
export const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "72.5 kg" (or '' when unknown). */
export const fmtKg = (v: number | string | null | undefined) => {
  const n = num(v)
  return n == null ? '' : `${Number.isInteger(n) ? n : n.toFixed(1)} kg`
}

/** Weight for a corner: the fight's snapshot, else the fighter's current weight. */
export const cornerKg = (f: FightRow, side: Side, fighter?: Pick<Fighter, 'weight_kg'> | null) =>
  num(side === 'red' ? f.red_weight_kg : f.blue_weight_kg) ?? num(fighter?.weight_kg)

/** "PIN (half nelson)" style — method upper-cased by caller's CSS if desired. */
export const methodMove = (method: string | null | undefined, move?: string | null) => {
  const m = method ? (METHOD_LABEL[method] ?? method) : '—'
  return move?.trim() ? `${m} (${move.trim()})` : m
}

/** "Lost by pin" */
export const lostBy = (method: string | null | undefined) => `Lost by ${method ? (METHOD_LABEL[method] ?? method).toLowerCase() : '—'}`

/** "6 – 3" (en dash) or '' when scores missing. */
export const fmtScore = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? '' : `${a} – ${b}`

export const fmtRounds = (n: number | null | undefined) => (n == null ? '' : `${n} round${n === 1 ? '' : 's'}`)

/** Asia/Baghdad calendar date (YYYY-MM-DD) — fallback when card_date is absent. */
export const baghdadDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

export const cardDateOf = (f: FightRow) => f.card_date ?? baghdadDate(f.scheduled_at)

/** "Fri, Nov 7" for a YYYY-MM-DD card date (no timezone shift). */
export const fmtCardDate = (d: string, withYear = false) => {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString(undefined,
    withYear ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' })
}

type BoutSortable = Pick<FightRow, 'scheduled_at'> & { is_main_event?: boolean | null; bout_order?: number | null }

/** Bout order within a card: by bout_order, main event always last. Shared by member and admin views. */
export const boutSort = (a: BoutSortable, b: BoutSortable) =>
  Number(!!a.is_main_event) - Number(!!b.is_main_event)
  || (a.bout_order ?? 1e6) - (b.bout_order ?? 1e6)
  || a.scheduled_at.localeCompare(b.scheduled_at)

/** Cancellation line: plain cancel / no contest / declined. */
export function cancelCopy(f: FightRow): { title: string; sub: string } {
  switch (f.cancel_kind) {
    case 'no_contest': return { title: 'NO CONTEST — points refunded', sub: 'Stopped with no result. No record change.' }
    case 'declined': return { title: 'Fight declined', sub: 'A fighter passed on this booking. No record change.' }
    default: return { title: 'Fight cancelled', sub: 'All points picks were refunded.' }
  }
}

export interface CardGroup<T extends FightRow> { cardDate: string; fights: T[] }

/** Groups fights by card_date; fights within a card in bout order (main event last). */
export function groupByCard<T extends FightRow>(fights: T[], newestFirst = false): CardGroup<T>[] {
  const by = new Map<string, T[]>()
  for (const f of fights) {
    const k = cardDateOf(f)
    const arr = by.get(k)
    if (arr) arr.push(f); else by.set(k, [f])
  }
  return [...by.entries()]
    .sort(([a], [b]) => (newestFirst ? b.localeCompare(a) : a.localeCompare(b)))
    .map(([cardDate, list]) => ({ cardDate, fights: liveMainOnly(list).sort(boutSort) }))
}

/**
 * A cancelled main event keeps is_main_event = true in the db, and a replacement can be
 * booked as main on the same card. When a non-cancelled main exists, drop the flag from the
 * cancelled ones so the card shows a single MAIN EVENT. A lone cancelled/no-contest main keeps it.
 */
export function liveMainOnly<T extends FightRow>(list: T[]): T[] {
  const hasLiveMain = list.some(f => f.is_main_event && f.status !== 'cancelled')
  if (!hasLiveMain) return [...list]
  return list.map(f => (f.is_main_event && f.status === 'cancelled' ? { ...f, is_main_event: false } : f))
}

export const record = (f: Pick<Fighter, 'wins' | 'losses'> | null | undefined) => (f ? `${f.wins}-${f.losses}` : '0-0')

export const fmtDate = (iso: string | null | undefined, withTime = true) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, withTime
    ? { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

export const fmtPts = (n: number | null | undefined) => `${(n ?? 0).toLocaleString()} pts`

export const METHOD_LABEL: Record<string, string> = { pin: 'Pin', submission: 'Submission', decision: 'Decision' }
