/**
 * Referee scoreboard (CONTRACT B4). Bone on black, giant tabular numerals, nothing else on screen.
 * Built for one thumb at 390px in a dark hall:
 *   top     round + clock state stamp, the clock, Start/Pause, round length, Next (confirm sheet
 *           mid-round; once time is up Next round takes the Start/Pause spot and needs no confirm)
 *   middle  two corners: name, score, +1 (filled), +2 (outlined), -1 (small ghost)
 *   bottom  Finish bout (opens the result form prefilled) and Reset (confirm)
 * Taps are optimistic: the board moves at once, the calls go out one at a time in order, and every
 * admin_live_update result (the server's view) replaces the local guess. A refusal undoes that tap,
 * buzzes, and says why in one line.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { LiveAction, LiveScore } from '../../lib/types'
import {
  ArrowCounterClockwise, Button, CheckCircle, FlagCheckered, Paper, Seg, Stamp, Stepper, Warning, WarningOctagon, X,
} from '../ui'
import { buzz, useWakeLock, type WakeStatus } from './device'
import { useInertOutside } from './inert'
import {
  elapsedAt, emptyLive, fmtClock, fmtLength, liveUpdate, refError, remainingAt, useLiveFeed, useTicker,
} from './live'

export interface FinishPrefill { fightId: string; rounds: number; red: number; blue: number }

interface Props {
  fightId: string
  redName: string
  blueName: string
  /** "Main event" / "Bout 2" */
  boutLabel: string
  back: ReactNode
  onFinish: (p: FinishPrefill) => void
  /** the server says the bout moved on (settled / called off): parent reloads the fight */
  onFightGone: () => void
  /** C2: false for a referee (no admin). Finish then stops the clock and hands back to the ref list. */
  canSettle?: boolean
}

interface Op { id: number; action: LiveAction; value?: number; at: number }
type Sheet = 'none' | 'length' | 'reset' | 'finish' | 'next'

const OPTIMISTIC: LiveAction[] = ['red_add', 'blue_add', 'start', 'pause']
const PRESETS = [60, 90, 120, 180]
const MAX_SCORE = 999
const MAX_ROUND = 20

/** The local guess for one tap, at server time `now`. */
function applyOp(s: LiveScore, op: Op): LiveScore {
  switch (op.action) {
    case 'red_add': return { ...s, red_score: Math.min(MAX_SCORE, Math.max(0, s.red_score + (op.value ?? 0))) }
    case 'blue_add': return { ...s, blue_score: Math.min(MAX_SCORE, Math.max(0, s.blue_score + (op.value ?? 0))) }
    case 'start':
      if (s.running || elapsedAt(s, op.at) >= s.round_seconds) return s
      return { ...s, running: true, round_started_at: new Date(op.at).toISOString() }
    case 'pause':
      if (!s.running) return s
      return { ...s, running: false, round_started_at: null, accumulated_seconds: elapsedAt(s, op.at) }
    default: return s
  }
}

const GONE = ['This bout already has a result.', 'This bout was called off.', 'Lock the fight before scoring it.']

export default function Scoreboard({ fightId, redName, blueName, boutLabel, back, onFinish, onFightGone, canSettle = true }: Props) {
  const [pending, setPending] = useState<Op[]>([])
  const pendingRef = useRef<Op[]>([])
  useEffect(() => { pendingRef.current = pending })
  const feed = useLiveFeed(fightId, true, () => pendingRef.current.length > 0)
  const { accept, offset } = feed
  const [busy, setBusy] = useState<LiveAction | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet>('none')
  const [lenDraft, setLenDraft] = useState(120)
  const [announce, setAnnounce] = useState('')
  const chain = useRef<Promise<void>>(Promise.resolve())
  const seq = useRef(0)
  const wake = useWakeLock()

  const server = feed.row ?? emptyLive(fightId)
  const board = pending.reduce(applyOp, server)
  const now = useTicker(200, board.running) + offset
  const remaining = remainingAt(board, now)
  const timeUp = remaining <= 0
  const elapsed = elapsedAt(board, now)
  const ready = !board.running && elapsed === 0

  /* ---------- sending ---------- */

  const send = useCallback((action: LiveAction, value?: number) => {
    const op: Op = { id: ++seq.current, action, value, at: Date.now() + offset }
    const optimistic = OPTIMISTIC.includes(action)
    if (optimistic) setPending(p => [...p, op])
    else setBusy(action)
    const p = chain.current.then(async () => {
      try {
        const s = await liveUpdate(fightId, action, value)
        accept(s)
        setErr(null)
      } catch (e) {
        const msg = refError(e)
        setErr(msg)
        buzz('error')
        if (GONE.includes(msg)) onFightGone()
        else void feed.reload()
      } finally {
        if (optimistic) setPending(list => list.filter(o => o.id !== op.id))
        else setBusy(null)
      }
    })
    chain.current = p
    return p
  }, [fightId, offset, accept, feed, onFightGone])

  const score = (side: 'red' | 'blue', delta: number) => {
    const cur = side === 'red' ? board.red_score : board.blue_score
    if (cur + delta < 0 || cur + delta > MAX_SCORE) { buzz('error'); return }
    buzz(delta < 0 ? 'undo' : 'tap')
    void send(side === 'red' ? 'red_add' : 'blue_add', delta)
  }

  const toggleClock = () => {
    if (timeUp) return
    buzz('clock')
    void send(board.running ? 'pause' : 'start')
  }

  const nextRound = async () => {
    if (board.round >= MAX_ROUND) { setErr('The scoreboard stops at round 20.'); buzz('error'); return }
    buzz('clock')
    await send('next_round')
  }
  // mid-round, next_round throws away the time used and there is no step back: confirm it first
  const confirmNext = async () => {
    await nextRound()
    setSheet('none')
  }

  /* ---------- feedback ---------- */

  // the bell: once per round, when the clock reaches zero while this screen is open
  const rang = useRef<string>('')
  const roundKey = `${board.round}`
  useEffect(() => {
    if (timeUp && board.running && rang.current !== roundKey) {
      rang.current = roundKey
      buzz('bell')
      setAnnounce(`Time. End of round ${board.round}.`)
    }
    if (!timeUp && rang.current === roundKey && !board.running) rang.current = ''
  }, [timeUp, board.running, board.round, roundKey])

  // score announcements for screen readers (not every tick of the clock)
  const scoreKey = `${board.red_score}-${board.blue_score}-${board.round}`
  const firstScore = useRef(scoreKey)
  useEffect(() => {
    if (scoreKey === firstScore.current) return
    setAnnounce(`Round ${board.round}. Red ${board.red_score}, blue ${board.blue_score}.`)
  }, [scoreKey, board.red_score, board.blue_score, board.round])

  /* ---------- sheets ---------- */

  const openSheet = (s: Sheet) => {
    if (s === 'length') setLenDraft(board.round_seconds)
    setSheet(s)
  }

  const applyLength = async () => {
    if (lenDraft !== board.round_seconds) await send('set_round_seconds', lenDraft)
    setSheet('none')
  }
  const doReset = async () => {
    buzz('clock')
    await send('reset')
    setSheet('none')
  }
  const doFinish = async () => {
    if (board.running) await send('pause')
    onFinish({ fightId, rounds: board.round, red: board.red_score, blue: board.blue_score })
  }

  /* ---------- render ---------- */

  const clockStamp = timeUp
    ? <Stamp tone="live" size="sm" rot={-4} land stateKey={`time-${board.round}`}>Time</Stamp>
    : board.running
      ? <Stamp tone="live" size="sm" rot={-3}>Running</Stamp>
      : ready
        ? <Stamp tone="bone" size="sm" rot={2}>Ready</Stamp>
        : <Stamp tone="bone" size="sm" rot={2}>Paused</Stamp>

  const corner = (side: 'red' | 'blue') => {
    const name = side === 'red' ? redName : blueName
    const pts = side === 'red' ? board.red_score : board.blue_score
    const Side = side === 'red' ? 'Red' : 'Blue'
    return (
      <div className={`ref-corner ref-corner--${side}`} role="group" aria-label={`${Side} corner, ${name}`}>
        <div className={`corner corner--${side} label`}>{Side}</div>
        <p className="ref-name"><bdi>{name}</bdi></p>
        <p className="ref-pts" aria-hidden="true">{pts}</p>
        <button type="button" className="ref-btn ref-btn--one" onClick={() => score(side, 1)} disabled={pts >= MAX_SCORE}
          aria-label={`Plus 1 for ${name}`}>+1</button>
        <button type="button" className="ref-btn ref-btn--two" onClick={() => score(side, 2)} disabled={pts + 2 > MAX_SCORE}
          aria-label={`Plus 2 for ${name}`}>+2</button>
        <button type="button" className="ref-btn ref-btn--minus" onClick={() => score(side, -1)} disabled={pts <= 0}
          aria-label={`Minus 1 for ${name}`}>−1</button>
      </div>
    )
  }

  return (
    <div className="ref-board">
      <header className="ref-head">
        {back}
        <WakeNote status={wake} />
      </header>

      {err && (
        <p className="ref-err" role="alert">
          <WarningOctagon /><span>{err}</span>
          <button type="button" className="ref-err-x" aria-label="Dismiss" onClick={() => setErr(null)}><X /></button>
        </p>
      )}
      {feed.error && !feed.loaded && <p className="ref-err" role="alert"><WarningOctagon /><span>{feed.error}</span></p>}

      <section className="ref-clock" aria-label="Round clock">
        <div className="ref-clock-top">
          <h1 className="ref-round"><span className="sr-only">{boutLabel}, </span>Round <span className="num">{board.round}</span></h1>
          {clockStamp}
        </div>
        <p className={timeUp ? 'ref-time is-up' : 'ref-time'} role="timer" aria-label={`${fmtClock(remaining)} left in round ${board.round}`}>
          {fmtClock(remaining)}
        </p>
        <div className="ref-clock-ctl">
          {timeUp
            ? <Button variant="bone" onClick={() => void nextRound()} busy={busy === 'next_round'} busyLabel="Next round"
                disabled={board.round >= MAX_ROUND}>Next round</Button>
            : <Button variant="bone" onClick={toggleClock} aria-pressed={board.running}>
                {board.running ? 'Pause' : ready ? 'Start' : 'Resume'}
              </Button>}
          <button type="button" className="ref-len" onClick={() => openSheet('length')} aria-haspopup="dialog">
            <span className="data"><b>{fmtLength(board.round_seconds)}</b></span> <span className="label">rounds</span>
          </button>
          {!timeUp && (
            <Button variant="ghost" className="ref-next" onClick={() => openSheet('next')} aria-haspopup="dialog"
              aria-label={`Next round (round ${board.round + 1})`} disabled={board.round >= MAX_ROUND}>Next</Button>
          )}
        </div>
      </section>

      <section className="ref-score" aria-label="Score">
        {corner('red')}
        {corner('blue')}
      </section>

      <footer className="ref-foot">
        <Button variant="ghost" icon={FlagCheckered} onClick={() => openSheet('finish')}>Finish bout</Button>
        <Button variant="danger" onInk size="sm" icon={ArrowCounterClockwise} onClick={() => openSheet('reset')}>Reset</Button>
      </footer>

      <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>

      {sheet !== 'none' && (
        <BottomSheet onClose={() => setSheet('none')} label={SHEET_LABEL[sheet]}>
          {sheet === 'length' && (
            <>
              <h2 className="t-head">Round length</h2>
              <p className="t-help">Time already used in this round is kept.</p>
              <div className="segs ref-presets" role="group" aria-label="Common lengths">
                {PRESETS.map(s => <Seg key={s} pressed={lenDraft === s} onClick={() => setLenDraft(s)}><span className="data"><b>{fmtLength(s)}</b></span></Seg>)}
              </div>
              <div className="field">
                <span className="field-label">Exact length</span>
                <Stepper label="Round length" value={lenDraft} min={10} max={1800} step={10} onChange={setLenDraft} format={fmtLength} />
              </div>
              <div className="ref-sheet-actions">
                <Button variant="ghost" onClick={() => setSheet('none')}>Back</Button>
                <Button variant="ink" onClick={() => void applyLength()} busy={busy === 'set_round_seconds'} busyLabel="Saving">Set {fmtLength(lenDraft)}</Button>
              </div>
            </>
          )}
          {sheet === 'next' && (
            <>
              <h2 className="t-head">Go to round {board.round + 1}?</h2>
              <p className="t-help">
                {elapsed > 0
                  ? <>Round {board.round} stops with <b className="nowrap">{fmtClock(remaining)}</b> left. </>
                  : <>Round {board.round} hasn’t started. </>}
                Round {board.round + 1} starts paused at <b className="nowrap">{fmtLength(board.round_seconds)}</b> and the score carries over.
                There’s no going back to round {board.round}.
              </p>
              <div className="ref-sheet-actions">
                <Button variant="ghost" onClick={() => setSheet('none')}>Back</Button>
                <Button variant="ink" onClick={() => void confirmNext()} busy={busy === 'next_round'} busyLabel="Moving on"
                  disabled={board.round >= MAX_ROUND}>Go to round {board.round + 1}</Button>
              </div>
            </>
          )}
          {sheet === 'reset' && (
            <>
              <h2 className="t-head">Reset the scoreboard?</h2>
              <p className="t-help">Back to round 1, 0–0, clock stopped. Round length stays {fmtLength(board.round_seconds)}. This can’t be undone.</p>
              <div className="ref-sheet-actions">
                <Button variant="ghost" onClick={() => setSheet('none')}>Back</Button>
                <Button variant="danger" onClick={() => void doReset()} busy={busy === 'reset'} busyLabel="Resetting">Reset</Button>
              </div>
            </>
          )}
          {sheet === 'finish' && (
            <>
              <h2 className="t-head">Finish the bout?</h2>
              <p className="ref-final" aria-label={`${board.red_score} to ${board.blue_score}`}>
                <span className="c-red">{board.red_score}</span><span className="dash" aria-hidden="true">–</span><span className="c-blue">{board.blue_score}</span>
              </p>
              <p className="t-help">
                {canSettle
                  ? <>{board.running ? 'The clock stops. ' : ''}The result form opens with <b>{board.round} round{board.round === 1 ? '' : 's'}</b> and this score filled in. You pick the winner and how it ended there.</>
                  : <>{board.running ? 'The clock stops. ' : ''}The bout ends here: this score after <b>{board.round} round{board.round === 1 ? '' : 's'}</b>. An admin records the winner and how it ended.</>}
              </p>
              <div className="ref-sheet-actions">
                <Button variant="ghost" onClick={() => setSheet('none')}>Back</Button>
                <Button onClick={() => void doFinish()} busy={busy === 'pause' || pending.some(o => o.action === 'pause')} busyLabel="Stopping">{canSettle ? 'Go to result' : 'Finish bout'}</Button>
              </div>
            </>
          )}
        </BottomSheet>
      )}
    </div>
  )
}

/** Visible on touch screens (no title tooltip): when the browser can't hold the screen awake, or
 *  refused to, the note says what to do. A denied lock is retried on every tap (device.ts). */
function WakeNote({ status }: { status: WakeStatus }) {
  if (status === 'on') return <span className="ref-wake data c-2"><CheckCircle />Screen stays on</span>
  return (
    <p className="ref-wake ref-wake--warn">
      <Warning />
      <span><b>Screen may sleep.</b> Turn auto-lock off while you ref.</span>
    </p>
  )
}

const SHEET_LABEL: Record<Sheet, string> = {
  none: '', length: 'Round length', reset: 'Reset the scoreboard', finish: 'Finish the bout', next: 'Go to the next round',
}

/** Confirm / settings step pinned to the bottom (thumb reach). Paper on a 60% ink scrim; Esc and the
 *  scrim close it; focus moves into it and back to where it was. While it is open the board under it
 *  is inert, so Tab and screen readers stay inside the sheet (a real aria-modal). */
function BottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  // declared before the focus effect: on close its cleanup runs first, so the board is live again
  // by the time focus goes back to the button that opened the sheet
  useInertOutside(wrap)
  // mount only: the board re-renders 5x a second while the clock runs, focus must not jump
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('.ref-sheet-paper button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [])
  return (
    <div className="ref-sheet-wrap" ref={setWrap}>
      <button type="button" className="ref-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} id={id} className="ref-sheet">
        <Paper edges="both" className="ref-sheet-paper">{children}</Paper>
      </div>
    </div>
  )
}
