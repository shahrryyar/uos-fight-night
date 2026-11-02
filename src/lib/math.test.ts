import { describe, expect, it } from 'vitest'
import type { Side } from './types'
import {
  MAX_BET_CAP,
  MIN_BET,
  countdown,
  eloUpdate,
  estimatePayout,
  formatStreak,
  maxBet,
  poolOdds,
  settlePool,
} from './math'
import type { PoolBet } from './math'

const T0 = Date.parse('2026-11-02T18:00:00Z')
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString()
const bet = (id: string, side: Side, amount: number, sec = 0): PoolBet => ({ id, side, amount, created_at: at(sec) })
const byId = (rows: ReturnType<typeof settlePool>) => Object.fromEntries(rows.map(r => [r.id, r]))
const sumPayout = (rows: ReturnType<typeof settlePool>) => rows.reduce((s, r) => s + r.payout, 0)
const sumStake = (bets: PoolBet[]) => bets.reduce((s, b) => s + b.amount, 0)

describe('constants', () => {
  it('match the contract', () => {
    expect(MIN_BET).toBe(10)
    expect(MAX_BET_CAP).toBe(500)
  })
})

describe('maxBet', () => {
  it.each([
    [0, 0],
    [19, 9],
    [20, 10],
    [21, 10],
    [999, 499],
    [1000, 500],
    [1001, 500],
    [5000, 500],
  ])('balance %i -> %i', (balance, expected) => {
    expect(maxBet(balance)).toBe(expected)
  })

  it('is below MIN_BET when balance < 20 (cannot bet)', () => {
    expect(maxBet(19)).toBeLessThan(MIN_BET)
    expect(maxBet(20)).toBe(MIN_BET)
  })

  it('never goes negative', () => {
    expect(maxBet(-50)).toBe(0)
  })
})

describe('poolOdds', () => {
  it('both sides empty -> null odds', () => {
    expect(poolOdds(0, 0)).toEqual({ red: null, blue: null })
  })

  it('one side empty -> null for that side, 1.0 for the other', () => {
    expect(poolOdds(0, 200)).toEqual({ red: null, blue: 1 })
    expect(poolOdds(150, 0)).toEqual({ red: 1, blue: null })
  })

  it('computes total / side', () => {
    const o = poolOdds(100, 300)
    expect(o.red).toBe(4)
    expect(o.blue).toBeCloseTo(4 / 3, 10)
  })

  it('even pools -> 2.0 each', () => {
    expect(poolOdds(250, 250)).toEqual({ red: 2, blue: 2 })
  })
})

describe('estimatePayout', () => {
  it('zero or negative stake -> 0', () => {
    expect(estimatePayout(0, 100, 100)).toBe(0)
    expect(estimatePayout(-10, 100, 100)).toBe(0)
  })

  it('empty pool -> stake back', () => {
    expect(estimatePayout(100, 0, 0)).toBe(100)
  })

  it('nobody on the other side -> stake back', () => {
    expect(estimatePayout(50, 200, 0)).toBe(50)
  })

  it('includes own stake in the side pool', () => {
    // side 100 + 100 = 200, total 400 -> 100 * 400 / 200
    expect(estimatePayout(100, 100, 200)).toBe(200)
    // side 150, total 250 -> floor(50 * 250 / 150) = 83
    expect(estimatePayout(50, 100, 100)).toBe(83)
  })

  it('first bettor on an empty side takes the whole other pool', () => {
    expect(estimatePayout(10, 0, 490)).toBe(500)
  })

  it('agrees with settlePool for a lone new bettor', () => {
    const bets = [bet('x', 'red', 100, 0), bet('y', 'blue', 200, 1), bet('me', 'red', 50, 2)]
    const est = estimatePayout(50, 100, 200)
    const actual = byId(settlePool(bets, 'red')).me.payout
    // estimate floors; settlement may add dust only to the largest stake (not "me")
    expect(actual).toBe(est)
  })
})

describe('settlePool', () => {
  it('no bets -> empty result', () => {
    expect(settlePool([], 'red')).toEqual([])
  })

  it('single winner takes the entire pool', () => {
    const bets = [bet('a', 'red', 100), bet('b', 'blue', 50, 1), bet('c', 'blue', 25, 2)]
    const r = byId(settlePool(bets, 'red'))
    expect(r.a).toEqual({ id: 'a', status: 'won', payout: 175 })
    expect(r.b).toEqual({ id: 'b', status: 'lost', payout: 0 })
    expect(r.c).toEqual({ id: 'c', status: 'lost', payout: 0 })
  })

  it('works for blue winner too', () => {
    const bets = [bet('a', 'red', 100), bet('b', 'blue', 50, 1)]
    const r = byId(settlePool(bets, 'blue'))
    expect(r.a.status).toBe('lost')
    expect(r.b).toEqual({ id: 'b', status: 'won', payout: 150 })
  })

  it('preserves input order and length', () => {
    const bets = [bet('z', 'blue', 10), bet('a', 'red', 20), bet('m', 'blue', 30)]
    expect(settlePool(bets, 'red').map(r => r.id)).toEqual(['z', 'a', 'm'])
  })

  it('multiple winners: proportional floor, dust to largest stake', () => {
    // total 67, win pool 60: floor(10*67/60)=11, floor(20*67/60)=22, floor(30*67/60)=33 -> 66, dust 1
    const bets = [bet('a', 'red', 10, 0), bet('b', 'red', 20, 1), bet('c', 'red', 30, 2), bet('d', 'blue', 7, 3)]
    const r = byId(settlePool(bets, 'red'))
    expect(r.a.payout).toBe(11)
    expect(r.b.payout).toBe(22)
    expect(r.c.payout).toBe(34)
    expect(r.d).toEqual({ id: 'd', status: 'lost', payout: 0 })
    expect(sumPayout(Object.values(r))).toBe(67)
  })

  it('dust tie on largest stake -> earliest created_at wins it', () => {
    // total 67, win pool 50: a=13, b=26, c=26 -> 65, dust 2 -> b (earlier than c)
    const bets = [bet('a', 'red', 10, 0), bet('c', 'red', 20, 9), bet('b', 'red', 20, 5), bet('d', 'blue', 17, 1)]
    const r = byId(settlePool(bets, 'red'))
    expect(r.a.payout).toBe(13)
    expect(r.b.payout).toBe(28)
    expect(r.c.payout).toBe(26)
    expect(sumPayout(Object.values(r))).toBe(67)
  })

  it('dust tie compares timestamps chronologically, not as strings', () => {
    // a is 17:59:00Z written with a +03:00 offset; as strings "T20" > "T17" would wrongly pick b.
    const bets: PoolBet[] = [
      { id: 'a', side: 'red', amount: 20, created_at: '2026-11-02T20:59:00+03:00' },
      { id: 'b', side: 'red', amount: 20, created_at: '2026-11-02T17:59:59.5Z' },
      { id: 'c', side: 'red', amount: 10, created_at: '2026-11-02T17:00:00Z' },
      { id: 'd', side: 'blue', amount: 17, created_at: '2026-11-02T17:00:00Z' },
    ]
    const r = byId(settlePool(bets, 'red'))
    expect(r.a.payout).toBe(28)
    expect(r.b.payout).toBe(26)
  })

  it('no dust -> nobody gets extra', () => {
    const bets = [bet('a', 'red', 100, 0), bet('b', 'red', 100, 1), bet('c', 'blue', 200, 2)]
    const r = byId(settlePool(bets, 'red'))
    expect(r.a.payout).toBe(200)
    expect(r.b.payout).toBe(200)
  })

  it('everyone on the losing side -> refund all', () => {
    const bets = [bet('a', 'blue', 40), bet('b', 'blue', 15, 1)]
    expect(settlePool(bets, 'red')).toEqual([
      { id: 'a', status: 'refunded', payout: 40 },
      { id: 'b', status: 'refunded', payout: 15 },
    ])
  })

  it('everyone on the winning side -> each gets their stake back as a win', () => {
    const bets = [bet('a', 'red', 40), bet('b', 'red', 15, 1)]
    const r = byId(settlePool(bets, 'red'))
    expect(r.a).toEqual({ id: 'a', status: 'won', payout: 40 })
    expect(r.b).toEqual({ id: 'b', status: 'won', payout: 15 })
  })

  it('winners never get less than their stake', () => {
    const bets = [bet('a', 'red', 333), bet('b', 'red', 10, 1), bet('c', 'blue', 11, 2)]
    for (const s of settlePool(bets, 'red')) {
      const b = bets.find(x => x.id === s.id)!
      if (s.status === 'won') expect(s.payout).toBeGreaterThanOrEqual(b.amount)
    }
  })

  it('conservation: sum(payouts) == total pool (randomized)', () => {
    let seed = 1234567
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + Math.floor(rnd() * 20)
      const bets: PoolBet[] = []
      for (let i = 0; i < n; i++) {
        bets.push(bet(`u${i}`, rnd() < 0.5 ? 'red' : 'blue', 10 + Math.floor(rnd() * 491), Math.floor(rnd() * 100)))
      }
      const winner: Side = rnd() < 0.5 ? 'red' : 'blue'
      const res = settlePool(bets, winner)
      const total = sumStake(bets)
      expect(res).toHaveLength(n)
      expect(sumPayout(res)).toBe(total)
      for (const s of res) {
        expect(Number.isInteger(s.payout)).toBe(true)
        expect(s.payout).toBeGreaterThanOrEqual(0)
      }
      const hasWinners = bets.some(b => b.side === winner)
      if (!hasWinners) expect(res.every(s => s.status === 'refunded')).toBe(true)
      else expect(res.some(s => s.status === 'refunded')).toBe(false)
    }
  })
})

describe('eloUpdate', () => {
  it('1000 vs 1000, A wins -> +16 / -16', () => {
    expect(eloUpdate(1000, 1000, true)).toEqual({ a: 1016, b: 984, delta: 16 })
  })

  it('1000 vs 1000, A loses -> -16 / +16', () => {
    expect(eloUpdate(1000, 1000, false)).toEqual({ a: 984, b: 1016, delta: -16 })
  })

  it('known values', () => {
    expect(eloUpdate(1200, 1000, true).delta).toBe(8) // 32 * (1 - 0.7597) = 7.69
    expect(eloUpdate(1200, 1000, false).delta).toBe(-24) // 32 * (0 - 0.7597) = -24.31
    expect(eloUpdate(1000, 1400, true).delta).toBe(29) // 32 * (1 - 1/11) = 29.09
    expect(eloUpdate(1000, 1400, false).delta).toBe(-3) // -2.91
  })

  it('custom K', () => {
    expect(eloUpdate(1000, 1000, true, 16).delta).toBe(8)
    expect(eloUpdate(1000, 1000, true, 0).delta).toBe(0)
  })

  it('zero-sum and integer', () => {
    for (let ra = 600; ra <= 1600; ra += 37) {
      for (let rb = 600; rb <= 1600; rb += 53) {
        for (const won of [true, false]) {
          const r = eloUpdate(ra, rb, won)
          expect(Number.isInteger(r.delta)).toBe(true)
          expect(r.a + r.b).toBe(ra + rb)
          expect(r.a - ra).toBe(r.delta)
          expect(rb - r.b).toBe(r.delta)
        }
      }
    }
  })

  it('symmetric: A beats B is the mirror of B loses to A', () => {
    for (let ra = 600; ra <= 1600; ra += 1) {
      const rb = 1000
      const ab = eloUpdate(ra, rb, true)
      const ba = eloUpdate(rb, ra, false)
      expect(ba.delta).toBe(-ab.delta)
      expect(ba.a).toBe(ab.b)
      expect(ba.b).toBe(ab.a)
    }
  })

  it('winner never loses points, loser never gains', () => {
    for (let ra = 400; ra <= 2000; ra += 50) {
      expect(eloUpdate(ra, 1000, true).delta).toBeGreaterThanOrEqual(0)
      expect(eloUpdate(ra, 1000, false).delta).toBeLessThanOrEqual(0)
    }
  })

  it('never returns negative zero', () => {
    // huge favourite wins -> raw delta ~ +0.0x ; huge underdog loses -> raw ~ -0.0x
    expect(Object.is(eloUpdate(3000, 1000, true).delta, 0)).toBe(true)
    expect(Object.is(eloUpdate(1000, 3000, false).delta, 0)).toBe(true)
  })
})

describe('formatStreak', () => {
  it.each([
    [0, '—'],
    [1, 'W1'],
    [3, 'W3'],
    [12, 'W12'],
    [-1, 'L1'],
    [-2, 'L2'],
    [-10, 'L10'],
  ])('%i -> %s', (n, s) => {
    expect(formatStreak(n)).toBe(s)
  })
})

describe('countdown', () => {
  const now = new Date('2026-11-02T18:00:00Z')

  it('past target -> done, NOW', () => {
    expect(countdown(new Date(now.getTime() - 60_000), now)).toEqual({
      done: true, days: 0, hours: 0, minutes: 0, seconds: 0, label: 'NOW',
    })
  })

  it('exactly now -> done', () => {
    expect(countdown(now, now).done).toBe(true)
  })

  it('invalid date -> done (no NaN labels)', () => {
    const c = countdown('not a date', now)
    expect(c.done).toBe(true)
    expect(c.label).toBe('NOW')
  })

  it('< 1 day -> HH:MM:SS', () => {
    const c = countdown(new Date(now.getTime() + (1 * 3600 + 2 * 60 + 3) * 1000), now)
    expect(c).toEqual({ done: false, days: 0, hours: 1, minutes: 2, seconds: 3, label: '01:02:03' })
  })

  it('just under 1 day', () => {
    const c = countdown(new Date(now.getTime() + 86_399_000), now)
    expect(c.label).toBe('23:59:59')
    expect(c.days).toBe(0)
  })

  it('1 second left', () => {
    expect(countdown(new Date(now.getTime() + 1000), now).label).toBe('00:00:01')
  })

  it('sub-second remaining floors to 00:00:00 but is not done', () => {
    const c = countdown(new Date(now.getTime() + 400), now)
    expect(c.done).toBe(false)
    expect(c.label).toBe('00:00:00')
  })

  it('exactly 1 day -> days format', () => {
    const c = countdown(new Date(now.getTime() + 86_400_000), now)
    expect(c).toEqual({ done: false, days: 1, hours: 0, minutes: 0, seconds: 0, label: '1d 00h 00m' })
  })

  it('> 1 day -> Nd HHh MMm', () => {
    const c = countdown(new Date(now.getTime() + (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000), now)
    expect(c).toEqual({ done: false, days: 2, hours: 3, minutes: 4, seconds: 5, label: '2d 03h 04m' })
  })

  it('accepts ISO string targets', () => {
    expect(countdown('2026-11-02T19:30:00Z', now).label).toBe('01:30:00')
    expect(countdown('2026-11-02T21:30:00+03:00', now).label).toBe('00:30:00')
  })
})
