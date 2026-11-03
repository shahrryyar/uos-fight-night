/**
 * Shop items on ink (lists are material C). Each tile previews the item honestly:
 *   ColorTile  a split swatch, "Aa" in the ink-surface ink and in the paper-surface ink (both are AA)
 *   FrameTile  your own name inside that frame
 *   TitleRow   the title as it reads next to a name
 * The decision (Unlock / Wear it / Take it off) is ItemActions.
 */
import type { ReactNode } from 'react'
import type { ShopItem } from '../../lib/types'
import { cx } from '../ui'
import MemberName from '../MemberName'
import ItemActions, { type ItemActionsProps } from './ItemActions'
import { COLOR_INK, isNameColor } from './cosmetics'

type Actions = Omit<ItemActionsProps, 'item'>

interface TileProps { item: ShopItem; actions: Actions; me: { id: string | undefined; name: string } }

function Tile({ item, actions, preview, className }: { item: ShopItem; actions: Actions; preview: ReactNode; className?: string }) {
  return (
    <li className={cx('shop-tile', className, actions.wearing && 'is-on', actions.owned && 'is-owned')}>
      <div className="shop-prev">{preview}</div>
      <h3 className="t-sub shop-name">{item.label}</h3>
      <ItemActions item={item} {...actions} />
    </li>
  )
}

export function ColorTile({ item, actions }: TileProps) {
  const c = isNameColor(item.value) ? COLOR_INK[item.value] : null
  return (
    <Tile item={item} actions={actions} className="shop-tile--color" preview={
      <span className="sw" role="img" aria-label={`${item.label} ink on the dark wall and on paper`}>
        <span className="sw-ink" style={c ? { color: c.ink } : undefined} aria-hidden="true">Aa</span>
        <span className="sw-paper" style={c ? { color: c.paper } : undefined} aria-hidden="true">Aa</span>
      </span>
    } />
  )
}

export function FrameTile({ item, actions, me }: TileProps) {
  return (
    <Tile item={item} actions={actions} className="shop-tile--frame" preview={
      <span className="t-sub"><MemberName userId={me.id} name={me.name} title="none" surface="ink"
        preview={{ frame: item.value, name_color: null }} /></span>
    } />
  )
}

export function TitleRow({ item, actions, me, text }: TileProps & { text?: string | null }) {
  const label = text ?? item.value ?? item.label
  return (
    <li className={cx('row shop-title', actions.wearing && 'is-on')}>
      <span className="shop-title-main">
        <span className="t-sub shop-name">“{label}”</span>
        <span className="shop-title-prev">
          <MemberName userId={me.id} name={me.name} surface="ink" frame={false} preview={{ title: label, name_color: null }} />
        </span>
      </span>
      <ItemActions item={{ ...item, label: `“${label}”` }} {...actions} />
    </li>
  )
}
