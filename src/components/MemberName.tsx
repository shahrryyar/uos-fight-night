/**
 * <MemberName userId name? /> (C6): a member's display name with their equipped cosmetics.
 *   colour  name in a per-surface ink (AA on paper and on ink; see shop/cosmetics.ts COLOR_INK)
 *   frame   a nameplate around the name: flame (solid rule + flame glyph), chain (dashed rule + link glyph),
 *           crown (double rule + crown glyph; never the ChampionBelt)
 *   title   a small label after the name (or below it with title="below")
 * Typography is inherited (t-sub in rows, t-title in the Me header), so it drops into any slot.
 *
 * Surface is detected from the nearest sheet in CSS (.paper, .poster, .stub, .row--me use the paper inks;
 * .ticket goes back to ink). Pass `surface` to force one. `preview` overrides the equipped look (shop try-on).
 */
import type { ReactNode } from 'react'
import { cx } from './ui'
import { CrownSimple, Fire, Link as LinkGlyph } from './shop/shopIcons'
import { isFrame, isNameColor, useCosmetics, useNameOf, type Frame } from './shop/cosmetics'
import './shop/memberName.css'

export interface CosmeticLook { name_color?: string | null; frame?: string | null; title?: string | null }

export interface MemberNameProps {
  userId: string | null | undefined
  /** display name the caller already has (skips the lookup) */
  name?: string | null
  /** shown while the name loads or when it is unknown */
  fallback?: string
  surface?: 'auto' | 'ink' | 'paper'
  title?: 'after' | 'below' | 'none'
  /** draw the frame (default true); off for very tight spots */
  frame?: boolean
  /** replaces the equipped look (keys present in the object win, null = none) */
  preview?: CosmeticLook
  className?: string
  /** extra content after the name inside the same line (e.g. a "(you)" marker) */
  children?: ReactNode
}

const FRAME_GLYPH: Record<Frame, typeof Fire> = { flame: Fire, chain: LinkGlyph, crown: CrownSimple }

export default function MemberName({
  userId, name, fallback = 'Member', surface = 'auto', title = 'after', frame = true, preview, className, children,
}: MemberNameProps) {
  const all = useCosmetics()
  const looked = useNameOf(userId, !!name)
  const eq = userId ? all?.get(userId) : undefined
  const pick = <K extends keyof CosmeticLook>(k: K) => (preview && k in preview ? preview[k] : eq?.[k]) ?? null

  const color = pick('name_color')
  const fr = frame ? pick('frame') : null
  const t = title === 'none' ? null : pick('title')?.trim() || null
  const c = isNameColor(color) ? color : null
  const f = isFrame(fr) ? fr : null
  const Glyph = f ? FRAME_GLYPH[f] : null
  const shown = name?.trim() || looked || fallback

  return (
    <span className={cx('mn', f && `mn--f-${f}`, title === 'below' && t && 'mn--stack', surface !== 'auto' && `mn--on-${surface}`, className)}
      data-c={c ?? undefined}>
      <span className="mn-plate">
        {Glyph && <Glyph className="mn-glyph" />}
        <bdi className="mn-name">{shown}</bdi>
      </span>
      {t && <span className="mn-title"><span className="sr-only">, </span><bdi>{t}</bdi></span>}
      {children}
    </span>
  )
}
