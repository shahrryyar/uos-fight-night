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
  it('contains no money words', () => {
    const all = ['fight_settle', 'fight_cancel', 'fight_no_contest', 'fight_correct', 'fight_decline', 'points_adjust']
      .map(a => text(row(a, { winner_side: 'blue', method: 'decision', delta: 5 }))).join(' ')
    expect(all).not.toMatch(/\b(bet|bets|odds|cash|payout|refund|wager|stake|punter|bettor)/i)
  })
})
