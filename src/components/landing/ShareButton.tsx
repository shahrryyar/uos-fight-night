import { useState } from 'react'

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

export default function ShareButton({ title, text, url, className = '', label = 'Share the page' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const onShare = async () => {
    const link = url ?? location.origin
    if (navigator.share) {
      try { await navigator.share({ title, text, url: link }); return } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return
      }
    }
    const ok = await copy(`${text} ${link}`)
    setState(ok ? 'copied' : 'failed')
    setTimeout(() => setState('idle'), 2200)
  }

  return (
    <button type="button" onClick={onShare}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-gold/60 bg-gold/10 px-5 font-semibold text-gold transition active:scale-[0.98] hover:bg-gold/20 ${className}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M12 3v12" /><path d="m7 8 5-5 5 5" />
      </svg>
      <span aria-live="polite">{state === 'copied' ? 'Link copied' : state === 'failed' ? `Copy: ${url ?? location.origin}` : label}</span>
    </button>
  )
}
