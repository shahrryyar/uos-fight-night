import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AdminLogRow } from '../../lib/types'
import { logSentence, type Lookups } from './logSentence'

const L: Lookups = {
  people: { a1: 'Ari', u2: 'Hallway Guy' },
  fighters: { r: 'The Hallway Hurricane', b: 'Mattress Mauler' },
  fights: { f1: { id: 'f1', red_fighter_id: 'r', blue_fighter_id: 'b', card_date: '2026-11-06' } },
}
const row = (action: string, details: unknown, target_id: string | null = 'f1', actor: string | null = 'a1'): AdminLogRow =>
  ({ id: 1, actor, action, target_id, details, created_at: '2026-11-03T20:00:00Z' })
const text = (r: AdminLogRow) => renderToStaticMarkup(<>{logSentence(r, L).say}</>).replace(/<\/?bdi>/g, '').replace(/&nbsp;| /g, ' ')

describe('admin log sentences', () => {
  it('names the bout and winner for a settle, never ids or snake_case', () => {
    const s = text(row('fight_settle', { winner_side: 'red', method: 'pin', red_score: 6, blue_score: 3 }))
    expect(s).toBe('Ari recorded The Hallway Hurricane vs Mattress Mauler: The Hallway Hurricane by pin, 6–3.')
  })
  it('signs points with a true minus and names the member', () => {
    expect(text(row('points_adjust', { delta: -50, note: 'Late' }, 'u2'))).toBe('Ari took 50 pts from Hallway Guy.')
    expect(text(row('points_adjust', { delta: 100 }, 'u2'))).toBe('Ari gave Hallway Guy +100 pts.')
    expect(logSentence(row('points_adjust', { delta: -50, note: 'Late' }, 'u2'), L).why).toBe('Late')
  })
  it('booking reads the fighter ids from details', () => {
    expect(text(row('fight_create', { red: 'r', blue: 'b', card_date: '2026-11-06', is_main_event: true }))).toBe(
      'Ari booked The Hallway Hurricane vs Mattress Mauler for Fri 6 Nov as the main event.')
  })
  it('unknown actions fall back to words, not snake_case', () => {
    const s = text(row('some_new_thing', null, null, null))
    expect(s).toBe('The system: some new thing.')
    for (const a of ['fight_lock', 'fight_cancel', 'card_reorder', 'member_update', 'password_reset'])
      expect(text(row(a, { username: 'x', card_date: '2026-11-06' }))).not.toMatch(/_|[0-9a-f]{8}-/)
  })
  it('belt and season events read as sentences', () => {
    expect(text(row('belt_award', { note: 'Ruling', prev_fighter_id: 'b' }, 'r'))).toBe(
      'Ari gave The Hallway Hurricane the belt, taking it from Mattress Mauler.')
    expect(logSentence(row('belt_award', { note: 'Ruling', prev_fighter_id: null }, 'r'), L).why).toBe('Ruling')
    expect(text(row('belt_award', { prev_fighter_id: null }, 'r'))).toBe('Ari gave The Hallway Hurricane the belt.')
    expect(text(row('belt_vacate', { prev_fighter_id: 'b', note: null }, null))).toBe(
      'Ari took the belt off Mattress Mauler. Nobody holds it now.')
    expect(text(row('season_end', { season_name: 'Season 1', next_season_name: 'Spring 2027' }, null))).toBe(
      'Ari ended Season 1 and started Spring 2027. Points and Elo went back to 1,000.')
  })
  it('scoreboard events name the bout, never the raw action', () => {
    const bout = 'The Hallway Hurricane vs Mattress Mauler'
    expect(text(row('live_update', { action: 'start', round: 1 }))).toBe(`Ari started the scoreboard clock for ${bout}.`)
    expect(text(row('live_update', { action: 'next_round', round: 3 }))).toBe(`Ari moved ${bout} to round 3.`)
    expect(text(row('live_update', { action: 'set_round_seconds', value: 180, prev_round_seconds: 120 }))).toBe(
      `Ari set the rounds in ${bout} to 3:00 (was 2:00).`)
    expect(text(row('live_update', { action: 'reset', prev_round: 2, prev_red_score: 4, prev_blue_score: 3 }))).toBe(
      `Ari reset the scoreboard for ${bout}. It was round 2, 4–3.`)
    expect(text(row('live_update', { action: 'red_add', value: 1 }))).toBe(`Ari updated the scoreboard for ${bout}.`)
    for (const a of ['belt_award', 'belt_vacate', 'season_end', 'live_update'])
      expect(text(row(a, { action: 'reset' }))).not.toMatch(/_|[0-9a-f]{8}-|: (belt|season|live)/)
  })
  it('Wave C: lockdown on and off read differently, with the message as the why', () => {
    const on = row('site_lockdown', { on: true, message: 'Back at 9', prev: { on: false, message: null } }, null)
    expect(text(on)).toBe('Ari turned on maintenance mode. Members are locked out until it goes off.')
    expect(logSentence(on, L).why).toBe('Back at 9')
    const off = row('site_lockdown', { on: false, message: null, prev: { on: true, message: 'Back at 9' } }, null)
    expect(text(off)).toBe('Ari turned maintenance mode off. Members are back in.')
    expect(logSentence(off, L).why ?? null).toBeNull()
    const again = row('site_lockdown', { on: true, message: 'Now 10', prev: { on: true, message: 'Back at 9' } }, null)
    expect(text(again)).toBe('Ari changed the maintenance message. Members are still locked out.')
    expect(logSentence(again, L).why).toBe('Now 10')
  })
  it('Wave C: title requests name the member and the points, never the title', () => {
    expect(text(row('title_approve', { user_id: 'u2', title: 'Sofa King' }, 'req1'))).toBe('Ari approved a custom title for Hallway Guy.')
    const rej = row('title_reject', { user_id: 'u2', title_len: 9, reason: 'Too rude', refund: 250, season_reset: false }, 'req1')
    expect(text(rej)).toBe('Ari turned down a title request from Hallway Guy; 250 pts came back.')
    expect(logSentence(rej, L).why).toBe('Too rude')
    expect(text(row('title_reject', { user_id: 'u2', title_len: 9, refund: 0, season_reset: true }, 'req1'))).toBe(
      'Ari turned down a title request from Hallway Guy; no points came back (new season).')
    expect(text(row('title_approve', { user_id: 'u2', title: 'Sofa King' }, 'req1'))).not.toContain('Sofa King')
  })
  it('Wave C: callouts name both fighters', () => {
    const pair = { challenger: 'r', target: 'b' }
    const bout = 'The Hallway Hurricane vs Mattress Mauler'
    expect(text(row('callout_approve', { ...pair, prev_status: 'accepted' }, 'c1'))).toBe(`Ari approved the callout ${bout}.`)
    expect(text(row('callout_book', { ...pair, fight_id: 'f9', prev_status: 'approved' }, 'c1'))).toBe(`Ari booked ${bout} from a callout.`)
    expect(text(row('callout_reject', { reason: 'Weight gap', prev_status: 'pending' }, 'c1'))).toBe('Ari turned down a callout.')
    expect(logSentence(row('callout_reject', { reason: 'Weight gap' }, 'c1'), L).why).toBe('Weight gap')
    const del = row('callout_delete', { ...pair, reason: 'Abuse', status: 'pending', message_len: 40 }, 'c1')
    expect(text(del)).toBe(`Ari deleted the callout ${bout}.`)
    expect(logSentence(del, L).why).toBe('Abuse')
  })
  it('Wave C: Fight of the Night is the system speaking, with the card date', () => {
    expect(text(row('fotn_finalize', { card_date: '2026-11-06', winner_fight_id: 'f1', total_votes: 12 }, 'f1', null))).toBe(
      'Fight of the Night picked for Fri 6 Nov: The Hallway Hurricane vs Mattress Mauler (12 votes).')
    expect(text(row('fotn_finalize', { card_date: '2026-11-06', total_votes: 1 }, 'unknown', null))).toBe(
      'Fight of the Night picked for Fri 6 Nov (1 vote).')
  })
  it('Wave C actions never fall back to raw words, ids or snake_case', () => {
    const d = { on: true, user_id: 'u2', challenger: 'r', target: 'b', card_date: '2026-11-06', refund: 5, total_votes: 2 }
    for (const a of ['site_lockdown', 'title_approve', 'title_reject', 'callout_approve', 'callout_book', 'callout_reject', 'callout_delete', 'fotn_finalize'])
      expect(text(row(a, d, 'c1'))).not.toMatch(/_|[0-9a-f]{8}-|: (site|title|callout|fotn)|a member|a fighter/)
  })
  it('referee role reads as a referee', () => {
    expect(text(row('member_create', { display_name: 'Ref Rita', username: 'rita', role: 'referee' }, 'u3'))).toBe(
      'Ari made an account for Ref Rita (@rita) as a referee.')
    expect(text(row('member_update', { display_name: 'Ref Rita', role: 'referee', prev: { role: 'member' } }, 'u3'))).toBe(
      'Ari updated Ref Rita: made them a referee.')
  })
  it('contains no money words', () => {
    const all = ['fight_settle', 'fight_cancel', 'fight_no_contest', 'fight_correct', 'fight_decline', 'points_adjust',
      'site_lockdown', 'title_approve', 'title_reject', 'callout_approve', 'callout_book', 'callout_reject', 'callout_delete', 'fotn_finalize']
      .map(a => text(row(a, { winner_side: 'blue', method: 'decision', delta: 5, on: true, user_id: 'u2', refund: 250, challenger: 'r', target: 'b', card_date: '2026-11-06', total_votes: 3 })))
      .concat(text(row('title_reject', { user_id: 'u2', refund: 0, season_reset: true })), text(row('site_lockdown', { on: false })))
      .join(' ')
    expect(all).not.toMatch(/\b(bet|bets|odds|cash|payout|refund|wager|stake|punter|bettor)/i)
  })
})
