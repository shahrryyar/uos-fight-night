/**
 * Book a bout: paper form with the admin field kit (DESIGN 11.16). Corner selects sit under red/blue
 * corner bands (no coloured side borders), bout order is a stepper, main event is a seg toggle.
 * admin_create_fight arguments are unchanged.
 */
import { useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import type { Fighter, Side } from '../../../lib/types'
import { Button, Field, Input, Paper, Seg, Select, Stepper, WarningOctagon, useToast } from '../../ui'
import type { AdminFight } from '../fightTypes'
import {
  FieldGroup, FormError, cardDateOf, fmtCardDate, focusFirstInvalid, fromLocalInput, must, parseKg, toLocalInput, useAction,
} from '../ui'

function defaultStart() {
  const d = new Date(Date.now() + 24 * 3600_000)
  d.setHours(21, 0, 0, 0)
  return toLocalInput(d)
}

type Errs = Partial<Record<'red' | 'blue' | 'kg' | 'time', string>>

interface Props { fighters: Fighter[]; cardFights: AdminFight[]; onCreated: () => void }

export default function CreateFight({ fighters, cardFights, onCreated }: Props) {
  const toast = useToast()
  const [red, setRed] = useState('')
  const [blue, setBlue] = useState('')
  const [redKg, setRedKg] = useState('')
  const [blueKg, setBlueKg] = useState('')
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [lock, setLock] = useState(defaultStart)
  const [lockTouched, setLockTouched] = useState(false)
  const [boutOrder, setBoutOrder] = useState<number | null>(null)
  const [mainEvent, setMainEvent] = useState(false)
  const [errs, setErrs] = useState<Errs>({})
  const act = useAction()

  const visible = fighters.filter(f => !f.hidden)
  const startIso = fromLocalInput(start)
  const cardDate = startIso ? cardDateOf(startIso) : null
  const onCard = cardDate ? cardFights.filter(f => f.card_date === cardDate && f.status !== 'cancelled') : []
  const existingMain = onCard.find(f => f.is_main_event)
  const nextBout = onCard.reduce((m, f) => Math.max(m, f.bout_order ?? 0), 0) + 1
  const clear = (k: keyof Errs) => setErrs(e => (e[k] ? { ...e, [k]: undefined } : e))

  const pick = (side: Side, id: string) => {
    const f = fighters.find(x => x.id === id)
    const kg = f?.weight_kg != null ? String(f.weight_kg) : ''
    if (side === 'red') { setRed(id); setRedKg(kg); clear('red') } else { setBlue(id); setBlueKg(kg); clear('blue') }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Errs = {}
    if (!red) next.red = 'Choose the red corner.'
    if (!blue) next.blue = 'Choose the blue corner.'
    else if (red && red === blue) next.blue = 'A fighter can\'t wrestle themselves. Pick someone else.'
    const s = fromLocalInput(start), l = fromLocalInput(lock)
    if (!s || !l) next.time = 'Set both the bout time and when picks lock.'
    else if (new Date(l) > new Date(s)) next.time = 'Picks have to lock at or before the bout starts.'
    const rk = parseKg(redKg), bk = parseKg(blueKg)
    if (Number.isNaN(rk) || Number.isNaN(bk) || (rk != null && (rk <= 0 || rk >= 1000)) || (bk != null && (bk <= 0 || bk >= 1000)))
      next.kg = 'Weights are numbers in kg, like 72.5.'
    setErrs(next)
    if (Object.values(next).some(Boolean)) { focusFirstInvalid(e.currentTarget as HTMLElement); return }
    const id = await act.run(async () => must(await supabase.rpc('admin_create_fight', {
      p_red: red, p_blue: blue, p_scheduled_at: s, p_lock_at: l, p_title: title.trim() || null,
      p_red_weight_kg: rk, p_blue_weight_kg: bk, p_bout_order: boutOrder, p_main_event: mainEvent,
    })))
    if (id) {
      toast('Bout booked. Picks open once both fighters say yes.')
      setRed(''); setBlue(''); setRedKg(''); setBlueKg(''); setTitle(''); setBoutOrder(null); setMainEvent(false)
      onCreated()
    }
  }

  const corner = (side: Side, value: string, other: string, kg: string, setKg: (v: string) => void) => {
    const id = `book-${side}`
    const err = errs[side]
    return (
      <div className="field">
        <div className="corner-pick">
          <div className="corner-field">
            <label className={`corner corner--${side} label`} htmlFor={id}>{side === 'red' ? 'Red corner' : 'Blue corner'}</label>
            <Select id={id} name={`${side}_fighter`} value={value} onChange={e => pick(side, e.target.value)}
              aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-err` : undefined}>
              <option value="">Choose…</option>
              {visible.map(f => <option key={f.id} value={f.id} disabled={f.id === other}>{f.nickname}</option>)}
            </Select>
          </div>
          <div>
            <label className="field-label" htmlFor={`${id}-kg`}>Kg</label>
            <Input look="data" id={`${id}-kg`} inputMode="decimal" value={kg} aria-invalid={errs.kg ? true : undefined}
              onChange={e => { setKg(e.target.value.replace(/[^\d.,]/g, '')); clear('kg') }} aria-label={`${side === 'red' ? 'Red' : 'Blue'} corner weight in kg`} />
          </div>
        </div>
        {err && <p className="field-error" id={`${id}-err`} role="alert"><WarningOctagon />{err}</p>}
      </div>
    )
  }

  return (
    <Paper>
      <form className="form form--flush" onSubmit={submit} noValidate aria-labelledby="book-h">
        <h2 id="book-h" className="t-head">Book a bout</h2>
        {corner('red', red, blue, redKg, setRedKg)}
        {corner('blue', blue, red, blueKg, setBlueKg)}
        {errs.kg && <p className="field-error" role="alert"><WarningOctagon />{errs.kg}</p>}
        <Field label={<>Title <span className="opt">(optional)</span></>} hint="Shown above the names, like “Floor 3 grudge match”.">
          <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} name="title" autoComplete="off" />
        </Field>
        <Field label="Bout starts">
          <Input type="datetime-local" value={start} required name="scheduled_at" aria-invalid={errs.time ? true : undefined}
            onChange={e => { setStart(e.target.value); clear('time'); if (!lockTouched) setLock(e.target.value) }} />
        </Field>
        <Field label="Picks lock" hint={lockTouched ? undefined : 'Same as the start unless you change it.'} error={errs.time}>
          <Input type="datetime-local" value={lock} required name="lock_at"
            onChange={e => { setLock(e.target.value); setLockTouched(true); clear('time') }} />
        </Field>
        <div className="field">
          <span className="field-label" id="book-order">Bout order</span>
          <Stepper label="Bout order" value={boutOrder ?? nextBout} min={1} max={99}
            onChange={n => setBoutOrder(n)} format={n => `#${n}`} />
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
        <FormError error={act.error} />
        <Button type="submit" busy={act.busy} busyLabel="Booking">Book the bout</Button>
      </form>
    </Paper>
  )
}

