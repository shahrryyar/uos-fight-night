import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { AdminLogRow } from '../../lib/types'
import { Button, EmptyState, Loading } from '../../components/ui'
import { LoadError, SectionHead, fmtAgo, fmtDate, must, useAction } from '../../components/admin/ui'
import { logSentence, type FightRef, type Lookups } from '../../components/admin/logSentence'

const PAGE = 50

export default function AdminLog() {
  const [rows, setRows] = useState<AdminLogRow[]>([])
  const [L, setL] = useState<Lookups>({ people: {}, fighters: {}, fights: {} })
  const [loaded, setLoaded] = useState(false)
  const [more, setMore] = useState(true)
  const known = useRef(new Set<string>())
  const act = useAction()
  const actRun = act.run

  const fetchPage = useCallback((from: number) => actRun(async () => {
    const page = must(await supabase.from('admin_log').select('*')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + PAGE - 1)) as AdminLogRow[]
    // Look up the bouts this page mentions so sentences can name them (fight_* rows target a fight id).
    const ids = [...new Set(page.filter(r => r.action.startsWith('fight_') || r.action === 'card_main_event').map(r => r.target_id)
      .filter((x): x is string => !!x && !known.current.has(x)))]
    if (ids.length) {
      const fr = must(await supabase.from('fights').select('id, red_fighter_id, blue_fighter_id, card_date').in('id', ids)) as FightRef[]
      ids.forEach(i => known.current.add(i))
      setL(l => ({ ...l, fights: { ...l.fights, ...Object.fromEntries(fr.map(x => [x.id, x])) } }))
    }
    setRows(r => (from === 0 ? page : [...r, ...page]))
    setMore(page.length === PAGE)
    setLoaded(true)
  }), [actRun])

  useEffect(() => {
    void fetchPage(0)
    void Promise.all([
      supabase.from('profiles').select('id, username, display_name'),
      supabase.from('fighters').select('id, nickname'),
    ]).then(([p, f]) => setL(l => ({
      ...l,
      people: p.data ? Object.fromEntries((p.data as { id: string; username: string; display_name: string | null }[]).map(x => [x.id, x.display_name?.trim() || x.username])) : l.people,
      fighters: f.data ? Object.fromEntries((f.data as { id: string; nickname: string }[]).map(x => [x.id, x.nickname])) : l.fighters,
    })))
  }, [fetchPage])

  const now = Date.now()

  return (
    <section className="adm-section" aria-labelledby="log-h">
      <SectionHead id="log-h" title="Admin log" sub="Everything admins and the system changed, newest first."
        right={loaded && <Button variant="ghost" size="sm" onClick={() => void fetchPage(0)} busy={act.busy && rows.length <= PAGE} busyLabel="Refreshing">Refresh</Button>} />
      <LoadError error={act.error} what="the log" onRetry={() => void fetchPage(rows.length ? rows.length : 0)} busy={act.busy} />
      {!loaded && !act.error && <Loading label="Loading the log…" shape="rows" />}
      {loaded && rows.length === 0 && <EmptyState title="Nothing logged yet" body="Bookings, results, account and points changes show up here." />}
      <ol className="rows" role="list" style={{ marginTop: 8 }}>
        {rows.map(r => {
          const { say, why } = logSentence(r, L)
          return (
            <li key={r.id} className="log-row">
              <p className="say">{say}</p>
              <time className="data" dateTime={r.created_at} title={fmtDate(r.created_at)}>{fmtAgo(r.created_at, now)}</time>
              {why && <p className="why">“{why}”</p>}
            </li>
          )
        })}
      </ol>
      {more && rows.length > 0 && (
        <Button variant="bone" className="more" onClick={() => void fetchPage(rows.length)} busy={act.busy} busyLabel="Loading">Show older</Button>
      )}
    </section>
  )
}
