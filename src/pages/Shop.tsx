import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAppBalance } from '../lib/balance'
import { displayName, must, useAsync } from '../lib/hooks'
import { fmtNum } from '../lib/copy'
import { CUSTOM_TITLE_CODE, SHOP_DISCLAIMER, type ShopItem, type ShopItemCode, type ShopKind, type TitleRequest as Req, type UserItem } from '../lib/types'
import { Alert, CaretLeft, EmptyState, Info, Loading, useToast } from '../components/ui'
import MemberName, { type CosmeticLook } from '../components/MemberName'
import { ColorTile, FrameTile, TitleRow } from '../components/shop/ShopTiles'
import TitleRequest from '../components/shop/TitleRequest'
import { KIND_HEAD, shopError } from '../components/shop/shopCopy'
import { refreshCosmetics } from '../components/shop/cosmetics'
import '../components/shop/shop.css'

interface Data { items: ShopItem[]; mine: UserItem[]; latest: Req | null; refunded: boolean }

const KINDS: ShopKind[] = ['name_color', 'frame', 'title']

/** Shop (C6): cosmetics for your name, paid in fun points. Lists on ink, the title form on paper. */
export default function Shop() {
  const { profile } = useAuth()
  const uid = profile?.id
  const { balance, reload: reloadBalance } = useAppBalance()
  const toast = useToast()
  const [confirm, setConfirm] = useState<ShopItemCode | null>(null)
  const [busy, setBusy] = useState<ShopItemCode | null>(null)
  const [errs, setErrs] = useState<Partial<Record<ShopItemCode, string>>>({})

  const st = useAsync<Data>(async () => {
    if (!uid) return { items: [], mine: [], latest: null, refunded: false }
    const [items, mine, reqs] = await Promise.all([
      supabase.from('shop_items').select('*').eq('active', true).order('kind').order('sort'),
      supabase.from('user_items').select('*').eq('user_id', uid),
      supabase.from('title_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(1),
    ])
    const latest = (must(reqs) as Req[])[0] ?? null
    // a request turned down after a season reset refunds nothing (the reset covered it): read what really happened
    let refunded = false
    if (latest?.status === 'rejected' && latest.price > 0) {
      const back = await supabase.from('points_ledger').select('id').eq('user_id', uid)
        .eq('reason', 'shop_refund').eq('ref_id', latest.id).limit(1)
      refunded = !back.error && (back.data?.length ?? 0) > 0
    }
    return { items: must(items) as ShopItem[], mine: must(mine) as UserItem[], latest, refunded }
  }, [uid])

  const me = { id: uid, name: displayName(profile, '…') }
  const d = st.data
  const owned = new Map((d?.mine ?? []).map(u => [u.code, u]))
  const items = d?.items ?? []
  const byCode = new Map(items.map(i => [i.code, i]))

  // what you wear now, from your own rows (instant after an action, before the shared cache refetches)
  const worn = (kind: ShopKind) => (d?.mine ?? []).find(u => u.kind === kind && u.equipped)
  const look: CosmeticLook = {
    name_color: byCode.get(worn('name_color')?.code as ShopItemCode)?.value ?? null,
    frame: byCode.get(worn('frame')?.code as ShopItemCode)?.value ?? null,
    title: (() => { const w = worn('title'); return w ? (w.custom_value ?? byCode.get(w.code)?.value ?? null) : null })(),
  }
  // trying on: while you confirm an unlock, the mirror shows it
  const trying = confirm ? byCode.get(confirm) : undefined
  const mirror: CosmeticLook = trying
    ? { ...look, ...(trying.kind === 'name_color' ? { name_color: trying.value } : trying.kind === 'frame' ? { frame: trying.value } : { title: trying.value }) }
    : look

  const act = async (code: ShopItemCode, fn: () => PromiseLike<{ error: unknown }>, done: () => void) => {
    setBusy(code); setErrs(e => ({ ...e, [code]: undefined }))
    const r = await fn()
    setBusy(null)
    if (r.error) { setErrs(e => ({ ...e, [code]: shopError(r.error) })); return }
    setConfirm(null)
    done()
    await Promise.all([st.reload(), refreshCosmetics()])
  }

  const unlock = (i: ShopItem) => act(i.code, () => supabase.rpc('buy_item', { p_code: i.code }), () => {
    reloadBalance(); toast(`${labelOf(i)} unlocked. Wear it whenever you like.`)
  })
  const wear = (i: ShopItem) => act(i.code, () => supabase.rpc('equip_item', { p_code: i.code }), () => toast(`Wearing ${labelOf(i)}.`))
  const takeOff = (i: ShopItem) => act(i.code, () => supabase.rpc('unequip_item', { p_kind: i.kind }), () => toast(`Took off ${labelOf(i)}.`))
  const labelOf = (i: ShopItem) => (i.kind === 'title' ? `“${owned.get(i.code)?.custom_value ?? i.value ?? i.label}”` : i.label)

  const actionsFor = (i: ShopItem) => ({
    owned: owned.has(i.code), wearing: !!owned.get(i.code)?.equipped, balance,
    confirming: confirm === i.code, busy: busy === i.code, error: errs[i.code] ?? null,
    onAsk: () => { setConfirm(i.code); setErrs(e => ({ ...e, [i.code]: undefined })) },
    onCancel: () => setConfirm(null),
    onUnlock: () => void unlock(i), onWear: () => void wear(i), onTakeOff: () => void takeOff(i),
  })

  const custom = byCode.get(CUSTOM_TITLE_CODE)
  const myCustom = owned.get(CUSTOM_TITLE_CODE)

  return (
    <div className="pg-shop">
      <div className="pagehead" style={{ marginBottom: 0 }}>
        <Link className="back" to="/app/me"><CaretLeft />Me</Link>
      </div>
      <h1 className="t-title">Shop</h1>
      <p className="lede t-body">Looks for your name. They show on the ranks, the pick lists and your page.</p>
      <p className="shop-note t-help"><Info />{SHOP_DISCLAIMER}</p>

      <section className="shop-mirror" aria-label={trying ? `Trying on ${trying.label}` : 'How your name looks now'}>
        <div className="shop-mirror-head">
          <h2 className="label">{trying ? <>Trying on <bdi>{labelOf(trying)}</bdi></> : 'Your name now'}</h2>
          <p className="data nowrap"><b>{balance == null ? '…' : fmtNum(balance)}</b> pts</p>
        </div>
        <div className="shop-mirror-pair">
          <p className="t-sub on-ink"><MemberName userId={uid} name={me.name} preview={mirror} surface="ink" /></p>
          <p className="t-sub on-paper"><MemberName userId={uid} name={me.name} preview={mirror} surface="paper" /></p>
        </div>
      </section>

      {st.loading && !d ? <Loading label="Loading the shop…" shape="rows" />
        : st.error && !d ? <Alert title="Couldn't load the shop." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again. Nothing you own is lost.</Alert>
        : !items.length ? <EmptyState title="The shop is empty" body="Admins haven't put anything out yet. Check back later." />
        : KINDS.map(kind => {
          const list = items.filter(i => i.kind === kind && i.code !== CUSTOM_TITLE_CODE)
          if (!list.length && kind !== 'title') return null
          const head = KIND_HEAD[kind]
          return (
            <section key={kind} className="section shop-sec" aria-labelledby={`sec-${kind}`}>
              <h2 id={`sec-${kind}`} className="t-head">{head.title}</h2>
              <p className="t-help c-2 shop-sec-help">{head.help}</p>
              {kind === 'title' ? (
                <>
                  <ul className="rows shop-titles" role="list">
                    {list.map(i => <TitleRow key={i.code} item={i} me={me} actions={actionsFor(i)} />)}
                    {custom && myCustom && <TitleRow key={custom.code} item={custom} me={me} text={myCustom.custom_value} actions={actionsFor(custom)} />}
                  </ul>
                  {custom && (
                    <TitleRequest price={custom.price} balance={balance} latest={d?.latest ?? null} refunded={!!d?.refunded} hasCustom={!!myCustom}
                      onSent={t => { reloadBalance(); void st.reload(); toast(`“${t}” sent. An admin will check it.`) }} />
                  )}
                </>
              ) : (
                <ul className={`shop-grid shop-grid--${kind}`} role="list">
                  {list.map(i => kind === 'name_color'
                    ? <ColorTile key={i.code} item={i} me={me} actions={actionsFor(i)} />
                    : <FrameTile key={i.code} item={i} me={me} actions={actionsFor(i)} />)}
                </ul>
              )}
            </section>
          )
        })}
    </div>
  )
}
