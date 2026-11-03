/**
 * One finished season as a flat result sheet (DESIGN 3 material B, like a settled bout in History):
 * name and dates with a FINAL stamp, the champion and the top picker, then the final top 5 from
 * `seasons.snapshot`. Numbers come from the snapshot only.
 * Gold (<ChampionBelt/>) means the CURRENT champion and nothing else, so a past season never prints it:
 * whoever held the belt that season gets the bone Crown seal (as ended reigns do in TitleReigns).
 */
import { Link } from 'react-router-dom'
import { BadgeSeal } from '../badges'
import { Paper, Stamp } from '../ui'
import { fmtNum } from '../../lib/copy'
import type { Season } from '../../lib/types'
import { fmtSeasonRange, pickerName, topFighters } from './format'

export default function SeasonSheet({ season, visibleFighters }: { season: Season; visibleFighters?: Set<string> }) {
  const snap = season.snapshot
  const champ = snap?.champion ?? null
  const top = snap?.top_bettor ?? null
  const five = topFighters(snap)
  const hid = `ssn-${season.id}`
  // Link to a profile only when that fighter is still on the roster for this viewer.
  const canLink = (id: string) => !visibleFighters || visibleFighters.has(id)

  return (
    <Paper as="article" className="ssn-sheet" aria-labelledby={hid}>
      <div className="ssn-top">
        <h3 id={hid} className="t-head"><bdi>{season.name}</bdi></h3>
        <Stamp tone="ink" size="sm" rot={-4}>Final</Stamp>
      </div>
      {season.ended_at && <p className="data ssn-dates">{fmtSeasonRange(season.started_at, season.ended_at)}</p>}

      <div className="ssn-crown">
        <div>
          <span className="label">Champion</span>
          {champ ? (
            <>
              <span className="belt-line">
                {champ.source === 'belt' && <BadgeSeal icon="Crown" size={22} rot={-2} className="ssn-seal" />}
                {canLink(champ.fighter_id)
                  ? <Link className="who t-sub" style={{ marginTop: 0 }} to={`/app/fighters/${champ.fighter_id}`}><bdi>{champ.nickname}</bdi></Link>
                  : <span className="who t-sub" style={{ marginTop: 0 }}><bdi>{champ.nickname}</bdi></span>}
              </span>
              <span className="data">
                <span className="nowrap">{champ.season_wins}–{champ.season_losses}</span>{' · '}
                <span className="nowrap">{fmtNum(champ.elo)} Elo</span>
              </span>
              <span className="data">{champ.source === 'belt' ? 'Held the belt' : 'Top Elo, belt was vacant'}</span>
            </>
          ) : <p className="none t-help">None. The belt was vacant and nobody fought.</p>}
        </div>
        <div>
          <span className="label">Top picker</span>
          {top ? (
            <>
              <span className="who t-sub"><bdi>{pickerName(top)}</bdi></span>
              <span className="data"><b>{fmtNum(top.balance)}</b> pts</span>
            </>
          ) : <p className="none t-help">No members yet.</p>}
        </div>
      </div>

      <h4 className="t-sub">Final top 5</h4>
      {five.length ? (
        <table className="how">
          <caption className="sr-only">Final top 5 fighters of {season.name}, by Elo</caption>
          <thead><tr><th scope="col"><span className="sr-only">Rank</span>#</th><th scope="col">Fighter</th><th scope="col">W–L</th><th scope="col">Elo</th></tr></thead>
          <tbody>
            {five.map(f => (
              <tr key={f.fighter_id}>
                <td>{f.rank}</td>
                <td>
                  {canLink(f.fighter_id)
                    ? <Link to={`/app/fighters/${f.fighter_id}`}>{f.is_champion && <HeldSeal />}<bdi>{f.nickname}</bdi></Link>
                    : <span className="ssn-name">{f.is_champion && <HeldSeal />}<bdi>{f.nickname}</bdi></span>}
                </td>
                <td className="nowrap">{f.season_wins}–{f.season_losses}</td>
                <td><b>{fmtNum(f.elo)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="ssn-empty t-help">Nobody fought this season.</p>}
    </Paper>
  )
}

/** Past-season belt holder mark: decorative seal plus the words for screen readers. */
function HeldSeal() {
  return <><BadgeSeal icon="Crown" size={20} rot={-2} className="ssn-seal" /><span className="sr-only">Held the belt: </span></>
}
