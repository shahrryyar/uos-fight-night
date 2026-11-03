/** "Call out" on a fighter profile: only when the viewer is a linked fighter and this is someone else. */
import { useAuth } from '../../lib/auth'
import { ButtonLink, MegaphoneSimple, cx } from '../ui'
import './callouts.css'

export default function CallOutButton({ fighterId, hidden, className }: { fighterId: string; hidden?: boolean; className?: string }) {
  const mine = useAuth().profile?.fighter_id ?? null
  if (!mine || mine === fighterId || hidden) return null
  return (
    <ButtonLink to={`/app/callouts?target=${fighterId}`} size="sm" icon={MegaphoneSimple} className={cx('co-callout-btn', className)}>
      Call out
    </ButtonLink>
  )
}

/** Header link to the board (Fighters page). Not a 6th tab. */
export function CalloutsLink({ className }: { className?: string }) {
  return (
    <ButtonLink to="/app/callouts" variant="ghost" size="sm" icon={MegaphoneSimple} className={className}>
      Callouts
    </ButtonLink>
  )
}
