import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Balance, Fighter, Profile } from '../../lib/types'
import { Btn, Empty, ErrorBox, Field, OkBox, Pill, SectionTitle, copyText, inputCls, must, useAction, useConfirm } from '../../components/admin/ui'

/** 10-char password from an unambiguous alphabet, crypto-random. */
function generatePassword(len = 10): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const out: string[] = []
  const buf = new Uint32Array(len * 2)
  while (out.length < len) {
    crypto.getRandomValues(buf)
    for (const n of buf) {
      if (n < Math.floor(0x1_0000_0000 / abc.length) * abc.length) out.push(abc[n % abc.length])
      if (out.length === len) break
    }
  }
  return out.join('')
}

/** Pull a readable message out of a FunctionsHttpError response body. */
async function functionError(err: unknown): Promise<Error> {
  const ctx = (err as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json() as { error?: string; message?: string }
      if (body?.error || body?.message) return new Error(body.error ?? body.message)
    } catch { /* not json */ }
  }
  return err instanceof Error ? err : new Error(String(err))
}

export default function AdminMembers() {
  const [members, setMembers] = useState<Profile[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [q, setQ] = useState('')
  const load = useAction()
  const loadRun = load.run

  const refresh = useCallback(() => loadRun(async () => {
    const [p, b, f] = await Promise.all([
      supabase.from('profiles').select('*').order('username'),
      supabase.from('balances').select('*'),
      supabase.from('fighters').select('*').order('nickname'),
    ])
    setMembers(must(p) as Profile[])
    setBalances(Object.fromEntries((must(b) as Balance[]).map(x => [x.user_id, x.balance])))
    setFighters(must(f) as Fighter[])
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? members.filter(m => m.username.toLowerCase().includes(s) || (m.display_name ?? '').toLowerCase().includes(s)) : members
  }, [members, q])

  // fighter_id is unique across profiles: map fighter → who holds it
  const linkedBy = useMemo(() => Object.fromEntries(members.filter(m => m.fighter_id).map(m => [m.fighter_id!, m.id])), [members])

  return (
    <div>
      <SectionTitle>Members <span className="text-muted text-xl">({members.length})</span></SectionTitle>
      <input className={`${inputCls} mb-3`} type="search" placeholder="Search username…" value={q} onChange={e => setQ(e.target.value)} />
      <ErrorBox error={load.error} />
      {!load.busy && shown.length === 0 && <Empty>No members match.</Empty>}
      <ul className="space-y-2">
        {shown.map(m => (
          <MemberRow key={m.id} m={m} balance={balances[m.id] ?? 0} fighters={fighters} linkedBy={linkedBy} onChanged={refresh} />
        ))}
      </ul>
    </div>
  )
}

interface RowProps { m: Profile; balance: number; fighters: Fighter[]; linkedBy: Record<string, string>; onChanged: () => void }

function MemberRow({ m, balance, fighters, linkedBy, onChanged }: RowProps) {
  const { profile: me, refreshProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState(m.role)
  const [active, setActive] = useState(m.active)
  const [fighterId, setFighterId] = useState(m.fighter_id ?? '')
  const [newPw, setNewPw] = useState<string | null>(null)
  const [ok, setOk] = useState('')
  const act = useAction()
  const [dialog, confirm] = useConfirm()
  const isMe = me?.id === m.id
  const fighter = fighters.find(f => f.id === m.fighter_id)
  const dirty = role !== m.role || active !== m.active || (fighterId || null) !== m.fighter_id

  const save = async () => {
    setOk('')
    if (isMe && (role !== 'admin' || !active)) {
      if (!(await confirm({ title: 'Change your own access?', body: <p>You're about to {active ? 'drop your own admin role' : 'deactivate yourself'}. You'll lose this panel.</p>, confirmLabel: 'Do it' }))) return
    } else if (!active && m.active) {
      if (!(await confirm({ title: 'Deactivate member?', body: <p><b>@{m.username}</b> won't be able to use the app until reactivated.</p>, confirmLabel: 'Deactivate' }))) return
    } else if (role === 'admin' && m.role !== 'admin') {
      if (!(await confirm({ title: 'Make admin?', body: <p><b>@{m.username}</b> will be able to settle fights, adjust points and manage members.</p>, confirmLabel: 'Promote', variant: 'gold' }))) return
    }
    const r = await act.run(async () => {
      must(await supabase.rpc('admin_set_member', { p_user_id: m.id, p_active: active, p_role: role, p_fighter_id: fighterId || null }))
      return true
    })
    if (r) { setOk('Saved.'); onChanged(); if (isMe) void refreshProfile() }
  }

  const resetPw = async () => {
    if (!(await confirm({ title: 'Reset password?', body: <p>Generates a new password for <b>@{m.username}</b>. Their old password stops working. You'll see the new one once — send it to them privately.</p>, confirmLabel: 'Reset' }))) return
    const pw = generatePassword(10)
    const r = await act.run(async () => {
      const { error } = await supabase.functions.invoke('admin-reset-password', { body: { user_id: m.id, new_password: pw } })
      if (error) throw await functionError(error)
      return true
    })
    if (r) setNewPw(pw)
  }

  return (
    <li className="rounded-xl border border-line bg-surface">
      {dialog}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full min-h-14 items-center gap-3 px-3 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`font-semibold truncate ${m.active ? '' : 'line-through text-muted'}`}>@{m.username}</span>
            {m.role === 'admin' && <Pill tone="gold">Admin</Pill>}
            {!m.active && <Pill tone="red">Inactive</Pill>}
            {isMe && <Pill>You</Pill>}
          </span>
          <span className="block text-xs text-muted truncate">
            {fighter ? `Fighter: ${fighter.nickname}` : 'Not a fighter'}{m.display_name && ` · ${m.display_name}`}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-display text-2xl leading-none text-gold">{balance.toLocaleString()}</span>
          <span className="block text-[10px] uppercase tracking-wider text-muted">points</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select className={inputCls} value={role} onChange={e => setRole(e.target.value as Profile['role'])}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={active ? '1' : '0'} onChange={e => setActive(e.target.value === '1')}>
                <option value="1">Active</option>
                <option value="0">Deactivated</option>
              </select>
            </Field>
          </div>
          <Field label="Linked fighter" hint="Linked members can't bet on or record their own fights.">
            <select className={inputCls} value={fighterId} onChange={e => setFighterId(e.target.value)}>
              <option value="">— None —</option>
              {fighters.map(f => {
                const takenBy = linkedBy[f.id]
                const taken = !!takenBy && takenBy !== m.id
                return <option key={f.id} value={f.id} disabled={taken}>{f.nickname}{f.hidden ? ' (hidden)' : ''}{taken ? ' — linked' : ''}</option>
              })}
            </select>
          </Field>
          <ErrorBox error={act.error} />
          <OkBox>{ok}</OkBox>
          {newPw && (
            <div className="rounded-lg border border-gold/60 bg-gold/10 p-3">
              <p className="text-xs uppercase tracking-wider text-gold mb-1">New password — shown once</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all font-mono text-xl tracking-wider">{newPw}</code>
                <Btn variant="gold" onClick={async () => setOk((await copyText(newPw)) ? 'Password copied.' : 'Copy failed — select it manually.')}>Copy</Btn>
              </div>
              <Btn className="w-full mt-2 text-sm" onClick={() => setNewPw(null)}>I've sent it — hide</Btn>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="danger" onClick={resetPw} busy={act.busy}>Reset password</Btn>
            <Btn variant="gold" onClick={save} disabled={!dirty} busy={act.busy}>Save</Btn>
          </div>
        </div>
      )}
    </li>
  )
}
