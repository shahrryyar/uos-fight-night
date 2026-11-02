/**
 * Empty state on ink (DESIGN 11.18): name the cause and the next action. No illustrations except the
 * mat photo for the big "No fight booked tonight" / 404 moments (art="mat").
 *   <EmptyState title="No fight booked tonight" body="Rest up. Check the ranks, and come back when admins post the next card."
 *     action={<ButtonLink to="/app/leaderboard" variant="bone" size="sm">See the ranks</ButtonLink>} art="mat" />
 */
import type { ReactNode } from 'react'
import Art from './Art'
import { cx } from './cx'

export interface EmptyStateProps {
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  /** heading size: title (page-level, t-title) or head (section, t-head). Default head */
  size?: 'title' | 'head'
  /** heading element (default h2) */
  as?: 'h1' | 'h2' | 'h3'
  art?: 'mat'
  className?: string
}

export default function EmptyState({ title, body, action, size = 'head', as: H = 'h2', art, className }: EmptyStateProps) {
  return (
    <div className={cx('empty', art && 'empty--art', className)}>
      {art && <Art name="mat" alt="" />}
      <div>
        <H className={size === 'title' ? 't-title' : 't-head'}>{title}</H>
        {body && <p className="t-body" style={{ marginTop: 8 }}>{body}</p>}
        {action}
      </div>
    </div>
  )
}
