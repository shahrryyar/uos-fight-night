/**
 * One finished card's wrap-up data: get_card_recap (names, scores, kg, champion, is_fotn) and
 * get_fotn (window, my vote, counts once closed). Both RPCs finalize FOTN lazily when the window
 * has just closed, so a reload at the countdown's end shows the result.
 * fotn_results (members SELECT) is read once per page for History's winner markers.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useAsync } from '../../lib/hooks'
import type { CardRecap, FotnResult, FotnState } from '../../lib/types'

export interface CardWrap { recap: CardRecap; fotn: FotnState }

export function useCardWrap(cardDate: string, enabled = true) {
  return useAsync(async (): Promise<CardWrap | null> => {
    if (!enabled) return null
    const [recap, fotn] = await Promise.all([
      supabase.rpc('get_card_recap', { p_card_date: cardDate }),
      supabase.rpc('get_fotn', { p_card_date: cardDate }),
    ])
    return { recap: must(recap) as CardRecap, fotn: must(fotn) as FotnState }
  }, [cardDate, enabled])
}

export async function fetchRecap(cardDate: string): Promise<CardRecap> {
  return must(await supabase.rpc('get_card_recap', { p_card_date: cardDate })) as CardRecap
}

// ---- fotn_results, one request per page view (History), shared by every card on it ----
let results: Promise<Map<string, FotnResult>> | null = null
let resultsAt = 0

function loadResults(force = false) {
  if (!results || force || Date.now() - resultsAt > 60_000) {
    resultsAt = Date.now()
    results = (async () => {
      const rows = must(await supabase.from('fotn_results').select('*')) as FotnResult[]
      return new Map(rows.map(r => [r.card_date, r]))
    })()
    results.catch(() => { results = null })
  }
  return results
}

/** Closed Fight of the Night results by card_date (null until loaded; empty map on error). */
export function useFotnResults(): Map<string, FotnResult> | null {
  const [map, setMap] = useState<Map<string, FotnResult> | null>(null)
  useEffect(() => {
    let live = true
    loadResults().then(m => { if (live) setMap(m) }, () => { if (live) setMap(new Map()) })
    return () => { live = false }
  }, [])
  return map
}

/** Drop the cached results (after a vote window closes in view). */
export function invalidateFotnResults() { results = null }
