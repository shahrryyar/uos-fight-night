import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  fmtDate, fmtKg, fmtRounds, fmtScore, methodMove, must, record, useAsync,
  type FighterStats, type FightResult,
} from '../lib/hooks'
import { formatStreak } from '../lib/math'
import type { Fighter } from '../lib/types'
import FighterPhoto from '../components/FighterPhoto'
import { Card, Empty, ErrorBox, Loading, StreakPill } from '../components/member/ui'

interface Data { fighter: Fighter | null; rank: FighterStats | null; results: FightResult[]; roster: Map<string, Fighter> }

interface Totals {
  rounds: number; pf: number; pa: number
  w: Record<'pin' | 'submission' | 'decision', number>
  l: Record<'pin' | 'submission' | 'decision', number>
}

/** Totals from fighter_rankings (authoritative); falls back to summing fight_results. */
function totalsOf(rank: FighterStats | null, results: FightResult[]): Totals {
  if (rank && rank.total_rounds !== undefined) {
    const n = (v: number | null | undefined) => Number(v ?? 0)
    return {
      rounds: n(rank.total_rounds), pf: n(rank.points_for), pa: n(rank.points_against),
      w: { pin: n(rank.wins_pin), submission: n(rank.wins_submission), decision: n(rank.wins_decision) },
      l: { pin: n(rank.losses_pin), submission: n(rank.losses_submission), decision: n(rank.losses_decision) },
    }
  }
  const t: Totals = { rounds: 0, pf: 0, pa: 0, w: { pin: 0, submission: 0, decision: 0 }, l: { pin: 0, submission: 0, decision: 0 } }
  for (const r of results) {
    t.rounds += r.rounds ?? 0; t.pf += r.score_for ?? 0; t.pa += r.score_against ?? 0
    if (r.method) (r.result === 'W' ? t.w : t.l)[r.method]++
  }
  return t
}

const breakdown = (m: Totals['w']) => `${m.pin} pin · ${m.submission} submission · ${m.decision} decision`

export default function FighterProfile() {
  const { id = '' } = useParams()
  const st = useAsync<Data>(async () => {
    const [f, r, results, roster] = await Promise.all([
      supabase.from('fighters').select('*').eq('id', id).maybeSingle(),
      supabase.from('fighter_rankings').select('*').eq('fighter_id', id).maybeSingle(),
      supabase.from('fight_results').select('*').eq('fighter_id', id).order('settled_at', { ascending: false }),
      supabase.from('fighters').select('*'),
    ])
    return {
      fighter: must(f) as Fighter | null,
      rank: must(r) as FighterStats | null,
      results: must(results) as FightResult[],
      roster: new Map((must(roster) as Fighter[]).map(x => [x.id, x])),
    }
  }, [id])

  if (st.loading) return <Loading />
  if (st.error) return <ErrorBox error={st.error} onRetry={() => void st.reload()} />
  const d = st.data
  if (!d?.fighter) return <Empty>Fighter not found. <Link to="/app/fighters" className="text-gold underline">Back to roster</Link></Empty>
  const f = d.fighter
  const t = totalsOf(d.rank, d.results)

  return (
    <div className="space-y-4">
      <Link to="/app/fighters" className="inline-flex min-h-11 items-center text-sm text-muted">← Roster</Link>
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-b from-red-dark/40 via-ink/0 to-ink/0" aria-hidden />
        <div className="relative flex flex-col items-center px-4 pt-6 pb-5 text-center">
          <FighterPhoto path={f.photo_path} nickname={f.nickname} className="size-40 text-5xl" />
          <h1 className="mt-3 font-display text-5xl tracking-wide leading-none">{f.nickname}</h1>
          {f.catchphrase && <p className="mt-2 text-sm italic text-muted">“{f.catchphrase}”</p>}
          <div className="mt-4 grid w-full grid-cols-4 gap-2">
            <Stat label="Record" value={record(f)} />
            <Stat label="Elo" value={String(f.elo)} />
            <Stat label="Rank" value={d.rank?.rank ? `#${d.rank.rank}` : 'NR'} gold={!!d.rank?.rank} />
            <Stat label="Weight" value={fmtKg(f.weight_kg).replace(' kg', '') || '—'} unit={f.weight_kg != null ? 'kg' : undefined} />
          </div>
          <div className="mt-2 grid w-full grid-cols-3 gap-2">
            <Stat label="Rounds" value={String(t.rounds)} />
            <Stat label="Pts for" value={String(t.pf)} />
            <Stat label="Pts against" value={String(t.pa)} />
          </div>
          <div className="mt-3 w-full space-y-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-left text-xs">
            <p><span className="font-bold uppercase tracking-wider text-gold">Wins:</span> <span className="tabular-nums">{breakdown(t.w)}</span></p>
            <p><span className="font-bold uppercase tracking-wider text-muted">Losses:</span> <span className="tabular-nums">{breakdown(t.l)}</span></p>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            Streak <StreakPill streak={f.streak} label={formatStreak(f.streak)} />
            {!d.rank?.ranked && <span>· needs 3 fights to rank</span>}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-display text-2xl tracking-wider">Last 5 fights</h2>
        {d.results.length === 0 ? <Empty>No fights on record yet.</Empty> : (
          <ul className="mt-2 divide-y divide-line">
            {d.results.slice(0, 5).map(r => <ResultRow key={r.fight_id} r={r} opp={d.roster.get(r.opponent_id)} />)}
          </ul>
        )}
      </Card>

      <HeadToHead fighter={f} results={d.results} roster={d.roster} />
    </div>
  )
}

/** One fight from this fighter's perspective: W/L, opponent (kg), score, rounds, method + move, date. */
function ResultRow({ r, opp }: { r: FightResult; opp?: Fighter }) {
  const won = r.result === 'W'
  const oppKg = fmtKg(r.opponent_weight_kg ?? opp?.weight_kg)
  const bits = [fmtScore(r.score_for, r.score_against), fmtRounds(r.rounds)].filter(Boolean)
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`grid size-10 shrink-0 place-items-center rounded-lg font-display text-2xl ${won ? 'bg-gold text-ink' : 'bg-surface-2 text-muted'}`}>
        {won ? 'W' : 'L'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          vs {opp ? <Link to={`/app/fighters/${opp.id}`} className="hover:underline">{opp.nickname}</Link> : 'Unknown'}
          {oppKg && <span className="font-normal text-muted"> ({oppKg})</span>}
        </p>
        <p className="text-xs text-muted">
          {bits.length > 0 && <span className="font-semibold text-bone tabular-nums">{bits.join(' · ')}</span>}
          {bits.length > 0 && ' · '}
          {won ? '' : 'Lost by '}{won ? methodMove(r.method, r.finish_move) : methodMove(r.method, r.finish_move).toLowerCase()}
          {' · '}{fmtDate(r.settled_at, false)}
        </p>
      </div>
      {r.elo_delta != null && (
        <span className={`tabular-nums text-sm font-semibold ${r.elo_delta >= 0 ? 'text-gold' : 'text-muted'}`}>
          {r.elo_delta >= 0 ? '+' : '−'}{Math.abs(r.elo_delta)}
        </span>
      )}
    </li>
  )
}

function Stat({ label, value, gold, unit }: { label: string; value: string; gold?: boolean; unit?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 py-2">
      <p className={`font-display text-2xl leading-none tabular-nums ${gold ? 'text-gold' : ''}`}>
        {value}{unit && <span className="ml-0.5 text-sm text-muted">{unit}</span>}
      </p>
      <p className="mt-1 text-[10px] uppercase tracking-widest text-muted">{label}</p>
    </div>
  )
}

function HeadToHead({ fighter, results, roster }: { fighter: Fighter; results: FightResult[]; roster: Map<string, Fighter> }) {
  const opponents = useMemo(
    () => [...roster.values()].filter(x => x.id !== fighter.id && !x.hidden).sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [roster, fighter.id],
  )
  const [opp, setOpp] = useState('')
  const between = results.filter(r => r.opponent_id === opp)
  const w = between.filter(r => r.result === 'W').length
  const l = between.length - w
  const o = roster.get(opp)

  return (
    <Card className="p-4">
      <h2 className="font-display text-2xl tracking-wider">Head to head</h2>
      <select value={opp} onChange={e => setOpp(e.target.value)} aria-label="Pick an opponent"
        className="mt-2 min-h-11 w-full rounded-lg border border-line bg-ink px-3 text-bone">
        <option value="">Pick an opponent…</option>
        {opponents.map(x => <option key={x.id} value={x.id}>{x.nickname}</option>)}
      </select>
      {o && (
        <div className="mt-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
            <div className="min-w-0">
              <p className="font-display text-xl leading-none truncate">{fighter.nickname}</p>
              <p className="font-display text-5xl text-red leading-none tabular-nums">{w}</p>
            </div>
            <span className="font-display text-2xl text-gold">VS</span>
            <div className="min-w-0">
              <p className="font-display text-xl leading-none truncate">{o.nickname}</p>
              <p className="font-display text-5xl text-blue leading-none tabular-nums">{l}</p>
            </div>
          </div>
          {between.length === 0 ? <p className="mt-2 text-center text-xs text-muted">They've never met. Book it.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {between.map(r => <ResultRow key={r.fight_id} r={r} opp={o} />)}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
