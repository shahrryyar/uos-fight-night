import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { FightRow } from '../../lib/hooks'
import type { Side } from '../../lib/types'

interface Props {
  fight: FightRow
  redName: string
  blueName: string
  /** Which corner the signed-in member fights in (null = not a participant). */
  mySide: Side | null
  onChanged: () => void
}

/** 'scheduled' fights: both fighters must accept before picks open. */
export default function ConsentPanel({ fight, redName, blueName, mySide, onChanged }: Props) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const redOk = !!fight.red_accepted_at, blueOk = !!fight.blue_accepted_at
  const iAccepted = mySide === 'red' ? redOk : mySide === 'blue' ? blueOk : false

  const act = async (kind: 'accept' | 'decline') => {
    setBusy(kind); setErr(null)
    const { error } = await supabase.rpc(kind === 'accept' ? 'accept_fight' : 'decline_fight', { p_fight_id: fight.id })
    setBusy(null)
    if (error) setErr(friendlyError(error))
    else { setConfirmDecline(false); onChanged() }
  }

  return (
    <div className="space-y-3">
      {mySide && !iAccepted && (
        <div className="rounded-xl border-2 border-gold bg-gold/10 p-3 text-center" role="region" aria-label="Your booking">
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold">You're booked</p>
          <p className="mt-0.5 font-display text-2xl leading-none tracking-wide">
            {mySide === 'red' ? 'Red' : 'Blue'} corner vs {mySide === 'red' ? blueName : redName}
          </p>
          <p className="mt-1 text-xs text-muted">Opt-in only. Tap = stop. Referee's call is final. No strikes. 18+.</p>
          {!confirmDecline ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => void act('accept')} disabled={!!busy}
                className="min-h-12 rounded-lg bg-gold font-display text-2xl tracking-wider text-ink disabled:opacity-50">
                {busy === 'accept' ? 'Saving…' : 'Accept'}
              </button>
              <button onClick={() => setConfirmDecline(true)} disabled={!!busy}
                className="min-h-12 rounded-lg border border-line font-display text-2xl tracking-wider text-muted disabled:opacity-50">
                Decline
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm">Decline this fight? It will be called off.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={() => setConfirmDecline(false)} disabled={!!busy}
                  className="min-h-12 rounded-lg border border-line font-display text-xl tracking-wider text-muted">
                  Back
                </button>
                <button onClick={() => void act('decline')} disabled={!!busy}
                  className="min-h-12 rounded-lg bg-red font-display text-xl tracking-wider disabled:opacity-50">
                  {busy === 'decline' ? 'Declining…' : 'Yes, decline'}
                </button>
              </div>
            </div>
          )}
          {err && <p className="mt-2 text-xs text-red" role="alert">{err}</p>}
        </div>
      )}
      {mySide && iAccepted && (
        <p className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-center text-sm font-semibold text-gold">
          You accepted. Waiting on your opponent. 💪
        </p>
      )}
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <p className="text-center text-[11px] uppercase tracking-widest text-muted">Waiting for fighters to accept</p>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <li className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red/40 px-2">
            <span className="size-2 shrink-0 rounded-full bg-red" aria-hidden />
            <span className="truncate font-semibold">{redName}</span>
            <span aria-label={redOk ? 'accepted' : 'pending'}>{redOk ? '✅' : '⏳'}</span>
          </li>
          <li className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue/40 px-2">
            <span className="size-2 shrink-0 rounded-full bg-blue" aria-hidden />
            <span className="truncate font-semibold">{blueName}</span>
            <span aria-label={blueOk ? 'accepted' : 'pending'}>{blueOk ? '✅' : '⏳'}</span>
          </li>
        </ul>
        <p className="mt-2 text-center text-xs text-muted">Votes and points picks open once both fighters accept.</p>
      </div>
    </div>
  )
}
