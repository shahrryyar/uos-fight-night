import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { statusStampText } from '../../lib/copy'
import type { PublicNextFight } from '../../lib/types'
import { MatDivider } from '../brand'
import { Alert, EmptyState, Paper, Skeleton, Stamp } from '../ui'
import { useRemaining } from './Countdown'
import { ChampTag, TitleFightMark } from '../belt'

/** public_next_fight() row. Public page: nicknames and kg only, never photos or real names. */
export type NextFightRow = PublicNextFight
type State = { kind: 'loading' } | { kind: 'none' } | { kind: 'error' } | { kind: 'fight'; fight: NextFightRow }

/** 72.5 -> "72.5 kg", 70 -> "70 kg", null/invalid -> null. numeric may arrive as a string. */
function fmtKg(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`
}

const TZ = 'Asia/Baghdad'
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const longDayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** "Thu 6 Nov" (Baghdad) */
const fmtDay = (iso: string) => dayFmt.format(new Date(iso)).replace(',', '')
/** "22:30" (24h, Baghdad) */
const fmtTime = (iso: string) => timeFmt.format(new Date(iso))

function useNextFight() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('public_next_fight')
    const row = (Array.isArray(data) ? data[0] : data) as NextFightRow | null | undefined
    if (error) setState(s => (s.kind === 'fight' ? s : { kind: 'error' }))
    else if (!row || !row.id) setState({ kind: 'none' })
    else setState({ kind: 'fight', fight: row })
  }, [])
  useEffect(() => {
    let alive = true
    const run = () => { if (alive) void load() }
    run()
    // refresh so a bout that locks while the page is open updates (the stamp lands on the change)
    const id = setInterval(run, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [load])
  const retry = useCallback(() => { setState({ kind: 'loading' }); void load() }, [load])
  return { state, retry }
}

function When({ fight, pastLock }: { fight: NextFightRow; pastLock: boolean }) {
  const r = useRemaining(fight.scheduled_at)
  const picks = fight.status === 'open' && !pastLock
    ? <>Picks lock <b>{fmtTime(fight.lock_at)}</b></>
    : <>Picks locked</>
  return (
    <div className="when">
      {r.done ? (
        <>
          <p className="label">Started</p>
          <p className="t-sub">On the mat now</p>
        </>
      ) : (
        <>
          <p className="label">{fight.is_main_event ? 'Main event in' : 'Starts in'}</p>
          <p className="data-lg"><time dateTime={fight.scheduled_at}>{r.text}</time></p>
        </>
      )}
      <p className="data">{picks}</p>
    </div>
  )
}

function Flyer({ fight }: { fight: NextFightRow }) {
  const day = fmtDay(fight.scheduled_at)
  const time = fmtTime(fight.scheduled_at)
  const redKg = fmtKg(fight.red_weight_kg)
  const blueKg = fmtKg(fight.blue_weight_kg)
  const pastLock = useRemaining(fight.lock_at).done
  const stamp = statusStampText(fight.status, { pastLock })
  // Stamps are state only. Open with picks running reads from "Picks lock 21:45" under the countdown
  // (no stamp row, like the mockup), so the stamp only shows once the state turns (Locked, Booked...).
  // It stays mounted but hidden so it lands when the bout locks while the page is open.
  const quiet = fight.status === 'open' && !pastLock
  // admins often title the main event "Main event": the countdown label already says it
  const showTitle = !!fight.title && !['main event', 'title fight', stamp.toLowerCase()].includes(fight.title.trim().toLowerCase())
  // B5: the champion's corner gets the belt plate; otherwise the reigning champion is named under the countdown
  const champSide = fight.is_title_fight ? fight.champion_side : null
  const champLine = !champSide && fight.champion_nickname ? fight.champion_nickname : null
  return (
    <Paper as="article" edges="both" bleed className={quiet ? 'flyer' : 'flyer flyer--stamped'} aria-labelledby="nf-h">
      <p className="snipe"><span className="nowrap">{day}</span> · <span className="data">{time}</span></p>
      <h2 id="nf-h" className="sr-only">
        Next fight, {longDayFmt.format(new Date(fight.scheduled_at))} at {time}.
        {fight.is_main_event ? ' Main event: ' : ' '}{fight.is_title_fight ? 'Title fight: ' : ''}{fight.red_nickname} versus {fight.blue_nickname}.
        {champSide && ` ${champSide === 'red' ? fight.red_nickname : fight.blue_nickname} is the champion.`}
      </h2>
      <Stamp className="flyer-stamp" rot={-4} land stateKey={`${stamp}|${fight.status}`} hidden={quiet} aria-hidden="true">{stamp}</Stamp>
      {fight.is_title_fight && <TitleFightMark className="flyer-titlemark" belt={34} />}
      {showTitle && <p className="flyer-title t-sub">{fight.title}</p>}
      <p className="t-poster c-red first" aria-hidden="true"><bdi>{fight.red_nickname}</bdi></p>
      <p className="corner-line">
        <span className="corner corner--red label">Red corner</span>
        {redKg && <span className="data"><b>{redKg}</b></span>}
        {champSide === 'red' && <ChampTag size={30} className="flyer-champ" />}
      </p>
      <div className="vs-band" aria-hidden="true"><span className="stamp stamp--lg">VS</span></div>
      <p className="t-poster c-blue" aria-hidden="true"><bdi>{fight.blue_nickname}</bdi></p>
      <p className="corner-line">
        <span className="corner corner--blue label">Blue corner</span>
        {blueKg && <span className="data"><b>{blueKg}</b></span>}
        {champSide === 'blue' && <ChampTag size={30} className="flyer-champ" />}
      </p>
      <MatDivider className="flyer-divider" />
      <When fight={fight} pastLock={pastLock} />
      {champLine && <p className="flyer-reign"><span className="label">Champion</span> <b className="t-sub"><bdi>{champLine}</bdi></b></p>}
    </Paper>
  )
}

/** Built from the flyer's own classes (names sized in em of the poster type), so it is the loaded
 *  flyer's height at every breakpoint and the CTA under it does not jump when the fight arrives. */
function FlyerSkeleton() {
  return (
    <div className="flyer-loading" role="status" aria-live="polite">
      <Paper edges="both" bleed className="flyer">
        <span className="label flyer-loading-label">Loading the next fight…</span>
        <p className="t-poster first"><Skeleton w="86%" h="1.76em" /></p>
        <p className="corner-line"><Skeleton w={150} h={24} /></p>
        <div className="vs-band"><Skeleton w={84} h="72%" /></div>
        <p className="t-poster"><Skeleton className="sk-name-b" w="68%" h="" /></p>
        <p className="corner-line"><Skeleton w={150} h={24} /></p>
        <Skeleton className="flyer-divider" h={20} />
        <div className="when"><Skeleton h="3.4rem" style={{ gridColumn: '1 / -1' }} /></div>
      </Paper>
    </div>
  )
}

export default function NextFight() {
  const { state, retry } = useNextFight()
  if (state.kind === 'loading') return <FlyerSkeleton />
  if (state.kind === 'error') {
    return (
      <Alert title="Couldn't load the next fight." onRetry={retry}>
        Check your connection and try again.
      </Alert>
    )
  }
  if (state.kind === 'none') {
    return (
      <EmptyState art="mat" title="Nothing on the card yet"
        body="The next fight shows up here once admins book it and both fighters say yes." />
    )
  }
  return <Flyer fight={state.fight} />
}
