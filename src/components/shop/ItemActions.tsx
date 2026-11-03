/**
 * The one decision on a shop item: Unlock (inline confirm, no modal) / Wear it / Take it off.
 * Spending points always has a confirm step that names the cost and what is left (WIG destructive rule).
 */
import { useEffect, useRef } from 'react'
import { fmtNum } from '../../lib/copy'
import type { ShopItem } from '../../lib/types'
import { Button, FieldError, Stamp } from '../ui'

export interface ItemState {
  owned: boolean
  wearing: boolean
}

export interface ItemActionsProps extends ItemState {
  item: Pick<ShopItem, 'code' | 'label' | 'price'>
  balance: number | null
  confirming: boolean
  busy: boolean
  error: string | null
  onAsk: () => void
  onCancel: () => void
  onUnlock: () => void
  onWear: () => void
  onTakeOff: () => void
}

export default function ItemActions({ item, owned, wearing, balance, confirming, busy, error, onAsk, onCancel, onUnlock, onWear, onTakeOff }: ItemActionsProps) {
  const root = useRef<HTMLDivElement>(null)
  const wasConfirming = useRef(confirming)
  useEffect(() => {
    // move focus with the step: onto "Spend", back onto "Unlock" after Back, onto "Wear it" after unlocking
    if (confirming !== wasConfirming.current) root.current?.querySelector<HTMLButtonElement>('button')?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  const err = error && <div className="shop-err"><FieldError>{error}</FieldError></div>

  if (wearing) {
    return (
      <div ref={root} className="shop-act">
        <Stamp tone="bone" size="sm" rot={-3} land stateKey={`${item.code}-on`}>Wearing</Stamp>
        <Button variant="ghost" size="sm" busy={busy} busyLabel="Taking off" onClick={onTakeOff}>Take it off</Button>
        {err}
      </div>
    )
  }
  if (owned) {
    return (
      <div ref={root} className="shop-act">
        <p className="data shop-have">Yours</p>
        <Button variant="bone" size="sm" busy={busy} busyLabel="Putting on" onClick={onWear}>Wear it</Button>
        {err}
      </div>
    )
  }

  const short = balance != null ? item.price - balance : 0
  if (confirming) {
    const left = balance != null ? balance - item.price : null
    return (
      <div ref={root} className="shop-act shop-confirm" role="group" aria-label={`Unlock ${item.label}`}>
        <p className="t-help">
          Spend <b className="nowrap">{fmtNum(item.price)}&nbsp;pts</b> on {item.label}?
          {left != null && <> You'll have <b className="nowrap">{fmtNum(left)}</b> left.</>}
        </p>
        <Button size="sm" busy={busy} busyLabel="Unlocking" onClick={onUnlock}>Spend {fmtNum(item.price)}&nbsp;pts</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Back</Button>
        {err}
      </div>
    )
  }
  return (
    <div ref={root} className="shop-act">
      <p className="data shop-price"><b>{fmtNum(item.price)}</b>&nbsp;pts</p>
      {short > 0
        ? <p className="t-help shop-short">{fmtNum(short)} more pts to unlock</p>
        : <Button variant="bone" size="sm" onClick={onAsk}>Unlock</Button>}
      {err}
    </div>
  )
}
