/**
 * Share the xerox VS poster (Web Share, download fallback). Icon-only ghost button in the poster foot
 * (DESIGN 11.3 / 13.18). aria-busy while the poster renders. When the browser can't share files,
 * sharePoster downloads the PNG and copies the share text; we watch for its download link so the
 * viewer gets a toast instead of silence (sharePoster itself stays unchanged).
 */
import { useState } from 'react'
import { sharePoster } from '../../lib/poster'
import { signedPhotoUrl } from '../FighterPhoto'
import { friendlyError } from '../../lib/supabase'
import { cornerKg, type FightRow } from '../../lib/hooks'
import type { Fighter } from '../../lib/types'
import { Button, FieldError, ShareFat, useToast } from '../ui'

export default function ShareButton({ fight, red, blue }: { fight: FightRow; red?: Fighter; blue?: Fighter }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const toast = useToast()

  const share = async () => {
    setBusy(true); setMsg(null)
    let downloaded = false
    const watch = new MutationObserver(list => {
      for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLAnchorElement && n.hasAttribute('download')) downloaded = true
    })
    watch.observe(document.body, { childList: true })
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
      watch.takeRecords().forEach(m => m.addedNodes.forEach(n => { if (n instanceof HTMLAnchorElement && n.hasAttribute('download')) downloaded = true }))
      if (downloaded) toast('Poster saved. Link copied, paste it in the group chat.', { icon: ShareFat })
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setMsg(`Couldn't make the poster. ${friendlyError(e)}`)
    } finally {
      watch.disconnect()
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" iconOnly icon={ShareFat} aria-label={busy ? 'Making the poster' : 'Share the poster'}
        busy={busy} onClick={() => void share()} className="share-btn" />
      {msg && <div className="share-err"><FieldError>{msg}</FieldError></div>}
    </>
  )
}
