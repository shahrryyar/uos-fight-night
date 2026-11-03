import { describe, expect, it } from 'vitest'
import { adminError } from './adminUtils'

describe('adminError', () => {
  it('rewrites pick/points codes in fun-points words', () => {
    for (const code of ['ADMIN_HAS_BET', 'BET_TOO_SMALL', 'BET_TOO_LARGE', 'ALREADY_BET', 'BET_NOT_FOUND', 'BET_NOT_ACTIVE']) {
      const text = adminError({ message: `P0001: ${code}` })
      expect(text).not.toMatch(/\b(bet|bets|wager|stake|odds|cash|payout)\b/i)
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/)
    }
    expect(adminError({ message: 'ADMIN_HAS_BET' })).toBe('You have points on this bout, so another admin has to record the result.')
  })
  it('falls through to friendlyError for other codes', () => {
    expect(adminError({ message: 'FIGHT_LOCKED' })).toBe('Picks are locked for this fight.')
  })
})
