/**
 * Admin kit (IMPLEMENTATION D "components/admin/ui.tsx"): thin layer over the foundation primitives in
 * components/ui. Forms live on paper, lists on ink. Errors are inline (FormError on paper, LoadError on ink),
 * confirmations are toasts, and the dialog is kept only for genuinely destructive member actions.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { friendlyError } from '../../lib/supabase'
import { Button, FieldError, Alert, cx, type ButtonVariant } from '../ui'

/* ---------- layout ---------- */

/** Section heading on ink: t-head + optional count and a right-hand control. */
export function SectionHead({ title, count, right, sub, id, as: H = 'h2' }:
  { title: ReactNode; count?: number; right?: ReactNode; sub?: ReactNode; id?: string; as?: 'h2' | 'h3' }) {
  return (
    <>
      <div className="section-head" style={sub ? { marginBottom: 0 } : undefined}>
        <H id={id} className="t-head">{title}{count != null && <span className="count">{count}</span>}</H>
        {right}
      </div>
      {sub && <p className="t-help adm-sub">{sub}</p>}
    </>
  )
}

/**
 * Captioned group of buttons (segments, steppers): fieldset + legend, so the caption names the group
 * without being folded into each button's accessible name.
 */
export function FieldGroup({ label, hint, error, children, className }:
  { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <fieldset className={cx('field', className)} aria-describedby={[hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined}>
      <legend className="field-label">{label}</legend>
      {children}
      {hint && <p id={`${id}-h`} className="field-hint">{hint}</p>}
      {error && <FieldError id={`${id}-e`}>{error}</FieldError>}
    </fieldset>
  )
}

/** Form-level error on paper (server refusals): toner text with the red octagon, role=alert. */
export function FormError({ error }: { error: ReactNode | null | undefined }) {
  if (!error) return null
  return <div className="form-error"><FieldError>{error}</FieldError></div>
}

/** Load error on ink: paper alert with "Try again". */
export function LoadError({ error, what, onRetry, busy }: { error: string | null; what: string; onRetry?: () => void; busy?: boolean }) {
  if (!error) return null
  return <Alert title={`Couldn't load ${what}.`} onRetry={onRetry} busy={busy}>{error}</Alert>
}

/* ---------- async action helper ---------- */

/* Admin overrides for codes whose lib/supabase.ts copy breaks the DESIGN 12 vocabulary lock.
   Same pattern as member/format.ts PICK_CODES; falls through to friendlyError for everything else. */
const ADMIN_CODES: Record<string, string> = {
  ADMIN_HAS_BET: 'You have points on this bout, so another admin has to record the result.',
  BET_TOO_SMALL: 'Put in at least 10 pts.',
  BET_TOO_LARGE: "That's more than you can put in right now.",
  ALREADY_BET: 'You already have points on this bout.',
  BET_NOT_FOUND: 'That pick no longer exists.',
  BET_NOT_ACTIVE: 'That pick is already closed.',
}

/** friendlyError with the admin vocabulary overrides applied. */
export function adminError(e: unknown): string {
  const raw = String((e as { message?: string; error?: string })?.message ?? (e as { error?: string })?.error ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g) ?? []) if (ADMIN_CODES[tok]) return ADMIN_CODES[tok]
  return friendlyError(e)
}

/** Wraps an async action with busy + friendly error state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null)
    try { return await fn() }
    catch (e) { setError(adminError(e)); return undefined }
    finally { setBusy(false) }
  }, [])
  return { busy, error, setError, run }
}

/** Throws the supabase error if present so useAction can catch it. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

/** Focus the first invalid control inside `root` after React paints the errors (WIG: first error gets focus). */
export function focusFirstInvalid(root: HTMLElement | null) {
  requestAnimationFrame(() => {
    const el = root?.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby] .field-error')
    const target = el?.matches('.field-error') ? el.closest('fieldset')?.querySelector<HTMLElement>('button, input, select') : el
    target?.focus()
  })
}

/* ---------- confirm dialog ---------- */

interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; variant?: ButtonVariant }

/**
 * Returns [dialogElement, ask]. `await ask({...})` resolves true/false.
 * Native <dialog> (focus trap, Esc closes) styled as a paper sheet on a 50% ink scrim.
 */
export function useConfirm(): [ReactNode, (o: ConfirmOpts) => Promise<boolean>] {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId().replace(/:/g, '')
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(res => { resolver.current = res; setOpts(o) }), [])
  const close = useCallback((v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null) }, [])
  useEffect(() => {
    const d = ref.current
    if (opts && d && !d.open) d.showModal?.()
  }, [opts])
  const el = opts && (
    <dialog ref={ref} className="paper adm-confirm" aria-labelledby={titleId}
      onCancel={e => { e.preventDefault(); close(false) }}
      onClick={e => { if (e.target === e.currentTarget) close(false) }}>
      <h2 id={titleId} className="t-head">{opts.title}</h2>
      {opts.body && <div className="body">{opts.body}</div>}
      <div className="actions">
        <Button variant="ghost" onClick={() => close(false)}>Back</Button>
        <Button variant={opts.variant ?? 'danger'} onClick={() => close(true)}>{opts.confirmLabel ?? 'Confirm'}</Button>
      </div>
    </dialog>
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

const TZ = 'Asia/Baghdad'

/** "Thu 6 Nov, 22:30" (24h, the card's time zone). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'not set'
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }).format(d).replace(',', '')
  return `${day}, ${fmtTime(iso)}`
}

/** "22:30" (24h, card time zone). */
export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(new Date(iso))
}

/** Asia/Baghdad calendar date (YYYY-MM-DD) of an ISO timestamp. Mirrors fights.card_date. */
export function cardDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** "2026-11-06" → "Thu 6 Nov". */
export function fmtCardDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, day, 12))).replace(',', '')
}

/** "2h ago" / "in 3 days" via Intl.RelativeTimeFormat. */
export function fmtAgo(iso: string, now = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto', style: 'short' })
  const a = Math.abs(s)
  if (a < 45) return 'just now'
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day')
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(iso))
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

/** Parse a weight input ("72.5") → number | null (NaN when not a number). */
export function parseKg(v: string): number | null {
  const t = v.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN
}

/** Capitalise the first letter of stored lowercase text ("half nelson" → "Half nelson"). */
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
