import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import type { Fighter, Profile } from './types'

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

/** Loads usernames for a set of profile ids. */
export function useProfilesMap(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',')
  return useAsync(async () => {
    if (!key) return new Map<string, Pick<Profile, 'id' | 'username' | 'display_name'>>()
    const rows = must(await supabase.from('profiles').select('id,username,display_name').in('id', key.split(','))) as Pick<Profile, 'id' | 'username' | 'display_name'>[]
    return new Map(rows.map(p => [p.id, p]))
  }, [key])
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
