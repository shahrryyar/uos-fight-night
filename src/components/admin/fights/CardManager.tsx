/**
 * Card order on ink (DESIGN 3: lists print straight on the wall). One block per card date.
 * Same order members see (boutSort: main event always closes the card). RPCs unchanged.
 */
import { supabase } from '../../../lib/supabase'
import { boutSort } from '../../../lib/hooks'
import type { Fighter } from '../../../lib/types'
import { Button, CaretDown, CaretUp, StatusStamp, useToast } from '../../ui'
import type { AdminFight } from '../fightTypes'
import { LoadError, SectionHead, fmtCardDate, must, useAction } from '../ui'

interface Props { cardFights: AdminFight[]; byId: Record<string, Fighter>; onChanged: () => void }

export default function CardManager({ cardFights, byId, onChanged }: Props) {
  const dates = [...new Set(cardFights.map(f => f.card_date))].sort()
  if (dates.length === 0) return null
  return (
    <section className="adm-section" aria-labelledby="order-h">
      <SectionHead id="order-h" title="Card order" sub="The main event always closes the card." />
      {dates.map(d => (
        <OneCard key={d} date={d} byId={byId} onChanged={onChanged}
          fights={cardFights.filter(f => f.card_date === d).sort(boutSort)} />
      ))}
    </section>
  )
}

function OneCard({ date, fights, byId, onChanged }: { date: string; fights: AdminFight[]; byId: Record<string, Fighter>; onChanged: () => void }) {
  const act = useAction()
  const toast = useToast()
  const name = (id: string) => byId[id]?.nickname ?? 'Unknown fighter'
  const pair = (f: AdminFight) => `${name(f.red_fighter_id)} vs ${name(f.blue_fighter_id)}`

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
    if (r) { toast(`Moved ${pair(fights[i])} ${dir < 0 ? 'up' : 'down'}.`); onChanged() }
  }

  // Reversible (pick another bout any time), so no confirm step; the toast says what moved.
  const makeMain = async (f: AdminFight) => {
    const cur = fights.find(x => x.is_main_event)
    const r = await act.run(async () => { must(await supabase.rpc('admin_set_main_event', { p_fight_id: f.id })); return true })
    if (r) { toast(`${pair(f)} is the main event.${cur ? ` ${pair(cur)} moves to the undercard.` : ''}`); onChanged() }
  }

  return (
    <div className="card-date">
      <p className="label c-2"><span className="nowrap">{fmtCardDate(date)}</span> · <span className="nowrap">{fights.length} bout{fights.length === 1 ? '' : 's'}</span></p>
      <LoadError error={act.error} what="that change" />
      <ol className="rows" role="list" aria-label={`Bout order for ${fmtCardDate(date)}`}>
        {fights.map((f, i) => (
          <li key={f.id} className="order-row">
            <span className="rank" aria-label={`Bout ${i + 1}`}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <p className="vs-names"><bdi>{name(f.red_fighter_id)}</bdi> <span className="v">vs</span> <bdi>{name(f.blue_fighter_id)}</bdi></p>
              <div className="meta" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', marginTop: 4 }}>
                <StatusStamp status={f.status} cancelKind={f.cancel_kind} onInk size="sm" rot={-2} />
                {f.is_main_event
                  ? <span className="data c-2">Main event</span>
                  : <button type="button" className="link-btn" onClick={() => void makeMain(f)} disabled={act.busy}
                      aria-label={`Make ${pair(f)} the main event`}>Make main event</button>}
              </div>
            </div>
            <div className="moves">
              <Button variant="ghost" size="sm" iconOnly icon={CaretUp} onClick={() => void move(i, -1)}
                disabled={!canMove(i, -1) || act.busy} aria-label={`Move ${pair(f)} up`} />
              <Button variant="ghost" size="sm" iconOnly icon={CaretDown} onClick={() => void move(i, 1)}
                disabled={!canMove(i, 1) || act.busy} aria-label={`Move ${pair(f)} down`} />
            </div>
          </li>
        ))}
      </ol>
      {fights.length > 1 && !fights.some(f => f.is_main_event) && <p className="t-help ink-help">No main event yet. Pick one with Make main event.</p>}
    </div>
  )
}
