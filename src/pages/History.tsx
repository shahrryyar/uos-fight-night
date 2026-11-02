import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  cancelCopy, cornerKg, fmtCardDate, fmtKg, fmtRounds, fmtScore, groupByCard, methodMove, must, useAsync, useFightersMap,
  type FightRow,
} from '../lib/hooks'
import type { Fighter, Side } from '../lib/types'
import { Empty, ErrorBox, Loading, PageTitle } from '../components/member/ui'

export default function History() {
  const st = useAsync(async () => {
    const rows = must(await supabase.from('fights').select('*').in('status', ['settled', 'cancelled'])
      .order('scheduled_at', { ascending: false }).limit(200)) as FightRow[]
    return { rows, cards: groupByCard(rows, true) }
  }, [])
  const fighters = useFightersMap((st.data?.rows ?? []).flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))

  return (
    <div>
      <PageTitle sub="Every fight in the books, newest card first.">History</PageTitle>
      {st.loading ? <Loading /> : st.error ? <ErrorBox error={st.error} onRetry={() => void st.reload()} />
        : !st.data?.rows.length ? <Empty>No fights in the books yet.</Empty>
        : (
          <div className="space-y-6">
            {st.data.cards.map(card => (
              <section key={card.cardDate} aria-label={`Card ${fmtCardDate(card.cardDate, true)}`}>
                <h2 className="mb-2 flex items-center gap-2 font-display text-xl leading-none tracking-[0.2em] text-gold">
                  {fmtCardDate(card.cardDate, true)}
                  <span className="h-px flex-1 bg-gold/30" aria-hidden />
                </h2>
                <ul className="space-y-3">
                  {card.fights.map(f => (
                    <HistoryItem key={f.id} f={f} red={fighters.data?.get(f.red_fighter_id)} blue={fighters.data?.get(f.blue_fighter_id)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
    </div>
  )
}

function HistoryItem({ f, red, blue }: { f: FightRow; red?: Fighter; blue?: Fighter }) {
  const cancelled = f.status === 'cancelled'
  const w = f.winner_side
  const loserName = w === 'red' ? blue?.nickname : w === 'blue' ? red?.nickname : undefined
  const score = fmtScore(f.red_score, f.blue_score)

  const corner = (side: Side, fighter?: Fighter) => {
    const fid = side === 'red' ? f.red_fighter_id : f.blue_fighter_id
    const won = w === side
    const kg = fmtKg(cornerKg(f, side, fighter))
    return (
      // The whole corner (name + kg) is the tap target, so it reaches 44px without
      // negative margins that made wrapped names overlap each other and the kg line.
      <Link to={`/app/fighters/${fid}`} className={`group block min-w-0 min-h-11 rounded-lg ${side === 'blue' ? 'text-right' : ''}`}>
        <p className={`font-display text-xl leading-none break-words ${won ? 'text-bone' : 'text-muted'}`}>
          {side === 'red' && <span className="mr-1 inline-block size-2 rounded-full bg-red align-middle" aria-hidden />}
          {side === 'blue' && won && '👑 '}
          <span className="group-hover:underline">{fighter?.nickname ?? '…'}</span>
          {side === 'red' && won && ' 👑'}
          {side === 'blue' && <span className="ml-1 inline-block size-2 rounded-full bg-blue align-middle" aria-hidden />}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-muted">{kg || '— kg'}</p>
      </Link>
    )
  }

  return (
    <li className={`rounded-2xl border bg-surface p-3 ${f.is_main_event ? 'border-gold/60' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-widest text-muted">
        <span className="truncate">
          {f.is_main_event && <span className="mr-1 font-bold text-gold">Main event ·</span>}
          {f.title ?? (f.bout_order ? `Bout ${f.bout_order}` : 'Fight')}
        </span>
        {cancelled && (
          <span className="shrink-0 rounded-full border border-line px-2 py-0.5">
            {f.cancel_kind === 'no_contest' ? 'No contest' : f.cancel_kind === 'declined' ? 'Declined' : 'Cancelled'}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        {corner('red', red)}
        <div className="pt-0.5 text-center">
          {!cancelled && score
            ? <span className="font-display text-2xl leading-none tabular-nums whitespace-nowrap">{score}</span>
            : <span className="font-display text-lg text-gold">VS</span>}
          {!cancelled && f.rounds != null && <p className="text-[10px] uppercase tracking-widest text-muted">{fmtRounds(f.rounds)}</p>}
        </div>
        {corner('blue', blue)}
      </div>
      {!cancelled && (
        <div className="mt-2 space-y-0.5 text-xs text-muted">
          <p>
            Won by <span className="font-semibold text-bone">{methodMove(f.method, f.finish_move)}</span>
            {f.elo_delta != null && <> · Elo <span className="text-gold font-semibold">±{Math.abs(f.elo_delta)}</span></>}
          </p>
          {loserName && <p>{loserName} lost by {methodMove(f.method, null).toLowerCase()}</p>}
          {f.result_note && <p className="italic">Ref: “{f.result_note}”</p>}
        </div>
      )}
      {cancelled && (
        <p className="mt-2 text-xs text-muted">
          <span className="font-semibold text-bone">{cancelCopy(f).title}.</span> {cancelCopy(f).sub}{f.result_note ? ` ${f.result_note}` : ''}
        </p>
      )}
    </li>
  )
}
