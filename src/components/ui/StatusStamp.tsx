/**
 * Stamp driven by fight status (DESIGN 11.3 stamp map + 11.7 tones).
 *   on paper (default): open = red "Picks open", locked = ink + lock "Locked", settled = ink "Final",
 *                       scheduled = ink "Booked", cancelled = ink "Called off" / "No contest"
 *   onInk:              open = live (bone on red fill), everything else = bone
 */
import type { CancelKind, FightStatus } from '../../lib/types'
import { statusStampText } from '../../lib/copy'
import Stamp, { type StampProps, type StampTone } from './Stamp'
import { LockSimple } from './Icon'

export interface StatusStampProps extends Omit<StampProps, 'children' | 'tone' | 'icon'> {
  status: FightStatus
  cancelKind?: CancelKind | null
  /** open but past lock time: renders as Locked */
  pastLock?: boolean
  /** the stamp sits on the ink wall (undercard rows, lists) */
  onInk?: boolean
}

export default function StatusStamp({ status, cancelKind, pastLock, onInk, size, ...rest }: StatusStampProps) {
  const text = statusStampText(status, { cancelKind, pastLock })
  const locked = status === 'locked' || (status === 'open' && pastLock)
  const open = status === 'open' && !pastLock
  const tone: StampTone = onInk ? (open ? 'live' : 'bone') : open ? 'red' : 'ink'
  const sz = size ?? (onInk || status === 'scheduled' || status === 'cancelled' ? 'sm' : 'md')
  return <Stamp tone={tone} size={sz} icon={locked ? LockSimple : undefined} stateKey={text} {...rest}>{text}</Stamp>
}
