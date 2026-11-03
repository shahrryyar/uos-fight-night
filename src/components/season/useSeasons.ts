import { supabase } from '../../lib/supabase'
import { must, useAsync } from '../../lib/hooks'
import type { Season } from '../../lib/types'

/** Every season, newest first (the open one, ended_at null, is always the newest). */
export function useSeasons() {
  return useAsync(async () => {
    const rows = must(await supabase.from('seasons').select('*').order('started_at', { ascending: false }).order('id', { ascending: false })) as Season[]
    return { current: rows.find(s => s.ended_at == null) ?? null, past: rows.filter(s => s.ended_at != null) }
  }, [])
}

/** Just the running season's name (for the Ranks toggle). Null while loading or on error. */
export function useCurrentSeasonName(): string | null {
  const st = useAsync(async () => {
    const r = must(await supabase.from('seasons').select('name').is('ended_at', null).maybeSingle()) as { name: string } | null
    return r?.name ?? null
  }, [])
  return st.data ?? null
}
