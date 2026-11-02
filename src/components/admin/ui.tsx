import { useCallback, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
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

/**
 * Captioned form field. Default wraps a single input/select in a <label>.
 * Pass `group` when the field holds buttons (toggles, segmented choices, steppers): a <label>
 * would forward caption taps to its first button and fold the caption into each button's name,
 * so groups render as <div role="group" aria-labelledby> instead.
 */
export function Field({ label, hint, group, children }: { label: string; hint?: ReactNode; group?: boolean; children: ReactNode }) {
  const id = useId()
  const caption = 'block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5'
  const hintEl = hint && <span className="block text-xs text-muted mt-1">{hint}</span>
  if (group) {
    return (
      <div className="block" role="group" aria-labelledby={`${id}-cap`}>
        <span id={`${id}-cap`} className={caption}>{label}</span>
        {children}
        {hintEl}
      </div>
    )
  }
  return (
    <label className="block">
      <span className={caption}>{label}</span>
      {children}
      {hintEl}
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

/** Asia/Baghdad calendar date (YYYY-MM-DD) of an ISO timestamp — mirrors fights.card_date. */
export function cardDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export function fmtCardDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day, 12)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** 10-char password from an unambiguous alphabet, crypto-random. */
export function generatePassword(len = 10): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const out: string[] = []
  const buf = new Uint32Array(len * 2)
  const limit = Math.floor(0x1_0000_0000 / abc.length) * abc.length
  while (out.length < len) {
    crypto.getRandomValues(buf)
    for (const n of buf) {
      if (n < limit) out.push(abc[n % abc.length])
      if (out.length === len) break
    }
  }
  return out.join('')
}

/** Pull a readable message (often an error code) out of a FunctionsHttpError response body. */
export async function functionError(err: unknown): Promise<Error> {
  const ctx = (err as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json() as { error?: string; message?: string; code?: string }
      const m = body?.code ?? body?.error ?? body?.message
      if (m) return new Error(body.error && body.code && body.error !== body.code ? `${body.code}: ${body.error}` : m)
    } catch { /* not json */ }
  }
  return err instanceof Error ? err : new Error(String(err))
}

/** Parse a weight input ("72.5") → number | null. */
export function parseKg(v: string): number | null {
  const t = v.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN
}

/** − value + stepper with ≥44px targets. */
export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const btn = 'min-h-12 min-w-12 rounded-lg border border-line bg-surface-2 font-display text-2xl text-bone disabled:opacity-40'
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <output className="min-w-12 text-center font-display text-3xl tabular-nums" aria-live="polite">{value}</output>
      <button type="button" className={btn} aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  )
}
