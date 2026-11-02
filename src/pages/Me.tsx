import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { displayName, fmtDate, must, useAsync, useBalance, useFightersMap } from '../lib/hooks'
import type { Bet, Fight, LedgerRow } from '../lib/types'
import { Card, Empty, ErrorBox, Loading, NO_CASH, Tabs } from '../components/member/ui'

const REASON: Record<string, string> = {
  signup: 'Welcome bonus',
  weekly: 'Weekly bonus',
  topup: 'Top-up (low balance)',
  bet: 'Points pick placed',
  bet_cancel: 'Pick cancelled',
  payout: 'Pick won',
  refund: 'Refund',
  payout_reversal: 'Result corrected — payout reversed',
  admin_adjust: 'Admin adjustment',
}

const BET_STATUS: Record<Bet['status'], { label: string; cls: string }> = {
  active: { label: 'Live', cls: 'text-gold border-gold/50' },
  won: { label: 'Won', cls: 'text-gold border-gold/50' },
  lost: { label: 'Lost', cls: 'text-muted border-line' },
  refunded: { label: 'Refunded', cls: 'text-muted border-line' },
  cancelled: { label: 'Cancelled', cls: 'text-muted border-line' },
}

type Tab = 'bets' | 'ledger' | 'account'

export default function Me() {
  const { profile } = useAuth()
  const { balance, error: balErr } = useBalance()
  const [tab, setTab] = useState<Tab>('bets')

  return (
    <div>
      <Card className="relative mb-4 overflow-hidden p-5 text-center">
        <div className="absolute inset-0 bg-linear-to-br from-gold/15 via-transparent to-transparent" aria-hidden />
        <div className="relative">
          <p className="font-display text-3xl leading-none tracking-wide">{displayName(profile, '…')}</p>
          <p className="mt-0.5 text-xs text-muted">
            Login: {profile?.username}{profile?.role === 'admin' && <span className="ml-1 text-gold">· admin</span>}
          </p>
          <p className="mt-3 font-display text-6xl leading-none tracking-wide text-gold tabular-nums">
            {balance == null ? '…' : balance.toLocaleString()}
          </p>
          <p className="text-[11px] uppercase tracking-widest text-muted">{NO_CASH}</p>
          {balErr && <p className="mt-2 text-xs text-red">{balErr}</p>}
        </div>
      </Card>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'bets', label: 'Picks' }, { id: 'ledger', label: 'Ledger' }, { id: 'account', label: 'Account' }]} />
      {tab === 'bets' && <MyBets />}
      {tab === 'ledger' && <Ledger />}
      {tab === 'account' && <Account />}
    </div>
  )
}

function MyBets() {
  const { profile } = useAuth()
  const st = useAsync(async () => {
    const bets = must(await supabase.from('bets').select('*').eq('user_id', profile?.id ?? '')
      .order('created_at', { ascending: false }).limit(200)) as Bet[]
    const ids = [...new Set(bets.map(b => b.fight_id))]
    const fights = ids.length ? must(await supabase.from('fights').select('*').in('id', ids)) as Fight[] : []
    return { bets, fights: new Map(fights.map(f => [f.id, f])) }
  }, [profile?.id])
  const fighters = useFightersMap([...(st.data?.fights.values() ?? [])].flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))

  if (st.loading) return <Loading />
  if (st.error) return <ErrorBox error={st.error} onRetry={() => void st.reload()} />
  const bets = st.data?.bets ?? []
  const active = bets.filter(b => b.status === 'active')
  const past = bets.filter(b => b.status !== 'active')

  const item = (b: Bet) => {
    const f = st.data?.fights.get(b.fight_id)
    const red = f && fighters.data?.get(f.red_fighter_id)?.nickname
    const blue = f && fighters.data?.get(f.blue_fighter_id)?.nickname
    const pick = b.side === 'red' ? red : blue
    const s = BET_STATUS[b.status]
    return (
      <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
        <span className={`size-2.5 shrink-0 rounded-full ${b.side === 'red' ? 'bg-red' : 'bg-blue'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{pick ?? (b.side === 'red' ? 'Red' : 'Blue')} <span className="text-muted font-normal">· {red ?? '…'} vs {blue ?? '…'}</span></p>
          <p className="text-xs text-muted">{fmtDate(b.created_at)}</p>
        </div>
        <div className="text-right">
          <p className="tabular-nums text-sm font-semibold">{b.status === 'won' ? `+${b.payout ?? 0}` : b.amount}</p>
          <span className={`inline-block rounded border px-1.5 text-[10px] font-bold uppercase ${s.cls}`}>{s.label}</span>
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-widest text-muted">Active ({active.length})</p>
        {active.length ? <ul className="divide-y divide-line rounded-2xl border border-gold/30 bg-surface">{active.map(item)}</ul>
          : <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">No live picks. Head to Tonight to back a fighter.</p>}
      </div>
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-widest text-muted">History</p>
        {past.length ? <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">{past.map(item)}</ul>
          : <Empty>No past picks yet.</Empty>}
      </div>
    </div>
  )
}

function Ledger() {
  const { profile } = useAuth()
  const st = useAsync(async () =>
    must(await supabase.from('points_ledger').select('*').eq('user_id', profile?.id ?? '')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(300)) as LedgerRow[], [profile?.id])
  if (st.loading) return <Loading />
  if (st.error) return <ErrorBox error={st.error} onRetry={() => void st.reload()} />
  if (!st.data?.length) return <Empty>No point movements yet.</Empty>
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {st.data.map(r => (
        <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{REASON[r.reason] ?? r.reason}</p>
            <p className="truncate text-xs text-muted">{fmtDate(r.created_at)}{r.note ? ` · ${r.note}` : ''}</p>
          </div>
          <span className={`tabular-nums font-display text-2xl leading-none ${r.delta >= 0 ? 'text-gold' : 'text-muted'}`}>
            {r.delta >= 0 ? '+' : '−'}{Math.abs(r.delta)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Account() {
  const { signOut } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) return setMsg({ ok: false, text: 'Password must be at least 8 characters.' })
    if (pw !== pw2) return setMsg({ ok: false, text: "Passwords don't match." })
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setMsg({ ok: false, text: friendlyError(error) })
    else { setMsg({ ok: true, text: 'Password updated.' }); setPw(''); setPw2('') }
  }

  const input = 'min-h-11 w-full rounded-lg border border-line bg-ink px-3 text-bone placeholder:text-muted'
  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-line bg-surface p-3 text-xs text-muted">
        Your display name and login are set by an admin. Ask one if something needs changing.
      </p>
      <Card className="p-4">
        <h2 className="font-display text-2xl tracking-wider">Change password</h2>
        <form onSubmit={submit} className="mt-2 space-y-2">
          <input type="password" autoComplete="new-password" placeholder="New password (8+ chars)" value={pw}
            onChange={e => setPw(e.target.value)} className={input} aria-label="New password" />
          <input type="password" autoComplete="new-password" placeholder="Repeat new password" value={pw2}
            onChange={e => setPw2(e.target.value)} className={input} aria-label="Repeat new password" />
          <button disabled={busy} className="min-h-11 w-full rounded-lg bg-red font-display text-xl tracking-wider disabled:opacity-50">
            {busy ? 'Saving…' : 'Update password'}
          </button>
          {msg && <p className={`text-sm ${msg.ok ? 'text-gold' : 'text-red'}`} role="status">{msg.text}</p>}
        </form>
      </Card>
      <button onClick={() => void signOut()} className="min-h-12 w-full rounded-xl border border-line font-display text-xl tracking-wider text-muted">
        Sign out
      </button>
    </div>
  )
}
