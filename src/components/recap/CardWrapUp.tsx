/**
 * Tonight, once every bout of a card is done (CONTRACT C3 + C4): "That's the card" with the Fight of the
 * Night vote (or its result) and the results poster share. Rendered by FightCard after the Finished list.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { FotnState } from '../../lib/types'
import { FotnPanel, useCardWrap } from '../fotn'
import { Alert } from '../ui'
import RecapShareButton from './RecapShareButton'
import '../fotn/fotn.css'

export default function CardWrapUp({ cardDate, sig }: { cardDate: string; /** changes when a bout of the card changes */ sig?: string }) {
  const st = useCardWrap(cardDate)
  const hid = useId()
  const [fotn, setFotn] = useState<FotnState | null>(null)
  const reload = st.reload
  useEffect(() => { setFotn(null) }, [st.data])
  const seen = useRef(sig)
  useEffect(() => { if (sig !== seen.current) { seen.current = sig; void reload() } }, [sig, reload])

  if (st.loading && !st.data) return null
  if (st.error && !st.data) {
    return (
      <section className="section card-wrap" aria-labelledby={hid}>
        <div className="section-head"><h2 id={hid} className="t-head">That’s the card</h2></div>
        <Alert title="Couldn’t load Fight of the Night." onRetry={() => void reload()}>Check your connection and try again.</Alert>
      </section>
    )
  }
  const data = st.data
  if (!data || !data.recap.complete || data.recap.settled_count < 1) return null
  const f = fotn ?? data.fotn
  const n = data.recap.settled_count

  return (
    <section className="section card-wrap" aria-labelledby={hid}>
      <div className="section-head">
        <h2 id={hid} className="t-head">That’s the card</h2>
        <span className="data c-2 nowrap">{n} result{n === 1 ? '' : 's'}</span>
      </div>
      <FotnPanel recap={data.recap} fotn={f}
        onVoted={next => { setFotn(next) }}
        onExpired={() => void reload()} />
      <RecapShareButton cardDate={cardDate} recap={data.recap} />
    </section>
  )
}
