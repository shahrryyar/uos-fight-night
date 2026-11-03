import { useCallback, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useAsync, useRealtime } from '../../lib/hooks'
import { calloutError, type BoardRow } from './format'

/**
 * The callout board (view `callout_board`, newest first) with live updates from the `callouts` table.
 * DELETE events carry only the id and are not RLS-filtered (API "Realtime additions"), so every event
 * just refetches the board.
 */
export function useCalloutBoard(limit = 80) {
  const st = useAsync<BoardRow[]>(async () =>
    must(await supabase.from('callout_board').select('*').order('created_at', { ascending: false }).limit(limit)) as BoardRow[],
  [limit])
  useRealtime('callouts', [{ table: 'callouts' }], () => void st.reload())
  return st
}

/** busy + friendly error for one callout action (member or admin). */
export function useCalloutAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    setBusy(true); setError(null)
    try { return { ok: true, value: await fn() } }
    catch (e) { setError(calloutError(e)); return { ok: false } }
    finally { setBusy(false) }
  }, [])
  return { busy, error, setError, run }
}

/** Throws the PostgREST error so useCalloutAction can map it. */
export function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}
