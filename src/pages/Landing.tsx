import { useAuth } from '../lib/auth'
import { Logo, RegaCredit } from '../components/brand'
import { Art, ButtonLink } from '../components/ui'
import NextFight from '../components/landing/NextFight'
import ShareButton from '../components/landing/ShareButton'
import '../components/landing/public.css'

const rules = [
  ['Tap = stop.', 'The second someone taps or says stop, it ends. No exceptions.'],
  ['Referee’s call is final.', 'No arguing with the ref, on the mat or in the group chat.'],
  ['No strikes.', 'Wrestling only. No punches, kicks, slaps or elbows.'],
  ['Everyone opts in.', 'Nobody gets pushed into a fight. Saying no is always fine.'],
  ['18+ only.', 'Every fighter and every member is an adult.'],
] as const

const SHARE_TEXT = 'UoS Fight Night: dorm wrestling nights, real records, fun points. Members only.'

export default function Landing() {
  const { session } = useAuth()
  const cta = session ? { to: '/app', label: 'Go to Tonight', top: 'Open app' } : { to: '/login', label: 'Log in', top: 'Log in' }

  return (
    <div className="pg-landing">
      <title>UoS Fight Night</title>
      <a className="skip" href="#main">Skip to content</a>

      <header className="wrap lp-hero">
        <div className="lp-top">
          <h1 className="lp-brand"><Logo variant="lockup" size={72} alt="UoS Wrestling Fight Night" priority /></h1>
          <ButtonLink to={cta.to} variant="ghost" size="sm" className="top-login">{cta.top}</ButtonLink>
        </div>
      </header>

      <main id="main" className="wrap">
        <section className="lp-next" aria-label="Next fight">
          <NextFight />
        </section>

        <section className="pitch" aria-label="About">
          <p className="t-body">Dorm wrestling nights. Pins, holds and taps, no strikes. Members only: an admin sets up your login.</p>
          <ButtonLink to={cta.to}>{cta.label}</ButtonLink>
        </section>

        {/* DESIGN 10: the first viewport is flyer, sentence, CTA. The silhouettes poster opens the
            scroll below it and leads into the house rules (lazy: it is below the fold everywhere). */}
        <Art name="silhouettes" look="hero" className="lp-art" sizes="(max-width: 480px) 100vw, 512px" />

        <section className="section rules-wrap" aria-labelledby="rules">
          <h2 id="rules" className="t-head">House rules</h2>
          <p className="t-help c-2 lp-sub">Break one and you’re off the card.</p>
          <ul className="rules" role="list">
            {rules.map(([t, d]) => (
              <li key={t}><h3 className="t-sub">{t}</h3><p className="t-help">{d}</p></li>
            ))}
          </ul>
        </section>

        <section className="section" aria-labelledby="share">
          <h2 id="share" className="t-head">Bring the dorm</h2>
          <p className="t-help c-2 lp-share-sub">Send this page to the group chat. An admin sets up a login for anyone who wants in.</p>
          <ShareButton className="lp-share" title="UoS Fight Night" text={SHARE_TEXT} />
        </section>

        <RegaCredit className="lp-foot" />
      </main>
    </div>
  )
}
