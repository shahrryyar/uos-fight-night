/**
 * Custom title request (C6, request_title). A form, so it lives on paper. Two steps, no modal:
 * write it, then a review line that names the cost ("Send for 500 pts"). The latest request's state sits
 * on top: waiting / approved / turned down (points came back, unless a season reset had already covered them). One stamp on this sheet at most.
 */
import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDay } from '../../lib/hooks'
import { fmtNum } from '../../lib/copy'
import { CUSTOM_TITLE_MAX, CUSTOM_TITLE_RE, type TitleRequest as Req } from '../../lib/types'
import { Button, Field, FieldError, Input, Paper, Stamp } from '../ui'
import { shopError } from './shopCopy'

interface Props {
  price: number
  balance: number | null
  latest: Req | null
  /** a turned-down request's points really came back (false after a season reset absorbed them) */
  refunded: boolean
  /** an approved custom title is already owned (asking again replaces it) */
  hasCustom: boolean
  onSent: (title: string) => void
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')

export default function TitleRequest({ price, balance, latest, refunded, hasCustom, onSent }: Props) {
  const hid = useId()
  const [text, setText] = useState('')
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)
  const pending = latest?.status === 'pending'
  const t = clean(text)
  const short = balance != null ? price - balance : 0

  const check = (e: FormEvent) => {
    e.preventDefault()
    if (!t) { setErr('Write the title you want.'); focusInput(); return }
    if (!CUSTOM_TITLE_RE.test(t)) { setErr("Use up to 24 letters, numbers, spaces or ' . , ! ? & -"); focusInput(); return }
    setErr(null); setFormErr(null); setReview(true)
  }
  const focusInput = () => requestAnimationFrame(() => document.getElementById(`${hid}-in`)?.focus())

  const send = async () => {
    setBusy(true); setFormErr(null)
    const r = await supabase.rpc('request_title', { p_title: t })
    setBusy(false)
    if (r.error) { setFormErr(shopError(r.error)); return }
    setText(''); setReview(false)
    onSent(t)
  }

  return (
    <Paper as="section" className="shop-req" aria-labelledby={`${hid}-h`}>
      <div className="shop-req-top">
        <h3 id={`${hid}-h`} className="t-sub">Your own title</h3>
        {pending && <Stamp tone="ink" size="sm" rot={-3} land stateKey={latest?.id}>Waiting</Stamp>}
        {latest?.status === 'rejected' && <Stamp tone="ink" size="sm" rot={2}>Turned down</Stamp>}
      </div>

      {latest && <Status r={latest} refunded={refunded} />}

      {!pending && (
        review ? (
          <div className="shop-req-review" role="group" aria-label="Check your title">
            <p className="t-body">Send <b>“{t}”</b> to an admin for <b className="nowrap">{fmtNum(price)}&nbsp;pts</b>?</p>
            <p className="t-help c-2">The points go now. If an admin turns it down this season, all {fmtNum(price)} come back to you.</p>
            <div className="shop-req-actions">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReview(false)}>Edit</Button>
              <Button size="sm" busy={busy} busyLabel="Sending" onClick={() => void send()}>Send for {fmtNum(price)}&nbsp;pts</Button>
            </div>
            {formErr && <FieldError>{formErr}</FieldError>}
          </div>
        ) : (
          <form noValidate onSubmit={check} className="shop-req-form">
            <p className="t-help c-2">
              {hasCustom ? 'Want a different one? Ask again. ' : ''}
              An admin reads every title before it shows. {fmtNum(price)} pts, and they come back if it's turned down.
            </p>
            <Field label="Title" id={`${hid}-in`} error={err ?? undefined}
              hint={<span className="data">{t.length} of {CUSTOM_TITLE_MAX}</span>}>
              <Input name="custom_title" maxLength={CUSTOM_TITLE_MAX} autoComplete="off" spellCheck={false}
                placeholder="The Couch Commando" value={text}
                onChange={e => { setText(e.target.value); if (err) setErr(null) }} />
            </Field>
            {short > 0
              ? <p className="t-help"><b>{fmtNum(short)} more pts</b> and you can send one.</p>
              : <Button type="submit" variant="ink">Check my title</Button>}
          </form>
        )
      )}
    </Paper>
  )
}

function Status({ r, refunded }: { r: Req; refunded: boolean }) {
  if (r.status === 'pending') {
    return <p className="t-body shop-req-status"><b>“{r.title}”</b> is with an admin since {fmtDay(r.created_at)}. It shows next to your name once it's approved.</p>
  }
  if (r.status === 'approved') {
    return <p className="t-body shop-req-status"><b>“{r.title}”</b> was approved. You'll find it in your titles above.</p>
  }
  return (
    <div className="shop-req-status">
      <p className="t-body"><b>“{r.title}”</b> was turned down.{' '}
        {refunded ? <>Your {fmtNum(r.price)}&nbsp;pts came back.</> : r.price > 0 ? <>The new season already put you back on 1000, so no extra points came back.</> : null}
      </p>
      {r.decision_note?.trim() && <p className="t-help c-2">Admin note: “{r.decision_note.trim()}”</p>}
    </div>
  )
}
