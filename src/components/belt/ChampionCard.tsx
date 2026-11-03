/**
 * "Current champion" sheet at the top of Ranks (CONTRACT B5): flat paper, no tape (nothing to act on).
 * Photo with the belt plate on its corner, the name, how long the reign has run and the defenses.
 * Vacant: says so plainly. Every number comes from current_champion; nothing is invented.
 */
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fmtDay, must, useAsync } from '../../lib/hooks'
import type { Fighter } from '../../lib/types'
import { ChampionBelt } from '../brand'
import { HalftonePhoto, Paper, Skeleton } from '../ui'
import { useChampion } from './useChampion'
import { daysText, reignDays } from './reign'
import './belt.css'

export default function ChampionCard({ className }: { className?: string }) {
  const { champion, loaded, error } = useChampion()
  const id = champion?.fighter_id ?? null
  const photo = useAsync(async () => {
    if (!id) return null
    return must(await supabase.from('fighters').select('photo_path').eq('id', id).maybeSingle()) as Pick<Fighter, 'photo_path'> | null
  }, [id])

  if (error) return null // the rest of Ranks still works; the marks next to names stay honest (none shown)
  if (!loaded) {
    return (
      <div className={className} role="status" aria-label="Loading the champion">
        <Skeleton h={128} style={{ marginTop: 18 }} />
      </div>
    )
  }

  if (!champion) {
    return (
      <Paper as="section" className={`champ-card champ-card--vacant ${className ?? ''}`} aria-labelledby="champ-h">
        <h2 id="champ-h" className="label">Current champion</h2>
        <p className="t-head" style={{ marginTop: 6 }}>Vacant</p>
        <p className="t-help" style={{ marginTop: 6 }}>Nobody holds the belt right now. An admin awards it, then it moves when the champion loses.</p>
      </Paper>
    )
  }

  const days = reignDays(champion.since)
  return (
    <Paper as="section" className={`champ-card ${className ?? ''}`} aria-labelledby="champ-h">
      <h2 id="champ-h" className="champ-head label"><ChampionBelt size={40} />Current champion</h2>
      <HalftonePhoto path={photo.data?.photo_path} name={champion.nickname} size={88} priority />
      <div className="champ-body">
        <Link className="t-head champ-name" to={`/app/fighters/${champion.fighter_id}`}><bdi>{champion.nickname}</bdi></Link>
        <ul className="data champ-facts" role="list">
          <li>Held <b>{daysText(days).toLowerCase()}</b>, since <b className="nowrap">{fmtDay(champion.since)}</b></li>
          <li><b>{champion.defenses}</b> title {champion.defenses === 1 ? 'defense' : 'defenses'}</li>
        </ul>
      </div>
    </Paper>
  )
}
