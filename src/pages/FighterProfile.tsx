import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  cardDateOf, fmtCardDay, fmtDay, fmtKg, fmtMonthYear, fmtScore, isChampion, lostBy, methodPhrase, must, record, todayCard,
  useAsync, type FighterStats, type FightResult, type FightRow,
} from '../lib/hooks'
import { fmtNum } from '../lib/copy'
import type { Fighter } from '../lib/types'
import { ChampionBelt } from '../components/brand'
import { Alert, ButtonLink, CaretLeft, EmptyState, Field, HalftonePhoto, Loading, Paper, Select, Stamp } from '../components/ui'

interface Data {
  fighter: Fighter | null
  rank: FighterStats | null
  rankedCount: number
  results: FightResult[]
  roster: Map<string, Fighter>
  /** next booked bout (scheduled / open / locked), earliest first */
  next: FightRow | null
}

type Methods = Record<'pin' | 'submission' | 'decision', number>
interface Totals { bouts: number; rounds: number; pf: number; pa: number; w: Methods; l: Methods }

/** Totals from fighter_rankings (authoritative); falls back to summing fight_results. */
function totalsOf(rank: FighterStats | null, results: FightResult[]): Totals {
  if (rank && rank.total_rounds !== undefined) {
    const n = (v: number | null | undefined) => Number(v ?? 0)
    return {
      bouts: n(rank.fights), rounds: n(rank.total_rounds), pf: n(rank.points_for), pa: n(rank.points_against),
      w: { pin: n(rank.wins_pin), submission: n(rank.wins_submission), decision: n(rank.wins_decision) },
      l: { pin: n(rank.losses_pin), submission: n(rank.losses_submission), decision: n(rank.losses_decision) },
    }
  }
  const t: Totals = { bouts: results.length, rounds: 0, pf: 0, pa: 0, w: { pin: 0, submission: 0, decision: 0 }, l: { pin: 0, submission: 0, decision: 0 } }
  for (const r of results) {
    t.rounds += r.rounds ?? 0; t.pf += r.score_for ?? 0; t.pa += r.score_against ?? 0
    if (r.method) (r.result === 'W' ? t.w : t.l)[r.method]++
  }
  return t
}

const streakText = (n: number) => (n > 0 ? `W${n}` : n < 0 ? `L${-n}` : 'None')
const curly = (s: string) => `“${s.trim().replace(/^["'“”]+|["'“”]+$/g, '')}”`
const kgText = (v: number | string | null | undefined) => fmtKg(v).replace(' ', ' ')

/** The state stamp off the face (DESIGN 10 Profile). Always real state from the next booked bout. */
function stateStamp(next: FightRow | null): string | null {
  if (!next) return null
  if (cardDateOf(next) !== todayCard()) return 'Booked'
  return next.is_main_event ? 'Main event tonight' : 'Fights tonight'
}

export default function FighterProfile() {
  const { id = '' } = useParams()
  const st = useAsync<Data>(async () => {
    const [f, r, count, results, roster, next] = await Promise.all([
      supabase.from('fighters').select('*').eq('id', id).maybeSingle(),
      supabase.from('fighter_rankings').select('*').eq('fighter_id', id).maybeSingle(),
      supabase.from('fighter_rankings').select('fighter_id', { count: 'exact', head: true }).eq('ranked', true),
      supabase.from('fight_results').select('*').eq('fighter_id', id).order('settled_at', { ascending: false }),
      supabase.from('fighters').select('*'),
      supabase.from('fights').select('*').in('status', ['scheduled', 'open', 'locked'])
        .or(`red_fighter_id.eq.${id},blue_fighter_id.eq.${id}`).order('scheduled_at', { ascending: true }).limit(1),
    ])
    if (count.error) throw count.error
    return {
      fighter: must(f) as Fighter | null,
      rank: must(r) as FighterStats | null,
      rankedCount: count.count ?? 0,
      results: must(results) as FightResult[],
      roster: new Map((must(roster) as Fighter[]).map(x => [x.id, x])),
      next: ((must(next) as FightRow[])[0]) ?? null,
    }
  }, [id])

  if (st.loading && !st.data) return <Loading label="Loading the fighter's file…" />
  if (st.error) return <Alert title="Couldn't load this fighter." onRetry={() => void st.reload()}>Check your connection and try again.</Alert>
  const d = st.data
  if (!d?.fighter) {
    return (
      <div className="pg-profile">
        <BackLink />
        <EmptyState size="title" as="h1" title="Fighter not found" body="They may have left the roster. Everyone still fighting is on the Fighters page."
          action={<ButtonLink to="/app/fighters" variant="bone" size="sm">See all fighters</ButtonLink>} />
      </div>
    )
  }
  const f = d.fighter
  const t = totalsOf(d.rank, d.results)
  const stamp = stateStamp(d.next)
  const kg = kgText(f.weight_kg)
  const since = fmtMonthYear(f.created_at)
  const fights = d.rank?.fights ?? f.wins + f.losses

  return (
    <div className="pg-profile">
      <BackLink />
      <Paper className="mug" style={{ marginTop: 4 }}>
        <HalftonePhoto path={f.photo_path} name={f.nickname} size={360} aspect="6 / 5" priority />
        {stamp && <Stamp fill>{stamp}</Stamp>}
      </Paper>

      <div className="who">
        <h1 className="t-title"><bdi>{f.nickname}</bdi></h1>
        {isChampion(f) && (
          <p className="label nowrap" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <ChampionBelt size={28} />Champion
          </p>
        )}
        {(kg || since) && (
          <p className="data">
            {kg && <span className="nowrap">{kg}</span>}{kg && since && ' · '}{since && <span className="nowrap">Member since {since}</span>}
          </p>
        )}
        {f.catchphrase?.trim() && <p className="quote">{curly(f.catchphrase)}</p>}
      </div>

      <section className="record" aria-label="Record and rating" style={{ gridTemplateColumns: 'max-content minmax(0, 1fr)' }}>
        <div><p className="t-score nowrap" style={{ fontSize: scoreSize(record(f)) }}>{record(f)}</p><span className="label">Record</span></div>
        <div className="leaders data">
          <Leader k="Elo" v={fmtNum(f.elo)} />
          <Leader k="Rank" v={d.rank?.ranked && d.rank.rank ? `#${d.rank.rank} of ${d.rankedCount}` : 'Not yet'} />
          <Leader k="Streak" v={streakText(f.streak)} />
        </div>
      </section>
      {!d.rank?.ranked && (
        <p className="t-help c-2" style={{ marginTop: 10 }}>Ranks start after 3 fights. {Math.min(fights, 3)} of 3 so far.</p>
      )}

      <Paper as="section" className="section" aria-labelledby="sheet" style={{ marginTop: 28 }}>
        <h2 id="sheet" className="t-sub">Stat sheet</h2>
        {t.bouts === 0 ? (
          <p className="t-help" style={{ marginTop: 8 }}>No fights on record yet. The first one shows up here.</p>
        ) : (
          <>
            <div className="leaders data" style={{ marginTop: 10 }}>
              <Leader k="Bouts" v={fmtNum(t.bouts)} />
              <Leader k="Rounds wrestled" v={fmtNum(t.rounds)} />
              <Leader k="Points scored" v={fmtNum(t.pf)} />
              <Leader k="Points given up" v={fmtNum(t.pa)} />
            </div>
            <h3 className="t-sub" style={{ marginTop: 20 }}>How it ended</h3>
            <table className="how">
              <thead><tr><th scope="col">Method</th><th scope="col">Won</th><th scope="col">Lost</th></tr></thead>
              <tbody>
                {(['pin', 'submission', 'decision'] as const).map(m => (
                  <tr key={m}>
                    <td>{m === 'pin' ? 'Pin' : m === 'submission' ? 'Submission' : 'Decision'}</td>
                    <td>{t.w[m] > 0 ? <b>{t.w[m]}</b> : 0}</td>
                    <td>{t.l[m]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Paper>

      <section className="section last5" aria-labelledby="l5">
        <div className="section-head">
          <h2 id="l5" className="t-head">Last 5</h2>
          {d.results.length > 1 && <span className="data c-2">newest first</span>}
        </div>
        {d.results.length === 0
          ? <p className="t-body" style={{ color: 'var(--color-bone-2)' }}>No fights on record yet.</p>
          : (
            <ul className="rows" role="list">
              {d.results.slice(0, 5).map(r => <ResultRow key={r.fight_id} r={r} opp={d.roster.get(r.opponent_id)} />)}
            </ul>
          )}
      </section>

      <HeadToHead fighter={f} results={d.results} roster={d.roster} next={d.next} />
    </div>
  )
}

function BackLink() {
  return <Link className="back" to="/app/fighters"><CaretLeft />Fighters</Link>
}

function Leader({ k, v }: { k: string; v: string }) {
  return <p className="leader"><span>{k}</span><span className="dots" aria-hidden="true" /><b className="nowrap">{v}</b></p>
}

/** "Pin, half nelson · 5–2" / "Lost by decision · 2–4". The separator travels with the score so it never dangles at 320px. */
function resultLine(r: FightResult) {
  const how = r.result === 'W' ? methodPhrase(r.method, r.finish_move) || 'Win' : lostBy(r.method)
  const score = fmtScore(r.score_for, r.score_against)
  return <>{how}{score && <span className="nowrap"> · {score}</span>}</>
}

/** Last5Row (DESIGN 11.11): W filled / L outlined box, opponent, how it ended + score, date. */
function ResultRow({ r, opp }: { r: FightResult; opp?: Fighter }) {
  const won = r.result === 'W'
  const name = opp?.nickname ?? 'Unknown fighter'
  const body = (
    <>
      <span className={`wl ${won ? 'wl--w' : 'wl--l'}`}><span aria-hidden="true">{won ? 'W' : 'L'}</span><span className="sr-only">{won ? 'Won' : 'Lost'} against</span></span>
      <span><span className="t-sub"><bdi>{name}</bdi></span><span className="data">{resultLine(r)}</span></span>
      <span className="data nowrap">{fmtDay(r.settled_at)}</span>
    </>
  )
  return (
    <li>
      {opp ? <Link className="row row-link" to={`/app/fighters/${opp.id}`}>{body}</Link> : <div className="row">{body}</div>}
    </li>
  )
}

function meetLine(next: FightRow | null, oppId: string, metBefore: boolean) {
  if (!next || (next.red_fighter_id !== oppId && next.blue_fighter_id !== oppId)) return ''
  const tonight = cardDateOf(next) === todayCard()
  const where = next.is_main_event ? ' in the main event' : ''
  if (tonight) return metBefore ? ` Rematch tonight${where}.` : ` They meet tonight${where}.`
  return ` ${metBefore ? 'Rematch' : 'They meet'} on ${fmtCardDay(cardDateOf(next))}${where}.`
}

function HeadToHead({ fighter, results, roster, next }: { fighter: Fighter; results: FightResult[]; roster: Map<string, Fighter>; next: FightRow | null }) {
  const opponents = [...roster.values()].filter(x => x.id !== fighter.id && !x.hidden).sort((a, b) => a.nickname.localeCompare(b.nickname))
  const nextOpp = next ? (next.red_fighter_id === fighter.id ? next.blue_fighter_id : next.red_fighter_id) : null
  const fallback = [nextOpp, results[0]?.opponent_id, opponents[0]?.id].find(x => x && opponents.some(o => o.id === x)) ?? ''
  const [picked, setPicked] = useState<string | null>(null)
  const opp = picked ?? fallback
  if (!opponents.length) return null

  const between = results.filter(r => r.opponent_id === opp)
  const w = between.filter(r => r.result === 'W').length
  const l = between.length - w
  const last = between[0]
  const lastLine = last
    ? `${last.result === 'W' ? `Won by ${(methodPhrase(last.method, last.finish_move) || 'win').toLowerCase()}` : lostBy(last.method)}${fmtScore(last.score_for, last.score_against) ? `, ${fmtScore(last.score_for, last.score_against)}` : ''}, on ${fmtDay(last.settled_at)}.`
    : ''
  const summary = between.length === 0 ? 'Never met.'
    : between.length === 1 ? `Met once. ${lastLine}`
    : `Met ${between.length} times. Last time: ${lastLine.charAt(0).toLowerCase()}${lastLine.slice(1)}`

  return (
    <Paper as="section" className="section h2h" aria-labelledby="hh">
      <h2 id="hh" className="t-sub">Head to head</h2>
      <Field label="Compare with">
        <Select value={opp} onChange={e => setPicked(e.target.value)} name="opponent">
          {opponents.map(x => <option key={x.id} value={x.id}>{x.nickname}</option>)}
        </Select>
      </Field>
      <p className="t-head" aria-live="polite"><span className="sr-only">{fighter.nickname} record against {roster.get(opp)?.nickname}: </span>{w}–{l}</p>
      <p className="t-help" style={{ marginTop: 6 }}>{summary}{meetLine(next, opp, between.length > 0)}</p>
    </Paper>
  )
}

/** Record numeral size: 96px when it fits, shrinking so a long record (10–10) keeps to about half the column on one line. */
function scoreSize(text: string): string {
  const em = 0.46 * text.length + 0.2
  return `clamp(3.5rem, calc((100vw - 32px) * ${(0.5 / em).toFixed(3)}), 6rem)`
}
