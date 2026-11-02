import { Link } from 'react-router-dom'
import FighterPhoto from '../FighterPhoto'
import StatusBadge from './StatusBadge'
import { StreakPill } from './ui'
import { countdown, formatStreak } from '../../lib/math'
import { fmtDate, record } from '../../lib/hooks'
import type { Fight, Fighter, Side } from '../../lib/types'

interface Props { fight: Fight; red?: Fighter; blue?: Fighter; now: Date }

/** Big poster-style red vs blue matchup header. */
export default function VsCard({ fight, red, blue, now }: Props) {
  const cd = countdown(fight.lock_at, now)
  const pastLock = fight.status === 'open' && cd.done
  const winner = fight.status === 'settled' ? fight.winner_side : null
  return (
    <div className="relative overflow-hidden rounded-t-2xl">
      <div className="absolute inset-0 bg-linear-to-r from-red-dark/70 via-ink to-blue-dark/70" aria-hidden />
      <div className="relative px-3 pt-3 pb-4">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={fight.status} lockedEarly={pastLock} />
          <span className="text-[11px] uppercase tracking-widest text-muted">{fmtDate(fight.scheduled_at)}</span>
        </div>
        {fight.title && (
          <p className="mt-3 text-center font-display text-2xl tracking-[0.2em] text-gold leading-none">{fight.title}</p>
        )}
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-1">
          <Corner side="red" f={red} winner={winner} />
          <div className="pt-10 text-center">
            <span className="font-display text-5xl leading-none text-gold drop-shadow-[0_2px_0_#000]">VS</span>
          </div>
          <Corner side="blue" f={blue} winner={winner} />
        </div>
        {fight.status === 'open' && (
          <div className="mt-4 text-center">
            <p className="text-[11px] uppercase tracking-widest text-muted">{pastLock ? 'Locking…' : 'Picks lock in'}</p>
            <p className="font-display text-4xl tracking-wider tabular-nums leading-none">{pastLock ? 'NOW' : cd.label}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Corner({ side, f, winner }: { side: Side; f?: Fighter; winner: Side | null }) {
  const name = f?.nickname ?? 'TBA'
  const lost = winner && winner !== side
  const won = winner === side
  const body = (
    <div className={`flex flex-col items-center text-center ${lost ? 'opacity-45 grayscale' : ''}`}>
      <div className="relative">
        <FighterPhoto path={f?.photo_path} nickname={name} corner={side} className="size-28 text-3xl" />
        {won && <span className="absolute -top-2 -right-1 text-2xl" aria-label="Winner">👑</span>}
      </div>
      <p className={`mt-1 text-[10px] font-bold uppercase tracking-[0.25em] ${side === 'red' ? 'text-red' : 'text-blue'}`}>
        {side} corner
      </p>
      <p className="font-display text-3xl leading-none tracking-wide break-words max-w-full">{name}</p>
      {f && (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
          <span className="font-semibold text-bone tabular-nums">{record(f)}</span>
          <span>·</span>
          <span className="tabular-nums">{f.elo} Elo</span>
          <StreakPill streak={f.streak} label={formatStreak(f.streak)} />
        </div>
      )}
    </div>
  )
  return f ? <Link to={`/app/fighters/${f.id}`} className="block min-w-0">{body}</Link> : <div className="min-w-0">{body}</div>
}
