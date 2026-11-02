import { useCallback, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { friendlyError } from '../../lib/supabase'

/* ---------- layout ---------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>{children}</section>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <h2 className="font-display text-3xl tracking-wider leading-none">{children}</h2>
      {right}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full min-h-12 rounded-lg bg-surface-2 border border-line px-3 text-base text-bone placeholder:text-muted/70 ' +
  'focus:border-gold focus:outline-none [color-scheme:dark] disabled:opacity-50'

/* ---------- buttons ---------- */

type Variant = 'red' | 'blue' | 'gold' | 'ghost' | 'danger'
const variantCls: Record<Variant, string> = {
  red: 'bg-red text-bone hover:bg-red-dark',
  blue: 'bg-blue text-bone hover:bg-blue-dark',
  gold: 'bg-gold text-ink hover:brightness-110',
  ghost: 'bg-surface-2 border border-line text-bone hover:border-muted',
  danger: 'bg-transparent border border-red/70 text-red hover:bg-red/10',
}

export function Btn({ variant = 'ghost', busy, className = '', children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={`min-h-11 rounded-lg px-4 font-semibold tracking-wide transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none ${variantCls[variant]} ${className}`}
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

/* ---------- messages ---------- */

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null
  return <p role="alert" className="rounded-lg border border-red/60 bg-red/10 px-3 py-2 text-sm text-bone">{error}</p>
}

export function OkBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p role="status" className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm text-gold">{children}</p>
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'red' | 'blue' | 'gold' }) {
  const t = {
    muted: 'border-line text-muted',
    red: 'border-red/60 text-red',
    blue: 'border-blue/60 text-blue',
    gold: 'border-gold/60 text-gold',
  }[tone]
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${t}`}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">{children}</p>
}

/* ---------- async action helper ---------- */

/** Wraps an async action with busy + friendly error state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null)
    try { return await fn() }
    catch (e) { setError(friendlyError(e)); return undefined }
    finally { setBusy(false) }
  }, [])
  return { busy, error, setError, run }
}

/** Throws the supabase error if present so useAction can catch it. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

/* ---------- confirm dialog ---------- */

interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; variant?: Variant }

/** Returns [dialogElement, ask]. `await ask({...})` resolves true/false. */
export function useConfirm(): [ReactNode, (o: ConfirmOpts) => Promise<boolean>] {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(res => { resolver.current = res; setOpts(o) }), [])
  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null) }
  const el = opts && (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-ink/80 backdrop-blur-sm p-4"
      role="dialog" aria-modal="true" aria-label={opts.title} onClick={() => close(false)}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-3xl tracking-wider mb-3">{opts.title}</h3>
        {opts.body && <div className="text-sm text-bone/90 space-y-2 mb-5">{opts.body}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Btn onClick={() => close(false)}>Back</Btn>
          <Btn variant={opts.variant ?? 'red'} onClick={() => close(true)} autoFocus>{opts.confirmLabel ?? 'Confirm'}</Btn>
        </div>
      </div>
    </div>
  )
  return [el, ask]
}

/* ---------- misc helpers ---------- */

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true }
  catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy')
      ta.remove(); return ok
    } catch { return false }
  }
}

/** Date → value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** datetime-local value → ISO string (null if empty/invalid). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
