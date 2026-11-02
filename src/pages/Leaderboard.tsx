import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { must, useAsync } from '../lib/hooks'
import { formatStreak } from '../lib/math'
import type { BettorRank, FighterRanking } from '../lib/types'
import { Empty, ErrorBox, Loading, NO_CASH, PageTitle, StreakPill, Tabs } from '../components/member/ui'

type Tab = 'fighters' | 'bettors'

export default function Leaderboard() {
  const [tab, setTab] = useState<Tab>('fighters')
  return (
    <div>
      <PageTitle sub={NO_CASH}>Rankings</PageTitle>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'fighters', label: 'Fighters' }, { id: 'bettors', label: 'Bettors' }]} />
      {tab === 'fighters' ? <FighterTable /> : <BettorTable />}
    </div>
  )
}

const medal = (r: number | null) => (r === 1 ? 'text-gold' : r === 2 ? 'text-bone' : r === 3 ? 'text-[#c98a4b]' : 'text-muted')

function FighterTable() {
  const st = useAsync(async () => must(await supabase.from('fighter_rankings').select('*')) as FighterRanking[], [])
  if (st.loading) return <Loading />
  if (st.error) return <ErrorBox error={st.error} onRetry={() => void st.reload()} />
  const rows = st.data ?? []
  const ranked = rows.filter(r => r.ranked).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const unranked = rows.filter(r => !r.ranked).sort((a, b) => b.fights - a.fights || b.elo - a.elo)
  if (!rows.length) return <Empty>No fighters yet.</Empty>

  const row = (r: FighterRanking) => (
    <li key={r.fighter_id}>
      <Link to={`/app/fighters/${r.fighter_id}`} className="flex min-h-14 items-center gap-3 px-3 py-2">
        <span className={`w-9 font-display text-2xl leading-none text-center ${medal(r.rank)}`}>{r.rank ?? '–'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl leading-none tracking-wide">{r.nickname}</p>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            {r.wins}-{r.losses} · {r.ranked ? `${r.fights} fights` : `needs 3 fights (${r.fights}/3)`}
          </p>
        </div>
        <StreakPill streak={r.streak} label={formatStreak(r.streak)} />
        <span className="w-14 text-right font-display text-2xl leading-none tabular-nums">{r.elo}</span>
      </Link>
    </li>
  )

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {ranked.length ? ranked.map(row) : <li className="p-4 text-sm text-muted">Nobody has 3 fights yet.</li>}
      </ul>
      {unranked.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-widest text-muted">Unranked — needs 3 fights</p>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface opacity-80">{unranked.map(row)}</ul>
        </div>
      )}
    </div>
  )
}

function BettorTable() {
  const { profile } = useAuth()
  const st = useAsync(async () =>
    must(await supabase.from('leaderboard_bettors').select('*').order('rank', { ascending: true }).limit(100)) as BettorRank[], [])
  if (st.loading) return <Loading />
  if (st.error) return <ErrorBox error={st.error} onRetry={() => void st.reload()} />
  const rows = st.data ?? []
  if (!rows.length) return <Empty>No members yet.</Empty>
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {rows.map(r => {
        const me = r.user_id === profile?.id
        return (
          <li key={r.user_id} className={`flex min-h-14 items-center gap-3 px-3 py-2 ${me ? 'bg-gold/10' : ''}`}>
            <span className={`w-9 font-display text-2xl leading-none text-center ${medal(r.rank)}`}>{r.rank}</span>
            <p className="min-w-0 flex-1 truncate font-semibold">
              @{r.username}{me && <span className="ml-1 text-xs font-bold text-gold">YOU</span>}
            </p>
            <span className="font-display text-2xl leading-none tabular-nums text-gold">{Number(r.balance).toLocaleString()}</span>
            <span className="text-xs text-muted">pts</span>
          </li>
        )
      })}
    </ul>
  )
}
