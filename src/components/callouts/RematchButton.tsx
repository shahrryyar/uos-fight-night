/**
 * "Ask for a rematch" on a settled bout, shown only to the user linked to the fighter who lost (C5).
 * Opens the Callouts page with the rematch form prefilled (target = the winner, inferred by create_callout).
 */
import { useAuth } from '../../lib/auth'
import { ArrowCounterClockwise, ButtonLink, cx } from '../ui'
import { isRematchLoser, type RematchFight } from './format'
import './callouts.css'

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
