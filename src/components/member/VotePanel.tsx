import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Side } from '../../lib/types'

interface Props {
  fightId: string; myVote: Side | null; canVote: boolean
  redName: string; blueName: string; onVoted: (s: Side) => void
}

/** Crowd pick buttons. Private; changeable until lock. */
export default function VotePanel({ fightId, myVote, canVote, redName, blueName, onVoted }: Props) {
  const [busy, setBusy] = useState<Side | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const vote = async (side: Side) => {
    if (!canVote || busy || side === myVote) return
    setBusy(side); setErr(null)
    const { error } = await supabase.rpc('cast_vote', { p_fight_id: fightId, p_side: side })
    setBusy(null)
    if (error) setErr(friendlyError(error))
    else onVoted(side)
  }

  const btn = (side: Side, name: string) => {
    const mine = myVote === side
    const base = side === 'red' ? 'border-red' : 'border-blue'
    const fill = side === 'red' ? 'bg-red' : 'bg-blue'
    return (
      <button type="button" onClick={() => vote(side)} disabled={!canVote || busy !== null} aria-pressed={mine}
        className={`min-h-12 rounded-xl border-2 px-2 font-display text-xl tracking-wide leading-tight truncate transition
          ${mine ? `${fill} ${base} text-bone` : `${base} bg-transparent text-bone`}
          ${!canVote && !mine ? 'opacity-40' : ''} disabled:cursor-not-allowed`}>
        {busy === side ? '…' : mine ? `✓ ${name}` : name}
      </button>
    )
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-widest text-muted">Who wins? <span className="normal-case tracking-normal">(private)</span></p>
        {myVote && <p className="text-[11px] text-muted">{canVote ? 'Tap to change' : 'Your pick'}</p>}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {btn('red', redName)}
        {btn('blue', blueName)}
      </div>
      {!canVote && !myVote && <p className="mt-1.5 text-xs text-muted">Voting is closed.</p>}
      {err && <p className="mt-1.5 text-xs text-red" role="alert">{err}</p>}
    </div>
  )
}
