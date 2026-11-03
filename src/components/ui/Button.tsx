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
import { buttonClass, type ButtonVariant, type Look } from './buttonStyles'

export type { ButtonVariant, Look }


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
