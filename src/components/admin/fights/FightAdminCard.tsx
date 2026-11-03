/**
 * Admin bout sheet (mockup admin-settle.html, DESIGN 11.16). Flat paper, no tape.
 *   none    stamp + time, mini-vs, pool on 2 lines (or the consent list when booked), then the actions
 *   settle  Record result form: winner segs, how it ended, score bands, rounds stepper, move, weigh-in, ref note
 *   review  inline "Check before you record" (replaces the old confirm modal), then admin_settle_fight
 *   done    "Result recorded" summary; raw RPC JSON only under <details> "Technical details"
 *   lock / cancel / force  inline confirm steps on the same sheet (no modal)
 * Every RPC and its arguments are unchanged.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/auth'
import type { FightPool, Fighter, Side, WinMethod } from '../../../lib/types'
import { fmtNum } from '../../../lib/copy'
import {
  ArrowCounterClockwise, Button, ButtonLink, Check, CheckCircle, Field, HourglassMedium, Info, Input, LockSimple, Paper, Seg,
  Stamp, StatusStamp, Stepper, Timer, WarningOctagon, useToast,
} from '../../ui'
import { FINISH_MOVES, kgNum, type AdminFight } from '../fightTypes'
import { FieldGroup, FormError, cap, focusFirstInvalid, fmtTime, must, parseKg, useAction } from '../ui'

const METHODS: WinMethod[] = ['pin', 'submission', 'decision']
type CancelChoice = 'cancelled' | 'no_contest'
type Mode = 'none' | 'settle' | 'review' | 'cancel' | 'force' | 'lock'
type Errs = Partial<Record<'winner' | 'method' | 'score' | 'kg' | 'reason', string>>

interface Props {
  fight: AdminFight; red?: Fighter; blue?: Fighter; pool?: FightPool
  /** fighter ids that have an active linked member account */
  hasAccount: Set<string>
  onChanged: () => void
  /** B4: round + score handed over by the referee scoreboard ("Finish bout"); opens the result form */
  prefill?: { rounds: number; red: number; blue: number }
}

const kgStr = (n: number | null | undefined) => (n == null ? '' : String(n))
const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`

interface Checked { winner: Side; method: WinMethod; rs: number; bs: number; rk: number | null; bk: number | null; mv: string; note: string }

export default function FightAdminCard({ fight, red, blue, pool, hasAccount, onChanged, prefill }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState<Mode>(prefill && (fight.status === 'open' || fight.status === 'locked') ? 'settle' : 'none')
  // the prefill is read once at mount (AdminFights drops it right after), so remember where the numbers came from
  const [fromBoard] = useState(!!prefill)
  const [winner, setWinner] = useState<Side | ''>('')
  const [method, setMethod] = useState<WinMethod | ''>('')
  const [rounds, setRounds] = useState(prefill ? Math.min(20, Math.max(1, prefill.rounds)) : 1)
  const [redScore, setRedScore] = useState(prefill ? String(prefill.red) : '')
  const [blueScore, setBlueScore] = useState(prefill ? String(prefill.blue) : '')
  const [move, setMove] = useState('')
  const [redKg, setRedKg] = useState(kgStr(fight.red_weight_kg ?? red?.weight_kg))
  const [blueKg, setBlueKg] = useState(kgStr(fight.blue_weight_kg ?? blue?.weight_kg))
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [kind, setKind] = useState<CancelChoice>('cancelled')
  const [errs, setErrs] = useState<Errs>({})
  const [checked, setChecked] = useState<Checked | null>(null)
  const [result, setResult] = useState<{ summary: string; raw: unknown } | null>(null)
  const act = useAction()
  const formRef = useRef<HTMLFormElement>(null)

  const rName = red?.nickname ?? 'Red corner', bName = blue?.nickname ?? 'Blue corner'
  const isParticipant = !!profile?.fighter_id && [fight.red_fighter_id, fight.blue_fighter_id].includes(profile.fighter_id)
  const pastLock = new Date(fight.lock_at).getTime() <= Date.now()
  const scheduled = fight.status === 'scheduled'
  // admin_force_open refuses (FIGHTER_HAS_ACCOUNT) while a corner linked to an
  // active member hasn't said yes: that fighter must answer the booking themselves.
  const waitingOnMember = scheduled && (
    (!fight.red_accepted_at && hasAccount.has(fight.red_fighter_id)) ||
    (!fight.blue_accepted_at && hasAccount.has(fight.blue_fighter_id)))
  const canForce = scheduled && !waitingOnMember && !isParticipant
  const live = fight.status === 'open' || fight.status === 'locked'
  const canSettle = live && !isParticipant
  const datalistId = `moves-${fight.id}`
  const hid = `bc-${fight.id}`
  const fid = (s: string) => `${fight.id}-${s}`
  // arriving from the scoreboard: bring this sheet's result form into view
  useEffect(() => {
    if (prefill) document.getElementById(hid)?.closest('article')?.scrollIntoView({ block: 'start' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const canRef = !isParticipant && (fight.status === 'locked' || (fight.status === 'open' && pastLock))

  const go = (m: Mode) => {
    act.setError(null); setErrs({})
    if (m === 'cancel' || m === 'force') setReason('')
    setMode(m)
    // keep the sheet in view when the step swaps content
    requestAnimationFrame(() => document.getElementById(hid)?.closest('article')?.scrollIntoView({ block: 'nearest' }))
  }
  const clear = (k: keyof Errs) => setErrs(e => (e[k] ? { ...e, [k]: undefined } : e))

  /* ---------- actions (RPCs unchanged) ---------- */

  const lockNow = async () => {
    const r = await act.run(async () => { must(await supabase.rpc('admin_lock_fight', { p_fight_id: fight.id })); return true })
    if (r) { toast('Picks locked.', { icon: LockSimple }); setMode('none'); onChanged() }
  }

  const forceOpen = async (e: FormEvent) => {
    e.preventDefault()
    if (reason.trim().length < 5) { setErrs({ reason: 'Say why in at least 5 characters. It goes in the admin log.' }); focusFirstInvalid(formRef.current); return }
    const r = await act.run(async () => { must(await supabase.rpc('admin_force_open', { p_fight_id: fight.id, p_reason: reason.trim() })); return true })
    if (r) { toast('Picks are open.'); setMode('none'); onChanged() }
  }

  const check = (e: FormEvent) => {
    e.preventDefault()
    const next: Errs = {}
    if (!winner) next.winner = 'Choose who won.'
    if (!method) next.method = 'Choose how it ended.'
    const rs = Number(redScore), bs = Number(blueScore)
    const scoresOk = redScore.trim() !== '' && blueScore.trim() !== '' && Number.isInteger(rs) && Number.isInteger(bs) && rs >= 0 && bs >= 0
    if (!scoresOk) next.score = 'Enter both scores as whole numbers, 0 or more.'
    else if (winner && method === 'decision') {
      const ws = winner === 'red' ? rs : bs, ls = winner === 'red' ? bs : rs
      if (ws <= ls) next.score = 'For a decision the winner needs more points. Fix the score or change how it ended.'
    }
    const rk = parseKg(redKg), bk = parseKg(blueKg)
    if (Number.isNaN(rk) || Number.isNaN(bk)) next.kg = 'Weights are numbers in kg, like 72.5.'
    setErrs(next)
    if (Object.values(next).some(Boolean)) { focusFirstInvalid(formRef.current); return }
    setChecked({ winner: winner as Side, method: method as WinMethod, rs, bs, rk, bk, mv: move.trim(), note: note.trim() })
    go('review')
  }

  const record = async () => {
    if (!checked) return
    const c = checked
    const res = await act.run(async () => must(await supabase.rpc('admin_settle_fight', {
      p_fight_id: fight.id, p_winner_side: c.winner, p_method: c.method, p_note: c.note || null,
      p_rounds: rounds, p_red_score: c.rs, p_blue_score: c.bs, p_finish_move: c.mv || null,
      p_red_weight_kg: c.rk, p_blue_weight_kg: c.bk,
    })))
    if (res !== undefined) {
      const wName = c.winner === 'red' ? rName : bName
      setResult({
        summary: `${wName} wins by ${c.method}${c.mv ? `, ${c.mv}` : ''}. ${c.rs}–${c.bs} in ${plural(rounds, 'round')}.`,
        raw: res ?? { ok: true },
      })
      setMode('none')
    }
  }

  const cancel = async (e: FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) { setErrs({ reason: 'Say what happened. Members see this on the card.' }); focusFirstInvalid(formRef.current); return }
    const k: CancelChoice = live ? kind : 'cancelled'
    const r = await act.run(async () => {
      must(await supabase.rpc('admin_cancel_fight', { p_fight_id: fight.id, p_reason: reason.trim(), p_kind: k }))
      return true
    })
    if (r) { toast(k === 'no_contest' ? 'Called a no contest. Every pick came back.' : 'Bout called off. Every pick came back.'); onChanged() }
  }

  /* ---------- pieces ---------- */

  const poolLine = () => {
    if (!pool || pool.red_total + pool.blue_total === 0) return <p className="data">No points in the pool yet.</p>
    return (
      <p className="data">
        Pool <b>{fmtNum(pool.red_total + pool.blue_total)}&nbsp;pts</b><br />
        <span className="nowrap">{fmtNum(pool.red_count)} picked red,</span> <span className="nowrap">{fmtNum(pool.blue_count)} picked blue</span>
      </p>
    )
  }

  const consentRow = (side: Side) => {
    const id = side === 'red' ? fight.red_fighter_id : fight.blue_fighter_id
    const at = side === 'red' ? fight.red_accepted_at : fight.blue_accepted_at
    const name = side === 'red' ? rName : bName
    const [Ico, st] = at ? [CheckCircle, 'Said yes'] : hasAccount.has(id) ? [HourglassMedium, 'Not yet'] : [Info, 'No app account']
    return <li><Ico /><bdi>{name}</bdi><span className="st">{st}</span></li>
  }

  const actions = (a: ReactNode, b: ReactNode) => <div className="actions">{a}{b}</div>

  /* ---------- review consequences (true numbers only) ---------- */
  const consequences = (c: Checked) => {
    const side = c.winner
    const total = pool ? pool.red_total + pool.blue_total : 0
    const winCount = pool ? (side === 'red' ? pool.red_count : pool.blue_count) : 0
    const wName = side === 'red' ? rName : bName
    if (total === 0) return 'Records, streaks and Elo update. Nobody put points in, so there is nothing to hand out.'
    if (winCount === 0) return <>Records, streaks and Elo update. Nobody put points on <bdi>{wName}</bdi>, so every pick comes back in full.</>
    return <>Records, streaks and Elo update. The {fmtNum(total)}&nbsp;pts go to the {plural(winCount, 'member')} who picked {side}.</>
  }

  const detailLine = (c: Checked) => {
    const parts: string[] = []
    parts.push(`${c.mv ? `${cap(c.mv)}, ` : ''}${plural(rounds, 'round')}.`)
    if (c.rk != null || c.bk != null) parts.push(`Weigh-in ${c.rk != null ? kgNum(c.rk) : 'not set'} and ${c.bk != null ? kgNum(c.bk) : 'not set'} kg.`)
    return parts.join(' ')
  }

  /* ---------- render ---------- */

  const head = (
    <>
      <div className="ev-top">
        <StatusStamp status={fight.status} cancelKind={fight.cancel_kind} pastLock={fight.status === 'open' && pastLock} size="sm" rot={-2} land />
        <span className="data"><span className="nowrap">{fight.is_main_event ? 'Main event' : `Bout ${fight.bout_order ?? ''}`.trim()} ·</span> <b className="nowrap">{fmtTime(fight.scheduled_at)}</b></span>
      </div>
      <h2 id={hid} className="sr-only">{rName} versus {bName}</h2>
      <div className="mini-vs">
        <div><span className="corner corner--red label">Red</span><p className="t-sub"><bdi>{rName}</bdi></p></div>
        <span className="vs" aria-hidden="true">vs</span>
        <div className="r"><span className="corner corner--blue label">Blue</span><p className="t-sub"><bdi>{bName}</bdi></p></div>
      </div>
    </>
  )

  if (result !== null) {
    return (
      <Paper as="article" className="bout-card done" aria-labelledby={hid}>
        {head}
        <div className="form" role="status">
          <Stamp tone="ink" size="sm" rot={-3} land stateKey="final">Final</Stamp>
          <h3 className="t-head">Result recorded</h3>
          <p className="t-help">{result.summary} Records, Elo and points are updated.</p>
          <details>
            <summary>Technical details</summary>
            <pre>{JSON.stringify(result.raw, null, 2)}</pre>
          </details>
          <Button variant="ink" onClick={() => { setResult(null); onChanged() }}>Done</Button>
        </div>
      </Paper>
    )
  }

  return (
    <Paper as="article" className="bout-card" aria-labelledby={hid}>
      {head}

      {mode !== 'settle' && mode !== 'review' && (
        <div className="bout-lines">
          {fight.title && <p className="t-help">{fight.title}</p>}
          {scheduled
            ? <p className="t-help">Picks open when both fighters say yes.</p>
            : <>
                <p className="data" style={{ marginBottom: 6 }}>
                  Picks lock at <b>{fmtTime(fight.lock_at)}</b>{fight.status === 'open' && pastLock && <>, time passed, locking soon</>}
                </p>
                {poolLine()}
              </>}
        </div>
      )}
      {(mode === 'settle' || mode === 'review') && <div className="bout-lines">{poolLine()}</div>}
      {scheduled && mode === 'none' && <ul className="waitlist">{consentRow('red')}{consentRow('blue')}</ul>}

      <datalist id={datalistId}>{FINISH_MOVES.map(m => <option key={m} value={m} />)}</datalist>

      {mode === 'none' && (
        <div className="bout-actions">
          {isParticipant && <p className="note-line"><Info /><span>You're linked to a fighter in this bout, so another admin has to run it.</span></p>}
          {scheduled
            ? <Button variant="ink" onClick={() => go('force')} disabled={!canForce}>Open picks now</Button>
            : <>
                {canRef && <ButtonLink to={`/admin/ref/${fight.id}`} icon={Timer}>Referee scoreboard</ButtonLink>}
                <Button variant="ink" onClick={() => go('settle')} disabled={!canSettle}>Record result</Button>
              </>}
          <div className="two">
            {!scheduled && <Button variant="ghost" size="sm" icon={LockSimple} onClick={() => go('lock')} disabled={fight.status !== 'open'}>Lock picks</Button>}
            <Button variant="danger" size="sm" onClick={() => { setKind('cancelled'); go('cancel') }} style={scheduled ? { gridColumn: '1 / -1' } : undefined}>Call off</Button>
          </div>
          {waitingOnMember && !isParticipant && (
            <p className="note-line"><HourglassMedium /><span>A fighter with an app account hasn't answered yet. They have to say yes themselves.</span></p>
          )}
        </div>
      )}

      {mode === 'lock' && (
        <section className="form" aria-labelledby={fid('lk')}>
          <h3 id={fid('lk')} className="t-sub">Lock picks now?</h3>
          <p className="t-help">Nobody can pick or change a pick on this bout after this. It can't be reopened.</p>
          <FormError error={act.error} />
          {actions(
            <Button variant="ghost" onClick={() => go('none')}>Back</Button>,
            <Button variant="danger" onClick={lockNow} busy={act.busy} busyLabel="Locking">Lock picks</Button>,
          )}
        </section>
      )}

      {mode === 'force' && (
        <form ref={formRef} className="form" onSubmit={forceOpen} aria-labelledby={fid('fo')} noValidate>
          <h3 id={fid('fo')} className="t-sub">Open picks without both yeses</h3>
          <p className="t-help">Only for a fighter with no app account who agreed in person.</p>
          <Field label="Reason" hint="Goes in the admin log." error={errs.reason}>
            <Input value={reason} onChange={e => { setReason(e.target.value); clear('reason') }} maxLength={200} name="reason" autoComplete="off" />
          </Field>
          <FormError error={act.error} />
          {actions(
            <Button variant="ghost" onClick={() => go('none')}>Back</Button>,
            <Button type="submit" variant="ink" busy={act.busy} busyLabel="Opening">Open picks</Button>,
          )}
        </form>
      )}

      {mode === 'cancel' && (
        <form ref={formRef} className="form" onSubmit={cancel} aria-labelledby={fid('co')} noValidate>
          <h3 id={fid('co')} className="t-sub">Call off this bout</h3>
          {live && (
            <FieldGroup label="What happened" hint={kind === 'no_contest' ? 'Stopped with no result, like an injury. No record change.' : 'The bout is off. No record change.'}>
              <div className="segs">
                <Seg pressed={kind === 'cancelled'} onClick={() => setKind('cancelled')}>Called off</Seg>
                <Seg pressed={kind === 'no_contest'} onClick={() => setKind('no_contest')}>No contest</Seg>
              </div>
            </FieldGroup>
          )}
          <Field label="Reason" hint="Members see this on the card. Every pick comes back in full." error={errs.reason}>
            <Input value={reason} onChange={e => { setReason(e.target.value); clear('reason') }} maxLength={200} name="reason" autoComplete="off" />
          </Field>
          <FormError error={act.error} />
          {actions(
            <Button variant="ghost" onClick={() => go('none')}>Back</Button>,
            <Button type="submit" variant="danger" busy={act.busy} busyLabel="Calling it off">{kind === 'no_contest' && live ? 'Call no contest' : 'Call it off'}</Button>,
          )}
        </form>
      )}

      {mode === 'settle' && (
        <form ref={formRef} className="form" onSubmit={check} aria-labelledby={fid('rr')} noValidate>
          <h3 id={fid('rr')} className="t-sub">Record result</h3>
          {fromBoard && <p className="t-help">Rounds and points come from the scoreboard. Check them, then pick the winner.</p>}
          <FieldGroup label="Winner" error={errs.winner}>
            <div className="segs">
              <Seg corner="red" pressed={winner === 'red'} onClick={() => { setWinner('red'); clear('winner'); clear('score') }}><bdi>{rName}</bdi></Seg>
              <Seg corner="blue" pressed={winner === 'blue'} onClick={() => { setWinner('blue'); clear('winner'); clear('score') }}><bdi>{bName}</bdi></Seg>
            </div>
          </FieldGroup>
          <FieldGroup label="How it ended" error={errs.method}>
            <div className="segs">
              {METHODS.map(m => <Seg key={m} pressed={method === m} onClick={() => { setMethod(m); clear('method'); clear('score') }}>{cap(m)}</Seg>)}
            </div>
          </FieldGroup>
          <div className="field">
            <span className="field-label" id={fid('sc')}>Points scored</span>
            <div className="pair" role="group" aria-labelledby={fid('sc')}>
              <div className="score-field">
                <label className="corner corner--red label" htmlFor={fid('rs')}>Red</label>
                <Input look="score" id={fid('rs')} inputMode="numeric" autoComplete="off" value={redScore} aria-invalid={errs.score ? true : undefined}
                  aria-describedby={errs.score ? fid('serr') : undefined}
                  onChange={e => { setRedScore(e.target.value.replace(/\D/g, '').slice(0, 3)); clear('score') }} />
              </div>
              <div className="score-field">
                <label className="corner corner--blue label" htmlFor={fid('bs')}>Blue</label>
                <Input look="score" id={fid('bs')} inputMode="numeric" autoComplete="off" value={blueScore} aria-invalid={errs.score ? true : undefined}
                  aria-describedby={errs.score ? fid('serr') : undefined}
                  onChange={e => { setBlueScore(e.target.value.replace(/\D/g, '').slice(0, 3)); clear('score') }} />
              </div>
            </div>
            {errs.score
              ? <p className="field-error" id={fid('serr')} role="alert"><WarningOctagon /><span>{errs.score}</span></p>
              : method === 'decision' && <p className="field-hint">For a decision the winner needs more points. Pins and submissions can win from behind.</p>}
          </div>
          <div className="field">
            <span className="field-label" id={fid('rl')}>Rounds wrestled</span>
            <Stepper label="Rounds wrestled" value={rounds} min={1} max={20} onChange={setRounds} />
          </div>
          <Field label={<>Finish move <span className="opt">(optional)</span></>}>
            <Input list={datalistId} value={move} onChange={e => setMove(e.target.value)} maxLength={60} autoCapitalize="none" autoComplete="off" name="finish_move" />
          </Field>
          <div className="field">
            <span className="field-label" id={fid('wk')}>Weigh-in, kg</span>
            <div className="pair" role="group" aria-labelledby={fid('wk')}>
              <Input look="data" inputMode="decimal" value={redKg} aria-label="Red corner weight in kg" aria-invalid={errs.kg ? true : undefined}
                onChange={e => { setRedKg(e.target.value.replace(/[^\d.,]/g, '')); clear('kg') }} />
              <Input look="data" inputMode="decimal" value={blueKg} aria-label="Blue corner weight in kg" aria-invalid={errs.kg ? true : undefined}
                onChange={e => { setBlueKg(e.target.value.replace(/[^\d.,]/g, '')); clear('kg') }} />
            </div>
            {errs.kg && <p className="field-error" role="alert"><WarningOctagon /><span>{errs.kg}</span></p>}
          </div>
          <Field label={<>Ref note <span className="opt">(optional)</span></>}>
            <Input value={note} onChange={e => setNote(e.target.value)} maxLength={200} name="ref_note" autoComplete="off" />
          </Field>
          {actions(
            <Button variant="ghost" onClick={() => go('none')}>Back</Button>,
            <Button type="submit" variant="ink">Check result</Button>,
          )}
        </form>
      )}

      {mode === 'review' && checked && (
        <section className="form review" aria-labelledby={fid('ck')}>
          <h3 id={fid('ck')} className="t-sub">Check before you record</h3>
          <p className="t-score" aria-label={`${checked.rs} to ${checked.bs}`}>
            <span className="c-red">{checked.rs}</span><span className="dash" aria-hidden="true">–</span><span className="c-blue">{checked.bs}</span>
          </p>
          <p className="t-sub"><bdi>{checked.winner === 'red' ? rName : bName}</bdi> wins by {checked.method}</p>
          <ul role="list">
            <li><Check /><span>{detailLine(checked)}</span></li>
            <li><Check /><span><bdi>{checked.winner === 'red' ? bName : rName}</bdi> lost by {checked.method}.</span></li>
            {checked.note && <li><Check /><span>Ref note: <q>{checked.note}</q></span></li>}
            <li><Check /><span>{consequences(checked)}</span></li>
            <li><ArrowCounterClockwise /><span>A mistake can be fixed later with Correct result.</span></li>
          </ul>
          <FormError error={act.error} />
          {actions(
            <Button variant="ghost" onClick={() => go('settle')} disabled={act.busy}>Edit</Button>,
            <Button onClick={record} busy={act.busy} busyLabel="Recording">Record result</Button>,
          )}
        </section>
      )}
    </Paper>
  )
}

