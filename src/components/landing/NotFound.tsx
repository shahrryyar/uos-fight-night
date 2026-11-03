import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { getBrandTitle } from '../../lib/brand'
import { Logo, RegaCredit } from '../brand'
import { Art, ButtonLink } from '../ui'
import './public.css'

/** 404: the empty dorm mat, what happened, and the one way back. */
export default function NotFound() {
  const { session } = useAuth()
  return (
    <div className="pg-404">
      <title>Not found · {getBrandTitle()}</title>
      <a className="skip" href="#main">Skip to content</a>
      <header className="wrap appbar lp-bar">
        <Link to="/" className="brand" aria-label={`${getBrandTitle()}, home`}>
          <Logo variant="lockup" size={64} decorative priority />
        </Link>
      </header>
      <main id="main" className="wrap">
        {/* EmptyState's markup, with the mat art loaded eagerly: it is the first thing above the fold */}
        <div className="empty empty--art">
          <Art name="mat" priority alt="" />
          <div>
            <h1 className="t-title">This page isn’t on the card</h1>
            <p className="t-body" style={{ marginTop: 8 }}>The link is old or has a typo. Head back and pick it up from there.</p>
            {session
              ? <ButtonLink to="/app">Go to Tonight</ButtonLink>
              : <ButtonLink to="/">Back to the front page</ButtonLink>}
          </div>
        </div>
        <RegaCredit />
      </main>
    </div>
  )
}
