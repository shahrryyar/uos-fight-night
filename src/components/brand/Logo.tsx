/**
 * Brand logo: "FN in a red mat ring with red/blue start lines".
 * Use the LOCKUP (UOS WRESTLING / FIGHT NIGHT) wherever width allows: landing, login, poster, og.
 * Use the MARK alone only in tight spots: header left, favicon, app icon, avatar.
 * Files live in public/brand/ (SVG, cached immutable). tone: dark = for ink backgrounds,
 * light = for bone paper, mono = single bone colour (on photos / busy art).
 */
import type { ImgHTMLAttributes } from 'react'
import { getBrandTitle } from '../../lib/brand'

export type LogoVariant = 'mark' | 'lockup'
export type LogoTone = 'dark' | 'light' | 'mono'

/** lockup viewBox is trimmed to the artwork: 755 x 308 */
export const LOCKUP_RATIO = 755 / 308

const FILES: Record<LogoVariant, Record<LogoTone, string>> = {
  mark: { dark: '/brand/mark.svg', light: '/brand/mark-light.svg', mono: '/brand/mark-mono.svg' },
  lockup: { dark: '/brand/lockup.svg', light: '/brand/lockup-light.svg', mono: '/brand/lockup-mono.svg' },
}

export interface LogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height' | 'alt'> {
  variant?: LogoVariant
  tone?: LogoTone
  /** rendered HEIGHT in CSS px (mark: width = height). Default mark 32, lockup 96 */
  size?: number
  /** accessible name; default league title. Ignored when decorative */
  alt?: string
  /** true when a visible text label sits next to it (alt="") */
  decorative?: boolean
  /** above-the-fold hero use: eager + fetchpriority high */
  priority?: boolean
}

export default function Logo({ variant = 'mark', tone = 'dark', size, alt, decorative, priority, className = '', ...rest }: LogoProps) {
  const h = size ?? (variant === 'mark' ? 32 : 96)
  const w = variant === 'mark' ? h : Math.round(h * LOCKUP_RATIO)
  const altText = decorative ? '' : (alt ?? getBrandTitle())
  return (
    <img src={FILES[variant][tone]} width={w} height={h} alt={altText}
      className={`logo ${className}`.trim()} decoding="async"
      loading={priority ? 'eager' : undefined} fetchPriority={priority ? 'high' : undefined}
      draggable={false} translate="no" {...rest} />
  )
}
