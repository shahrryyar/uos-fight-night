import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { countdown } from '../../lib/math'
import { must, useAsync, usePoll, useProfilesMap, useRealtime } from '../../lib/hooks'
import type { Bet, Fight, Fighter, FightPool, Side, VoteTotals } from '../../lib/types'
import { Card, ErrorBox } from './ui'
import VsCard from './VsCard'
import PoolBar from './PoolBar'
import VotePanel from './VotePanel'
import BetPanel from './BetPanel'
import Reactions, { type ReactionState } from './Reactions'
import ResultBanner from './ResultBanner'
import LockedDetails from './LockedDetails'
import ShareButton from './ShareButton'

interface Props {
  fight: Fight; red?: Fighter; blue?: Fighter; now: Date
  balance: number | null; onPointsChanged: () => void
}

interface PanelData {
  pool: FightPool | null
  myVote: Side | null
  myBet: Bet | null
  reactions: ReactionState
  totals: VoteTotals | null
  bets: Bet[]
}

/** One full fight block: matchup, pool, vote, points pick, reactions, results. */
export default function FightPanel({ fight, red, blue, now, balance, onPointsChanged }: Props) {
  const { profile } = useAuth()
  const uid = profile?.id
  const revealed = fight.status === 'locked' || fight.status === 'settled'

  const data = useAsync<PanelData>(async () => {
    const [pool, vote, mine, rx, totals, bets] = await Promise.all([
      supabase.from('fight_pools').select('*').eq('fight_id', fight.id).maybeSingle(),
      supabase.from('votes').select('side').eq('fight_id', fight.id).eq('user_id', uid ?? '').maybeSingle(),
      supabase.from('bets').select('*').eq('fight_id', fight.id).eq('user_id', uid ?? '').neq('status', 'cancelled')
        .order('created_at', { ascending: false }).limit(1),
      supabase.from('reactions').select('emoji,user_id').eq('fight_id', fight.id),
      revealed ? supabase.rpc('get_fight_vote_totals', { p_fight_id: fight.id }) : Promise.resolve({ data: null, error: null }),
      revealed
        ? supabase.from('bets').select('*').eq('fight_id', fight.id).neq('status', 'cancelled')
        : Promise.resolve({ data: [], error: null }),
    ])
    const counts: Record<string, number> = {}
    const mineRx = new Set<string>()
    for (const r of must(rx) as { emoji: string; user_id: string }[]) {
      counts[r.emoji] = (counts[r.emoji] ?? 0) + 1
      if (r.user_id === uid) mineRx.add(r.emoji)
    }
    const t = must(totals as { data: unknown; error: unknown })
    const totalsRow = (Array.isArray(t) ? t[0] : t) as VoteTotals | null | undefined
    return {
      pool: must(pool) as FightPool | null,
      myVote: ((must(vote) as { side: Side } | null)?.side) ?? null,
      myBet: ((must(mine) as Bet[])[0]) ?? null,
      reactions: { counts, mine: mineRx },
      totals: totalsRow ?? null,
      bets: (must(bets as { data: unknown; error: unknown }) as Bet[]) ?? [],
    }
  }, [fight.id, fight.status, uid])

  // optimistic reaction state, discarded whenever fresh server data arrives
  const [rxLocal, setRxLocal] = useState<{ base: PanelData; s: ReactionState } | null>(null)
  const rx = data.data ? (rxLocal?.base === data.data ? rxLocal.s : data.data.reactions) : null
  const setRx = (s: ReactionState) => { if (data.data) setRxLocal({ base: data.data, s }) }

  const live = fight.status === 'open' || fight.status === 'locked'
  useRealtime(`fight:${fight.id}`, [
    { table: 'fight_pools', filter: `fight_id=eq.${fight.id}` },
    { table: 'reactions', match: r => !('fight_id' in r) || r.fight_id === fight.id },
  ], () => void data.reload(), live)
  usePoll(() => void data.reload(), 10_000, live)

  const names = useProfilesMap((data.data?.bets ?? []).map(b => b.user_id))
  const nameMap = new Map([...(names.data ?? new Map()).entries()].map(([k, v]) => [k, v.username]))

  const redName = red?.nickname ?? 'Red', blueName = blue?.nickname ?? 'Blue'
  const open = fight.status === 'open' && !countdown(fight.lock_at, now).done
  const participant = !!profile?.fighter_id && (profile.fighter_id === fight.red_fighter_id || profile.fighter_id === fight.blue_fighter_id)
  const d = data.data

  const afterBet = () => { void data.reload(); onPointsChanged() }

  return (
    <Card className="overflow-hidden">
      <VsCard fight={fight} red={red} blue={blue} now={now} />
      <div className="space-y-4 p-3 pt-4">
        {data.error && !d && <ErrorBox error={data.error} onRetry={() => void data.reload()} />}
        {(fight.status === 'settled' || fight.status === 'cancelled') && (
          <ResultBanner fight={fight} winnerName={fight.winner_side === 'red' ? redName : blueName} myBet={d?.myBet ?? null} />
        )}
        {fight.status !== 'cancelled' && <PoolBar pool={d?.pool ?? null} />}
        {(fight.status === 'open' || fight.status === 'locked') && d && (
          <VotePanel fightId={fight.id} myVote={d.myVote} canVote={open} redName={redName} blueName={blueName}
            onVoted={() => void data.reload()} />
        )}
        {participant && fight.status !== 'settled' && fight.status !== 'cancelled' ? (
          <p className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-center text-sm font-semibold text-gold">
            You're in this fight — no bets. Go get 'em. 💪
          </p>
        ) : d && fight.status !== 'settled' && fight.status !== 'cancelled' && (
          <BetPanel fightId={fight.id} pool={d.pool} balance={balance} myBet={d.myBet?.status === 'active' ? d.myBet : null}
            canBet={open} defaultSide={d.myVote} redName={redName} blueName={blueName} onChanged={afterBet} />
        )}
        {revealed && d && (
          <LockedDetails totals={d.totals} bets={d.bets} names={nameMap} myId={uid}
            redName={redName} blueName={blueName} settled={fight.status === 'settled'} />
        )}
        {rx && <Reactions fightId={fight.id} state={rx} onChange={setRx} onSynced={() => void data.reload()} />}
        <ShareButton fight={fight} red={red} blue={blue} />
      </div>
    </Card>
  )
}
