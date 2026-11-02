import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Fight, FightPool, Fighter, Side, WinMethod } from '../../lib/types'
import FighterPhoto from '../../components/FighterPhoto'
import {
  Btn, Card, Empty, ErrorBox, Field, OkBox, Pill, SectionTitle,
  fmtDate, fromLocalInput, inputCls, must, toLocalInput, useAction, useConfirm,
} from '../../components/admin/ui'

const METHODS: WinMethod[] = ['pin', 'submission', 'decision']

function defaultStart() {
  const d = new Date(Date.now() + 24 * 3600_000)
  d.setHours(21, 0, 0, 0)
  return toLocalInput(d)
}

export default function AdminFights() {
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [fights, setFights] = useState<Fight[]>([])
  const [recent, setRecent] = useState<Fight[]>([])
  const [pools, setPools] = useState<Record<string, FightPool>>({})
  const load = useAction()
  const loadRun = load.run

  const refresh = useCallback(() => loadRun(async () => {
    const [fr, active, done] = await Promise.all([
      supabase.from('fighters').select('*').order('nickname'),
      supabase.from('fights').select('*').in('status', ['scheduled', 'open', 'locked']).order('scheduled_at'),
      supabase.from('fights').select('*').in('status', ['settled', 'cancelled']).order('scheduled_at', { ascending: false }).limit(8),
    ])
    setFighters(must(fr) as Fighter[])
    const act = must(active) as Fight[]
    setFights(act)
    setRecent(must(done) as Fight[])
    if (act.length) {
      const p = must(await supabase.from('fight_pools').select('*').in('fight_id', act.map(f => f.id))) as FightPool[]
      setPools(Object.fromEntries(p.map(x => [x.fight_id, x])))
    } else setPools({})
  }), [loadRun])

  useEffect(() => { void refresh() }, [refresh])

  const byId = useMemo(() => Object.fromEntries(fighters.map(f => [f.id, f])), [fighters])

  return (
    <div className="space-y-6">
      <CreateFight fighters={fighters} onCreated={refresh} />
      <div>
        <SectionTitle right={<Btn onClick={() => void refresh()} busy={load.busy} className="text-sm">Refresh</Btn>}>
          Live card
        </SectionTitle>
        <ErrorBox error={load.error} />
        <div className="space-y-4">
          {!load.busy && fights.length === 0 && <Empty>No open or locked fights. Book one above.</Empty>}
          {fights.map(f => (
            <FightAdminCard key={f.id} fight={f} red={byId[f.red_fighter_id]} blue={byId[f.blue_fighter_id]}
              pool={pools[f.id]} onChanged={refresh} />
          ))}
        </div>
      </div>
      {recent.length > 0 && (
        <div>
          <SectionTitle>Recent results</SectionTitle>
          <ul className="space-y-2">
            {recent.map(f => {
              const r = byId[f.red_fighter_id]?.nickname ?? '?', b = byId[f.blue_fighter_id]?.nickname ?? '?'
              return (
                <li key={f.id} className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className={f.winner_side === 'red' ? 'text-red font-bold' : ''}>{r}</span>
                    <span className="text-muted"> vs </span>
                    <span className={f.winner_side === 'blue' ? 'text-blue font-bold' : ''}>{b}</span>
                  </span>
                  {f.status === 'cancelled'
                    ? <Pill>Cancelled</Pill>
                    : <Pill tone="gold">{f.method}</Pill>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ---------------- create ---------------- */

function CreateFight({ fighters, onCreated }: { fighters: Fighter[]; onCreated: () => void }) {
  const [red, setRed] = useState('')
  const [blue, setBlue] = useState('')
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [lock, setLock] = useState(defaultStart)
  const [lockTouched, setLockTouched] = useState(false)
  const [ok, setOk] = useState('')
  const act = useAction()

  const visible = fighters.filter(f => !f.hidden)

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setOk('')
    if (!red || !blue) return act.setError('Pick both corners.')
    if (red === blue) return act.setError('A fighter cannot fight themselves.')
    const s = fromLocalInput(start), l = fromLocalInput(lock)
    if (!s || !l) return act.setError('Set a valid fight time and lock time.')
    if (new Date(l) > new Date(s)) return act.setError('Picks should lock at or before the fight time.')
    const id = await act.run(async () => must(await supabase.rpc('admin_create_fight', {
      p_red: red, p_blue: blue, p_scheduled_at: s, p_lock_at: l, p_title: title.trim() || null,
    })))
    if (id) {
      setOk('Fight booked. Picks are open.')
      setRed(''); setBlue(''); setTitle('')
      onCreated()
    }
  }

  const sel = (corner: Side, value: string, set: (v: string) => void, other: string) => (
    <Field label={corner === 'red' ? 'Red corner' : 'Blue corner'}>
      <select value={value} onChange={e => set(e.target.value)}
        className={`${inputCls} border-l-4 ${corner === 'red' ? 'border-l-red' : 'border-l-blue'}`}>
        <option value="">Choose fighter…</option>
        {visible.map(f => <option key={f.id} value={f.id} disabled={f.id === other}>{f.nickname}</option>)}
      </select>
    </Field>
  )

  return (
    <Card>
      <SectionTitle>Book a fight</SectionTitle>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sel('red', red, setRed, blue)}
          {sel('blue', blue, setBlue, red)}
        </div>
        <Field label="Title (optional)">
          <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="Main event, Floor 3 grudge match…" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Fight time">
            <input type="datetime-local" className={inputCls} value={start} required
              onChange={e => { setStart(e.target.value); if (!lockTouched) setLock(e.target.value) }} />
          </Field>
          <Field label="Picks lock at" hint={lockTouched ? undefined : 'Defaults to fight time'}>
            <input type="datetime-local" className={inputCls} value={lock} required
              onChange={e => { setLock(e.target.value); setLockTouched(true) }} />
          </Field>
        </div>
        <ErrorBox error={act.error} />
        <OkBox>{ok}</OkBox>
        <Btn type="submit" variant="red" busy={act.busy} className="w-full min-h-12 font-display text-2xl tracking-widest">
          Book it
        </Btn>
      </form>
    </Card>
  )
}

/* ---------------- manage one fight ---------------- */

interface CardProps { fight: Fight; red?: Fighter; blue?: Fighter; pool?: FightPool; onChanged: () => void }

function FightAdminCard({ fight, red, blue, pool, onChanged }: CardProps) {
  const { profile } = useAuth()
  const [mode, setMode] = useState<'none' | 'settle' | 'cancel'>('none')
  const [winner, setWinner] = useState<Side | ''>('')
  const [method, setMethod] = useState<WinMethod | ''>('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<unknown>(null)
  const act = useAction()
  const [dialog, confirm] = useConfirm()

  const rName = red?.nickname ?? 'Red', bName = blue?.nickname ?? 'Blue'
  const isParticipant = !!profile?.fighter_id && [fight.red_fighter_id, fight.blue_fighter_id].includes(profile.fighter_id)
  const pastLock = new Date(fight.lock_at).getTime() <= Date.now()

  const lockNow = async () => {
    if (!(await confirm({ title: 'Lock picks?', body: <p>Votes and bets close for <b>{rName} vs {bName}</b>. This can't be reopened.</p>, confirmLabel: 'Lock' }))) return
    const r = await act.run(async () => { must(await supabase.rpc('admin_lock_fight', { p_fight_id: fight.id })); return true })
    if (r) onChanged()
  }

  const settle = async (e: FormEvent) => {
    e.preventDefault()
    if (!winner || !method) return act.setError('Pick the winner and the method.')
    const wName = winner === 'red' ? rName : bName
    const ok = await confirm({
      title: 'Record result?',
      confirmLabel: 'Record & pay out',
      variant: winner === 'red' ? 'red' : 'blue',
      body: (
        <>
          <p className="font-display text-2xl tracking-wide">
            <span className={winner === 'red' ? 'text-red' : 'text-blue'}>{wName}</span> wins by <span className="text-gold">{method}</span>
          </p>
          {note.trim() && <p className="text-muted">“{note.trim()}”</p>}
          {pool && (
            <p className="text-muted">
              Pool: <span className="text-red">{pool.red_total}</span> red ({pool.red_count}) · <span className="text-blue">{pool.blue_total}</span> blue ({pool.blue_count}) points
            </p>
          )}
          <p>This updates W-L, streaks and Elo and pays out points. <b>It can't be undone.</b></p>
        </>
      ),
    })
    if (!ok) return
    const res = await act.run(async () => must(await supabase.rpc('admin_settle_fight', {
      p_fight_id: fight.id, p_winner_side: winner, p_method: method, p_note: note.trim() || null,
    })))
    if (res !== undefined) { setResult(res ?? { ok: true }); setMode('none') }
  }

  const cancel = async (e: FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return act.setError('Give a reason so members know what happened.')
    if (!(await confirm({ title: 'Cancel fight?', body: <p>All active bets on <b>{rName} vs {bName}</b> get refunded. No record changes.</p>, confirmLabel: 'Cancel fight' }))) return
    const r = await act.run(async () => { must(await supabase.rpc('admin_cancel_fight', { p_fight_id: fight.id, p_reason: reason.trim() })); return true })
    if (r) onChanged()
  }

  if (result !== null) {
    return (
      <Card className="border-gold/50">
        <p className="font-display text-3xl tracking-wider text-gold mb-2">Result recorded</p>
        <pre className="max-h-72 overflow-auto rounded-lg bg-ink p-3 text-xs text-bone/90 whitespace-pre-wrap break-all">{JSON.stringify(result, null, 2)}</pre>
        <Btn variant="gold" className="w-full mt-3" onClick={() => { setResult(null); onChanged() }}>Done</Btn>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden p-0">
      {dialog}
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="text-xs text-muted truncate">{fight.title || 'Fight'} · {fmtDate(fight.scheduled_at)}</span>
        <Pill tone={fight.status === 'open' ? 'gold' : 'muted'}>{fight.status}</Pill>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3">
        <div className="flex flex-col items-center gap-1 text-center min-w-0">
          <FighterPhoto path={red?.photo_path} nickname={rName} corner="red" className="size-14" />
          <span className="font-display text-xl tracking-wide text-red truncate max-w-full">{rName}</span>
          {pool && <span className="text-xs text-muted">{pool.red_total} pts · {pool.red_count}</span>}
        </div>
        <span className="font-display text-3xl text-gold">VS</span>
        <div className="flex flex-col items-center gap-1 text-center min-w-0">
          <FighterPhoto path={blue?.photo_path} nickname={bName} corner="blue" className="size-14" />
          <span className="font-display text-xl tracking-wide text-blue truncate max-w-full">{bName}</span>
          {pool && <span className="text-xs text-muted">{pool.blue_total} pts · {pool.blue_count}</span>}
        </div>
      </div>
      <p className="px-4 text-xs text-muted">
        Picks lock {fmtDate(fight.lock_at)}{fight.status === 'open' && pastLock && ' (past — auto-lock pending)'}
      </p>

      <div className="p-4 space-y-3">
        {isParticipant && (
          <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
            You're linked to a fighter in this bout — another admin must record the result.
          </p>
        )}
        <ErrorBox error={act.error} />

        {mode === 'none' && (
          <div className="grid grid-cols-3 gap-2">
            <Btn onClick={lockNow} disabled={fight.status !== 'open'} busy={act.busy}>Lock</Btn>
            <Btn variant="gold" onClick={() => { act.setError(null); setMode('settle') }} disabled={isParticipant}>Settle</Btn>
            <Btn variant="danger" onClick={() => { act.setError(null); setMode('cancel') }}>Cancel</Btn>
          </div>
        )}

        {mode === 'settle' && (
          <form onSubmit={settle} className="space-y-3">
            <Field label="Winner">
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
            <Field label="Method">
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
            <Field label="Note (optional)">
              <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="Armbar at 2:10" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => setMode('none')}>Back</Btn>
              <Btn type="submit" variant="gold" busy={act.busy}>Record result</Btn>
            </div>
          </form>
        )}

        {mode === 'cancel' && (
          <form onSubmit={cancel} className="space-y-3">
            <Field label="Reason">
              <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="Injury, RA walked in…" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => setMode('none')}>Back</Btn>
              <Btn type="submit" variant="danger" busy={act.busy}>Cancel fight</Btn>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}
