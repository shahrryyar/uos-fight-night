/**
 * Tonight (/app). DESIGN 10 + 11.3, mockups fightcard.html / states-a / states-b.
 * Decision first: the live main event leads (taped poster when you can pick), then the undercard rows
 * (open, locked, booked), then finished bouts collapsed at the bottom. One poster per screen at most.
 * Data: the same fights query, realtime channel and 10s poll as before.
 */
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAppBalance } from '../lib/balance'
import { countdown } from '../lib/math'
import { groupByCard, must, useAsync, useFightersMap, useNow, usePoll, useRealtime, type FightRow } from '../lib/hooks'
import FightPanel from '../components/member/FightPanel'
import { fmtCardDay, tonightSort } from '../components/member/format'
import { Alert, ButtonLink, EmptyState, Loading, Ranking } from '../components/ui'
import '../components/member/tonight.css'

const RECENT_WINDOW_MS = 12 * 3600_000

const isLive = (f: FightRow) => f.status === 'scheduled' || f.status === 'open' || f.status === 'locked'
const bouts = (n: number) => `${n} bout${n === 1 ? '' : 's'}`

export default function FightCard() {
  const now = useNow(1000)
  const { profile } = useAuth()
  const { balance, reload: reloadBalance } = useAppBalance()

  const fights = useAsync(async () => {
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString()
    const rows = must(await supabase.from('fights').select('*')
      .or(`status.in.(scheduled,open,locked),and(status.eq.settled,settled_at.gte.${since}),and(status.eq.cancelled,scheduled_at.gte.${since})`)
      .order('scheduled_at', { ascending: true })) as FightRow[]
    return groupByCard(rows)
  }, [])

  useRealtime('fights', [{ table: 'fights' }], () => { void fights.reload(); void reloadBalance() })
  usePoll(() => void fights.reload(), 10_000)

  const ids = (fights.data ?? []).flatMap(c => c.fights.flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))
  const fighters = useFightersMap(ids)
  // records and Elo change when a bout is settled or a result corrected; the fighters map is keyed by
  // id only, so refetch it whenever any bout's result signature moves (realtime or the 10s poll)
  const resultSig = (fights.data ?? []).flatMap(c => c.fights)
    .map(f => `${f.id}:${f.status}:${f.settled_at ?? ''}:${f.winner_side ?? ''}:${f.elo_delta ?? ''}`).join('|')
  const seenSig = useRef<string | null>(null)
  const reloadFighters = fighters.reload
  useEffect(() => {
    if (!fights.data) return
    if (seenSig.current !== null && seenSig.current !== resultSig) void reloadFighters()
    seenSig.current = resultSig
  }, [resultSig, fights.data, reloadFighters])

  const head = (date?: string, n?: number) => (
    <div className="pagehead">
      <h1 className="t-title">Tonight</h1>
      {date && <p className="data c-2"><span className="nowrap">{fmtCardDay(date)}</span> · <span className="nowrap">{bouts(n ?? 0)}</span></p>}
    </div>
  )

  if (fights.loading && !fights.data) {
    return <div className="pg-tonight">{head()}<Loading label="Loading tonight’s card…" /></div>
  }
  if (fights.error && !fights.data) {
    return (
      <div className="pg-tonight">
        {head()}
        <Alert title="Couldn’t load tonight’s card." onRetry={() => void fights.reload()}>
          Check your connection and try again. Picks you already made are saved.
        </Alert>
      </div>
    )
  }
  const cards = fights.data ?? []
  if (!cards.length) {
    return (
      <div className="pg-tonight">
        <EmptyState as="h1" size="title" art="mat" title="No fight booked tonight"
          body="Rest up. Check the ranks, and come back when admins post the next card."
          action={<ButtonLink to="/app/leaderboard" variant="bone" size="sm" icon={Ranking}>See the ranks</ButtonLink>} />
      </div>
    )
  }

  const sort = tonightSort(now)
  const fid = profile?.fighter_id ?? null
  const inBout = (f: FightRow) => !!fid && (f.red_fighter_id === fid || f.blue_fighter_id === fid)
  const mustAnswer = (f: FightRow) => f.status === 'scheduled' && inBout(f)
    && !(f.red_fighter_id === fid ? f.red_accepted_at : f.blue_accepted_at)
  // tape follows actionability: ONE poster per screen, for the open main event of the first card or,
  // failing that, the first booking you must answer
  const posterId = (() => {
    for (const card of cards) {
      const main = card.fights.find(f => f.is_main_event && isLive(f))
      if (main && main.status === 'open' && !countdown(main.lock_at, now).done && !inBout(main)) return main.id
      const ask = card.fights.find(mustAnswer)
      if (ask) return ask.id
    }
    return null
  })()

  return (
    <div className="pg-tonight">
      {head(cards[0].cardDate, cards[0].fights.length)}
      {cards.map((card, ci) => {
        const list = [...card.fights].sort(sort)
        const live = list.filter(isLive)
        const done = list.filter(f => !isLive(f))
        const featured = live.find(f => f.is_main_event)
          ?? (live.length === 0 ? done.find(f => f.is_main_event && f.status === 'settled') : undefined)
        const rows = live.filter(f => f !== featured)
        const results = done.filter(f => f !== featured)
          .sort((a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled') || (a.bout_order ?? 0) - (b.bout_order ?? 0))

        const panel = (f: FightRow, size: 'main' | 'row') => (
          <FightPanel key={f.id} fight={f} now={now} size={size} taped={f.id === posterId}
            red={fighters.data?.get(f.red_fighter_id)} blue={fighters.data?.get(f.blue_fighter_id)}
            balance={balance} onPointsChanged={() => void reloadBalance()}
            onFightChanged={() => void fights.reload()} />
        )

        return (
          <section key={card.cardDate} className={ci > 0 ? 'section tonight-card' : 'tonight-card'}
            aria-label={ci > 0 ? `Card ${fmtCardDay(card.cardDate)}` : undefined}>
            {ci > 0 && (
              <div className="section-head">
                <h2 className="t-head">Next card · <span className="nowrap">{fmtCardDay(card.cardDate)}</span></h2>
                <span className="data c-2">{bouts(card.fights.length)}</span>
              </div>
            )}
            {featured && panel(featured, 'main')}
            {rows.length > 0 && (
              <section className="section" aria-labelledby={`uc-${card.cardDate}`}>
                <div className="section-head">
                  <h2 id={`uc-${card.cardDate}`} className="t-head">{featured ? 'Undercard' : 'Bouts'}</h2>
                  <span className="data c-2">{bouts(rows.length)}</span>
                </div>
                <div className="bouts">{rows.map(f => panel(f, 'row'))}</div>
              </section>
            )}
            {results.length > 0 && (
              <section className="section" aria-labelledby={`done-${card.cardDate}`}>
                <div className="section-head">
                  <h2 id={`done-${card.cardDate}`} className="t-head">Finished</h2>
                  <span className="data c-2">{bouts(results.length)}</span>
                </div>
                <div className="bouts">{results.map(f => panel(f, 'row'))}</div>
              </section>
            )}
          </section>
        )
      })}
    </div>
  )
}
