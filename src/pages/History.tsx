import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { METHOD_LABEL, fmtDate, must, useAsync, useFightersMap } from '../lib/hooks'
import type { Fight } from '../lib/types'
import { Empty, ErrorBox, Loading, PageTitle } from '../components/member/ui'

export default function History() {
  const st = useAsync(async () =>
    must(await supabase.from('fights').select('*').in('status', ['settled', 'cancelled'])
      .order('scheduled_at', { ascending: false }).limit(200)) as Fight[], [])
  const fighters = useFightersMap((st.data ?? []).flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))

  return (
    <div>
      <PageTitle sub="Every fight in the books, newest first.">History</PageTitle>
      {st.loading ? <Loading /> : st.error ? <ErrorBox error={st.error} onRetry={() => void st.reload()} />
        : !st.data?.length ? <Empty>No fights in the books yet.</Empty>
        : (
          <ul className="space-y-3">
            {st.data.map(f => {
              const red = fighters.data?.get(f.red_fighter_id), blue = fighters.data?.get(f.blue_fighter_id)
              const cancelled = f.status === 'cancelled'
              const name = (fid: string, n?: string) => <Link to={`/app/fighters/${fid}`} className="hover:underline">{n ?? '…'}</Link>
              return (
                <li key={f.id} className="rounded-2xl border border-line bg-surface p-3">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-muted">
                    <span className="truncate">{f.title ?? 'Fight'} · {fmtDate(f.settled_at ?? f.scheduled_at, false)}</span>
                    {cancelled && <span className="rounded-full border border-line px-2 py-0.5">Cancelled</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <p className={`font-display text-2xl leading-none truncate ${f.winner_side === 'red' ? 'text-bone' : 'text-muted'}`}>
                      <span className="mr-1 inline-block size-2 rounded-full bg-red align-middle" aria-hidden />
                      {name(f.red_fighter_id, red?.nickname)}{f.winner_side === 'red' && ' 👑'}
                    </p>
                    <span className="font-display text-lg text-gold">VS</span>
                    <p className={`font-display text-2xl leading-none truncate text-right ${f.winner_side === 'blue' ? 'text-bone' : 'text-muted'}`}>
                      {f.winner_side === 'blue' && '👑 '}{name(f.blue_fighter_id, blue?.nickname)}
                      <span className="ml-1 inline-block size-2 rounded-full bg-blue align-middle" aria-hidden />
                    </p>
                  </div>
                  {!cancelled && (
                    <p className="mt-2 text-xs text-muted">
                      Won by <span className="font-semibold text-bone">{f.method ? METHOD_LABEL[f.method] : '—'}</span>
                      {f.elo_delta != null && <> · Elo <span className="text-gold font-semibold">±{Math.abs(f.elo_delta)}</span></>}
                      {f.result_note && <> · “{f.result_note}”</>}
                    </p>
                  )}
                  {cancelled && <p className="mt-2 text-xs text-muted">No result — all points refunded.{f.result_note ? ` ${f.result_note}` : ''}</p>}
                </li>
              )
            })}
          </ul>
        )}
    </div>
  )
}
