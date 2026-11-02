import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Invite } from '../../lib/types'
import {
  Btn, Card, Empty, ErrorBox, Field, OkBox, Pill, SectionTitle,
  copyText, fmtDate, fromLocalInput, inputCls, must, toLocalInput, useAction, useConfirm,
} from '../../components/admin/ui'

const joinLink = (code: string) => `${location.origin}/join?code=${encodeURIComponent(code)}`

const EXPIRY = [
  { v: 'none', label: 'Never' },
  { v: '24', label: '24 hours' },
  { v: '168', label: '7 days' },
  { v: '720', label: '30 days' },
  { v: 'custom', label: 'Custom…' },
]

function inviteState(i: Invite): { label: string; tone: 'gold' | 'muted' | 'red' } {
  if (i.revoked) return { label: 'Revoked', tone: 'red' }
  if (i.expires_at && new Date(i.expires_at) <= new Date()) return { label: 'Expired', tone: 'muted' }
  if (i.uses >= i.max_uses) return { label: 'Used up', tone: 'muted' }
  return { label: 'Active', tone: 'gold' }
}

export default function AdminInvites() {
  const [list, setList] = useState<Invite[]>([])
  const [flash, setFlash] = useState('')
  const load = useAction()
  const loadRun = load.run

  const refresh = useCallback(() => loadRun(async () => {
    setList(must(await supabase.from('invites').select('*').order('created_at', { ascending: false })) as Invite[])
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(f => (f === m ? '' : f)), 2500) }

  return (
    <div className="space-y-6">
      <CreateInvite onCreated={async code => { await refresh(); say(`Invite ${code} created.`) }} />
      <div>
        <SectionTitle>Invite codes</SectionTitle>
        <ErrorBox error={load.error} />
        <div className="sticky top-16 z-10 mb-2"><OkBox>{flash}</OkBox></div>
        {!load.busy && list.length === 0 && <Empty>No invites yet.</Empty>}
        <ul className="space-y-3">
          {list.map(i => <InviteRow key={i.code} invite={i} onChanged={refresh} say={say} />)}
        </ul>
      </div>
    </div>
  )
}

function CreateInvite({ onCreated }: { onCreated: (code: string) => void }) {
  const [maxUses, setMaxUses] = useState('5')
  const [expiry, setExpiry] = useState('168')
  const [custom, setCustom] = useState(() => toLocalInput(new Date(Date.now() + 7 * 86400_000)))
  const act = useAction()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = Number(maxUses)
    if (!Number.isInteger(n) || n < 1 || n > 1000) return act.setError('Max uses: a whole number from 1 to 1000.')
    let exp: string | null = null
    if (expiry === 'custom') {
      exp = fromLocalInput(custom)
      if (!exp || new Date(exp) <= new Date()) return act.setError('Pick an expiry in the future.')
    } else if (expiry !== 'none') exp = new Date(Date.now() + Number(expiry) * 3600_000).toISOString()
    const code = await act.run(async () => must(await supabase.rpc('admin_create_invite', { p_max_uses: n, p_expires_at: exp })) as string)
    if (code) onCreated(code)
  }

  return (
    <Card>
      <SectionTitle>New invite</SectionTitle>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max uses">
            <input className={inputCls} inputMode="numeric" value={maxUses} onChange={e => setMaxUses(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Expires">
            <select className={inputCls} value={expiry} onChange={e => setExpiry(e.target.value)}>
              {EXPIRY.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        {expiry === 'custom' && (
          <Field label="Expires at">
            <input type="datetime-local" className={inputCls} value={custom} onChange={e => setCustom(e.target.value)} />
          </Field>
        )}
        <ErrorBox error={act.error} />
        <Btn type="submit" variant="gold" busy={act.busy} className="w-full min-h-12 font-display text-2xl tracking-widest">Create invite</Btn>
      </form>
    </Card>
  )
}

function InviteRow({ invite: i, onChanged, say }: { invite: Invite; onChanged: () => void; say: (m: string) => void }) {
  const act = useAction()
  const [dialog, confirm] = useConfirm()
  const st = inviteState(i)
  const usable = st.label === 'Active'
  const link = joinLink(i.code)

  const copy = async () => say((await copyText(link)) ? 'Join link copied.' : 'Copy failed — long-press the code instead.')
  const share = async () => {
    const data = { title: 'UoS Fight Night', text: `You're invited to UoS Fight Night. Invite code: ${i.code}`, url: link }
    if (navigator.share) {
      try { await navigator.share(data); return }
      catch (e) { if ((e as DOMException)?.name === 'AbortError') return }
    }
    await copy()
  }
  const revoke = async () => {
    if (!(await confirm({ title: 'Revoke invite?', body: <p>Code <b className="font-mono">{i.code}</b> will stop working immediately. Existing members keep access.</p>, confirmLabel: 'Revoke' }))) return
    const r = await act.run(async () => { must(await supabase.rpc('admin_revoke_invite', { p_code: i.code })); return true })
    if (r) onChanged()
  }

  return (
    <li className={`rounded-xl border border-line bg-surface p-3 ${usable ? '' : 'opacity-60'}`}>
      {dialog}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-2xl font-bold tracking-[0.2em] text-bone select-all">{i.code}</span>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
      <p className="mt-1 text-xs text-muted">
        {i.uses}/{i.max_uses} used · {i.expires_at ? `expires ${fmtDate(i.expires_at)}` : 'no expiry'} · made {fmtDate(i.created_at)}
      </p>
      <ErrorBox error={act.error} />
      {usable && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Btn onClick={copy} className="text-sm px-2">Copy link</Btn>
          <Btn variant="gold" onClick={share} className="text-sm px-2">Share</Btn>
          <Btn variant="danger" onClick={revoke} busy={act.busy} className="text-sm px-2">Revoke</Btn>
        </div>
      )}
    </li>
  )
}
