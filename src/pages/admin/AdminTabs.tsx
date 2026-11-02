import { NavLink } from 'react-router-dom'

// Absolute paths on purpose: AdminHome is mounted under the `/admin/*` splat route, and
// React Router v7 resolves relative links against the full splat URL, so `to="members"`
// from /admin/fights became /admin/fights/members, and the `*` redirect then looped.
export const ADMIN_HOME = '/admin/fights'

export const adminTabs = [
  { to: '/admin/fights', label: 'Fights' },
  { to: '/admin/fighters', label: 'Fighters' },
  { to: '/admin/members', label: 'Members' },
  { to: '/admin/points', label: 'Points' },
  { to: '/admin/log', label: 'Log' },
] as const

export default function AdminTabs() {
  return (
    <nav className="-mx-4 mb-4 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Admin sections">
      <ul className="flex gap-2 w-max">
        {adminTabs.map(t => (
          <li key={t.to}>
            <NavLink to={t.to}
              className={({ isActive }) =>
                `flex items-center min-h-11 rounded-full px-4 text-sm font-bold uppercase tracking-wider border transition ${
                  isActive ? 'bg-gold text-ink border-gold' : 'bg-surface border-line text-muted hover:text-bone'}`}>
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
