import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo, RegaCredit } from '../brand'
import { Art } from '../ui'
import './public.css'

/**
 * Login shell: the edited dorm-mat photo (red/blue tape lines) dimmed behind the ink wall,
 * the lockup top left, then the page content (one taped poster), the after-line and the credit.
 * The credit footer is pinned to the bottom on an ink strip with the hairline rule. The photo is
 * anchored to the stage (header + main), not the viewport: its tape line (74.67% down the picture)
 * always lands 24px above the footer, inside main's 48px bottom padding, so it never runs behind
 * the poster, the after-line or the credit, whatever the screen height (see public.css).
 */
export default function AuthShell({ children, after }: { children: ReactNode; after?: ReactNode }) {
  return (
    <div className="pg-login">
      <a className="skip" href="#main">Skip to content</a>
      <div className="lp-stage">
        <Art name="mat" look="bg" priority sizes="100vw" />
        <header className="wrap appbar lp-bar">
          <Link to="/" className="brand" aria-label="UoS Fight Night, home">
            <Logo variant="lockup" size={64} decorative priority />
          </Link>
        </header>
        <main id="main" className="wrap">
          {children}
          {after && <p className="after t-help c-2">{after}</p>}
        </main>
      </div>
      <footer className="lp-foot-strip">
        <div className="wrap"><RegaCredit compact className="site-foot" /></div>
      </footer>
    </div>
  )
}
