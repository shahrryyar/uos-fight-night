/**
 * History, per card_date (CONTRACT C4): the Fight of the Night winner line once voting closed
 * (fotn_results, one read per page), or the live vote while the 24h window is still open.
 * The window check is a cheap client guess (last settle < 24h ago, no result row); get_fotn decides.
 */
import { useEffect } from 'react'
import { useNow, type FightRow } from '../../lib/hooks'
import { FotnMark, FotnPanel, invalidateFotnResults, useCardWrap, useFotnResults } from '../fotn'
import '../fotn/fotn.css'

const DAY = 24 * 3600_000

export default function HistoryCardFotn({ cardDate, fights, nameOf }:
  { cardDate: string; fights: FightRow[]; nameOf: (fighterId: string) => string | undefined }) {
  const now = useNow(60_000)
  const results = useFotnResults()
  const res = results?.get(cardDate)
  const lastSettle = Math.max(0, ...fights.filter(f => f.status === 'settled' && f.settled_at).map(f => new Date(f.settled_at as string).getTime()))
  const maybeOpen = !!results && !res && lastSettle > 0 && now.getTime() - lastSettle < DAY + 15 * 60_000
  const live = useCardWrap(cardDate, maybeOpen)
  const reload = live.reload
  useEffect(() => { if (live.data?.fotn.status === 'closed') invalidateFotnResults() }, [live.data?.fotn.status])

  if (res) {
    const w = res.winner_fight_id ? fights.find(f => f.id === res.winner_fight_id) : undefined
    if (!w) return null
    const votes = res.counts?.find(c => c.fight_id === w.id)?.votes ?? null
    return (
      <FotnMark red={{ id: w.red_fighter_id, name: nameOf(w.red_fighter_id) ?? 'Red corner' }}
        blue={{ id: w.blue_fighter_id, name: nameOf(w.blue_fighter_id) ?? 'Blue corner' }}
        votes={votes} total={res.total_votes} />
    )
  }
  const d = live.data
  if (!maybeOpen || !d || d.fotn.status === 'not_ready') return null
  if (d.fotn.status === 'closed') {
    const w = d.recap.fights.find(f => f.fight_id === d.fotn.winner_fight_id)
    if (!w) return null
    return (
      <FotnMark red={{ id: w.red.fighter_id, name: w.red.nickname ?? 'Fighter' }} blue={{ id: w.blue.fighter_id, name: w.blue.nickname ?? 'Fighter' }}
        votes={d.fotn.counts?.find(c => c.fight_id === w.fight_id)?.votes ?? null} total={d.fotn.total_votes} />
    )
  }
  return <div className="history-fotn" style={{ marginBottom: 16 }}><FotnPanel recap={d.recap} fotn={d.fotn} onVoted={() => void reload()} onExpired={() => void reload()} /></div>
}
