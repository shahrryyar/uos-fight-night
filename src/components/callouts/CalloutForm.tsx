/**
 * Create a callout (C5): a flat paper form inline on the Callouts page (no modal, DESIGN 10 Admin note).
 *   plain    pick the fighter, optional message (140 chars, live counter)
 *   rematch  the target is fixed to the winner of the settled bout you lost; message optional
 * Submits create_callout(p_target_fighter_id, p_message, p_rematch_of).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDay, lostBy, type FightRow } from '../../lib/hooks'
import type { Fighter } from '../../lib/types'
import { Button, Field, FieldError, Paper, Select, useToast } from '../ui'
import { CALLOUT_MESSAGE_MAX, CALLOUT_OPEN_LIMIT, oneLine } from './format'
import { ok, useCalloutAction } from './useCallouts'

export type RosterFighter = Pick<Fighter, 'id' | 'nickname' | 'hidden'>

interface Props {
  myFighterId: string
  roster: RosterFighter[]
  /** fighters I already have an open callout with (either direction): shown, but explained */
  busyWith: Map<string, 'in' | 'out'>
  myOpen: number
  initialTarget?: string | null
  rematchOf?: string | null
  /** another red primary is on screen (an incoming callout to answer): submit as the ink secondary */
  quietSubmit?: boolean
  onSent: () => void
  onClose: () => void
}

interface Rematch { fight: FightRow; winnerId: string; eligible: boolean }

export default function CalloutForm({ myFighterId, roster, busyWith, myOpen, initialTarget, rematchOf, quietSubmit, onSent, onClose }: Props) {
  const toast = useToast()
  const hid = useId().replace(/:/g, '')
  const [target, setTarget] = useState(initialTarget && initialTarget !== myFighterId ? initialTarget : '')
  const [msg, setMsg] = useState('')
  const [targetErr, setTargetErr] = useState<string | null>(null)
  const [rematch, setRematch] = useState<Rematch | null>(null)
  const [rematchErr, setRematchErr] = useState<string | null>(null)
  const act = useCalloutAction()
  const headRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { headRef.current?.focus() }, [rematchOf])

  useEffect(() => {
    if (!rematchOf) { setRematch(null); setRematchErr(null); return }
    let live = true
    void (async () => {
      const { data, error } = await supabase.from('fights').select('*').eq('id', rematchOf).maybeSingle()
      if (!live) return
      if (error || !data) { setRematchErr("That bout couldn't be found. Pick a fighter instead."); return }
      const f = data as FightRow
      const loser = f.winner_side === 'red' ? f.blue_fighter_id : f.winner_side === 'blue' ? f.red_fighter_id : null
      const winnerId = f.winner_side === 'red' ? f.red_fighter_id : f.blue_fighter_id
      setRematch({ fight: f, winnerId, eligible: f.status === 'settled' && loser === myFighterId })
    })()
    return () => { live = false }
  }, [rematchOf, myFighterId])

  const isRematch = !!rematchOf
  const name = (id: string) => roster.find(f => f.id === id)?.nickname ?? 'that fighter'
  const options = roster.filter(f => f.id !== myFighterId && !f.hidden)
  const trimmed = oneLine(msg).trim()
  const left = CALLOUT_MESSAGE_MAX - trimmed.length
  const over = left < 0
  const atLimit = myOpen >= CALLOUT_OPEN_LIMIT
  const targetId = isRematch ? rematch?.winnerId ?? '' : target
  const already = targetId ? busyWith.get(targetId) : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isRematch && !target) { setTargetErr('Choose who you are calling out.'); return }
    if (over) return
    const r = await act.run(async () => ok(await supabase.rpc('create_callout', {
      p_target_fighter_id: isRematch ? null : target,
      p_message: trimmed || null,
      p_rematch_of: isRematch ? rematchOf : null,
    })))
    if (r.ok) {
      toast(isRematch ? `Rematch asked. ${name(targetId)} sees it on the board.` : `Callout sent. ${name(targetId)} sees it on the board.`)
      onSent()
    }
  }

  const counterId = `${hid}-count`
  return (
    <Paper as="section" className="co-form" aria-labelledby={`${hid}-h`}>
      <form onSubmit={submit} noValidate>
        <h2 id={`${hid}-h`} ref={headRef} tabIndex={-1} className="t-head">{isRematch ? 'Ask for a rematch' : 'Call someone out'}</h2>

        {isRematch ? (
          rematchErr ? <FieldError>{rematchErr}</FieldError>
            : !rematch ? <p className="t-help co-dim">Loading the bout…</p>
            : (
              <div className="co-rematch">
                <span className="label">Rematch with</span>
                <p className="t-sub"><bdi>{name(rematch.winnerId)}</bdi></p>
                <p className="t-help co-dim">
                  {rematch.eligible ? `You ${lostBy(rematch.fight.method).toLowerCase()}` : 'Bout'} on{' '}
                  <span className="nowrap">{fmtDay(rematch.fight.settled_at ?? rematch.fight.scheduled_at)}</span>.
                </p>
                {!rematch.eligible && <FieldError>Only the fighter who lost this bout can ask for a rematch.</FieldError>}
              </div>
            )
        ) : (
          <Field label="Fighter" error={targetErr}
            hint={already === 'in' ? <>{name(targetId)} already called you out. Answer that one first.</>
              : already === 'out' ? <>You already called {name(targetId)} out. Wait for an answer or withdraw it.</> : undefined}>
            <Select name="target" value={target} onChange={e => { setTarget(e.target.value); setTargetErr(null); act.setError(null) }}>
              <option value="">Choose…</option>
              {options.map(f => <option key={f.id} value={f.id}>{f.nickname}</option>)}
            </Select>
          </Field>
        )}

        <div className="field">
          <label className="field-label" htmlFor={`${hid}-msg`}>Message <span className="opt">(optional)</span></label>
          <textarea id={`${hid}-msg`} name="message" className="input co-msg" rows={3} value={msg} autoComplete="off"
            placeholder="Say when, say why."
            aria-invalid={over || undefined} aria-describedby={counterId}
            onChange={e => { setMsg(oneLine(e.target.value)); act.setError(null) }} />
          <p id={counterId} className={over ? 'co-count co-count--over' : 'co-count'}>
            <span aria-hidden="true"><b>{trimmed.length}</b>/{CALLOUT_MESSAGE_MAX}</span>
            <span className="sr-only">{over ? `${-left} characters too long` : `${left} characters left`}</span>
          </p>
          {over && <FieldError>Cut {-left} character{left === -1 ? '' : 's'}. Callouts are {CALLOUT_MESSAGE_MAX} at most.</FieldError>}
          <span className="sr-only" aria-live="polite">{left <= 20 ? (over ? `${-left} too long` : `${left} left`) : ''}</span>
        </div>

        <p className="t-help co-dim">
          {atLimit
            ? <>You have {CALLOUT_OPEN_LIMIT} open callouts, the most allowed. Withdraw one first.</>
            : <>They can say yes or no. If both of you want it, an admin books the bout. Open callouts: <b className="data">{myOpen}/{CALLOUT_OPEN_LIMIT}</b>.</>}
        </p>
        {act.error && <FieldError>{act.error}</FieldError>}
        <div className="co-actions">
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button type="submit" variant={quietSubmit ? 'ink' : 'primary'} busy={act.busy} busyLabel="Sending" wrap
            disabled={atLimit || over || !!already || (isRematch && !rematch?.eligible)}>
            {isRematch ? 'Ask for the rematch' : 'Send the callout'}
          </Button>
        </div>
      </form>
    </Paper>
  )
}
