/**
 * MATERIAL B: flat bone paper sheet with torn edge (results, stat sheets, forms, alerts, the landing flyer).
 * No tape, no tilt. Never nest paper in paper.
 */
import type { HTMLAttributes } from 'react'
import { cx } from './cx'

type Tag = 'div' | 'section' | 'article' | 'aside' | 'form' | 'li' | 'figure'

export interface PaperProps extends HTMLAttributes<HTMLElement> {
  /** torn edge on the bottom only (default) or top and bottom */
  edges?: 'bottom' | 'both'
  /** pull out to the screen edge (cancels the 16px gutter) */
  bleed?: boolean
  as?: Tag
}

export default function Paper({ edges = 'bottom', bleed, as: As = 'div', className, ...rest }: PaperProps) {
  return <As className={cx('paper', edges === 'both' && 'paper--both', bleed && 'paper--bleed', className)} {...(rest as HTMLAttributes<HTMLElement>)} />
}
