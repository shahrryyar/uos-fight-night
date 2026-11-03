import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { cardDateOf, fmtKg, isChampion, must, record, todayCard, useAsync, type FightRow } from '../lib/hooks'
import type { Fighter, FighterRanking } from '../lib/types'
import { ChampBelt } from '../components/belt'
import { Alert, EmptyState, HalftonePhoto, Loading, Paper, Stamp } from '../components/ui'

interface Tile { f: Fighter; r?: FighterRanking; tonight: boolean }

/** Fighters grid (DESIGN 11.9): two columns of flat paper tiles, the whole tile is the link. */
export default function Fighters() {
  const st = useAsync<Tile[]>(async () => {
    const [f, r, main] = await Promise.all([
      supabase.from('fighters').select('*').eq('hidden', false),
      supabase.from('fighter_rankings').select('*'),
      supabase.from('fights').select('red_fighter_id,blue_fighter_id,card_date,scheduled_at,status,is_main_event')
        .eq('is_main_event', true).in('status', ['scheduled', 'open', 'locked']),
    ])
    const ranks = new Map((must(r) as FighterRanking[]).map(x => [x.fighter_id, x]))
    const today = todayCard()
    const tonight = new Set((must(main) as FightRow[]).filter(x => cardDateOf(x) === today)
      .flatMap(x => [x.red_fighter_id, x.blue_fighter_id]))
    const list = (must(f) as Fighter[]).map(x => ({ f: x, r: ranks.get(x.id), tonight: tonight.has(x.id) }))
    return list.sort((a, b) =>
      (a.r?.rank ?? 1e9) - (b.r?.rank ?? 1e9) || b.f.elo - a.f.elo || a.f.nickname.localeCompare(b.f.nickname))
  }, [])

  return (
    <div>
      <h1 className="t-title">Fighters</h1>
      <p className="t-help c-2" style={{ marginTop: 6 }}>The roster. Tap a fighter for their full file.</p>
      {st.loading && !st.data ? <Loading label="Loading the roster…" shape="none" />
        : st.error ? <Alert title="Couldn't load the roster." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again.</Alert>
        : !st.data?.length ? <EmptyState title="No fighters yet" body="Admins add fighters to the roster. They show up here with their record." />
        : (
          <ul className="grid grid-cols-2 gap-3" style={{ marginTop: 18, listStyle: 'none', padding: 0 }} role="list">
            {st.data.map(({ f, r, tonight }, i) => <FighterTile key={f.id} f={f} r={r} tonight={tonight} priority={i < 4} />)}
          </ul>
        )}
    </div>
  )
}

function FighterTile({ f, r, tonight, priority }: Tile & { priority: boolean }) {
  const kg = fmtKg(f.weight_kg)
  const fights = r?.fights ?? f.wins + f.losses
  const champ = isChampion(r)  // fighter_rankings.is_champion (B5)
  return (
    <li>
      <Paper className="h-full" style={{ padding: '10px 10px 28px' }}>
        <Link to={`/app/fighters/${f.id}`} className="block" style={{ color: 'inherit', textDecoration: 'none', minHeight: 44 }}>
          <div className="relative">
            <HalftonePhoto path={f.photo_path} name={f.nickname} size={180} priority={priority} />
            {tonight && <Stamp size="sm" fill rot={-5} style={{ position: 'absolute', left: 6, bottom: 6 }}>Tonight</Stamp>}
          </div>
          <p className="t-sub" style={{ marginTop: 10 }}>
            {champ && <ChampBelt size={22} />}<bdi>{f.nickname}</bdi>
          </p>
          <p className="data c-2" style={{ marginTop: 4 }}>
            <span className="nowrap">{record(f)}</span>{kg && <> · <span className="nowrap">{kg.replace(' ', ' ')}</span></>}
          </p>
          {!r?.ranked && <p className="data c-2" style={{ marginTop: 2 }}><b>{Math.min(fights, 3)} of 3</b> fights</p>}
        </Link>
      </Paper>
    </li>
  )
}
