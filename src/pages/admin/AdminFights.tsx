import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { boutSort } from '../../lib/hooks'
import type { FightPool, Fighter } from '../../lib/types'
import type { AdminFight } from '../../components/admin/fightTypes'
import CreateFight from '../../components/admin/fights/CreateFight'
import FightAdminCard from '../../components/admin/fights/FightAdminCard'
import CardManager from '../../components/admin/fights/CardManager'
import RecentResults from '../../components/admin/fights/RecentResults'
import { Btn, Empty, ErrorBox, SectionTitle, fmtCardDate, must, useAction } from '../../components/admin/ui'

const ACTIVE = ['scheduled', 'open', 'locked']

export default function AdminFights() {
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [fights, setFights] = useState<AdminFight[]>([])
  const [cardFights, setCardFights] = useState<AdminFight[]>([])
  const [recent, setRecent] = useState<AdminFight[]>([])
  const [pools, setPools] = useState<Record<string, FightPool>>({})
  const [hasAccount, setHasAccount] = useState<Set<string>>(new Set())
  const load = useAction()
  const loadRun = load.run

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

    // Whole cards (any non-cancelled status) for dates that still have live bouts — for ordering / main event.
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
    <div className="space-y-6">
      <CreateFight fighters={fighters} cardFights={cardFights} onCreated={refresh} />
      <div>
        <SectionTitle right={<Btn onClick={() => void refresh()} busy={load.busy} className="text-sm">Refresh</Btn>}>
          Live card
        </SectionTitle>
        <ErrorBox error={load.error} />
        {!load.busy && fights.length === 0 && <Empty>No scheduled, open or locked fights. Book one above.</Empty>}
        <div className="space-y-6">
          {groups.map(([d, list]) => (
            <section key={d} className="space-y-3">
              <h3 className="font-display text-xl tracking-[0.2em] text-muted uppercase">{fmtCardDate(d)}</h3>
              {list.map(f => (
                <FightAdminCard key={f.id} fight={f} red={byId[f.red_fighter_id]} blue={byId[f.blue_fighter_id]}
                  pool={pools[f.id]} hasAccount={hasAccount} onChanged={refresh} />
              ))}
            </section>
          ))}
        </div>
      </div>
      <CardManager cardFights={cardFights} byId={byId} onChanged={refresh} />
      <RecentResults fights={recent} byId={byId} onChanged={refresh} />
    </div>
  )
}
