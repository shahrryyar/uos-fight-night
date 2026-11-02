/**
 * Reactions (DESIGN 11.3 poster foot, IMPLEMENTATION C4): only emoji with a count above 0, plus a React
 * button that opens the 6-emoji popover (popover API: top layer, Esc closes). Optimistic counts.
 * Emoji are content here, never UI icons.
 */
import { useId, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { EMOJIS, type Emoji } from '../../lib/types'
import { FieldError, Smiley, cx } from '../ui'
import { pickError } from './format'

export interface ReactionState { counts: Record<string, number>; mine: Set<string> }

const NAME: Record<Emoji, string> = { '🔥': 'fire', '💀': 'skull', '😂': 'laughing', '💪': 'flexed arm', '👑': 'crown', '😱': 'shocked' }

interface Props {
  fightId: string; state: ReactionState; onChange: (s: ReactionState) => void; onSynced: () => void
  onInk?: boolean
}

export default function Reactions({ fightId, state, onChange, onSynced, onInk }: Props) {
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const pop = useRef<HTMLDivElement>(null)
  const popId = `rx${useId().replace(/:/g, '')}`

  const toggle = async (e: Emoji) => {
    if (pending) return
    const on = !state.mine.has(e)
    const mine = new Set(state.mine)
    if (on) mine.add(e); else mine.delete(e)
    onChange({ mine, counts: { ...state.counts, [e]: Math.max(0, (state.counts[e] ?? 0) + (on ? 1 : -1)) } })
    setPending(e); setErr(null)
    const { error } = await supabase.rpc('toggle_reaction', { p_fight_id: fightId, p_emoji: e })
    setPending(null)
    if (error) setErr(pickError(error))
    onSynced()
  }

  const shown = EMOJIS.filter(e => (state.counts[e] ?? 0) > 0)

  return (
    <div className={cx('reacts-wrap', onInk && 'reacts--ink')}>
      <div className="reacts" role="group" aria-label="Reactions">
        {shown.map(e => {
          const mine = state.mine.has(e)
          return (
            <button key={e} type="button" className="react" aria-pressed={mine} onClick={() => void toggle(e)}>
              <span className="e" aria-hidden="true">{e}</span>{state.counts[e]}
              <span className="sr-only"> {NAME[e]}{mine ? ', you reacted' : ''}</span>
            </button>
          )
        })}
        <button type="button" className="react react--add" popoverTarget={popId} aria-label="Add a reaction">
          <Smiley aria-hidden="true" />React
        </button>
      </div>
      <div id={popId} ref={pop} popover="auto" className="react-pop" aria-label="Pick a reaction">
        <p className="label">React to this bout</p>
        <div className="react-pop-grid">
          {EMOJIS.map(e => (
            <button key={e} type="button" className="react" aria-pressed={state.mine.has(e)}
              onClick={() => { pop.current?.hidePopover?.(); void toggle(e) }}>
              <span className="e" aria-hidden="true">{e}</span>
              <span className="sr-only">{NAME[e]}</span>
              {(state.counts[e] ?? 0) > 0 && <span aria-hidden="true">{state.counts[e]}</span>}
            </button>
          ))}
        </div>
      </div>
      {err && <FieldError>{err}</FieldError>}
    </div>
  )
}
