/**
 * Form kit (DESIGN 11.15). Forms live on paper. Labels always visible above the field (never placeholder-only).
 *
 *   <Field label="Username" hint="..." error={err}>
 *     <Input name="username" autoComplete="username" spellCheck={false} autoCapitalize="none" />
 *   </Field>
 *
 * Field clones its single child to add id, aria-describedby (hint + error) and aria-invalid.
 * For custom controls pass a function child: {(a) => <MyControl {...a} />}.
 */
import { cloneElement, isValidElement, useId, useState, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Eye, EyeSlash, Minus, Plus, WarningOctagon } from './Icon'
import { cx } from './cx'

export interface FieldA11y { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** id for the control (auto-generated otherwise) */
  id?: string
  className?: string
  children: ReactElement | ((a: FieldA11y) => ReactNode)
}

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return <label htmlFor={htmlFor} className={cx('field-label', className)}>{children}</label>
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} className="field-error" role="alert"><WarningOctagon />{children}</p>
}

export function Field({ label, hint, error, id, className, children }: FieldProps) {
  const auto = useId()
  const cid = id ?? `f${auto.replace(/:/g, '')}`
  const hintId = hint ? `${cid}-hint` : undefined
  const errId = error ? `${cid}-err` : undefined
  const a: FieldA11y = { id: cid, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, ...(error ? { 'aria-invalid': true as const } : {}) }
  const control = typeof children === 'function' ? children(a) : isValidElement(children) ? cloneElement(children as ReactElement<Partial<FieldA11y>>, a) : children
  return (
    <div className={cx('field', className)}>
      <Label htmlFor={cid}>{label}</Label>
      {control}
      {hint && <p id={hintId} className="field-hint">{hint}</p>}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** text: Archivo 16px. data: Courier 700 (numbers). score: display 900, 64px centred */
  look?: 'text' | 'data' | 'score'
  ref?: React.Ref<HTMLInputElement>
}

export function Input({ look = 'text', className, ...rest }: InputProps) {
  return <input className={cx('input', look !== 'text' && `input--${look}`, className)} {...rest} />
}

/** Password input with the show/hide eye toggle (aria-pressed). */
export function PasswordInput({ className, ...rest }: Omit<InputProps, 'type' | 'look'>) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-wrap">
      <input type={show ? 'text' : 'password'} className={cx('input', className)} autoCapitalize="none" spellCheck={false} {...rest} />
      <button type="button" className="eye" aria-pressed={show} aria-label="Show password" onClick={() => setShow(s => !s)}>
        {show ? <EyeSlash /> : <Eye />}
      </button>
    </div>
  )
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('select', className)} {...rest} />
}

export interface StepperProps {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  /** accessible name of the value, e.g. "Rounds" */
  label: string
  id?: string
  format?: (n: number) => ReactNode
}

/** 48px minus / output / plus stepper (rounds, bout order, signed points). */
export function Stepper({ value, onChange, min = -Infinity, max = Infinity, step = 1, label, id, format }: StepperProps) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)))
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label.toLowerCase()}`} disabled={value <= min} onClick={() => set(value - step)}><Minus /></button>
      <output id={id} aria-live="polite">{format ? format(value) : value}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => set(value + step)}><Plus /></button>
    </div>
  )
}

export interface SegProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean
  /** corner tint when pressed */
  corner?: 'red' | 'blue'
}

/** One segment of a .segs toggle group (aria-pressed). Wrap several in <div className="segs" role="group" aria-label="...">. */
export function Seg({ pressed, corner, className, type = 'button', ...rest }: SegProps) {
  return <button type={type} aria-pressed={pressed} className={cx('seg', corner && `seg--${corner}`, className)} {...rest} />
}

export default Field
