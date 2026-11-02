import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  cornerKg, fmtCardDay, fmtKg, fmtRounds, fmtTime, groupByCard, lostBy, METHOD_LABEL, must, useAsync, useFightersMap,
  type FightRow,
} from '../lib/hooks'
import { cancelCopy, fmtDelta, resultStampText } from '../lib/copy'
import type { Fighter, Side } from '../lib/types'
import { Alert, EmptyState, Loading, Paper, Stamp } from '../components/ui'

/** History: every finished bout, grouped by card, newest card first. Settled = compact paper sheet, cancelled = row on ink. */
export default function History() {
  const st = useAsync(async () => {
    const rows = must(await supabase.from('fights').select('*').in('status', ['settled', 'cancelled'])
      .order('scheduled_at', { ascending: false }).limit(200)) as FightRow[]
    return { rows, cards: groupByCard(rows, true) }
  }, [])
  const fighters = useFightersMap((st.data?.rows ?? []).flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))

  return (
    <div>
      <h1 className="t-title">History</h1>
      <p className="t-help c-2" style={{ marginTop: 6 }}>Every bout in the books, newest card first.</p>
      {st.loading && !st.data ? <Loading label="Loading results…" />
        : st.error ? <Alert title="Couldn't load the results." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again.</Alert>
        : !st.data?.rows.length ? <EmptyState title="No results yet" body="Finished bouts land here with the score and how they ended." />
        : st.data.cards.map((card, i) => {
          const hid = `card-${card.cardDate}`
          return (
            <section key={card.cardDate} className="section" style={i === 0 ? { marginTop: 24 } : undefined} aria-labelledby={hid}>
              <div className="section-head">
                <h2 id={hid} className="t-head">{fmtCardDay(card.cardDate)}</h2>
                <span className="data c-2 nowrap">{card.fights.length} bout{card.fights.length === 1 ? '' : 's'}</span>
              </div>
              <div className="grid gap-4">
                {card.fights.map(f => f.status === 'cancelled'
                  ? <CalledOff key={f.id} f={f} red={fighters.data?.get(f.red_fighter_id)} blue={fighters.data?.get(f.blue_fighter_id)} />
                  : <Result key={f.id} f={f} red={fighters.data?.get(f.red_fighter_id)} blue={fighters.data?.get(f.blue_fighter_id)} />)}
              </div>
            </section>
          )
        })}
    </div>
  )
}

const boutLabel = (f: FightRow) => (f.is_main_event ? 'Main event' : f.title?.trim() || (f.bout_order ? `Bout ${f.bout_order}` : 'Bout'))
const methodName = (m: string | null | undefined) => (m ? (METHOD_LABEL[m] ?? m).toLowerCase() : '')

function Result({ f, red, blue }: { f: FightRow; red?: Fighter; blue?: Fighter }) {
  const w = f.winner_side
  const winner = w === 'red' ? red : w === 'blue' ? blue : undefined
  const loser = w === 'red' ? blue : w === 'blue' ? red : undefined
  const rounds = fmtRounds(f.rounds)
  const hasScore = f.red_score != null && f.blue_score != null
  const sentence = winner && loser
    ? `${winner.nickname} beat ${loser.nickname}${hasScore ? ` ${w === 'red' ? f.red_score : f.blue_score} to ${w === 'red' ? f.blue_score : f.red_score}` : ''}`
      + `${f.method ? ` by ${methodName(f.method)}` : ''}${f.finish_move?.trim() ? `, ${f.finish_move.trim().toLowerCase()}` : ''}${rounds ? `, in ${rounds}` : ''}`
    : `${red?.nickname ?? 'Red corner'} versus ${blue?.nickname ?? 'Blue corner'}`
  const hid = `res-${f.id}`

  return (
    <Paper as="article" aria-labelledby={hid}>
      <div className="ev-top" style={{ flexWrap: 'wrap' }}>
        <span className="data" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{boutLabel(f)}</span>
        {winner && <Stamp tone="ink" size="sm" rot={-3}>{resultStampText(f.method)}</Stamp>}
      </div>
      <h3 id={hid} className="sr-only">{sentence}</h3>
      {hasScore && (
        <div className="score-row t-score" aria-hidden="true" style={{ fontSize: '3rem', marginTop: 8 }}>
          <span className="c-red">{f.red_score}</span><span className="dash">–</span><span className="c-blue">{f.blue_score}</span>
        </div>
      )}
      {rounds && <p className="data" style={{ marginTop: 6 }}><b>{rounds}</b></p>}
      <div className="grid grid-cols-2 gap-3" style={{ marginTop: 12 }}>
        <Corner f={f} side="red" fighter={red} />
        <Corner f={f} side="blue" fighter={blue} />
      </div>
      {f.result_note?.trim() && (
        <blockquote className="ref">{`“${f.result_note.trim()}”`}<cite>Ref note</cite></blockquote>
      )}
    </Paper>
  )
}

function Corner({ f, side, fighter }: { f: FightRow; side: Side; fighter?: Fighter }) {
  const fid = side === 'red' ? f.red_fighter_id : f.blue_fighter_id
  const won = f.winner_side === side
  const decided = f.winner_side === 'red' || f.winner_side === 'blue'
  const kg = fmtKg(cornerKg(f, side, fighter)).replace(' ', ' ')
  const delta = f.elo_delta != null ? (side === 'red' ? f.elo_delta : -f.elo_delta) : null
  const end = side === 'blue'
  return (
    <div style={end ? { textAlign: 'end' } : undefined}>
      <div className={`corner corner--${side} label`} style={{ display: 'inline-flex', minHeight: 24 }}>{side === 'red' ? 'Red corner' : 'Blue corner'}</div>
      <Link to={`/app/fighters/${fid}`} className="t-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: end ? 'flex-end' : 'flex-start', minHeight: 44, color: 'inherit', textDecoration: 'none', marginTop: 4 }}>
        <bdi>{fighter?.nickname ?? 'Unknown fighter'}</bdi>
      </Link>
      {decided && (won
        ? <>
            <p className="method">Winner</p>
            {f.finish_move?.trim() && <p className="data c-2">{f.finish_move.trim()}</p>}
          </>
        : <p className="method">{lostBy(f.method)}</p>)}
      {kg && <p className="data c-2" style={{ marginTop: 4 }}>{kg}</p>}
      {delta != null && <p className="data c-2">Elo <b>{fmtDelta(delta)}</b></p>}
    </div>
  )
}

function CalledOff({ f, red, blue }: { f: FightRow; red?: Fighter; blue?: Fighter }) {
  const c = cancelCopy(f.cancel_kind)
  const hid = `co-${f.id}`
  return (
    <article className="bout" aria-labelledby={hid} style={{ paddingTop: 0 }}>
      <div className="bout-top" style={{ flexWrap: 'wrap', rowGap: 4 }}>
        <Stamp tone="bone" size="sm" rot={2}>{c.stamp}</Stamp>
        <span className="data c-2" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {boutLabel(f)}<span className="nowrap">{'\u00a0· '}{fmtTime(f.scheduled_at)}</span>
        </span>
      </div>
      <h3 id={hid} className="t-sub" style={{ marginTop: 10 }}>
        <Link to={`/app/fighters/${f.red_fighter_id}`} style={{ color: 'inherit', display: 'inline-block', minHeight: 44, paddingBlock: 8, textDecoration: 'underline', textDecorationThickness: 2, textUnderlineOffset: 4 }}><bdi>{red?.nickname ?? 'Red corner'}</bdi></Link>
        {' '}<span className="c-2" style={{ fontSize: '1rem' }}>vs</span>{' '}
        <Link to={`/app/fighters/${f.blue_fighter_id}`} style={{ color: 'inherit', display: 'inline-block', minHeight: 44, paddingBlock: 8, textDecoration: 'underline', textDecorationThickness: 2, textUnderlineOffset: 4 }}><bdi>{blue?.nickname ?? 'Blue corner'}</bdi></Link>
      </h3>
      <p className="t-help" style={{ marginTop: 6, color: 'var(--color-bone-2)' }}>{c.sub}</p>
      {f.result_note?.trim() && <p className="t-help" style={{ marginTop: 6 }}>Ref note: {`“${f.result_note.trim()}”`}</p>}
    </article>
  )
}
