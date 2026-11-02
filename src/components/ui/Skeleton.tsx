/**
 * Loading (DESIGN 11.19): static blocks shaped like the final layout + a visible label, role=status.
 * No shimmer, no spinner.
 *   <Loading label="Loading tonight's card…" />            card-shaped skeleton (paper)
 *   <Loading label="Loading ranks…" shape="rows" />         rows on ink
 *   <Skeleton h={20} w="60%" />                             a single block
 */
import type { CSSProperties } from 'react'
import Paper from './Paper'
import { cx } from './cx'

export function Skeleton({ w = '100%', h = 16, className, style }: { w?: number | string; h?: number | string; className?: string; style?: CSSProperties }) {
  return <span className={cx('skel', className)} aria-hidden="true" style={{ display: 'block', width: w, height: h, ...style }} />
}

export function Loading({ label = 'Loading…', shape = 'card', className }: { label?: string; shape?: 'card' | 'rows' | 'none'; className?: string }) {
  return (
    <div className={cx('loading', className)} role="status" aria-live="polite">
      <span className="label">{label}</span>
      {shape === 'card' && (
        <Paper>
          <Skeleton w="45%" h={28} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
            <Skeleton h={150} /><Skeleton h={150} />
          </div>
          <Skeleton w="70%" h={20} style={{ marginTop: 14 }} />
        </Paper>
      )}
      {shape === 'rows' && (
        <ul className="rows" aria-hidden="true">
          {[0, 1, 2, 3].map(i => <li key={i} className="row"><Skeleton w={36} h={32} /><Skeleton w="70%" h={20} /><Skeleton w={48} h={20} /></li>)}
        </ul>
      )}
    </div>
  )
}

export default Skeleton
