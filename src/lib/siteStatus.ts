/**
 * C1 lockdown ("panic button"): site status for the whole app.
 *
 * Boot order (wave C API): public_site_status() first. When lockdown is on, a signed-in caller asks
 * is_locked_out() (true = not an admin), because a locked-out member can't read their own profile
 * row, so a missing profile must not be read as "account switched off". Visitors are locked out.
 *
 * Kept fresh three ways: a 30s poll while the tab is visible, a re-check on focus / visibility /
 * reconnect, and the `site_settings` realtime stream for signed-in users (it stays readable during
 * lockdown, so the switch flips live). The server enforces the lockdown on its own (RLS, RPCs);
 * this only decides what the UI shows, so a failed first read fails open instead of bricking the site.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import type { SiteStatus } from './types'

export const SITE_POLL_MS = 30_000
export const LOCKDOWN_MESSAGE_MAX = 200

export interface SiteStatusState {
  /** last known status; null until the first read */
  status: SiteStatus | null
  /** true: this viewer gets the maintenance page */
  lockedOut: boolean
  /** first read done (for this viewer) */
  ready: boolean
  /** re-read now */
  reload: () => Promise<void>
  /** apply a status the server just returned (admin toggle), then re-check */
  apply: (s: SiteStatus) => void
}

export const SiteStatusContext = createContext<SiteStatusState | null>(null)

/** Lockdown state for components under the gate (AppLayout banner, admin toggle). */
export function useSiteStatus(): SiteStatusState {
  const v = useContext(SiteStatusContext)
  if (!v) throw new Error('useSiteStatus outside LockdownGate')
  return v
}

/** Same as useSiteStatus, but null outside the gate (tests, isolated renders). */
export function useSiteStatusMaybe(): SiteStatusState | null {
  return useContext(SiteStatusContext)
}

export async function fetchSiteStatus(): Promise<SiteStatus> {
  const { data, error } = await supabase.rpc('public_site_status')
  if (error) throw error
  const d = (data ?? {}) as Partial<SiteStatus>
  return { lockdown: !!d.lockdown, message: d.lockdown ? (d.message ?? null) : null }
}

/** is_locked_out() for a signed-in caller. If the check itself fails during lockdown, stay locked. */
async function fetchLockedOut(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_locked_out')
  if (error) return true
  return data !== false
}

/** admin_set_lockdown(p_on, p_message). Returns the new status. */
export async function setLockdown(on: boolean, message: string | null): Promise<SiteStatus> {
  const msg = on ? (message?.trim() || null) : null
  const { data, error } = await supabase.rpc('admin_set_lockdown', { p_on: on, p_message: msg })
  if (error) throw error
  const d = (data ?? {}) as { lockdown?: boolean; message?: string | null }
  return { lockdown: !!d.lockdown, message: d.lockdown ? (d.message ?? null) : null }
}

/* Error copy for the codes this feature adds (lib/supabase.ts CODES is owned elsewhere). */
const LOCKDOWN_CODES: Record<string, string> = {
  SITE_LOCKED: "We're down for maintenance. Check back later.",
  INVALID_MESSAGE: 'Keep the message under 200 characters.',
  INVALID_VALUE: 'Choose on or off.',
  NOT_ADMIN: 'Only admins can switch the lockdown.',
}

export function lockdownError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g) ?? []) if (LOCKDOWN_CODES[tok]) return LOCKDOWN_CODES[tok]
  return friendlyError(e)
}

/**
 * The gate's data source. `uid` = signed-in user (undefined = visitor), `authReady` = the auth
 * session has been read (so a stored session is never mistaken for a visitor).
 */
export function useSiteStatusSource(uid: string | undefined, authReady: boolean): SiteStatusState {
  const [status, setStatus] = useState<SiteStatus | null>(null)
  const [lockedOut, setLockedOut] = useState(false)
  /** which viewer the lockedOut value belongs to ('' = visitor) */
  const [checkedFor, setCheckedFor] = useState<string | null>(null)
  const seq = useRef(0)
  const viewer = uid ?? ''

  const load = useCallback(async () => {
    const id = ++seq.current
    try {
      const s = await fetchSiteStatus()
      // until the stored session has been read we don't know who is looking: show nothing yet
      if (s.lockdown && !authReady) { if (id === seq.current) setStatus(s); return }
      const lo = s.lockdown ? (viewer ? await fetchLockedOut() : true) : false
      if (id !== seq.current) return
      setStatus(s); setLockedOut(lo); setCheckedFor(viewer)
    } catch {
      if (id !== seq.current) return
      // Unreachable or not migrated yet: keep the last known status, or fail open on the first read.
      setStatus(prev => prev ?? { lockdown: false, message: null })
      if (authReady) setCheckedFor(prev => prev ?? viewer)
    }
  }, [viewer, authReady])

  // first read right away (the landing page must not wait on auth), and again once the session is
  // known and whenever the viewer changes (sign in / out)
  useEffect(() => { void load() }, [load])

  // 30s poll while visible, plus focus / visibility / reconnect
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load() }
    const t = setInterval(tick, SITE_POLL_MS)
    window.addEventListener('focus', tick)
    window.addEventListener('online', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', tick)
      window.removeEventListener('online', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load])

  // live flip for signed-in users (site_settings is in supabase_realtime and readable in lockdown)
  useEffect(() => {
    if (!authReady || !viewer) return
    const ch = supabase.channel(`site:${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'site_settings' } as never, (() => { void load() }) as never)
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [authReady, viewer, load])

  const apply = useCallback((s: SiteStatus) => {
    seq.current++ // drop any read that started before the toggle
    setStatus(s)
    if (!s.lockdown) setLockedOut(false)
    void load()
  }, [load])

  // A known "off" status needs no auth wait; "on" must be checked for this exact viewer.
  const ready = status != null && (!status.lockdown || (authReady && checkedFor === viewer))
  return { status, lockedOut: !!status?.lockdown && lockedOut, ready, reload: load, apply }
}
