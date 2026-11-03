/**
 * Admin kit (IMPLEMENTATION D "components/admin/ui.tsx"): thin layer over the foundation primitives in
 * components/ui. Forms live on paper, lists on ink. Errors are inline (FormError on paper, LoadError on ink),
 * confirmations are toasts, and the dialog is kept only for genuinely destructive member actions.
 */
import { useId, type ReactNode } from 'react'
import { FieldError, Alert, cx } from '../ui'

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
