import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/supabase'
import AuthShell from '../components/landing/AuthShell'
import { Button, Field, Input, PasswordInput, Poster } from '../components/ui'

/** Only allow same-app relative paths as redirect targets. */
function safeFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login')) return from
  return '/app'
}

const BAD_LOGIN = 'That username and password don’t match. Check caps lock, or ask an admin to reset your password.'

function loginError(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err ?? '')
  if (/invalid login credentials|invalid_credentials/i.test(msg)) return BAD_LOGIN
  return friendlyError(err)
}

type Errs = { username?: string; password?: string }

export default function Login() {
  const { signIn, session } = useAuth()
  const loc = useLocation()
  const navigate = useNavigate()
  const from = safeFrom(loc.state)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState<Errs>({})
  const userRef = useRef<HTMLInputElement>(null)
  const passRef = useRef<HTMLInputElement>(null)

  if (session && !busy) return <Navigate to={from} replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const u = username.trim().toLowerCase()
    if (!u) { setErrs({ username: 'Enter your username.' }); userRef.current?.focus(); return }
    if (!password) { setErrs({ password: 'Enter your password.' }); passRef.current?.focus(); return }
    setErrs({})
    setBusy(true)
    try {
      await signIn(u, password)
      navigate(from, { replace: true })
    } catch (err) {
      setErrs({ password: loginError(err) })
      setBusy(false)
      passRef.current?.focus()
    }
  }

  return (
    <AuthShell after={<>No account yet? There’s no sign-up. Ask an admin to make you one.</>}>
      <title>Log in · UoS Fight Night</title>
      <Poster as="section" className="login" tilt="-.9deg" aria-labelledby="login-h">
        <h1 id="login-h" className="t-title">Log in</h1>
        <p className="t-help c-2">Use the username and password an admin gave you.</p>
        <form onSubmit={onSubmit} noValidate>
          <Field label="Username" error={errs.username}>
            <Input ref={userRef} name="username" value={username}
              onChange={e => { setUsername(e.target.value.replace(/\s+/g, '').toLowerCase()); if (errs.username) setErrs({}) }}
              autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              maxLength={20} required autoFocus />
          </Field>
          <Field label="Password" error={errs.password}>
            <PasswordInput ref={passRef} name="password" value={password}
              onChange={e => { setPassword(e.target.value); if (errs.password) setErrs({}) }}
              autoComplete="current-password" required />
          </Field>
          <Button type="submit" busy={busy} busyLabel="Logging in">Log in</Button>
        </form>
      </Poster>
    </AuthShell>
  )
}
