/**
 * Profile "Title reigns" (view belt_reign_history for one fighter), newest first. A list, so it is
 * printed on ink (material C). Renders nothing when the fighter never held the belt.
 * Gold (<ChampionBelt/>) only on the CURRENT reign; ended reigns get the bone Belt Holder seal.
 */
import { supabase } from '../../lib/supabase'
import { fmtDay, must, useAsync } from '../../lib/hooks'
import type { BeltReignHistory } from '../../lib/types'
import { ChampionBelt } from '../brand'
import { BadgeSeal } from '../badges'
import { daysText, defensesText, endHow, reignDays, wonHow } from './reign'
import './belt.css'

export default function TitleReigns({ fighterId, className }: { fighterId: string; className?: string }) {
  const st = useAsync(async () =>
    must(await supabase.from('belt_reign_history').select('*').eq('fighter_id', fighterId)
      .order('started_at', { ascending: false })) as BeltReignHistory[], [fighterId])

  const reigns = st.data ?? []
  if (!reigns.length) return null // loading, error or never champion: nothing to claim

  return (
    <section className={`section reigns ${className ?? ''}`} aria-labelledby="reigns-h">
      <div className="section-head">
        <h2 id="reigns-h" className="t-head">Title reigns</h2>
        {reigns.length > 1 && <span className="data c-2">{reigns.length} reigns</span>}
      </div>
      <ul className="rows" role="list">
        {reigns.map(r => {
          const days = reignDays(r.started_at, r.ended_at)
          return (
            <li key={r.reign_id} className="row reign">
              {r.is_current ? <ChampionBelt size={40} /> : <BadgeSeal icon="Crown" size={40} rot={-2} />}
              <span>
                <span className="t-sub">{r.is_current ? 'Current reign' : `${fmtDay(r.started_at)} to ${fmtDay(r.ended_at)}`}</span>
                {r.is_current && <span className="data">Since <b>{fmtDay(r.started_at)}</b></span>}
                <span className="data">
                  <span className="nowrap">{daysText(days)}</span>{' \u00b7 '}<span className="nowrap">{defensesText(r.defenses, 'No defenses')}</span>
                </span>
                <span className="t-help reign-how">{wonHow(r.won_fight_id)}. {endHow(r.end_reason)}.</span>
                {r.note?.trim() && <span className="t-help reign-note">“{r.note.trim()}”</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
