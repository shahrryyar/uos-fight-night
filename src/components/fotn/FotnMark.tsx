/**
 * Fight of the Night winner line for a card in History: the star glyph, a crisp label and the bout.
 * On ink (the History card header), so it is not a stamp: each result sheet keeps its one result stamp.
 */
import { Link } from 'react-router-dom'
import { cx } from '../ui'
import { StarMark } from './StarMark'
import './fotn.css'

export interface FotnMarkProps {
  red: { id: string; name: string }
  blue: { id: string; name: string }
  votes?: number | null
  total?: number | null
  className?: string
}

export default function FotnMark({ red, blue, votes, total, className }: FotnMarkProps) {
  return (
    <p className={cx('fotn-mark', className)}>
      <span className="fotn-mark-lab"><StarMark /><span className="label">Fight of the Night</span></span>
      <span className="fotn-mark-bout t-sub">
        <Link to={`/app/fighters/${red.id}`} className="fotn-nm fotn-nm--red"><bdi>{red.name}</bdi></Link>
        <span className="fotn-vs-word"> vs </span>
        <Link to={`/app/fighters/${blue.id}`} className="fotn-nm fotn-nm--blue"><bdi>{blue.name}</bdi></Link>
      </span>
      {votes != null && total != null && total > 0 && (
        <span className="data fotn-mark-n nowrap"><b>{votes}</b> of {total} votes</span>
      )}
    </p>
  )
}
