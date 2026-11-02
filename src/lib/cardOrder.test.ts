import { describe, expect, it } from 'vitest'
import { boutSort, groupByCard, type FightRow } from './hooks'

const f = (id: string, o: Partial<FightRow>): FightRow =>
  ({ id, status: 'open', scheduled_at: '2026-11-07T18:00:00Z', card_date: '2026-11-07', ...o }) as FightRow

describe('card order', () => {
  it('boutSort puts the main event last whatever its bout_order', () => {
    const list = [f('m', { is_main_event: true, bout_order: 1 }), f('a', { bout_order: 2 }), f('b', { bout_order: 3 })]
    expect([...list].sort(boutSort).map(x => x.id)).toEqual(['a', 'b', 'm'])
  })
  it('a cancelled former main event loses the flag when a live replacement exists', () => {
    const [card] = groupByCard([
      f('old', { is_main_event: true, status: 'cancelled', cancel_kind: 'cancelled', bout_order: 3 }),
      f('new', { is_main_event: true, bout_order: 4 }),
      f('u', { bout_order: 1 }),
    ])
    expect(card.fights.filter(x => x.is_main_event).map(x => x.id)).toEqual(['new'])
    expect(card.fights.at(-1)?.id).toBe('new')
  })
  it('a lone cancelled main event keeps its flag', () => {
    const [card] = groupByCard([f('nc', { is_main_event: true, status: 'cancelled', cancel_kind: 'no_contest' }), f('u', {})])
    expect(card.fights.find(x => x.id === 'nc')?.is_main_event).toBe(true)
  })
})
