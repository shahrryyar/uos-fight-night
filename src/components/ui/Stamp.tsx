/**
 * Rubber stamp: the signature. A stamp is ALWAYS real state (status, result, "You"), never decoration
 * (the VS stamp is the one decorative exception: pass aria-hidden).
 *
 * Landing animation: pass `land`. The stamp animates ONLY when its state (stateKey, or the text child)
 * changes after mount, e.g. PICKED after a pick, WIN BY PIN on a realtime settle. Never on page load.
 */
import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import type { IconComponent } from './Icon'
import { cx } from './cx'

export type StampTone = 'red' | 'ink' | 'bone' | 'live' | 'blue'

export interface StampProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** red: on paper only (large text). ink: toner on paper. bone: on ink. live: bone on red fill (small, on ink). blue: blue-ink */
  tone?: StampTone
  size?: 'sm' | 'md' | 'lg'
  /** bone background, for stamps sitting on a photo */
  fill?: boolean
  /** rotation in degrees, keep between -8 and +4 (default -3) */
  rot?: number
  /** animate when the state changes after mount */
  land?: boolean
  /** what counts as "the state" for `land` (defaults to the text child) */
  stateKey?: string | number
  icon?: IconComponent
  children: ReactNode
}

export default function Stamp({ tone = 'red', size = 'md', fill, rot, land, stateKey, icon: Ico, className, style, children, ...rest }: StampProps) {
  const key = stateKey ?? (typeof children === 'string' ? children : undefined)
  // "previous value in state" pattern: detect a change during render, no effect flash
  const [prev, setPrev] = useState(key)
  const [n, setN] = useState(0)
  if (key !== prev) {
    setPrev(key)
    if (land) setN(n + 1)
  }
  const st = (rot !== undefined ? { ...style, '--rot': `${rot}deg` } : style) as CSSProperties | undefined
  return (
    <span key={n} data-land={n > 0 ? '' : undefined} style={st}
      className={cx('stamp', tone !== 'red' && `stamp--${tone}`, size !== 'md' && `stamp--${size}`, fill && 'stamp--fill', className)} {...rest}>
      {Ico && <Ico />}
      {children}
    </span>
  )
}
