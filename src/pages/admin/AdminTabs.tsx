import { NavTabs } from '../../components/ui'
import './AdminTabs.css'

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
  { to: '/admin/season', label: 'Season' },
  { to: '/admin/shop', label: 'Shop' },
] as const

/** `nav.tabs.tabs--5`: five equal columns that all fit at 320px. NavLink sets aria-current="page",
 *  which `.tab[aria-current="page"]` fills bone (static cue, not colour alone). */
export default function AdminTabs() {
  return <NavTabs items={[...adminTabs]} label="Admin sections" />
}
