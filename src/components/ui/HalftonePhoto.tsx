/**
 * Fighter photo through the canvas halftone (DESIGN 8). The ONLY way fighter photos render.
 * Fallback chain: plain grayscale <img> while computing -> keep it on CORS/canvas error -> typed initials with no photo.
 *
 *   <HalftonePhoto path={f.photo_path} name={f.nickname} size={170} aspect="4 / 3" priority />   main event, paper
 *   <HalftonePhoto path={f.photo_path} name={f.nickname} size={48} ink="bone" />                 undercard row on ink
 *   <HalftonePhoto src={objectUrl} name="Preview" size={160} />                                   admin upload preview
 *
 * Renders the .ht box itself (border, aspect). Put a .corner band before it for corner colour.
 */
import { useEffect, useState } from 'react'
import { useSignedPhoto } from '../FighterPhoto'
import { BONE_RGB, TONER_RGB, tryHalftoneUrl, whenIdle } from '../../lib/halftone'
import { cx } from './cx'

export interface HalftonePhotoProps {
  /** private storage path in fighter-photos (signed automatically) */
  path?: string | null
  /** direct URL (object URL / already-signed URL); wins over path */
  src?: string | null
  /** fighter nickname: alt text and initials */
  name: string
  /** toner dots for paper (default), bone dots for ink */
  ink?: 'toner' | 'bone'
  /** rendered width in CSS px (sets canvas resolution) */
  size: number
  /** CSS aspect-ratio of the box, e.g. "4 / 3", "6 / 5" (default 1) */
  aspect?: string
  /** above the fold: eager + fetchpriority high */
  priority?: boolean
  /** extra sr text, e.g. "Red corner" */
  alt?: string
  className?: string
}

export function initialsOf(name: string) {
  const p = name.replace(/["'“”‘’]/g, '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase()
}

function ratio(aspect?: string) {
  if (!aspect) return 1
  const [a, b] = aspect.split('/').map(s => Number(s.trim()))
  return a > 0 && b > 0 ? a / b : 1
}

export default function HalftonePhoto({ path, src, name, ink = 'toner', size, aspect, priority, alt, className }: HalftonePhotoProps) {
  const signed = useSignedPhoto(src ? null : path)
  const url = src ?? signed
  const [ht, setHt] = useState<{ for: string; url: string } | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const px = Math.min(720, Math.round(size * dpr))
    // match the generator's density (gen_assets.py: cell 7 on 360px toner, cell 5 on 160px bone),
    // so a photo carries ~51 toner / ~32 bone cells across at any rendered size; floor 2 CSS px per cell
    const bone = ink === 'bone'
    const cell = Math.max(2 * dpr, ((bone ? 5 : 7) * px) / (bone ? 160 : 360))
    const cancel = whenIdle(() => {
      void tryHalftoneUrl(url, `${path ?? url}|${px}|${ink}|${cell.toFixed(2)}`, { px, cell, light: ink === 'bone', rgb: ink === 'bone' ? BONE_RGB : TONER_RGB })
        .then(u => { if (live && u) setHt({ for: url, url: u }) })
    })
    return () => { live = false; cancel() }
  }, [url, path, size, ink])
  const h = Math.round(size / ratio(aspect))
  const done = ht && ht.for === url ? ht.url : null
  const label = alt ? `${name}, ${alt}` : name
  return (
    <div className={cx('ht', ink === 'bone' && 'ht--ink', className)} style={aspect ? { aspectRatio: aspect } : undefined}>
      {url
        ? <img src={done ?? url} alt={label} width={size} height={h} className={done ? undefined : 'ht-pending'}
            loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} decoding="async" />
        : <span className={cx('ht-fallback', size < 64 && 'sm')} role="img" aria-label={label}>{initialsOf(name)}</span>}
    </div>
  )
}
