/**
 * /admin/ref/:fightId: the referee's phone during a bout (CONTRACT B4). It covers the app chrome
 * (header, tab bar) so the only things on screen are the clock, the two scores and their buttons.
 * Gate: is_referee() (admins today, role 'referee' in wave C), not linked to either fighter, no live
 * pick on the bout, and the bout must be locked (an open bout past lock_at is locked by the first tap).
 * "Finish bout" hands round + score to the result form: /admin/fights with route state settlePrefill.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useAsync } from '../../lib/hooks'
import type { Fighter } from '../../lib/types'
import type { AdminFight } from '../../components/admin/fightTypes'
import { ButtonLink, CaretLeft, EmptyState, Loading } from '../../components/ui'
import Scoreboard, { type FinishPrefill } from '../../components/referee/Scoreboard'
import { useInertOutside } from '../../components/referee/inert'
import '../../components/referee/referee.css'

export interface SettlePrefillState { settlePrefill: FinishPrefill }

interface RefData {
  fight: AdminFight | null
  red?: Fighter
  blue?: Fighter
  referee: boolean
  hasPick: boolean
}

export default function Referee() {
  const { fightId = '' } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const uid = profile?.id

  const data = useAsync<RefData>(async () => {
    const [fr, ref, mine] = await Promise.all([
      supabase.from('fights').select('*').eq('id', fightId).maybeSingle(),
      supabase.rpc('is_referee'),
      supabase.from('bets').select('id').eq('fight_id', fightId).eq('user_id', uid ?? '').eq('status', 'active').limit(1),
    ])
    const fight = must(fr) as AdminFight | null
    let red: Fighter | undefined, blue: Fighter | undefined
    if (fight) {
      const fx = must(await supabase.from('fighters').select('*').in('id', [fight.red_fighter_id, fight.blue_fighter_id])) as Fighter[]
      red = fx.find(f => f.id === fight.red_fighter_id)
      blue = fx.find(f => f.id === fight.blue_fighter_id)
    }
    return { fight, red, blue, referee: ref.error ? false : !!ref.data, hasPick: ((mine.data as unknown[]) ?? []).length > 0 }
  }, [fightId, uid])

  // the scoreboard owns the whole screen: stop the page underneath from scrolling
  useEffect(() => {
    const el = document.documentElement
    const prev = el.style.overflow
    el.style.overflow = 'hidden'
    return () => { el.style.overflow = prev }
  }, [])

  // ...and take the chrome it covers out of the tab order and the accessibility tree (WCAG 2.4.11):
  // header, tab bar, skip link and credit stay in the DOM under the overlay but become inert
  const [screen, setScreen] = useState<HTMLDivElement | null>(null)
  useInertOutside(screen)

  const reload = data.reload
  const onFightGone = useCallback(() => { void reload() }, [reload])
  const onFinish = useCallback((p: FinishPrefill) => {
    navigate('/admin/fights', { state: { settlePrefill: p } satisfies SettlePrefillState })
  }, [navigate])

  const back = <Link to="/admin/fights" className="back"><CaretLeft />Fights</Link>
  const backBtn = <ButtonLink to="/admin/fights" variant="bone" size="sm" icon={CaretLeft} className="mt-4">Back to fights</ButtonLink>

  const shell = (body: ReactNode) => (
    <div className="ref-screen" ref={setScreen}>
      <div className="ref-inner">{body}</div>
    </div>
  )

  if (data.loading && !data.data) return shell(<><header className="ref-head">{back}</header><Loading label="Loading the scoreboard…" shape="none" /></>)
  if (data.error && !data.data) {
    return shell(<><header className="ref-head">{back}</header>
      <EmptyState as="h1" title="Couldn't load the scoreboard" body={<>{data.error} Check your connection and try again.</>}
        action={<button type="button" className="btn btn--bone btn--sm mt-4" onClick={() => void data.reload()}>Try again</button>} /></>)
  }

  const d = data.data!
  const f = d.fight
  const redName = d.red?.nickname ?? 'Red corner', blueName = d.blue?.nickname ?? 'Blue corner'
  const blocked = (title: string, body: string) => shell(<><header className="ref-head">{back}</header>
    <EmptyState as="h1" title={title} body={body} action={backBtn} /></>)

  if (!f) return blocked('Bout not found', 'It may have been deleted. Pick a bout from the live card.')
  if (!d.referee) return blocked('Referees only', 'Only the referee can run the scoreboard.')
  if (f.status === 'settled') return blocked('This bout has a result', 'The scoreboard closes once a result is recorded. Fix a mistake with Correct result on the Fights tab.')
  if (f.status === 'cancelled') return blocked('This bout was called off', 'There is nothing left to score.')
  const isParticipant = !!profile?.fighter_id && [f.red_fighter_id, f.blue_fighter_id].includes(profile.fighter_id)
  if (isParticipant) return blocked('Not your bout to ref', "You're linked to a fighter in this bout, so another admin has to run the scoreboard.")
  if (d.hasPick) return blocked('Not your bout to ref', 'You have points on this bout, so another admin has to run the scoreboard.')
  const pastLock = new Date(f.lock_at).getTime() <= Date.now()
  if (f.status === 'scheduled' || (f.status === 'open' && !pastLock)) {
    return blocked('Lock picks first', 'The scoreboard opens once picks are locked, so nobody can pick after the first point. Lock picks from the bout sheet.')
  }

  const boutLabel = f.is_main_event ? 'Main event' : `Bout ${f.bout_order ?? ''}`.trim()
  return shell(
    <Scoreboard fightId={f.id} redName={redName} blueName={blueName} boutLabel={boutLabel}
      back={back} onFinish={onFinish} onFightGone={onFightGone} />,
  )
}
