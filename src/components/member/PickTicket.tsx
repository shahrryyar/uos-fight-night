/**
 * The pick ticket (DESIGN 11.5 + 11.6, IMPLEMENTATION C3): ONE flow for the free vote and the optional points.
 *   side (radiogroup) -> amount (Just pick | 25 | 50 | 100 | Type an amount) -> one CTA that names the action
 *   "Just pick"  -> cast_vote only
 *   an amount    -> cast_vote, then place_bet with the same side (if place_bet fails the vote stays, and we say so)
 * Changing points that are already in: cancel_bet, then place_bet (both existing RPCs).
 * After a pick the ticket collapses to the PICKED stub with [Change pick] [Take back N].
 */
import { useId, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { estimatePayout, maxBet, MIN_BET } from '../../lib/math'
import { fmtNum } from '../../lib/copy'
import type { Bet, FightPool, Side } from '../../lib/types'
import { ArrowCounterClockwise, Button, CheckFat, FieldError, Input, Stamp, Ticket, cx, useToast } from '../ui'
import { pickError, sideWord } from './format'

export interface PickTicketProps {
  fightId: string
  pool: FightPool | null
  balance: number | null
  myVote: Side | null
  /** the viewer's ACTIVE points pick, if any */
  myBet: Bet | null
  redName: string
  blueName: string
  /** reload the panel data and the header balance; awaited before the ticket collapses */
  onChanged: () => Promise<void> | void
  className?: string
}

type Amount = 'just' | number

const CHIPS = [25, 50, 100] as const

export default function PickTicket({ fightId, pool, balance, myVote, myBet, redName, blueName, onChanged, className }: PickTicketProps) {
  const toast = useToast()
  const uid = useId()
  const hasPick = !!myVote || !!myBet
  const [editing, setEditing] = useState(!hasPick)
  const [side, setSide] = useState<Side | null>(myBet?.side ?? myVote)
  const [amt, setAmt] = useState<Amount>(myBet?.amount ?? 'just')
  const [typing, setTyping] = useState(() => !!myBet && !CHIPS.includes(myBet.amount as 25))
  const [typed, setTyped] = useState(myBet && !CHIPS.includes(myBet.amount as 25) ? String(myBet.amount) : '')
  const [busy, setBusy] = useState<null | 'pick' | 'back'>(null)
  const [err, setErr] = useState<string | null>(null)
  // the CTA never goes disabled (DESIGN 11.14): tapping it early says what is missing, inline
  const [missing, setMissing] = useState<null | 'side' | 'amount'>(null)
  const sidesRef = useRef<HTMLDivElement>(null)
  const amtRef = useRef<HTMLInputElement>(null)

  const name = (s: Side) => (s === 'red' ? redName : blueName)
  // points already in come back first when changing, so they count towards what you can put in
  const spendable = balance == null ? null : balance + (myBet?.amount ?? 0)
  const max = spendable == null ? 0 : maxBet(spendable)
  const chips = CHIPS.filter(c => c <= max)
  const canPoints = spendable != null && max >= MIN_BET

  // pool without the viewer's own points (they come back before the new ones go in)
  const red = (pool?.red_total ?? 0) - (myBet?.side === 'red' ? myBet.amount : 0)
  const blue = (pool?.blue_total ?? 0) - (myBet?.side === 'blue' ? myBet.amount : 0)

  const typedN = Number(typed)
  const typedErr = typing && typed !== ''
    ? (!Number.isInteger(typedN) || typedN < MIN_BET ? `Put in at least ${MIN_BET} pts.` : typedN > max ? `You can put in up to ${fmtNum(max)} pts right now.` : null)
    : null
  const amount = typing ? (typed !== '' && !typedErr ? typedN : null) : amt === 'just' ? 0 : amt
  const est = side && amount ? estimatePayout(amount, side === 'red' ? red : blue, side === 'red' ? blue : red) : 0
  const unchanged = hasPick && side === (myBet?.side ?? myVote) && (amount ?? -1) === (myBet?.amount ?? 0)

  const openEditor = () => {
    setSide(myBet?.side ?? myVote); setAmt(myBet?.amount ?? 'just'); setErr(null)
    const custom = !!myBet && !CHIPS.includes(myBet.amount as 25)
    setTyping(custom); setTyped(custom ? String(myBet!.amount) : '')
    setEditing(true)
  }

  const submit = async () => {
    if (busy) return
    if (!side) {
      setMissing('side')
      sidesRef.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus()
      return
    }
    if (amount == null) { setMissing('amount'); amtRef.current?.focus(); return }
    setMissing(null)
    if (unchanged) { setEditing(false); return }
    setBusy('pick'); setErr(null)
    if (side !== myVote) {
      const { error } = await supabase.rpc('cast_vote', { p_fight_id: fightId, p_side: side })
      if (error) { setBusy(null); setErr(pickError(error)); return }
    }
    let pointsErr: unknown = null
    const keepBet = !!myBet && myBet.side === side && myBet.amount === amount
    if (myBet && !keepBet) {
      const { error } = await supabase.rpc('cancel_bet', { p_bet_id: myBet.id })
      if (error) pointsErr = error
    }
    if (!pointsErr && amount > 0 && !keepBet) {
      const { error } = await supabase.rpc('place_bet', { p_fight_id: fightId, p_side: side, p_amount: amount })
      if (error) pointsErr = error
    }
    await onChanged()
    setBusy(null)
    if (pointsErr) {
      setErr(`Your pick is saved, but the points didn't go in: ${pickError(pointsErr)}`)
      return
    }
    setEditing(false)
    toast(<>Pick saved: {amount ? <>{amount} pts on </> : null}<bdi>{name(side)}</bdi>.</>, { icon: CheckFat })
  }

  const takeBack = async () => {
    if (!myBet || busy) return
    setBusy('back'); setErr(null)
    const { error } = await supabase.rpc('cancel_bet', { p_bet_id: myBet.id })
    if (error) { setBusy(null); setErr(pickError(error)); return }
    await onChanged()
    setBusy(null)
    toast(`Pick taken back. ${myBet.amount} pts are yours again.`, { icon: ArrowCounterClockwise })
  }

  // ---------- collapsed: you already picked ----------
  if (hasPick && !editing) {
    const s = (myBet?.side ?? myVote)!
    const sideTotal = (s === 'red' ? pool?.red_total : pool?.blue_total) ?? 0
    const total = (pool?.red_total ?? 0) + (pool?.blue_total ?? 0)
    const back = myBet && sideTotal > 0 ? Math.floor((myBet.amount * total) / sideTotal) : null
    return (
      <Ticket className={cx('pick-ticket', className)} aria-labelledby={`${uid}-h`}>
        <div className="picked">
          <h3 id={`${uid}-h`} className="t-sub">Your pick</h3>
          <Stamp tone="bone" rot={-6} land stateKey={`${s}|${myBet?.amount ?? 0}`}>Picked</Stamp>
          <p className="t-help" aria-live="polite">
            {myBet
              ? <><b>{fmtNum(myBet.amount)} pts on <bdi>{name(s)}</bdi></b>.{back != null && <> About {fmtNum(back)} back if they win.</>}</>
              : <><b><bdi>{name(s)}</bdi></b>, {sideWord(s).toLowerCase()} corner. A free pick, no points in.</>}
          </p>
        </div>
        <div className={myBet ? 'two' : 'two two--one'}>
          <Button variant="ghost" size="sm" className="w-full" onClick={openEditor} disabled={!!busy}>
            {myBet ? 'Change pick' : 'Change or add points'}
          </Button>
          {myBet && (
            <Button variant="danger" size="sm" className="w-full" onInk onClick={() => void takeBack()}
              busy={busy === 'back'} busyLabel="Taking back">Take back {fmtNum(myBet.amount)}</Button>
          )}
        </div>
        {err && <FieldError>{err}</FieldError>}
      </Ticket>
    )
  }

  // ---------- open ticket ----------
  const cta = !side ? 'Choose a corner'
    : amount == null ? 'Type an amount'
    : unchanged ? 'Keep this pick'
    : amount > 0 ? <>Put {fmtNum(amount)} on <bdi>{name(side)}</bdi></>
    : <>Pick <bdi>{name(side)}</bdi></>

  const help = balance == null ? 'Loading your points…'
    : !side ? <>Just picking is free. You have {fmtNum(balance)}&nbsp;pts.</>
    : amount && est ? <>If your pick wins: about {fmtNum(est)} pts back. You have {fmtNum(balance)}&nbsp;pts.</>
    : !canPoints ? <>You need at least {MIN_BET * 2} pts to put points in. 100 more arrive every Monday.</>
    : <>Just picking is free. Add points if you want a bigger cheer. You have {fmtNum(balance)}&nbsp;pts.</>

  const chip = (value: Amount, label: string, word?: boolean) => {
    const on = !typing && amt === value
    return (
      <button key={String(value)} type="button" role="radio" aria-checked={on} className={cx('chip', word && 'chip--word')}
        onClick={() => { setTyping(false); setAmt(value); setMissing(null) }}>{label}</button>
    )
  }

  return (
    <Ticket className={cx('pick-ticket', className)} aria-labelledby={`${uid}-h`}>
      <div className="blk-head">
        <h3 id={`${uid}-h`} className="t-sub">Your pick</h3>
        <span className="t-help c-2">Private until picks lock</span>
      </div>
      <div ref={sidesRef} className="sides" role="radiogroup" aria-label="Who wins"
        aria-describedby={missing === 'side' ? `${uid}-side-err` : undefined}>
        {(['red', 'blue'] as const).map(s => (
          <button key={s} type="button" role="radio" aria-checked={side === s} className={`side side--${s}`}
            onClick={() => { setSide(s); setMissing(null) }}>
            <CheckFat className="tick" />
            <span className="label">{sideWord(s)}</span>
            <span className="nm"><bdi>{name(s)}</bdi></span>
          </button>
        ))}
      </div>
      {missing === 'side' && <FieldError id={`${uid}-side-err`}>Choose a corner first.</FieldError>}
      <div className="chips" role="radiogroup" aria-label="Points to put in" style={{ gridTemplateColumns: `1.5fr${' 1fr'.repeat(chips.length)}` }}>
        {chip('just', 'Just pick', true)}
        {chips.map(c => chip(c, String(c)))}
      </div>
      {canPoints && (
        typing ? (
          <div className="pick-typed">
            <label className="field-label" htmlFor={`${uid}-amt`}>Points to put in <span className="c-2">(10 to {fmtNum(max)})</span></label>
            <Input ref={amtRef} id={`${uid}-amt`} look="data" inputMode="numeric" pattern="[0-9]*" autoComplete="off" name="points"
              min={MIN_BET} max={max} value={typed} aria-invalid={typedErr ? true : undefined}
              aria-describedby={typedErr || missing === 'amount' ? `${uid}-amt-err` : undefined}
              onChange={e => { setTyped(e.target.value.replace(/[^0-9]/g, '').slice(0, 4)); setMissing(null) }} />
            {(typedErr || missing === 'amount') && (
              <FieldError id={`${uid}-amt-err`}>{typedErr ?? `Type at least ${MIN_BET} pts, or tap Just pick.`}</FieldError>
            )}
          </div>
        ) : null
      )}
      <Button wrap busy={busy === 'pick'} busyLabel="Saving" onClick={() => void submit()}>
        <span>{cta}</span>
      </Button>
      {err && <FieldError>{err}</FieldError>}
      {/* "Type an amount" rides the help line (no row of its own) to keep the main event under 1,000px */}
      <p className="t-help c-2 pick-help">
        <span aria-live="polite">{help}</span>
        {canPoints && !typing && (
          <> <button type="button" className="link pick-type-link"
            onClick={() => { setTyping(true); setAmt('just'); setMissing(null); requestAnimationFrame(() => amtRef.current?.focus()) }}>Type an amount</button></>
        )}
      </p>
      {hasPick && (
        <button type="button" className="link" onClick={() => { setEditing(false); setErr(null) }}>Keep my current pick</button>
      )}
    </Ticket>
  )
}
