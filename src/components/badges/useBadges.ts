import { supabase } from '../../lib/supabase'
import { must, useAsync } from '../../lib/hooks'
import type { BadgeKind, BadgeSummary } from '../../lib/types'

/** list_badges(p_kind, p_id): one row per code earned, catalog order. */
export function useBadges(kind: BadgeKind, id: string | null | undefined) {
  return useAsync(async () => {
    if (!id) return [] as BadgeSummary[]
    return must(await supabase.rpc('list_badges', { p_kind: kind, p_id: id })) as BadgeSummary[]
  }, [kind, id])
}
