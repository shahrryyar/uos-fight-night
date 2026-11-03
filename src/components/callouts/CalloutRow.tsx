/**
 * One callout printed on ink (material C, DESIGN 3): status stamp + date, "A called out B", the message
 * in curly quotes, the status sentence, and the viewer's own action (withdraw, with an inline confirm).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Button, FieldError, Stamp, useToast } from '../ui'
import { calloutStamp, fmtShortDay, isCalledOff, quoted, type BoardRow } from './format'
import { ok, useCalloutAction } from './useCallouts'

interface Props {
  c: BoardRow
  myFighterId: string | null
  onChanged: () => void
}

export default function CalloutRow({ c, myFighterId, onChanged }: Props) {
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const act = useCalloutAction()
  const mine = !!myFighterId && c.challenger_fighter_id === myFighterId
  const forMe = !!myFighterId && c.target_fighter_id === myFighterId
  const canWithdraw = mine && (c.status === 'pending' || c.status === 'accepted')
  const hid = `co-${c.id}`
  const off = isCalledOff(c)

  const withdraw = async () => {
    const r = await act.run(async () => ok(await supabase.rpc('withdraw_callout', { p_callout_id: c.id })))
    if (r.ok) { toast('Callout withdrawn.'); onChanged() }
    else setConfirm(false)
  }

  const tone = c.status === 'pending' ? 'live' : 'bone'
  const who = (id: string, nick: string, you: boolean) => (
    <span className="co-who"><Link to={`/app/fighters/${id}`} className="co-name"><bdi>{nick}</bdi></Link>{you && <span className="co-you">(you)</span>}</span>
  )

  return (
    <article className="co-row" aria-labelledby={hid}>
      <div className="bout-top">
        <Stamp tone={tone} size="sm" rot={c.status === 'pending' ? -3 : 2}>{calloutStamp(c)}</Stamp>
        <span className="data c-2 nowrap">
          {c.rematch_of && <><span className="co-tag">Rematch</span>{' · '}</>}{fmtShortDay(c.created_at)}
        </span>
      </div>
      <h3 id={hid} className="t-sub co-h">
        {who(c.challenger_fighter_id, c.challenger_nickname, mine)}
        <span className="co-verb">called out</span>
        {who(c.target_fighter_id, c.target_nickname, forMe)}
      </h3>
      {c.message?.trim() && <p className="co-quote">{quoted(c.message)}</p>}
      <p className="t-help co-status">
        {c.status === 'pending' && <>Waiting on a yes or no.</>}
        {c.status === 'accepted' && <><bdi>{c.target_nickname}</bdi> said yes. Waiting on an admin to book it.</>}
        {c.status === 'approved' && <>Approved. An admin is setting the date.</>}
        {c.status === 'booked' && (off
          ? <>Booked, then called off{c.fight_cancel_kind === 'declined' ? ': a fighter said no to the bout' : ''}.</>
          : c.fight_status === 'settled'
            ? <>Fought. <Link to="/app/history" className="co-link">See the result</Link>.</>
            : <>Booked. <Link to="/app" className="co-link">See it on Tonight</Link>.</>)}
        {c.status === 'declined' && <><bdi>{c.target_nickname}</bdi> said no.</>}
        {c.status === 'rejected' && <>An admin passed on this one{c.decision_note?.trim() ? <>: {quoted(c.decision_note)}</> : '.'}</>}
      </p>

      {canWithdraw && (confirm ? (
        <div className="co-confirm" role="group" aria-label="Withdraw this callout?">
          <p className="t-help"><b>Withdraw this callout?</b> It comes off the board for everyone.</p>
          <div className="co-actions">
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Back</Button>
            <Button variant="danger" onInk size="sm" busy={act.busy} busyLabel="Withdrawing" onClick={() => void withdraw()}>Yes, withdraw</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="co-withdraw" onClick={() => { act.setError(null); setConfirm(true) }}>Withdraw</Button>
      ))}
      {act.error && <div className="co-err"><FieldError>{act.error}</FieldError></div>}
    </article>
  )
}
