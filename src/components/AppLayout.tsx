import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const tabs = [
  { to: '/app', label: 'Tonight', icon: '🥊', end: true },
  { to: '/app/fighters', label: 'Fighters', icon: '🤼' },
  { to: '/app/leaderboard', label: 'Ranks', icon: '🏆' },
  { to: '/app/history', label: 'History', icon: '📜' },
  { to: '/app/me', label: 'Me', icon: '👤' },
]

export default function AppLayout() {
  const { isAdmin, profile } = useAuth()
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-ink/90 backdrop-blur border-b border-line">
        <div className="mx-auto max-w-2xl flex items-center justify-between px-4 h-14">
          <NavLink to="/app" className="font-display text-2xl tracking-wider">
            UOS <span className="text-red">FIGHT</span> <span className="text-gold">NIGHT</span>
          </NavLink>
          <div className="flex items-center gap-3 text-sm">
            {isAdmin && <NavLink to="/admin" className="rounded-md border border-gold/50 px-2.5 py-1 text-gold font-semibold">Admin</NavLink>}
            <span className="text-muted">@{profile?.username}</span>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-4 pb-28">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto max-w-2xl grid grid-cols-5">
          {tabs.map(t => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.end}
                className={({ isActive }) => `flex flex-col items-center justify-center h-16 text-[11px] font-semibold uppercase tracking-wide ${isActive ? 'text-gold' : 'text-muted'}`}>
                <span className="text-xl leading-none mb-1" aria-hidden>{t.icon}</span>{t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
