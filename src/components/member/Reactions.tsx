import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { EMOJIS, type Emoji } from '../../lib/types'

export interface ReactionState { counts: Record<string, number>; mine: Set<string> }

interface Props { fightId: string; state: ReactionState; onChange: (s: ReactionState) => void; onSynced: () => void }

/** Toggleable emoji reactions with optimistic counts. */
export default function Reactions({ fightId, state, onChange, onSynced }: Props) {
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const toggle = async (e: Emoji) => {
    if (pending) return
    const on = !state.mine.has(e)
    const mine = new Set(state.mine)
    if (on) mine.add(e); else mine.delete(e)
    onChange({ mine, counts: { ...state.counts, [e]: Math.max(0, (state.counts[e] ?? 0) + (on ? 1 : -1)) } })
    setPending(e); setErr(null)
    const { error } = await supabase.rpc('toggle_reaction', { p_fight_id: fightId, p_emoji: e })
    setPending(null)
    if (error) setErr(friendlyError(error))
    onSynced()
  }

  return (
    <div>
      <div className="grid grid-cols-6 gap-1.5">
        {EMOJIS.map(e => {
          const mine = state.mine.has(e)
          return (
            <button key={e} onClick={() => toggle(e)} aria-pressed={mine} aria-label={`React ${e}`}
              className={`min-h-11 rounded-lg border flex flex-col items-center justify-center leading-none transition active:scale-95
                ${mine ? 'border-gold bg-gold/15' : 'border-line bg-surface-2'}`}>
              <span className="text-lg">{e}</span>
              <span className={`mt-0.5 text-[10px] font-bold tabular-nums ${mine ? 'text-gold' : 'text-muted'}`}>{state.counts[e] ?? 0}</span>
            </button>
          )
        })}
      </div>
      {err && <p className="mt-1 text-xs text-red" role="alert">{err}</p>}
    </div>
  )
}
