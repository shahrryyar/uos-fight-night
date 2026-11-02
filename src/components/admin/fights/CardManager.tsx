import { supabase } from '../../../lib/supabase'
import { boutSort } from '../../../lib/hooks'
import type { Fighter } from '../../../lib/types'
import type { AdminFight } from '../fightTypes'
import { ErrorBox, Pill, SectionTitle, fmtCardDate, must, useAction, useConfirm } from '../ui'

interface Props { cardFights: AdminFight[]; byId: Record<string, Fighter>; onChanged: () => void }

/** Per-card_date bout order + main event. Cancelled bouts are left out of the order.
 *  Same order as members see (boutSort): main event always closes the card. */
export default function CardManager({ cardFights, byId, onChanged }: Props) {
  const dates = [...new Set(cardFights.map(f => f.card_date))].sort()
  if (dates.length === 0) return null
  return (
    <div>
      <SectionTitle>Card order</SectionTitle>
      <div className="space-y-4">
        {dates.map(d => (
          <OneCard key={d} date={d} byId={byId} onChanged={onChanged}
            fights={cardFights.filter(f => f.card_date === d).sort(boutSort)} />
        ))}
      </div>
    </div>
  )
}

function OneCard({ date, fights, byId, onChanged }: { date: string; fights: AdminFight[]; byId: Record<string, Fighter>; onChanged: () => void }) {
  const act = useAction()
  const [dialog, confirm] = useConfirm()
  const name = (id: string) => byId[id]?.nickname ?? '?'

  // The main event is pinned to the last slot (members always see it last), so it can't move
  // and nothing can swap places with it.
  const canMove = (i: number, dir: -1 | 1) => {
    const j = i + dir
    return j >= 0 && j < fights.length && !fights[i].is_main_event && !fights[j].is_main_event
  }

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (!canMove(i, dir)) return
    const ids = fights.map(f => f.id)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    const r = await act.run(async () => { must(await supabase.rpc('admin_reorder_card', { p_card_date: date, p_fight_ids: ids })); return true })
    if (r) onChanged()
  }

  const makeMain = async (f: AdminFight) => {
    const cur = fights.find(x => x.is_main_event)
    if (!(await confirm({
      title: 'Set main event?', variant: 'gold', confirmLabel: 'Make main event',
      body: <p><b>{name(f.red_fighter_id)} vs {name(f.blue_fighter_id)}</b> headlines {fmtCardDate(date)}.{cur && <> {name(cur.red_fighter_id)} vs {name(cur.blue_fighter_id)} moves to the undercard.</>}</p>,
    }))) return
    const r = await act.run(async () => { must(await supabase.rpc('admin_set_main_event', { p_fight_id: f.id })); return true })
    if (r) onChanged()
  }

  const arrow = 'min-h-11 min-w-11 rounded-lg border border-line bg-surface-2 text-lg text-bone disabled:opacity-30'

  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      {dialog}
      <h3 className="font-display text-2xl tracking-wider mb-2">{fmtCardDate(date)} <span className="text-muted text-base">· {fights.length} bout{fights.length === 1 ? '' : 's'}</span></h3>
      <ErrorBox error={act.error} />
      <ol className="space-y-2 mt-2">
        {fights.map((f, i) => (
          <li key={f.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${f.is_main_event ? 'border-gold/60 bg-gold/5' : 'border-line'}`}>
            <span className="w-6 text-center font-display text-xl text-muted tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                <span className="text-red">{name(f.red_fighter_id)}</span><span className="text-muted"> vs </span><span className="text-blue">{name(f.blue_fighter_id)}</span>
              </span>
              <span className="flex gap-1 mt-0.5">
                {f.is_main_event && <Pill tone="gold">Main event</Pill>}
                <Pill>{f.status}</Pill>
              </span>
            </span>
            {!f.is_main_event && (
              <button type="button" className={`${arrow} text-gold`} onClick={() => void makeMain(f)} disabled={act.busy}
                aria-label={`Make ${name(f.red_fighter_id)} vs ${name(f.blue_fighter_id)} the main event`} title="Make main event">★</button>
            )}
            <button type="button" className={arrow} onClick={() => void move(i, -1)} disabled={!canMove(i, -1) || act.busy} aria-label="Move up">▲</button>
            <button type="button" className={arrow} onClick={() => void move(i, 1)} disabled={!canMove(i, 1) || act.busy} aria-label="Move down">▼</button>
          </li>
        ))}
      </ol>
      {fights.length > 1 && !fights.some(f => f.is_main_event) && <p className="mt-2 text-xs text-muted">No main event yet — tap ★ to pick one.</p>}
      {fights.length > 1 && fights.some(f => f.is_main_event) && <p className="mt-2 text-xs text-muted">The main event always closes the card.</p>}
    </section>
  )
}
