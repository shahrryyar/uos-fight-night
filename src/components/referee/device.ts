/**
 * Device helpers for the referee screen: Screen Wake Lock (keeps the phone awake mid-bout) and haptics.
 * Both degrade silently: no wake lock API -> status 'unsupported' (the screen tells the ref to keep it
 * awake themselves); no vibrate (iOS Safari) -> nothing happens.
 */
import { useEffect, useState } from 'react'

export type WakeStatus = 'on' | 'off' | 'unsupported'

interface WakeLockSentinelLike extends EventTarget { released: boolean; release: () => Promise<void> }
interface WakeLockLike { request: (type: 'screen') => Promise<WakeLockSentinelLike> }

/** Holds a screen wake lock while mounted; re-acquires it when the tab becomes visible again
 *  (browsers drop the lock whenever the page is hidden). */
export function useWakeLock(enabled = true): WakeStatus {
  const api = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock : undefined
  const [status, setStatus] = useState<WakeStatus>(api ? 'off' : 'unsupported')

  useEffect(() => {
    if (!api || !enabled) return
    let lock: WakeLockSentinelLike | null = null
    let alive = true
    const onRelease = () => { if (alive) setStatus('off') }
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return
      try {
        lock = await api.request('screen')
        if (!alive) { void lock.release(); return }
        lock.addEventListener('release', onRelease)
        setStatus('on')
      } catch {
        // denied (battery saver, not allowed in this frame, no user gesture yet): stay 'off', retry later
        if (alive) setStatus('off')
      }
    }
    const onVis = () => { if (document.visibilityState === 'visible') void acquire() }
    // some browsers want a user gesture first: retry on the first tap too
    const onTap = () => { void acquire() }
    void acquire()
    document.addEventListener('visibilitychange', onVis)
    document.addEventListener('pointerdown', onTap, { passive: true })
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVis)
      document.removeEventListener('pointerdown', onTap)
      if (lock) { lock.removeEventListener('release', onRelease); void lock.release().catch(() => {}) }
    }
  }, [api, enabled])

  return status
}

const PATTERNS = {
  /** a point */
  tap: 12,
  /** a point taken off: two short knocks, so it feels different without looking */
  undo: [10, 60, 10],
  /** clock start / pause / next round */
  clock: 30,
  /** round time is up */
  bell: [220, 120, 220, 120, 420],
  /** the server refused */
  error: [60, 40, 60, 40, 60],
} satisfies Record<string, number | number[]>

export type Buzz = keyof typeof PATTERNS

export function buzz(kind: Buzz) {
  try {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
    // Chrome logs a console error when vibrate runs before any tap (e.g. the
    // round bell firing on page load), so wait for a real gesture first.
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    if (ua && !ua.hasBeenActive) return
    navigator.vibrate(PATTERNS[kind])
  } catch { /* not allowed (no gesture yet / iframe): ignore */ }
}
