/**
 * A callout aimed at the viewer's fighter, still pending: the one thing to act on, so it may use the
 * screen's single taped poster (DESIGN principle 1, "a booking you must answer").
 * Accept / Say no; saying no has an inline confirm step on the same sheet (DESIGN 11.3 consent pattern).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Button, FieldError, Paper, Poster, Stamp, useToast } from '../ui'
import { fmtShortDay, quoted, type BoardRow } from './format'
import { ok, useCalloutAction } from './useCallouts'

export default function IncomingCallout({ c, taped, onChanged }: { c: BoardRow; taped: boolean; onChanged: () => void }) {
  const toast = useToast()
  const [step, setStep] = useState<'ask' | 'decline'>('ask')
  const act = useCalloutAction()
  const hid = `in-${c.id}`

  const answer = async (yes: boolean) => {
    const r = await act.run(async () => ok(await supabase.rpc(yes ? 'accept_callout' : 'decline_callout', { p_callout_id: c.id })))
    if (r.ok) {
      toast(yes ? 'You said yes. An admin books the bout next.' : `You said no to ${c.challenger_nickname}.`)
      onChanged()
    } else setStep('ask')
  }

  const body = (
    <>
      <div className="ev-top">
        <Stamp rot={-4}>Called out</Stamp>
        <span className="data nowrap">{c.rematch_of ? 'Rematch · ' : ''}{fmtShortDay(c.created_at)}</span>
      </div>
      <h2 id={hid} className="t-bout co-in-name">
        <Link to={`/app/fighters/${c.challenger_fighter_id}`} className="co-name"><bdi>{c.challenger_nickname}</bdi></Link>
      </h2>
      <p className="t-help co-dim">{c.rematch_of ? 'wants a rematch with you.' : 'called you out.'}</p>
      {c.message?.trim() && <blockquote className="ref co-in-quote">{quoted(c.message)}</blockquote>}

      {step === 'ask' ? (
        <>
          <p className="t-help co-in-help">Say yes and an admin books the bout. You still confirm the booking on Tonight before picks open.</p>
          <div className="co-actions">
            <Button variant="danger" onClick={() => { act.setError(null); setStep('decline') }}>Say no</Button>
            <Button busy={act.busy} busyLabel="Saving" onClick={() => void answer(true)}>I'm in</Button>
          </div>
        </>
      ) : (
        <div className="co-in-decline" role="group" aria-labelledby={`${hid}-d`}>
          <p id={`${hid}-d`} className="t-sub">Say no to <bdi>{c.challenger_nickname}</bdi>?</p>
          <p className="t-help co-dim">The callout closes and shows as declined on the board.</p>
          <div className="co-actions">
            <Button variant="ghost" onClick={() => setStep('ask')}>Back</Button>
            <Button variant="danger" busy={act.busy} busyLabel="Saving" onClick={() => void answer(false)}>Yes, say no</Button>
          </div>
        </div>
      )}
      {act.error && <FieldError>{act.error}</FieldError>}
    </>
  )

  return taped
    ? <Poster as="article" className="co-in" aria-labelledby={hid}>{body}</Poster>
    : <Paper as="article" className="co-in" aria-labelledby={hid}>{body}</Paper>
}
