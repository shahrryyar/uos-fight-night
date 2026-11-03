/**
 * C2: route guard for the referee screens (/admin/ref, /admin/ref/:fightId). Admins and active
 * referees pass; everyone else goes back to Tonight. The server re-checks with is_referee() and
 * admin_live_update, so this only keeps the wrong people off an empty screen.
 */
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import type { Profile } from '../../lib/types'
import Splash from '../landing/Splash'

/** Active member whose role is 'referee' (not admin: admins get the full Admin area). */
export const isRefereeRole = (p: Pick<Profile, 'role' | 'active'> | null | undefined) => !!p && p.active && p.role === 'referee'

/** Admin or referee: may open the scoreboard. */
export function useCanRef() {
  const { isAdmin, profile, loading } = useAuth()
  return { canRef: isAdmin || isRefereeRole(profile), isAdmin, loading }
}

export default function RequireReferee({ children }: { children: ReactNode }) {
  const { canRef, loading } = useCanRef()
  if (loading) return <Splash inline />
  if (!canRef) return <Navigate to="/app" replace />
  return <>{children}</>
}
