import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { must, useAsync } from '../lib/hooks'
import { fmtNum } from '../lib/copy'
import type { BettorRank, CurrentChampion, Season } from '../lib/types'
import { ChampionBelt } from '../components/brand'
import { Alert, ButtonLink, CaretLeft, EmptyState, Loading, Stamp } from '../components/ui'
import { SeasonSheet, fmtSeasonDay, fmtSpan, pickerName } from '../components/season'
import '../components/season/season.css'
import Lead from '../components/season/Lead'

interface Now {
  champion: CurrentChampion | null
  leader: { fighter_id: string; nickname: string; elo: number } | null
  picker: (BettorRank & { display_name?: string | null }) | null
  /** members sharing rank 1 (2+ means a tie, so nobody is named) */
  pickerTied: number
  bouts: number
}

/** Seasons (CONTRACT B7): the running season on ink, then each finished season as a flat result sheet. */
export default function Seasons() {
  const st = useAsync(async () => {
    const [s, f] = await Promise.all([
      supabase.from('seasons').select('*').order('started_at', { ascending: false }).order('id', { ascending: false }),
      supabase.from('fighters').select('id, hidden'),
    ])
    const rows = must(s) as Season[]
    const current = rows.find(x => x.ended_at == null) ?? null
    const visible = new Set((must(f) as { id: string; hidden: boolean }[]).filter(x => !x.hidden).map(x => x.id))
    let now: Now | null = null
    if (current) {
      const [c, lead, pick, bouts] = await Promise.all([
        supabase.from('current_champion').select('*').maybeSingle(),
        // same tie-break as admin_end_season: elo desc, season wins desc, nickname
        supabase.from('fighter_rankings').select('fighter_id, nickname, elo').eq('season_ranked', true)
          .order('elo', { ascending: false }).order('season_wins', { ascending: false }).order('nickname').limit(1),
        // two rank-1 rows means a tie (everyone starts a season level on 1,000)
        supabase.from('leaderboard_bettors').select('*').eq('rank', 1).order('display_name').limit(2),
        supabase.from('fights').select('id', { count: 'exact', head: true }).eq('status', 'settled').gte('settled_at', current.started_at),
      ])
      if (bouts.error) throw bouts.error
      const champ = must(c) as CurrentChampion | null
      const top = must(pick) as NonNullable<Now['picker']>[]
      const bouts_ = bouts.count ?? 0
      now = {
        champion: champ && visible.has(champ.fighter_id) ? champ : null,
        leader: (must(lead) as Now['leader'][])[0] ?? null,
        // no settled bout yet, or a shared first place: naming one member would not be true
        picker: bouts_ > 0 && top.length === 1 ? top[0] : null,
        pickerTied: bouts_ > 0 && top.length > 1 ? top.length : 0,
        bouts: bouts_,
      }
    }
    return { current, past: rows.filter(x => x.ended_at != null), now, visible }
  }, [])

  return (
    <div className="pg-seasons">
      <div className="pagehead" style={{ marginBottom: 0 }}>
        <Link className="back" to="/app/leaderboard"><CaretLeft />Ranks</Link>
      </div>
      <h1 className="t-title">Seasons</h1>
      <p className="lede t-help">A season runs for a term. When it ends, the final standings are kept here, and points and Elo go back to 1,000.</p>

      {st.loading && !st.data ? <Loading label="Loading the seasons…" shape="rows" />
        : st.error ? <Alert title="Couldn't load the seasons." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again.</Alert>
        : <Body {...st.data!} />}
    </div>
  )
}

function Body({ current, past, now, visible }: { current: Season | null; past: Season[]; now: Now | null; visible: Set<string> }) {
  return (
    <>
      {current && now && (
        <section className="now" aria-labelledby="now-h">
          <div className="now-top">
            <h2 id="now-h" className="t-head"><bdi>{current.name}</bdi></h2>
            <Stamp tone="live" size="sm" rot={-3}>On now</Stamp>
          </div>
          <p className="data since">
            <span className="nowrap">Since {fmtSeasonDay(current.started_at)}</span>{' · '}
            <span className="nowrap">{fmtSpan(current.started_at)} in</span>
          </p>
          <div className="leaders" role="list">
            <Lead label="Champion">
              {now.champion
                ? <Link className="lead-link" to={`/app/fighters/${now.champion.fighter_id}`}><ChampionBelt size={20} label="Belt holder" className="mr-1" /><bdi>{now.champion.nickname}</bdi></Link>
                : <span className="data">Belt is vacant</span>}
            </Lead>
            <Lead label="Top Elo">
              {now.leader
                ? <><bdi>{now.leader.nickname}</bdi> <span className="data nowrap">{fmtNum(now.leader.elo)}</span></>
                : <span className="data">No fights yet</span>}
            </Lead>
            <Lead label="Top picker">
              {now.picker
                ? <><bdi>{pickerName(now.picker)}</bdi> <span className="data nowrap">{fmtNum(Number(now.picker.balance))} pts</span></>
                : now.pickerTied > 0 ? <span className="data">Tied for first</span>
                : <span className="data">Nobody yet</span>}
            </Lead>
            <Lead label="Bouts settled"><span className="data"><b>{fmtNum(now.bouts)}</b></span></Lead>
          </div>
          <ButtonLink to="/app/leaderboard" variant="bone" size="sm">See this season's ranks</ButtonLink>
        </section>
      )}

      <section className="past" aria-labelledby="past-h">
        <div className="section-head">
          <h2 id="past-h" className="t-head">Past seasons{past.length > 0 && <span className="count">{past.length}</span>}</h2>
        </div>
        {past.length ? (
          <ul className="ssn-list" role="list">
            {past.map(s => <li key={s.id}><SeasonSheet season={s} visibleFighters={visible} /></li>)}
          </ul>
        ) : (
          <EmptyState title="No finished seasons yet"
            body={current ? `${current.name} is the first one. When an admin ends it, the champion, the top picker and the final top 5 land here.` : 'When an admin ends a season, the champion, the top picker and the final top 5 land here.'} />
        )}
      </section>
    </>
  )
}
