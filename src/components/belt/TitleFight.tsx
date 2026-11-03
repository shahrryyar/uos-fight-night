/**
 * Title-fight marks. Gold (<ChampionBelt/>) appears only for the champion or a title bout.
 *   <TitleFightMark/>  the belt plate next to a crisp "Title fight" label (real state: fights.is_title_fight).
 *                      Not a <Stamp>: the sheet's one stamp is its state stamp (DESIGN 11.7).
 *   <ChampTag/>        belt plate + "Champion" label, for a corner line or profile hero
 *   <ChampBelt/>       the bare plate with the accessible name "Champion", next to a name
 */
import { ChampionBelt } from '../brand'
import { cx } from '../ui'
import './belt.css'

export function TitleFightMark({ onInk, className, belt = 30 }: { onInk?: boolean; className?: string; belt?: number }) {
  return (
    <p className={cx('title-mark', onInk && 'title-mark--ink', className)}>
      <ChampionBelt size={belt} />
      <span className="label">Title fight</span>
    </p>
  )
}

export function ChampTag({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('champ-tag label', className)}>
      <ChampionBelt size={size} />Champion
    </span>
  )
}

export function ChampBelt({ size = 22, className }: { size?: number; className?: string }) {
  return <ChampionBelt size={size} label="Champion" className={cx('champ-belt', className)} />
}
