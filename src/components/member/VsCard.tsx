import { Link } from 'react-router-dom'
import FighterPhoto from '../FighterPhoto'
import StatusBadge from './StatusBadge'
import { StreakPill } from './ui'
import { countdown, formatStreak } from '../../lib/math'
import { METHOD_LABEL, cornerKg, fmtDate, fmtKg, fmtRounds, lostBy, record, type FightRow } from '../../lib/hooks'
import type { Fighter, Side } from '../../lib/types'

export type CardSize = 'main' | 'undercard'

interface Props { fight: FightRow; red?: Fighter; blue?: Fighter; now: Date; size?: CardSize }

/** Big poster-style red vs blue matchup header. Undercard bouts render smaller. */
export default function VsCard({ fight, red, blue, now, size = 'main' }: Props) {
  const cd = countdown(fight.lock_at, now)
  const pastLock = fight.status === 'open' && cd.done
  const settled = fight.status === 'settled'
  const winner = settled ? fight.winner_side : null
  const small = size === 'undercard'
  const hasScore = settled && fight.red_score != null && fight.blue_score != null
  return (
    <div className="relative overflow-hidden rounded-t-2xl">
      <div className="absolute inset-0 bg-linear-to-r from-red-dark/70 via-ink to-blue-dark/70" aria-hidden />
      {fight.is_main_event && (
        <div className="relative bg-gold py-1.5 text-center font-display text-2xl leading-none tracking-[0.35em] text-ink">
          ★ MAIN EVENT ★
        </div>
      )}
      <div className={`relative px-3 ${small ? 'pt-2.5 pb-3' : 'pt-3 pb-4'}`}>
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={fight.status} lockedEarly={pastLock} cancelKind={fight.cancel_kind} />
          <span className="text-[11px] uppercase tracking-widest text-muted">{fmtDate(fight.scheduled_at)}</span>
        </div>
        {fight.title && (
          <p className={`mt-3 text-center font-display tracking-[0.2em] text-gold leading-none ${small ? 'text-xl' : 'text-2xl'}`}>{fight.title}</p>
        )}
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-1">
          <Corner side="red" f={red} fight={fight} winner={winner} small={small} />
          <div className={`text-center ${small ? 'pt-7' : 'pt-10'}`}>
            <span className={`font-display leading-none text-gold drop-shadow-[0_2px_0_#000] ${small ? 'text-4xl' : 'text-5xl'}`}>VS</span>
          </div>
          <Corner side="blue" f={blue} fight={fight} winner={winner} small={small} />
        </div>
        {settled && (
          <div className="mt-3 text-center">
            {hasScore && (
              <p className={`font-display leading-none tabular-nums tracking-wide ${small ? 'text-5xl' : 'text-6xl'}`}
                aria-label={`Score ${fight.red_score} to ${fight.blue_score}`}>
                <span className="text-red">{fight.red_score}</span>
                <span className="mx-2 text-muted">–</span>
                <span className="text-blue">{fight.blue_score}</span>
              </p>
            )}
            {fight.rounds != null && (
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.3em] text-muted">{fmtRounds(fight.rounds)}</p>
            )}
            {fight.result_note && <p className="mx-auto mt-1.5 max-w-xs text-[11px] italic text-muted">Ref: “{fight.result_note}”</p>}
          </div>
        )}
        {fight.status === 'open' && (
          <div className="mt-4 text-center">
            <p className="text-[11px] uppercase tracking-widest text-muted">{pastLock ? 'Locking…' : 'Picks lock in'}</p>
            <p className={`font-display tracking-wider tabular-nums leading-none ${small ? 'text-3xl' : 'text-4xl'}`}>{pastLock ? 'NOW' : cd.label}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Corner({ side, f, fight, winner, small }: { side: Side; f?: Fighter; fight: FightRow; winner: Side | null; small: boolean }) {
  const name = f?.nickname ?? 'TBA'
  const lost = !!winner && winner !== side
  const won = winner === side
  const kg = fmtKg(cornerKg(fight, side, f))
  const body = (
    <div className="flex flex-col items-center text-center">
      <div className={`flex flex-col items-center ${lost ? 'opacity-45 grayscale' : ''}`}>
        <div className="relative">
          <FighterPhoto path={f?.photo_path} nickname={name} corner={side} className={small ? 'size-20 text-2xl' : 'size-28 text-3xl'} />
          {won && <span className="absolute -top-2 -right-1 text-2xl" aria-label="Winner">👑</span>}
        </div>
        <p className={`mt-1 text-[10px] font-bold uppercase tracking-[0.25em] ${side === 'red' ? 'text-red' : 'text-blue'}`}>
          {side} corner
        </p>
        <p className={`font-display leading-none tracking-wide break-words max-w-full ${small ? 'text-2xl' : 'text-3xl'}`}>{name}</p>
        <p className="mt-0.5 text-sm font-semibold tabular-nums text-bone/90">{kg || '— kg'}</p>
        {f && (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
            <span className="font-semibold text-bone tabular-nums">{record(f)}</span>
            <span>·</span>
            <span className="tabular-nums">{f.elo} Elo</span>
            <StreakPill streak={f.streak} label={formatStreak(f.streak)} />
          </div>
        )}
      </div>
      {won && (
        <p className="mt-2 rounded-md bg-gold px-2 py-1 text-[11px] font-black leading-tight tracking-wide text-ink">
          WIN by {(fight.method ? METHOD_LABEL[fight.method] : '—').toUpperCase()}
          {fight.finish_move && <span className="font-semibold"> ({fight.finish_move})</span>}
        </p>
      )}
      {lost && <p className="mt-2 text-xs font-semibold text-muted">{lostBy(fight.method)}</p>}
    </div>
  )
  return f ? <Link to={`/app/fighters/${f.id}`} className="block min-w-0">{body}</Link> : <div className="min-w-0">{body}</div>
}
