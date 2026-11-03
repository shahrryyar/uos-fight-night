/**
 * Fight of the Night (CONTRACT C4) for one finished card, on flat paper (a form: material B).
 *   open    the sheet's stamp is real state (VOTING OPEN, then VOTED, landing on change), a closes-in
 *           countdown, a radiogroup of the card's settled bouts (your own bout is off), one CTA.
 *   closed  the FIGHT OF THE NIGHT stamp on the winning bout, the vote counts, and the fighter badge both
 *           fighters earned (existing <BadgeChip/>). No votes: an honest "no winner" line.
 * Results stay hidden until the window closes (the RPC returns no counts before that).
 * The countdown uses the device clock and refetches at zero (get_fotn finalizes lazily).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { METHOD_LABEL, useNow } from '../../lib/hooks'
import { BADGES, type CardRecap, type CardRecapFight, type FotnState } from '../../lib/types'
import { BadgeChip } from '../badges'
import { Button, CheckFat, FieldError, Paper, Stamp, cx, useToast } from '../ui'
import { StarMark } from './StarMark'
import { boutName, closesIn, fotnError } from './fotnUtils'
import './fotn.css'

const nick = (n: string | null | undefined) => n?.trim() || 'Fighter'

/** "6–3 · Pin, half nelson" (one middle dot at most). */
function summary(f: CardRecapFight): string {
  const score = f.red.score != null && f.blue.score != null ? `${f.red.score}–${f.blue.score}` : ''
  const m = f.method ? METHOD_LABEL[f.method] ?? f.method : ''
  const mv = f.finish_move?.trim()
  const how = m && mv ? `${m}, ${mv.toLowerCase()}` : m || mv || ''
  return [score, how].filter(Boolean).join(' · ')
}

function Matchup({ f, size = 'sub' }: { f: CardRecapFight; size?: 'sub' | 'bout' }) {
  return (
    <span className={cx('fotn-vs', size === 'bout' && 'fotn-vs--bout')}>
      <bdi className="fotn-nm fotn-nm--red">{nick(f.red.nickname)}</bdi>
      <span className="fotn-vs-word"> vs </span>
      <bdi className="fotn-nm fotn-nm--blue">{nick(f.blue.nickname)}</bdi>
    </span>
  )
}

export interface FotnPanelProps {
  recap: CardRecap
  fotn: FotnState
  onVoted?: (next: FotnState) => void
  /** refetch (the countdown hit zero) */
  onExpired?: () => void
  className?: string
}

export default function FotnPanel({ recap, fotn, onVoted, onExpired, className }: FotnPanelProps) {
  if (fotn.status === 'not_ready') return null
  return fotn.status === 'open'
    ? <VotePanel recap={recap} fotn={fotn} onVoted={onVoted} onExpired={onExpired} className={className} />
    : <ResultPanel recap={recap} fotn={fotn} className={className} />
}

function VotePanel({ recap, fotn, onVoted, onExpired, className }: FotnPanelProps) {
  const now = useNow(1000)
  const { profile } = useAuth()
  const toast = useToast()
  const hid = useId()
  const [sel, setSel] = useState<string | null>(fotn.my_vote)
  const [prevMyVote, setPrevMyVote] = useState(fotn.my_vote)
  if (prevMyVote !== fotn.my_vote) {
    setPrevMyVote(fotn.my_vote)
    setSel(fotn.my_vote)
  }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fired = useRef(false)
  const left = closesIn(fotn.closes_at, now)

  useEffect(() => {
    if (left.done && !fired.current) { fired.current = true; onExpired?.() }
  }, [left.done, onExpired])

  const byId = new Map(recap.fights.map(f => [f.fight_id, f]))
  const candidates = fotn.candidates.map(id => byId.get(id)).filter((f): f is CardRecapFight => !!f)
  const fid = profile?.fighter_id ?? null
  const mine = (f: CardRecapFight) => !!fid && (f.red.fighter_id === fid || f.blue.fighter_id === fid)
  const voted = !!fotn.my_vote
  const choice = sel ? byId.get(sel) : undefined
  const pickable = candidates.filter(f => !mine(f))

  const cast = async () => {
    if (!sel || sel === fotn.my_vote) return
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('cast_fotn_vote', { p_fight_id: sel })
    setBusy(false)
    if (error) { setErr(fotnError(error)); return }
    const next = data as FotnState
    toast(fotn.my_vote ? 'Vote changed.' : 'Vote saved. Results show when voting closes.', { icon: CheckFat })
    onVoted?.(next)
  }

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key) || !pickable.length) return
    e.preventDefault()
    const i = pickable.findIndex(f => f.fight_id === sel)
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
    const next = pickable[(i + d + pickable.length) % pickable.length]
    setSel(next.fight_id)
    ;(e.currentTarget.querySelector(`[data-id="${next.fight_id}"]`) as HTMLButtonElement | null)?.focus()
  }

  const changing = voted && !!sel && sel !== fotn.my_vote
  const cta = choice ? `${changing ? 'Change vote to' : 'Vote'} ${nick(choice.red.nickname)} vs ${nick(choice.blue.nickname)}` : 'Pick a bout first'

  return (
    <Paper as="section" className={cx('fotn', className)} aria-labelledby={hid}>
      <div className="ev-top">
        <Stamp tone={voted ? 'ink' : 'red'} size="sm" rot={-3} land stateKey={voted ? 'voted' : 'open'}>{voted ? 'Voted' : 'Voting open'}</Stamp>
        {left.label && !left.done && <span className="data nowrap">Closes in <b>{left.label}</b></span>}
      </div>
      <h2 id={hid} className="t-head fotn-h"><StarMark />Fight of the Night</h2>
      <p className="t-help c-2 fotn-help">Pick the best bout of the card. The result shows when voting closes.</p>

      <div className="fotn-opts" role="radiogroup" aria-labelledby={hid} onKeyDown={onKey}>
        {candidates.map(f => {
          const off = mine(f)
          const checked = sel === f.fight_id
          const tab = checked || (!sel && f === pickable[0]) ? 0 : -1
          return (
            <button key={f.fight_id} type="button" role="radio" aria-checked={checked} data-id={f.fight_id}
              disabled={off || busy} tabIndex={off ? -1 : tab} className="fotn-opt" onClick={() => { setSel(f.fight_id); setErr(null) }}>
              <span className="fotn-opt-top">
                <span className="label">{boutName(f)}</span>
                {fotn.my_vote === f.fight_id && <span className="label fotn-yours">Your vote</span>}
              </span>
              <Matchup f={f} />
              {off ? <span className="t-help fotn-meta">You’re in this one. Vote for another bout.</span> : <span className="data fotn-meta">{summary(f)}</span>}
              <CheckFat className="fotn-tick" />
            </button>
          )
        })}
      </div>

      {changing || !voted
        ? <Button wrap className="fotn-cta" busy={busy} busyLabel="Saving" disabled={!sel}
            onClick={() => void cast()}>{cta}</Button>
        : null}
      <div aria-live="polite" className="fotn-live">
        {err ? <FieldError>{err}</FieldError>
          : voted && !changing ? <p className="t-help fotn-in"><CheckFat /> Your vote is in. Tap another bout to change it before voting closes.</p>
          : null}
      </div>
    </Paper>
  )
}

function ResultPanel({ recap, fotn, className }: Omit<FotnPanelProps, 'onVoted' | 'onExpired'>) {
  const hid = useId()
  const byId = new Map(recap.fights.map(f => [f.fight_id, f]))
  const winner = fotn.winner_fight_id ? byId.get(fotn.winner_fight_id) : undefined
  const total = fotn.total_votes ?? 0
  const counts = [...(fotn.counts ?? [])]
    .map(c => ({ ...c, f: byId.get(c.fight_id) }))
    .filter((c): c is { fight_id: string; votes: number; f: CardRecapFight } => !!c.f)
    .sort((a, b) => b.votes - a.votes || (a.f.bout_order - b.f.bout_order))
  const votesOf = (id: string) => fotn.counts?.find(c => c.fight_id === id)?.votes ?? 0
  const badge = BADGES.fight_of_the_night

  return (
    <Paper as="section" className={cx('fotn fotn--closed', className)} aria-labelledby={hid}>
      <div className="ev-top">
        {!winner && <Stamp tone="ink" size="sm" rot={-2}>Voting closed</Stamp>}
        <span className="data nowrap fotn-total">{winner ? 'Voting closed · ' : ''}<b>{total}</b> vote{total === 1 ? '' : 's'}</span>
      </div>
      {winner ? (
        <>
          <div className="fotn-win">
            <h2 id={hid} className="sr-only">Fight of the Night: {nick(winner.red.nickname)} vs {nick(winner.blue.nickname)}</h2>
            <Stamp size="lg" rot={-4} className="fotn-win-stamp" aria-hidden="true">Fight of the Night</Stamp>
            <p className="label c-2 fotn-win-label">{boutName(winner)}</p>
            <p className="fotn-win-names"><Matchup f={winner} size="bout" /></p>
            <p className="data fotn-win-meta"><b>{votesOf(winner.fight_id)}</b> of {total} votes</p>
            {summary(winner) && <p className="data c-2">{summary(winner)}</p>}
            {fotn.my_vote === winner.fight_id && <p className="t-help fotn-win-you">You called it.</p>}
          </div>
          <div className="fotn-badge">
            <BadgeChip onPaper badge={{ label: badge.label, description: badge.description, icon: badge.icon, times: 1 }} />
            <p className="t-help c-2">Both fighters earn the badge on their profile.</p>
          </div>
        </>
      ) : (
        <>
          <h2 id={hid} className="t-head fotn-h"><StarMark />Fight of the Night</h2>
          <p className="t-body fotn-none">Nobody voted on this card, so there’s no Fight of the Night.</p>
        </>
      )}
      {counts.length > 1 && total > 0 && (
        <ol className="fotn-counts" aria-label="Votes per bout">
          {counts.map(c => (
            <li key={c.fight_id} className={cx(c.fight_id === fotn.winner_fight_id && 'is-win')}>
              <span className="fotn-c-name">
                <span className="label c-2">{boutName(c.f)}{fotn.my_vote === c.fight_id ? ' · your vote' : ''}</span>
                <Matchup f={c.f} />
              </span>
              <span className="data-lg fotn-c-n">{c.votes}<span className="sr-only"> vote{c.votes === 1 ? '' : 's'}</span></span>
            </li>
          ))}
        </ol>
      )}
    </Paper>
  )
}
