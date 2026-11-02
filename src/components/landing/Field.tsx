import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'

type Tone = 'neutral' | 'ok' | 'bad'
interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  hint?: ReactNode
  tone?: Tone
  prefix?: string
}

const ring: Record<Tone, string> = {
  neutral: 'border-line focus-within:border-gold/70',
  ok: 'border-gold/60',
  bad: 'border-red/80',
}
const hintColor: Record<Tone, string> = { neutral: 'text-muted', ok: 'text-gold', bad: 'text-red' }

export function TextField({ label, hint, tone = 'neutral', prefix, type = 'text', ...rest }: Props) {
  const id = useId()
  const [reveal, setReveal] = useState(false)
  const isPw = type === 'password'
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-bone/80">{label}</label>
      <div className={`flex min-h-12 items-center rounded-xl border bg-ink/70 transition ${ring[tone]}`}>
        {prefix && <span className="pl-3.5 text-muted" aria-hidden>{prefix}</span>}
        <input id={id} type={isPw && reveal ? 'text' : type}
          aria-invalid={tone === 'bad' || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`h-12 w-full min-w-0 bg-transparent text-base text-bone outline-none placeholder:text-muted/60 ${prefix ? 'pl-1' : 'pl-3.5'} ${isPw ? 'pr-1' : 'pr-3.5'}`}
          {...rest} />
        {isPw && (
          <button type="button" onClick={() => setReveal(r => !r)}
            className="h-12 min-w-14 shrink-0 px-3 text-xs font-bold uppercase tracking-wider text-muted hover:text-bone"
            aria-label={reveal ? 'Hide password' : 'Show password'} aria-pressed={reveal}>
            {reveal ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {hint && <p id={`${id}-hint`} className={`mt-1.5 text-xs ${hintColor[tone]}`}>{hint}</p>}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red/60 bg-red/10 px-3.5 py-3 text-sm text-bone">
      <span aria-hidden className="mt-px font-display text-lg leading-none text-red">!</span>
      <span>{children}</span>
    </div>
  )
}

export function SubmitButton({ busy, disabled, children }: { busy?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy || disabled}
      className="relative flex min-h-13 w-full items-center justify-center overflow-hidden rounded-xl bg-red px-5 py-3 font-display text-2xl tracking-[0.12em] text-bone shadow-[0_10px_30px_-10px_rgba(215,25,42,.8)] transition active:scale-[0.99] hover:bg-[#e52536] disabled:cursor-not-allowed disabled:bg-red-dark/70 disabled:text-bone/60 disabled:shadow-none">
      {busy ? 'Hold on…' : children}
    </button>
  )
}
