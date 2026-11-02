import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { must, record, useAsync } from '../lib/hooks'
import { formatStreak } from '../lib/math'
import type { Fighter, FighterRanking } from '../lib/types'
import FighterPhoto from '../components/FighterPhoto'
import { Empty, ErrorBox, Loading, PageTitle, StreakPill } from '../components/member/ui'

export default function Fighters() {
  const st = useAsync(async () => {
    const [f, r] = await Promise.all([
      supabase.from('fighters').select('*').eq('hidden', false),
      supabase.from('fighter_rankings').select('*'),
    ])
    const ranks = new Map((must(r) as FighterRanking[]).map(x => [x.fighter_id, x]))
    const list = (must(f) as Fighter[]).map(x => ({ f: x, r: ranks.get(x.id) }))
    return list.sort((a, b) =>
      (a.r?.rank ?? 1e9) - (b.r?.rank ?? 1e9) || b.f.elo - a.f.elo || a.f.nickname.localeCompare(b.f.nickname))
  }, [])

  return (
    <div>
      <PageTitle sub="The roster. Tap a fighter for their full file.">Fighters</PageTitle>
      {st.loading ? <Loading /> : st.error ? <ErrorBox error={st.error} onRetry={() => void st.reload()} />
        : !st.data?.length ? <Empty>No fighters on the roster yet.</Empty>
        : (
          <ul className="grid grid-cols-2 gap-3">
            {st.data.map(({ f, r }) => (
              <li key={f.id}>
                <Link to={`/app/fighters/${f.id}`}
                  className="relative flex h-full flex-col items-center rounded-2xl border border-line bg-surface p-3 text-center active:scale-[0.98] transition">
                  <span className={`absolute left-2 top-2 font-display text-xl leading-none ${r?.rank ? 'text-gold' : 'text-muted text-sm'}`}>
                    {r?.rank ? `#${r.rank}` : 'NR'}
                  </span>
                  <FighterPhoto path={f.photo_path} nickname={f.nickname} className="size-24 text-2xl" />
                  <p className="mt-2 font-display text-2xl leading-none tracking-wide break-words max-w-full">{f.nickname}</p>
                  <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
                    <span className="font-semibold text-bone tabular-nums">{record(f)}</span>
                    <span className="tabular-nums">{f.elo} Elo</span>
                    <StreakPill streak={f.streak} label={formatStreak(f.streak)} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
