/**
 * Admin callouts queue (C5). Open callouts as flat bout sheets (paper, no tape), newest first:
 *   none    stamp + date, mini-vs (red = challenger, the booking's corners), message, status, actions
 *   book    admin_approve_callout (unless already approved) gives the prefill; the inline booking form
 *           (title, start, picks lock, bout order, billing) submits admin_book_callout so the fight links back
 *   reject  inline step with an optional reason, admin_reject_callout
 * Delete (moderation, any status) asks through the admin confirm dialog: admin_delete_callout.
 * Closed callouts (booked / declined / rejected) sit under a <details> list on ink with Delete only.
 */
import { useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import type { CalloutPrefill, Fighter } from '../../../lib/types'
import { Button, Field, FieldError, Input, Paper, Seg, Stamp, Stepper, Trash, useToast } from '../../ui'
import { CALLOUT_STAMP, calloutStamp, calloutTitle, fmtShortDay, isOpenStatus, quoted, stripHidden, useCalloutAction, useCalloutBoard, type BoardRow } from '../../callouts'
import type { AdminFight } from '../fightTypes'
import { FieldGroup, SectionHead, LoadError, cardDateOf, fmtCardDate, fromLocalInput, toLocalInput, useConfirm } from '../ui'
import '../../callouts/callouts.css'

interface Props {
  byId: Record<string, Fighter>
  /** fighter ids with an active linked member account */
  hasAccount: Set<string>
  cardFights: AdminFight[]
  /** a fight was booked: refresh the live card */
  onBooked: () => void
}

const ok = <T,>(res: { data: T; error: unknown }): T => { if (res.error) throw res.error; return res.data }

function defaultStart() {
  const d = new Date(Date.now() + 24 * 3600_000)
  d.setHours(21, 0, 0, 0)
  return toLocalInput(d)
}

export default function CalloutQueue({ byId, hasAccount, cardFights, onBooked }: Props) {
  const board = useCalloutBoard(60)
  const [dialog, ask] = useConfirm()
  const toast = useToast()
  const del = useCalloutAction()
  const rows = board.data ?? []
  // ready to book first (accepted / approved, or pending with no target account), newest first within each
  const ready = (c: BoardRow) => c.status !== 'pending' || !hasAccount.has(c.target_fighter_id)
  const open = rows.filter(c => isOpenStatus(c.status)).sort((a, b) => Number(ready(b)) - Number(ready(a)))
  const closed = rows.filter(c => !isOpenStatus(c.status))
  const reload = () => void board.reload()

  const remove = async (c: BoardRow) => {
    const yes = await ask({
      title: 'Delete this callout?',
      body: <p className="t-help">{c.challenger_nickname} called out {c.target_nickname}. It disappears from the board for everyone, message included. The admin log only records that it was deleted.{c.fight_id ? ' The booked bout stays.' : ''}</p>,
      confirmLabel: 'Delete it',
    })
    if (!yes) return
    const r = await del.run(async () => ok(await supabase.rpc('admin_delete_callout', { p_callout_id: c.id, p_reason: null })))
    if (r.ok) { toast('Callout deleted.'); reload() }
  }

  return (
    <section className="adm-section co-queue" aria-labelledby="co-q-h">
      <SectionHead id="co-q-h" title="Callouts" count={board.data ? open.length : undefined}
        sub="Fighters ask for these bouts. Book the ones both sides want, or pass. The challenger gets the red corner." />
      <LoadError error={board.error && !board.data ? board.error : null} what="the callouts" onRetry={reload} busy={board.loading} />
      {del.error && <Paper className="co-q-del-err"><FieldError>{del.error}</FieldError></Paper>}
      {board.data && open.length === 0 && <p className="t-help c-2 co-q-note">No open callouts right now.</p>}
      {open.map(c => (
        <QueueCard key={c.id} c={c} red={byId[c.challenger_fighter_id]} blue={byId[c.target_fighter_id]}
          targetHasAccount={hasAccount.has(c.target_fighter_id)} cardFights={cardFights}
          onChanged={reload} onBooked={() => { reload(); onBooked() }} onDelete={() => void remove(c)} />
      ))}
      {closed.length > 0 && (
        <details className="co-q-closed">
          <summary className="btn btn--ghost btn--sm">Closed callouts ({closed.length})</summary>
          <ul className="rows" role="list">
            {closed.map(c => (
              <li key={c.id} className="row">
                <span>
                  <span className="t-sub"><bdi>{c.challenger_nickname}</bdi> <span className="c-2" style={{ fontSize: '1rem' }}>vs</span> <bdi>{c.target_nickname}</bdi></span>
                  <span className="data c-2">{calloutStamp(c)} · {fmtShortDay(c.decided_at ?? c.responded_at ?? c.created_at)}</span>
                </span>
                <Button variant="ghost" size="sm" iconOnly icon={Trash} aria-label={`Delete the callout ${c.challenger_nickname} vs ${c.target_nickname}`}
                  onClick={() => void remove(c)} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {dialog}
    </section>
  )
}

type Mode = 'none' | 'book' | 'reject'

interface CardProps {
  c: BoardRow; red?: Fighter; blue?: Fighter
  targetHasAccount: boolean
  cardFights: AdminFight[]
  onChanged: () => void
  onBooked: () => void
  onDelete: () => void
}

function QueueCard({ c, red, blue, targetHasAccount, cardFights, onChanged, onBooked, onDelete }: CardProps) {
  const toast = useToast()
  const act = useCalloutAction()
  const [mode, setMode] = useState<Mode>('none')
  const [prefill, setPrefill] = useState<CalloutPrefill | null>(null)
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [lock, setLock] = useState(defaultStart)
  const [lockTouched, setLockTouched] = useState(false)
  const [boutOrder, setBoutOrder] = useState<number | null>(null)
  const [mainEvent, setMainEvent] = useState(false)
  const [timeErr, setTimeErr] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const hid = `coq-${c.id}`

  const canBook = c.status === 'accepted' || c.status === 'approved' || (c.status === 'pending' && !targetHasAccount)
  const startIso = fromLocalInput(start)
  const cardDate = startIso ? cardDateOf(startIso) : null
  const onCard = cardDate ? cardFights.filter(f => f.card_date === cardDate && f.status !== 'cancelled') : []
  const existingMain = onCard.find(f => f.is_main_event)
  const nextBout = onCard.reduce((m, f) => Math.max(m, f.bout_order ?? 0), 0) + 1

  const go = (m: Mode) => { act.setError(null); setTimeErr(null); setMode(m) }

  const startBooking = async () => {
    if (c.status === 'approved') {
      setTitle(calloutTitle(c)); go('book'); return
    }
    const r = await act.run(async () => ok(await supabase.rpc('admin_approve_callout', { p_callout_id: c.id })) as CalloutPrefill)
    if (r.ok) {
      setPrefill(r.value); setTitle(r.value?.title ?? calloutTitle(c)); go('book')
      onChanged()
    }
  }

  const book = async (e: FormEvent) => {
    e.preventDefault()
    const s = fromLocalInput(start), l = fromLocalInput(lock)
    if (!s || !l) { setTimeErr('Set both the bout time and when picks lock.'); return }
    if (new Date(l) > new Date(s)) { setTimeErr('Picks have to lock at or before the bout starts.'); return }
    const r = await act.run(async () => ok(await supabase.rpc('admin_book_callout', {
      p_callout_id: c.id, p_scheduled_at: s, p_lock_at: l, p_title: title.trim() || null,
      p_bout_order: boutOrder, p_main_event: mainEvent,
    })))
    if (r.ok) { toast('Bout booked from the callout. Picks open once both fighters say yes.'); setMode('none'); onBooked() }
  }

  const reject = async (e: FormEvent) => {
    e.preventDefault()
    const r = await act.run(async () => ok(await supabase.rpc('admin_reject_callout', { p_callout_id: c.id, p_reason: reason.trim() || null })))
    if (r.ok) { toast('Callout turned down.'); setMode('none'); onChanged() }
  }

  const kg = (f?: Fighter, snap?: number | null) => {
    const v = snap ?? f?.weight_kg
    return v != null ? <span className="kg data">{v}&nbsp;kg</span> : null
  }

  return (
    <Paper as="article" className="bout-card" aria-labelledby={hid}>
      <div className="ev-top">
        <Stamp tone="ink" size="sm" rot={-3}>{CALLOUT_STAMP[c.status]}</Stamp>
        <span className="data">{c.rematch_of ? 'Rematch · ' : ''}<span className="nowrap">{fmtShortDay(c.created_at)}</span></span>
      </div>
      <h3 id={hid} className="sr-only">{c.challenger_nickname} called out {c.target_nickname}</h3>
      <div className="mini-vs">
        <div><span className="corner corner--red label">Red</span><p className="t-sub"><bdi>{c.challenger_nickname}</bdi></p>{kg(red, prefill?.red_weight_kg)}</div>
        <span className="vs" aria-hidden="true">vs</span>
        <div className="r"><span className="corner corner--blue label">Blue</span><p className="t-sub"><bdi>{c.target_nickname}</bdi></p>{kg(blue, prefill?.blue_weight_kg)}</div>
      </div>
      {c.message?.trim() && <p className="co-q-quote">{quoted(c.message)}</p>}
      <p className="t-help c-2 co-q-note">
        {c.status === 'pending' && (targetHasAccount
          ? <>Waiting on <bdi>{c.target_nickname}</bdi> to answer. Book it once they say yes.</>
          : <><bdi>{c.target_nickname}</bdi> has no app account, so you can book it now.</>)}
        {c.status === 'accepted' && <><bdi>{c.target_nickname}</bdi> said yes. Ready to book.</>}
        {c.status === 'approved' && <>Approved. Set the date and book it.</>}
      </p>

      {mode === 'none' && (
        <div className="co-q-actions">
          {canBook && (
            <Button variant="ink" size="sm" busy={act.busy} busyLabel="Approving" onClick={() => void startBooking()}>
              {c.status === 'approved' ? 'Book it' : 'Approve and book'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { setReason(''); go('reject') }}>Turn down</Button>
          <Button variant="ghost" size="sm" iconOnly icon={Trash} aria-label="Delete this callout" onClick={onDelete} />
        </div>
      )}

      {mode === 'book' && (
        <form className="co-q-step" onSubmit={book} noValidate aria-label="Book the bout">
          <p className="t-sub">Book the bout</p>
          <Field label="Title" hint="Shown above the names. Leave it as is or change it.">
            <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} name="title" autoComplete="off" />
          </Field>
          <Field label="Bout starts">
            <Input type="datetime-local" value={start} required name="scheduled_at" aria-invalid={timeErr ? true : undefined}
              onChange={e => { setStart(e.target.value); setTimeErr(null); if (!lockTouched) setLock(e.target.value) }} />
          </Field>
          <Field label="Picks lock" hint={lockTouched ? undefined : 'Same as the start unless you change it.'} error={timeErr}>
            <Input type="datetime-local" value={lock} required name="lock_at"
              onChange={e => { setLock(e.target.value); setLockTouched(true); setTimeErr(null) }} />
          </Field>
          <div className="field">
            <span className="field-label">Bout order</span>
            <Stepper label="Bout order" value={boutOrder ?? nextBout} min={1} max={99} onChange={n => setBoutOrder(n)} format={n => `#${n}`} />
            <p className="field-hint">
              {boutOrder == null
                ? <>Next free slot{cardDate ? <> on <span className="nowrap">{fmtCardDate(cardDate)}</span></> : null}.</>
                : <button type="button" className="link" style={{ minHeight: 0 }} onClick={() => setBoutOrder(null)}>Use the next free slot</button>}
            </p>
          </div>
          <FieldGroup label="Billing"
            hint={mainEvent && existingMain ? 'This card already has a main event. Switch it in Card order first, or the booking is refused.' : undefined}>
            <div className="segs">
              <Seg pressed={!mainEvent} onClick={() => setMainEvent(false)}>Undercard</Seg>
              <Seg pressed={mainEvent} onClick={() => setMainEvent(true)}>Main event</Seg>
            </div>
          </FieldGroup>
          <p className="t-help c-2">Both fighters still say yes on Tonight before picks open.</p>
          {act.error && <FieldError>{act.error}</FieldError>}
          <div className="co-actions">
            <Button variant="ghost" onClick={() => go('none')}>Back</Button>
            <Button type="submit" busy={act.busy} busyLabel="Booking">Book the bout</Button>
          </div>
        </form>
      )}

      {mode === 'reject' && (
        <form className="co-q-step" onSubmit={reject} noValidate aria-label="Turn down this callout">
          <p className="t-sub">Turn down this callout?</p>
          <Field label={<>Reason <span className="opt">(optional)</span></>} hint="Shown on the board under the callout. 200 characters at most."
            error={reason.trim().length > 200 ? 'Keep the reason under 200 characters.' : undefined}>
            <Input value={reason} onChange={e => setReason(stripHidden(e.target.value))} name="reason" autoComplete="off" />
          </Field>
          {act.error && <FieldError>{act.error}</FieldError>}
          <div className="co-actions">
            <Button variant="ghost" onClick={() => go('none')}>Back</Button>
            <Button type="submit" variant="danger" busy={act.busy} busyLabel="Saving" disabled={reason.trim().length > 200}>Turn it down</Button>
          </div>
        </form>
      )}

      {mode === 'none' && act.error && <div style={{ marginTop: 10 }}><FieldError>{act.error}</FieldError></div>}
    </Paper>
  )
}
