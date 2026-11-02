import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtKg, isChampion, must, useAsync, useDisplayNames, type FighterStats } from '../lib/hooks'
import { fmtDelta, fmtNum } from '../lib/copy'
import type { BettorRank, Fighter } from '../lib/types'
import { ChampionBelt } from '../components/brand'
import { Alert, EmptyState, HalftonePhoto, Loading, Paper, Stamp, TabPanel, Tabs } from '../components/ui'

type Tab = 'fighters' | 'pickers'

export default function Leaderboard() {
  const [tab, setTab] = useState<Tab>(() => (typeof location !== 'undefined' && location.hash === '#pickers' ? 'pickers' : 'fighters'))
  return (
    <div className="pg-ranks">
      <h1 className="t-title">Ranks</h1>
      <Tabs label="Rankings" value={tab} onChange={setTab}
        tabs={[{ id: 'fighters', label: 'Fighters' }, { id: 'pickers', label: 'Pickers' }]} />
      <TabPanel id="fighters" value={tab}><FighterBoard /></TabPanel>
      <TabPanel id="pickers" value={tab}><PickerBoard /></TabPanel>
    </div>
  )
}

const kgText = (v: number | string | null | undefined) => fmtKg(v).replace(' ', ' ')
const recordOf = (r: Pick<FighterStats, 'wins' | 'losses'>) => `${r.wins}–${r.losses}`

function Streak({ n, onPaper }: { n: number; onPaper?: boolean }) {
  if (!n) return null
  const label = n > 0 ? `W${n}` : `L${-n}`
  const style = onPaper && n > 0 ? { background: 'var(--color-toner)', color: 'var(--color-bone)' } : undefined
  return <span className={n > 0 ? 'streak streak--w' : 'streak'} style={style}><span className="sr-only">Streak </span>{label}</span>
}

interface Board { rows: FighterStats[]; fighters: Map<string, Fighter>; lastDelta: Map<string, number> }

function FighterBoard() {
  const { profile } = useAuth()
  const st = useAsync<Board>(async () => {
    const [r, f, last] = await Promise.all([
      supabase.from('fighter_rankings').select('*'),
      supabase.from('fighters').select('*'),
      supabase.from('fight_results').select('fighter_id,elo_delta,settled_at').order('settled_at', { ascending: false }).limit(1000),
    ])
    const lastDelta = new Map<string, number>()
    for (const x of must(last) as { fighter_id: string; elo_delta: number | null }[]) {
      if (!lastDelta.has(x.fighter_id) && x.elo_delta != null) lastDelta.set(x.fighter_id, x.elo_delta)
    }
    return { rows: must(r) as FighterStats[], fighters: new Map((must(f) as Fighter[]).map(x => [x.id, x])), lastDelta }
  }, [])

  if (st.loading && !st.data) return <Loading label="Loading the ranks…" shape="rows" />
  if (st.error) return <Alert title="Couldn't load the ranks." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again.</Alert>
  const { rows, fighters, lastDelta } = st.data!
  const visible = rows.filter(r => !fighters.get(r.fighter_id)?.hidden)
  const ranked = visible.filter(r => r.ranked).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const unranked = visible.filter(r => !r.ranked).sort((a, b) => b.fights - a.fights || b.elo - a.elo || a.nickname.localeCompare(b.nickname))
  const mine = profile?.fighter_id ?? null
  const [top, ...rest] = ranked

  return (
    <>
      <p className="intro t-help">Ranked by Elo. Everyone starts at 1,000. You need 3 fights to get a rank.</p>
      {!visible.length && <EmptyState title="No fighters yet" body="Admins add fighters to the roster. They show up here once they do." />}

      {top && <TopOne r={top} f={fighters.get(top.fighter_id)} me={top.fighter_id === mine} />}

      {rest.length > 0 && (
        <>
          <p className="colhead" aria-hidden="true"><span className="label">Fighter</span><span className="label">Elo · last bout</span></p>
          <ol className="rows lb" role="list">
            {rest.map(r => {
              const me = r.fighter_id === mine
              const f = fighters.get(r.fighter_id)
              const kg = kgText(r.weight_kg ?? f?.weight_kg)
              const delta = lastDelta.get(r.fighter_id)
              return (
                <li key={r.fighter_id}>
                  <Link className={me ? 'row row-link row--me' : 'row row-link'} to={`/app/fighters/${r.fighter_id}`} aria-current={me ? 'true' : undefined}>
                    <span className="rank"><span className="sr-only">Rank </span>{r.rank}</span>
                    <span>
                      <span className="t-sub">
                        {isChampion(f) && <ChampionBelt size={20} label="Champion" className="mr-1" />}<bdi>{r.nickname}</bdi>
                        {me && <Stamp tone="ink" size="sm" rot={-4} className="you">You</Stamp>}
                      </span>
                      <span className="meta data">
                        <span className="nowrap">{recordOf(r)}{kg && <> · {kg}</>}</span>
                        <Streak n={r.streak} onPaper={me} />
                      </span>
                    </span>
                    <span className="elo">
                      <span className="data-lg"><span className="sr-only">Elo </span>{fmtNum(r.elo)}</span>
                      {delta != null && <span className="data"><span className="sr-only">Last bout </span>{fmtDelta(delta)}</span>}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </>
      )}

      {unranked.length > 0 && (
        <section className="section" aria-labelledby="nr">
          <h2 id="nr" className="t-head">Not ranked yet</h2>
          <ul className="rows lb" role="list" style={{ marginTop: 6 }}>
            {unranked.map(r => {
              const me = r.fighter_id === mine
              const kg = kgText(r.weight_kg ?? fighters.get(r.fighter_id)?.weight_kg)
              return (
                <li key={r.fighter_id}>
                  <Link className={me ? 'row row-link row--me' : 'row row-link'} style={{ gridTemplateColumns: '1fr auto' }}
                    to={`/app/fighters/${r.fighter_id}`} aria-current={me ? 'true' : undefined}>
                    <span>
                      <span className="t-sub"><bdi>{r.nickname}</bdi>{me && <Stamp tone="ink" size="sm" rot={-4} className="you">You</Stamp>}</span>
                      <span className="meta data"><span className="nowrap">{recordOf(r)}{kg && <> · {kg}</>}</span></span>
                    </span>
                    <span className="data nowrap" style={{ color: me ? 'var(--color-toner)' : 'var(--color-bone)' }}><b>{Math.min(r.fights, 3)} of 3</b> fights</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}

/** #1 on flat paper with a photo, no tape (DESIGN 11.12). */
function TopOne({ r, f, me }: { r: FighterStats; f?: Fighter; me: boolean }) {
  const kg = kgText(r.weight_kg ?? f?.weight_kg)
  return (
    <Paper className="top1" aria-label={`Rank 1: ${r.nickname}`}>
      <HalftonePhoto path={f?.photo_path} name={r.nickname} size={96} priority />
      <div>
        <p className="n" aria-hidden="true">1</p>
        <Link className="t-sub" to={`/app/fighters/${r.fighter_id}`} style={{ display: 'block', marginTop: 6, textDecoration: 'none', color: 'inherit' }}>
          {isChampion(f) && <ChampionBelt size={22} label="Champion" className="mr-1" />}<bdi>{r.nickname}</bdi>
          {me && <Stamp tone="ink" size="sm" rot={-4} style={{ marginLeft: 6, verticalAlign: 2 }}>You</Stamp>}
        </Link>
        <p className="data-lg">{fmtNum(r.elo)} <span className="label">Elo</span></p>
        <p className="data c-2" style={{ marginTop: 4 }}>
          <span className="nowrap" style={{ marginRight: 8 }}>{recordOf(r)}{kg && <> · {kg}</>}</span><Streak n={r.streak} onPaper />
        </p>
      </div>
    </Paper>
  )
}

type PickerRow = BettorRank & { display_name?: string | null }

function PickerBoard() {
  const { profile } = useAuth()
  const st = useAsync(async () => {
    const top = must(await supabase.from('leaderboard_bettors').select('*').order('rank', { ascending: true }).limit(100)) as PickerRow[]
    let mine: PickerRow | null = null
    if (profile?.id && !top.some(r => r.user_id === profile.id)) {
      mine = (must(await supabase.from('leaderboard_bettors').select('*').eq('user_id', profile.id).maybeSingle()) as PickerRow | null)
    }
    return { top, mine }
  }, [profile?.id])
  const all = [...(st.data?.top ?? []), ...(st.data?.mine ? [st.data.mine] : [])]
  const names = useDisplayNames(all.filter(r => !r.display_name).map(r => r.user_id))

  if (st.loading && !st.data) return <Loading label="Loading the pickers…" shape="rows" />
  if (st.error) return <Alert title="Couldn't load the pickers." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again.</Alert>
  const { top, mine } = st.data!

  const row = (r: PickerRow) => {
    const me = r.user_id === profile?.id
    const name = r.display_name || names.get(r.user_id) || 'Member'
    return (
      <li key={r.user_id} className={me ? 'row row--me' : 'row'} aria-current={me ? 'true' : undefined}>
        <span className="rank"><span className="sr-only">Rank </span>{r.rank}</span>
        <span className="t-sub"><bdi>{name}</bdi>{me && <Stamp tone="ink" size="sm" rot={-4} className="you">You</Stamp>}</span>
        <span className="data-lg">{fmtNum(Number(r.balance))}<span className="sr-only"> points</span></span>
      </li>
    )
  }

  return (
    <>
      <p className="intro t-help">Ranked by points. Everyone starts with 1,000 and gets 100 more every Monday.</p>
      {!top.length ? <EmptyState title="Nobody here yet" body="Members show up here after their first login." /> : (
        <>
          <p className="colhead" aria-hidden="true"><span className="label">Member</span><span className="label">Points</span></p>
          <ol className="rows lb" role="list">{top.map(row)}</ol>
          {mine && (
            <>
              <p className="colhead" style={{ marginTop: 14 }}><span className="label">Your spot</span></p>
              <ol className="rows lb" role="list">{row(mine)}</ol>
            </>
          )}
        </>
      )}
    </>
  )
}
