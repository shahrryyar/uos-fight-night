/**
 * Buttons (DESIGN 11.14). One primary (red) per view.
 *   primary  red fill            Log in, Put 50 on..., I'm in, Record result
 *   ink      toner fill          secondary on paper (Check result, Try again)
 *   bone     bone fill           secondary on ink (Share this page, See the ranks)
 *   ghost    2px outline         Back, Edit, Show all
 *   danger   3px red outline     Say no, Take back 50, Cancel fight (always confirm or undo). onInk for bone label
 * busy: aria-busy + label swap; CSS appends the ellipsis, so busyLabel is written WITHOUT "…" ("Saving").
 * Clicks are ignored while busy. iconOnly requires aria-label.
 */
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import type { IconComponent } from './Icon'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'ink' | 'bone' | 'ghost' | 'danger'

interface Look {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  /** balanced 2-line label for long names at 320px */
  wrap?: boolean
  /** danger button on ink or inside the ticket: bone label */
  onInk?: boolean
  icon?: IconComponent
  /** icon after the label instead of before */
  iconEnd?: boolean
  /** square 44px icon button (needs aria-label) */
  iconOnly?: boolean
}

export function buttonClass({ variant = 'primary', size = 'md', wrap, onInk, iconOnly }: Look, extra?: string) {
  return cx('btn', variant !== 'primary' && `btn--${variant}`, (size === 'sm' || iconOnly) && 'btn--sm', wrap && 'btn--wrap',
    onInk && variant === 'danger' && 'on-ink', iconOnly && 'icon-only', extra)
}

function Inner({ icon: Ico, iconEnd, iconOnly, children }: Look & { children?: ReactNode }) {
  return <>{Ico && !iconEnd && <Ico />}{!iconOnly && children}{Ico && iconEnd && <Ico />}</>
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Look {
  busy?: boolean
  busyLabel?: string
}

export default function Button({ variant, size, wrap, onInk, icon, iconEnd, iconOnly, busy, busyLabel, className, children, onClick, type = 'button', ...rest }: ButtonProps) {
  const click = (e: MouseEvent<HTMLButtonElement>) => { if (busy) { e.preventDefault(); return } onClick?.(e) }
  const label = busy && busyLabel ? busyLabel.replace(/…$|\.\.\.$/, '') : children
  return (
    <button type={type} className={buttonClass({ variant, size, wrap, onInk, iconOnly }, className)}
      aria-busy={busy || undefined} onClick={click} {...rest}>
      <Inner icon={icon} iconEnd={iconEnd} iconOnly={iconOnly}>{label}</Inner>
    </button>
  )
}

export interface ButtonLinkProps extends LinkProps, Look {}

/** Router link styled as a button. */
export function ButtonLink({ variant, size, wrap, onInk, icon, iconEnd, iconOnly, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClass({ variant, size, wrap, onInk, iconOnly }, typeof className === 'string' ? className : undefined)} {...rest}>
      <Inner icon={icon} iconEnd={iconEnd} iconOnly={iconOnly}>{children}</Inner>
    </Link>
  )
}
