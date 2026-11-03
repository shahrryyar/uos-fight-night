/**
 * Hall of Fame lists on ink (material C):
 *   ChampionsList  every belt reign, newest first. Gold (<ChampionBelt/>) only on the CURRENT reign;
 *                  past reigns get the bone Belt Holder seal (same rule as the profile's TitleReigns).
 *   SeasonList     finished seasons: champion (belt holder or top Elo at the end) and top picker.
 */
import { Link } from 'react-router-dom'
import { fmtNum } from '../../lib/copy'
import { fmtDay } from '../../lib/hooks'
import type { HallOfFame } from '../../lib/types'
import { ChampionBelt } from '../brand'
import { BadgeSeal } from '../badges'
import { daysText, defensesText, endHow, reignDays, wonHow } from '../belt'
import { fmtSeasonRange } from '../season'
import Lead from '../season/Lead'
import MemberName from '../MemberName'

export function ChampionsList({ reigns }: { reigns: HallOfFame['champions'] }) {
  if (!reigns.length) {
    return <p className="t-body hof-empty">No champion yet. The first fighter to take the belt is written in here, with every defense after.</p>
  }
  return (
    <ol className="rows hof-reigns" role="list">
      {reigns.map(r => {
        const days = reignDays(r.started_at, r.ended_at)
        return (
          <li key={r.reign_id} className="row hof-reign">
            {r.is_current ? <ChampionBelt size={44} label="Current champion" /> : <BadgeSeal icon="Crown" size={40} rot={-2} />}
            <span className="hof-reign-main">
              <Link className="t-sub hof-name" to={`/app/fighters/${r.fighter_id}`}><bdi>{r.nickname ?? 'Fighter'}</bdi></Link>
              <span className="data">
                {r.is_current
                  ? <><span className="nowrap">Champion since {fmtDay(r.started_at)}</span></>
                  : <span className="nowrap">{fmtDay(r.started_at)} to {fmtDay(r.ended_at)}</span>}
              </span>
              <span className="t-help hof-how">{wonHow(r.won_fight_id)}. {endHow(r.end_reason)}.</span>
            </span>
            <span className="hof-reign-end">
              <span className="data-lg">{fmtNum(r.defenses)}</span>
              <span className="label">{r.defenses === 1 ? 'defense' : 'defenses'}</span>
              <span className="data nowrap c-2">{daysText(days)}</span>
              <span className="sr-only">{defensesText(r.defenses, 'No defenses')}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function SeasonList({ seasons }: { seasons: HallOfFame['season_champions'] }) {
  if (!seasons.length) {
    return <p className="t-body hof-empty">No finished seasons yet. When an admin ends a season, its champion and top picker are written in here.</p>
  }
  return (
    <ol className="rows hof-seasons" role="list">
      {seasons.map(s => (
        <li key={s.season_id} className="hof-season">
          <div className="hof-season-top">
            <h3 className="t-sub"><bdi>{s.name}</bdi></h3>
            <p className="data c-2">{fmtSeasonRange(s.started_at, s.ended_at)}</p>
          </div>
          <div className="leaders" role="list">
            <Lead label="Champion">
              {s.champion_fighter_id
                ? <Link className="lead-link" to={`/app/fighters/${s.champion_fighter_id}`}><bdi>{s.champion_nickname ?? 'Fighter'}</bdi></Link>
                : <span className="data">Nobody crowned</span>}
            </Lead>
            {s.champion_fighter_id && (
              <Lead label="Crowned by"><span className="data">{s.champion_source === 'belt' ? 'Holding the belt' : 'Top Elo'}</span></Lead>
            )}
            <Lead label="Top picker">
              {s.top_bettor_user_id
                ? <><MemberName userId={s.top_bettor_user_id} name={s.top_bettor_display_name} title="none" />{' '}
                    {s.top_bettor_balance != null && <span className="data nowrap">{fmtNum(s.top_bettor_balance)} pts</span>}</>
                : <span className="data">Nobody</span>}
            </Lead>
          </div>
        </li>
      ))}
    </ol>
  )
}
