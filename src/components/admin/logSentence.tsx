/** Admin log sentences (DESIGN 11.16): one human sentence per event, never raw snake_case or UUIDs. */
import type { ReactNode } from 'react'
import { fmtDelta, fmtNum } from '../../lib/copy'
import type { AdminLogRow } from '../../lib/types'
import { fmtCardDate } from './ui'

type Dict = Record<string, unknown>
export interface FightRef { id: string; red_fighter_id: string; blue_fighter_id: string; card_date: string | null }
export interface Lookups { people: Record<string, string>; fighters: Record<string, string>; fights: Record<string, FightRef> }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
/** 180 -> "3:00", 90 -> "1:30" (round lengths in the scoreboard's own format) */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/** One human sentence per event (DESIGN 11.16 "Admin log"): never raw snake_case actions or UUIDs. */
export function logSentence(r: AdminLogRow, L: Lookups): { say: ReactNode; why?: string | null } {
  const d = (r.details && typeof r.details === 'object' ? r.details : {}) as Dict
  const who = r.actor ? L.people[r.actor] ?? 'An admin' : 'The system'
  const fighter = (id: unknown) => (typeof id === 'string' ? L.fighters[id] ?? 'a fighter' : 'a fighter')
  const person = (id: string | null) => (id ? L.people[id] ?? 'a member' : 'a member')
  const f = r.target_id ? L.fights[r.target_id] : undefined
  const bout = f ? `${fighter(f.red_fighter_id)} vs ${fighter(f.blue_fighter_id)}` : 'a bout'
  const B = (s: string) => <bdi>{s}</bdi>
  const reason = str(d.reason) ?? str(d.note)
  // callout_* rows target the callout id; the fighters ride in details
  const hasPair = typeof d.challenger === 'string' && typeof d.target === 'string'
  const callout = `${fighter(d.challenger)} vs ${fighter(d.target)}`

  switch (r.action) {
    case 'fight_create': {
      const date = str(d.card_date)
      return { say: <>{B(who)} booked {B(`${fighter(d.red)} vs ${fighter(d.blue)}`)}{date ? ` for ${fmtCardDate(date)}` : ''}{d.is_main_event ? ' as the main event' : ''}.</> }
    }
    case 'fight_lock': return { say: <>{B(who)} locked picks on {B(bout)}.</> }
    case 'fight_settle': {
      const side = d.winner_side === 'red' ? 'red' : d.winner_side === 'blue' ? 'blue' : null
      const winner = f && side ? fighter(side === 'red' ? f.red_fighter_id : f.blue_fighter_id) : 'the winner'
      const score = typeof d.red_score === 'number' && typeof d.blue_score === 'number' ? `, ${d.red_score}–${d.blue_score}` : ''
      return { say: <>{B(who)} recorded {B(bout)}: {B(winner)} by {String(d.method ?? 'result')}{score}.</> }
    }
    case 'fight_correct': return { say: <>{B(who)} corrected the result of {B(bout)}. It went back on the live card.</>, why: reason }
    case 'fight_cancel': return { say: <>{B(who)} called off {B(bout)}. Every pick came back.</>, why: reason }
    case 'fight_no_contest': return { say: <>{B(who)} called {B(bout)} a no contest. Every pick came back.</>, why: reason }
    case 'fight_accept': return { say: <>{B(who)} said yes to {B(bout)}.</> }
    case 'fight_decline': return { say: <>{B(who)} said no to {B(bout)}, so it was called off.</> }
    case 'fight_force_open': return { say: <>{B(who)} opened picks on {B(bout)} without both yeses.</>, why: reason }
    case 'card_reorder': {
      const date = str(d.card_date)
      return { say: <>{B(who)} changed the bout order{date ? ` for ${fmtCardDate(date)}` : ''}.</> }
    }
    case 'card_main_event': return { say: <>{B(who)} made {B(bout)} the main event.</> }
    case 'fighter_create': return { say: <>{B(who)} added {B(str(d.nickname) ?? 'a fighter')} to the roster.</> }
    case 'fighter_update': return { say: <>{B(who)} edited {B(str(d.nickname) ?? 'a fighter')}{d.hidden === true ? ' and hid them' : ''}.</> }
    case 'member_create': {
      const name = str(d.display_name) ?? str(d.username) ?? 'a member'
      return { say: <>{B(who)} made an account for {B(name)}{str(d.username) ? ` (@${d.username})` : ''}{d.role === 'admin' ? ' as an admin' : d.role === 'referee' ? ' as a referee' : ''}.</> }
    }
    case 'member_update': {
      const name = str(d.display_name) ?? person(r.target_id)
      const prev = (d.prev && typeof d.prev === 'object' ? d.prev : {}) as Dict
      const bits: string[] = []
      if (prev.role !== undefined && prev.role !== d.role) bits.push(d.role === 'admin' ? 'made them an admin' : d.role === 'referee' ? 'made them a referee' : 'made them a member')
      if (prev.active !== undefined && prev.active !== d.active) bits.push(d.active ? 'switched the account on' : 'switched the account off')
      if (prev.fighter_id !== undefined && prev.fighter_id !== d.fighter_id) bits.push(d.fighter_id ? `linked them to ${fighter(d.fighter_id)}` : 'unlinked their fighter')
      if (prev.display_name !== undefined && prev.display_name !== d.display_name) bits.push('renamed them')
      return { say: <>{B(who)} updated {B(name)}{bits.length ? `: ${bits.join(', ')}` : ''}.</> }
    }
    case 'password_reset': return { say: <>{B(who)} reset the password for {B(str(d.username) ? `@${d.username}` : person(r.target_id))}.</> }
    case 'points_adjust': {
      const n = typeof d.delta === 'number' ? d.delta : Number(d.delta)
      const name = person(r.target_id)
      return Number.isFinite(n) && n < 0
        ? { say: <>{B(who)} took {fmtNum(-n)}&nbsp;pts from {B(name)}.</>, why: reason }
        : { say: <>{B(who)} gave {B(name)} {Number.isFinite(n) ? fmtDelta(n) : 'some'}&nbsp;pts.</>, why: reason }
    }
    case 'bootstrap_admin': return { say: <>{B(str(d.username) ? `@${d.username}` : 'The first admin')} became the first admin.</> }
    case 'belt_award': {
      const prev = str(d.prev_fighter_id)
      return { say: <>{B(who)} gave {B(fighter(r.target_id))} the belt{prev ? <>, taking it from {B(fighter(prev))}</> : ''}.</>, why: reason }
    }
    case 'belt_vacate': {
      const prev = str(d.prev_fighter_id)
      return { say: <>{B(who)} took the belt{prev ? <> off {B(fighter(prev))}</> : ''}. Nobody holds it now.</>, why: reason }
    }
    case 'season_end': {
      const ended = str(d.season_name) ?? 'the season', next = str(d.next_season_name)
      return { say: <>{B(who)} ended {B(ended)}{next ? <> and started {B(next)}</> : ''}. Points and Elo went back to 1,000.</> }
    }
    case 'live_update': {
      // since 20261103000007 only these four are logged; older rows (score taps) read as a plain update
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
      const round = n(d.round), len = n(d.value), prevLen = n(d.prev_round_seconds)
      const pr = n(d.prev_round), prs = n(d.prev_red_score), pbs = n(d.prev_blue_score)
      switch (d.action) {
        case 'start': return { say: <>{B(who)} started the scoreboard clock for {B(bout)}.</> }
        case 'next_round': return { say: <>{B(who)} moved {B(bout)} to round {round ?? 'the next'}.</> }
        case 'set_round_seconds': return {
          say: <>{B(who)} set the rounds in {B(bout)} to {len != null ? clock(len) : 'a new length'}{prevLen != null ? ` (was ${clock(prevLen)})` : ''}.</>,
        }
        case 'reset': return {
          say: <>{B(who)} reset the scoreboard for {B(bout)}{pr != null && prs != null && pbs != null ? `. It was round ${pr}, ${prs}–${pbs}` : ''}.</>,
        }
        default: return { say: <>{B(who)} updated the scoreboard for {B(bout)}.</> }
      }
    }
    case 'invite_create': return { say: <>{B(who)} made an invite code.</> }
    case 'invite_revoke': return { say: <>{B(who)} cancelled an invite code.</> }
    // Wave C
    case 'site_lockdown': {
      const wasOn = !!d.prev && typeof d.prev === 'object' && (d.prev as Dict).on === true
      if (d.on === true && wasOn) return { say: <>{B(who)} changed the maintenance message. Members are still locked out.</>, why: str(d.message) }
      return d.on === true
      ? { say: <>{B(who)} turned on maintenance mode. Members are locked out until it goes off.</>, why: str(d.message) }
      : { say: <>{B(who)} turned maintenance mode off. Members are back in.</> }
    }
    case 'title_approve': return { say: <>{B(who)} approved a custom title for {B(person(str(d.user_id)))}.</> }
    case 'title_reject': {
      // the title itself is redacted server-side (title_len only); never show it
      const n = typeof d.refund === 'number' ? d.refund : Number(d.refund)
      const back = d.season_reset === true ? 'no points came back (new season)'
        : Number.isFinite(n) && n > 0 ? `${fmtNum(n)}\u00a0pts came back` : 'no points came back'
      return { say: <>{B(who)} turned down a title request from {B(person(str(d.user_id)))}; {back}.</>, why: reason }
    }
    case 'callout_approve': return { say: <>{B(who)} approved the callout {B(callout)}.</> }
    case 'callout_book': return { say: <>{B(who)} booked {B(callout)} from a callout.</> }
    case 'callout_reject': return {
      say: hasPair ? <>{B(who)} turned down the callout {B(callout)}.</> : <>{B(who)} turned down a callout.</>, why: reason,
    }
    case 'callout_delete': return { say: <>{B(who)} deleted the callout {B(callout)}.</>, why: reason }
    case 'fotn_finalize': {
      const date = str(d.card_date)
      const v = typeof d.total_votes === 'number' ? d.total_votes : null
      return {
        say: <>Fight of the Night picked{date ? ` for ${fmtCardDate(date)}` : ''}{f ? <>: {B(bout)}</> : ''}{v != null ? ` (${fmtNum(v)} ${v === 1 ? 'vote' : 'votes'})` : ''}.</>,
      }
    }
    default: {
      const words = r.action.replace(/_/g, ' ')
      return { say: <>{B(who)}: {words}.</>, why: reason }
    }
  }
}
