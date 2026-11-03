import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { boutSort } from '../../lib/hooks'
import type { FightPool, Fighter } from '../../lib/types'
import type { AdminFight } from '../../components/admin/fightTypes'
import CreateFight from '../../components/admin/fights/CreateFight'
import FightAdminCard from '../../components/admin/fights/FightAdminCard'
import CardManager from '../../components/admin/fights/CardManager'
import RecentResults from '../../components/admin/fights/RecentResults'
import CalloutQueue from '../../components/admin/fights/CalloutQueue'
import { Button, EmptyState, Loading } from '../../components/ui'
import { LoadError, SectionHead } from '../../components/admin/ui'
import { fmtCardDate, must, useAction } from '../../components/admin/adminUtils'
import type { SettlePrefillState } from './Referee'

const ACTIVE = ['scheduled', 'open', 'locked']

/** Fights section. The decision leads (DESIGN principle 4): the live bout sheets come first,
 *  then booking, card order and recent results. All queries and RPCs unchanged. */
export default function AdminFights() {
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [fights, setFights] = useState<AdminFight[]>([])
  const [cardFights, setCardFights] = useState<AdminFight[]>([])
  const [recent, setRecent] = useState<AdminFight[]>([])
  const [pools, setPools] = useState<Record<string, FightPool>>({})
  const [hasAccount, setHasAccount] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const load = useAction()
  const loadRun = load.run
  // "Finish bout" on the referee scoreboard lands here with round + score for that bout's result form.
  // Used once: taken out of the history entry at once (so a reload or Back -> Forward doesn't reopen the
  // form with old numbers) and dropped after the first load, once the matching card has mounted with
  // it (so a later remount, e.g. after Correct result, starts from a clean card).
  const location = useLocation()
  const navigate = useNavigate()
  const [prefill, setPrefill] = useState(() => (location.state as SettlePrefillState | null)?.settlePrefill)
  useEffect(() => {
    if ((location.state as SettlePrefillState | null)?.settlePrefill) {
      navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null })
    }
  }, [location, navigate])
  const [consumed, setConsumed] = useState(false)
  if (loaded && !consumed) {
    setConsumed(true)
    if (prefill) setPrefill(undefined)
  }

  const refresh = useCallback(() => loadRun(async () => {
    const [fr, active, done, pr] = await Promise.all([
      supabase.from('fighters').select('*').order('nickname'),
      supabase.from('fights').select('*').in('status', ACTIVE).order('card_date').order('bout_order').order('scheduled_at'),
      supabase.from('fights').select('*').in('status', ['settled', 'cancelled'])
        .order('settled_at', { ascending: false, nullsFirst: false }).order('scheduled_at', { ascending: false }).limit(12),
      supabase.from('profiles').select('fighter_id, active').not('fighter_id', 'is', null),
    ])
    setFighters(must(fr) as Fighter[])
    const act = must(active) as AdminFight[]
    setFights(act)
    setRecent(must(done) as AdminFight[])
    setHasAccount(new Set((must(pr) as { fighter_id: string; active: boolean }[]).filter(p => p.active).map(p => p.fighter_id)))

    // Whole cards (any non-cancelled status) for dates that still have live bouts: for ordering / main event.
    const dates = [...new Set(act.map(f => f.card_date))]
    const [cards, pl] = await Promise.all([
      dates.length
        ? supabase.from('fights').select('*').in('card_date', dates).neq('status', 'cancelled')
        : Promise.resolve({ data: [] as AdminFight[], error: null }),
      act.length
        ? supabase.from('fight_pools').select('*').in('fight_id', act.map(f => f.id))
        : Promise.resolve({ data: [] as FightPool[], error: null }),
    ])
    setCardFights(must(cards) as AdminFight[])
    setPools(Object.fromEntries((must(pl) as FightPool[]).map(x => [x.fight_id, x])))
    setLoaded(true)
  }), [loadRun])

  useEffect(() => { void refresh() }, [refresh])

  const byId = useMemo(() => Object.fromEntries(fighters.map(f => [f.id, f])), [fighters])

  // Live card grouped by card_date; within a card in the same order members see (boutSort: main event last).
  const groups = useMemo(() => {
    const m = new Map<string, AdminFight[]>()
    for (const f of fights) m.set(f.card_date, [...(m.get(f.card_date) ?? []), f])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([d, list]) => [d, list.sort(boutSort)] as const)
  }, [fights])

  return (
    <>
      <section className="adm-section" aria-labelledby="live-h">
        <SectionHead id="live-h" title="Live card"
          right={loaded && <Button variant="ghost" size="sm" onClick={() => void refresh()} busy={load.busy} busyLabel="Refreshing">Refresh</Button>} />
        <LoadError error={load.error} what="the live card" onRetry={() => void refresh()} busy={load.busy} />
        {!loaded && !load.error && <Loading label="Loading the live card…" />}
        {loaded && fights.length === 0 && (
          <EmptyState title="No live bouts" body="Nothing is booked, open or locked. Book the next bout below." />
        )}
        {groups.map(([d, list]) => (
          <div key={d} className="card-date">
            <p className="label c-2"><span className="nowrap">{fmtCardDate(d)}</span> · <span className="nowrap">{list.length} live bout{list.length === 1 ? '' : 's'}</span></p>
            {list.map(f => (
              <FightAdminCard key={f.id} fight={f} red={byId[f.red_fighter_id]} blue={byId[f.blue_fighter_id]}
                pool={pools[f.id]} hasAccount={hasAccount} onChanged={refresh}
                prefill={prefill?.fightId === f.id ? prefill : undefined} />
            ))}
          </div>
        ))}
      </section>
      {loaded && <CalloutQueue byId={byId} hasAccount={hasAccount} cardFights={cardFights} onBooked={refresh} />}
      {loaded && (
        <section className="adm-section" aria-label="Book a bout">
          <CreateFight fighters={fighters} cardFights={cardFights} onCreated={refresh} />
        </section>
      )}
      <CardManager cardFights={cardFights} byId={byId} onChanged={refresh} />
      <RecentResults fights={recent} byId={byId} onChanged={refresh} />
    </>
  )
}
