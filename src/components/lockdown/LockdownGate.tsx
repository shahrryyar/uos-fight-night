/**
 * C1 gate around every route (App.tsx). While the lockdown is on, members and visitors get the
 * generic maintenance page on every URL (on /login: a plain sign-in form, so an admin can get back
 * in). Admins pass through with the red banner on top. When a lockdown lifts, the profile that a
 * locked-out member couldn't read is fetched again, so the app comes back without a reload.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { SiteStatusContext, useSiteStatusSource } from '../../lib/siteStatus'
import Maintenance, { MaintenanceWait } from './Maintenance'
import { LockdownBanner } from './LockdownControl'
import { applyBrandHead } from './brandHead'
import { loadBrandCopy } from '../../lib/brand'

export default function LockdownGate({ children }: { children: ReactNode }) {
  const { session, loading, refreshProfile } = useAuth()
  const site = useSiteStatusSource(session?.user.id, !loading)
  const { pathname } = useLocation()

  // locked out -> back in: reload the profile RLS hid during the lockdown
  const wasLocked = useRef(false)
  useEffect(() => {
    if (!site.ready) return
    if (wasLocked.current && !site.lockedOut && session) void refreshProfile()
    wasLocked.current = site.lockedOut
  }, [site.ready, site.lockedOut, session, refreshProfile])

  // branded <head> only once we know this viewer may see the site (index.html ships neutral)
  useLayoutEffect(() => {
    if (site.ready) {
      if (!site.lockedOut) {
        void loadBrandCopy().then(() => {
          applyBrandHead(true)
        })
      } else {
        applyBrandHead(false)
      }
    }
  }, [site.ready, site.lockedOut])

  if (!site.ready) return <MaintenanceWait />
  if (site.lockedOut) return <Maintenance message={site.status?.message} signIn={pathname === '/login'} />
  return (
    <SiteStatusContext.Provider value={site}>
      <LockdownBanner />
      {children}
    </SiteStatusContext.Provider>
  )
}
