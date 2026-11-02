import { supabase } from '../lib/supabase'
import {
  fmtCardDate, fmtPts, groupByCard, must, useAsync, useBalance, useFightersMap, useNow, usePoll, useRealtime,
  type FightRow,
} from '../lib/hooks'
import FightPanel from '../components/member/FightPanel'
import { ErrorBox, Loading, NO_CASH } from '../components/member/ui'

const RECENT_WINDOW_MS = 12 * 3600_000

export default function FightCard() {
  const now = useNow(1000)
  const { balance, reload: reloadBalance } = useBalance()

  const fights = useAsync(async () => {
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString()
    const rows = must(await supabase.from('fights').select('*')
      .or(`status.in.(scheduled,open,locked),and(status.eq.settled,settled_at.gte.${since}),and(status.eq.cancelled,scheduled_at.gte.${since})`)
      .order('scheduled_at', { ascending: true })) as FightRow[]
    return groupByCard(rows)
  }, [])

  useRealtime('fights', [{ table: 'fights' }], () => { void fights.reload(); void reloadBalance() })
  usePoll(() => void fights.reload(), 10_000)

  const ids = (fights.data ?? []).flatMap(c => c.fights.flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))
  const fighters = useFightersMap(ids)

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-wider leading-none">Fight Card</h1>
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
          <div className="space-y-10">
            {fights.data.map(card => {
              const hasMain = card.fights.some(f => f.is_main_event)
              const undercard = card.fights.filter(f => !f.is_main_event)
              return (
                <section key={card.cardDate} aria-label={`Card ${fmtCardDate(card.cardDate)}`}>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gold/40" aria-hidden />
                    <h2 className="font-display text-2xl leading-none tracking-[0.2em] text-gold">{fmtCardDate(card.cardDate)}</h2>
                    <div className="h-px flex-1 bg-gold/40" aria-hidden />
                  </div>
                  <p className="-mt-2 mb-3 text-center text-[11px] uppercase tracking-widest text-muted">
                    {card.fights.length} bout{card.fights.length === 1 ? '' : 's'}
                  </p>
                  {hasMain && undercard.length > 0 && (
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.3em] text-muted">Undercard</p>
                  )}
                  <div className="space-y-5">
                    {card.fights.map(f => (
                      <div key={f.id} className={f.is_main_event ? 'pt-3' : ''}>
                        <FightPanel fight={f} now={now} size={hasMain && !f.is_main_event ? 'undercard' : 'main'}
                          red={fighters.data?.get(f.red_fighter_id)} blue={fighters.data?.get(f.blue_fighter_id)}
                          balance={balance} onPointsChanged={() => void reloadBalance()}
                          onFightChanged={() => void fights.reload()} />
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
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
