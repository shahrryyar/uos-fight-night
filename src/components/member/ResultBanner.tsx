import { METHOD_LABEL, fmtPts } from '../../lib/hooks'
import type { Bet, Fight } from '../../lib/types'

/** Winner banner for settled fights, cancellation notice for cancelled. */
export default function ResultBanner({ fight, winnerName, myBet }: { fight: Fight; winnerName: string; myBet: Bet | null }) {
  if (fight.status === 'cancelled') {
    return (
      <div className="rounded-xl border border-line bg-surface-2 p-3 text-center">
        <p className="font-display text-3xl tracking-wider text-muted">Fight cancelled</p>
        <p className="text-xs text-muted">All points picks were refunded.{fight.result_note ? ` ${fight.result_note}` : ''}</p>
      </div>
    )
  }
  if (fight.status !== 'settled' || !fight.winner_side) return null
  const red = fight.winner_side === 'red'
  return (
    <div className={`rounded-xl border-2 p-3 text-center ${red ? 'border-red bg-red/15' : 'border-blue bg-blue/15'}`}>
      <p className="text-[11px] uppercase tracking-[0.3em] text-gold">Winner · {red ? 'Red' : 'Blue'} corner</p>
      <p className="font-display text-5xl tracking-wide leading-none mt-1">{winnerName}</p>
      <p className="mt-1 text-sm">
        by <span className="font-bold uppercase tracking-wide">{fight.method ? METHOD_LABEL[fight.method] : '—'}</span>
        {fight.elo_delta != null && <span className="text-muted"> · ±{Math.abs(fight.elo_delta)} Elo</span>}
      </p>
      {fight.result_note && <p className="mt-1 text-xs text-muted italic">“{fight.result_note}”</p>}
      {myBet && (
        <p className="mt-2 text-sm font-semibold">
          {myBet.status === 'won' && <span className="text-gold">You won {fmtPts(myBet.payout)} 🎉</span>}
          {myBet.status === 'lost' && <span className="text-muted">Your {fmtPts(myBet.amount)} pick didn't land.</span>}
          {myBet.status === 'refunded' && <span className="text-muted">Your {fmtPts(myBet.amount)} was refunded.</span>}
        </p>
      )}
    </div>
  )
}
