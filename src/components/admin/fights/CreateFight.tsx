import { useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import type { Fighter, Side } from '../../../lib/types'
import type { AdminFight } from '../fightTypes'
import {
  Btn, Card, ErrorBox, Field, OkBox, SectionTitle,
  cardDateOf, fmtCardDate, fromLocalInput, inputCls, must, parseKg, toLocalInput, useAction,
} from '../ui'

function defaultStart() {
  const d = new Date(Date.now() + 24 * 3600_000)
  d.setHours(21, 0, 0, 0)
  return toLocalInput(d)
}

interface Props { fighters: Fighter[]; cardFights: AdminFight[]; onCreated: () => void }

export default function CreateFight({ fighters, cardFights, onCreated }: Props) {
  const [red, setRed] = useState('')
  const [blue, setBlue] = useState('')
  const [redKg, setRedKg] = useState('')
  const [blueKg, setBlueKg] = useState('')
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [lock, setLock] = useState(defaultStart)
  const [lockTouched, setLockTouched] = useState(false)
  const [boutOrder, setBoutOrder] = useState('')
  const [mainEvent, setMainEvent] = useState(false)
  const [ok, setOk] = useState('')
  const act = useAction()

  const visible = fighters.filter(f => !f.hidden)
  const startIso = fromLocalInput(start)
  const cardDate = startIso ? cardDateOf(startIso) : null
  const onCard = cardDate ? cardFights.filter(f => f.card_date === cardDate && f.status !== 'cancelled') : []
  const existingMain = onCard.find(f => f.is_main_event)
  const nextBout = onCard.reduce((m, f) => Math.max(m, f.bout_order ?? 0), 0) + 1

  const pick = (side: Side, id: string) => {
    const f = fighters.find(x => x.id === id)
    const kg = f?.weight_kg != null ? String(f.weight_kg) : ''
    if (side === 'red') { setRed(id); setRedKg(kg) } else { setBlue(id); setBlueKg(kg) }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setOk('')
    if (!red || !blue) return act.setError('Pick both corners.')
    if (red === blue) return act.setError('A fighter cannot fight themselves.')
    const s = fromLocalInput(start), l = fromLocalInput(lock)
    if (!s || !l) return act.setError('Set a valid fight time and lock time.')
    if (new Date(l) > new Date(s)) return act.setError('Picks should lock at or before the fight time.')
    const rk = parseKg(redKg), bk = parseKg(blueKg)
    if (Number.isNaN(rk) || Number.isNaN(bk) || (rk != null && (rk <= 0 || rk >= 1000)) || (bk != null && (bk <= 0 || bk >= 1000)))
      return act.setError('Weights must be numbers in kg, e.g. 72.5.')
    const bo = boutOrder.trim() ? Number(boutOrder) : null
    if (bo != null && (!Number.isInteger(bo) || bo < 1 || bo > 99)) return act.setError('Bout order must be a whole number from 1.')
    const id = await act.run(async () => must(await supabase.rpc('admin_create_fight', {
      p_red: red, p_blue: blue, p_scheduled_at: s, p_lock_at: l, p_title: title.trim() || null,
      p_red_weight_kg: rk, p_blue_weight_kg: bk, p_bout_order: bo, p_main_event: mainEvent,
    })))
    if (id) {
      setOk('Fight booked. Picks open once both fighters accept — or force it open below.')
      setRed(''); setBlue(''); setRedKg(''); setBlueKg(''); setTitle(''); setBoutOrder(''); setMainEvent(false)
      onCreated()
    }
  }

  const corner = (side: Side, value: string, other: string, kg: string, setKg: (v: string) => void) => (
    <div className="grid grid-cols-[1fr_6.5rem] gap-2">
      <Field label={side === 'red' ? 'Red corner' : 'Blue corner'}>
        <select value={value} onChange={e => pick(side, e.target.value)}
          className={`${inputCls} border-l-4 ${side === 'red' ? 'border-l-red' : 'border-l-blue'}`}>
          <option value="">Choose fighter…</option>
          {visible.map(f => <option key={f.id} value={f.id} disabled={f.id === other}>{f.nickname}</option>)}
        </select>
      </Field>
      <Field label="Weight kg">
        <input className={inputCls} inputMode="decimal" placeholder="—" value={kg}
          onChange={e => setKg(e.target.value.replace(/[^\d.,]/g, ''))} aria-label={`${side} corner weight in kg`} />
      </Field>
    </div>
  )

  return (
    <Card>
      <SectionTitle>Book a fight</SectionTitle>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {corner('red', red, blue, redKg, setRedKg)}
          {corner('blue', blue, red, blueKg, setBlueKg)}
        </div>
        <Field label="Title (optional)">
          <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="Floor 3 grudge match…" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Fight time">
            <input type="datetime-local" className={inputCls} value={start} required
              onChange={e => { setStart(e.target.value); if (!lockTouched) setLock(e.target.value) }} />
          </Field>
          <Field label="Picks lock at" hint={lockTouched ? undefined : 'Defaults to fight time'}>
            <input type="datetime-local" className={inputCls} value={lock} required
              onChange={e => { setLock(e.target.value); setLockTouched(true) }} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bout order" hint={cardDate ? `Blank = #${nextBout} on ${fmtCardDate(cardDate)}` : 'Blank = next on the card'}>
            <input className={inputCls} inputMode="numeric" placeholder={String(nextBout)} value={boutOrder}
              onChange={e => setBoutOrder(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </Field>
          <Field label="Main event" group>
            <button type="button" onClick={() => setMainEvent(v => !v)} aria-pressed={mainEvent}
              className={`w-full min-h-12 rounded-lg border-2 font-bold uppercase tracking-wider text-sm ${
                mainEvent ? 'bg-gold border-gold text-ink' : 'border-line text-muted'}`}>
              {mainEvent ? '★ Main event' : 'Undercard'}
            </button>
          </Field>
        </div>
        {mainEvent && existingMain && (
          <p className="text-xs text-gold">
            This card already has a main event. Switch it in Card order below first, or this booking will be refused.
          </p>
        )}
        <ErrorBox error={act.error} />
        <OkBox>{ok}</OkBox>
        <Btn type="submit" variant="red" busy={act.busy} className="w-full min-h-12 font-display text-2xl tracking-widest">
          Book it
        </Btn>
      </form>
    </Card>
  )
}
