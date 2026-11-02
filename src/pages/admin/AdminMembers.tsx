import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { USERNAME_RE, supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Balance, Fighter, Profile } from '../../lib/types'
import {
  Btn, Card, Empty, ErrorBox, Field, OkBox, Pill, SectionTitle,
  copyText, functionError, generatePassword, inputCls, must, useAction, useConfirm,
} from '../../components/admin/ui'

const nameOf = (m: Pick<Profile, 'display_name' | 'username'>) => m.display_name?.trim() || m.username

export default function AdminMembers() {
  const [members, setMembers] = useState<Profile[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [q, setQ] = useState('')
  const load = useAction()
  const loadRun = load.run

  const refresh = useCallback(() => loadRun(async () => {
    const [p, b, f] = await Promise.all([
      supabase.from('profiles').select('*').order('display_name'),
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
    <div className="space-y-6">
      <CreateAccount fighters={fighters} linkedBy={linkedBy} onCreated={refresh} />
      <div>
        <SectionTitle>Members <span className="text-muted text-xl">({members.length})</span></SectionTitle>
        <input className={`${inputCls} mb-3`} type="search" placeholder="Search name or username…" value={q} onChange={e => setQ(e.target.value)} />
        <ErrorBox error={load.error} />
        {!load.busy && shown.length === 0 && <Empty>No members match.</Empty>}
        <ul className="space-y-2">
          {shown.map(m => (
            <MemberRow key={m.id} m={m} balance={balances[m.id] ?? 0}
              fighters={fighters} linkedBy={linkedBy} onChanged={refresh} />
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ---------------- shared bits ---------------- */

function FighterSelect({ value, onChange, fighters, linkedBy, selfId }:
  { value: string; onChange: (v: string) => void; fighters: Fighter[]; linkedBy: Record<string, string>; selfId?: string }) {
  return (
    <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— None —</option>
      {fighters.map(f => {
        const takenBy = linkedBy[f.id]
        const taken = !!takenBy && takenBy !== selfId
        return <option key={f.id} value={f.id} disabled={taken}>{f.nickname}{f.hidden ? ' (hidden)' : ''}{taken ? ' — linked' : ''}</option>
      })}
    </select>
  )
}

function CopyRow({ label, value, mono = true, onCopied }: { label: string; value: string; mono?: boolean; onCopied: (ok: boolean) => void }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gold/80 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className={`min-w-0 flex-1 select-all break-all ${mono ? 'font-mono text-xl tracking-wider' : 'text-sm text-bone/90'}`}>{value}</code>
        <Btn variant="gold" className="shrink-0" onClick={async () => onCopied(await copyText(value))}>Copy</Btn>
      </div>
    </div>
  )
}

const loginMessage = (username: string, password: string) =>
  `Your UoS Fight Night login: username ${username} password ${password} — change it in Me`

/* ---------------- create account ---------------- */

interface Created { username: string; display_name: string; password: string }

function CreateAccount({ fighters, linkedBy, onCreated }: { fighters: Fighter[]; linkedBy: Record<string, string>; onCreated: () => void }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState(() => generatePassword(10))
  const [role, setRole] = useState<Profile['role']>('member')
  const [fighterId, setFighterId] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [ok, setOk] = useState('')
  const act = useAction()
  const [dialog, confirm] = useConfirm()

  const uname = username.trim().toLowerCase()
  const dname = displayName.trim()

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setOk('')
    if (!USERNAME_RE.test(uname)) return act.setError('Username: 3–20 characters, lowercase letters, numbers or _.')
    if (dname.length < 1 || dname.length > 24) return act.setError('Display name: 1–24 characters.')
    if (password.length < 8) return act.setError('Password must be at least 8 characters.')
    if (role === 'admin' && !(await confirm({
      title: 'Create an admin?', variant: 'gold', confirmLabel: 'Create admin',
      body: <p><b>{dname}</b> will be able to settle fights, adjust points and manage members.</p>,
    }))) return
    const res = await act.run(async () => {
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { username: uname, display_name: dname, password, role, fighter_id: fighterId || null },
      })
      if (error) throw await functionError(error)
      const d = data as { user_id?: string; username?: string; error?: string } | null
      if (d?.error) throw new Error(d.error)
      return d ?? {}
    })
    if (res) {
      setCreated({ username: res.username ?? uname, display_name: dname, password })
      setUsername(''); setDisplayName(''); setRole('member'); setFighterId(''); setPassword(generatePassword(10))
      onCreated()
    }
  }

  const copied = (what: string) => (good: boolean) => setOk(good ? `${what} copied.` : 'Copy failed — select it manually.')

  return (
    <Card>
      {dialog}
      <SectionTitle>Create account</SectionTitle>
      {created ? (
        <div className="rounded-lg border border-gold/60 bg-gold/10 p-3 space-y-3">
          <p className="font-display text-2xl tracking-wider text-gold leading-none">Account ready — shown once</p>
          <p className="text-sm text-bone/90"><b>{created.display_name}</b> can log in now. Send these privately; the password won't be shown again.</p>
          <CopyRow label="Username" value={created.username} onCopied={copied('Username')} />
          <CopyRow label="Temp password" value={created.password} onCopied={copied('Password')} />
          <CopyRow label="Message for the group chat" value={loginMessage(created.username, created.password)} mono={false} onCopied={copied('Message')} />
          <OkBox>{ok}</OkBox>
          <Btn className="w-full" onClick={() => { setCreated(null); setOk('') }}>I've sent it — hide</Btn>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Username" hint="Used to log in. 3–20: a–z, 0–9, _">
              <input className={inputCls} value={username} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
                maxLength={20} placeholder="ali_k" onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
            </Field>
            <Field label="Display name" hint="Shown on every screen. Members can't change it.">
              <input className={inputCls} value={displayName} maxLength={24} autoComplete="off" placeholder="Ali K." onChange={e => setDisplayName(e.target.value)} />
            </Field>
          </div>
          <Field label="Temp password" hint="They can change it in Me after logging in.">
            <div className="flex gap-2">
              <input className={`${inputCls} font-mono tracking-wider`} value={password} autoComplete="new-password" spellCheck={false}
                onChange={e => setPassword(e.target.value)} minLength={8} />
              <Btn className="shrink-0" aria-label="Generate new password" onClick={() => setPassword(generatePassword(10))}>New</Btn>
              <Btn className="shrink-0" onClick={async () => copied('Password')(await copyText(password))}>Copy</Btn>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select className={inputCls} value={role} onChange={e => setRole(e.target.value as Profile['role'])}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Link fighter">
              <FighterSelect value={fighterId} onChange={setFighterId} fighters={fighters} linkedBy={linkedBy} />
            </Field>
          </div>
          <ErrorBox error={act.error} />
          <OkBox>{ok}</OkBox>
          <Btn type="submit" variant="gold" busy={act.busy} className="w-full min-h-12 font-display text-2xl tracking-widest">
            Create account
          </Btn>
        </form>
      )}
    </Card>
  )
}

/* ---------------- one member ---------------- */

interface RowProps { m: Profile; balance: number; fighters: Fighter[]; linkedBy: Record<string, string>; onChanged: () => void }

function MemberRow({ m, balance, fighters, linkedBy, onChanged }: RowProps) {
  const { profile: me, refreshProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState(m.display_name ?? '')
  const [role, setRole] = useState(m.role)
  const [active, setActive] = useState(m.active)
  const [fighterId, setFighterId] = useState(m.fighter_id ?? '')
  const [newPw, setNewPw] = useState<string | null>(null)
  const [ok, setOk] = useState('')
  const act = useAction()
  const [dialog, confirm] = useConfirm()
  const isMe = me?.id === m.id
  const fighter = fighters.find(f => f.id === m.fighter_id)
  const name = nameOf(m)
  const dname = displayName.trim()
  const dirty = dname !== (m.display_name ?? '') || role !== m.role || active !== m.active || (fighterId || null) !== m.fighter_id

  const save = async () => {
    setOk('')
    if (dname.length < 1 || dname.length > 24) return act.setError('Display name: 1–24 characters.')
    if (isMe && (role !== 'admin' || !active)) {
      if (!(await confirm({ title: 'Change your own access?', body: <p>You're about to {active ? 'drop your own admin role' : 'deactivate yourself'}. You'll lose this panel.</p>, confirmLabel: 'Do it' }))) return
    } else if (!active && m.active) {
      if (!(await confirm({ title: 'Deactivate member?', body: <p><b>{name}</b> won't be able to use the app until reactivated.</p>, confirmLabel: 'Deactivate' }))) return
    } else if (role === 'admin' && m.role !== 'admin') {
      if (!(await confirm({ title: 'Make admin?', body: <p><b>{name}</b> will be able to settle fights, adjust points and manage members.</p>, confirmLabel: 'Promote', variant: 'gold' }))) return
    }
    const r = await act.run(async () => {
      // p_fighter_id is always applied: send the current link (or null) when unchanged.
      must(await supabase.rpc('admin_set_member', {
        p_user_id: m.id, p_active: active, p_role: role, p_fighter_id: fighterId || null, p_display_name: dname,
      }))
      return true
    })
    if (r) { setOk('Saved.'); onChanged(); if (isMe) void refreshProfile() }
  }

  const resetPw = async () => {
    if (!(await confirm({ title: 'Reset password?', body: <p>Generates a new password for <b>{name}</b> (@{m.username}). Their old password stops working. You'll see the new one once — send it to them privately.</p>, confirmLabel: 'Reset' }))) return
    const pw = generatePassword(10)
    const r = await act.run(async () => {
      const { error } = await supabase.functions.invoke('admin-reset-password', { body: { user_id: m.id, new_password: pw } })
      if (error) throw await functionError(error)
      return true
    })
    if (r) setNewPw(pw)
  }

  const copied = (what: string) => (good: boolean) => setOk(good ? `${what} copied.` : 'Copy failed — select it manually.')

  return (
    <li className="rounded-xl border border-line bg-surface">
      {dialog}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full min-h-14 items-center gap-3 px-3 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`font-semibold truncate ${m.active ? '' : 'line-through text-muted'}`}>{name}</span>
            {m.role === 'admin' && <Pill tone="gold">Admin</Pill>}
            {!m.active && <Pill tone="red">Inactive</Pill>}
            {isMe && <Pill>You</Pill>}
          </span>
          <span className="block text-xs text-muted truncate">
            @{m.username} · {fighter ? `Fighter: ${fighter.nickname}` : 'Not a fighter'}
          </span>
        </span>
        <span className="text-right">
          <span className={`block font-display text-2xl leading-none ${balance < 0 ? 'text-red' : 'text-gold'}`}>{balance.toLocaleString()}</span>
          <span className="block text-[10px] uppercase tracking-wider text-muted">points</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line p-3 space-y-3">
          <Field label="Display name" hint={`Login username: @${m.username} (can't change)`}>
            <input className={inputCls} value={displayName} maxLength={24} onChange={e => setDisplayName(e.target.value)} />
          </Field>
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
          <Field label="Linked fighter" hint="Linked members accept their own bouts and can't bet on or record them.">
            <FighterSelect value={fighterId} onChange={setFighterId} fighters={fighters} linkedBy={linkedBy} selfId={m.id} />
          </Field>
          <ErrorBox error={act.error} />
          <OkBox>{ok}</OkBox>
          {newPw && (
            <div className="rounded-lg border border-gold/60 bg-gold/10 p-3 space-y-3">
              <p className="text-xs uppercase tracking-wider text-gold">New password — shown once</p>
              <CopyRow label="Password" value={newPw} onCopied={copied('Password')} />
              <CopyRow label="Message for the group chat" value={loginMessage(m.username, newPw)} mono={false} onCopied={copied('Message')} />
              <Btn className="w-full text-sm" onClick={() => setNewPw(null)}>I've sent it — hide</Btn>
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
