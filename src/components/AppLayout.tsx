import { Suspense, useEffect, useMemo, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useBalance } from '../lib/hooks'
import { BalanceContext } from '../lib/balance'
import { fmtNum } from '../lib/copy'
import { getBrandTitle } from '../lib/brand'
import { Logo, RegaCredit } from './brand'
import { isRefereeRole } from './referee/refereeAuth'
import { CalendarDot, ClockCounterClockwise, Ranking, UserCircle, UsersThree, Loading, type IconComponent } from './ui'

const tabs: { to: string; label: string; icon: IconComponent; end?: boolean }[] = [
  { to: '/app', label: 'Tonight', icon: CalendarDot, end: true },
  { to: '/app/fighters', label: 'Fighters', icon: UsersThree },
  { to: '/app/leaderboard', label: 'Ranks', icon: Ranking },
  { to: '/app/history', label: 'History', icon: ClockCounterClockwise },
  { to: '/app/me', label: 'Me', icon: UserCircle },
]

/** App shell (DESIGN 11.1, 11.2, 11.20): non-sticky app bar, fixed bottom tab bar, credit after every page. */
export default function AppLayout() {
  const { isAdmin, profile } = useAuth()
  const { balance, loading, reload } = useBalance()
  const { pathname } = useLocation()
  // keep the stub honest: refresh on navigation and when the app comes back to the foreground
  const seen = useRef(pathname)
  useEffect(() => {
    if (seen.current === pathname) return
    seen.current = pathname
    void reload()
  }, [pathname, reload])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [reload])
  const ctx = useMemo(() => ({ balance: balance ?? null, loading, reload }), [balance, loading, reload])
  const shown = balance == null ? '…' : fmtNum(balance)

  return (
    <BalanceContext.Provider value={ctx}>
      <a className="skip" href="#main">Skip to content</a>
      <header className="wrap appbar">
        <NavLink to="/app" end className="brand" aria-label={`${getBrandTitle()}: tonight's card`}>
          <Logo variant="mark" size={40} decorative />
        </NavLink>
        <div className="appbar-right">
          {isAdmin && <NavLink to="/admin" className="btn btn--ghost btn--sm">Admin</NavLink>}
          {!isAdmin && isRefereeRole(profile) && <NavLink to="/admin/ref" className="btn btn--ghost btn--sm" aria-label="Ref: bouts to score">Ref</NavLink>}
          <NavLink to="/app/me" className="stub balance"
            aria-label={balance == null ? 'Your points are loading. Open Me' : `Your points: ${shown}. Open Me`}>
            <span className="data-lg">{shown}</span><span className="label">pts</span>
          </NavLink>
        </div>
      </header>
      <main id="main" className="wrap has-tabbar">
        <Suspense fallback={<Loading label="Loading…" />}>
          <Outlet />
        </Suspense>
        <RegaCredit />
      </main>
      <nav className="tabbar" aria-label="Main">
        <ul>
          {tabs.map(({ to, label, icon: Ico, end }) => (
            <li key={to}>
              <NavLink to={to} end={end}><Ico />{label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </BalanceContext.Provider>
  )
}
