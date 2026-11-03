/**
 * The record book (C7): one flat paper sheet (material B), typed like the zine's stat sheet.
 * Six blocks split by 3px toner rules. In each block the holder(s) at rank 1 print large; ranks 2 and 3
 * follow as leader lines. Ties share a rank (SQL rank()), so a shared record names everyone on it.
 */
import { Link } from 'react-router-dom'
import { fmtNum } from '../../lib/copy'
import { fmtDay } from '../../lib/hooks'
import type { HallOfFame, HofFighterRecord, HofPeakRecord, HofUpsetRecord } from '../../lib/types'
import { Paper, Timer, type IconComponent } from '../ui'
import MemberName from '../MemberName'
import { Fire, HandFist, Lightning, Star, TrendUp } from '../shop/shopIcons'

type Records = HallOfFame['records']

const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`

interface FighterDef { key: 'longest_win_streak' | 'most_wins' | 'most_rounds' | 'most_fotn'; title: string; icon: IconComponent; unit: (n: number) => string; empty: string }

const FIGHTER_RECORDS: FighterDef[] = [
  { key: 'longest_win_streak', title: 'Longest win streak', icon: Fire, unit: n => `${fmtNum(n)} in a row`, empty: 'Nobody has strung wins together yet.' },
  { key: 'most_wins', title: 'Most wins', icon: HandFist, unit: n => plural(n, 'win'), empty: 'No bout has been won yet.' },
  { key: 'most_rounds', title: 'Most rounds wrestled', icon: Timer, unit: n => plural(n, 'round'), empty: 'No rounds on record yet.' },
  { key: 'most_fotn', title: 'Most Fight of the Night', icon: Star, unit: n => plural(n, 'time'), empty: 'No Fight of the Night yet. Members vote after every card.' },
]

export default function RecordBook({ records, asOf }: { records: Records; asOf: string }) {
  return (
    <Paper as="section" edges="both" className="rb" aria-labelledby="rb-h">
      <div className="rb-head">
        <h2 id="rb-h" className="t-head">Record book</h2>
        <p className="data c-2 nowrap">As of {fmtDay(asOf)}</p>
      </div>
      <p className="t-help c-2 rb-sub">All-time, across every season. Ties share a spot.</p>

      {FIGHTER_RECORDS.slice(0, 3).map(d => <FighterBlock key={d.key} def={d} rows={records[d.key] ?? []} />)}
      <UpsetBlock rows={records.biggest_upset ?? []} />
      <FighterBlock def={FIGHTER_RECORDS[3]} rows={records.most_fotn ?? []} />
      <PeakBlock rows={records.top_bettor_peak ?? []} />
    </Paper>
  )
}

function BlockHead({ icon: Ico, title, shared }: { icon: IconComponent; title: string; shared?: boolean }) {
  return (
    <div className="rb-bh">
      <h3 className="t-sub"><Ico className="rb-ic" />{title}</h3>
      {shared && <span className="label c-2">Shared</span>}
    </div>
  )
}

const ranks = <T extends { rank: number }>(rows: T[]) => ({ top: rows.filter(r => r.rank === 1), rest: rows.filter(r => r.rank !== 1) })

function FighterBlock({ def, rows }: { def: FighterDef; rows: HofFighterRecord[] }) {
  const { top, rest } = ranks(rows)
  return (
    <section className="rb-block" aria-label={def.title}>
      <BlockHead icon={def.icon} title={def.title} shared={top.length > 1} />
      {!rows.length ? <p className="t-help c-2 rb-empty">{def.empty}</p> : (
        <>
          {top.length > 0 && (
            <>
              <p className="rb-val"><span className="data-lg">{def.unit(top[0].value)}</span></p>
              <ul className="rb-holders" role="list">
                {top.map(r => <li key={r.fighter_id}><FighterLink id={r.fighter_id} name={r.nickname} /></li>)}
              </ul>
            </>
          )}
          {rest.length > 0 && (
            <ol className="rb-rest" role="list">
              {rest.map(r => (
                <li key={r.fighter_id} className="rb-lead">
                  <span className="data rb-rank"><span className="sr-only">Rank </span>{r.rank}</span>
                  <FighterLink id={r.fighter_id} name={r.nickname} small />
                  <span className="dots" aria-hidden="true" />
                  <span className="data nowrap">{def.unit(r.value)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}

function UpsetBlock({ rows }: { rows: HofUpsetRecord[] }) {
  const { top, rest } = ranks(rows)
  return (
    <section className="rb-block" aria-label="Biggest upset">
      <BlockHead icon={TrendUp} title="Biggest upset" shared={top.length > 1} />
      {!rows.length ? <p className="t-help c-2 rb-empty">No upset yet. It counts when the lower-rated fighter wins.</p> : (
        <>
          {top.map(r => (
            <div key={r.fight_id} className="rb-upset">
              <p className="rb-val"><span className="data-lg">+{fmtNum(r.value)} Elo</span> <span className="data c-2">gap</span></p>
              <p className="rb-upset-who">
                <FighterLink id={r.winner_fighter_id} name={r.winner_nickname} /> <span className="rb-beat">beat</span>{' '}
                <FighterLink id={r.loser_fighter_id} name={r.loser_nickname} small />
              </p>
              <p className="data c-2">
                <span className="nowrap">{fmtNum(r.winner_elo_before)} vs {fmtNum(r.loser_elo_before)} Elo</span>{' · '}
                <span className="nowrap">{fmtDay(r.settled_at)}</span>
              </p>
            </div>
          ))}
          {rest.length > 0 && (
            <ol className="rb-rest" role="list">
              {rest.map(r => (
                <li key={r.fight_id} className="rb-lead">
                  <span className="data rb-rank"><span className="sr-only">Rank </span>{r.rank}</span>
                  <span className="rb-who-sm"><bdi>{r.winner_nickname}</bdi> <span className="rb-beat">beat</span> <bdi>{r.loser_nickname}</bdi></span>
                  <span className="dots" aria-hidden="true" />
                  <span className="data nowrap">+{fmtNum(r.value)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}

function PeakBlock({ rows }: { rows: HofPeakRecord[] }) {
  const { top, rest } = ranks(rows)
  return (
    <section className="rb-block" aria-label="Top picker peak">
      <BlockHead icon={Lightning} title="Top picker peak" shared={top.length > 1} />
      <p className="t-help c-2 rb-note">The most points a member ever held at once.</p>
      {!rows.length ? <p className="t-help c-2 rb-empty">No points on record yet.</p> : (
        <>
          {top.length > 0 && (
            <>
              <p className="rb-val"><span className="data-lg">{fmtNum(top[0].value)} pts</span></p>
              <ul className="rb-holders" role="list">
                {top.map(r => (
                  <li key={r.user_id}>
                    <span className="t-sub rb-member"><MemberName userId={r.user_id} name={r.display_name} /></span>
                    <span className="data c-2 nowrap">{fmtDay(r.at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {rest.length > 0 && (
            <ol className="rb-rest" role="list">
              {rest.map(r => (
                <li key={r.user_id} className="rb-lead">
                  <span className="data rb-rank"><span className="sr-only">Rank </span>{r.rank}</span>
                  <span className="rb-who-sm"><MemberName userId={r.user_id} name={r.display_name} title="none" frame={false} /></span>
                  <span className="dots" aria-hidden="true" />
                  <span className="data nowrap">{fmtNum(r.value)} pts</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}

function FighterLink({ id, name, small }: { id: string; name: string | null; small?: boolean }) {
  return (
    <Link className={small ? 'rb-link rb-link--sm' : 'rb-link t-sub'} to={`/app/fighters/${id}`}>
      <bdi>{name ?? 'Fighter'}</bdi>
    </Link>
  )
}

