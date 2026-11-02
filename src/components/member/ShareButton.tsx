import { useState } from 'react'
import { sharePoster } from '../../lib/poster'
import { signedPhotoUrl } from '../FighterPhoto'
import { friendlyError } from '../../lib/supabase'
import { cornerKg, type FightRow } from '../../lib/hooks'
import type { Fighter } from '../../lib/types'

/** Generates and shares the VS poster image (Web Share / download fallback). */
export default function ShareButton({ fight, red, blue }: { fight: FightRow; red?: Fighter; blue?: Fighter }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const share = async () => {
    setBusy(true); setMsg(null)
    try {
      const [redPhotoUrl, bluePhotoUrl] = await Promise.all([signedPhotoUrl(red?.photo_path), signedPhotoUrl(blue?.photo_path)])
      await sharePoster({
        title: fight.title,
        redName: red?.nickname ?? 'Red corner',
        blueName: blue?.nickname ?? 'Blue corner',
        redPhotoUrl, bluePhotoUrl,
        redKg: cornerKg(fight, 'red', red),
        blueKg: cornerKg(fight, 'blue', blue),
        when: fight.scheduled_at,
        url: `${window.location.origin}/`,
      })
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setMsg(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button onClick={share} disabled={busy}
        className="min-h-11 w-full rounded-xl border border-gold/50 font-display text-xl tracking-wider text-gold disabled:opacity-50">
        {busy ? 'Making poster…' : '📣 Share poster'}
      </button>
      {msg && <p className="mt-1 text-xs text-red" role="alert">{msg}</p>}
    </div>
  )
}
