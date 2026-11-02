import { Logo } from '../brand'
import './public.css'

/**
 * The loading fallback for the auth gate and lazy route chunks (DESIGN 11.19): the mark and a
 * visible "Loading…" label on ink, role=status. No spinner, no display-font caps, no motion.
 * `inline` fills the content area inside AppLayout instead of the full viewport.
 */
export default function Splash({ inline = false, label = 'Loading…' }: { inline?: boolean; label?: string }) {
  return (
    <div role="status" aria-live="polite" className={inline ? 'splash splash--inline' : 'splash'}>
      {!inline && <Logo variant="mark" size={56} decorative />}
      <span className="label">{label}</span>
    </div>
  )
}
