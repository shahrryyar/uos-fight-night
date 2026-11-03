import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { USERNAME_RE, supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { fmtNum } from '../../lib/copy'
import type { Balance, Fighter, Profile } from '../../lib/types'
import MemberName from '../../components/MemberName'
import {
  ArrowCounterClockwise, Button, CaretDown, CaretRight, Copy, EmptyState, Field, Input, Loading, MagnifyingGlass, Paper,
  Seg, Select, Stamp, UserPlus, useToast,
} from '../../components/ui'
import {
  FieldGroup, FormError, LoadError, SectionHead, copyText, focusFirstInvalid, functionError, generatePassword, must, useAction, useConfirm,
} from '../../components/admin/ui'

const nameOf = (m: Pick<Profile, 'display_name' | 'username'>) => m.display_name?.trim() || m.username

/* C2: what each role can do (shown under the Role segs) */
const ROLE_HINT: Record<Profile['role'], string | undefined> = {
  member: undefined,
  referee: 'Referees run the live clock and score on locked bouts. They can’t record results or manage anything else.',
  admin: 'Admins can record results, change points and manage members.',
}
function RoleSegs({ role, setRole }: { role: Profile['role']; setRole: (r: Profile['role']) => void }) {
  return (
    <div className="segs">
      <Seg pressed={role === 'member'} onClick={() => setRole('member')}>Member</Seg>
      <Seg pressed={role === 'referee'} onClick={() => setRole('referee')}>Referee</Seg>
      <Seg pressed={role === 'admin'} onClick={() => setRole('admin')}>Admin</Seg>
    </div>
  )
}

export default function AdminMembers() {
  const [members, setMembers] = useState<Profile[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [loaded, setLoaded] = useState(false)
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
    setLoaded(true)
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? members.filter(m => m.username.toLowerCase().includes(s) || (m.display_name ?? '').toLowerCase().includes(s)) : members
  }, [members, q])

  // fighter_id is unique across profiles: map fighter → who holds it
  const linkedBy = useMemo(() => Object.fromEntries(members.filter(m => m.fighter_id).map(m => [m.fighter_id!, m.id])), [members])

  return (
    <>
      <section className="adm-section" aria-labelledby="new-acct-h">
        <SectionHead id="new-acct-h" title="New account" sub="There is no sign-up. Make the login here and send it privately." />
        <CreateAccount fighters={fighters} linkedBy={linkedBy} onCreated={refresh} />
      </section>
      <section className="adm-section" aria-labelledby="members-h">
        <SectionHead id="members-h" title="Members" count={loaded ? members.length : undefined} />
        <div className="field ink-field">
          <label className="field-label" htmlFor="member-q"><MagnifyingGlass /> Search</label>
          <Input id="member-q" type="search" name="q" autoComplete="off" spellCheck={false} autoCapitalize="none"
            value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <LoadError error={load.error} what="members" onRetry={() => void refresh()} busy={load.busy} />
        {!loaded && !load.error && <Loading label="Loading members…" shape="rows" />}
        {loaded && shown.length === 0 && <EmptyState title="Nobody matches" body={`No member has “${q.trim()}” in their name or username.`} />}
        <ul className="rows adm-rows" role="list" style={{ marginTop: 8 }}>
          {shown.map(m => (
            <MemberRow key={m.id} m={m} balance={balances[m.id] ?? 0}
              fighters={fighters} linkedBy={linkedBy} onChanged={refresh} />
          ))}
        </ul>
      </section>
    </>
  )
}

/* ---------------- shared bits ---------------- */

function FighterSelect({ value, onChange, fighters, linkedBy, selfId, id }:
  { value: string; onChange: (v: string) => void; fighters: Fighter[]; linkedBy: Record<string, string>; selfId?: string; id?: string }) {
  return (
    <Select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Not a fighter</option>
      {fighters.map(f => {
        const takenBy = linkedBy[f.id]
        const taken = !!takenBy && takenBy !== selfId
        return <option key={f.id} value={f.id} disabled={taken}>{f.nickname}{f.hidden ? ' (hidden)' : ''}{taken ? ' (linked)' : ''}</option>
      })}
    </Select>
  )
}

/** Label, the value in Courier, and a Copy button that confirms with a toast. */
function CopyRow({ label, value, what, mono = true }: { label: string; value: string; what: string; mono?: boolean }) {
  const toast = useToast()
  return (
    <div className="copy-row">
      <span className="field-label">{label}</span>
      <div className="val">
        {mono ? <code className="data-lg">{value}</code> : <p className="msg">{value}</p>}
        <Button variant="ink" size="sm" icon={Copy} aria-label={`Copy ${what.toLowerCase()}`}
          onClick={async () => toast((await copyText(value)) ? `${what} copied.` : 'Copy didn\'t work. Press and hold to select it.', { icon: Copy })}>
          Copy
        </Button>
      </div>
    </div>
  )
}

const loginMessage = (username: string, password: string) =>
  `Your UoS Fight Night login. Username: ${username}. Password: ${password}. Change the password in Me after you log in.`

/* ---------------- create account ---------------- */

interface Created { username: string; display_name: string; password: string }
type CErrs = Partial<Record<'username' | 'display' | 'password', string>>

function CreateAccount({ fighters, linkedBy, onCreated }: { fighters: Fighter[]; linkedBy: Record<string, string>; onCreated: () => void }) {
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState(() => generatePassword(10))
  const [role, setRole] = useState<Profile['role']>('member')
  const [fighterId, setFighterId] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [errs, setErrs] = useState<CErrs>({})
  const act = useAction()
  const [dialog, confirm] = useConfirm()

  const uname = username.trim().toLowerCase()
  const dname = displayName.trim()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const form = e.currentTarget as HTMLElement
    const next: CErrs = {}
    if (!USERNAME_RE.test(uname)) next.username = 'Use 3 to 20 lowercase letters, numbers or _.'
    if (dname.length < 1 || dname.length > 24) next.display = 'Use 1 to 24 characters.'
    if (password.length < 8) next.password = 'Use at least 8 characters, or press New.'
    setErrs(next)
    if (Object.values(next).some(Boolean)) { focusFirstInvalid(form); return }
    if (role === 'admin' && !(await confirm({
      title: 'Make an admin?', variant: 'ink', confirmLabel: 'Create admin',
      body: <p><b><bdi>{dname}</bdi></b> will be able to record results, change points and manage members.</p>,
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
      toast('Account created.')
      onCreated()
    }
  }

  if (created) {
    return (
      <Paper>
        <div className="ready" role="status">
          <Stamp tone="ink" size="sm" rot={-3} land stateKey={created.username}>Shown once</Stamp>
          <h3 className="t-head">Account ready</h3>
          <p className="t-help"><b><bdi>{created.display_name}</bdi></b> can log in now. Send this privately. The password won't show again.</p>
          <CopyRow label="Username" value={created.username} what="Username" />
          <CopyRow label="Temporary password" value={created.password} what="Password" />
          <CopyRow label="Message to send" value={loginMessage(created.username, created.password)} what="Message" mono={false} />
          <Button variant="ghost" onClick={() => setCreated(null)}>I've sent it, hide</Button>
        </div>
      </Paper>
    )
  }

  return (
    <Paper>
      {dialog}
      <form className="form form--flush" onSubmit={submit} noValidate aria-labelledby="new-acct-h">
        <Field label="Username" hint="Used to log in. 3 to 20 of a to z, 0 to 9 or _." error={errs.username}>
          <Input value={username} name="new_username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
            maxLength={20} onChange={e => { setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setErrs(x => ({ ...x, username: undefined })) }} />
        </Field>
        <Field label="Display name" hint="Shown on every screen. Only admins can change it." error={errs.display}>
          <Input value={displayName} name="display_name" maxLength={24} autoComplete="off"
            onChange={e => { setDisplayName(e.target.value); setErrs(x => ({ ...x, display: undefined })) }} />
        </Field>
        <Field label="Temporary password" hint="They can change it in Me after logging in." error={errs.password}>
          {a => (
            <div className="pw-row">
              <Input look="data" {...a} value={password} name="new_password" autoComplete="new-password" spellCheck={false} autoCapitalize="none"
                onChange={e => { setPassword(e.target.value); setErrs(x => ({ ...x, password: undefined })) }} minLength={8} />
              <Button variant="ghost" size="sm" icon={ArrowCounterClockwise} aria-label="Make a new password" onClick={() => setPassword(generatePassword(10))}>New</Button>
              <Button variant="ink" size="sm" icon={Copy} aria-label="Copy password"
                onClick={async () => toast((await copyText(password)) ? 'Password copied.' : 'Copy didn\'t work. Select it by hand.', { icon: Copy })}>Copy</Button>
            </div>
          )}
        </Field>
        <FieldGroup label="Role" hint={ROLE_HINT[role]}>
          <RoleSegs role={role} setRole={setRole} />
        </FieldGroup>
        <Field label={<>Fighter <span className="opt">(optional)</span></>} hint="Link them if they wrestle, so they can say yes to their own bouts.">
          {a => <FighterSelect id={a.id} value={fighterId} onChange={setFighterId} fighters={fighters} linkedBy={linkedBy} />}
        </Field>
        <FormError error={act.error} />
        <Button type="submit" icon={UserPlus} busy={act.busy} busyLabel="Creating">Create account</Button>
      </form>
    </Paper>
  )
}

/* ---------------- one member ---------------- */

interface RowProps { m: Profile; balance: number; fighters: Fighter[]; linkedBy: Record<string, string>; onChanged: () => void }

function MemberRow({ m, balance, fighters, linkedBy, onChanged }: RowProps) {
  const { profile: me, refreshProfile } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState(m.display_name ?? '')
  const [role, setRole] = useState(m.role)
  const [active, setActive] = useState(m.active)
  const [fighterId, setFighterId] = useState(m.fighter_id ?? '')
  const [newPw, setNewPw] = useState<string | null>(null)
  const [nameErr, setNameErr] = useState<string | undefined>()
  const act = useAction()
  const [dialog, confirm] = useConfirm()
  const isMe = me?.id === m.id
  const fighter = fighters.find(f => f.id === m.fighter_id)
  const name = nameOf(m)
  const dname = displayName.trim()
  const dirty = dname !== (m.display_name ?? '') || role !== m.role || active !== m.active || (fighterId || null) !== m.fighter_id
  const pid = `mem-${m.id}`

  const save = async () => {
    if (dname.length < 1 || dname.length > 24) { setNameErr('Use 1 to 24 characters.'); document.getElementById(`${pid}-name`)?.focus(); return }
    if (isMe && (role !== 'admin' || !active)) {
      if (!(await confirm({ title: 'Change your own access?', body: <p>You're about to {active ? 'drop your own admin role' : 'switch off your own account'}. You'll lose this panel.</p>, confirmLabel: 'Do it' }))) return
    } else if (!active && m.active) {
      if (!(await confirm({ title: 'Switch off this account?', body: <p><b><bdi>{name}</bdi></b> can't use the app until an admin switches it back on. Their points and picks stay.</p>, confirmLabel: 'Switch off' }))) return
    } else if (role === 'admin' && m.role !== 'admin') {
      if (!(await confirm({ title: 'Make admin?', body: <p><b><bdi>{name}</bdi></b> will be able to record results, change points and manage members.</p>, confirmLabel: 'Make admin', variant: 'ink' }))) return
    }
    const r = await act.run(async () => {
      // p_fighter_id is always applied: send the current link (or null) when unchanged.
      must(await supabase.rpc('admin_set_member', {
        p_user_id: m.id, p_active: active, p_role: role, p_fighter_id: fighterId || null, p_display_name: dname,
      }))
      return true
    })
    if (r) { toast('Saved.'); onChanged(); if (isMe) void refreshProfile() }
  }

  const resetPw = async () => {
    if (!(await confirm({
      title: 'Reset password?', confirmLabel: 'Reset password',
      body: <><p>Makes a new password for <b><bdi>{name}</bdi></b> (@{m.username}). Their old one stops working right away.</p><p>You'll see the new one once. Send it privately.</p></>,
    }))) return
    const pw = generatePassword(10)
    const r = await act.run(async () => {
      const { error } = await supabase.functions.invoke('admin-reset-password', { body: { user_id: m.id, new_password: pw } })
      if (error) throw await functionError(error)
      return true
    })
    if (r) { setNewPw(pw); toast('Password reset.') }
  }

  return (
    <li>
      {dialog}
      <button type="button" className="adm-row" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={pid}>
        {open ? <CaretDown className="chev" /> : <CaretRight className="chev" />}
        <span style={{ minWidth: 0 }}>
          <span className="t-sub"><MemberName userId={m.id} name={name} /></span>
          <span className="meta">
            <span className="data nowrap">@{m.username}</span>
            {fighter && <span className="t-help">Fighter: <bdi>{fighter.nickname}</bdi></span>}
            {m.role === 'admin' && <Stamp tone="bone" size="sm" rot={-2}>Admin</Stamp>}
            {m.role === 'referee' && <Stamp tone="bone" size="sm" rot={-2}>Referee</Stamp>}
            {!m.active && <Stamp tone="bone" size="sm" rot={2}>Switched off</Stamp>}
            {isMe && <Stamp tone="bone" size="sm" rot={-1}>You</Stamp>}
          </span>
        </span>
        <span className="end">
          <span className="data-lg">{balance < 0 ? '−' : ''}{fmtNum(Math.abs(balance))}</span>
          <span className="label">pts</span>
        </span>
      </button>

      {open && (
        <Paper id={pid} className="row-panel">
          <div className="form form--flush">
            <Field label="Display name" hint={<>Login username: @{m.username}. That can't change.</>} error={nameErr} id={`${pid}-name`}>
              <Input value={displayName} maxLength={24} name="display_name" autoComplete="off"
                onChange={e => { setDisplayName(e.target.value); setNameErr(undefined) }} />
            </Field>
            <FieldGroup label="Role" hint={role !== m.role ? ROLE_HINT[role] : undefined}>
              <RoleSegs role={role} setRole={setRole} />
            </FieldGroup>
            <FieldGroup label="Account" hint={active ? undefined : 'Switched-off members can\'t log in. Points and picks stay.'}>
              <div className="segs">
                <Seg pressed={active} onClick={() => setActive(true)}>On</Seg>
                <Seg pressed={!active} onClick={() => setActive(false)}>Switched off</Seg>
              </div>
            </FieldGroup>
            <Field label="Linked fighter" hint="Linked members say yes to their own bouts, and can't pick or record them.">
              {a => <FighterSelect id={a.id} value={fighterId} onChange={setFighterId} fighters={fighters} linkedBy={linkedBy} selfId={m.id} />}
            </Field>
            <FormError error={act.error} />
            <Button variant="ink" onClick={save} disabled={!dirty} busy={act.busy} busyLabel="Saving">{dirty ? 'Save changes' : 'No changes'}</Button>

            <div className="field" style={{ paddingTop: 14, borderTop: 'var(--rule-heavy) solid var(--color-toner)' }}>
              <span className="field-label">Password</span>
              {newPw ? (
                <div className="ready">
                  <CopyRow label="New password, shown once" value={newPw} what="Password" />
                  <CopyRow label="Message to send" value={loginMessage(m.username, newPw)} what="Message" mono={false} />
                  <Button variant="ghost" size="sm" onClick={() => setNewPw(null)}>I've sent it, hide</Button>
                </div>
              ) : (
                <>
                  <p className="field-hint">Forgot it? Make a new one and send it privately.</p>
                  <Button variant="danger" onClick={resetPw} busy={act.busy} busyLabel="Resetting">Reset password</Button>
                </>
              )}
            </div>
          </div>
        </Paper>
      )}
    </li>
  )
}
