import { supabase } from '../lib/supabase'
import { must, useAsync, useBalance, useFightersMap, useNow, usePoll, useRealtime, fmtPts } from '../lib/hooks'
import type { Fight } from '../lib/types'
import FightPanel from '../components/member/FightPanel'
import { ErrorBox, Loading, NO_CASH } from '../components/member/ui'

const SETTLED_WINDOW_MS = 12 * 3600_000

export default function FightCard() {
  const now = useNow(1000)
  const { balance, reload: reloadBalance } = useBalance()

  const fights = useAsync(async () => {
    const since = new Date(Date.now() - SETTLED_WINDOW_MS).toISOString()
    const rows = must(await supabase.from('fights').select('*')
      .or(`status.in.(open,locked),and(status.eq.settled,settled_at.gte.${since})`)
      .order('scheduled_at', { ascending: true })) as Fight[]
    // live fights first, then freshly settled
    return rows.sort((a, b) => Number(a.status === 'settled') - Number(b.status === 'settled'))
  }, [])

  useRealtime('fights', [{ table: 'fights' }], () => { void fights.reload(); void reloadBalance() })
  usePoll(() => void fights.reload(), 10_000)

  const ids = (fights.data ?? []).flatMap(f => [f.red_fighter_id, f.blue_fighter_id])
  const fighters = useFightersMap(ids)

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-wider leading-none">Tonight</h1>
          <p className="text-xs text-muted mt-1">{NO_CASH}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-widest text-muted">Your points</p>
          <p className="font-display text-3xl tracking-wide leading-none text-gold tabular-nums">{balance == null ? '…' : fmtPts(balance)}</p>
        </div>
      </div>

      {fights.loading && !fights.data ? <Loading label="Loading fight card…" />
        : fights.error && !fights.data ? <ErrorBox error={fights.error} onRetry={() => void fights.reload()} />
        : !fights.data?.length ? <NoFight />
        : (
          <div className="space-y-6">
            {fights.data.map(f => (
              <FightPanel key={f.id} fight={f} now={now}
                red={fighters.data?.get(f.red_fighter_id)} blue={fighters.data?.get(f.blue_fighter_id)}
                balance={balance} onPointsChanged={() => void reloadBalance()} />
            ))}
          </div>
        )}
    </div>
  )
}

function NoFight() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-16 text-center">
      <div className="absolute inset-0 bg-linear-to-br from-red-dark/40 via-transparent to-blue-dark/40" aria-hidden />
      <div className="relative">
        <p className="text-[11px] uppercase tracking-[0.4em] text-gold">UoS Fight Night</p>
        <p className="mt-4 font-display text-6xl leading-[0.9] tracking-wide">No fight<br />booked<br /><span className="text-red">tonight</span></p>
        <div className="mx-auto mt-6 h-px w-24 bg-gold/60" />
        <p className="mt-4 text-sm text-muted">Rest up. Check the rankings and come back when the next card drops.</p>
      </div>
    </div>
  )
}
