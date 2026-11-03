import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAppBalance } from '../lib/balance'
import { cardDateOf, displayName, fmtDay, fmtDayTime, fmtTime, must, todayCard, useAsync, useFightersMap, useNow, type FightRow } from '../lib/hooks'
import { BET_STATUS, LEDGER_REASON, fmtDelta, fmtNum } from '../lib/copy'
import type { Bet, LedgerRow } from '../lib/types'
import { BadgeSection } from '../components/badges'
import {
  Alert, Button, ButtonLink, EmptyState, Field, FieldError, Loading, PasswordInput, SignOut, Stamp, Stub, TabPanel, Tabs, useToast,
} from '../components/ui'

type Tab = 'picks' | 'log' | 'account'
/** separator bound to the next word with a no-break space, so it never dangles at a line end (320px) */
const SEP = ' \u00b7\u00a0'
const TABS: Tab[] = ['picks', 'log', 'account']

export default function Me() {
  const { profile } = useAuth()
  const { balance } = useAppBalance()
  const [tab, setTab] = useState<Tab>(() => {
    const h = typeof location !== 'undefined' ? location.hash.slice(1) : ''
    return (TABS as string[]).includes(h) ? (h as Tab) : 'picks'
  })
  // live points come from the picks list; loaded here so the wallet line stays true on every tab
  const picks = usePicks(profile?.id)
  const live = (picks.data?.bets ?? []).filter(b => b.status === 'active').reduce((s, b) => s + b.amount, 0)

  return (
    <div className="pg-me">
      <h1 className="t-title"><bdi>{displayName(profile, '…')}</bdi></h1>
      {profile?.username && <p className="data c-2" style={{ marginTop: 6 }}>Login: {profile.username}{profile.role === 'admin' && ' · admin'}</p>}

      <Stub as="section" className="wallet" aria-label="Your points">
        <p className="big"><span className="n">{balance == null ? '…' : fmtNum(balance)}</span><span className="label">pts</span></p>
        <p className="t-help c-2">
          Fun points. 100 more every Monday.{live > 0 && <> {fmtNum(live)} {live === 1 ? 'is' : 'are'} in a live pick.</>}
        </p>
      </Stub>

      <BadgeSection kind="user" id={profile?.id} title="Your badges" own className="me-badges" />

      <Tabs label="Your account" value={tab} onChange={setTab}
        tabs={[{ id: 'picks', label: 'Picks' }, { id: 'log', label: 'Points log' }, { id: 'account', label: 'Account' }]} />
      <TabPanel id="picks" value={tab} className="panel picks"><MyPicks st={picks} /></TabPanel>
      <TabPanel id="log" value={tab} className="panel ledger"><PointsLog /></TabPanel>
      <TabPanel id="account" value={tab} className="panel"><Account /></TabPanel>
    </div>
  )
}

interface PicksData { bets: Bet[]; fights: Map<string, FightRow> }

function usePicks(uid: string | undefined) {
  return useAsync<PicksData>(async () => {
    if (!uid) return { bets: [], fights: new Map() }
    const bets = must(await supabase.from('bets').select('*').eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(200)) as Bet[]
    const ids = [...new Set(bets.map(b => b.fight_id))]
    const fights = ids.length ? must(await supabase.from('fights').select('*').in('id', ids)) as FightRow[] : []
    return { bets, fights: new Map(fights.map(f => [f.id, f])) }
  }, [uid])
}

/** "tonight 22:30" / "Thu 6 Nov 22:30" for a live pick; "30 Oct" once finished. */
const whenOf = (f: FightRow | undefined, live: boolean) => {
  if (!f) return ''
  if (!live) return fmtDay(f.scheduled_at)
  return cardDateOf(f) === todayCard() ? `tonight ${fmtTime(f.scheduled_at)}` : fmtDayTime(f.scheduled_at)
}

function MyPicks({ st }: { st: ReturnType<typeof usePicks> }) {
  const fights = [...(st.data?.fights.values() ?? [])]
  const fighters = useFightersMap(fights.flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))
  const nowDate = useNow(60_000)

  if (st.loading && !st.data) return <Loading label="Loading your picks…" shape="rows" />
  if (st.error) return <Alert title="Couldn't load your picks." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again.</Alert>
  const bets = st.data?.bets ?? []
  if (!bets.length) {
    return <EmptyState title="No picks yet" body="Pick a winner on Tonight. Just picking is free."
      action={<ButtonLink to="/app" variant="bone" size="sm">Go to Tonight</ButtonLink>} />
  }
  const active = bets.filter(b => b.status === 'active')
  const done = bets.filter(b => b.status !== 'active')
  const now = nowDate.getTime()

  const item = (b: Bet, i: number) => {
    const f = st.data?.fights.get(b.fight_id)
    const nick = (id?: string) => (id ? fighters.data?.get(id)?.nickname : undefined)
    const mineId = f ? (b.side === 'red' ? f.red_fighter_id : f.blue_fighter_id) : undefined
    const otherId = f ? (b.side === 'red' ? f.blue_fighter_id : f.red_fighter_id) : undefined
    const live = b.status === 'active'
    const locked = live && !!f && (f.status === 'locked' || (f.status === 'open' && new Date(f.lock_at).getTime() <= now))
    const stamp = live ? (locked ? 'Locked' : BET_STATUS.active) : BET_STATUS[b.status]
    const amount = b.status === 'won' ? `+${fmtNum(b.payout ?? 0)}` : b.status === 'lost' ? `−${fmtNum(b.amount)}` : fmtNum(b.amount)
    const extra = f?.status === 'cancelled' ? (f.cancel_kind === 'no_contest' ? 'no contest' : 'called off') : ''
    const meta = [otherId ? `vs ${nick(otherId) ?? '…'}` : '', whenOf(f, live), extra].filter(Boolean).join(SEP)
    return (
      <li key={b.id} className="row">
        <span>
          <span className="t-sub"><bdi>{nick(mineId) ?? (b.side === 'red' ? 'Red corner' : 'Blue corner')}</bdi></span>
          <span className="data">{meta}</span>
        </span>
        <span className="amt">
          <span className="data-lg">{amount}<span className="sr-only"> points</span></span>
          <Stamp tone="bone" size="sm" rot={[-3, 2, -2, 3][i % 4]}>{stamp}</Stamp>
        </span>
      </li>
    )
  }

  return (
    <>
      {active.length > 0 && (
        <>
          <h2 className="label sub-h">Live now</h2>
          <ul className="rows" role="list">{active.map(item)}</ul>
        </>
      )}
      {done.length > 0 && (
        <>
          <h2 className="label sub-h">Finished</h2>
          <ul className="rows" role="list">{done.map(item)}</ul>
        </>
      )}
    </>
  )
}

const PAGE = 50
const BET_REASONS = new Set(['bet', 'bet_cancel', 'payout', 'refund', 'payout_reversal'])

interface LogData { rows: LedgerRow[]; more: boolean; label: Map<string, string> }

/** LedgerRow (DESIGN 11.13): reason, date plus the fighter it was about (never a raw id), signed amount. 50 at a time. */
function PointsLog() {
  const { profile } = useAuth()
  const [n, setN] = useState(PAGE)
  const st = useAsync<LogData>(async () => {
    const all = must(await supabase.from('points_ledger').select('*').eq('user_id', profile?.id ?? '')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(n + 1)) as LedgerRow[]
    const rows = all.slice(0, n)
    // ref_id on pick-related rows is the bet id: resolve it to the picked fighter's name
    const betIds = [...new Set(rows.filter(r => BET_REASONS.has(r.reason) && r.ref_id).map(r => r.ref_id!))]
    const label = new Map<string, string>()
    if (betIds.length) {
      const bets = must(await supabase.from('bets').select('id,fight_id,side').in('id', betIds)) as Pick<Bet, 'id' | 'fight_id' | 'side'>[]
      const fids = [...new Set(bets.map(b => b.fight_id))]
      const fights = fids.length ? must(await supabase.from('fights').select('id,red_fighter_id,blue_fighter_id,status,cancel_kind').in('id', fids)) as FightRow[] : []
      const fmap = new Map(fights.map(f => [f.id, f]))
      const pids = [...new Set(fights.flatMap(f => [f.red_fighter_id, f.blue_fighter_id]))]
      const people = pids.length ? must(await supabase.from('fighters').select('id,nickname').in('id', pids)) as { id: string; nickname: string }[] : []
      const names = new Map(people.map(p => [p.id, p.nickname]))
      for (const b of bets) {
        const f = fmap.get(b.fight_id)
        if (!f) continue
        const nm = names.get(b.side === 'red' ? f.red_fighter_id : f.blue_fighter_id)
        const extra = f.status === 'cancelled' ? (f.cancel_kind === 'no_contest' ? 'no contest' : 'called off') : ''
        label.set(b.id, [nm, extra].filter(Boolean).join(SEP))
      }
    }
    return { rows, more: all.length > n, label }
  }, [profile?.id, n])

  if (st.loading && !st.data) return <Loading label="Loading your points log…" shape="rows" />
  if (st.error && !st.data) return <Alert title="Couldn't load your points log." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again.</Alert>
  const d = st.data!
  if (!d.rows.length) return <EmptyState title="Nothing here yet" body="Your welcome points show up after your first login." />

  return (
    <>
      <ul className="rows" role="list" style={{ marginTop: 8 }}>
        {d.rows.map(r => {
          const about = BET_REASONS.has(r.reason) ? (r.ref_id ? d.label.get(r.ref_id) : '') : r.reason === 'admin_adjust' ? r.note?.trim() : ''
          return (
            <li key={r.id} className="row">
              <span>
                <span className="reason">{LEDGER_REASON[r.reason] ?? 'Points change'}</span>
                <span className="data">{fmtDayTime(r.created_at)}{about ? `${SEP}${about}` : ''}</span>
              </span>
              <span className="data-lg amt">{fmtDelta(r.delta)}</span>
            </li>
          )
        })}
      </ul>
      {d.more && (
        <Button variant="ghost" size="sm" style={{ width: '100%', marginTop: 12 }} busy={st.loading} busyLabel="Loading"
          onClick={() => setN(x => x + PAGE)}>Show older</Button>
      )}
    </>
  )
}

function Account() {
  const { signOut } = useAuth()
  const toast = useToast()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ field: 'pw' | 'pw2' | 'form'; text: string } | null>(null)
  // first error gets focus on submit (WIG)
  const focus = (name: string) => document.querySelector<HTMLInputElement>(`.acct input[name="${name}"]`)?.focus()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) { setErr({ field: 'pw', text: 'Use at least 8 characters.' }); focus('new-password'); return }
    if (pw !== pw2) { setErr({ field: 'pw2', text: 'The two passwords don’t match. Type the same one twice.' }); focus('repeat-password'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setErr({ field: 'form', text: friendlyError(error) })
    else { toast('Password saved.'); setPw(''); setPw2('') }
  }

  return (
    <>
      <p className="note t-help">Your display name and login are set by an admin. Ask one if something needs changing.</p>
      <form className="paper acct" aria-labelledby="cp" noValidate onSubmit={submit}>
        <h2 id="cp" className="t-sub">Change password</h2>
          <Field label="New password" hint="At least 8 characters." error={err?.field === 'pw' ? err.text : undefined}>
            <PasswordInput name="new-password" autoComplete="new-password" value={pw} onChange={e => { setPw(e.target.value); if (err?.field === 'pw') setErr(null) }} />
          </Field>
          <Field label="Repeat new password" error={err?.field === 'pw2' ? err.text : undefined}>
            <PasswordInput name="repeat-password" autoComplete="new-password" value={pw2} onChange={e => { setPw2(e.target.value); if (err?.field === 'pw2') setErr(null) }} />
          </Field>
          <div>
            <Button type="submit" busy={busy} busyLabel="Saving">Save new password</Button>
            {err?.field === 'form' && <div style={{ marginTop: 10 }}><FieldError>{err.text}</FieldError></div>}
          </div>
      </form>
      <Button variant="ghost" icon={SignOut} style={{ marginTop: 20 }} onClick={() => void signOut()}>Log out</Button>
    </>
  )
}
