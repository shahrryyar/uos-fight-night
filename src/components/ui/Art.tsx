/**
 * Codex art (public/art/*.avif|webp, 600w + 900w, 4:5). Grit lives in the picture; never put data on it.
 *   name="silhouettes"  two wrestlers locked up on torn red paper: landing hero art
 *   name="mat"          the dorm mattress mat with red/blue tape lines: login background, "no fight tonight", 404
 * look: hero (bleeds to the screen edge), card (inline 4:5 or 5:4 inside .empty--art), bg (fixed, dimmed, behind the page)
 * Respects prefers-reduced-data (renders nothing). Lazy unless `priority`.
 */
import { useSyncExternalStore } from 'react'
import { cx } from './cx'

export type ArtName = 'silhouettes' | 'mat'
const FILE: Record<ArtName, string> = { silhouettes: 'hero-silhouettes', mat: 'hero-mat' }
const ALT: Record<ArtName, string> = {
  silhouettes: 'Two wrestlers locked up, printed in black and bone on torn red paper.',
  mat: 'A dorm room with mattresses laid out as a mat, a red and a blue start line taped across them.',
}

const q = '(prefers-reduced-data: reduce)'
const sub = (cb: () => void) => { const m = window.matchMedia?.(q); m?.addEventListener?.('change', cb); return () => m?.removeEventListener?.('change', cb) }
const reducedData = () => !!window.matchMedia?.(q).matches

export interface ArtProps {
  name: ArtName
  look?: 'hero' | 'card' | 'bg'
  /** above the fold: eager + fetchpriority high */
  priority?: boolean
  /** override the alt text; pass "" when decorative (bg is always decorative) */
  alt?: string
  /** CSS sizes hint (default: phone column) */
  sizes?: string
  className?: string
}

export default function Art({ name, look = 'card', priority, alt, sizes = '(max-width: 480px) 100vw, 480px', className }: ArtProps) {
  const skip = useSyncExternalStore(sub, reducedData, () => false)
  if (skip) return null
  const f = `/art/${FILE[name]}`
  const decorative = look === 'bg'
  return (
    <figure className={cx('art', look === 'hero' && 'art--hero', look === 'bg' && 'art--bg', look === 'card' && name === 'mat' && 'art--mat', className)}
      aria-hidden={decorative || undefined}>
      <picture>
        <source type="image/avif" srcSet={`${f}-600.avif 600w, ${f}-900.avif 900w`} sizes={sizes} />
        <source type="image/webp" srcSet={`${f}-600.webp 600w, ${f}-900.webp 900w`} sizes={sizes} />
        <img src={`${f}-900.webp`} width={900} height={1125} alt={decorative ? '' : alt ?? ALT[name]}
          loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} decoding="async" />
      </picture>
    </figure>
  )
}
