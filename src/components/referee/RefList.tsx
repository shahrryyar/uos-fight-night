/**
 * C2: /admin/ref, the referee's start page. Lists the bouts they can score right now (picks locked,
 * or open past lock time: the first tap locks those), then the bouts still open, so they can see
 * what comes next. Admins can use it too; the full bout tools stay in Admin > Fights.
 */
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useAsync, useNow, usePoll, useRealtime, fmtTime, fmtDayTime, boutSort, todayCard } from '../../lib/hooks'
import type { Fight, Fighter, LiveScore } from '../../lib/types'
import { ButtonLink, CaretRight, EmptyState, Loading, Alert, Stamp, Timer } from '../ui'
import type { FinishPrefill } from './Scoreboard'
import './referee.css'

type RefFight = Fight & { bout_order: number; is_main_event: boolean; card_date: string }

interface ListData { fights: RefFight[]; names: Record<string, string>; live: Record<string, LiveScore> }

/** route state left by the scoreboard when a referee finishes a bout */
export interface RefFinishedState { refFinished: FinishPrefill & { redName: string; blueName: string } }

const boutLabel = (f: RefFight) => (f.is_main_event ? 'Main event' : `Bout ${f.bout_order}`)
const LIVE_MS = 10 * 60_000
/** time only on today's card, day and time otherwise */
const when = (f: RefFight, iso: string) => (f.card_date === todayCard() ? fmtTime(iso) : fmtDayTime(iso))

export default function RefList() {
  const { profile } = useAuth()
  const loc = useLocation()
  const finished = (loc.state as Partial<RefFinishedState> | null)?.refFinished

  const data = useAsync<ListData>(async () => {
    const fights = must(await supabase.from('fights').select('*').in('status', ['open', 'locked'])
      .order('scheduled_at', { ascending: true })) as RefFight[]
    const ids = [...new Set(fights.flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))]
    const [fx, lx] = await Promise.all([
      ids.length ? supabase.from('fighters').select('id, nickname').in('id', ids) : Promise.resolve({ data: [], error: null }),
      fights.length ? supabase.from('live_scores').select('*').in('fight_id', fights.map(f => f.id)) : Promise.resolve({ data: [], error: null }),
    ])
    const names = Object.fromEntries(((must(fx) ?? []) as Pick<Fighter, 'id' | 'nickname'>[]).map(f => [f.id, f.nickname]))
    // live_scores may be unreadable for some roles: a missing LIVE stamp is fine
    const live = Object.fromEntries(((lx.error ? [] : lx.data ?? []) as LiveScore[]).map(l => [l.fight_id, l]))
    return { fights, names, live }
  }, [])

  useRealtime('ref-list', [{ table: 'fights' }, { table: 'live_scores' }], () => void data.reload())
  usePoll(() => void data.reload(), 30_000) // open bouts cross their lock time without a row change

  const now = useNow(5000).getTime()
  const all = (data.data?.fights ?? []).slice().sort((a, b) => a.card_date === b.card_date ? boutSort(a, b) : a.card_date < b.card_date ? -1 : 1)
  const ready = all.filter(f => f.status === 'locked' || new Date(f.lock_at).getTime() <= now)
  const later = all.filter(f => !ready.includes(f))
  const mine = (f: RefFight) => !!profile?.fighter_id && [f.red_fighter_id, f.blue_fighter_id].includes(profile.fighter_id)
  const nm = (id: string, side: 'Red' | 'Blue') => data.data?.names[id] ?? `${side} corner`

  return (
    <div className="pg-reflist">
      <title>Ref · UoS Fight Night</title>
      <h1 className="t-title">Ref</h1>
      <p className="t-body c-2 rl-intro">Run the clock and the score for a bout once its picks are locked. An admin records the result after.</p>

      {finished && (
        <div className="paper rl-done" role="status">
          <Stamp tone="ink" size="sm" rot={-3} land stateKey={finished.fightId}>Bout over</Stamp>
          <p className="t-body">
            <b><bdi>{finished.redName}</bdi> {finished.red}</b>, <b><bdi>{finished.blueName}</bdi> {finished.blue}</b> after {finished.rounds} round{finished.rounds === 1 ? '' : 's'}.
            The clock is stopped. Tell an admin, so they can record the winner and how it ended.
          </p>
        </div>
      )}

      {data.error && !data.data && (
        <Alert title="Couldn't load the bouts." onRetry={() => void data.reload()}>{data.error} Check your connection and try again.</Alert>
      )}
      {data.loading && !data.data && <Loading label="Loading the bouts…" shape="rows" />}

      {data.data && (
        <section className="section rl-sec" aria-labelledby="rl-now">
          <h2 id="rl-now" className="t-head">Ready to ref</h2>
          {ready.length === 0 ? (
            <EmptyState as="h3" size="head" title="Nothing to ref right now"
              body="A bout shows up here as soon as its picks lock. Keep this page open, it updates by itself."
              action={<ButtonLink to="/app" variant="bone" size="sm" className="mt-4">Go to Tonight</ButtonLink>} />
          ) : (
            <ul className="rows rl-rows" role="list">
              {ready.map(f => {
                const l = data.data!.live[f.id]
                const isLive = !!l && (l.running || now - new Date(l.updated_at).getTime() < LIVE_MS)
                const body = (
                  <>
                    <span className="rl-meta">
                      <span className="label">{boutLabel(f)}</span>
                      <span className="data c-2">{when(f, f.scheduled_at)}</span>
                    </span>
                    <span className="rl-names">
                      <span className="t-sub nm--red"><bdi>{nm(f.red_fighter_id, 'Red')}</bdi></span>
                      <span className="rl-vs label c-2">vs</span>
                      <span className="t-sub nm--blue"><bdi>{nm(f.blue_fighter_id, 'Blue')}</bdi></span>
                    </span>
                    <span className="rl-end">
                      {mine(f)
                        ? <span className="t-help c-2">You're in this one</span>
                        : <>{isLive && <Stamp tone="live" size="sm" rot={-3}>Live {l.red_score}–{l.blue_score}</Stamp>}<CaretRight className="rl-chev" /></>}
                    </span>
                  </>
                )
                return (
                  <li key={f.id}>
                    {mine(f)
                      ? <div className="row rl-row">{body}</div>
                      : <Link to={`/admin/ref/${f.id}`} className="row row-link rl-row"
                          aria-label={`Run the scoreboard: ${nm(f.red_fighter_id, 'Red')} vs ${nm(f.blue_fighter_id, 'Blue')}, ${boutLabel(f)}`}>{body}</Link>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {data.data && later.length > 0 && (
        <section className="section rl-sec" aria-labelledby="rl-later">
          <h2 id="rl-later" className="t-head">Coming up</h2>
          <p className="t-help c-2">Picks are still open on these. They move up when picks lock.</p>
          <ul className="rows rl-rows" role="list">
            {later.map(f => (
              <li key={f.id}>
                <div className="row rl-row">
                  <span className="rl-meta">
                    <span className="label">{boutLabel(f)}</span>
                    <span className="data c-2"><Timer aria-hidden="true" /> Locks {when(f, f.lock_at)}</span>
                  </span>
                  <span className="rl-names">
                    <span className="t-sub nm--red"><bdi>{nm(f.red_fighter_id, 'Red')}</bdi></span>
                    <span className="rl-vs label c-2">vs</span>
                    <span className="t-sub nm--blue"><bdi>{nm(f.blue_fighter_id, 'Blue')}</bdi></span>
                  </span>
                  <span className="rl-end" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
