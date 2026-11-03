import { useAuth } from '../../lib/auth'
import type { Profile } from '../../lib/types'

/** Active member whose role is 'referee' (not admin: admins get the full Admin area). */
export const isRefereeRole = (p: Pick<Profile, 'role' | 'active'> | null | undefined) => !!p && p.active && p.role === 'referee'

/** Admin or referee: may open the scoreboard. */
export function useCanRef() {
  const { isAdmin, profile, loading } = useAuth()
  return { canRef: isAdmin || isRefereeRole(profile), isAdmin, loading }
}
