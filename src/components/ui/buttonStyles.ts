import type { IconComponent } from './Icon'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'ink' | 'bone' | 'ghost' | 'danger'

export interface Look {
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
