import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDelta, fmtNum, LEDGER_REASON } from '../../lib/copy'
import type { Balance } from '../../lib/types'
import { ArrowRight, Button, Check, Field, Input, Loading, Paper, Seg, Select, Stepper, Warning, useToast } from '../../components/ui'
import { FieldGroup, FormError, LoadError, SectionHead } from '../../components/admin/ui'
import { focusFirstInvalid, must, useAction } from '../../components/admin/adminUtils'

const QUICK = [-100, -50, 50, 100, 250]
const LIMIT = 100_000

/** Points (DESIGN 11.16): a signed amount stepper and a required reason, then an inline check step.
 *  Taking points is destructive, so its final button is .btn--danger. admin_adjust_points unchanged. */
export default function AdminPoints() {
  const toast = useToast()
  const [people, setPeople] = useState<Balance[]>([])
  const [loaded, setLoaded] = useState(false)
  const [userId, setUserId] = useState('')
  const [delta, setDelta] = useState(0)
  const [note, setNote] = useState('')
  const [review, setReview] = useState(false)
  const [errs, setErrs] = useState<Partial<Record<'who' | 'delta' | 'note', string>>>({})
  const load = useAction()
  const loadRun = load.run
  const act = useAction()

  const refresh = useCallback(() => loadRun(async () => {
    const [b, p] = await Promise.all([
      supabase.from('balances').select('*'),
      supabase.from('profiles').select('id, username, display_name'),
    ])
    const names = Object.fromEntries((must(p) as { id: string; username: string; display_name: string | null }[])
      .map(x => [x.id, x.display_name?.trim() || x.username]))
    setPeople((must(b) as Balance[]).map(x => ({ ...x, username: names[x.user_id] ?? x.username }))
      .sort((x, y) => x.username.localeCompare(y.username)))
    setLoaded(true)
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  const who = people.find(p => p.user_id === userId)
  const after = who ? who.balance + delta : 0

  const check = (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errs = {}
    if (!who) next.who = 'Choose a member.'
    if (delta === 0) next.delta = 'Set an amount above or below zero.'
    else if (Math.abs(delta) > LIMIT) next.delta = `Keep it under ${fmtNum(LIMIT)} points.`
    if (!note.trim()) next.note = 'Say why. It shows in the admin log.'
    setErrs(next)
    if (Object.values(next).some(Boolean)) { focusFirstInvalid(e.currentTarget as HTMLElement); return }
    act.setError(null)
    setReview(true)
  }

  const apply = async () => {
    if (!who) return
    const r = await act.run(async () => { must(await supabase.rpc('admin_adjust_points', { p_user_id: who.user_id, p_delta: delta, p_note: note.trim() })); return true })
    if (r) {
      toast(delta > 0 ? `Gave ${who.username} ${fmtNum(delta)} pts.` : `Took ${fmtNum(-delta)} pts from ${who.username}.`)
      setDelta(0); setNote(''); setReview(false)
      void refresh()
    }
  }

  return (
    <section className="adm-section" aria-labelledby="pts-h">
      <SectionHead id="pts-h" title="Change points" sub={<>Every change is logged and shows in the member's points log as “{LEDGER_REASON.admin_adjust}”.</>} />
      <LoadError error={load.error} what="members" onRetry={() => void refresh()} busy={load.busy} />
      {!loaded && !load.error && <Loading label="Loading members…" />}
      {loaded && (
        <Paper>
          {!review ? (
            <form className="form form--flush" onSubmit={check} noValidate aria-labelledby="pts-h">
              <Field label="Member" error={errs.who}
                hint={who ? <>Has <b className="nowrap">{fmtNum(who.balance)}&nbsp;pts</b> now.</> : undefined}>
                <Select name="member" value={userId} onChange={e => { setUserId(e.target.value); setErrs(x => ({ ...x, who: undefined })) }}>
                  <option value="">Choose a member…</option>
                  {people.map(p => <option key={p.user_id} value={p.user_id}>{p.username}</option>)}
                </Select>
              </Field>
              <FieldGroup label="Amount" error={errs.delta}
                hint={who && delta !== 0 ? <>Leaves them on <b className="nowrap">{fmtNum(after)}&nbsp;pts</b>{after < 0 ? ', below zero' : ''}.</> : 'Plus gives points, minus takes them.'}>
                <Stepper label="Points" value={delta} min={-LIMIT} max={LIMIT} step={10}
                  onChange={n => { setDelta(n); setErrs(x => ({ ...x, delta: undefined })) }} format={n => fmtDelta(n)} />
                <div className="segs quick" role="group" aria-label="Quick amounts">
                  {QUICK.map(q => (
                    <Seg key={q} pressed={delta === q} onClick={() => { setDelta(q); setErrs(x => ({ ...x, delta: undefined })) }}
                      aria-label={q > 0 ? `Give ${q}` : `Take ${-q}`}>{fmtDelta(q)}</Seg>
                  ))}
                </div>
              </FieldGroup>
              <Field label="Reason" hint="Goes in the admin log, like “Won the push-up challenge”." error={errs.note}>
                <Input value={note} maxLength={200} name="reason" autoComplete="off"
                  onChange={e => { setNote(e.target.value); setErrs(x => ({ ...x, note: undefined })) }} />
              </Field>
              <Button type="submit" variant="ink">Check change</Button>
            </form>
          ) : who && (
            <section className="form form--flush review" aria-labelledby="pts-ck">
              <h3 id="pts-ck" className="t-sub">Check before you apply</h3>
              <p className="t-score" style={{ fontSize: '4rem' }}>{fmtDelta(delta)}</p>
              <p className="t-sub"><bdi>{who.username}</bdi></p>
              <ul role="list">
                <li><ArrowRight /><span className="data"><b>{fmtNum(who.balance)}</b> to <b>{fmtNum(after)}</b> pts</span></li>
                <li><Check /><span>Reason: <q>{note.trim()}</q></span></li>
                {after < 0 && <li><Warning /><span><b>This puts them below zero.</b></span></li>}
              </ul>
              <FormError error={act.error} />
              <div className="actions">
                <Button variant="ghost" onClick={() => setReview(false)} disabled={act.busy}>Edit</Button>
                <Button variant={delta < 0 ? 'danger' : 'primary'} onClick={apply} busy={act.busy} busyLabel="Applying">
                  {delta > 0 ? `Give ${fmtNum(delta)} pts` : `Take ${fmtNum(-delta)} pts`}
                </Button>
              </div>
            </section>
          )}
        </Paper>
      )}
    </section>
  )
}
