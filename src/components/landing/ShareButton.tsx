import { useState } from 'react'
import { Button, ShareFat, useToast } from '../ui'

interface Props { title: string; text: string; url?: string; className?: string; label?: string }

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* try legacy */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove()
    return ok
  } catch { return false }
}

/** "Share this page": native share sheet, else copy the link and confirm with a toast. Bone button on ink. */
export default function ShareButton({ title, text, url, className, label = 'Share this page' }: Props) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const onShare = async () => {
    const link = url ?? location.origin
    if (navigator.share) {
      try { await navigator.share({ title, text, url: link }); return } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return
      }
    }
    setBusy(true)
    const ok = await copy(`${text} ${link}`)
    setBusy(false)
    toast(ok ? 'Link copied. Paste it in the group chat.' : `Couldn't copy. The link is ${link}`, { icon: ShareFat })
  }

  return (
    <Button variant="bone" size="sm" icon={ShareFat} busy={busy} busyLabel="Copying" onClick={onShare} className={className}>
      {label}
    </Button>
  )
}
