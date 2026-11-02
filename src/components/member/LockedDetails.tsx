import { fmtPts } from '../../lib/hooks'
import type { Bet, Side, VoteTotals } from '../../lib/types'

interface Props {
  totals: VoteTotals | null
  bets: Bet[]
  names: Map<string, string>
  myId: string | undefined
  redName: string; blueName: string
  settled: boolean
}

/** After lock: crowd vote split + every individual pick (who / side / amount / payout). */
export default function LockedDetails({ totals, bets, names, myId, redName, blueName, settled }: Props) {
  const rv = totals?.red_votes ?? 0, bv = totals?.blue_votes ?? 0
  const rp = totals ? Math.round(Number(totals.red_pct)) : 0
  const bp = totals ? Math.round(Number(totals.blue_pct)) : 0
  const sorted = [...bets].sort((a, b) => b.amount - a.amount)
  const label = (s: Side) => (s === 'red' ? redName : blueName)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-muted">Crowd picks</p>
        {rv + bv === 0 ? (
          <p className="text-xs text-muted mt-1">No votes cast.</p>
        ) : (
          <>
            <div className="mt-1 flex h-7 overflow-hidden rounded-lg font-display text-lg leading-7">
              <div className="bg-red px-2 text-left whitespace-nowrap" style={{ width: `${Math.max(rp, 12)}%` }}>{rp}%</div>
              <div className="bg-blue px-2 text-right flex-1 whitespace-nowrap">{bp}%</div>
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>{rv} for {redName}</span><span>{bv} for {blueName}</span>
            </div>
          </>
        )}
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-widest text-muted">Points picks ({bets.length})</p>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted mt-1">Nobody put points on this one.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
            {sorted.map(b => (
              <li key={b.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${b.user_id === myId ? 'bg-gold/10' : ''}`}>
                <span className={`size-2.5 shrink-0 rounded-full ${b.side === 'red' ? 'bg-red' : 'bg-blue'}`} aria-hidden />
                <span className="flex-1 truncate">
                  {names.get(b.user_id) ?? 'Member'}{b.user_id === myId && <span className="text-gold"> (you)</span>}
                  <span className="text-muted"> · {label(b.side)}</span>
                </span>
                <span className="tabular-nums font-semibold">{b.amount}</span>
                {settled && (
                  <span className={`w-20 text-right tabular-nums text-xs font-bold ${b.status === 'won' ? 'text-gold' : 'text-muted'}`}>
                    {b.status === 'won' ? `+${fmtPts(b.payout)}` : b.status === 'refunded' ? 'refund' : 'lost'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
