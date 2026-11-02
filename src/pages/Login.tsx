import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/supabase'
import AuthShell from '../components/landing/AuthShell'
import { ErrorBox, SubmitButton, TextField } from '../components/landing/Field'

/** Only allow same-app relative paths as redirect targets. */
function safeFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') && !from.startsWith('/join')) return from
  return '/app'
}

export default function Login() {
  const { signIn, session } = useAuth()
  const loc = useLocation()
  const navigate = useNavigate()
  const from = safeFrom(loc.state)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (session && !busy) return <Navigate to={from} replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    const u = username.trim().toLowerCase()
    if (!u || !password) { setError('Enter your username and password.'); return }
    setBusy(true)
    try {
      await signIn(u, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <AuthShell
      kicker="Members only"
      title={<>Back in the <span className="text-red">ring</span></>}
      footer={<>No account yet? <Link to="/join" className="inline-flex min-h-11 items-center px-1 font-semibold text-gold">Got an invite? Join</Link></>}
    >
      <title>Log in · UoS Fight Night</title>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField label="Username" prefix="@" name="username" value={username}
          onChange={e => setUsername(e.target.value.replace(/\s+/g, '').toLowerCase())}
          autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          placeholder="your_name" maxLength={20} required autoFocus />
        <TextField label="Password" type="password" name="password" value={password}
          onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <ErrorBox>{error}</ErrorBox>}
        <SubmitButton busy={busy}>Log in</SubmitButton>
        <p className="text-center text-xs text-muted">
          Forgot your password? There's no email on file, so ask an admin to reset it.
        </p>
      </form>
    </AuthShell>
  )
}
