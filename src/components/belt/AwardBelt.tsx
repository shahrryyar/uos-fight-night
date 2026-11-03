/**
 * Admin: award or vacate the title belt (admin_award_belt). Its own paper sheet under the fighter form
 * (no nested paper). The confirm is an inline step, not a modal (DESIGN 11.16), with an optional note
 * (<=200 chars) that is kept on the reign and the admin log.
 */
import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDay } from '../../lib/hooks'
import type { AwardBeltResult, Fighter } from '../../lib/types'
import { ChampionBelt } from '../brand'
import { Button, Field, Input, Paper, useToast } from '../ui'
import { FormError, adminError } from '../admin/ui'
import { invalidateChampion, useChampion } from './useChampion'
import { defensesText } from './reign'
import './belt.css'

const BELT_CODES: Record<string, string> = {
  NO_CHAMPION: 'Nobody holds the belt, so there is nothing to vacate.',
  ALREADY_CHAMPION: 'That fighter already holds the belt.',
  INVALID_NOTE: 'Keep the note to 200 characters.',
  PARTICIPANT: 'You are linked to this fighter or the champion, so another admin has to move the belt.',
  FIGHTER_NOT_FOUND: 'That fighter no longer exists.',
}
export function beltError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g) ?? []) if (BELT_CODES[tok]) return BELT_CODES[tok]
  return adminError(e)
}

type Mode = 'idle' | 'award' | 'vacate'

export default function AwardBelt({ fighter, onChanged }: { fighter: Pick<Fighter, 'id' | 'nickname' | 'hidden'>; onChanged?: () => void }) {
  const toast = useToast()
  const { champion, loaded } = useChampion()
  const [mode, setMode] = useState<Mode>('idle')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!loaded) return null

  const holds = champion?.fighter_id === fighter.id
  const name = fighter.nickname

  const back = () => { setMode('idle'); setErr(null); setNote('') }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (note.trim().length > 200) { setErr(BELT_CODES.INVALID_NOTE); return }
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('admin_award_belt', {
      p_fighter_id: mode === 'vacate' ? null : fighter.id,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(beltError(error)); return }
    const res = data as AwardBeltResult
    await invalidateChampion()
    toast(res.fighter_id ? `${name} holds the belt.` : 'Belt vacated.')
    back()
    onChanged?.()
  }

  return (
    <Paper as="section" className="award-belt" aria-labelledby="belt-h" style={{ marginTop: 18 }}>
      <h2 id="belt-h" className="t-sub award-belt-h"><ChampionBelt size={32} />Title belt</h2>

      {mode === 'idle' && (
        <>
          <p className="t-help" style={{ marginTop: 8 }}>
            {holds
              ? <><b>{name}</b> holds the belt since <span className="nowrap data"><b>{fmtDay(champion!.since)}</b></span>. {defensesText(champion!.defenses)}.</>
              : champion
                ? <><b>{champion.nickname}</b> holds the belt now. It moves on its own when the champion loses a fight.</>
                : <>The belt is vacant. Award it to crown the first champion. After that it moves when the champion loses.</>}
          </p>
          <div className="actions" style={{ marginTop: 12 }}>
            {holds
              ? <Button variant="danger" size="sm" onClick={() => setMode('vacate')}>Vacate the belt</Button>
              : <Button variant="ink" size="sm" wrap disabled={fighter.hidden} onClick={() => setMode('award')}>Give {name} the belt</Button>}
          </div>
          {!holds && fighter.hidden && <p className="field-hint" style={{ marginTop: 6 }}>Hidden fighters can't hold the belt. Show them on the roster first.</p>}
        </>
      )}

      {mode !== 'idle' && (
        <form onSubmit={submit} noValidate className="award-belt-form">
          <p className="t-head" style={{ marginTop: 10 }}>
            {mode === 'vacate' ? <>Vacate the belt?</> : <>Give <bdi>{name}</bdi> the belt?</>}
          </p>
          <ul className="award-belt-list t-help">
            {mode === 'vacate' ? (
              <>
                <li><span><bdi>{name}</bdi>’s reign ends, marked as vacated.</span></li>
                <li><span>Nobody holds the belt until you award it again.</span></li>
                <li><span>Their booked fights stop being title fights.</span></li>
              </>
            ) : (
              <>
                {champion && <li><span><bdi>{champion.nickname}</bdi>’s reign ends, marked as moved by an admin.</span></li>}
                <li><span><bdi>{name}</bdi> becomes champion and gets the Belt Holder badge.</span></li>
                <li><span>Their booked fights become title fights.</span></li>
              </>
            )}
          </ul>
          <Field label={<>Note <span className="opt">(optional)</span></>} hint="Why the belt moves. Shown on the reign. Up to 200 characters.">
            <Input name="belt-note" value={note} maxLength={200} autoComplete="off" onChange={e => setNote(e.target.value)} />
          </Field>
          <FormError error={err} />
          <div className="actions">
            <Button variant="ghost" onClick={back}>Back</Button>
            <Button type="submit" variant={mode === 'vacate' ? 'danger' : 'primary'} wrap busy={busy} busyLabel="Saving">
              {mode === 'vacate' ? 'Yes, vacate it' : `Crown ${name}`}
            </Button>
          </div>
        </form>
      )}
    </Paper>
  )
}
