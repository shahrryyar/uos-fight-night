import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Balance } from '../../lib/types'
import { Btn, Card, ErrorBox, Field, OkBox, SectionTitle, inputCls, must, useAction, useConfirm } from '../../components/admin/ui'

const QUICK = [-100, -50, 50, 100, 250]

export default function AdminPoints() {
  const [people, setPeople] = useState<Balance[]>([])
  const [userId, setUserId] = useState('')
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [ok, setOk] = useState('')
  const load = useAction()
  const loadRun = load.run
  const act = useAction()
  const [dialog, confirm] = useConfirm()

  const refresh = useCallback(() => loadRun(async () => {
    const [b, p] = await Promise.all([
      supabase.from('balances').select('*'),
      supabase.from('profiles').select('id, username, display_name'),
    ])
    const names = Object.fromEntries((must(p) as { id: string; username: string; display_name: string | null }[])
      .map(x => [x.id, x.display_name?.trim() || x.username]))
    setPeople((must(b) as Balance[]).map(x => ({ ...x, username: names[x.user_id] ?? x.username }))
      .sort((x, y) => x.username.localeCompare(y.username)))
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  const who = people.find(p => p.user_id === userId)
  const n = Number(delta)
  const valid = delta.trim() !== '' && Number.isInteger(n) && n !== 0

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setOk('')
    if (!who) return act.setError('Pick a member.')
    if (!valid) return act.setError('Enter a whole number, e.g. 100 or -50.')
    if (Math.abs(n) > 100_000) return act.setError('That is a lot of points. Keep it under 100,000.')
    if (!note.trim()) return act.setError('Add a short note — it shows in the admin log.')
    const after = who.balance + n
    const yes = await confirm({
      title: n > 0 ? 'Give points?' : 'Take points?',
      variant: n > 0 ? 'gold' : 'red',
      confirmLabel: n > 0 ? `Give ${n}` : `Take ${-n}`,
      body: (
        <>
          <p><b>{who.username}</b>: {who.balance.toLocaleString()} → <b className={after < 0 ? 'text-red' : 'text-gold'}>{after.toLocaleString()}</b> points</p>
          <p className="text-muted">“{note.trim()}”</p>
          {after < 0 && <p className="text-red">This puts them below zero.</p>}
        </>
      ),
    })
    if (!yes) return
    const r = await act.run(async () => { must(await supabase.rpc('admin_adjust_points', { p_user_id: who.user_id, p_delta: n, p_note: note.trim() })); return true })
    if (r) {
      setOk(`${n > 0 ? '+' : ''}${n} points for ${who.username}.`)
      setDelta(''); setNote('')
      void refresh()
    }
  }

  return (
    <Card>
      {dialog}
      <SectionTitle>Adjust points</SectionTitle>
      <p className="text-sm text-muted mb-4">Fun points — no cash value. Every change is logged.</p>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Member">
          <select className={inputCls} value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">Choose member…</option>
            {people.map(p => <option key={p.user_id} value={p.user_id}>{p.username} — {p.balance.toLocaleString()} pts</option>)}
          </select>
        </Field>
        <Field label="Change (+ give / − take)">
          <input className={`${inputCls} font-display text-3xl tracking-wide`} inputMode="numeric" placeholder="+100"
            value={delta} onChange={e => setDelta(e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, ''))} />
        </Field>
        <div className="grid grid-cols-5 gap-1.5">
          {QUICK.map(q => (
            <button key={q} type="button" onClick={() => setDelta(String(q))}
              className={`min-h-11 rounded-lg border text-sm font-bold ${q < 0 ? 'border-red/50 text-red' : 'border-gold/50 text-gold'}`}>
              {q > 0 ? `+${q}` : q}
            </button>
          ))}
        </div>
        <Field label="Note">
          <input className={inputCls} value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="Won the push-up challenge" />
        </Field>
        <ErrorBox error={act.error ?? load.error} />
        <OkBox>{ok}</OkBox>
        <Btn type="submit" variant={n < 0 ? 'red' : 'gold'} busy={act.busy} className="w-full min-h-12 font-display text-2xl tracking-widest">
          Apply
        </Btn>
      </form>
    </Card>
  )
}
