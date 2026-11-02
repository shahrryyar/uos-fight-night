import { useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/auth'
import type { FightPool, Fighter, Side, WinMethod } from '../../../lib/types'
import FighterPhoto from '../../FighterPhoto'
import { FINISH_MOVES, kgLabel, type AdminFight } from '../fightTypes'
import {
  Btn, Card, ErrorBox, Field, Pill, Stepper,
  fmtDate, inputCls, must, parseKg, useAction, useConfirm,
} from '../ui'

const METHODS: WinMethod[] = ['pin', 'submission', 'decision']
type CancelChoice = 'cancelled' | 'no_contest'

interface Props {
  fight: AdminFight; red?: Fighter; blue?: Fighter; pool?: FightPool
  /** fighter ids that have an active linked member account */
  hasAccount: Set<string>
  onChanged: () => void
}

const kgStr = (n: number | null | undefined) => (n == null ? '' : String(n))

export default function FightAdminCard({ fight, red, blue, pool, hasAccount, onChanged }: Props) {
  const { profile } = useAuth()
  const [mode, setMode] = useState<'none' | 'settle' | 'cancel' | 'force'>('none')
  const [winner, setWinner] = useState<Side | ''>('')
  const [method, setMethod] = useState<WinMethod | ''>('')
  const [rounds, setRounds] = useState(1)
  const [redScore, setRedScore] = useState('')
  const [blueScore, setBlueScore] = useState('')
  const [move, setMove] = useState('')
  const [redKg, setRedKg] = useState(kgStr(fight.red_weight_kg ?? red?.weight_kg))
  const [blueKg, setBlueKg] = useState(kgStr(fight.blue_weight_kg ?? blue?.weight_kg))
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [kind, setKind] = useState<CancelChoice>('cancelled')
  const [result, setResult] = useState<{ summary: string; raw: unknown } | null>(null)
  const act = useAction()
  const [dialog, confirm] = useConfirm()

  const rName = red?.nickname ?? 'Red', bName = blue?.nickname ?? 'Blue'
  const isParticipant = !!profile?.fighter_id && [fight.red_fighter_id, fight.blue_fighter_id].includes(profile.fighter_id)
  const pastLock = new Date(fight.lock_at).getTime() <= Date.now()
  const scheduled = fight.status === 'scheduled'
  // admin_force_open refuses (FIGHTER_HAS_ACCOUNT) while a corner linked to an
  // active member hasn't accepted — that fighter must accept or decline it.
  const waitingOnMember = scheduled && (
    (!fight.red_accepted_at && hasAccount.has(fight.red_fighter_id)) ||
    (!fight.blue_accepted_at && hasAccount.has(fight.blue_fighter_id)))
  const canForce = scheduled && !waitingOnMember && !isParticipant
  const canSettle = (fight.status === 'open' || fight.status === 'locked') && !isParticipant
  const live = fight.status === 'open' || fight.status === 'locked'
  const datalistId = `moves-${fight.id}`

  const go = (m: typeof mode) => { act.setError(null); setReason(''); setMode(m) }

  const lockNow = async () => {
    if (!(await confirm({ title: 'Lock picks?', body: <p>Votes and bets close for <b>{rName} vs {bName}</b>. This can't be reopened.</p>, confirmLabel: 'Lock' }))) return
    const r = await act.run(async () => { must(await supabase.rpc('admin_lock_fight', { p_fight_id: fight.id })); return true })
    if (r) onChanged()
  }

  const forceOpen = async (e: FormEvent) => {
    e.preventDefault()
    if (reason.trim().length < 5) return act.setError('Give a reason (at least 5 characters) — it goes in the admin log.')
    if (!(await confirm({
      title: 'Force open?', variant: 'gold', confirmLabel: 'Open picks',
      body: <p>Opens votes and bets on <b>{rName} vs {bName}</b> without waiting for both fighters to accept. Use only when a fighter has no app account and agreed in person.</p>,
    }))) return
    const r = await act.run(async () => { must(await supabase.rpc('admin_force_open', { p_fight_id: fight.id, p_reason: reason.trim() })); return true })
    if (r) { setMode('none'); onChanged() }
  }

  const settle = async (e: FormEvent) => {
    e.preventDefault()
    if (!winner || !method) return act.setError('Pick the winner and the method.')
    const rs = Number(redScore), bs = Number(blueScore)
    if (redScore.trim() === '' || blueScore.trim() === '' || !Number.isInteger(rs) || !Number.isInteger(bs) || rs < 0 || bs < 0)
      return act.setError('Enter both scores as whole numbers (0 or more).')
    const ws = winner === 'red' ? rs : bs, ls = winner === 'red' ? bs : rs
    if (method === 'decision' && ws <= ls) return act.setError('For a decision the winner must have more points.')
    const rk = parseKg(redKg), bk = parseKg(blueKg)
    if (Number.isNaN(rk) || Number.isNaN(bk)) return act.setError('Weights must be numbers in kg, e.g. 72.5.')
    const mv = move.trim()
    const wName = winner === 'red' ? rName : bName
    const lName = winner === 'red' ? bName : rName
    const ok = await confirm({
      title: 'Record result?',
      confirmLabel: 'Record & pay out',
      variant: winner === 'red' ? 'red' : 'blue',
      body: (
        <>
          <p className="font-display text-2xl tracking-wide">
            <span className={winner === 'red' ? 'text-red' : 'text-blue'}>{wName}</span> wins by <span className="text-gold">{method}</span>
            {mv && <span className="text-bone/80"> ({mv})</span>}
          </p>
          <p className="font-display text-3xl tracking-wide">
            <span className="text-red">{rs}</span> <span className="text-muted">–</span> <span className="text-blue">{bs}</span>
            <span className="ml-2 text-base text-muted font-sans">{rounds} round{rounds === 1 ? '' : 's'}</span>
          </p>
          <p className="text-muted">{rName} {kgLabel(rk)} · {bName} {kgLabel(bk)}</p>
          <p className="text-muted">{lName} lost by {method}.</p>
          {note.trim() && <p className="text-muted">Ref note: “{note.trim()}”</p>}
          {pool && (
            <p className="text-muted">
              Pool: <span className="text-red">{pool.red_total}</span> red ({pool.red_count}) · <span className="text-blue">{pool.blue_total}</span> blue ({pool.blue_count}) points
            </p>
          )}
          <p>This updates W-L, streaks and Elo and pays out points. A mistake can be fixed later with <b>Correct result</b> (newest fight first).</p>
        </>
      ),
    })
    if (!ok) return
    const res = await act.run(async () => must(await supabase.rpc('admin_settle_fight', {
      p_fight_id: fight.id, p_winner_side: winner, p_method: method, p_note: note.trim() || null,
      p_rounds: rounds, p_red_score: rs, p_blue_score: bs, p_finish_move: mv || null,
      p_red_weight_kg: rk, p_blue_weight_kg: bk,
    })))
    if (res !== undefined) {
      setResult({ summary: `${wName} wins by ${method}${mv ? ` (${mv})` : ''} · ${rs}–${bs} · ${rounds} rd`, raw: res ?? { ok: true } })
      setMode('none')
    }
  }

  const cancel = async (e: FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return act.setError('Give a reason so members know what happened.')
    const k: CancelChoice = live ? kind : 'cancelled'
    const nc = k === 'no_contest'
    if (!(await confirm({
      title: nc ? 'No contest?' : 'Cancel fight?',
      confirmLabel: nc ? 'Call no contest' : 'Cancel fight',
      body: (
        <p>
          {nc ? <>Stops <b>{rName} vs {bName}</b> as a <b>no contest</b> (injury). </> : <>Cancels <b>{rName} vs {bName}</b>. </>}
          All active bets get refunded. No record changes.
        </p>
      ),
    }))) return
    const r = await act.run(async () => {
      must(await supabase.rpc('admin_cancel_fight', { p_fight_id: fight.id, p_reason: reason.trim(), p_kind: k }))
      return true
    })
    if (r) onChanged()
  }

  if (result !== null) {
    return (
      <Card className="border-gold/50">
        <p className="font-display text-3xl tracking-wider text-gold mb-1">Result recorded</p>
        <p className="text-sm text-bone/90 mb-2">{result.summary}</p>
        <details className="text-xs text-muted">
          <summary className="min-h-11 flex items-center cursor-pointer">Payout details</summary>
          <pre className="max-h-72 overflow-auto rounded-lg bg-ink p-3 text-xs text-bone/90 whitespace-pre-wrap break-all">{JSON.stringify(result.raw, null, 2)}</pre>
        </details>
        <Btn variant="gold" className="w-full mt-3" onClick={() => { setResult(null); onChanged() }}>Done</Btn>
      </Card>
    )
  }

  const consent = (side: Side) => {
    const fid = side === 'red' ? fight.red_fighter_id : fight.blue_fighter_id
    const at = side === 'red' ? fight.red_accepted_at : fight.blue_accepted_at
    if (at) return <span className="text-xs text-gold">✅ Accepted</span>
    if (!hasAccount.has(fid)) return <span className="text-xs text-muted">⏳ No account</span>
    return <span className="text-xs text-muted">⏳ Waiting</span>
  }

  const corner = (side: Side) => {
    const f = side === 'red' ? red : blue
    const name = side === 'red' ? rName : bName
    const kg = side === 'red' ? fight.red_weight_kg : fight.blue_weight_kg
    const tot = pool && (side === 'red' ? `${pool.red_total} pts · ${pool.red_count}` : `${pool.blue_total} pts · ${pool.blue_count}`)
    return (
      <div className="flex flex-col items-center gap-1 text-center min-w-0">
        <FighterPhoto path={f?.photo_path} nickname={name} corner={side} className="size-14" />
        <span className={`font-display text-xl tracking-wide truncate max-w-full ${side === 'red' ? 'text-red' : 'text-blue'}`}>{name}</span>
        <span className="text-xs text-bone/80 tabular-nums">{kgLabel(kg ?? f?.weight_kg)}</span>
        {scheduled ? consent(side) : tot && <span className="text-xs text-muted">{tot}</span>}
      </div>
    )
  }

  const scoreInput = (side: Side, v: string, set: (s: string) => void) => (
    <Field label={`${side === 'red' ? rName : bName} score`}>
      <input className={`${inputCls} font-display text-3xl text-center tabular-nums border-l-4 ${side === 'red' ? 'border-l-red' : 'border-l-blue'}`}
        inputMode="numeric" placeholder="0" value={v} onChange={e => set(e.target.value.replace(/\D/g, '').slice(0, 3))} />
    </Field>
  )

  const kgInput = (side: Side, v: string, set: (s: string) => void) => (
    <Field label={`${side === 'red' ? rName : bName} kg`}>
      <input className={inputCls} inputMode="decimal" placeholder="—" value={v} onChange={e => set(e.target.value.replace(/[^\d.,]/g, ''))} />
    </Field>
  )

  return (
    <Card className={`overflow-hidden p-0 ${fight.is_main_event ? 'border-gold/60' : ''}`}>
      {dialog}
      {fight.is_main_event && (
        <div className="bg-gold text-ink text-center font-display text-lg tracking-[0.3em] py-0.5">MAIN EVENT</div>
      )}
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="text-xs text-muted truncate">Bout {fight.bout_order ?? '—'} · {fight.title || 'Fight'} · {fmtDate(fight.scheduled_at)}</span>
        <Pill tone={fight.status === 'open' ? 'gold' : 'muted'}>{fight.status}</Pill>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3">
        {corner('red')}
        <span className="font-display text-3xl text-gold">VS</span>
        {corner('blue')}
      </div>
      <p className="px-4 text-xs text-muted">
        {scheduled
          ? 'Waiting for both fighters to accept — picks open automatically.'
          : <>Picks lock {fmtDate(fight.lock_at)}{fight.status === 'open' && pastLock && ' (past — auto-lock pending)'}</>}
      </p>

      <datalist id={datalistId}>{FINISH_MOVES.map(m => <option key={m} value={m} />)}</datalist>

      <div className="p-4 space-y-3">
        {isParticipant && (
          <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
            You're linked to a fighter in this bout — another admin must record the result.
          </p>
        )}
        <ErrorBox error={act.error} />

        {mode === 'none' && (
          <div className="grid grid-cols-3 gap-2">
            {scheduled
              ? <Btn variant="gold" onClick={() => go('force')} disabled={!canForce} busy={act.busy} className="col-span-2">Force open</Btn>
              : <>
                  <Btn onClick={lockNow} disabled={fight.status !== 'open'} busy={act.busy}>Lock</Btn>
                  <Btn variant="gold" onClick={() => go('settle')} disabled={!canSettle}>Settle</Btn>
                </>}
            <Btn variant="danger" onClick={() => { setKind('cancelled'); go('cancel') }}>Cancel</Btn>
            {waitingOnMember && !isParticipant && (
              <p className="col-span-3 text-xs text-muted">
                Waiting on a fighter with an app account to accept — they must accept the fight themselves.
              </p>
            )}
          </div>
        )}

        {mode === 'force' && (
          <form onSubmit={forceOpen} className="space-y-3">
            <Field label="Reason" hint="Logged. E.g. “Karim has no account, agreed in person.”">
              <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="No app account, agreed in person" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => setMode('none')}>Back</Btn>
              <Btn type="submit" variant="gold" busy={act.busy}>Force open</Btn>
            </div>
          </form>
        )}

        {mode === 'settle' && (
          <form onSubmit={settle} className="space-y-4">
            <Field label="Winner" group>
              <div className="grid grid-cols-2 gap-2">
                {(['red', 'blue'] as Side[]).map(s => (
                  <button key={s} type="button" onClick={() => setWinner(s)} aria-pressed={winner === s}
                    className={`min-h-12 rounded-lg border-2 font-display text-xl tracking-wide truncate px-2 ${
                      winner === s
                        ? s === 'red' ? 'bg-red border-red text-bone' : 'bg-blue border-blue text-bone'
                        : s === 'red' ? 'border-red/50 text-red' : 'border-blue/50 text-blue'}`}>
                    {s === 'red' ? rName : bName}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Method" group>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map(m => (
                  <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m}
                    className={`min-h-11 rounded-lg border text-sm font-bold uppercase tracking-wider ${
                      method === m ? 'bg-gold border-gold text-ink' : 'border-line text-muted'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              {scoreInput('red', redScore, setRedScore)}
              {scoreInput('blue', blueScore, setBlueScore)}
            </div>
            {method === 'decision' && <p className="-mt-2 text-xs text-muted">Decision: the winner needs the higher score. Pins and submissions can win from behind.</p>}
            <Field label="Rounds fought" group>
              <Stepper label="rounds" value={rounds} min={1} max={20} onChange={setRounds} />
            </Field>
            <Field label="Finish move (optional)">
              <input className={inputCls} list={datalistId} value={move} onChange={e => setMove(e.target.value)} maxLength={60}
                placeholder="half nelson, headlock…" autoCapitalize="none" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              {kgInput('red', redKg, setRedKg)}
              {kgInput('blue', blueKg, setBlueKg)}
            </div>
            <Field label="Referee note (optional)">
              <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="Tapped at 1:40 of round 2" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => setMode('none')}>Back</Btn>
              <Btn type="submit" variant="gold" busy={act.busy}>Record result</Btn>
            </div>
          </form>
        )}

        {mode === 'cancel' && (
          <form onSubmit={cancel} className="space-y-3">
            {live && (
              <Field label="Kind" group>
                <div className="grid grid-cols-2 gap-2">
                  {([['cancelled', 'Cancel'], ['no_contest', 'No contest (injury)']] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                      className={`min-h-11 rounded-lg border text-sm font-bold uppercase tracking-wider px-2 ${
                        kind === k ? 'bg-red border-red text-bone' : 'border-line text-muted'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <Field label="Reason">
              <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={200}
                placeholder={kind === 'no_contest' && live ? 'Shoulder tweak in round 1…' : 'RA walked in, rescheduling…'} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => setMode('none')}>Back</Btn>
              <Btn type="submit" variant="danger" busy={act.busy}>{kind === 'no_contest' && live ? 'No contest' : 'Cancel fight'}</Btn>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}
