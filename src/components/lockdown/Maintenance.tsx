/**
 * C1: what members and visitors see while the site is locked down. Deliberately generic: no logo,
 * no league name, no brand fonts, textures or stamps, a plain tab title ("Maintenance") and the
 * shell's plain tab icon (brandHead.ts). A sign-in form (on /login only) lets an admin get back in to lift the lockdown.
 */
import { useEffect, useId, useState, type FormEvent } from 'react'
import { useAuth } from '../../lib/auth'
import { friendlyError } from '../../lib/supabase'
import './lockdown.css'

/**
 * Light theme-color while mounted. The title is a React <title> (hoisted above the neutral shell
 * title); the tab icon, description and manifest are switched by brandHead.ts from the gate.
 */
function useNeutralTheme() {
  useEffect(() => {
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const prevTheme = theme?.content
    if (theme) theme.content = '#f4f4f5'
    return () => { if (theme && prevTheme) theme.content = prevTheme }
  }, [])
}

export default function Maintenance({ message, signIn = false }: { message?: string | null; signIn?: boolean }) {
  const { session } = useAuth()
  useNeutralTheme()
  const showForm = signIn && !session

  return (
    <div className="mnt">
      <title>{showForm ? 'Sign in' : 'Maintenance'}</title>
      <main className="mnt-box" id="main">
        {showForm ? <SignInForm /> : (
          <>
            <h1 className="mnt-h">Down for maintenance</h1>
            <p className="mnt-p">This site is offline for a little while. Check back later.</p>
            {message && <p className="mnt-msg">{message}</p>}
          </>
        )}
        <Foot />
      </main>
    </div>
  )
}

function Foot() {
  const { session, signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  if (session) {
    return (
      <p className="mnt-foot">
        <span>You're signed in.</span>{' '}
        <button type="button" className="mnt-link" disabled={busy} onClick={async () => { setBusy(true); try { await signOut() } finally { setBusy(false) } }}>
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </p>
    )
  }
  return null
}

/** Plain username + password form (same accounts as the normal login). */
function SignInForm() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const uid = useId().replace(/:/g, '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) { setErr('Enter your username and password.'); return }
    setBusy(true); setErr(null)
    try { await signIn(username, password) }
    catch (x) {
      const msg = String((x as { message?: string })?.message ?? '')
      setErr(/invalid login credentials|invalid_credentials/i.test(msg) ? "That username and password don't match." : friendlyError(x))
    } finally { setBusy(false) }
  }

  return (
    <form className="mnt-form" onSubmit={submit} noValidate aria-labelledby={`${uid}-h`}>
      <h1 className="mnt-h" id={`${uid}-h`}>Sign in</h1>
      <label className="mnt-label" htmlFor={`${uid}-u`}>Username</label>
      <input id={`${uid}-u`} className="mnt-input" name="username" autoComplete="username" spellCheck={false} autoCapitalize="none"
        value={username} onChange={e => setUsername(e.target.value)} aria-invalid={err ? true : undefined} aria-describedby={err ? `${uid}-e` : undefined} />
      <label className="mnt-label" htmlFor={`${uid}-p`}>Password</label>
      <input id={`${uid}-p`} className="mnt-input" name="password" type="password" autoComplete="current-password"
        value={password} onChange={e => setPassword(e.target.value)} aria-invalid={err ? true : undefined} aria-describedby={err ? `${uid}-e` : undefined} />
      {err && <p className="mnt-err" id={`${uid}-e`} role="alert">{err}</p>}
      <button type="submit" className="mnt-btn" aria-busy={busy || undefined} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}

/** Neutral first-paint while the status is read: nothing branded, nothing to flash. */
export function MaintenanceWait() {
  return <div className="mnt-wait" role="status" aria-live="polite"><span className="sr-only">Loading</span></div>
}
