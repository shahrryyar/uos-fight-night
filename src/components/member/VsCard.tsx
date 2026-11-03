/**
 * Matchup pieces (DESIGN 11.3, fightcard.html / states-a.html):
 *   <Duel>        corner bands, 4:3 halftone photos, names, the VS stamp (open/locked/booked) or the
 *                 result stamp on the winner's photo + method lines (settled). The loser is NEVER dimmed.
 *   <TaleOfTape>  mirrored red / label / blue table (Weight, Record, Elo) or the settled Elo +/- and weigh-in.
 *   <ScoreRow>    "6–3" in corner inks, aria-hidden (the sheet carries an sr-only sentence).
 *   <BoutVs>      undercard row on ink: 48px bone halftones, underlined corner names, "vs", meta.
 */
import { Link } from 'react-router-dom'
import { MatDivider } from '../brand'
import { fmtDelta, resultStampText } from '../../lib/copy'
import { METHOD_LABEL, cornerKg, fmtKg, lostBy, type FightRow } from '../../lib/hooks'
import type { Fighter, Side } from '../../lib/types'
import { HalftonePhoto, Stamp } from '../ui'
import { ChampBelt, TitleFightMark, useChampionId } from '../belt'
import { fmtRecord } from './format'

const nick = (f: Fighter | undefined, s: Side) => f?.nickname ?? (s === 'red' ? 'Red corner' : 'Blue corner')

/** The name, with the gold belt plate when this fighter holds the title now (B5). */
function Name({ f, side, className, champId, belt = 24 }: { f?: Fighter; side: Side; className: string; champId?: string | null; belt?: number }) {
  const champ = !!f && champId === f.id
  const n = <>{champ && <ChampBelt size={belt} />}<bdi>{nick(f, side)}</bdi></>
  const cls = champ ? `${className} has-champ` : className
  return f ? <Link className={cls} to={`/app/fighters/${f.id}`}>{n}</Link> : <span className={cls}>{n}</span>
}

interface DuelProps {
  fight: FightRow
  red?: Fighter
  blue?: Fighter
  /** above the fold: eager photos */
  priority?: boolean
  /** the result arrived while the viewer was looking: the result stamp lands */
  landResult?: boolean
}

export function Duel({ fight, red, blue, priority, landResult }: DuelProps) {
  const champId = useChampionId()
  const settled = fight.status === 'settled' && !!fight.winner_side
  const corner = (side: Side, f?: Fighter) => {
    const won = settled && fight.winner_side === side
    return (
      <div className="duel-side">
        <div className={`corner corner--${side} label`}>{side === 'red' ? 'Red' : 'Blue'} corner</div>
        <div className="ht-wrap">
          <HalftonePhoto path={f?.photo_path} name={nick(f, side)} size={170} aspect="4 / 3" priority={priority} alt={`${side} corner`} />
          {won && (
            <Stamp fill className="result-stamp" {...(landResult ? { 'data-land': '' } : {})}>{resultStampText(fight.method)}</Stamp>
          )}
        </div>
        <Name f={f} side={side} className="fname t-bout" champId={champId} belt={28} />
        {settled && (
          <p className="method">{won ? (fight.finish_move?.trim() || (fight.method ? METHOD_LABEL[fight.method] : 'Winner')) : lostBy(fight.method)}</p>
        )}
      </div>
    )
  }
  return (
    <>
      {fight.is_title_fight && <TitleFightMark className="duel-title" />}
      <div className={settled ? 'duel duel--settled' : 'duel'}>
        {corner('red', red)}
        {!settled && <Stamp size="lg" fill className="vs" aria-hidden="true">VS</Stamp>}
        {corner('blue', blue)}
      </div>
      <MatDivider className="duel-divider" />
    </>
  )
}

/** Mirrored tale of the tape. Rows with no data on either side are left out (never invented). */
export function TaleOfTape({ fight, red, blue }: { fight: FightRow; red?: Fighter; blue?: Fighter }) {
  const settled = fight.status === 'settled'
  const kgR = fmtKg(cornerKg(fight, 'red', red)).replace(' ', ' ')
  const kgB = fmtKg(cornerKg(fight, 'blue', blue)).replace(' ', ' ')
  const rows: [string, string, string][] = []
  if (settled) {
    if (fight.elo_delta != null) rows.push([fmtDelta(fight.elo_delta), 'Elo', fmtDelta(-fight.elo_delta)])
    if (kgR || kgB) rows.push([kgR || 'Not set', 'Weight', kgB || 'Not set'])
  } else {
    if (kgR || kgB) rows.push([kgR || 'Not set', 'Weight', kgB || 'Not set'])
    if (red || blue) rows.push([red ? fmtRecord(red) : '', 'Record', blue ? fmtRecord(blue) : ''])
    if (red || blue) rows.push([red ? red.elo.toLocaleString('en-GB') : '', 'Elo', blue ? blue.elo.toLocaleString('en-GB') : ''])
  }
  if (!rows.length) return null
  return (
    <table className="tot">
      <caption className="sr-only">{settled ? 'After the bout' : 'Tale of the tape'}: red corner left, blue corner right</caption>
      <tbody>
        {rows.map(([l, k, r]) => <tr key={k}><td>{l}</td><th scope="row">{k}</th><td>{r}</td></tr>)}
      </tbody>
    </table>
  )
}

export function ScoreRow({ fight, compact }: { fight: FightRow; compact?: boolean }) {
  if (fight.red_score == null || fight.blue_score == null) return null
  return (
    <div className={compact ? 'score-row score-row--sm' : 'score-row t-score'} aria-hidden="true">
      <span className="c-red">{fight.red_score}</span><span className="dash">–</span><span className="c-blue">{fight.blue_score}</span>
    </div>
  )
}

/** Undercard matchup on ink. Thumbnails hide below 360px (CSS) so names never break mid-word. */
export function BoutVs({ fight, red, blue }: { fight: FightRow; red?: Fighter; blue?: Fighter }) {
  const champId = useChampionId()
  const meta = (side: Side, f?: Fighter) => {
    const kg = fmtKg(cornerKg(fight, side, f)).replace(' ', ' ')
    const rec = f ? fmtRecord(f) : ''
    const parts = side === 'red' ? [kg, rec] : [rec, kg]
    return <span>{parts.filter(Boolean).join(' · ')}</span>
  }
  return (
    <>
      {fight.is_title_fight && <TitleFightMark onInk belt={26} className="bout-title" />}
      <div className="bout-vs">
        <HalftonePhoto path={red?.photo_path} name={nick(red, 'red')} ink="bone" size={48} alt="red corner" />
        <Name f={red} side="red" className="nm nm--red" champId={champId} belt={20} />
        <span className="vs" aria-hidden="true">vs</span>
        <Name f={blue} side="blue" className="nm nm--blue" champId={champId} belt={20} />
        <HalftonePhoto path={blue?.photo_path} name={nick(blue, 'blue')} ink="bone" size={48} alt="blue corner" />
      </div>
      <div className="bout-meta data">{meta('red', red)}{meta('blue', blue)}</div>
    </>
  )
}
