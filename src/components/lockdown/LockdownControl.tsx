/**
 * C1 admin side: the panic button (admin header, every tab) and the "LOCKDOWN ON" banner that runs
 * across every page for admins while it is on. Turning it on asks first and takes an optional
 * message for the maintenance page; turning it off asks too. Both call admin_set_lockdown.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../lib/auth'
import { LOCKDOWN_MESSAGE_MAX, lockdownError, setLockdown, useSiteStatusMaybe } from '../../lib/siteStatus'
import { Button, Prohibit, ShieldCheck, WarningOctagon, useToast } from '../ui'
import './lockdown.css'

type Ask = 'on' | 'off' | null

/** [dialog element, open('on' | 'off'), busy] shared by the button and the banner. */
function useLockdownToggle(): [ReactNode, (a: 'on' | 'off') => void] {
  const site = useSiteStatusMaybe()
  const toast = useToast()
  const [ask, setAsk] = useState<Ask>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId().replace(/:/g, '')

  const open = useCallback((a: 'on' | 'off') => { setErr(null); setMessage(''); setAsk(a) }, [])
  const close = useCallback(() => { if (!busy) setAsk(null) }, [busy])
  useEffect(() => { const d = ref.current; if (ask && d && !d.open) d.showModal?.() }, [ask])

  const tooLong = message.trim().length > LOCKDOWN_MESSAGE_MAX
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !ask) return
    if (tooLong) { setErr(`Keep the message under ${LOCKDOWN_MESSAGE_MAX} characters.`); return }
    setBusy(true); setErr(null)
    try {
      const s = await setLockdown(ask === 'on', message)
      site?.apply(s)
      setAsk(null)
      toast(s.lockdown ? 'Lockdown on. Members and visitors see the maintenance page.' : 'Lockdown off. Everyone has the site back.',
        { icon: s.lockdown ? Prohibit : ShieldCheck })
    } catch (x) { setErr(lockdownError(x)) }
    finally { setBusy(false) }
  }

  const dialog = ask && (
    <dialog ref={ref} className="paper ld-dialog" aria-labelledby={`${id}-h`} aria-describedby={`${id}-b`}
      onCancel={e => { e.preventDefault(); close() }}
      onClick={e => { if (e.target === e.currentTarget) close() }}>
      <form onSubmit={submit} noValidate>
        {ask === 'on' ? (
          <>
            <h2 id={`${id}-h`} className="t-head">Lock the site down?</h2>
            <div id={`${id}-b`} className="ld-body">
              <p>Right away, members and visitors only see a plain maintenance page: no logo, no league name, no fights or names.</p>
              <p>Admins keep full access. Nothing is deleted. Turn it off and everything comes back.</p>
              <p className="ld-note">Fighter photo links a member already opened keep working until they expire, up to an hour.</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-m`}>Message <span className="opt">(optional)</span></label>
              <textarea id={`${id}-m`} className="input ld-msg" name="lockdown_message" rows={3} autoComplete="off"
                value={message} onChange={e => { setMessage(e.target.value); setErr(null) }}
                aria-invalid={tooLong || undefined} aria-describedby={`${id}-mh${err ? ` ${id}-e` : ''}`} />
              <p className="field-hint" id={`${id}-mh`}>
                Shown on the maintenance page to anyone who opens the site. Keep it plain.{' '}
                <span className="data nowrap">{message.trim().length}/{LOCKDOWN_MESSAGE_MAX}</span>
              </p>
            </div>
          </>
        ) : (
          <>
            <h2 id={`${id}-h`} className="t-head">Turn lockdown off?</h2>
            <div id={`${id}-b`} className="ld-body">
              <p>Members get the app back and the front page shows again, right away. The maintenance message is cleared.</p>
            </div>
          </>
        )}
        {err && <p className="field-error" id={`${id}-e`} role="alert"><WarningOctagon />{err}</p>}
        <div className="ld-actions">
          <Button variant="ghost" onClick={close}>Back</Button>
          {ask === 'on'
            ? <Button type="submit" icon={Prohibit} busy={busy} busyLabel="Locking">Lock it down</Button>
            : <Button type="submit" variant="ink" icon={ShieldCheck} busy={busy} busyLabel="Turning off">Turn it off</Button>}
        </div>
      </form>
    </dialog>
  )
  return [dialog, open]
}

/** Admin header control: the red panic button, or "Turn off" while the lockdown is on. */
export function LockdownButton() {
  const site = useSiteStatusMaybe()
  const [dialog, open] = useLockdownToggle()
  const on = !!site?.status?.lockdown
  return (
    <>
      {dialog}
      {on
        ? <Button variant="bone" size="sm" icon={ShieldCheck} onClick={() => open('off')} className="ld-btn">Turn off lockdown</Button>
        : <Button size="sm" icon={Prohibit} onClick={() => open('on')} className="ld-btn ld-btn--panic" disabled={!site?.ready}>Lockdown</Button>}
    </>
  )
}

/** Red strip across the top of every page for admins while the lockdown is on. */
export function LockdownBanner() {
  const { isAdmin } = useAuth()
  const site = useSiteStatusMaybe()
  const [dialog, open] = useLockdownToggle()
  if (!site?.status?.lockdown || site.lockedOut || !isAdmin) return null
  const msg = site.status.message
  return (
    <div className="ld-banner" role="region" aria-label="Lockdown">
      {dialog}
      <div className="wrap ld-banner-in">
        <p className="ld-banner-txt">
          <span className="ld-banner-h"><Prohibit />Lockdown on</span>
          <span className="ld-banner-sub">Members and visitors see a maintenance page.{msg ? <> Message: <q>{msg}</q></> : null}</span>
        </p>
        <button type="button" className="ld-banner-off" onClick={() => open('off')}>Turn off</button>
      </div>
    </div>
  )
}
