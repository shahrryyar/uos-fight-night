import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { friendlyError, USERNAME_RE } from '../lib/supabase'
import AuthShell from '../components/landing/AuthShell'
import { ErrorBox, SubmitButton, TextField } from '../components/landing/Field'

const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32)
const cleanUsername = (s: string) => s.replace(/\s+/g, '').toLowerCase().slice(0, 20)

function usernameStatus(u: string): { tone: 'neutral' | 'ok' | 'bad'; msg: string } {
  if (!u) return { tone: 'neutral', msg: '3–20 characters: a–z, 0–9 and _' }
  if (/[^a-z0-9_]/.test(u)) return { tone: 'bad', msg: 'Only a–z, 0–9 and _ allowed' }
  if (u.length < 3) return { tone: 'bad', msg: `${3 - u.length} more character${u.length === 2 ? '' : 's'} needed` }
  if (USERNAME_RE.test(u)) return { tone: 'ok', msg: `You'll be @${u}` }
  return { tone: 'bad', msg: '3–20 characters: a–z, 0–9 and _' }
}

function joinError(e: unknown): string {
  const raw = (e as { message?: string })?.message ?? ''
  if (/already (registered|exists)/i.test(raw)) return 'That username is taken.'
  const msg = friendlyError(e)
  if (/invite/i.test(msg)) return 'That invite code is not valid. It may be used up, expired or revoked.'
  return msg
}

export default function Join() {
  const { signUp, session } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [code, setCode] = useState(() => cleanCode(params.get('code') ?? ''))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uStatus = useMemo(() => usernameStatus(username), [username])
  const pwOk = password.length >= 8
  const matchOk = confirm.length > 0 && confirm === password
  const codeOk = code.length >= 4
  const canSubmit = codeOk && uStatus.tone === 'ok' && pwOk && matchOk && agree

  if (session && !busy) return <Navigate to="/app" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (busy || !canSubmit) return
    setError(null)
    setBusy(true)
    try {
      await signUp(username, password, code)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(joinError(err))
      setBusy(false)
    }
  }

  return (
    <AuthShell
      kicker="Invite only · 18+"
      title={<>Step into the <span className="text-gold">arena</span></>}
      footer={<>Already a member? <Link to="/login" className="inline-flex min-h-11 items-center px-1 font-semibold text-gold">Log in</Link></>}
    >
      <title>Join · UoS Fight Night</title>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField label="Invite code" name="invite" value={code}
          onChange={e => setCode(cleanCode(e.target.value))}
          autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          placeholder="ABCD2345" required
          tone={touched && !codeOk ? 'bad' : code && codeOk ? 'ok' : 'neutral'}
          hint={touched && !codeOk ? 'Enter the code an admin gave you.' : 'From the invite link or an admin.'} />

        <TextField label="Username" prefix="@" name="username" value={username}
          onChange={e => setUsername(cleanUsername(e.target.value))}
          autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          placeholder="your_name" maxLength={20} required
          tone={uStatus.tone === 'neutral' && touched ? 'bad' : uStatus.tone} hint={uStatus.msg} />

        <TextField label="Password" type="password" name="new-password" value={password}
          onChange={e => setPassword(e.target.value)} autoComplete="new-password" required
          tone={password ? (pwOk ? 'ok' : 'bad') : touched ? 'bad' : 'neutral'}
          hint={password && !pwOk ? `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed` : 'At least 8 characters.'} />

        <TextField label="Confirm password" type="password" name="confirm-password" value={confirm}
          onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required
          tone={confirm ? (matchOk ? 'ok' : 'bad') : touched ? 'bad' : 'neutral'}
          hint={confirm && !matchOk ? "Passwords don't match." : confirm && matchOk ? 'Match.' : undefined} />

        <div className="rounded-xl border border-gold/30 bg-gold/5 px-3.5 py-3 text-xs text-bone/85">
          <strong className="text-gold">No email needed.</strong> Remember your password: there's no reset email.
          If you forget it, an admin can reset it for you.
        </div>

        <label className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 ${touched && !agree ? 'border-red/80' : 'border-line'}`}>
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#d7192a]" required />
          <span className="text-sm text-bone/90">I'm 18+ and I understand points have no cash value.</span>
        </label>

        {error && <ErrorBox>{error}</ErrorBox>}
        <SubmitButton busy={busy} disabled={touched && !canSubmit}>Join the league</SubmitButton>
      </form>
    </AuthShell>
  )
}
