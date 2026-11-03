/**
 * Callouts board /app/callouts (CONTRACT C5).
 *   1. A pending callout aimed at the viewer's fighter: the screen's one taped poster (answer it).
 *   2. "Call someone out" (linked fighters only) opens the create form inline; ?target= and ?rematch=
 *      deep links (fighter profile, settled bouts) open it prefilled.
 *   3. The public board on ink: Open (pending / accepted / approved), Booked, then Closed (declined,
 *      rejected, or booked but the fight was called off).
 * Live: realtime on `callouts` refetches the board.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { must, useAsync } from '../lib/hooks'
import { Alert, Button, EmptyState, Loading, MegaphoneSimple } from '../components/ui'
import { CalloutForm, CalloutRow, IncomingCallout, isCalledOff, isOpenStatus, useCalloutBoard } from '../components/callouts'
import type { RosterFighter } from '../components/callouts/CalloutForm'
import '../components/callouts/callouts.css'

export default function Callouts() {
  const myFighter = useAuth().profile?.fighter_id ?? null
  const [params, setParams] = useSearchParams()
  const target = params.get('target')
  const rematch = params.get('rematch')
  const formOpen = params.get('new') === '1' || !!target || !!rematch
  const board = useCalloutBoard()
  const roster = useAsync<RosterFighter[]>(async () =>
    must(await supabase.from('fighters').select('id,nickname,hidden').order('nickname')) as RosterFighter[], [])

  const rows = useMemo(() => board.data ?? [], [board.data])
  const incoming = rows.filter(c => c.status === 'pending' && myFighter && c.target_fighter_id === myFighter)
  const incomingIds = new Set(incoming.map(c => c.id))
  const open = rows.filter(c => isOpenStatus(c.status) && !incomingIds.has(c.id))
  const booked = rows.filter(c => c.status === 'booked' && !isCalledOff(c))
  const closed = rows.filter(c => c.status === 'declined' || c.status === 'rejected' || isCalledOff(c))
  const mineOpen = rows.filter(c => isOpenStatus(c.status) && c.challenger_fighter_id === myFighter).length
  // fighters I already have an open callout with: 'out' = I called them, 'in' = they called me
  const busyWith = useMemo(() => new Map(rows.filter(c => isOpenStatus(c.status) && myFighter
    && (c.challenger_fighter_id === myFighter || c.target_fighter_id === myFighter))
    .map(c => (c.challenger_fighter_id === myFighter ? [c.target_fighter_id, 'out'] as const : [c.challenger_fighter_id, 'in'] as const))), [rows, myFighter])

  const openForm = () => setParams({ new: '1' }, { replace: true })
  const closeForm = () => setParams({}, { replace: true })
  const reload = () => void board.reload()

  return (
    <div className="pg-callouts">
      <h1 className="t-title">Callouts</h1>
      <p className="t-help c-2 co-intro">Fighters call each other out. If both want the bout, an admin books it.</p>

      {incoming.length > 0 && (
        <section className="co-incoming" aria-label="Callouts for you">
          {incoming.map((c, i) => <IncomingCallout key={c.id} c={c} taped={i === 0} onChanged={reload} />)}
        </section>
      )}

      {myFighter ? (
        formOpen ? (
          roster.data
            ? <CalloutForm key={`${target ?? ''}:${rematch ?? ''}`} myFighterId={myFighter} roster={roster.data} busyWith={busyWith}
                myOpen={mineOpen} initialTarget={target} rematchOf={rematch} quietSubmit={incoming.length > 0}
                onSent={() => { closeForm(); reload() }} onClose={closeForm} />
            : roster.error
              ? <Alert title="Couldn't load the roster." onRetry={() => void roster.reload()}>Check your connection and try again.</Alert>
              : <Loading label="Loading the roster…" shape="none" />
        ) : (
          <Button variant={incoming.length ? 'bone' : 'primary'} icon={MegaphoneSimple} className="co-new" onClick={openForm}>
            Call someone out
          </Button>
        )
      ) : (
        <p className="t-help c-2 co-fan">Only fighters can make callouts. Everyone can follow the board.</p>
      )}

      {board.loading && !board.data ? <Loading label="Loading the callouts…" shape="rows" />
        : board.error && !board.data ? <Alert title="Couldn't load the callouts." onRetry={reload} className="mt-4">Check your connection and try again.</Alert>
        : (
          <>
            <section className="section" aria-labelledby="co-open-h">
              <div className="section-head">
                <h2 id="co-open-h" className="t-head">Open</h2>
                {open.length > 0 && <span className="data c-2">{open.length}</span>}
              </div>
              {open.length === 0
                ? <EmptyState as="h3" size="head" title="No open callouts" body="When a fighter calls someone out, it lands here for everyone to see." />
                : <ul className="rows co-rows" role="list">{open.map(c => <li key={c.id}><CalloutRow c={c} myFighterId={myFighter} onChanged={reload} /></li>)}</ul>}
            </section>

            {booked.length > 0 && (
              <section className="section" aria-labelledby="co-booked-h">
                <div className="section-head">
                  <h2 id="co-booked-h" className="t-head">Booked</h2>
                  <span className="data c-2">{booked.length}</span>
                </div>
                <ul className="rows co-rows" role="list">{booked.map(c => <li key={c.id}><CalloutRow c={c} myFighterId={myFighter} onChanged={reload} /></li>)}</ul>
              </section>
            )}

            {closed.length > 0 && (
              <details className="section co-closed">
                <summary className="btn btn--ghost btn--sm">Closed ({closed.length})</summary>
                <ul className="rows co-rows" role="list">{closed.map(c => <li key={c.id}><CalloutRow c={c} myFighterId={myFighter} onChanged={reload} /></li>)}</ul>
              </details>
            )}
          </>
        )}
    </div>
  )
}
