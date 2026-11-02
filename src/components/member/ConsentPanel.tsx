/**
 * Booked bouts (DESIGN 11.3 scheduled rows, states-a). Both fighters must say yes before picks open.
 *   <ConsentAsk>  viewer is booked and hasn't answered: "Red corner vs X", 3 rules, [I'm in] [Say no].
 *                 The decline step replaces the buttons inline: "Say no to this bout?" [Back] [Yes, call it off].
 *   <WaitList>    everyone else: CheckCircle "Said yes" / HourglassMedium "Not yet" (44px rows).
 * RPCs unchanged: accept_fight / decline_fight.
 */
import { useId, useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { FightRow } from '../../lib/hooks'
import type { Side } from '../../lib/types'
import { Button, CheckCircle, FieldError, Handshake, HourglassMedium, Stamp, useToast } from '../ui'
import { accepted, boutLabel, fmtDay, fmtTime, sideWord } from './format'

interface AskProps {
  fight: FightRow
  redName: string
  blueName: string
  mySide: Side
  onChanged: () => void
}

/** The booking you must answer. Rendered inside the taped poster. */
export default function ConsentAsk({ fight, redName, blueName, mySide, onChanged }: AskProps) {
  const toast = useToast()
  const hid = useId()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const opp = mySide === 'red' ? blueName : redName
  const oppSaidYes = mySide === 'red' ? !!fight.blue_accepted_at : !!fight.red_accepted_at

  const act = async (kind: 'accept' | 'decline') => {
    setBusy(kind); setErr(null)
    const { error } = await supabase.rpc(kind === 'accept' ? 'accept_fight' : 'decline_fight', { p_fight_id: fight.id })
    setBusy(null)
    if (error) { setErr(friendlyError(error)); return }
    setConfirmDecline(false)
    toast(kind === 'accept'
      ? (oppSaidYes ? <>You're in. Picks open now.</> : <>You're in. Picks open once <bdi>{opp}</bdi> says yes.</>)
      : 'Bout called off. Saying no is always fine.', { icon: kind === 'accept' ? Handshake : CheckCircle })
    onChanged()
  }

  return (
    <div aria-labelledby={hid} role="group">
      <div className="ev-top">
        <Stamp rot={-3}>You’re booked</Stamp>
        <span className="data"><span className="nowrap">{boutLabel(fight)}</span> · <b>{fmtTime(fight.scheduled_at)}</b></span>
      </div>
      <h2 id={hid} className="t-head ask-h">{sideWord(mySide)} corner vs <bdi>{opp}</bdi></h2>
      <p className="t-help ask-sub">
        {fmtDay(fight.scheduled_at)}. {oppSaidYes
          ? <><bdi>{opp}</bdi> already said yes. Say yes and picks open.</>
          : <>Say yes and picks open once your opponent says yes too.</>}
      </p>
      <ul className="rules-mini" role="list">
        <li>Tap or say stop and it stops, right away.</li>
        <li>No strikes. Wrestling only.</li>
        <li>Saying no is always fine.</li>
      </ul>
      {!confirmDecline ? (
        <div className="two">
          <Button onClick={() => void act('accept')} busy={busy === 'accept'} busyLabel="Saving" disabled={busy === 'decline'}>I’m in</Button>
          <Button variant="danger" onClick={() => setConfirmDecline(true)} disabled={!!busy}>Say no</Button>
        </div>
      ) : (
        <div className="decline-step">
          <h3 className="t-sub">Say no to this bout?</h3>
          <p className="t-help">The bout gets called off. No record change, and saying no is always fine.</p>
          <div className="two">
            <Button variant="ghost" onClick={() => setConfirmDecline(false)} disabled={!!busy}>Back</Button>
            <Button variant="danger" wrap onClick={() => void act('decline')} busy={busy === 'decline'} busyLabel="Calling off">Yes, call it off</Button>
          </div>
        </div>
      )}
      {err && <FieldError>{err}</FieldError>}
    </div>
  )
}

/** Who has said yes so far (members, and the fighter who already answered). */
export function WaitList({ fight, redName, blueName }: { fight: FightRow; redName: string; blueName: string }) {
  const ok = accepted(fight)
  const row = (yes: boolean, name: string, side: Side) => (
    <li>
      {yes ? <CheckCircle /> : <HourglassMedium />}
      <span><bdi>{name}</bdi><span className="sr-only">, {side} corner</span></span>
      <span className="st">{yes ? 'Said yes' : 'Not yet'}</span>
    </li>
  )
  return (
    <ul className="waitlist" role="list" aria-label="Who has said yes">
      {row(ok.red, redName, 'red')}
      {row(ok.blue, blueName, 'blue')}
    </ul>
  )
}
