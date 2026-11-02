/**
 * Required credit (DESIGN 11.20): "Created & maintained by RegaLabs" with the RegaLabs mark on a bone scrap.
 * Full (default): footer.site-foot with the fun-points line + the credit. Rendered once by AppLayout for
 * every app page; Landing and Login render it themselves at the end of the page.
 * compact: the credit link only (no footer, no fun-points line), for places that already carry the line.
 */
import { CREDIT_URL, FUN_POINTS_LINE } from '../../lib/copy'

export interface RegaCreditProps {
  compact?: boolean
  className?: string
}

function CreditLink() {
  return (
    <a className="credit" href={CREDIT_URL} target="_blank" rel="noopener">
      <span className="mark">
        <img src="/brand/regalabs-mark-ink.webp" width={34} height={34} alt="" loading="lazy" decoding="async" />
      </span>
      <span>Created &amp; maintained by <b translate="no">RegaLabs</b><span className="sr-only"> (opens in a new tab)</span></span>
    </a>
  )
}

export default function RegaCredit({ compact, className = '' }: RegaCreditProps) {
  if (compact) return <div className={className}><CreditLink /></div>
  return (
    <footer className={`site-foot ${className}`.trim()}>
      <p className="t-help">{FUN_POINTS_LINE}</p>
      <CreditLink />
    </footer>
  )
}
