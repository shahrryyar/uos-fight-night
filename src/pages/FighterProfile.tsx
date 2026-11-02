import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { METHOD_LABEL, fmtDate, must, record, useAsync } from '../lib/hooks'
import { formatStreak } from '../lib/math'
import type { Fight, Fighter, FighterRanking } from '../lib/types'
import FighterPhoto from '../components/FighterPhoto'
import { Card, Empty, ErrorBox, Loading, StreakPill } from '../components/member/ui'

interface Data { fighter: Fighter | null; rank: FighterRanking | null; fights: Fight[]; roster: Map<string, Fighter> }

/** Whether `fid` won `f` (settled fights only). */
const didWin = (f: Fight, fid: string) => (f.winner_side === 'red' ? f.red_fighter_id : f.blue_fighter_id) === fid
const opponentOf = (f: Fight, fid: string) => (f.red_fighter_id === fid ? f.blue_fighter_id : f.red_fighter_id)

export default function FighterProfile() {
  const { id = '' } = useParams()
  const st = useAsync<Data>(async () => {
    const [f, r, fights, roster] = await Promise.all([
      supabase.from('fighters').select('*').eq('id', id).maybeSingle(),
      supabase.from('fighter_rankings').select('*').eq('fighter_id', id).maybeSingle(),
      supabase.from('fights').select('*').eq('status', 'settled')
        .or(`red_fighter_id.eq.${id},blue_fighter_id.eq.${id}`).order('settled_at', { ascending: false }),
      supabase.from('fighters').select('*'),
    ])
    return {
      fighter: must(f) as Fighter | null,
      rank: must(r) as FighterRanking | null,
      fights: must(fights) as Fight[],
      roster: new Map((must(roster) as Fighter[]).map(x => [x.id, x])),
    }
  }, [id])

  if (st.loading) return <Loading />
  if (st.error) return <ErrorBox error={st.error} onRetry={() => void st.reload()} />
  const d = st.data
  if (!d?.fighter) return <Empty>Fighter not found. <Link to="/app/fighters" className="text-gold underline">Back to roster</Link></Empty>
  const f = d.fighter

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
            <Stat label="Weight" value={f.weight_kg != null ? `${f.weight_kg}kg` : '—'} />
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            Streak <StreakPill streak={f.streak} label={formatStreak(f.streak)} />
            {!d.rank?.ranked && <span>· needs 3 fights to rank</span>}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-display text-2xl tracking-wider">Last 5 fights</h2>
        {d.fights.length === 0 ? <Empty>No fights on record yet.</Empty> : (
          <ul className="mt-2 divide-y divide-line">
            {d.fights.slice(0, 5).map(x => {
              const won = didWin(x, f.id)
              const opp = d.roster.get(opponentOf(x, f.id))
              return (
                <li key={x.id} className="flex items-center gap-3 py-2.5">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg font-display text-xl ${won ? 'bg-gold text-ink' : 'bg-surface-2 text-muted'}`}>
                    {won ? 'W' : 'L'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">vs {opp?.nickname ?? 'Unknown'}</p>
                    <p className="text-xs text-muted">{x.method ? METHOD_LABEL[x.method] : '—'} · {fmtDate(x.settled_at ?? x.scheduled_at, false)}</p>
                  </div>
                  {x.elo_delta != null && (
                    <span className={`tabular-nums text-sm font-semibold ${won ? 'text-gold' : 'text-muted'}`}>
                      {won ? '+' : '−'}{Math.abs(x.elo_delta)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <HeadToHead fighter={f} fights={d.fights} roster={d.roster} />
    </div>
  )
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 py-2">
      <p className={`font-display text-2xl leading-none tabular-nums ${gold ? 'text-gold' : ''}`}>{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-widest text-muted">{label}</p>
    </div>
  )
}

function HeadToHead({ fighter, fights, roster }: { fighter: Fighter; fights: Fight[]; roster: Map<string, Fighter> }) {
  const opponents = useMemo(
    () => [...roster.values()].filter(x => x.id !== fighter.id && !x.hidden).sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [roster, fighter.id],
  )
  const [opp, setOpp] = useState('')
  const between = fights.filter(x => opponentOf(x, fighter.id) === opp)
  const w = between.filter(x => didWin(x, fighter.id)).length
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
            <div>
              <p className="font-display text-xl leading-none truncate">{fighter.nickname}</p>
              <p className="font-display text-5xl text-red leading-none tabular-nums">{w}</p>
            </div>
            <span className="font-display text-2xl text-gold">VS</span>
            <div>
              <p className="font-display text-xl leading-none truncate">{o.nickname}</p>
              <p className="font-display text-5xl text-blue leading-none tabular-nums">{l}</p>
            </div>
          </div>
          {between.length === 0 ? <p className="mt-2 text-center text-xs text-muted">They've never met. Book it.</p> : (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {between.map(x => (
                <li key={x.id} className="flex justify-between">
                  <span>{fmtDate(x.settled_at ?? x.scheduled_at, false)}</span>
                  <span className={didWin(x, fighter.id) ? 'text-gold' : ''}>
                    {(didWin(x, fighter.id) ? fighter.nickname : o.nickname)} by {x.method ? METHOD_LABEL[x.method] : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
