/**
 * C2: route guard for the referee screens (/admin/ref, /admin/ref/:fightId). Admins and active
 * referees pass; everyone else goes back to Tonight. The server re-checks with is_referee() and
 * admin_live_update, so this only keeps the wrong people off an empty screen.
 */
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import Splash from '../landing/Splash'
import { useCanRef } from './refereeAuth'


export default function RequireReferee({ children }: { children: ReactNode }) {
  const { canRef, loading } = useCanRef()
  if (loading) return <Splash inline />
  if (!canRef) return <Navigate to="/app" replace />
  return <>{children}</>
}
