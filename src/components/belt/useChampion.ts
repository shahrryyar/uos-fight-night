/**
 * Current title holder (view `current_champion`, 0 or 1 row), shared by every screen that marks the
 * champion (VsCard, Ranks, Fighters, admin). One request per 30s across all mounted components;
 * `invalidateChampion()` refetches right away (after an admin award / vacate or a settle).
 * Members and admins only: the public landing reads champion data from public_next_fight() instead.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { CurrentChampion } from '../../lib/types'

const TTL = 30_000
let cache: { at: number; value: CurrentChampion | null } | null = null
let inflight: Promise<void> | null = null
let failed = false
const subs = new Set<() => void>()
const notify = () => subs.forEach(fn => fn())

function load(force = false): Promise<void> {
  if (!force && cache && Date.now() - cache.at < TTL) return Promise.resolve()
  if (inflight) return inflight
  inflight = (async () => {
    const { data, error } = await supabase.from('current_champion').select('*').maybeSingle()
    if (error) failed = true
    else { failed = false; cache = { at: Date.now(), value: (data as CurrentChampion | null) ?? null } }
  })().finally(() => { inflight = null; notify() })
  return inflight
}

/** Refetch the champion everywhere (call after admin_award_belt or a settle that moved the belt). */
export function invalidateChampion(): Promise<void> {
  cache = null
  return load(true)
}

export interface ChampionState {
  champion: CurrentChampion | null
  /** false until the first answer (so callers can avoid flashing "vacant") */
  loaded: boolean
  error: boolean
}

export function useChampion(): ChampionState {
  const [, bump] = useState(0)
  useEffect(() => {
    const fn = () => bump(n => n + 1)
    subs.add(fn)
    void load()
    return () => { subs.delete(fn) }
  }, [])
  return { champion: cache?.value ?? null, loaded: cache !== null, error: failed && cache === null }
}

/** Fighter id of the current champion, or null (vacant / not loaded yet). */
export function useChampionId(): string | null {
  return useChampion().champion?.fighter_id ?? null
}
