/**
 * Tonight helpers (DESIGN 11.3) plus thin legacy re-exports for pages that have not migrated yet.
 * New code: import the primitives from components/ui directly.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import { FUN_POINTS_LINE } from '../../lib/copy'
import { Alert, Loading as UiLoading, Tape, Tabs as UiTabs, cx } from '../ui'

// ---------- Sheet: poster (taped, actionable) or paper (flat), same element so state survives a lock ----------

export function Sheet({ taped, className, children, ...rest }: HTMLAttributes<HTMLElement> & { taped: boolean }) {
  return (
    <article className={cx(taped ? 'poster' : 'paper', 'sheet', className)} {...rest}>
      {taped ? <><Tape side="l" /><Tape side="r" /></> : null}
      {children}
    </article>
  )
}

// ---------- legacy exports (other pages still import these; restyled to the new system) ----------

/** @deprecated the footer carries the fun-points line now; kept so unmigrated pages compile. */
export const NO_CASH = FUN_POINTS_LINE

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="pagehead">
      <h1 className="t-title">{children}</h1>
      {sub && <p className="t-help c-2">{sub}</p>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <UiLoading label={label} shape="none" />
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <Alert title={error} onRetry={onRetry} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={cx('paper', className)}>{children}</section>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty t-body">{children}</p>
}

/** Small "W3" / "L2" chip (12px floor). */
export function StreakPill({ streak, label }: { streak: number; label: string }) {
  if (!streak) return null
  return <span className={cx('streak', streak > 0 && 'streak--w')}>{label}</span>
}

export function Tabs<T extends string>({ value, onChange, tabs }: {
  value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[]
}) {
  return <UiTabs tabs={tabs} value={value} onChange={v => onChange(v as T)} label="Sections" />
}

