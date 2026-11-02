import type { Side } from './types'

export const MIN_BET = 10
export const MAX_BET_CAP = 500

/** Max allowed stake: least(500, floor(balance * 0.5)). */
export function maxBet(balance: number): number {
  return Math.max(0, Math.min(MAX_BET_CAP, Math.floor(balance * 0.5)))
}

/** Decimal pari-mutuel odds per side (total / side). null when side empty. */
export function poolOdds(red: number, blue: number): { red: number | null; blue: number | null } {
  const total = red + blue
  return { red: red > 0 ? total / red : null, blue: blue > 0 ? total / blue : null }
}

/** Estimated payout if stake were added to sideTotal now and that side won. */
export function estimatePayout(stake: number, sideTotal: number, otherTotal: number): number {
  if (stake <= 0) return 0
  const newSide = sideTotal + stake
  return Math.floor((stake * (newSide + otherTotal)) / newSide)
}

export interface PoolBet { id: string; side: Side; amount: number; created_at: string }
export interface Settlement { id: string; status: 'won' | 'lost' | 'refunded'; payout: number }

/**
 * Mirror of SQL admin_settle_fight. Winners get floor(stake * total / winningPool);
 * rounding dust goes to largest winning stake (tie -> earliest bet).
 * If winning pool is 0, everyone is refunded.
 */
export function settlePool(bets: PoolBet[], winner: Side): Settlement[] {
  const total = bets.reduce((s, b) => s + b.amount, 0)
  const winners = bets.filter(b => b.side === winner)
  const winPool = winners.reduce((s, b) => s + b.amount, 0)
  if (winPool === 0) return bets.map(b => ({ id: b.id, status: 'refunded', payout: b.amount }))
  const out = new Map<string, Settlement>()
  let paid = 0
  for (const b of bets) {
    if (b.side === winner) {
      const p = Math.floor((b.amount * total) / winPool)
      paid += p
      out.set(b.id, { id: b.id, status: 'won', payout: p })
    } else out.set(b.id, { id: b.id, status: 'lost', payout: 0 })
  }
  const dust = total - paid
  if (dust > 0) {
    const top = [...winners].sort((a, b) => b.amount - a.amount || a.created_at.localeCompare(b.created_at))[0]
    out.get(top.id)!.payout += dust
  }
  return bets.map(b => out.get(b.id)!)
}

/** Elo update. Returns integer delta applied to A (B gets -delta). */
export function eloUpdate(rA: number, rB: number, aWon: boolean, k = 32): { a: number; b: number; delta: number } {
  const expA = 1 / (1 + Math.pow(10, (rB - rA) / 400))
  const delta = Math.round(k * ((aWon ? 1 : 0) - expA))
  return { a: rA + delta, b: rB - delta, delta }
}

/** +3 -> "W3", -2 -> "L2", 0 -> "—" */
export function formatStreak(n: number): string {
  if (n > 0) return `W${n}`
  if (n < 0) return `L${-n}`
  return '—'
}

export interface Countdown { done: boolean; days: number; hours: number; minutes: number; seconds: number; label: string }
export function countdown(target: Date | string, now: Date = new Date()): Countdown {
  const ms = new Date(target).getTime() - now.getTime()
  if (ms <= 0) return { done: true, days: 0, hours: 0, minutes: 0, seconds: 0, label: 'NOW' }
  const s = Math.floor(ms / 1000)
  const days = Math.floor(s / 86400), hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60), seconds = s % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  const label = days > 0 ? `${days}d ${pad(hours)}h ${pad(minutes)}m` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return { done: false, days, hours, minutes, seconds, label }
}
