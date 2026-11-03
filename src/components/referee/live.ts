/**
 * B4 live scoring, client side. One clock rule shared by the referee screen and the members' strip:
 *   elapsed   = min(round_seconds, accumulated_seconds + (serverNow - round_started_at) while running)
 *   remaining = round_seconds - elapsed
 * The server is the source of truth (get_live_score / admin_live_update return server_now); the
 * client only measures its offset once per read and then ticks locally.
 * The server banks whole seconds in accumulated_seconds and the sub-second rest in accumulated_frac_ms
 * (20261103000012); toRow() folds both into one fractional accumulated_seconds for the local math, so
 * pauses never lose time.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { LiveAction, LiveScore, LiveScoreState } from '../../lib/types'

export const LIVE_WINDOW_MS = 10 * 60 * 1000
export const DEFAULT_ROUND_SECONDS = 120

/** A paused, zeroed board for a fight that has no live_scores row yet (created on the first action). */
export function emptyLive(fightId: string): LiveScore {
  return {
    fight_id: fightId, round: 1, red_score: 0, blue_score: 0, round_started_at: null,
    accumulated_seconds: 0, round_seconds: DEFAULT_ROUND_SECONDS, running: false,
    updated_at: new Date(0).toISOString(), updated_by: null,
  }
}

/** Seconds used in this round at server time `nowMs` (fractional, capped at the round length). */
export function elapsedAt(s: LiveScore, nowMs: number): number {
  const run = s.running && s.round_started_at ? Math.max(0, (nowMs - Date.parse(s.round_started_at)) / 1000) : 0
  return Math.min(s.round_seconds, s.accumulated_seconds + run)
}
export const remainingAt = (s: LiveScore, nowMs: number) => Math.max(0, s.round_seconds - elapsedAt(s, nowMs))
export const timeUpAt = (s: LiveScore, nowMs: number) => remainingAt(s, nowMs) <= 0
/** Contract rule for showing LIVE to members: running, or touched in the last 10 minutes. */
export const isLiveAt = (s: LiveScore, nowMs: number) => s.running || nowMs - Date.parse(s.updated_at) < LIVE_WINDOW_MS

/** "1:24" for a remaining time in seconds. Rounds up, so the clock reads 0:00 only when time is really up. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-6))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
/** "2:00" / "1:30" for a round length. */
export const fmtLength = (sec: number) => fmtClock(sec)

/** server_now - local now, in ms. */
export const offsetFrom = (serverNow: string | null | undefined) => (serverNow ? Date.parse(serverNow) - Date.now() : 0)

/** Server rows carry the banked sub-second remainder separately (not yet in lib/types). */
type WithFrac = { accumulated_frac_ms?: number | null }

/** Strip the computed columns so a view row and a raw realtime row look the same, and fold
 *  accumulated_frac_ms into accumulated_seconds (fractional) so no banked time is dropped. */
export function toRow(v: (LiveScore | LiveScoreState) & WithFrac): LiveScore {
  const { fight_id, round, red_score, blue_score, round_started_at, round_seconds, running, updated_at, updated_by } = v
  const accumulated_seconds = Number(v.accumulated_seconds ?? 0) + Number(v.accumulated_frac_ms ?? 0) / 1000
  return { fight_id, round, red_score, blue_score, round_started_at, accumulated_seconds, round_seconds, running, updated_at, updated_by }
}

/* ---------- scoreboard copy for the Wave B codes (lib/supabase.ts has no entries for them yet) ---------- */

const REF_CODES: Record<string, string> = {
  NOT_REFEREE: 'Only the referee can run the scoreboard.',
  FIGHT_NOT_LOCKED: 'Lock the fight before scoring it.',
  INVALID_ACTION: "That scoreboard action isn't valid.",
  INVALID_VALUE: "That scoreboard action isn't valid.",
  ROUND_OVER: "Time's up for this round. Start the next round.",
  INVALID_SCORE: 'Scores stay between 0 and 999.',
  INVALID_ROUNDS: 'The scoreboard stops at round 20.',
  ADMIN_HAS_BET: 'You have points on this bout, so another admin has to run the scoreboard.',
  PARTICIPANT: "You're linked to a fighter in this bout, so another admin has to run the scoreboard.",
  ALREADY_SETTLED: 'This bout already has a result.',
  FIGHT_CANCELLED: 'This bout was called off.',
}

export function refError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g) ?? []) if (REF_CODES[tok]) return REF_CODES[tok]
  return friendlyError(e)
}

export async function liveUpdate(fightId: string, action: LiveAction, value?: number): Promise<LiveScoreState> {
  const { data, error } = await supabase.rpc('admin_live_update', { p_fight_id: fightId, p_action: action, p_value: value ?? null })
  if (error) throw error
  return data as LiveScoreState
}

async function fetchLive(fightId: string): Promise<LiveScoreState | null> {
  const { data, error } = await supabase.rpc('get_live_score', { p_fight_id: fightId })
  if (error) throw error
  const rows = (data ?? []) as LiveScoreState[]
  return rows[0] ?? null
}

/* ---------- hooks ---------- */

/** Re-renders every `ms` while `on`; returns the local time of the last tick. A paused clock does not
 *  depend on "now", so a stale value while off is harmless (the first tick after a start corrects it). */
export function useTicker(ms: number, on: boolean): number {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setT(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms, on])
  return t
}

export interface LiveFeed {
  /** null = no row yet (nothing has been scored) */
  row: LiveScore | null
  /** server - local clock, ms */
  offset: number
  loaded: boolean
  error: string | null
  reload: () => Promise<void>
  /** push a fresher state (e.g. an admin_live_update result) */
  accept: (s: LiveScoreState | LiveScore, serverNow?: string) => void
}

/**
 * Live row for one fight: get_live_score once (for server_now), then realtime on live_scores, refetched
 * after every (re)subscribe and when the tab comes back. `hold()` returning true parks realtime rows
 * (the referee screen while its own taps are in flight); the newest parked row is applied afterwards.
 */
export function useLiveFeed(fightId: string | undefined, enabled = true, hold?: () => boolean): LiveFeed {
  const [row, setRow] = useState<LiveScore | null>(null)
  const [offset, setOffset] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const holdRef = useRef(hold)
  useEffect(() => { holdRef.current = hold })

  // newest-wins by updated_at, so a late realtime echo never rolls the board back
  const take = useCallback((r: LiveScore) => {
    setRow(cur => (cur && cur.fight_id === r.fight_id && Date.parse(cur.updated_at) > Date.parse(r.updated_at) ? cur : r))
  }, [])

  const accept = useCallback((s: LiveScoreState | LiveScore, serverNow?: string) => {
    const now = serverNow ?? (s as LiveScoreState).server_now
    if (now) setOffset(offsetFrom(now))
    take(toRow(s))
  }, [take])

  const reload = useCallback(async () => {
    if (!fightId) return
    try {
      const s = await fetchLive(fightId)
      if (s) accept(s)
      else setRow(null)
      setError(null)
    } catch (e) {
      setError(refError(e))
    } finally {
      setLoaded(true)
    }
  }, [fightId, accept])

  useEffect(() => {
    if (!fightId || !enabled) return
    void Promise.resolve().then(() => { void reload() })
    const ch = supabase.channel(`live:${fightId}:${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes' as never,
        { event: '*', schema: 'public', table: 'live_scores', filter: `fight_id=eq.${fightId}` } as never,
        ((p: { eventType: string; new: LiveScore }) => {
          if (p.eventType === 'DELETE') { setRow(null); return }
          if (!p.new || !p.new.fight_id) return
          if (holdRef.current?.()) return
          take(toRow(p.new))
        }) as never)
      .subscribe(status => { if (status === 'SUBSCRIBED') void reload() })
    const onVis = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); void supabase.removeChannel(ch) }
  }, [fightId, enabled, reload, take])

  return { row, offset, loaded, error, reload, accept }
}
