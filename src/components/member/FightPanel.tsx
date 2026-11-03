/**
 * One bout on Tonight: the composition switch for DESIGN 11.3.
 *   size "main"  the featured bout: taped poster when you can act on it (open and not your bout),
 *                flat paper when locked / booked / settled. Same <article> either way, so the LOCKED
 *                stamp can land when the lock passes while you watch.
 *   size "row"   undercard and results printed on ink (.bout). Open rows open the same pick ticket inline.
 *   A booking you must answer always renders the consent sheet (poster when the page allows one).
 * Data calls and realtime are unchanged from the previous FightPanel.
 */
import { useId, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { countdown } from '../../lib/math'
import { fmtNum, cancelCopy } from '../../lib/copy'
import { fmtRounds, must, useAsync, useDisplayNames, usePoll, useRealtime, type FightRow } from '../../lib/hooks'
import type { Bet, Fighter, FightPool, Side, VoteTotals } from '../../lib/types'
import { Alert, Button, Check, CheckCircle, HandPointing, Handshake, HourglassMedium, Skeleton, StatusStamp, Ticket } from '../ui'
import { BoutVs, Duel, ScoreRow, TaleOfTape } from './VsCard'
import ConsentAsk, { WaitList } from './ConsentPanel'
import PoolBar from './PoolBar'
import PickTicket from './PickTicket'
import Reactions, { type ReactionState } from './Reactions'
import LockedDetails, { CrowdPicks } from './LockedDetails'
import ShareButton from './ShareButton'
import LiveScore from './LiveScore'
import { Sheet } from './ui'
import { accepted, boutLabel, fmtDay, fmtTime, lockLeft, resultSentence } from './format'

export type CardSize = 'main' | 'row'

interface Props {
  fight: FightRow; red?: Fighter; blue?: Fighter; now: Date
  balance: number | null
  /** reload the header balance after a pick or take-back */
  onPointsChanged: () => void
  /** Called after accept/decline so the card list refetches. */
  onFightChanged?: () => void
  size?: CardSize
  /** this bout may use the screen's one taped poster */
  taped?: boolean
}

interface PanelData {
  pool: FightPool | null
  myVote: Side | null
  myBet: Bet | null
  reactions: ReactionState
  totals: VoteTotals | null
  bets: Bet[]
}

export default function FightPanel({ fight, red, blue, now, balance, onPointsChanged, onFightChanged, size = 'main', taped = false }: Props) {
  const { profile } = useAuth()
  const uid = profile?.id
  const hid = useId()
  const revealed = fight.status === 'locked' || fight.status === 'settled'

  const data = useAsync<PanelData>(async () => {
    const [pool, vote, mine, rx, totals, bets] = await Promise.all([
      supabase.from('fight_pools').select('*').eq('fight_id', fight.id).maybeSingle(),
      supabase.from('votes').select('side').eq('fight_id', fight.id).eq('user_id', uid ?? '').maybeSingle(),
      supabase.from('bets').select('*').eq('fight_id', fight.id).eq('user_id', uid ?? '').neq('status', 'cancelled')
        .order('created_at', { ascending: false }).limit(1),
      supabase.from('reactions').select('emoji,user_id').eq('fight_id', fight.id),
      revealed ? supabase.rpc('get_fight_vote_totals', { p_fight_id: fight.id }) : Promise.resolve({ data: null, error: null }),
      revealed
        ? supabase.from('bets').select('*').eq('fight_id', fight.id).neq('status', 'cancelled')
        : Promise.resolve({ data: [], error: null }),
    ])
    const counts: Record<string, number> = {}
    const mineRx = new Set<string>()
    for (const r of must(rx) as { emoji: string; user_id: string }[]) {
      counts[r.emoji] = (counts[r.emoji] ?? 0) + 1
      if (r.user_id === uid) mineRx.add(r.emoji)
    }
    const t = must(totals as { data: unknown; error: unknown })
    const totalsRow = (Array.isArray(t) ? t[0] : t) as VoteTotals | null | undefined
    return {
      pool: must(pool) as FightPool | null,
      myVote: ((must(vote) as { side: Side } | null)?.side) ?? null,
      myBet: ((must(mine) as Bet[])[0]) ?? null,
      reactions: { counts, mine: mineRx },
      totals: totalsRow ?? null,
      bets: (must(bets as { data: unknown; error: unknown }) as Bet[]) ?? [],
    }
  }, [fight.id, fight.status, uid])

  // optimistic reaction state, discarded whenever fresh server data arrives
  const [rxLocal, setRxLocal] = useState<{ base: PanelData; s: ReactionState } | null>(null)
  const rx = data.data ? (rxLocal?.base === data.data ? rxLocal.s : data.data.reactions) : null
  const setRx = (s: ReactionState) => { if (data.data) setRxLocal({ base: data.data, s }) }

  const live = fight.status === 'open' || fight.status === 'locked'
  useRealtime(`fight:${fight.id}`, [
    { table: 'fight_pools', filter: `fight_id=eq.${fight.id}` },
    { table: 'reactions', match: r => !('fight_id' in r) || r.fight_id === fight.id },
  ], () => void data.reload(), live)
  usePoll(() => void data.reload(), 10_000, live)

  const nameMap = useDisplayNames((data.data?.bets ?? []).map(b => b.user_id))

  // the result stamp lands only when the settle arrives while this bout is on screen
  const [firstStatus] = useState(fight.status)
  const landResult = fight.status === 'settled' && firstStatus !== 'settled'

  const [expanded, setExpanded] = useState(false)

  const redName = red?.nickname ?? 'Red corner', blueName = blue?.nickname ?? 'Blue corner'
  const pastLock = fight.status === 'open' && countdown(fight.lock_at, now).done
  const isOpen = fight.status === 'open' && !pastLock
  const isLocked = fight.status === 'locked' || pastLock
  const settled = fight.status === 'settled'
  const scheduled = fight.status === 'scheduled'
  const mySide: Side | null = !profile?.fighter_id ? null
    : profile.fighter_id === fight.red_fighter_id ? 'red'
    : profile.fighter_id === fight.blue_fighter_id ? 'blue' : null
  const participant = mySide != null
  const ok = accepted(fight)
  const iAccepted = mySide ? ok[mySide] : false
  const d = data.data
  const name = (s: Side) => (s === 'red' ? redName : blueName)

  const afterPick = async () => { await data.reload(); onPointsChanged() }
  const afterConsent = () => { void data.reload(); onFightChanged?.() }

  const loadErr = data.error && !d
    ? <Alert title="Couldn't load the picks for this bout." onRetry={() => void data.reload()}>Check your connection and try again. Picks you already made are saved.</Alert>
    : null

  // ---------- cancelled: always a row on ink (states-b) ----------
  if (fight.status === 'cancelled') {
    const c = cancelCopy(fight.cancel_kind)
    return (
      <article className="bout" aria-labelledby={hid}>
        <div className="bout-top">
          <StatusStamp status="cancelled" cancelKind={fight.cancel_kind} onInk rot={fight.cancel_kind === 'no_contest' ? 2 : -2} />
          <span className="data c-2 nowrap">{boutLabel(fight)} · {fmtTime(fight.scheduled_at)}</span>
        </div>
        <h3 id={hid} className="t-sub bout-h"><bdi>{redName}</bdi> <span className="vs-sm c-2">vs</span> <bdi>{blueName}</bdi></h3>
        <p className="t-help c-2 bout-sub">{c.sub}</p>
        {fight.result_note && <p className="t-help bout-sub">{fight.cancel_kind === 'no_contest' ? 'Ref note' : 'Reason'}: “{fight.result_note}”</p>}
      </article>
    )
  }

  // ---------- a booking you must answer ----------
  if (scheduled && mySide && !iAccepted) {
    return (
      <Sheet taped={taped} className="ask">
        <ConsentAsk fight={fight} redName={redName} blueName={blueName} mySide={mySide} onChanged={afterConsent} />
      </Sheet>
    )
  }

  const pickLine = (): ReactNode => {
    if (participant) return <>You’re in this one.</>
    if (!d) return null
    if (d.myBet && d.myBet.status === 'active') return <>You picked <b><bdi>{name(d.myBet.side)}</bdi></b> with {fmtNum(d.myBet.amount)}&nbsp;pts.</>
    if (d.myVote) return <>You picked <b><bdi>{name(d.myVote)}</bdi></b>. A free pick.</>
    return null
  }

  const yoursSettled = (): ReactNode => {
    if (!d || participant || !fight.winner_side) return null
    const b = d.myBet
    if (b?.status === 'won') return <>Your pick won. <b>{fmtNum(b.payout ?? 0)} pts</b> back to you.</>
    if (b?.status === 'lost') return <>Your {fmtNum(b.amount)} pts pick didn’t land.</>
    if (b?.status === 'refunded') return <>Your {fmtNum(b.amount)} pts came back.</>
    if (d.myVote) return d.myVote === fight.winner_side
      ? <>You called it: <b><bdi>{name(d.myVote)}</bdi></b>.</>
      : <>Your pick, <b><bdi>{name(d.myVote)}</bdi></b>, didn’t land this time.</>
    return null
  }

  const foot = (onInk: boolean) => rx && (
    <div className={onInk ? 'poster-foot bout-foot' : 'poster-foot'}>
      <Reactions fightId={fight.id} state={rx} onChange={setRx} onSynced={() => void data.reload()} onInk={onInk} />
      <ShareButton fight={fight} red={red} blue={blue} />
    </div>
  )

  const left = lockLeft(fight.lock_at, now)

  // ---------- rows on ink (undercard + finished bouts) ----------
  if (size === 'row') {
    const pickId = `${hid}-pick`
    const line = pickLine()
    const pool = d?.pool ? (d.pool.red_total + d.pool.blue_total) : 0
    return (
      <article className={settled ? 'bout bout--done' : 'bout'} aria-labelledby={hid}>
        <div className="bout-top">
          <StatusStamp status={fight.status} pastLock={pastLock} onInk land rot={isOpen ? -3 : 2} />
          <span className="data c-2 nowrap">{boutLabel(fight)} · {fmtTime(fight.scheduled_at)}</span>
        </div>
        <h3 id={hid} className="sr-only">
          {settled ? resultSentence(fight, redName, blueName) : `${redName}, red corner, versus ${blueName}, blue corner`}
        </h3>
        <BoutVs fight={fight} red={red} blue={blue} />
        {isLocked && <LiveScore fightId={fight.id} redName={redName} blueName={blueName} onInk />}

        {settled && (
          <>
            <div className="bout-result">
              <ScoreRow fight={fight} compact />
              <p className="t-help">
                <b><bdi>{fight.winner_side ? name(fight.winner_side) : ''}</bdi></b> won{fight.method ? ` by ${fight.method}` : ''}
                {fight.finish_move?.trim() ? `, ${fight.finish_move.trim()}` : ''}
                {fight.rounds ? <span className="nowrap"> · {fmtRounds(fight.rounds)}</span> : null}
              </p>
            </div>
            {yoursSettled() && <p className="bout-note t-help">{yoursSettled()}</p>}
            <details className="bout-more">
              <summary className="btn btn--ghost btn--sm">Full result</summary>
              {mainSheet()}
            </details>
          </>
        )}

        {scheduled && (
          <p className="bout-note t-help">
            {mySide && iAccepted
              ? <><CheckCircle /> You said yes. Waiting on <bdi>{name(mySide === 'red' ? 'blue' : 'red')}</bdi>.</>
              : ok.red !== ok.blue
                ? <><Check /> <bdi>{ok.red ? redName : blueName}</bdi> said yes. Waiting on <bdi>{ok.red ? blueName : redName}</bdi>. Picks open when both say yes.</>
                : <><HourglassMedium /> Waiting on both fighters to say yes. Picks open when both do.</>}
          </p>
        )}

        {isLocked && (
          <p className="bout-note t-help">
            {line}{line ? ' ' : ''}{pool > 0 ? <>Pool {fmtNum(pool)}&nbsp;pts.</> : 'No points in the pool.'}
            {d?.totals && (d.totals.red_votes + d.totals.blue_votes) > 0 && (
              <> Crowd: {d.totals.red_votes} picked red, {d.totals.blue_votes} picked blue.</>
            )}
          </p>
        )}

        {isOpen && (
          <>
            {line && <p className="bout-note t-help">{line}</p>}
            {!participant && (
              <Button variant="bone" size="sm" className="w-full bout-pick-btn" icon={HandPointing}
                aria-expanded={expanded} aria-controls={pickId} onClick={() => setExpanded(v => !v)}>
                {expanded ? 'Hide the pick' : line ? 'Change your pick' : <>Pick a winner · locks {fmtTime(fight.lock_at)}</>}
              </Button>
            )}
            <div id={pickId} className="bout-pick" hidden={!expanded && !participant}>
              {loadErr}
              {(expanded || participant) && (d
                ? <>
                    <PoolBar pool={d.pool} onInk />
                    {participant
                      ? <ParticipantTicket lockAt={fight.lock_at} />
                      : <PickTicket fightId={fight.id} pool={d.pool} balance={balance} myVote={d.myVote}
                          myBet={d.myBet?.status === 'active' ? d.myBet : null} redName={redName} blueName={blueName} onChanged={afterPick} />}
                    {foot(true)}
                  </>
                : !loadErr && <Skeleton h={160} className="mt-3" />)}
            </div>
          </>
        )}
      </article>
    )
  }

  // ---------- featured (main event) ----------
  // a plain render function (not a component), so nothing remounts on the 1s clock tick
  function mainSheet() {
    return (
      <Sheet taped={taped && isOpen && !participant && size === 'main' && !settled} className="main-sheet" aria-labelledby={hid}>
        <div className="ev-top">
          <StatusStamp status={fight.status} pastLock={pastLock} land rot={isOpen ? -4 : settled ? -2 : 2} />
          <span className="data">
            {settled ? <><span className="nowrap">{boutLabel(fight)}</span> · <span className="nowrap">{fmtDay(fight.settled_at ?? fight.scheduled_at)}</span></>
              : isLocked ? <span className="nowrap">Starts <b>{fmtTime(fight.scheduled_at)}</b></span>
              : <><span className="nowrap">{boutLabel(fight)}</span> <b>{fmtTime(fight.scheduled_at)}</b></>}
          </span>
        </div>
        {isOpen && left && <p className="data locks">Picks lock at <b>{fmtTime(fight.lock_at)}</b>, in <b className="nowrap">{left}</b></p>}
        {scheduled && <p className="data locks">{fmtDay(fight.scheduled_at)}</p>}
        {isLocked && <LiveScore fightId={fight.id} redName={redName} blueName={blueName} />}
        <h2 id={hid} className="sr-only">
          {settled ? resultSentence(fight, redName, blueName)
            : `${boutLabel(fight)}${isLocked ? ', picks locked' : ''}: ${redName}, red corner, versus ${blueName}, blue corner`}
        </h2>
        {settled && (
          <>
            <ScoreRow fight={fight} />
            {fight.rounds != null && <p className="data rounds"><b>{fmtRounds(fight.rounds)}</b></p>}
          </>
        )}
        <Duel fight={fight} red={red} blue={blue} priority={size === 'main'} landResult={landResult} />
        {!isLocked && <TaleOfTape fight={fight} red={red} blue={blue} />}

        {isOpen && ok.red && ok.blue && <p className="consent"><Handshake />Both fighters said yes</p>}
        {scheduled && (
          <>
            {mySide && iAccepted && <p className="consent"><CheckCircle />You said yes. Waiting on <bdi>{name(mySide === 'red' ? 'blue' : 'red')}</bdi>.</p>}
            <WaitList fight={fight} redName={redName} blueName={blueName} />
            <p className="t-help c-2 wait-help">Picks open when both fighters say yes.</p>
          </>
        )}
        {settled && fight.result_note && <blockquote className="ref">“{fight.result_note}”<cite>Ref note</cite></blockquote>}

        {loadErr}
        {!d && !loadErr && (isOpen || isLocked) && <Skeleton h={120} className="mt-4" />}

        {d && (isOpen || pastLock) && <PoolBar pool={d.pool} />}
        {d && fight.status === 'locked' && (
          <LockedDetails totals={d.totals} bets={d.bets} names={nameMap} myId={uid} settled={false} />
        )}
        {d && isOpen && (participant
          ? <ParticipantTicket lockAt={fight.lock_at} />
          : <PickTicket fightId={fight.id} pool={d.pool} balance={balance} myVote={d.myVote}
              myBet={d.myBet?.status === 'active' ? d.myBet : null} redName={redName} blueName={blueName} onChanged={afterPick} />)}
        {d && isLocked && <LockedYours d={d} participant={participant} name={name} />}
        {d && settled && yoursSettled() && <p className="yours">{yoursSettled()}</p>}
        {d && settled && (d.bets.length > 0 || (d.totals && d.totals.red_votes + d.totals.blue_votes > 0)) && (
          <details className="more">
            <summary className="btn btn--ghost btn--sm">Who picked what</summary>
            <CrowdPicks totals={d.totals} />
            <LockedDetails totals={d.totals} bets={d.bets} names={nameMap} myId={uid} settled crowd={false} />
          </details>
        )}
        {foot(false)}
      </Sheet>
    )
  }

  return mainSheet()
}

function ParticipantTicket({ lockAt }: { lockAt: string }) {
  return (
    <Ticket aria-label="Your bout">
      <h3 className="t-sub">You’re in this one</h3>
      <p className="t-help c-2">Picks and points are off for fighters in their own bout. Everyone else can pick until {fmtTime(lockAt)}.</p>
    </Ticket>
  )
}

function LockedYours({ d, participant, name }: { d: PanelData; participant: boolean; name: (s: Side) => string }) {
  if (participant) return <p className="yours">You’re in this one. Picks and points were off for you.</p>
  const b = d.myBet?.status === 'active' ? d.myBet : null
  if (b) {
    const sideTotal = (b.side === 'red' ? d.pool?.red_total : d.pool?.blue_total) ?? 0
    const total = (d.pool?.red_total ?? 0) + (d.pool?.blue_total ?? 0)
    const back = sideTotal > 0 ? Math.floor((b.amount * total) / sideTotal) : null
    return <p className="yours">Your pick: <b>{fmtNum(b.amount)} pts on <bdi>{name(b.side)}</bdi></b>.{back != null && <> About {fmtNum(back)} pts back if they win.</>}</p>
  }
  if (d.myVote) return <p className="yours">Your pick: <b><bdi>{name(d.myVote)}</bdi></b>. A free pick.</p>
  return <p className="yours">You didn’t pick this one. Picks are locked.</p>
}
