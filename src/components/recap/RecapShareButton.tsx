/**
 * "Share results": renders the card recap poster (src/lib/recapPoster.ts) and shares it through the
 * same Web Share / download + copy flow as the VS poster. Takes a loaded recap or fetches it on tap.
 * Only a complete card (no bout left to fight, at least one settled) gets a poster.
 */
import { useState } from 'react'
import { recapOptsFrom, shareRecap } from '../../lib/recapPoster'
import type { CardRecap } from '../../lib/types'
import { fetchRecap, fotnError } from '../fotn'
import { Button, FieldError, ShareFat, cx, useToast } from '../ui'
import '../fotn/fotn.css'

export interface RecapShareButtonProps {
  cardDate: string
  recap?: CardRecap | null
  variant?: 'bone' | 'ghost' | 'ink'
  size?: 'md' | 'sm'
  className?: string
  label?: string
}

export default function RecapShareButton({ cardDate, recap, variant = 'bone', size = 'md', className, label = 'Share the results' }: RecapShareButtonProps) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const toast = useToast()

  const share = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = recap ?? await fetchRecap(cardDate)
      if (!r.complete || r.settled_count < 1) {
        setMsg('The results poster is ready once every bout on this card is done.')
        return
      }
      const how = await shareRecap(recapOptsFrom(r, `${window.location.origin}/`))
      if (how === 'downloaded') toast('Results poster saved. Link copied, paste it in the group chat.', { icon: ShareFat })
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setMsg(`Couldn't make the poster. ${fotnError(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cx('recap-share', className)}>
      <Button variant={variant} size={size} icon={ShareFat} busy={busy} busyLabel="Making the poster" onClick={() => void share()}>
        {label}
      </Button>
      {msg && <div className="recap-share-err"><FieldError>{msg}</FieldError></div>}
    </div>
  )
}
