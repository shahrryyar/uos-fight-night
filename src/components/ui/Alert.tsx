/**
 * Inline error on paper (DESIGN 11.17): red WarningOctagon, **bold problem** then the recovery,
 * optional "Try again" (btn--ink btn--sm). role=alert.
 *   <Alert title="Couldn't load tonight's card." onRetry={reload}>Check your connection and try again. Picks you already made are saved.</Alert>
 */
import type { ReactNode } from 'react'
import { WarningOctagon } from './Icon'
import Button from './Button'
import { cx } from './cx'

export interface AlertProps {
  title: ReactNode
  children?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  busy?: boolean
  className?: string
}

export default function Alert({ title, children, onRetry, retryLabel = 'Try again', busy, className }: AlertProps) {
  return (
    <div className={cx('paper alert', className)} role="alert">
      <WarningOctagon />
      <p className="t-help"><b>{title}</b>{children ? <> {children}</> : null}</p>
      {onRetry && <div style={{ gridColumn: 2, marginTop: 8 }}><Button variant="ink" size="sm" onClick={onRetry} busy={busy} busyLabel="Trying">{retryLabel}</Button></div>}
    </div>
  )
}
