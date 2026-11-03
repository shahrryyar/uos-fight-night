import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtNum } from '../../lib/copy'
import { fmtDayTime } from '../../lib/hooks'
import type { Profile, TitleRequest } from '../../lib/types'
import { Button, Field, Input, Loading, Paper, Stamp, useToast } from '../../components/ui'
import { FormError, LoadError, SectionHead } from '../../components/admin/ui'
import { must, useAction } from '../../components/admin/adminUtils'
import MemberName from '../../components/MemberName'
import { shopError } from '../../components/shop/shopCopy'
import { refreshCosmetics } from '../../components/shop/cosmetics'
import '../../components/shop/shop.css'

/** `reset`: asked in an earlier season. The season reset already put that member back to 1000, so
 *  turning it down refunds nothing (admin_reject_title, migration 20261103000014). */
type Named = TitleRequest & { name: string; reset: boolean }

/**
 * Shop (C6, admin): custom title requests. Pending first, oldest first (fair queue), each with
 * Approve or Turn down (optional reason, the points go back). Then the last 30 decisions.
 * An admin can't decide their own request (OWN_REQUEST), so their own rows say so instead of offering buttons.
 */
export default function AdminShop() {
  const [rows, setRows] = useState<Named[] | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const load = useAction()
  const loadRun = load.run

  const refresh = useCallback(() => loadRun(async () => {
    const [{ data: auth }, r, season] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('title_requests').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('seasons').select('started_at').is('ended_at', null).maybeSingle(),
    ])
    const start = season.data?.started_at ? Date.parse(season.data.started_at as string) : null
    const reqs = must(r) as TitleRequest[]
    const ids = [...new Set(reqs.map(x => x.user_id))]
    const people = ids.length ? must(await supabase.from('profiles').select('id,username,display_name').in('id', ids)) as Pick<Profile, 'id' | 'username' | 'display_name'>[] : []
    const names = new Map(people.map(p => [p.id, p.display_name?.trim() || p.username]))
    setMe(auth.user?.id ?? null)
    setRows(reqs.map(x => ({ ...x, name: names.get(x.user_id) ?? 'Member', reset: start != null && Date.parse(x.created_at) < start })))
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  const pending = (rows ?? []).filter(r => r.status === 'pending').reverse()
  const done = (rows ?? []).filter(r => r.status !== 'pending').slice(0, 30)

  return (
    <div className="adm-shop">
      <SectionHead title="Title requests" count={rows ? pending.length : undefined}
        sub="Members spend points to ask for a custom title. Approve it and it shows next to their name. Turn it down and their points come back." />
      <LoadError error={rows ? null : load.error} what="title requests" onRetry={() => void refresh()} busy={load.busy} />
      {!rows && !load.error && <Loading label="Loading title requests…" shape="rows" />}
      {rows && (
        pending.length
          ? <ul className="rows adm-rows" role="list">{pending.map(r => <PendingRow key={r.id} r={r} own={r.user_id === me} onDone={refresh} />)}</ul>
          : <p className="t-help c-2 adm-empty">Nothing waiting. New requests show up here.</p>
      )}

      {done.length > 0 && (
        <section className="section" aria-labelledby="tr-done">
          <SectionHead id="tr-done" title="Decided" as="h2" />
          <ul className="rows" role="list">
            {done.map(r => (
              <li key={r.id} className="row adm-tr-done">
                <span style={{ minWidth: 0 }}>
                  <span className="t-sub">“<bdi>{r.title}</bdi>”</span>
                  <span className="data c-2" style={{ display: 'block' }}>
                    <MemberName userId={r.user_id} name={r.name} title="none" frame={false} />{' · '}
                    <span className="nowrap">{fmtDayTime(r.decided_at ?? r.created_at)}</span>
                  </span>
                  {r.decision_note?.trim() && <span className="t-help c-2" style={{ display: 'block' }}>“{r.decision_note.trim()}”</span>}
                </span>
                <Stamp tone="bone" size="sm" rot={r.status === 'approved' ? -3 : 2}>{r.status === 'approved' ? 'Approved' : 'Turned down'}</Stamp>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function PendingRow({ r, own, onDone }: { r: Named; own: boolean; onDone: () => Promise<unknown> | void }) {
  const toast = useToast()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<'ok' | 'no' | null>(null)

  const approve = async () => {
    setBusy('ok'); setErr(null)
    const res = await supabase.rpc('admin_approve_title', { p_request_id: r.id })
    setBusy(null)
    if (res.error) { setErr(shopError(res.error)); return }
    toast(`“${r.title}” approved for ${r.name}.`)
    void refreshCosmetics()
    await onDone()
  }
  const reject = async () => {
    if (reason.trim().length > 200) { setErr('Keep the reason under 200 characters.'); return }
    setBusy('no'); setErr(null)
    const res = await supabase.rpc('admin_reject_title', { p_request_id: r.id, p_reason: reason.trim() || null })
    setBusy(null)
    if (res.error) { setErr(shopError(res.error)); return }
    toast(r.reset || r.price <= 0
      ? `Turned down. No points back: the season reset already covered it.`
      : `Turned down. ${fmtNum(r.price)} pts went back to ${r.name}.`)
    await onDone()
  }

  return (
    <li className="adm-tr">
      <div className="adm-tr-main">
        <span className="t-sub">“<bdi>{r.title}</bdi>”</span>
        <span className="data c-2">
          <MemberName userId={r.user_id} name={r.name} title="none" frame={false} />
          <span className="nowrap">{' · '}{fmtNum(r.price)} pts</span>
        </span>
        <span className="data c-2">{fmtDayTime(r.created_at)}{r.reset && <span className="nowrap">{' · '}last season</span>}</span>
      </div>
      {own ? (
        <p className="t-help c-2">This is your own request. Another admin has to decide it.</p>
      ) : rejecting ? (
        <Paper className="adm-tr-panel">
          <Field label="Reason (optional)" hint={r.reset
            ? 'The member sees this. Up to 200 characters. Asked last season, so no points go back: the reset already put them on 1000.'
            : `The member sees this. Up to 200 characters. Their ${fmtNum(r.price)} pts go back.`}>
            <Input name="reason" maxLength={200} autoComplete="off" value={reason} onChange={e => { setReason(e.target.value); setErr(null) }} />
          </Field>
          <FormError error={err} />
          <div className="shop-req-actions">
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setRejecting(false)}>Back</Button>
            <Button variant="danger" size="sm" busy={busy === 'no'} busyLabel="Turning down" onClick={() => void reject()}>Turn it down</Button>
          </div>
        </Paper>
      ) : (
        <>
          <div className="adm-tr-actions">
            <Button variant="bone" size="sm" busy={busy === 'ok'} busyLabel="Approving" onClick={() => void approve()}>Approve</Button>
            <Button variant="danger" onInk size="sm" disabled={!!busy} onClick={() => { setRejecting(true); setErr(null) }}>Turn down</Button>
          </div>
          {err && <div className="shop-err"><FormError error={err} /></div>}
        </>
      )}
    </li>
  )
}
