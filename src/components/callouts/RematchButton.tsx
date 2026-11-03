/**
 * "Ask for a rematch" on a settled bout, shown only to the user linked to the fighter who lost (C5).
 * Opens the Callouts page with the rematch form prefilled (target = the winner, inferred by create_callout).
 */
import { useAuth } from '../../lib/auth'
import type { Fight } from '../../lib/types'
import { ArrowCounterClockwise, ButtonLink, cx } from '../ui'
import './callouts.css'

type RematchFight = Pick<Fight, 'id' | 'status' | 'winner_side' | 'red_fighter_id' | 'blue_fighter_id'>

export function isRematchLoser(fight: RematchFight, fighterId: string | null | undefined): boolean {
  if (!fighterId || fight.status !== 'settled' || !fight.winner_side) return false
  const loser = fight.winner_side === 'red' ? fight.blue_fighter_id : fight.red_fighter_id
  return loser === fighterId
}

export default function RematchButton({ fight, className }: { fight: RematchFight; className?: string }) {
  const { profile } = useAuth()
  if (!isRematchLoser(fight, profile?.fighter_id)) return null
  return (
    <ButtonLink to={`/app/callouts?rematch=${fight.id}`} variant="ghost" size="sm" icon={ArrowCounterClockwise}
      className={cx('co-rematch-btn', className)}>
      Ask for a rematch
    </ButtonLink>
  )
}
