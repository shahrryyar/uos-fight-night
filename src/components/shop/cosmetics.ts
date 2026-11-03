/**
 * Equipped cosmetics (C6) for every member, from the `member_cosmetics` view. Loaded once per session
 * and shared by every <MemberName/> (one request, not one per row). The shop calls
 * `refreshCosmetics()` after equip / unequip so names update everywhere at once.
 *
 * Token keys are whitelisted here: an unknown key from the DB renders as a plain name (never as CSS).
 */
import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../../lib/supabase'
import type { MemberCosmetics } from '../../lib/types'

export const NAME_COLORS = ['gold', 'crimson', 'ice_blue', 'neon_green'] as const
export const FRAMES = ['flame', 'chain', 'crown'] as const
export type NameColor = typeof NAME_COLORS[number]
export type Frame = typeof FRAMES[number]

export const isNameColor = (v: unknown): v is NameColor => NAME_COLORS.includes(v as NameColor)
export const isFrame = (v: unknown): v is Frame => FRAMES.includes(v as Frame)

/**
 * Display inks per surface, all WCAG AA (>= 4.5:1) for normal text. Measured with WCAG 2 relative luminance:
 *   ink variant on #0b0b0d / #161517 (pressed row) / #1a1917 (toner ticket)
 *   paper variant on #f4f1ea / #e2dfd8 (darkest grain) / #cfccc5 (tinted "you" row on grain)
 *   gold       #d9925a  7.69 / 7.12 / 6.87      #7a3f12  7.31 / 6.20 / 5.14   (labelled "Copper")
 *   crimson    #f5606a  6.33 / 5.86 / 5.66      #9c1422  7.34 / 6.22 / 5.16
 *   ice blue   #94d4f2 12.13 / 11.23 / 10.84    #0a5670  7.22 / 6.12 / 5.08
 *   neon green #62df7f 11.59 / 10.73 / 10.36    #155c2b  7.17 / 6.07 / 5.04
 * The `gold` key is shown as "Copper" (item label set in migration 20261103000041): a copper ink about
 * 16 degrees of hue and clearly darker than the ChampionBelt plate gold (#e3b341, belt only), so a
 * coloured name never reads as a champion. Not the retired medal bronze #c98a4b. Never a glow or
 * gradient (DESIGN principle 5). The CSS lives in memberName.css.
 */
export const COLOR_INK: Record<NameColor, { ink: string; paper: string }> = {
  gold: { ink: '#d9925a', paper: '#7a3f12' },
  crimson: { ink: '#f5606a', paper: '#9c1422' },
  ice_blue: { ink: '#94d4f2', paper: '#0a5670' },
  neon_green: { ink: '#62df7f', paper: '#155c2b' },
}

type Store = Map<string, MemberCosmetics>
let data: Store | null = null
let loadedAt = 0
let inflight: Promise<void> | null = null
const subs = new Set<() => void>()
const STALE_MS = 5 * 60_000

const notify = () => subs.forEach(f => f())

/** Fetches the view (deduped). `force` skips the 5 minute freshness window. */
export function loadCosmetics(force = false): Promise<void> {
  if (inflight) return inflight
  if (!force && data && Date.now() - loadedAt < STALE_MS) return Promise.resolve()
  inflight = (async () => {
    const r = await supabase.from('member_cosmetics').select('*')
    // a failed load (offline, lockdown) keeps whatever we had; names still render plain
    if (!r.error) {
      data = new Map((r.data as MemberCosmetics[]).map(c => [c.user_id, c]))
      loadedAt = Date.now()
      notify()
    }
  })().finally(() => { inflight = null })
  return inflight
}

/** After a purchase/equip: refetch now and re-render every name. */
export const refreshCosmetics = () => loadCosmetics(true)

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const snapshot = () => data

/** The shared map (null until the first load). Triggers the load on first use. */
export function useCosmetics(): Store | null {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => { void loadCosmetics() }, [])
  return s
}

/* ---------- display names for callers that only have a user id ---------- */

const names = new Map<string, string>()
const queued = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
const nameSubs = new Set<() => void>()
let nameVersion = 0

function flushNames() {
  flushTimer = null
  const ids = [...queued]
  queued.clear()
  if (!ids.length) return
  void supabase.from('profiles').select('id,username,display_name').in('id', ids).then(r => {
    if (r.error) return
    for (const p of r.data as { id: string; username: string; display_name: string | null }[]) {
      names.set(p.id, p.display_name?.trim() || p.username)
    }
    nameVersion++
    nameSubs.forEach(f => f())
  })
}

/** Batched lookup (one request per tick for every <MemberName/> without a `name`). */
export function useNameOf(userId: string | null | undefined, skip: boolean): string | undefined {
  useSyncExternalStore(
    f => { nameSubs.add(f); return () => { nameSubs.delete(f) } },
    () => nameVersion, () => nameVersion,
  )
  useEffect(() => {
    if (skip || !userId || names.has(userId)) return
    queued.add(userId)
    if (!flushTimer) flushTimer = setTimeout(flushNames, 0)
  }, [userId, skip])
  return userId ? names.get(userId) : undefined
}
