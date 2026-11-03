import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: [], error: null }), in: () => Promise.resolve({ data: [], error: null }) }) },
  friendlyError: (e: unknown) => String(e),
}))

const { default: MemberName } = await import('../MemberName')
const { COLOR_INK, NAME_COLORS } = await import('./cosmetics')
const { default: LockedDetails } = await import('../member/LockedDetails')

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('MemberName', () => {
  it('renders a plain name without cosmetics', () => {
    const out = html(<MemberName userId="u1" name="Hallway Guy" />)
    expect(out).toContain('<bdi class="mn-name">Hallway Guy</bdi>')
    expect(out).not.toContain('data-c')
    expect(out).not.toContain('mn-title')
  })

  it('applies colour, frame and title from a preview', () => {
    const out = html(<MemberName userId="u1" name="Hallway Guy" preview={{ name_color: 'crimson', frame: 'chain', title: 'Mat Rat' }} />)
    expect(out).toContain('data-c="crimson"')
    expect(out).toContain('mn--f-chain')
    expect(out).toContain('Mat Rat')
  })

  it('ignores unknown token keys (never becomes CSS)', () => {
    const out = html(<MemberName userId="u1" name="X" preview={{ name_color: 'red;background:url(x)', frame: 'belt' }} />)
    expect(out).not.toContain('data-c')
    expect(out).not.toContain('mn--f-')
  })

  it('title="none" and title="below"', () => {
    expect(html(<MemberName userId="u1" name="X" title="none" preview={{ title: 'Iron Grip' }} />)).not.toContain('Iron Grip')
    expect(html(<MemberName userId="u1" name="X" title="below" preview={{ title: 'Iron Grip' }} />)).toContain('mn--stack')
  })

  it('every name ink is AA (4.5:1) on ink, the pressed row, the toner ticket, paper, darkest grain and the tinted row', () => {
    for (const c of NAME_COLORS) {
      for (const bg of ['#0b0b0d', '#161517', '#1a1917']) expect(ratio(COLOR_INK[c].ink, bg)).toBeGreaterThanOrEqual(4.5)
      for (const bg of ['#f4f1ea', '#e2dfd8', '#cfccc5']) expect(ratio(COLOR_INK[c].paper, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gold-key name ink is not the belt gold (clearly different hue, not the retired bronze)', () => {
    const hue = (h: string) => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b)
      const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      return (x * 60 + 360) % 360
    }
    const belt = hue('#e3b341')
    expect(COLOR_INK.gold.ink.toLowerCase()).not.toBe('#e3b341')
    expect(COLOR_INK.gold.ink.toLowerCase()).not.toBe('#c98a4b')
    expect(Math.abs(hue(COLOR_INK.gold.ink) - belt)).toBeGreaterThanOrEqual(12)
    expect(Math.abs(hue(COLOR_INK.gold.paper) - belt)).toBeGreaterThanOrEqual(12)
  })

  it('LockedDetails picks list renders names through MemberName', () => {
    const out = html(<LockedDetails totals={null} names={new Map([['u2', 'Mat Fan']])} myId="u2" settled={false}
      bets={[{ id: 'b1', user_id: 'u2', fight_id: 'f', side: 'red', amount: 50, status: 'active', payout: null, created_at: '' } as never]} />)
    expect(out).toContain('class="mn"')
    expect(out).toContain('Mat Fan')
    expect(out).toContain('(you)')
  })
})
