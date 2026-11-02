import { useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/auth'
import type { Fighter } from '../../../lib/types'
import { kgLabel, type AdminFight } from '../fightTypes'
import { Btn, ErrorBox, Field, OkBox, Pill, SectionTitle, fmtDate, inputCls, must, useAction, useConfirm } from '../ui'

interface Props { fights: AdminFight[]; byId: Record<string, Fighter>; onChanged: () => void }

const KIND_LABEL = { cancelled: 'Cancelled', no_contest: 'No contest', declined: 'Declined' } as const

export default function RecentResults({ fights, byId, onChanged }: Props) {
  const [ok, setOk] = useState('')
  if (fights.length === 0) return null
  return (
    <div>
      <SectionTitle>Recent results</SectionTitle>
      <OkBox>{ok}</OkBox>
      <ul className="space-y-2 mt-2">
        {fights.map(f => (
          <ResultRow key={f.id} f={f} byId={byId} onCorrected={msg => { setOk(msg); onChanged() }} />
        ))}
      </ul>
    </div>
  )
}

function ResultRow({ f, byId, onCorrected }: { f: AdminFight; byId: Record<string, Fighter>; onCorrected: (msg: string) => void }) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const act = useAction()
  const [dialog, confirm] = useConfirm()
  const r = byId[f.red_fighter_id]?.nickname ?? '?', b = byId[f.blue_fighter_id]?.nickname ?? '?'
  const settled = f.status === 'settled'
  const isParticipant = !!profile?.fighter_id && [f.red_fighter_id, f.blue_fighter_id].includes(profile.fighter_id)
  const winnerName = f.winner_side === 'red' ? r : b

  const correct = async (e: FormEvent) => {
    e.preventDefault()
    if (reason.trim().length < 5) return act.setError('Give a reason (at least 5 characters) — it goes in the admin log.')
    const yes = await confirm({
      title: 'Correct result?', confirmLabel: 'Reverse result',
      body: (
        <>
          <p>Reverses <b>{r} vs {b}</b> ({winnerName} by {f.method}):</p>
          <ul className="list-disc pl-5 space-y-1 text-bone/90">
            <li>Winning bettors' payouts are taken back and every stake goes back to an active bet.</li>
            <li>Both fighters' W-L, streak and Elo return to how they were before this fight.</li>
            <li>The fight goes back to <b>locked</b> on the live card so you can settle it again.</li>
          </ul>
          <p className="text-muted">Some members may dip below zero points. Only the newest fight for these fighters can be corrected.</p>
        </>
      ),
    })
    if (!yes) return
    const res = await act.run(async () => { must(await supabase.rpc('admin_correct_result', { p_fight_id: f.id, p_reason: reason.trim() })); return true })
    if (res) { setOpen(false); setReason(''); onCorrected(`${r} vs ${b} reversed — it's back on the live card, settle it again.`) }
  }

  return (
    <li className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
      {dialog}
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate">
            <span className={f.winner_side === 'red' ? 'text-red font-bold' : ''}>{r}</span>
            <span className="text-muted"> vs </span>
            <span className={f.winner_side === 'blue' ? 'text-blue font-bold' : ''}>{b}</span>
          </span>
          <span className="block text-xs text-muted truncate">
            {settled
              ? <>{f.red_score ?? '–'}–{f.blue_score ?? '–'} · {f.rounds ?? '?'} rd · {kgLabel(f.red_weight_kg)} / {kgLabel(f.blue_weight_kg)}{f.finish_move && ` · ${f.finish_move}`}</>
              : <>{f.result_note || fmtDate(f.scheduled_at)}</>}
          </span>
        </span>
        {settled
          ? <Pill tone="gold">{f.method}</Pill>
          : <Pill tone={f.cancel_kind === 'no_contest' ? 'red' : 'muted'}>{KIND_LABEL[f.cancel_kind ?? 'cancelled']}</Pill>}
      </div>
      {settled && !open && (
        <Btn className="w-full mt-2 text-sm" onClick={() => { act.setError(null); setOpen(true) }} disabled={isParticipant}
          title={isParticipant ? "You're linked to a fighter in this bout" : undefined}>
          Correct result
        </Btn>
      )}
      {settled && open && (
        <form onSubmit={correct} className="mt-3 space-y-3">
          <Field label="Why correct it?" hint="Logged in the admin log.">
            <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="Wrong winner tapped" />
          </Field>
          <ErrorBox error={act.error} />
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => setOpen(false)}>Back</Btn>
            <Btn type="submit" variant="danger" busy={act.busy}>Correct result</Btn>
          </div>
        </form>
      )}
    </li>
  )
}
