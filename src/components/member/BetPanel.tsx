import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { estimatePayout, maxBet, MIN_BET } from '../../lib/math'
import { fmtPts } from '../../lib/hooks'
import { NO_CASH } from './ui'
import type { Bet, FightPool, Side } from '../../lib/types'

interface Props {
  fightId: string; pool: FightPool | null; balance: number | null; myBet: Bet | null
  canBet: boolean; defaultSide: Side | null; redName: string; blueName: string
  onChanged: () => void
}

const CHIPS = [10, 50, 100] as const

/** Place / cancel a fun-points pick on the pool. */
export default function BetPanel({ fightId, pool, balance, myBet, canBet, defaultSide, redName, blueName, onChanged }: Props) {
  const max = maxBet(balance ?? 0)
  const [chosen, setSide] = useState<Side | null>(null)
  const side: Side = chosen ?? defaultSide ?? 'red'
  const [amount, setAmount] = useState(Math.min(50, Math.max(MIN_BET, max)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)


  const red = pool?.red_total ?? 0, blue = pool?.blue_total ?? 0
  const name = (s: Side) => (s === 'red' ? redName : blueName)

  if (myBet) {
    const sideTotal = myBet.side === 'red' ? red : blue
    const est = sideTotal > 0 ? Math.floor((myBet.amount * (red + blue)) / sideTotal) : myBet.amount
    const cancel = async () => {
      setBusy(true); setErr(null)
      const { error } = await supabase.rpc('cancel_bet', { p_bet_id: myBet.id })
      setBusy(false)
      if (error) setErr(friendlyError(error)); else onChanged()
    }
    return (
      <div className={`rounded-xl border p-3 ${myBet.side === 'red' ? 'border-red/50 bg-red/10' : 'border-blue/50 bg-blue/10'}`}>
        <p className="text-[11px] uppercase tracking-widest text-muted">Your points pick</p>
        <p className="mt-0.5 font-display text-2xl tracking-wide leading-none">
          {fmtPts(myBet.amount)} on <span className={myBet.side === 'red' ? 'text-red' : 'text-blue'}>{name(myBet.side)}</span>
        </p>
        <p className="mt-1 text-xs text-muted">If they win right now: ~<span className="text-gold font-semibold">{fmtPts(est)}</span> back</p>
        {canBet && (
          <button onClick={cancel} disabled={busy}
            className="mt-3 min-h-11 w-full rounded-lg border border-line font-semibold text-sm disabled:opacity-50">
            {busy ? 'Cancelling…' : 'Cancel pick (full refund)'}
          </button>
        )}
        {err && <p className="mt-1.5 text-xs text-red" role="alert">{err}</p>}
      </div>
    )
  }

  if (!canBet) return null

  if (balance == null) return <p className="text-xs text-muted">Loading your points…</p>
  if (max < MIN_BET) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm text-muted">
        You need at least {MIN_BET * 2} points to play this pool. Weekly bonus drops every Monday.
      </div>
    )
  }

  const stake = Math.min(Math.max(amount, MIN_BET), max)
  const est = estimatePayout(stake, side === 'red' ? red : blue, side === 'red' ? blue : red)

  const place = async () => {
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('place_bet', { p_fight_id: fightId, p_side: side, p_amount: stake })
    setBusy(false)
    if (error) setErr(friendlyError(error)); else onChanged()
  }

  return (
    <div className="rounded-xl border border-gold/30 bg-surface-2 p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-widest text-gold">Back a fighter</p>
        <p className="text-[11px] text-muted">You have <span className="text-bone font-semibold">{fmtPts(balance)}</span></p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Side">
        {(['red', 'blue'] as const).map(s => (
          <button key={s} role="radio" aria-checked={side === s} onClick={() => setSide(s)}
            className={`min-h-11 rounded-lg border-2 px-2 text-sm font-bold uppercase tracking-wide truncate
              ${s === 'red' ? 'border-red' : 'border-blue'} ${side === s ? (s === 'red' ? 'bg-red' : 'bg-blue') : 'opacity-60'}`}>
            {name(s)}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <input type="range" min={MIN_BET} max={max} step={1} value={stake} aria-label="Points"
          onChange={e => setAmount(Number(e.target.value))} className="flex-1 h-11 accent-[var(--color-gold)]" />
        <input type="number" inputMode="numeric" min={MIN_BET} max={max} value={amount} aria-label="Points amount"
          onChange={e => setAmount(Number(e.target.value) || 0)}
          onBlur={() => setAmount(stake)}
          className="w-20 min-h-11 rounded-lg border border-line bg-ink px-2 text-right font-semibold tabular-nums" />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {[...CHIPS.filter(c => c <= max), 'MAX' as const].map(c => (
          <button key={c} onClick={() => setAmount(c === 'MAX' ? max : c)}
            className={`min-h-11 rounded-lg border text-sm font-bold ${(c === 'MAX' ? max : c) === stake ? 'border-gold text-gold' : 'border-line text-bone'}`}>
            {c}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">
        Win → ~<span className="font-display text-2xl tracking-wide text-gold align-middle">{fmtPts(est)}</span>
        <span className="text-xs"> (estimate, pool still moving)</span>
      </p>
      <button onClick={place} disabled={busy}
        className={`mt-2 min-h-12 w-full rounded-xl font-display text-2xl tracking-wider disabled:opacity-50 ${side === 'red' ? 'bg-red' : 'bg-blue'}`}>
        {busy ? 'Locking in…' : `Put ${stake} on ${name(side)}`}
      </button>
      <p className="mt-1.5 text-center text-[11px] text-muted">{NO_CASH} · min {MIN_BET}, max {max}</p>
      {err && <p className="mt-1.5 text-xs text-red" role="alert">{err}</p>}
    </div>
  )
}
