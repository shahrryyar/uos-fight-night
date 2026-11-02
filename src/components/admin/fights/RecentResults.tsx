/**
 * Recent results on ink. "Correct result" opens an inline paper step under the row that spells out what
 * reverses (no modal), then admin_correct_result (unchanged).
 */
import { useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/auth'
import type { Fighter } from '../../../lib/types'
import { cancelCopy } from '../../../lib/copy'
import { ArrowCounterClockwise, Button, Field, Input, Paper, Stamp, useToast } from '../../ui'
import { kgNum, type AdminFight } from '../fightTypes'
import { FormError, SectionHead, cap, fmtDate, focusFirstInvalid, must, useAction } from '../ui'

interface Props { fights: AdminFight[]; byId: Record<string, Fighter>; onChanged: () => void }

export default function RecentResults({ fights, byId, onChanged }: Props) {
  if (fights.length === 0) return null
  return (
    <section className="adm-section" aria-labelledby="recent-h">
      <SectionHead id="recent-h" title="Recent results" sub="Only the newest bout for each fighter can be corrected." />
      <ul className="rows" role="list">
        {fights.map(f => <ResultRow key={f.id} f={f} byId={byId} onCorrected={onChanged} />)}
      </ul>
    </section>
  )
}

function ResultRow({ f, byId, onCorrected }: { f: AdminFight; byId: Record<string, Fighter>; onCorrected: () => void }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | undefined>()
  const act = useAction()
  const r = byId[f.red_fighter_id]?.nickname ?? 'Red corner', b = byId[f.blue_fighter_id]?.nickname ?? 'Blue corner'
  const settled = f.status === 'settled'
  const isParticipant = !!profile?.fighter_id && [f.red_fighter_id, f.blue_fighter_id].includes(profile.fighter_id)
  const winnerName = f.winner_side === 'red' ? r : b
  const pid = `cr-${f.id}`

  const correct = async (e: FormEvent) => {
    e.preventDefault()
    if (reason.trim().length < 5) { setErr('Say why in at least 5 characters. It goes in the admin log.'); focusFirstInvalid(e.currentTarget as HTMLElement); return }
    const res = await act.run(async () => { must(await supabase.rpc('admin_correct_result', { p_fight_id: f.id, p_reason: reason.trim() })); return true })
    if (res) {
      setOpen(false); setReason('')
      toast(`${r} vs ${b} is back on the live card. Record it again.`, { icon: ArrowCounterClockwise })
      onCorrected()
    }
  }

  const meta = settled
    ? [
        `${f.red_score ?? '?'}–${f.blue_score ?? '?'}`,
        `${cap(f.method ?? '')}${f.finish_move ? `, ${f.finish_move}` : ''}`,
        f.rounds != null ? `${f.rounds} rd` : null,
      ].filter(Boolean) as string[]
    : [fmtDate(f.scheduled_at)]
  const stamp = settled ? 'Final' : cancelCopy(f.cancel_kind).stamp

  return (
    <li>
      <div className="adm-row adm-row--np">
        <div style={{ minWidth: 0 }}>
          <p className="vs-names">
            <bdi>{r}</bdi> <span className="v">vs</span> <bdi>{b}</bdi>
          </p>
          <p className="meta data">
            {meta.map((m, i) => <span key={i} className="nowrap">{m}</span>)}
          </p>
          {settled && <p className="t-help" style={{ color: 'var(--color-bone-2)', marginTop: 2 }}><bdi>{winnerName}</bdi> won.</p>}
          {!settled && f.result_note && <p className="t-help" style={{ color: 'var(--color-bone-2)', marginTop: 2 }}>{f.result_note}</p>}
        </div>
        <div className="end">
          <Stamp tone="bone" size="sm" rot={-2}>{stamp}</Stamp>
          {settled && !open && (
            <Button variant="ghost" size="sm" onClick={() => { act.setError(null); setErr(undefined); setOpen(true) }} disabled={isParticipant}
              aria-expanded={false} aria-controls={pid} title={isParticipant ? "You're linked to a fighter in this bout" : undefined}>
              Correct
            </Button>
          )}
        </div>
      </div>
      {settled && open && (
        <Paper id={pid} className="row-panel">
          <form className="form form--flush review" onSubmit={correct} noValidate aria-labelledby={`${pid}-h`}>
            <h3 id={`${pid}-h`} className="t-sub">Correct this result?</h3>
            <p className="t-help">Reverses <bdi>{winnerName}</bdi> by {f.method}{f.red_weight_kg != null && f.blue_weight_kg != null ? `, weigh-in ${kgNum(f.red_weight_kg)} and ${kgNum(f.blue_weight_kg)} kg` : ''}.</p>
            <ul role="list">
              <li><ArrowCounterClockwise /><span>Points paid to winning picks are taken back, and every pick goes live again.</span></li>
              <li><ArrowCounterClockwise /><span>Both fighters' records, streaks and Elo go back to how they were before this bout.</span></li>
              <li><ArrowCounterClockwise /><span>The bout returns to the live card as Locked, so you can record it again.</span></li>
              <li><ArrowCounterClockwise /><span>Some members can dip below zero points.</span></li>
            </ul>
            <Field label="Why correct it?" hint="Goes in the admin log." error={err}>
              <Input value={reason} onChange={e => { setReason(e.target.value); setErr(undefined) }} maxLength={200} name="reason" autoComplete="off" />
            </Field>
            <FormError error={act.error} />
            <div className="actions">
              <Button variant="ghost" onClick={() => setOpen(false)}>Back</Button>
              <Button type="submit" variant="danger" busy={act.busy} busyLabel="Correcting">Correct result</Button>
            </div>
          </form>
        </Paper>
      )}
    </li>
  )
}
