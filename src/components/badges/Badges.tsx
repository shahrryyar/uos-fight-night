/**
 * Badges (CONTRACT B6, list_badges RPC). No emoji: each badge is a rubber-stamp seal around a Phosphor
 * bold emblem (badge_catalog.icon), the label in display type and the description as plain text, so
 * the meaning never hides behind a hover tooltip (touch first). `title` adds the hover hint on desktop.
 *
 *   <BadgeSeal/>    the stamped emblem (decorative; the row/chip carries the words)
 *   <BadgeChip/>    compact seal + label (+ xN), for tight spots; description in title + sr-only
 *   <BadgeList/>    rows on ink: seal, label, description, xN and last-earned date
 *   <BadgeSection/> heading + loading/error/empty + list + "how to earn the rest" for a fighter or member
 */
import type { CSSProperties } from 'react'
import { fmtDay } from '../../lib/hooks'
import { BADGES, type BadgeCode, type BadgeKind, type BadgeSummary } from '../../lib/types'
import { Alert, cx } from '../ui'
import { badgeIconMarkup } from './badgeIcons'
import './badges.css'

const ROT = [-3, 2, -2, 3, -1]

export function BadgeSeal({ icon, size = 44, rot = -3, earned = true, className }:
  { icon: string; size?: number; rot?: number; earned?: boolean; className?: string }) {
  return (
    <span className={cx('badge-seal', !earned && 'badge-seal--todo', className)} aria-hidden="true"
      style={{ '--seal': `${size}px`, '--rot': `${rot}deg` } as CSSProperties}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" focusable="false"
        dangerouslySetInnerHTML={{ __html: badgeIconMarkup(icon) }} />
    </span>
  )
}

/** Compact chip: seal + label (+ xN). The description rides in title (hover) and sr-only text. */
export function BadgeChip({ badge, onPaper, i = 0 }: { badge: Pick<BadgeSummary, 'label' | 'description' | 'icon' | 'times'>; onPaper?: boolean; i?: number }) {
  return (
    <span className={cx('badge-chip', onPaper && 'badge-chip--paper')} title={badge.description}>
      <BadgeSeal icon={badge.icon} size={28} rot={ROT[i % ROT.length]} />
      <span className="badge-chip-label">{badge.label}</span>
      {badge.times > 1 && <span className="data"><span aria-hidden="true">×{badge.times}</span><span className="sr-only">, earned {badge.times} times</span></span>}
      <span className="sr-only">: {badge.description}</span>
    </span>
  )
}

export function BadgeList({ badges }: { badges: BadgeSummary[] }) {
  return (
    <ul className="rows badge-list" role="list">
      {badges.map((b, i) => (
        <li key={b.code} className="row badge-row">
          <BadgeSeal icon={b.icon} rot={ROT[i % ROT.length]} />
          <span>
            <span className="t-sub">{b.label}</span>
            <span className="t-help badge-desc">{b.description}</span>
          </span>
          <span className="badge-end data">
            {b.times > 1 && <b className="data-lg"><span aria-hidden="true">×{b.times}</span><span className="sr-only">Earned {b.times} times</span></b>}
            <span className="nowrap"><span className="sr-only">{b.times > 1 ? 'Last earned ' : 'Earned '}</span>{fmtDay(b.last_awarded_at)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
import { useBadges } from './useBadges'


const EMPTY: Record<BadgeKind, { you: string; them: string }> = {
  fighter: { you: 'No badges yet. Your first win earns First Blood.', them: 'No badges yet. The first win earns First Blood.' },
  user: { you: 'No badges yet. Pick five winners in a row to earn Sharp Eye.', them: 'No badges yet.' },
}

export function BadgeSection({ kind, id, title = 'Badges', own = false, className, headingLevel: H = 'h2' }:
  { kind: BadgeKind; id: string | null | undefined; title?: string; own?: boolean; className?: string; headingLevel?: 'h2' | 'h3' }) {
  const st = useBadges(kind, id)
  const hid = `badges-${kind}`
  const earned = st.data ?? []
  const have = new Set(earned.map(b => b.code))
  const todo = (Object.keys(BADGES) as BadgeCode[]).filter(c => BADGES[c].kind === kind && !have.has(c))

  return (
    <section className={cx('section badges', className)} aria-labelledby={hid}>
      <div className="section-head">
        <H id={hid} className="t-head">{title}</H>
        {earned.length > 0 && <span className="data c-2">{earned.length} of {earned.length + todo.length}</span>}
      </div>
      {st.loading && !st.data ? (
        <p className="t-help c-2" role="status">Loading badges…</p>
      ) : st.error ? (
        <Alert title="Couldn't load the badges." onRetry={() => void st.reload()}>Check your connection and try again.</Alert>
      ) : (
        <>
          {earned.length ? <BadgeList badges={earned} /> : <p className="t-body badges-empty">{own ? EMPTY[kind].you : EMPTY[kind].them}</p>}
          {todo.length > 0 && (
            <details className="badges-todo">
              <summary className="label">{earned.length ? `${todo.length} more to earn` : 'How to earn them'}</summary>
              <ul className="rows badge-list" role="list">
                {todo.map(c => (
                  <li key={c} className="row badge-row">
                    <BadgeSeal icon={BADGES[c].icon} earned={false} rot={0} />
                    <span>
                      <span className="t-sub">{BADGES[c].label}</span>
                      <span className="t-help badge-desc">{BADGES[c].description}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}
