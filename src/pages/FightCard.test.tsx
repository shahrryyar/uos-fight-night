import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { boutsLabel, partitionCardBouts } from '../components/member/format'
import type { FightRow } from '../lib/hooks'

const makeFight = (id: string, opts: Partial<FightRow> = {}): FightRow =>
  ({
    id,
    red_fighter_id: 'r1',
    blue_fighter_id: 'b1',
    scheduled_at: '2026-11-07T18:00:00Z',
    lock_at: '2026-11-07T18:30:00Z',
    status: 'open',
    bout_order: 1,
    is_main_event: false,
    card_date: '2026-11-07',
    ...opts,
  }) as FightRow

describe('FightCard undercard heading count', () => {
  it('undercard excludes the main event and heading count matches bouts listed', () => {
    const fights = [
      makeFight('main', { is_main_event: true, bout_order: 3, status: 'open' }),
      makeFight('bout1', { is_main_event: false, bout_order: 1, status: 'open' }),
      makeFight('bout2', { is_main_event: false, bout_order: 2, status: 'locked' }),
    ]

    const { featured, undercard, results } = partitionCardBouts(fights)

    expect(featured?.id).toBe('main')
    // Main event must be excluded from undercard
    expect(undercard.map(f => f.id)).toEqual(['bout1', 'bout2'])
    expect(undercard).toHaveLength(2)
    expect(results).toHaveLength(0)

    // Heading count label
    const countLabel = boutsLabel(undercard.length)
    expect(countLabel).toBe('2 bouts')

    // Render undercard section markup as in FightCard.tsx
    const html = renderToStaticMarkup(
      <section className="section" aria-labelledby="uc-2026-11-07">
        <div className="section-head">
          <h2 id="uc-2026-11-07" className="t-head">{featured ? 'Undercard' : 'Bouts'}</h2>
          <span className="data c-2">{countLabel}</span>
        </div>
        <div className="bouts">
          {undercard.map(f => <div key={f.id} className="bout-item" data-fight-id={f.id} />)}
        </div>
      </section>
    )

    // Verify heading text contains 'Undercard' and '2 bouts'
    expect(html).toContain('Undercard')
    expect(html).toContain('2 bouts')

    // Verify number of rendered bouts equals count in heading
    const renderedBouts = [...html.matchAll(/class="bout-item"/g)]
    expect(renderedBouts).toHaveLength(undercard.length)
  })

  it('separates finished bouts from undercard so heading count only reflects listed bouts', () => {
    const fights = [
      makeFight('main', { is_main_event: true, bout_order: 4, status: 'open' }),
      makeFight('uc-live-1', { is_main_event: false, bout_order: 1, status: 'open' }),
      makeFight('uc-live-2', { is_main_event: false, bout_order: 2, status: 'scheduled' }),
      makeFight('uc-done', { is_main_event: false, bout_order: 3, status: 'settled', settled_at: '2026-11-07T19:00:00Z' }),
    ]

    const { featured, undercard, results } = partitionCardBouts(fights)

    expect(featured?.id).toBe('main')
    expect(undercard.map(f => f.id)).toEqual(['uc-live-1', 'uc-live-2'])
    expect(undercard).toHaveLength(2)
    expect(boutsLabel(undercard.length)).toBe('2 bouts')

    expect(results.map(f => f.id)).toEqual(['uc-done'])
    expect(results).toHaveLength(1)
  })

  it('formats single bout as "1 bout"', () => {
    const fights = [
      makeFight('main', { is_main_event: true, bout_order: 2, status: 'open' }),
      makeFight('solo', { is_main_event: false, bout_order: 1, status: 'open' }),
    ]

    const { featured, undercard } = partitionCardBouts(fights)
    expect(featured?.id).toBe('main')
    expect(undercard).toHaveLength(1)
    expect(boutsLabel(undercard.length)).toBe('1 bout')
  })
})
